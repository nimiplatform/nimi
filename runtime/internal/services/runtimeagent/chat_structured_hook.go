package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/durationpb"
)

func (hook *publicChatAPMLHookDraft) setEventUserIdle(idleFor string, idleForMs string) error {
	if hook == nil {
		return fmt.Errorf("APML event-user-idle outside event-hook")
	}
	if hook.triggerEvent != "" {
		return fmt.Errorf("APML event-hook admits exactly one event trigger")
	}
	idleDuration, err := parseAPMLDuration(idleFor, idleForMs)
	if err != nil {
		return fmt.Errorf("APML event-hook event-user-idle idle-for invalid: %w", err)
	}
	idleMs := int(idleDuration.AsDuration().Milliseconds())
	if idleMs <= 0 {
		return fmt.Errorf("APML event-hook event-user-idle idle-for must be positive")
	}
	hook.triggerEvent = "user-idle"
	hook.idleMs = idleMs
	return nil
}

func (hook *publicChatAPMLHookDraft) setEventChatEnded() error {
	if hook == nil {
		return fmt.Errorf("APML event-chat-ended outside event-hook")
	}
	if hook.triggerEvent != "" {
		return fmt.Errorf("APML event-hook admits exactly one event trigger")
	}
	hook.triggerEvent = "chat-ended"
	return nil
}

func publicChatAPMLHookOperation(hook publicChatAPMLHookDraft) string {
	if hook.triggerFamily == "event" {
		return "assistant.turn.hook"
	}
	return "assistant.turn.schedule"
}

func publicChatHookIntentFromAction(action *publicChatStructuredAction, agentID string) (*runtimev1.HookIntent, error) {
	if action == nil {
		return nil, nil
	}
	if action.Modality != "follow-up-turn" {
		return nil, nil
	}
	intent := &runtimev1.HookIntent{
		IntentId:             strings.TrimSpace(action.ActionID),
		AgentId:              strings.TrimSpace(agentID),
		Effect:               runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState:       runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED,
		Reason:               strings.TrimSpace(action.PromptPayload.PromptText),
		ConversationAnchorId: "",
		OriginatingTurnId:    "",
		OriginatingStreamId:  "",
	}
	switch action.PromptPayload.TriggerFamily {
	case "", "time":
		intent.TriggerFamily = runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME
		intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_Time{Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(time.Duration(action.PromptPayload.DelayMs) * time.Millisecond)}}}
	case "event":
		intent.TriggerFamily = runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_EVENT
		switch action.PromptPayload.TriggerEvent {
		case "user-idle":
			intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_EventUserIdle{EventUserIdle: &runtimev1.HookTriggerEventUserIdleDetail{IdleFor: durationpb.New(time.Duration(action.PromptPayload.IdleMs) * time.Millisecond)}}}
		case "chat-ended":
			intent.TriggerDetail = &runtimev1.HookTriggerDetail{Detail: &runtimev1.HookTriggerDetail_EventChatEnded{EventChatEnded: &runtimev1.HookTriggerEventChatEndedDetail{}}}
		default:
			return nil, fmt.Errorf("APML event-hook trigger is invalid")
		}
	default:
		return nil, fmt.Errorf("APML hook trigger family is invalid")
	}
	if err := validateHookIntent(intent); err != nil {
		return nil, err
	}
	return intent, nil
}
