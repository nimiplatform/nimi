package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type publicChatRuntime struct {
	svc *Service
}

func (s *Service) publicChatRuntime() publicChatRuntime {
	return publicChatRuntime{svc: s}
}
func (r publicChatRuntime) consumeAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	if r.svc == nil || r.svc.isClosed() {
		return status.Error(codes.FailedPrecondition, "runtime public chat surface unavailable")
	}
	if event == nil {
		return status.Error(codes.InvalidArgument, "public chat app message is required")
	}
	if strings.TrimSpace(event.GetToAppId()) != publicChatRuntimeAppID {
		return status.Error(codes.InvalidArgument, "public chat app message target invalid")
	}
	switch strings.TrimSpace(event.GetMessageType()) {
	case publicChatTurnRequestType:
		payload := event.GetPayload()
		if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
			if decision.Operation != accountservice.LocalAppOperationSendConversationTurn || payload == nil {
				return status.Error(codes.PermissionDenied, "local-app turn selector is invalid")
			}
			localAgentRef := strings.TrimSpace(payload.GetFields()["local_agent_ref"].GetStringValue())
			entry, entryErr := r.svc.agentByID(localAgentRef)
			if entryErr != nil {
				return entryErr
			}
			if entry == nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != decision.AccountID {
				return status.Error(codes.PermissionDenied, "turn Agent is not owned by the current account")
			}
			cloned, cloneOK := proto.Clone(payload).(*structpb.Struct)
			if !cloneOK {
				return status.Error(codes.InvalidArgument, "public chat turn payload invalid")
			}
			cloned.Fields["owner_user_id"] = structpb.NewStringValue(entry.Agent.GetOwnerUserId())
			cloned.Fields["runtime_source_ref"] = structpb.NewStringValue(entry.Agent.GetRuntimeSourceRef())
			payload = cloned
		}
		req, err := decodePublicChatTurnRequestPayload(payload)
		if err != nil {
			return err
		}
		if _, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
			if err := r.svc.ValidateLocalAppConversationScope(ctx, req.LocalAgentRef, req.ConversationAnchorID); err != nil {
				return err
			}
		}
		return r.handleTurnRequest(ctx, event, req)
	case publicChatTurnInterruptType:
		req, err := decodePublicChatTurnInterruptPayload(event.GetPayload())
		if err != nil {
			return err
		}
		if decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
			if decision.Operation != accountservice.LocalAppOperationInterruptConversation {
				return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			if err := r.svc.ValidateLocalAppConversationScope(ctx, decision.LocalAgentID, req.ConversationAnchorID); err != nil {
				return err
			}
		}
		return r.handleTurnInterrupt(event, req)
	default:
		return status.Error(codes.InvalidArgument, "public chat app message type invalid")
	}
}

// reserveTurn binds a new turn to an existing ConversationAnchor. Per
// K-AGCORE-034/K-AGCORE-035 runtime MUST NOT implicitly create anchors from
// turn requests; `OpenConversationAnchor` is the only admitted anchor-open
// seam. An unknown `conversation_anchor_id` fails-closed with NotFound.
// lookupTurnForInterrupt resolves the anchor+turn pair targeted by an
// interrupt. Per K-AGCORE-035 interrupt semantics are anchor-scoped; only
// turns under the referenced `conversation_anchor_id` are candidates.
