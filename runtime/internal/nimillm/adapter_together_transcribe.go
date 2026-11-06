package nimillm

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func ExecuteTogetherTranscribe(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "together")
	if err != nil {
		return nil, nil, "", err
	}
	defer b.client.CloseIdleConnections()
	s := req.GetSpec().GetSpeechTranscribe()
	audio := s.GetAudioSource().GetAudioBytes()
	duration, err := nativeSpeechRecordingDuration(ctx, audio, s.GetMimeType())
	if err != nil {
		return nil, nil, "", err
	}
	if duration < .01 || duration > 4*60*60 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	language := s.GetLanguage()
	if language == "" {
		language = "auto"
	}
	format := "json"
	if s.GetTimestamps() {
		format = "verbose_json"
	}
	fields := [][2]string{{"model", model}, {"response_format", format}, {"language", language}}
	if s.GetTimestamps() {
		fields = append(fields, [2]string{"timestamp_granularities", "word"})
	}
	if s.GetPrompt() != "" {
		fields = append(fields, [2]string{"prompt", s.GetPrompt()})
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, f := range fields {
		if err := writer.WriteField(f[0], f[1]); err != nil {
			return nil, nil, "", err
		}
	}
	filename := map[string]string{"audio/wav": "recording.wav", "audio/mpeg": "recording.mp3"}[s.GetMimeType()]
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	header.Set("Content-Type", s.GetMimeType())
	part, err := writer.CreatePart(header)
	if err != nil {
		return nil, nil, "", err
	}
	if _, err = part.Write(audio); err != nil {
		return nil, nil, "", err
	}
	if err = writer.Close(); err != nil {
		return nil, nil, "", err
	}
	if body.Len() > 80_000_000 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	response, err := nativeMediaHTTPRequest(ctx, b, http.MethodPost, "/v1/audio/transcriptions", writer.FormDataContentType(), &body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		Text     *string `json:"text"`
		Language *string `json:"language"`
		Words    []struct {
			Text  *string  `json:"word"`
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
		} `json:"words"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", err
	}
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" || len(out.Words) > localexecution.MaxSpeechTranscriptWords {
		return nil, nil, "", togetherOutputError()
	}
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text)}
	if out.Language != nil {
		language, ok := openAIWhisperReportedLanguageCode(*out.Language)
		if !ok {
			return nil, nil, "", togetherOutputError()
		}
		transcript.Language = language
	}
	for _, word := range out.Words {
		if word.Text == nil || word.Start == nil || word.End == nil || *word.End > duration {
			return nil, nil, "", togetherOutputError()
		}
		transcript.Words = append(transcript.Words, &runtimev1.SpeechTranscriptWord{Text: *word.Text, StartSeconds: *word.Start, EndSeconds: *word.End})
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, s.GetTimestamps()); err != nil {
		return nil, nil, "", togetherOutputError()
	}
	data, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterTogetherTranscribe})}, nil, "", nil
}
