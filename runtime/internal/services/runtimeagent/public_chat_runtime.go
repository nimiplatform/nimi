package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
		req, err := decodePublicChatTurnRequestPayload(event.GetPayload())
		if err != nil {
			return err
		}
		return r.handleTurnRequest(ctx, event, req)
	case publicChatTurnInterruptType:
		req, err := decodePublicChatTurnInterruptPayload(event.GetPayload())
		if err != nil {
			return err
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
