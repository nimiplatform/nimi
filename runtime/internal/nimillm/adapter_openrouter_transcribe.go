package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func ExecuteOpenRouterTranscribe(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	b, err := nativeMediaBackend(ctx, cfg, "openrouter")
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
	format := map[string]string{"audio/wav": "wav", "audio/mpeg": "mp3"}[s.GetMimeType()]
	body := map[string]any{"model": model, "input_audio": map[string]any{"data": base64.StdEncoding.EncodeToString(audio), "format": format}, "response_format": "json"}
	if s.GetLanguage() != "" {
		body["language"] = s.GetLanguage()
	}
	resp, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/audio/transcriptions", body)
	if err != nil {
		return nil, nil, "", err
	}
	defer func(cleanup func() error) { _ = cleanup() }(resp.Body.Close)
	var out struct {
		Text     *string `json:"text"`
		Language *string `json:"language"`
		Words    []struct {
			Word  string   `json:"word"`
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
		} `json:"words"`
		Usage *openRouterUsage `json:"usage"`
	}
	if err := DecodeResponseJSON(resp, &out); err != nil {
		return nil, nil, "", err
	}
	if out.Text == nil || strings.TrimSpace(*out.Text) == "" || len(out.Words) > localexecution.MaxSpeechTranscriptWords {
		return nil, nil, "", openRouterOutputError()
	}
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(*out.Text)}
	if out.Language != nil {
		code, ok := openAIWhisperReportedLanguageCode(*out.Language)
		if !ok {
			return nil, nil, "", openRouterOutputError()
		}
		transcript.Language = code
	}
	for _, w := range out.Words {
		if w.Start == nil || w.End == nil || *w.End > duration {
			return nil, nil, "", openRouterOutputError()
		}
		transcript.Words = append(transcript.Words, &runtimev1.SpeechTranscriptWord{Text: w.Word, StartSeconds: *w.Start, EndSeconds: *w.End})
	}
	if err := localexecution.ValidateSpeechTranscript(transcript, s.GetTimestamps()); err != nil {
		return nil, nil, "", openRouterOutputError()
	}
	data, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", err
	}
	usage, err := out.Usage.stats()
	return []*runtimev1.ScenarioArtifact{BinaryArtifact(localexecution.SpeechTranscriptMIME, data, map[string]any{"adapter": capabilitydriver.CloudMediaAdapterOpenRouterTranscribe})}, usage, "", err
}
