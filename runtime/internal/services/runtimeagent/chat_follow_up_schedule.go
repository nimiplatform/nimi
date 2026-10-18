package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
)

func (s *Service) schedulePublicChatFollowUp(
	session publicChatAnchorState,
	turn publicChatTurnState,
	_ publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatFollowUpOutcome {
	action := firstPublicChatFollowUpAction(structured)
	if action == nil {
		return publicChatFollowUpOutcome{Status: "skipped"}
	}
	nextDepth := turn.FollowUpDepth + 1
	maxTurns := turn.MaxFollowUpTurns
	if maxTurns <= 0 {
		maxTurns = publicChatMaxFollowUpTurns
	}
	if nextDepth > maxTurns {
		emitErr := s.emitPublicChatFollowUpHookEvents(session, turn, action,
			publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED},
			publicChatHookLifecycleTransition{
				state:      runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
				reasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				message:    "follow-up chain cap reached",
			},
		)
		message := "follow-up chain cap reached"
		if emitErr != nil {
			message = strings.TrimSpace(emitErr.Error())
		}
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          turn.ChainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			Message:          message,
		}
	}
	if action.PromptPayload.TriggerFamily == "event" {
		message := "event hook trigger requires host-owned event detector admission"
		emitErr := s.emitPublicChatFollowUpHookEvents(session, turn, action,
			publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED},
			publicChatHookLifecycleTransition{
				state:      runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
				reasonCode: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
				message:    message,
			},
		)
		if emitErr != nil {
			message = strings.TrimSpace(emitErr.Error())
		}
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          turn.ChainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			Message:          message,
		}
	}
	pendingIntent, err := publicChatFollowUpHookIntent(session, turn, action, runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING)
	if err != nil {
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          turn.ChainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       reasonCodeFromError(err),
			Message:          strings.TrimSpace(err.Error()),
		}
	}
	followUpID := "agent_followup_" + ulid.Make().String()
	chainID := strings.TrimSpace(turn.ChainID)
	if chainID == "" {
		chainID = "agent_followup_chain_" + ulid.Make().String()
	}
	scheduledFor := publicChatFollowUpScheduledFor(time.Now().UTC(), action)
	ctx, cancel := context.WithCancel(context.Background())
	state := &publicChatFollowUpState{
		FollowUpID:           followUpID,
		Revision:             1,
		ConversationAnchorID: session.ConversationAnchorID,
		AgentID:              session.AgentID,
		CallerAppID:          session.CallerAppID,
		SubjectUserID:        session.SubjectUserID,
		ThreadID:             session.ThreadID,
		Instruction:          strings.TrimSpace(action.PromptPayload.PromptText),
		ScheduledFor:         scheduledFor,
		ChainID:              chainID,
		FollowUpDepth:        nextDepth,
		MaxFollowUpTurns:     maxTurns,
		SourceTurnID:         turn.TurnID,
		SourceActionID:       action.ActionID,
		Context:              ctx,
		Cancel:               cancel,
		HookIntent:           pendingIntent,
	}

	s.chatSurfaceMu.Lock()
	current := s.chatAnchors[session.ConversationAnchorID]
	live := s.chatTurns[turn.TurnID]
	if current == nil || !current.FollowUpEnabled || current.ActiveTurnID != turn.TurnID || live == nil || live.Interrupted || s.agentTerminationFencedLocked(session.LocalAgentRef) {
		s.chatSurfaceMu.Unlock()
		cancel()
		return publicChatFollowUpOutcome{Status: "rejected", SourceTurnID: turn.TurnID, SourceActionID: action.ActionID, ReasonCode: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, Message: "Follow-up conversation is disabled or the originating turn is no longer active."}
	}
	oldID := current.PendingFollowUpID
	old := s.chatFollowUps[oldID]
	version := s.chatSurfaceVersion
	delete(s.chatFollowUps, oldID)
	current.PendingFollowUpID = followUpID
	s.chatFollowUps[followUpID] = state
	if err := s.persistPublicChatSurfaceStateLocked(session.ConversationAnchorID); err != nil {
		current.PendingFollowUpID = oldID
		delete(s.chatFollowUps, followUpID)
		if old != nil {
			s.chatFollowUps[oldID] = old
		}
		s.chatSurfaceVersion = version
		s.chatSurfaceMu.Unlock()
		cancel()
		return publicChatFollowUpOutcome{Status: "rejected", SourceTurnID: turn.TurnID, SourceActionID: action.ActionID, ReasonCode: reasonCodeFromError(err), Message: "The follow-up could not be saved."}
	}
	s.chatSurfaceMu.Unlock()
	if old != nil && old.Cancel != nil {
		old.Cancel()
	}
	if err := s.emitPublicChatFollowUpHookEvents(session, turn, action,
		publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED},
		publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING}); err != nil && s.logger != nil {
		s.logger.Warn("publish saved follow-up event failed", "follow_up_id", followUpID, "error", err)
	}
	s.armPublicChatFollowUp(state)
	return publicChatFollowUpOutcome{
		Status:           "scheduled",
		FollowUpID:       followUpID,
		ChainID:          chainID,
		ScheduledFor:     scheduledFor.Format(time.RFC3339Nano),
		FollowUpDepth:    nextDepth,
		MaxFollowUpTurns: maxTurns,
		SourceTurnID:     turn.TurnID,
		SourceActionID:   action.ActionID,
	}
}

func publicChatFollowUpScheduledFor(now time.Time, action *publicChatStructuredAction) time.Time {
	if action == nil {
		return now
	}
	if action.PromptPayload.TriggerFamily == "event" {
		if action.PromptPayload.TriggerEvent == "user-idle" && action.PromptPayload.IdleMs > 0 {
			return now.Add(time.Duration(action.PromptPayload.IdleMs) * time.Millisecond)
		}
		return now
	}
	return now.Add(time.Duration(action.PromptPayload.DelayMs) * time.Millisecond)
}
