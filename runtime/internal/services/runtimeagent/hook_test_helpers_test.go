package runtimeagent

import (
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// K-AGCORE-041 test-fixture builders.
//
// These helpers build admitted HookIntent / PendingHook fixtures in the
// mounted vocabulary. They are test-only; no production code path may
// reference them. They exist solely to keep fixture construction honest
// (no legacy NextHookIntent / SCHEDULED_TIME / cadence_interaction shapes).
//
// The TIME-family delay + not_before combination reproduces the older
// tests' "schedule at absolute instant" semantics without reintroducing
// any retired proto surface:
//   - delay    is relative from the admission clock (here: admittedAt)
//   - not_before is the absolute instant the hook becomes eligible to fire
// `normalizePendingHook` uses max(delay_from_now, not_before) so the
// resulting scheduled_for matches the caller-supplied absolute instant.

// newTestTimeHookIntent builds a TIME-family HookIntent with
// follow-up-turn effect and pending admission state.
func newTestTimeHookIntent(intentID, agentID string, scheduledFor, admittedAt time.Time) *runtimev1.HookIntent {
	delay := scheduledFor.Sub(admittedAt)
	if delay < 0 {
		delay = 0
	}
	return &runtimev1.HookIntent{
		IntentId:      intentID,
		AgentId:       testRuntimeAgentLocalRef(agentID),
		TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
		TriggerDetail: &runtimev1.HookTriggerDetail{
			Detail: &runtimev1.HookTriggerDetail_Time{
				Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(delay)},
			},
		},
		Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
		AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
		NotBefore:      timestamppb.New(scheduledFor),
	}
}

// newTestTimeHookIntentReason builds a TIME-family HookIntent with the
// given reason attached (used by cadence-tick and suspend-window tests).
func newTestTimeHookIntentReason(intentID, agentID, reason string, scheduledFor, admittedAt time.Time) *runtimev1.HookIntent {
	intent := newTestTimeHookIntent(intentID, agentID, scheduledFor, admittedAt)
	intent.Reason = reason
	return intent
}
