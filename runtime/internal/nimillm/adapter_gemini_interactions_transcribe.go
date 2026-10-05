package nimillm

import (
	"context"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/durationpb"
)

const geminiInlineTranscribeModel = "gemini-3.5-transcribe"

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
// ExecuteGeminiInteractionsTranscribe uses a synchronous, stateless native
// Interaction with inline audio. It creates no Files resource or stored turn.
func ExecuteGeminiInteractionsTranscribe(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	model string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	if err := capabilitydriver.ValidateGeminiInlineTranscribeRequest(req, model); err != nil {
		return nil, nil, "", err
	}
	spec := scenarioSpeechTranscribeSpec(req)
	source := spec.GetAudioSource().GetAudioBytes()
	payload := map[string]any{
		"model": model,
		"input": []map[string]any{{
			"type": "audio", "data": base64.StdEncoding.EncodeToString(source), "mime_type": "audio/wav",
		}},
		"store": false,
	}
	if spec.GetTimestamps() {
		payload["generation_config"] = map[string]any{"transcription_config": map[string]any{
			"mode": map[string]any{"type": "verbatim", "timestamp_granularities": []string{"word"}},
		}}
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(
		ctx, http.MethodPost, JoinURL(baseURL, "/interactions"), "", payload, &response,
		map[string]string{"x-goog-api-key": apiKey}, resolveGeminiGenerateContentHTTPTimeout(req),
	); err != nil {
		if ctx.Err() != nil {
			return nil, nil, "", providerPollContextError(ctx.Err())
		}
		return nil, nil, "", err
	}
	transcript, err := geminiInteractionsTranscript(response, spec.GetTimestamps())
	if err != nil {
		return nil, nil, "", err
	}
	encoded, err := protojson.Marshal(transcript)
	if err != nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage, err := geminiInteractionUsage(response["usage"])
	if err != nil {
		return nil, nil, "", err
	}
	artifact := BinaryArtifact(localexecution.SpeechTranscriptMIME, encoded, map[string]any{"adapter": "gemini_interactions_transcribe_adapter"})
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}

func geminiInteractionsTranscript(payload map[string]any, requireTiming bool) (*runtimev1.SpeechTranscript, error) {
	invalid := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if strings.TrimSpace(ValueAsString(payload["status"])) != "completed" {
		return nil, invalid()
	}
	steps, ok := payload["steps"].([]any)
	if !ok || len(steps) != 1 || ValueAsString(MapField(steps[0], "type")) != "model_output" {
		return nil, invalid()
	}
	content, ok := MapField(steps[0], "content").([]any)
	if !ok || len(content) != 1 || ValueAsString(MapField(content[0], "type")) != "text" {
		return nil, invalid()
	}
	text, ok := MapField(content[0], "text").(string)
	if !ok {
		return nil, invalid()
	}
	// Preserve the established capture boundary's outer whitespace normalization;
	// punctuation and all interior whitespace remain the provider's transcript.
	transcript := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: strings.TrimSpace(text)}
	if raw := MapField(content[0], "annotations"); raw != nil {
		annotations, ok := raw.([]any)
		if !ok || len(annotations) > localexecution.MaxSpeechTranscriptWords {
			return nil, invalid()
		}
		for _, annotation := range annotations {
			if MapField(annotation, "type") != "word_info" {
				continue
			}
			wordText, ok := MapField(annotation, "text").(string)
			if !ok {
				return nil, invalid()
			}
			start, err := geminiTranscriptOffset(MapField(annotation, "start_offset"))
			if err != nil {
				return nil, invalid()
			}
			end, err := geminiTranscriptOffset(MapField(annotation, "end_offset"))
			if err != nil {
				return nil, invalid()
			}
			transcript.Words = append(transcript.Words, &runtimev1.SpeechTranscriptWord{Text: wordText, StartSeconds: start, EndSeconds: end})
		}
	}
	// This dialect does not report language or explicit no_speech. Neither is
	// inferred from the submitted audio, request language or an empty response.
	if err := localexecution.ValidateSpeechTranscript(transcript, requireTiming); err != nil {
		return nil, invalid()
	}
	return transcript, nil
}

func geminiTranscriptOffset(value any) (float64, error) {
	offset, ok := value.(string)
	if !ok {
		return 0, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	duration := &durationpb.Duration{}
	if err := protojson.Unmarshal([]byte(strconv.Quote(offset)), duration); err != nil {
		return 0, err
	}
	return float64(duration.GetSeconds()) + float64(duration.GetNanos())/1e9, nil
}
