package runtimeagent

import (
	"testing"
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
		AgentId:       agentID,
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

// newTestTimePendingHook wraps a newly-built HookIntent into a PendingHook
// with matching scheduled_for and admitted_at.
func newTestTimePendingHook(t *testing.T, intentID, agentID string, scheduledFor, admittedAt time.Time) *runtimev1.PendingHook {
	t.Helper()
	return &runtimev1.PendingHook{
		Intent:       newTestTimeHookIntent(intentID, agentID, scheduledFor, admittedAt),
		ScheduledFor: timestamppb.New(scheduledFor),
		AdmittedAt:   timestamppb.New(admittedAt),
	}
}

// newTestTimePendingHookWithReason is the reason-carrying variant.
func newTestTimePendingHookWithReason(t *testing.T, intentID, agentID, reason string, scheduledFor, admittedAt time.Time) *runtimev1.PendingHook {
	t.Helper()
	return &runtimev1.PendingHook{
		Intent:       newTestTimeHookIntentReason(intentID, agentID, reason, scheduledFor, admittedAt),
		ScheduledFor: timestamppb.New(scheduledFor),
		AdmittedAt:   timestamppb.New(admittedAt),
	}
}

// newTestTimePendingHookWithStatus is the admission-state variant, used for
// tests that seed agent state with already-terminal hooks (e.g. LAST_TURN
// anchors for cadence min-spacing checks).
func newTestTimePendingHookWithStatus(t *testing.T, intentID, agentID string, state runtimev1.HookAdmissionState, scheduledFor, admittedAt time.Time) *runtimev1.PendingHook {
	t.Helper()
	hook := newTestTimePendingHook(t, intentID, agentID, scheduledFor, admittedAt)
	hook.Intent.AdmissionState = state
	return hook
}
