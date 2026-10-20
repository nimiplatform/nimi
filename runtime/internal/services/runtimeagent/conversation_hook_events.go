package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
	"strings"
	"time"
)

func hookEvent(agentID string, outcome *runtimev1.HookExecutionOutcome) *runtimev1.AgentEvent {
	observedAt := time.Now().UTC()
	if outcome != nil && outcome.GetObservedAt() != nil {
		observedAt = outcome.GetObservedAt().AsTime().UTC()
	}
	return hookEventAt(agentID, outcome, observedAt)
}

// hookEventAt emits a `runtime.agent.hook.*` projection event through the
// AgentEvent stream. Per K-AGCORE-042 / hook_envelope the envelope requires
// `agent_id`; origin linkage (conversation_anchor_id / originating_turn_id /
// originating_stream_id) is carried inside the HookIntent when present and
// is never fabricated when absent. `family` is the first-class public seam
// discriminator mapping 1:1 to `runtime.agent.hook.{intent_proposed|pending|
// rejected|running|completed|failed|canceled|rescheduled}`. HookIntent
// inside the detail carries the admitted vocabulary (`intent_id`,
// `trigger_family`, `trigger_detail`, `effect`, `admission_state`).
func hookEventAt(agentID string, outcome *runtimev1.HookExecutionOutcome, observedAt time.Time) *runtimev1.AgentEvent {
	var detail *runtimev1.AgentHookEventDetail
	if outcome != nil {
		detail = &runtimev1.AgentHookEventDetail{
			Family:     outcome.GetIntent().GetAdmissionState(),
			Intent:     cloneHookIntent(outcome.GetIntent()),
			ObservedAt: cloneTimestamp(outcome.GetObservedAt()),
			ReasonCode: outcome.GetReasonCode(),
			Message:    strings.TrimSpace(outcome.GetMessage()),
			Reason:     strings.TrimSpace(outcome.GetReason()),
		}
		if detail.ObservedAt == nil {
			detail.ObservedAt = timestamppb.New(observedAt.UTC())
		}
	} else {
		detail = &runtimev1.AgentHookEventDetail{
			ObservedAt: timestamppb.New(observedAt.UTC()),
		}
	}
	return &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK,
		AgentId:   strings.TrimSpace(agentID),
		Timestamp: timestamppb.New(observedAt.UTC()),
		Detail: &runtimev1.AgentEvent_Hook{
			Hook: detail,
		},
	}
}
