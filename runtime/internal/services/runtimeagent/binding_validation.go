package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

const runtimeAgentEventReadScope = "runtime.agent.state.read"

func (s *Service) validateScopedBindingAttachment(attachment *runtimev1.ScopedRuntimeBindingAttachment, fallbackRuntimeAppID string, agentID string, requiredScope string) error {
	bindingID := strings.TrimSpace(attachment.GetBindingId())
	if attachment == nil || bindingID == "" {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	if s.bindingValidator == nil {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	}
	actual := relationFromAttachment(attachment, fallbackRuntimeAppID, agentID)
	if resolver, ok := s.bindingValidator.(scopedBindingRelationResolver); ok {
		actual = completeRelationFromCanonical(actual, resolver.ResolveScopedBindingRelation(bindingID))
	}
	if reason, ok := s.bindingValidator.ValidateScopedBinding(bindingID, actual, requiredScope); !ok {
		return runtimeAgentBindingError(reason)
	}
	return nil
}

func relationFromAttachment(attachment *runtimev1.ScopedRuntimeBindingAttachment, fallbackRuntimeAppID string, fallbackAgentID string) *runtimev1.ScopedAppBindingRelation {
	if attachment == nil {
		return nil
	}
	runtimeAppID := strings.TrimSpace(attachment.GetRuntimeAppId())
	if runtimeAppID == "" {
		runtimeAppID = strings.TrimSpace(fallbackRuntimeAppID)
	}
	agentID := strings.TrimSpace(attachment.GetAgentId())
	if agentID == "" {
		agentID = strings.TrimSpace(fallbackAgentID)
	}
	return &runtimev1.ScopedAppBindingRelation{
		RuntimeAppId:         runtimeAppID,
		AppInstanceId:        strings.TrimSpace(attachment.GetAppInstanceId()),
		WindowId:             strings.TrimSpace(attachment.GetWindowId()),
		AvatarInstanceId:     strings.TrimSpace(attachment.GetAvatarInstanceId()),
		AgentId:              agentID,
		ConversationAnchorId: strings.TrimSpace(attachment.GetConversationAnchorId()),
		WorldId:              strings.TrimSpace(attachment.GetWorldId()),
	}
}

func completeRelationFromCanonical(actual *runtimev1.ScopedAppBindingRelation, canonical *runtimev1.ScopedAppBindingRelation) *runtimev1.ScopedAppBindingRelation {
	if actual == nil || canonical == nil {
		return actual
	}
	out := proto.Clone(actual)
	completed, ok := out.(*runtimev1.ScopedAppBindingRelation)
	if !ok {
		return actual
	}
	if strings.TrimSpace(completed.GetRuntimeAppId()) == "" {
		completed.RuntimeAppId = strings.TrimSpace(canonical.GetRuntimeAppId())
	}
	if strings.TrimSpace(completed.GetAppInstanceId()) == "" {
		completed.AppInstanceId = strings.TrimSpace(canonical.GetAppInstanceId())
	}
	if strings.TrimSpace(completed.GetWindowId()) == "" {
		completed.WindowId = strings.TrimSpace(canonical.GetWindowId())
	}
	if strings.TrimSpace(completed.GetAvatarInstanceId()) == "" {
		completed.AvatarInstanceId = strings.TrimSpace(canonical.GetAvatarInstanceId())
	}
	if strings.TrimSpace(completed.GetAgentId()) == "" {
		completed.AgentId = strings.TrimSpace(canonical.GetAgentId())
	}
	if strings.TrimSpace(completed.GetConversationAnchorId()) == "" {
		completed.ConversationAnchorId = strings.TrimSpace(canonical.GetConversationAnchorId())
	}
	if strings.TrimSpace(completed.GetWorldId()) == "" {
		completed.WorldId = strings.TrimSpace(canonical.GetWorldId())
	}
	return completed
}

func scopedBindingAttachmentConversationAnchorMismatches(attachment *runtimev1.ScopedRuntimeBindingAttachment, anchorID string) bool {
	attached := strings.TrimSpace(attachment.GetConversationAnchorId())
	return attached != "" && attached != strings.TrimSpace(anchorID)
}

func scopedBindingAttachmentFromIncomingMetadata(ctx context.Context) *runtimev1.ScopedRuntimeBindingAttachment {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil
	}
	bindingID := firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-id")
	if bindingID == "" {
		return nil
	}
	return &runtimev1.ScopedRuntimeBindingAttachment{
		BindingId:            bindingID,
		BindingHandle:        firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-handle"),
		RuntimeAppId:         firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-runtime-app-id"),
		AppInstanceId:        firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-app-instance-id"),
		WindowId:             firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-window-id"),
		AvatarInstanceId:     firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-avatar-instance-id"),
		AgentId:              firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-agent-id"),
		ConversationAnchorId: firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-conversation-anchor-id"),
		WorldId:              firstIncomingMetadataText(md, "x-nimi-runtime-scoped-binding-world-id"),
	}
}

func firstIncomingMetadataText(md metadata.MD, key string) string {
	for _, value := range md.Get(key) {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func runtimeAgentBindingError(reason runtimev1.AccountReasonCode) error {
	code := codes.PermissionDenied
	if reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND {
		code = codes.InvalidArgument
	}
	return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
		ActionHint: "attach_active_scoped_runtime_binding",
		Metadata: map[string]string{
			"account_reason_code": reason.String(),
		},
	})
}

func cloneScopedBindingAttachment(input *runtimev1.ScopedRuntimeBindingAttachment) *runtimev1.ScopedRuntimeBindingAttachment {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScopedRuntimeBindingAttachment)
	if !ok {
		return nil
	}
	return out
}
