package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// publicChatHookIntentIndication projects only the mounted HookIntent
// vocabulary back onto `turn.post_turn.detail.hook_intent` when the turn
// selected a follow-up proposal. This is an indication seam only: it must
// not leak session/execution truth such as `follow_up_id`, `scheduled_for`,
// runtime cancellation state, or delivery outcomes back onto turn events.
func publicChatHookIntentIndication(structured *publicChatStructuredEnvelope, followUp publicChatFollowUpOutcome) map[string]any {
	action := firstPublicChatFollowUpAction(structured)
	if action == nil {
		return nil
	}
	admissionState := publicChatHookIntentAdmissionState(followUp.Status)
	if admissionState == "" {
		return nil
	}
	intent, err := publicChatHookIntentFromAction(action, "")
	if err != nil || intent == nil {
		return nil
	}
	out := map[string]any{
		"trigger_family":  publicChatHookTriggerFamilyLabel(intent.GetTriggerFamily()),
		"trigger_detail":  publicChatHookTriggerDetailPayload(intent.GetTriggerDetail()),
		"effect":          "follow-up-turn",
		"admission_state": admissionState,
	}
	if trimmed := strings.TrimSpace(action.ActionID); trimmed != "" {
		out["intent_id"] = trimmed
	}
	return out
}

func publicChatHookIntentAdmissionState(status string) string {
	switch strings.TrimSpace(status) {
	case "proposed":
		return "proposed"
	case "scheduled":
		return "pending"
	case "rejected":
		return "rejected"
	default:
		return ""
	}
}

func publicChatHookTriggerFamilyLabel(family runtimev1.HookTriggerFamily) string {
	switch family {
	case runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT:
		return "event"
	default:
		return "time"
	}
}

func publicChatHookTriggerDetailPayload(detail *runtimev1.HookTriggerDetail) map[string]any {
	if detail == nil {
		return map[string]any{}
	}
	switch {
	case detail.GetEventUserIdle() != nil:
		return map[string]any{
			"event_user_idle": map[string]any{
				"idle_ms": float64(detail.GetEventUserIdle().GetIdleFor().AsDuration().Milliseconds()),
			},
		}
	case detail.GetEventChatEnded() != nil:
		return map[string]any{
			"event_chat_ended": map[string]any{},
		}
	case detail.GetTime() != nil:
		fallthrough
	default:
		delayMs := int64(0)
		if detail.GetTime() != nil && detail.GetTime().GetDelay() != nil {
			delayMs = detail.GetTime().GetDelay().AsDuration().Milliseconds()
		}
		return map[string]any{
			"time": map[string]any{
				"delay_ms": float64(delayMs),
			},
		}
	}
}

type publicChatHookLifecycleTransition struct {
	state      runtimev1.HookAdmissionState
	reasonCode runtimev1.ReasonCode
	message    string
}

func publicChatFollowUpHookIntent(
	session publicChatAnchorState,
	turn publicChatTurnState,
	action *publicChatStructuredAction,
	state runtimev1.HookAdmissionState,
) (*runtimev1.HookIntent, error) {
	intent, err := publicChatHookIntentFromAction(action, session.AgentID)
	if err != nil {
		return nil, err
	}
	if intent == nil {
		return nil, fmt.Errorf("follow-up action did not produce HookIntent")
	}
	intent.AgentId = strings.TrimSpace(session.AgentID)
	intent.ConversationAnchorId = strings.TrimSpace(session.ConversationAnchorID)
	intent.OriginatingTurnId = strings.TrimSpace(turn.TurnID)
	intent.OriginatingStreamId = strings.TrimSpace(turn.StreamID)
	intent.AdmissionState = state
	return intent, nil
}

func (s *Service) emitPublicChatFollowUpHookEvents(
	session publicChatAnchorState,
	turn publicChatTurnState,
	action *publicChatStructuredAction,
	transitions ...publicChatHookLifecycleTransition,
) error {
	if len(transitions) == 0 {
		return nil
	}
	entry, err := s.agentByID(session.AgentID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	events := make([]*runtimev1.AgentEvent, 0, len(transitions))
	for _, transition := range transitions {
		intent, err := publicChatFollowUpHookIntent(session, turn, action, transition.state)
		if err != nil {
			return err
		}
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			Intent:     intent,
			ObservedAt: timestamppb.New(now),
			ReasonCode: transition.reasonCode,
			Message:    strings.TrimSpace(transition.message),
		}, now))
	}
	return s.updateAgent(entry, events...)
}
