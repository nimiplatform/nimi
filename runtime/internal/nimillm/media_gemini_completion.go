package nimillm

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
func geminiMediaBlock(response map[string]any) error {
	blocked := func(reason string) bool {
		switch reason {
		case "SAFETY", "RECITATION", "AUDIO_RECITATION", "IMAGE_SAFETY", "IMAGE_RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MODEL_ARMOR":
			return true
		}
		return false
	}
	if blocked(ValueAsString(MapField(response["promptFeedback"], "blockReason"))) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	if candidates, ok := response["candidates"].([]any); ok && len(candidates) == 1 && blocked(ValueAsString(MapField(candidates[0], "finishReason"))) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r051
// geminiCompletedCandidateParts requires the provider's terminal success before
// accepting media bytes. A valid image/audio container can still be a partial
// result when generation ended at its token limit or was blocked.
func geminiCompletedCandidateParts(value any) ([]any, bool) {
	candidates, ok := value.([]any)
	if !ok || len(candidates) != 1 || ValueAsString(MapField(candidates[0], "finishReason")) != "STOP" {
		return nil, false
	}
	parts, ok := MapField(MapField(candidates[0], "content"), "parts").([]any)
	return parts, ok
}
