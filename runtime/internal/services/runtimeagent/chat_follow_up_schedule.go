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

	if _, err := s.cancelPublicChatFollowUpForAnchor(session.ConversationAnchorID, "superseded", true); err != nil {
		cancel()
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          chainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       reasonCodeFromError(err),
			Message:          strings.TrimSpace(err.Error()),
		}
	}

	s.chatSurfaceMu.Lock()
	if current := s.chatAnchors[session.ConversationAnchorID]; current != nil {
		current.PendingFollowUpID = followUpID
	}
	s.chatFollowUps[followUpID] = state
	s.chatSurfaceMu.Unlock()

	s.persistCurrentPublicChatSurfaceState()
	if err := s.emitPublicChatFollowUpHookEvents(session, turn, action,
		publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED},
		publicChatHookLifecycleTransition{state: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING},
	); err != nil {
		cancel()
		s.chatSurfaceMu.Lock()
		if current := s.chatAnchors[session.ConversationAnchorID]; current != nil && current.PendingFollowUpID == followUpID {
			current.PendingFollowUpID = ""
		}
		delete(s.chatFollowUps, followUpID)
		s.chatSurfaceMu.Unlock()
		s.persistCurrentPublicChatSurfaceState()
		return publicChatFollowUpOutcome{
			Status:           "rejected",
			ChainID:          chainID,
			FollowUpDepth:    nextDepth,
			MaxFollowUpTurns: maxTurns,
			SourceTurnID:     turn.TurnID,
			SourceActionID:   action.ActionID,
			ReasonCode:       reasonCodeFromError(err),
			Message:          strings.TrimSpace(err.Error()),
		}
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
