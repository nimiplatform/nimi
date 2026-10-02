package nimillm

import (
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-stored-voice
func ExecuteGeminiTTSInteractions(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	spec := scenarioSpeechSynthesizeSpec(req)
	if model != geminiVoiceDesignModel || spec == nil || spec.GetVoiceRef().GetKind() != runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF || !geminiStoredVoiceIDValid(spec.GetVoiceRef().GetProviderVoiceRef()) || strings.TrimSpace(spec.GetText()) == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	speech := map[string]any{"voice": spec.GetVoiceRef().GetProviderVoiceRef()}
	if spec.GetLanguage() != "" {
		speech["language"] = spec.GetLanguage()
	}
	payload := map[string]any{"model": model, "store": false,
		"input":             []map[string]any{{"type": "user_input", "content": []map[string]any{{"type": "text", "text": spec.GetText()}}}},
		"response_format":   map[string]any{"type": "audio"},
		"generation_config": map[string]any{"speech_config": []map[string]any{speech}},
	}
	response := map[string]any{}
	ctx = withProviderParameterObserver(ctx, func(status int, fields []string) {
		slog.Warn("Gemini stored voice synthesis request rejected", "http_status", status, "mentioned_fields", fields)
	})
	if err := geminiVoiceRequest(ctx, cfg, http.MethodPost, "/interactions", payload, &response); err != nil {
		return nil, nil, "", err
	}
	invalid := func() ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	steps, ok := response["steps"].([]any)
	if response["status"] != "completed" || !ok || len(steps) != 1 || MapField(steps[0], "type") != "model_output" {
		return invalid()
	}
	content, ok := MapField(steps[0], "content").([]any)
	if !ok || len(content) != 1 || MapField(content[0], "type") != "audio" || MapField(content[0], "mime_type") != "audio/wav" {
		return invalid()
	}
	encoded := ValueAsString(MapField(content[0], "data"))
	if encoded == "" || len(encoded) > maxGeminiTTSAudioBase64Bytes {
		return invalid()
	}
	audio, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return invalid()
	}
	rate, duration, err := finiteASRWAVInfo(audio)
	if err != nil || rate != 24000 || duration <= 0 || !geminiWAVPCM16(audio) {
		return invalid()
	}
	usage, err := geminiInteractionUsage(response["usage"])
	if err != nil {
		return invalid()
	}
	artifact := BinaryArtifact("audio/wav", audio, nil)
	artifact.SampleRateHz = 24000
	artifact.DurationMs = int64(duration * 1000)
	return []*runtimev1.ScenarioArtifact{artifact}, usage, "", nil
}
