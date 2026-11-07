package nimillm

import (
	"bytes"
	"context"
	"math"
	"mime/multipart"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

func (p *CloudProvider) executeGroqSpeech(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, model string, target *RemoteTarget) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	backend, resolved := p.ResolveMediaBackendWithTarget(model, target)
	if backend == nil || resolved == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	s := req.GetSpec().GetSpeechSynthesize()
	audio, err := backend.postRaw(ctx, backend.compatiblePath("/audio/speech"), map[string]any{"model": resolved, "voice": scenarioVoiceRef(s), "input": s.GetText(), "response_format": "wav"})
	if err != nil {
		return nil, nil, "", err
	}
	artifact, err := nativeSpeechArtifact(ctx, audio, "wav", 0, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterGroqSpeech, "resolved_model": resolved, "voice": scenarioVoiceRef(s)})
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{artifact}, nil, "", nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func (p *CloudProvider) executeGroqTranscriptions(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest, model string, target *RemoteTarget) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	backend, resolved := p.ResolveMediaBackendWithTarget(model, target)
	if backend == nil || resolved == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	s := req.GetSpec().GetSpeechTranscribe()
	audio := s.GetAudioSource().GetAudioBytes()
	var duration float64
	if s.GetMimeType() == "audio/wav" || s.GetMimeType() == "audio/mpeg" {
		var err error
		duration, err = nativeSpeechRecordingDuration(ctx, audio, s.GetMimeType())
		if err != nil {
			return nil, nil, "", err
		}
		if duration < .01 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
		}
	}
	fields := [][2]string{{"model", resolved}, {"response_format", "verbose_json"}}
	if s.GetLanguage() != "" {
		fields = append(fields, [2]string{"language", s.GetLanguage()})
	}
	if s.GetPrompt() != "" {
		fields = append(fields, [2]string{"prompt", s.GetPrompt()})
	}
	if s.GetTimestamps() {
		fields = append(fields, [2]string{"timestamp_granularities[]", "word"})
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range fields {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			return nil, nil, "", err
		}
	}
	filename := map[string]string{"audio/wav": "recording.wav", "audio/mpeg": "recording.mp3", "audio/mp4": "recording.m4a", "audio/webm": "recording.webm", "audio/flac": "recording.flac", "audio/ogg": "recording.ogg"}[s.GetMimeType()]
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, nil, "", err
	}
	if _, err = part.Write(audio); err != nil {
		return nil, nil, "", err
	}
	if err = writer.Close(); err != nil {
		return nil, nil, "", err
	}
	request, err := backend.newRequest(ctx, http.MethodPost, backend.baseURL+backend.compatiblePath("/audio/transcriptions"), &body)
	if err != nil {
		return nil, nil, "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Accept", "application/json")
	response, err := backend.do(request)
	if err != nil {
		return nil, nil, "", MapProviderRequestError(err)
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out struct {
		Text     *string  `json:"text"`
		Language *string  `json:"language"`
		Duration *float64 `json:"duration"`
		Words    []struct {
			Word  *string  `json:"word"`
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
		} `json:"words"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", err
	}
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	if out.Duration != nil && (math.IsNaN(*out.Duration) || math.IsInf(*out.Duration, 0) || *out.Duration < .01) {
		return nil, nil, "", invalid()
	}
	// Other native upload containers use the provider's actual verbose_json
	// duration for word bounds. It is not substituted for known file facts and
	// is never projected as billed usage or an independently decoded duration.
	if duration == 0 && out.Duration != nil {
		duration = *out.Duration
	}
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" || len(out.Words) > localexecution.MaxSpeechTranscriptWords {
		return nil, nil, "", invalid()
	}
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text)}
	if out.Language != nil {
		code, ok := openAIWhisperReportedLanguageCode(*out.Language)
		if !ok {
			return nil, nil, "", invalid()
		}
		transcript.Language = code
	}
	for _, word := range out.Words {
		if word.Word == nil || word.Start == nil || word.End == nil || duration <= 0 || *word.End > duration {
			return nil, nil, "", invalid()
		}
		transcript.Words = append(transcript.Words, &runtimev1.SpeechTranscriptWord{Text: *word.Word, StartSeconds: *word.Start, EndSeconds: *word.End})
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, s.GetTimestamps()); err != nil {
		return nil, nil, "", invalid()
	}
	encoded, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", err
	}
	// Native duration describes the recording, not billed duration (Groq has a
	// minimum charge). No token or billing usage is inferred from it.
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, encoded, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterGroqTranscribe})}, nil, "", nil
}
