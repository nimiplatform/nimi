package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) cancelPublicChatFollowUpForAnchor(anchorID string, reason string, emit bool) (*publicChatFollowUpState, error) {
	s.chatSurfaceMu.Lock()
	session := s.chatAnchors[strings.TrimSpace(anchorID)]
	if session == nil || strings.TrimSpace(session.PendingFollowUpID) == "" {
		s.chatSurfaceMu.Unlock()
		return nil, nil
	}
	followUpID := session.PendingFollowUpID
	followUp := s.chatFollowUps[followUpID]
	delete(s.chatFollowUps, followUpID)
	session.PendingFollowUpID = ""
	s.chatSurfaceMu.Unlock()
	if followUp != nil && followUp.Cancel != nil {
		followUp.Cancel()
	}
	s.persistCurrentPublicChatSurfaceState()
	if emit && followUp != nil {
		if err := s.emitPublicChatFollowUpCanceled(*followUp, reason, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "", ""); err != nil {
			return followUp, err
		}
	}
	return followUp, nil
}

func (s *Service) cancelPublicChatFollowUpsForThread(callerAppID string, threadID string, reason string) error {
	callerAppID = strings.TrimSpace(callerAppID)
	threadID = strings.TrimSpace(threadID)
	if callerAppID == "" || threadID == "" {
		return nil
	}
	anchorIDs := make([]string, 0)
	s.chatSurfaceMu.Lock()
	for _, session := range s.chatAnchors {
		if session == nil {
			continue
		}
		if strings.TrimSpace(session.CallerAppID) == callerAppID && strings.TrimSpace(session.ThreadID) == threadID && strings.TrimSpace(session.PendingFollowUpID) != "" {
			anchorIDs = append(anchorIDs, session.ConversationAnchorID)
		}
	}
	s.chatSurfaceMu.Unlock()
	for _, anchorID := range anchorIDs {
		if _, err := s.cancelPublicChatFollowUpForAnchor(anchorID, reason, true); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) cancelPublicChatFollowUpsForRequest(callerAppID string, anchorID string, threadID string, reason string) error {
	callerAppID = strings.TrimSpace(callerAppID)
	anchorID = strings.TrimSpace(anchorID)
	threadID = strings.TrimSpace(threadID)
	if callerAppID == "" {
		return nil
	}
	if anchorID != "" {
		s.chatSurfaceMu.Lock()
		session := s.chatAnchors[anchorID]
		ownedByCaller := session != nil && strings.TrimSpace(session.CallerAppID) == callerAppID
		s.chatSurfaceMu.Unlock()
		if ownedByCaller {
			if _, err := s.cancelPublicChatFollowUpForAnchor(anchorID, reason, true); err != nil {
				return err
			}
		}
	}
	if threadID != "" {
		return s.cancelPublicChatFollowUpsForThread(callerAppID, threadID, reason)
	}
	return nil
}

func (s *Service) takePublicChatFollowUp(followUpID string) *publicChatFollowUpState {
	s.chatSurfaceMu.Lock()
	followUp := s.chatFollowUps[strings.TrimSpace(followUpID)]
	if followUp == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	delete(s.chatFollowUps, strings.TrimSpace(followUpID))
	if session := s.chatAnchors[followUp.ConversationAnchorID]; session != nil && session.PendingFollowUpID == strings.TrimSpace(followUpID) {
		session.PendingFollowUpID = ""
	}
	s.chatSurfaceMu.Unlock()
	s.persistCurrentPublicChatSurfaceState()
	return followUp
}

// emitPublicChatFollowUpCanceled records the follow-up cancellation into the
// runtime-owned turn projection only. No stealth
// `runtime.agent.follow_up.*` public event family is minted; the cancellation
// surfaces via the admitted session_envelope projection
// (`session.snapshot.last_turn.follow_up.status == "canceled"`). Expanding
// public event families beyond `turn.*` / `session.*` would require a new
// authority admission.
func (s *Service) emitPublicChatFollowUpCanceled(
	followUp publicChatFollowUpState,
	reason string,
	reasonCode runtimev1.ReasonCode,
	actionHint string,
	message string,
) error {
	s.setPublicChatStoredFollowUpOutcome(followUp.ConversationAnchorID, followUp.SourceTurnID, publicChatFollowUpOutcome{
		Status:           "canceled",
		FollowUpID:       followUp.FollowUpID,
		ChainID:          followUp.ChainID,
		ScheduledFor:     followUp.ScheduledFor.Format(time.RFC3339Nano),
		FollowUpDepth:    followUp.FollowUpDepth,
		MaxFollowUpTurns: followUp.MaxFollowUpTurns,
		SourceTurnID:     followUp.SourceTurnID,
		SourceActionID:   followUp.SourceActionID,
		ReasonCode:       reasonCode,
		ActionHint:       strings.TrimSpace(actionHint),
		Message:          strings.TrimSpace(message),
	})
	intent := cloneHookIntent(followUp.HookIntent)
	if intent == nil {
		intent = &runtimev1.HookIntent{
			IntentId:             strings.TrimSpace(followUp.SourceActionID),
			AgentId:              strings.TrimSpace(followUp.AgentID),
			ConversationAnchorId: strings.TrimSpace(followUp.ConversationAnchorID),
			OriginatingTurnId:    strings.TrimSpace(followUp.SourceTurnID),
			Effect:               runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		}
	}
	intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
	agentID := strings.TrimSpace(intent.GetAgentId())
	if agentID == "" {
		agentID = strings.TrimSpace(followUp.AgentID)
	}
	if agentID == "" {
		return fmt.Errorf("public chat follow-up cancellation requires agent id")
	}
	entry, err := s.agentByID(agentID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return s.updateAgent(entry, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
		Intent:     intent,
		ObservedAt: timestamppb.New(now),
		Reason:     strings.TrimSpace(reason),
		ReasonCode: reasonCode,
		Message:    strings.TrimSpace(message),
	}, now))
}

func firstPublicChatFollowUpAction(structured *publicChatStructuredEnvelope) *publicChatStructuredAction {
	if structured == nil {
		return nil
	}
	for index := range structured.Actions {
		action := &structured.Actions[index]
		if action.Modality == "follow-up-turn" {
			return action
		}
	}
	return nil
}
