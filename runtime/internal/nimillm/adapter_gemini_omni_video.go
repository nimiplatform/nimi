package nimillm

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterGeminiOmniVideo = "gemini_omni_video_adapter"

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-omni-video
// URI delivery temporarily stores an Interaction and its generated file.
// Both exact handles stay in the private receipt for custody and cleanup.
func ExecuteGeminiOmniVideo(ctx context.Context, cfg MediaAdapterConfig, request *runtimev1.SubmitScenarioJobRequest, model string) (MediaExecutionResult, error) {
	ctx = originalControlRequest(mediaAdapterEndpointPolicyContext(ctx, cfg))
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return MediaExecutionResult{}, err
	}
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return MediaExecutionResult{}, err
	}
	spec := request.GetSpec().GetVideoGenerate()
	task := "text_to_video"
	switch spec.GetMode() {
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME:
		task = "image_to_video"
	case runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST:
		task = "image_to_video"
	case runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE:
		task = "reference_to_video"
	}
	input, err := geminiOmniImageParts(ctx, spec)
	if err != nil {
		return MediaExecutionResult{}, err
	}
	input = append(input, map[string]any{"type": "text", "text": capabilitydriver.VideoPrompt(spec)})
	output := map[string]any{"type": "video", "delivery": "uri"}
	if ratio := spec.GetOptions().GetRatio(); ratio != "" {
		output["aspect_ratio"] = ratio
	}
	if resolution := spec.GetOptions().GetResolution(); resolution != "" {
		output["resolution"] = resolution
	}
	if options := spec.GetOptions(); options != nil && options.DurationSec != nil {
		output["duration"] = strconv.Itoa(int(options.GetDurationSec())) + "s"
	}
	payload := map[string]any{"model": model, "input": input, "response_format": output,
		"store": true, "stream": false, "background": false,
		"generation_config": map[string]any{"video_config": map[string]any{"task": task}}}
	response := map[string]any{}
	baseURL := resolveGeminiNativeBaseURL(cfg.BaseURL)
	if err := DoJSONRequestWithHeaders(nativeCreateRequest(ctx), http.MethodPost, JoinURL(baseURL, "/interactions"), "", payload, &response, map[string]string{"x-goog-api-key": key}); err != nil {
		if IsNativeCreateResponseUnavailable(err) {
			reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			if typed, ok := grpcerr.ExtractReasonCode(err); ok {
				reason = typed
			}
			reportGeminiOmniResourceCleanup(ctx, GeminiOmniResourceCleanup{FileState: "unconfirmed", InteractionState: "unconfirmed", ReasonCode: reason})
		}
		return MediaExecutionResult{}, err
	}
	receipt, err := geminiOmniVideoResult(response, model)
	if err != nil {
		cleanupRejectedGeminiOmniCreation(ctx, cfg, response, model)
		return MediaExecutionResult{}, err
	}
	_, err = publishNativeTask(ctx, receipt)
	return MediaExecutionResult{ProviderJobID: receipt.TaskID}, err
}

func geminiOmniVideoResult(response map[string]any, model string) (*NativeTaskReceipt, error) {
	invalid := func() (*NativeTaskReceipt, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	interaction, ok := response["id"].(string)
	if !ok || !validGeminiInteractionID(interaction) || response["status"] != "completed" || response["model"] != model || response["object"] != "interaction" {
		return invalid()
	}
	steps, ok := response["steps"].([]any)
	if !ok {
		return invalid()
	}
	fileID := ""
	for _, raw := range steps {
		step, ok := raw.(map[string]any)
		if !ok {
			return invalid()
		}
		if step["type"] == "user_input" || step["type"] == "thought" {
			continue
		}
		if step["type"] != "model_output" {
			return invalid()
		}
		content, ok := step["content"].([]any)
		if !ok || len(content) != 1 || fileID != "" {
			return invalid()
		}
		part, ok := content[0].(map[string]any)
		if !ok || part["type"] != "video" || part["mime_type"] != "video/mp4" || part["data"] != nil {
			return invalid()
		}
		uri, ok := part["uri"].(string)
		if !ok || !validGeminiVideoArtifactURL(uri) {
			return invalid()
		}
		fileID = strings.TrimSuffix(strings.TrimPrefix(uri, "https://generativelanguage.googleapis.com/v1beta/files/"), ":download?alt=media")
	}
	if fileID == "" {
		return invalid()
	}
	usage, err := geminiInteractionUsage(response["usage"])
	if err != nil {
		return invalid()
	}
	return &NativeTaskReceipt{Version: 1, Adapter: AdapterGeminiOmniVideo, TaskID: fileID, Model: model, QueryPathTemplate: "/files/{task_id}",
		Artifact: BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterGeminiOmniVideo}), GeminiInteractionID: interaction, Usage: usage}, nil
}

func observeGeminiOmniVideo(ctx context.Context, cfg MediaAdapterConfig, receipt *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	uri := "https://generativelanguage.googleapis.com/v1beta/files/" + receipt.TaskID + ":download?alt=media"
	if receipt.Model != capabilitydriver.GeminiOmniVideoModel || !validGeminiVideoArtifactURL(uri) {
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(resolveGeminiNativeBaseURL(cfg.BaseURL), "/files/"+receipt.TaskID), "", nil, &response, map[string]string{"x-goog-api-key": cfg.APIKey}); err != nil {
		return nil, false, err
	}
	if response["name"] != "files/"+receipt.TaskID {
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	switch response["state"] {
	case "PROCESSING":
		return nil, false, nil
	case "FAILED":
		return nil, true, providerTaskFailedError("failed", response)
	case "ACTIVE":
		if response["mimeType"] != "video/mp4" {
			return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		artifact := proto.Clone(receipt.Artifact).(*runtimev1.ScenarioArtifact)
		artifact.Uri = uri
		result := &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}
		if receipt.Usage != nil {
			result.Usage = proto.Clone(receipt.Usage).(*runtimev1.UsageStats)
		}
		return result, true, nil
	default:
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
}
