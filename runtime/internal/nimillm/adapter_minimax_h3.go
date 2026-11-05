package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const AdapterMiniMaxH3Video = "minimax_h3_video_v2_adapter"
const miniMaxH3QueryPath = "/v2/query/video_generation/{task_id}"

func miniMaxMediaBaseURL(endpoint string) string {
	u, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || u.Host == "" {
		return ""
	}
	path := strings.TrimRight(u.EscapedPath(), "/")
	for _, suffix := range []string{"/v1", "/v2"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	u.RawPath = path
	u.Path, err = url.PathUnescape(path)
	if err != nil {
		return ""
	}
	return u.String()
}

// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-h3-video
func buildMiniMaxH3Payload(ctx context.Context, model string, spec *runtimev1.VideoGenerateScenarioSpec) (map[string]any, error) {
	content, err := cloudVideoNativeContent(ctx, spec)
	if err != nil {
		return nil, err
	}
	// H3 requires exactly one nonempty prompt item; preserve all canonical text
	// fragments through the existing prompt projection, then ordered media.
	parts := []map[string]any{{"type": "text", "text": capabilitydriver.VideoPrompt(spec)}}
	for _, part := range content {
		if part["type"] != "text" {
			parts = append(parts, part)
		}
	}
	o := spec.GetOptions()
	body := map[string]any{"model": model, "content": parts, "resolution": strings.ToUpper(o.GetResolution()), "duration": o.GetDurationSec()}
	if o.GetRatio() != "" {
		body["ratio"] = o.GetRatio()
	}
	if o.Watermark != nil {
		body["aigc_watermark"] = o.GetWatermark()
	}
	encoded, err := json.Marshal(body)
	if err != nil || len(encoded) > 64_000_000 {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	return body, nil
}

func ExecuteMiniMaxH3Video(ctx context.Context, cfg MediaAdapterConfig, req *runtimev1.SubmitScenarioJobRequest, model string) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	key, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}
	base := miniMaxMediaBaseURL(cfg.BaseURL)
	if base == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	body, err := buildMiniMaxH3Payload(ctx, model, req.GetSpec().GetVideoGenerate())
	if err != nil {
		return nil, nil, "", err
	}
	response := map[string]any{}
	if err := DoJSONRequestWithHeaders(nativeCreateRequest(originalControlRequest(ctx)), http.MethodPost, JoinURL(base, "/v2/video_generation"), key, body, &response, cfg.Headers); err != nil {
		return nil, nil, "", err
	}
	id, ok := response["task_id"].(string)
	if !ok || id == "" || strings.TrimSpace(id) != id || len(id) > 128 {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifact := BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterMiniMaxH3Video})
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterMiniMaxH3Video, TaskID: id, Model: model, QueryPathTemplate: miniMaxH3QueryPath, Artifact: artifact})
	return nil, nil, id, err
}

type miniMaxH3Task struct {
	id, model, status string
	data              map[string]any
}

func queryMiniMaxH3Task(ctx context.Context, cfg MediaAdapterConfig, id, model string) (*miniMaxH3Task, error) {
	key, keyErr := requireProviderAPIKey(cfg.APIKey)
	if keyErr != nil {
		return nil, keyErr
	}
	response := map[string]any{}
	path := ResolveTaskQueryPath(miniMaxH3QueryPath, id)
	if err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(miniMaxMediaBaseURL(cfg.BaseURL), path), key, nil, &response, cfg.Headers); err != nil {
		return nil, err
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	task, ok := response["task"].(map[string]any)
	if !ok {
		return nil, invalid
	}
	returnedID, idOK := task["id"].(string)
	status, statusOK := task["status"].(string)
	if !idOK || returnedID != id || !statusOK {
		return nil, invalid
	}
	rawModel, hasModel := task["model"]
	returnedModel, modelOK := rawModel.(string)
	if hasModel && (!modelOK || (model != "" && returnedModel != model)) {
		return nil, invalid
	}
	switch status {
	case "queued", "running", "cancelled", "failed", "succeeded":
	default:
		return nil, invalid
	}
	if status == "succeeded" && (!modelOK || !capabilitydriver.IsMiniMaxH3VideoModel(returnedModel)) {
		return nil, invalid
	}
	return &miniMaxH3Task{id: returnedID, model: returnedModel, status: status, data: task}, nil
}

func observeMiniMaxH3Video(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt) (*NativeTaskObservation, bool, error) {
	task, err := queryMiniMaxH3Task(ctx, cfg, r.TaskID, r.Model)
	if err != nil {
		return nil, false, err
	}
	switch task.status {
	case "queued", "running":
		return nil, false, nil
	case "cancelled":
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	case "failed":
		return nil, true, providerTaskFailedError(task.status, task.data)
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	content, ok := task.data["content"].(map[string]any)
	if !ok {
		return nil, false, invalid
	}
	location, ok := content["url"].(string)
	if !ok || !validNativeVideoArtifactURL(location) {
		return nil, false, invalid
	}
	if modality, exists := task.data["modality"]; exists && modality != "video" {
		return nil, false, invalid
	}
	if kind, exists := task.data["task_type"]; exists && kind != "generation" {
		return nil, false, invalid
	}
	artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = location
	artifact.MimeType = "video/mp4"
	artifact.DurationMs, artifact.Width, artifact.Height, artifact.Fps = 0, 0, 0, 0
	usage, err := miniMaxH3Usage(task.data["usage"])
	if err != nil {
		return nil, false, err
	}
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}, Usage: usage}, true, nil
}

func miniMaxH3Usage(raw any) (*runtimev1.UsageStats, error) {
	if raw == nil {
		return nil, nil
	}
	var values struct {
		Prompt     *int64 `json:"prompt_tokens"`
		Completion *int64 `json:"completion_tokens"`
		Total      *int64 `json:"total_tokens"`
	}
	bytes, err := json.Marshal(raw)
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	if err != nil || json.Unmarshal(bytes, &values) != nil {
		return nil, invalid
	}
	for _, v := range []*int64{values.Prompt, values.Completion, values.Total} {
		if v != nil && *v < 0 {
			return nil, invalid
		}
	}
	if values.Completion == nil {
		return nil, nil
	}
	if values.Prompt != nil {
		if values.Total != nil && (*values.Total < *values.Completion || *values.Total-*values.Completion != *values.Prompt) {
			return nil, invalid
		}
		return &runtimev1.UsageStats{InputTokens: *values.Prompt, OutputTokens: *values.Completion}, nil
	}
	if values.Total == nil {
		return nil, nil
	}
	if *values.Total < *values.Completion {
		return nil, invalid
	}
	return &runtimev1.UsageStats{InputTokens: *values.Total - *values.Completion, OutputTokens: *values.Completion}, nil
}

func CancelMiniMaxH3Task(ctx context.Context, receipt *NativeTaskReceipt, cfg MediaAdapterConfig) (ProviderTaskCleanupOutcome, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	id := receipt.TaskID
	task, err := queryMiniMaxH3Task(ctx, cfg, id, receipt.Model)
	if err != nil {
		return ProviderTaskCleanupFailed, err
	}
	if task.status == "running" {
		return ProviderTaskCleanupNotCancelable, nil
	}
	if task.status == "cancelled" {
		return ProviderTaskCleanupCanceled, nil
	}
	response := map[string]any{}
	err = DoJSONRequestWithHeaders(ctx, http.MethodDelete, JoinURL(miniMaxMediaBaseURL(cfg.BaseURL), "/v2/video_generation/"+url.PathEscape(id)), cfg.APIKey, nil, &response, cfg.Headers)
	if err != nil {
		// Queue consumption can race the cancellation. Observe once, never issue
		// a second mutation or infer a successful stop from a failed DELETE.
		current, queryErr := queryMiniMaxH3Task(ctx, cfg, id, receipt.Model)
		if queryErr == nil && current.status == "running" {
			return ProviderTaskCleanupNotCancelable, err
		}
		if queryErr == nil && current.status == "cancelled" {
			return ProviderTaskCleanupCanceled, nil
		}
		return ProviderTaskCleanupFailed, err
	}
	if response["task_id"] != id {
		return ProviderTaskCleanupUnconfirmed, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if response["action"] == "cancelled" && response["status"] == "cancelled" {
		return ProviderTaskCleanupCanceled, nil
	}
	if response["action"] == "deleted" && response["status"] == "deleted" {
		return ProviderTaskCleanupResourcesDeleted, nil
	}
	return ProviderTaskCleanupUnconfirmed, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
