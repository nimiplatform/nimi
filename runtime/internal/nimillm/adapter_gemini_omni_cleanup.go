package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Exact resource outcomes carry no credentials, provider handles or content.
type GeminiOmniResourceCleanup struct {
	FileState        string
	InteractionState string
	ReasonCode       runtimev1.ReasonCode
}

func (r GeminiOmniResourceCleanup) Complete() bool {
	removed := func(value string) bool { return value == "deleted" || value == "absent" }
	return removed(r.FileState) && removed(r.InteractionState)
}

func (r GeminiOmniResourceCleanup) Outcome() ProviderTaskCleanupOutcome {
	if r.Complete() {
		return ProviderTaskCleanupResourcesDeleted
	}
	if r.FileState == "failed" || r.InteractionState == "failed" {
		return ProviderTaskCleanupFailed
	}
	return ProviderTaskCleanupUnconfirmed
}

func reportGeminiOmniResourceCleanup(ctx context.Context, result GeminiOmniResourceCleanup) {
	if observe, ok := ctx.Value(providerTaskCleanupObserverKey{}).(func(ProviderTaskCleanupObservation)); ok && observe != nil {
		observe(ProviderTaskCleanupObservation{Outcome: result.Outcome(), ReasonCode: result.ReasonCode, GeminiResources: &result})
	}
}

func validGeminiInteractionID(id string) bool {
	return len(id) > 0 && len(id) <= 1024 && id != "." && id != ".." && !strings.ContainsAny(id, "/\\?#") && !strings.ContainsFunc(id, func(r rune) bool { return unicode.IsControl(r) || unicode.IsSpace(r) })
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-omni-video
// Deletion only observes these original handles; it is not proof that model
// computation or billing was canceled. A failed resource does not skip the other.
func CleanupGeminiOmniResources(ctx context.Context, cfg MediaAdapterConfig, receipt *NativeTaskReceipt) GeminiOmniResourceCleanup {
	result := GeminiOmniResourceCleanup{FileState: "unconfirmed", InteractionState: "unconfirmed", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	if receipt == nil || receipt.Adapter != AdapterGeminiOmniVideo || ValidateNativeTaskReceipt(receipt) != nil {
		result.ReasonCode = runtimev1.ReasonCode_AI_OUTPUT_INVALID
		return result
	}
	return cleanupGeminiOmniHandles(ctx, cfg, receipt.TaskID, receipt.GeminiInteractionID)
}

func cleanupGeminiOmniHandles(ctx context.Context, cfg MediaAdapterConfig, fileID, interactionID string) GeminiOmniResourceCleanup {
	result := GeminiOmniResourceCleanup{FileState: "unconfirmed", InteractionState: "unconfirmed", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	remove := func(path string) string {
		attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		err := geminiNativeRequest(attempt, cfg, http.MethodDelete, path, nil, nil)
		if err == nil {
			return "deleted"
		}
		if status.Code(err) == codes.NotFound {
			return "absent"
		}
		result.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		if reason, ok := grpcerr.ExtractReasonCode(err); ok {
			result.ReasonCode = reason
		}
		return "failed"
	}
	if fileID != "" {
		result.FileState = remove("/files/" + url.PathEscape(fileID))
	}
	if interactionID != "" {
		result.InteractionState = remove("/interactions/" + url.PathEscape(interactionID))
	}
	return result
}

// A malformed creation result may still expose a valid original Interaction.
// Retain no guessed identities and never enumerate the account to find one.
func cleanupRejectedGeminiOmniCreation(ctx context.Context, cfg MediaAdapterConfig, response map[string]any, model string) {
	interaction, _ := response["id"].(string)
	fileID := ""
	if response["model"] != model || response["object"] != "interaction" || !validGeminiInteractionID(interaction) {
		interaction = ""
	} else {
		count := 0
		steps, _ := response["steps"].([]any)
		for _, raw := range steps {
			step, _ := raw.(map[string]any)
			if step["type"] != "model_output" {
				continue
			}
			parts, _ := step["content"].([]any)
			for _, rawPart := range parts {
				part, _ := rawPart.(map[string]any)
				uri, _ := part["uri"].(string)
				if part["type"] == "video" && validGeminiVideoArtifactURL(uri) {
					count++
					fileID = strings.TrimSuffix(strings.TrimPrefix(uri, "https://generativelanguage.googleapis.com/v1beta/files/"), ":download?alt=media")
				}
			}
		}
		if count != 1 {
			fileID = ""
		}
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	result := cleanupGeminiOmniHandles(cleanup, cfg, fileID, interaction)
	if !result.Complete() && result.ReasonCode == runtimev1.ReasonCode_ACTION_EXECUTED {
		result.ReasonCode = runtimev1.ReasonCode_AI_OUTPUT_INVALID
	}
	reportGeminiOmniResourceCleanup(ctx, result)
}
