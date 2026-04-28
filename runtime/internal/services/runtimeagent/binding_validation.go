package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const runtimeAgentEventReadScope = "runtime.agent.state.read"

func (s *Service) validateScopedBindingAttachment(attachment *runtimev1.ScopedRuntimeBindingAttachment, fallbackRuntimeAppID string, agentID string, requiredScope string) error {
	if attachment == nil || strings.TrimSpace(attachment.GetBindingId()) == "" {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	if s.bindingValidator == nil {
		return runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CUSTODY_UNAVAILABLE)
	}
	actual := relationFromAttachment(attachment, fallbackRuntimeAppID, agentID)
	if reason, ok := s.bindingValidator.ValidateScopedBinding(strings.TrimSpace(attachment.GetBindingId()), actual, requiredScope); !ok {
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
