package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// admitPendingHook commits a validated HookIntent as `pending` scheduler
// truth. Per K-AGCORE-042 this emits `runtime.agent.hook.intent_proposed`
// then `runtime.agent.hook.pending` so admission is externally observable.
func (s *Service) admitPendingHook(agentID string, hook *runtimev1.PendingHook) error {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	normalized, err := normalizePendingHook(hook, now)
	if err != nil {
		return err
	}
	intentID := normalized.GetIntent().GetIntentId()
	if _, exists := entry.Hooks[intentID]; exists {
		return status.Error(codes.AlreadyExists, "hook already exists")
	}
	// Stamp agent_id onto intent if caller omitted it (runtime truth binds
	// HookIntent to the agent it was admitted under).
	if strings.TrimSpace(normalized.Intent.GetAgentId()) == "" {
		normalized.Intent.AgentId = entry.Agent.GetAgentId()
	}
	entry.Hooks[intentID] = normalized
	stateEvent := s.refreshLifeTrackExecutionState(entry, stateEventOriginFromPendingHook(normalized), now)
	// Emit proposed-then-pending to project the admission transition.
	proposedIntent := cloneHookIntent(normalized.GetIntent())
	proposedIntent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED
	events := []*runtimev1.AgentEvent{
		hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			Intent:     proposedIntent,
			ObservedAt: timestamppb.New(now),
		}, now),
		hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(normalized.GetIntent()),
			ObservedAt: timestamppb.New(now),
		}, now),
	}
	if stateEvent != nil {
		events = append(events, stateEvent)
	}
	return s.updateAgent(entry, events...)
}

func (s *Service) markHookRunning(agentID string, intentID string) (*runtimev1.HookExecutionOutcome, error) {
	return s.markHookRunningAt(agentID, intentID, time.Now().UTC())
}

func (s *Service) markHookRunningAt(agentID string, intentID string, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, intentID, now, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not pending")
		}
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING
		return &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
		}, nil, nil
	})
}

func (s *Service) cancelHook(agentID string, intentID string, canceledBy string, reason string) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHook(agentID, intentID, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if !isCancelableAdmissionState(hookAdmissionState(hook)) {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not cancelable")
		}
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
		return &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			Reason:     firstNonEmpty(strings.TrimSpace(reason), "hook canceled"),
			Message:    strings.TrimSpace(canceledBy),
		}, nil, nil
	})
}

func (s *Service) transitionHook(agentID string, intentID string, mutate func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error)) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, intentID, time.Now().UTC(), mutate)
}

func (s *Service) transitionHookAt(agentID string, intentID string, now time.Time, mutate func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error)) (*runtimev1.HookExecutionOutcome, error) {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	intentID = strings.TrimSpace(intentID)
	hook := entry.Hooks[intentID]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	outcome, extraEvents, err := mutate(entry, hook, now)
	if err != nil {
		return nil, err
	}
	stateEvent := s.refreshLifeTrackExecutionState(entry, stateEventOriginFromPendingHook(hook), now)
	events := make([]*runtimev1.AgentEvent, 0, len(extraEvents)+1)
	if outcome != nil {
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), outcome, now))
	}
	events = append(events, extraEvents...)
	if stateEvent != nil {
		events = append(events, stateEvent)
	}
	if err := s.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	if outcome == nil {
		return nil, nil
	}
	return cloneHookOutcome(outcome), nil
}

func (s *Service) completeHook(agentID string, intentID string, summary string, tokensUsed int64) (*runtimev1.HookExecutionOutcome, error) {
	return s.completeHookAt(agentID, intentID, summary, tokensUsed, time.Now().UTC())
}

func (s *Service) completeHookAt(agentID string, intentID string, summary string, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, intentID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not running")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED
		applyTokenUsage(entry, tokensUsed, now)
		outcome := &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			Message:    strings.TrimSpace(summary),
		}
		return outcome, optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now)), nil
	})
}

func (s *Service) failHook(agentID string, intentID string, reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64) (*runtimev1.HookExecutionOutcome, error) {
	return s.failHookAt(agentID, intentID, reasonCode, message, retryable, tokensUsed, time.Now().UTC())
}

func (s *Service) failHookAt(agentID string, intentID string, reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	_ = retryable // retry policy remains internal; no public field on outcome.
	return s.transitionHookAt(agentID, intentID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not running")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED
		applyTokenUsage(entry, tokensUsed, now)
		outcome := &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			ReasonCode: reasonCode,
			Message:    strings.TrimSpace(message),
		}
		return outcome, optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now)), nil
	})
}

func (s *Service) rejectHook(agentID string, intentID string, reasonCode runtimev1.ReasonCode, message string) (*runtimev1.HookExecutionOutcome, error) {
	return s.rejectHookAt(agentID, intentID, reasonCode, message, time.Now().UTC())
}

func (s *Service) rejectHookAt(agentID string, intentID string, reasonCode runtimev1.ReasonCode, message string, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, intentID, now, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		state := hookAdmissionState(hook)
		if state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING &&
			state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not rejectable")
		}
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED
		return &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			ReasonCode: reasonCode,
			Message:    strings.TrimSpace(message),
		}, nil, nil
	})
}

// rescheduleHookAt transitions the current hook to RESCHEDULED and admits a
// fresh follow-up PendingHook derived from `nextIntent`. The follow-up is
// projected via proposed-then-pending events.
func (s *Service) rescheduleHookAt(agentID string, intentID string, nextIntent *runtimev1.HookIntent, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	if err := validateHookIntent(nextIntent); err != nil {
		return nil, err
	}
	return s.transitionHookAt(agentID, intentID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, transitionTime time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		state := hookAdmissionState(hook)
		if state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING &&
			state != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not reschedulable")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		scheduledFor, err := resolveHookScheduledFor(nextIntent, transitionTime)
		if err != nil {
			return nil, nil, err
		}
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED

		// Normalize follow-up intent: stamp agent_id, admission_state, unique intent_id.
		followupIntent := cloneHookIntent(nextIntent)
		if strings.TrimSpace(followupIntent.GetAgentId()) == "" {
			followupIntent.AgentId = entry.Agent.GetAgentId()
		}
		if strings.TrimSpace(followupIntent.GetIntentId()) == "" {
			followupIntent.IntentId = "hook_" + ulid.Make().String()
		}
		followupIntent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING
		followup := &runtimev1.PendingHook{
			Intent:       followupIntent,
			ScheduledFor: timestamppb.New(scheduledFor),
			AdmittedAt:   timestamppb.New(transitionTime),
		}
		entry.Hooks[followupIntent.GetIntentId()] = followup
		applyTokenUsage(entry, tokensUsed, transitionTime)
		outcome := &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(transitionTime),
		}
		events := optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), transitionTime))
		proposedFollowup := cloneHookIntent(followupIntent)
		proposedFollowup.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED
		events = append(events,
			hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				Intent:     proposedFollowup,
				ObservedAt: timestamppb.New(transitionTime),
			}, transitionTime),
			hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				Intent:     cloneHookIntent(followupIntent),
				ObservedAt: timestamppb.New(transitionTime),
			}, transitionTime),
		)
		return outcome, events, nil
	})
}

func (s *Service) cancelActiveHooks(entry *agentEntry, canceledBy string, reason string, now time.Time) []*runtimev1.AgentEvent {
	if entry == nil {
		return nil
	}
	events := make([]*runtimev1.AgentEvent, 0, len(entry.Hooks))
	for _, hook := range entry.Hooks {
		if hook == nil || !isCancelableAdmissionState(hookAdmissionState(hook)) {
			continue
		}
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_CANCELED
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			Reason:     firstNonEmpty(strings.TrimSpace(reason), "agent terminated"),
			Message:    firstNonEmpty(strings.TrimSpace(canceledBy), "runtime"),
		}, now))
	}
	if stateEvent := s.refreshLifeTrackExecutionState(entry, stateEventOrigin{}, now); stateEvent != nil {
		events = append(events, stateEvent)
	}
	return events
}

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
