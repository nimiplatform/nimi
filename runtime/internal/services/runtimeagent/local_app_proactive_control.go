package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.agent-participation.proactive-controls
func (s *Service) localAppConversationStateLocked(anchor *publicChatAnchorState) *runtimev1.LocalAppConversationState {
	result := &runtimev1.LocalAppConversationState{FreeContactEnabled: anchor.EffectiveFreeContactEnabled, MaxFollowUpTurns: publicChatMaxFollowUpTurns}
	if anchor.ActiveTurnID != "" {
		id := anchor.ActiveTurnID
		result.TextTurnId = &id
	}
	if pending := s.chatFollowUps[anchor.PendingFollowUpID]; pending != nil {
		result.PendingFollowUp = &runtimev1.LocalAppConversationFollowUp{TaskId: pending.FollowUpID, Revision: pending.Revision, ScheduledFor: timestamppb.New(pending.ScheduledFor), SourceTurnId: pending.SourceTurnID}
	}
	return result
}

func proactiveControlOwnerFailure(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := grpcerr.ExtractReasonCode(err); ok {
		return err
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE, err, grpcerr.ReasonOptions{Message: "The continuation could not be canceled; its prior state is kept."})
}

func (s *Service) commitConversationControl(ctx context.Context, resolved localAppAgentIdentity, ingress localappop.Ingress, anchorID string, mutate func(*publicChatAnchorState) (func(), error)) (*runtimev1.LocalAppConversationState, error) {
	s.localAppConversationPublishMu.Lock()
	defer s.localAppConversationPublishMu.Unlock()
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[anchorID]
	if anchor == nil || anchor.Status == runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_CLOSED || s.agentTerminationFencedLocked(anchor.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		return nil, localAppConversationOwnerUnavailable()
	}
	before := *anchor
	oldPending := s.chatFollowUps[anchor.PendingFollowUpID]
	version := s.chatSurfaceVersion
	post, err := mutate(anchor)
	if err != nil {
		s.chatSurfaceMu.Unlock()
		return nil, err
	}
	anchor.LocalAppSequence++
	if anchor.LocalAppSequence == 0 {
		err = localAppConversationOwnerUnavailable()
	} else {
		err = s.persistLocalAppConversationCommitLocked(ctx, ingress, resolved.decision, anchorID)
	}
	if err != nil {
		delete(s.chatFollowUps, anchor.PendingFollowUpID)
		*anchor = before
		if oldPending != nil {
			s.chatFollowUps[before.PendingFollowUpID] = oldPending
		}
		s.chatSurfaceVersion = version
		s.chatSurfaceMu.Unlock()
		return nil, proactiveControlOwnerFailure(err)
	}
	state := s.localAppConversationStateLocked(anchor)
	event := &runtimev1.LocalAppConversationEvent{ConversationAnchorId: anchorID, Sequence: anchor.LocalAppSequence, Event: &runtimev1.LocalAppConversationEvent_StateChanged{StateChanged: state}}
	accountID := anchor.SubjectUserID
	s.chatSurfaceMu.Unlock()
	s.broadcastLocalAppConversationEvents(accountID, anchorID, []*runtimev1.LocalAppConversationEvent{event})
	if post != nil {
		post()
	}
	return state, nil
}

func (s *Service) CancelLocalAppConversationFollowUp(ctx context.Context, req *runtimev1.CancelLocalAppConversationFollowUpRequest) (*runtimev1.CancelLocalAppConversationFollowUpResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 || req.ExpectedRevision == 0 {
		return nil, localAppConversationInvalid("invalid follow-up cancellation")
	}
	resolved, _, err := s.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationConversationFollowUpCancel, req.AgentHandle)
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.ConversationAnchorId)
	if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
		return nil, err
	}
	state, err := s.commitConversationControl(ctx, resolved, localappop.IngressConversationFollowUpCancel, anchorID, func(anchor *publicChatAnchorState) (func(), error) {
		pending := s.chatFollowUps[anchor.PendingFollowUpID]
		if pending == nil || pending.FollowUpID != req.TaskId {
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "The continuation is no longer pending; it was not canceled."})
		}
		if pending.Revision != req.ExpectedRevision {
			return nil, grpcerr.WithReasonCodeOptions(codes.Aborted, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE, grpcerr.ReasonOptions{Message: "The continuation changed; refresh before canceling."})
		}
		delete(s.chatFollowUps, pending.FollowUpID)
		anchor.PendingFollowUpID = ""
		return func() {
			if pending.Cancel != nil {
				pending.Cancel()
			}
		}, nil
	})
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelLocalAppConversationFollowUpResponse{State: state}, nil
}
