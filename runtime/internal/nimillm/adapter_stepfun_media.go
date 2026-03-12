package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterStepFunNative = "stepfun_native_adapter"

// ExecuteStepFunMedia executes a TTS or image scenario job against the StepFun API.
func ExecuteStepFunMedia(
	ctx context.Context,
	cfg MediaAdapterConfig,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.stepfun.ai/v1"
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_TTS:
		return executeStepFunTTS(ctx, baseURL, apiKey, req, modelResolved)
	case runtimev1.Modal_MODAL_IMAGE:
		return executeStepFunImage(ctx, baseURL, apiKey, req, modelResolved)
	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func executeStepFunTTS(
	ctx context.Context,
	baseURL, apiKey string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	spec := scenarioSpeechSynthesizeSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	payload := map[string]any{
		"model": StripProviderModelPrefix(modelResolved, "stepfun"),
		"input": strings.TrimSpace(spec.GetText()),
	}
	if voiceRef != "" {
		payload["voice"] = voiceRef
	}
	if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
		payload["response_format"] = audioFormat
	}
	if speed := spec.GetSpeed(); speed > 0 {
		payload["speed"] = speed
	}

	endpoint := "/audio/speech"
	body, err := DoJSONOrBinaryRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, nil)
	if err != nil {
		return nil, nil, "", err
	}
	artifactBytes, mimeType := ExtractSpeechArtifactFromResponseBody(body)
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "audio/") {
		mimeType = ResolveSpeechArtifactMIME(spec, artifactBytes)
	}
	artifact := BinaryArtifact(mimeType, artifactBytes, map[string]any{
		"adapter":  AdapterStepFunNative,
		"endpoint": endpoint,
		"voice":    voiceRef,
	})
	ApplySpeechSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetText(), artifactBytes, 120), "", nil
}

func executeStepFunImage(
	ctx context.Context,
	baseURL, apiKey string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	payload := map[string]any{
		"model":  StripProviderModelPrefix(modelResolved, "stepfun"),
		"prompt": strings.TrimSpace(spec.GetPrompt()),
	}
	if negPrompt := strings.TrimSpace(spec.GetNegativePrompt()); negPrompt != "" {
		payload["negative_prompt"] = negPrompt
	}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		payload["size"] = size
	}
	if n := spec.GetN(); n > 0 {
		payload["n"] = n
	}

	endpoint := "/images/generations"
	resp := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, endpoint), apiKey, payload, &resp); err != nil {
		return nil, nil, "", err
	}
	artifactBytes, mimeType, artifactURI := ExtractTaskArtifactBytesAndMIME(resp)
	if len(artifactBytes) == 0 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if mimeType == "" {
		mimeType = ResolveImageArtifactMIME(spec, artifactBytes)
	}
	artifactMeta := map[string]any{
		"adapter":  AdapterStepFunNative,
		"endpoint": endpoint,
		"prompt":   strings.TrimSpace(spec.GetPrompt()),
	}
	if artifactURI != "" {
		artifactMeta["uri"] = artifactURI
	}
	artifact := BinaryArtifact(mimeType, artifactBytes, artifactMeta)
	ApplyImageSpecMetadata(artifact, spec)
	return []*runtimev1.ScenarioArtifact{artifact}, ArtifactUsage(spec.GetPrompt(), artifactBytes, 180), "", nil
}
