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
	if _, exists := entry.Hooks[normalized.GetHookId()]; exists {
		return status.Error(codes.AlreadyExists, "hook already exists")
	}
	entry.Hooks[normalized.GetHookId()] = normalized
	refreshLifeTrackState(entry, now)
	return s.updateAgent(entry, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
		HookId:     normalized.GetHookId(),
		Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
		Trigger:    cloneTriggerDetail(normalized.GetTrigger()),
		ObservedAt: timestamppb.New(now),
	}, now))
}

func (s *Service) markHookRunning(agentID string, hookID string) (*runtimev1.HookExecutionOutcome, error) {
	return s.markHookRunningAt(agentID, hookID, time.Now().UTC())
}

func (s *Service) markHookRunningAt(agentID string, hookID string, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, hookID, now, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not pending")
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING
		return &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
		}, nil, nil
	})
}

func (s *Service) cancelHook(agentID string, hookID string, canceledBy string, reason string) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHook(agentID, hookID, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if !isCancelableHookStatus(hook.GetStatus()) {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not cancelable")
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED
		return &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Canceled{
				Canceled: &runtimev1.HookCanceledDetail{
					CanceledBy: firstNonEmpty(canceledBy, "runtime"),
					Reason:     firstNonEmpty(strings.TrimSpace(reason), "hook canceled"),
				},
			},
		}, nil, nil
	})
}

func (s *Service) transitionHook(agentID string, hookID string, mutate func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error)) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, hookID, time.Now().UTC(), mutate)
}

func (s *Service) transitionHookAt(agentID string, hookID string, now time.Time, mutate func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error)) (*runtimev1.HookExecutionOutcome, error) {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	hookID = strings.TrimSpace(hookID)
	hook := entry.Hooks[hookID]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	outcome, extraEvents, err := mutate(entry, hook, now)
	if err != nil {
		return nil, err
	}
	refreshLifeTrackState(entry, now)
	events := make([]*runtimev1.AgentEvent, 0, len(extraEvents)+1)
	if outcome != nil {
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), outcome, now))
	}
	events = append(events, extraEvents...)
	if err := s.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	if outcome == nil {
		return nil, nil
	}
	return cloneHookOutcome(outcome), nil
}

func (s *Service) completeHook(agentID string, hookID string, summary string, tokensUsed int64) (*runtimev1.HookExecutionOutcome, error) {
	return s.completeHookAt(agentID, hookID, summary, tokensUsed, time.Now().UTC())
}

func (s *Service) completeHookAt(agentID string, hookID string, summary string, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, hookID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not running")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED
		applyTokenUsage(entry, tokensUsed, now)
		outcome := &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Completed{
				Completed: &runtimev1.HookCompletedDetail{
					Summary:     strings.TrimSpace(summary),
					CompletedAt: timestamppb.New(now),
				},
			},
		}
		return outcome, optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now)), nil
	})
}

func (s *Service) failHook(agentID string, hookID string, reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64) (*runtimev1.HookExecutionOutcome, error) {
	return s.failHookAt(agentID, hookID, reasonCode, message, retryable, tokensUsed, time.Now().UTC())
}

func (s *Service) failHookAt(agentID string, hookID string, reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, hookID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not running")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED
		applyTokenUsage(entry, tokensUsed, now)
		outcome := &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Failed{
				Failed: &runtimev1.HookFailedDetail{
					ReasonCode: reasonCode,
					Message:    strings.TrimSpace(message),
					Retryable:  retryable,
				},
			},
		}
		return outcome, optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now)), nil
	})
}

func (s *Service) rejectHook(agentID string, hookID string, reasonCode runtimev1.ReasonCode, message string) (*runtimev1.HookExecutionOutcome, error) {
	return s.rejectHookAt(agentID, hookID, reasonCode, message, time.Now().UTC())
}

func (s *Service) rejectHookAt(agentID string, hookID string, reasonCode runtimev1.ReasonCode, message string, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.transitionHookAt(agentID, hookID, now, func(_ *agentEntry, hook *runtimev1.PendingHook, now time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING &&
			hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not rejectable")
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED
		return &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Rejected{
				Rejected: &runtimev1.HookRejectedDetail{
					ReasonCode: reasonCode,
					Message:    strings.TrimSpace(message),
				},
			},
		}, nil, nil
	})
}

func (s *Service) rescheduleHook(agentID string, hookID string, nextIntent *runtimev1.NextHookIntent, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.rescheduleHookAt(agentID, hookID, nextIntent, tokensUsed, now)
}

func (s *Service) rescheduleHookAt(agentID string, hookID string, nextIntent *runtimev1.NextHookIntent, tokensUsed int64, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	if err := validateNextHookIntent(nextIntent); err != nil {
		return nil, err
	}
	return s.transitionHookAt(agentID, hookID, now, func(entry *agentEntry, hook *runtimev1.PendingHook, transitionTime time.Time) (*runtimev1.HookExecutionOutcome, []*runtimev1.AgentEvent, error) {
		if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING && hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
			return nil, nil, status.Error(codes.FailedPrecondition, "hook is not reschedulable")
		}
		beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
		scheduledFor, err := scheduledTimeFromIntent(nextIntent, now)
		if err != nil {
			return nil, nil, err
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED
		followup := &runtimev1.PendingHook{
			HookId:       "hook_" + ulid.Make().String(),
			Status:       runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:      triggerDetailFromIntent(nextIntent),
			NextIntent:   cloneNextHookIntent(nextIntent),
			ScheduledFor: timestamppb.New(scheduledFor),
			AdmittedAt:   timestamppb.New(transitionTime),
		}
		entry.Hooks[followup.GetHookId()] = followup
		applyTokenUsage(entry, tokensUsed, transitionTime)
		outcome := &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(transitionTime),
			Detail: &runtimev1.HookExecutionOutcome_Rescheduled{
				Rescheduled: &runtimev1.HookRescheduledDetail{
					NextIntent: cloneNextHookIntent(nextIntent),
				},
			},
		}
		events := optionalEvents(budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), transitionTime))
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     followup.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:    cloneTriggerDetail(followup.GetTrigger()),
			ObservedAt: timestamppb.New(transitionTime),
		}, transitionTime))
		return outcome, events, nil
	})
}

func cancelActiveHooks(entry *agentEntry, canceledBy string, reason string, now time.Time) []*runtimev1.AgentEvent {
	if entry == nil {
		return nil
	}
	events := make([]*runtimev1.AgentEvent, 0, len(entry.Hooks))
	for hookID, hook := range entry.Hooks {
		if hook == nil || !isCancelableHookStatus(hook.GetStatus()) {
			continue
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED
		events = append(events, hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     hookID,
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_CANCELED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Canceled{
				Canceled: &runtimev1.HookCanceledDetail{
					CanceledBy: firstNonEmpty(canceledBy, "runtime"),
					Reason:     firstNonEmpty(strings.TrimSpace(reason), "agent terminated"),
				},
			},
		}, now))
	}
	refreshLifeTrackState(entry, now)
	return events
}

func hookEvent(agentID string, outcome *runtimev1.HookExecutionOutcome) *runtimev1.AgentEvent {
	observedAt := time.Now().UTC()
	if outcome != nil && outcome.GetObservedAt() != nil {
		observedAt = outcome.GetObservedAt().AsTime().UTC()
	}
	return hookEventAt(agentID, outcome, observedAt)
}

func hookEventAt(agentID string, outcome *runtimev1.HookExecutionOutcome, observedAt time.Time) *runtimev1.AgentEvent {
	return &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_HOOK,
		AgentId:   strings.TrimSpace(agentID),
		Timestamp: timestamppb.New(observedAt.UTC()),
		Detail: &runtimev1.AgentEvent_Hook{
			Hook: &runtimev1.AgentHookEventDetail{
				Outcome: cloneHookOutcome(outcome),
			},
		},
	}
}
