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
func ExecuteSiliconFlowTranscribe(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "siliconflow")
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
	if duration < .01 || duration > 3600 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model", model); err != nil {
		return nil, nil, "", err
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
	response, err := nativeMediaHTTPRequest(ctx, b, http.MethodPost, "/v1/audio/transcriptions", writer.FormDataContentType(), &body)
	if err != nil {
		return nil, nil, "", err
	}
	defer response.Body.Close()
	var out struct {
		Text *string `json:"text"`
	}
	if err := DecodeResponseJSON(response, &out); err != nil {
		return nil, nil, "", err
	}
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" {
		return nil, nil, "", siliconFlowOutputError()
	}
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text)}
	if err := localexecution.ValidateSpeechTranscript(transcript, false); err != nil {
		return nil, nil, "", siliconFlowOutputError()
	}
	data, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", err
	}
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterSiliconFlowTranscribe})}, nil, "", nil
}
