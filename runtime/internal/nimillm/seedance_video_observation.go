package nimillm

import (
	"encoding/json"
	"log/slog"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.seedance-current-video
func observeSeedanceVideoResponse(receipt *NativeTaskReceipt, response map[string]any) (*NativeTaskObservation, bool, error) {
	invalid := func(stage string, details ...any) (*NativeTaskObservation, bool, error) {
		_, modelPresent := response["model"]
		errorFields, _ := response["error"].(map[string]any)
		attrs := []any{"stage", stage, "provider_task_id", providerDiagnosticID(receipt.TaskID), "id_matches", response["id"] == receipt.TaskID, "model_present", modelPresent, "model_matches", response["model"] == receipt.Model, "error_is_null", response["error"] == nil, "error_field_count", len(errorFields)}
		slog.Warn("Seedance video observation rejected", append(attrs, details...)...)
		return nil, false, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	id, _ := response["id"].(string)
	rawModel, hasModel := response["model"]
	model, modelString := rawModel.(string)
	if id != receipt.TaskID || (hasModel && (!modelString || model != receipt.Model)) {
		return invalid("identity")
	}
	status, _ := response["status"].(string)
	switch status {
	case "queued", "running":
		return nil, false, nil
	case "cancelled":
		return nil, true, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_TASK_CANCELED)
	case "expired":
		return nil, true, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TASK_EXPIRED)
	case "failed":
		return nil, true, providerTaskFailedError(status, response)
	case "succeeded":
	default:
		return invalid("status")
	}
	if model != receipt.Model || response["error"] != nil {
		return invalid("completed_model_or_error")
	}
	content, ok := response["content"].(map[string]any)
	if !ok {
		return invalid("content")
	}
	video, _ := content["video_url"].(string)
	if !validNativeVideoArtifactURL(video) {
		return invalid("video_url")
	}
	main := proto.Clone(receipt.Artifact).(*runtimev1.ScenarioArtifact)
	main.Uri, main.MimeType = video, "video/mp4"
	// The provider duration is an integer floor, not the measured container
	// duration. Leave unknown physical facts for the artifact/media consumer.
	main.DurationMs, main.Fps, main.Width, main.Height = 0, 0, 0, 0
	observation := &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{main}}
	if raw, exists := content["last_frame_url"]; exists {
		frame, ok := raw.(string)
		if !ok || !validNativeVideoArtifactURL(frame) {
			return invalid("last_frame_url")
		}
		last := proto.Clone(main).(*runtimev1.ScenarioArtifact)
		last.ArtifactId = main.ArtifactId + "-1"
		last.Uri, last.MimeType = frame, "image/jpeg"
		observation.Artifacts = append(observation.Artifacts, last)
	}
	if raw := response["usage"]; raw != nil {
		var usage struct {
			Completion *int64 `json:"completion_tokens"`
			Total      *int64 `json:"total_tokens"`
		}
		encoded, err := json.Marshal(raw)
		if err != nil || json.Unmarshal(encoded, &usage) != nil || (usage.Completion != nil && *usage.Completion < 0) || (usage.Total != nil && *usage.Total < 0) {
			return invalid("usage_shape")
		}
		if usage.Completion != nil && usage.Total != nil {
			if *usage.Completion != *usage.Total {
				return invalid("usage_total", "completion_tokens", *usage.Completion, "total_tokens", *usage.Total)
			}
			observation.Usage = &runtimev1.UsageStats{OutputTokens: *usage.Completion}
		}
	}
	return observation, true, nil
}

func validNativeVideoArtifactURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && raw == strings.TrimSpace(raw) && u.Host != "" && u.User == nil && (u.Scheme == "https" || u.Scheme == "http")
}
