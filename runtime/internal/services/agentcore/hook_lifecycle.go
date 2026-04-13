package agentcore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const lifeTrackLoopInterval = time.Second

type hookExecutionDecision struct {
	status     runtimev1.AgentHookStatus
	summary    string
	reasonCode runtimev1.ReasonCode
	message    string
	retryable  bool
	nextIntent *runtimev1.NextHookIntent
	tokensUsed int64
}

type hookExecutor func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)

type LifeTrackExecutor interface {
	ExecuteLifeTrackHook(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)
}

type rejectingLifeTrackExecutor struct{}

type dueHookRef struct {
	agentID      string
	hookID       string
	scheduledFor time.Time
}

func (rejectingLifeTrackExecutor) ExecuteLifeTrackHook(_ context.Context, _ *lifeTurnRequest) (*lifeTurnResult, error) {
	return nil, &lifeTurnExecutionError{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
		reasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		message:    "runtime internal life-track executor unavailable or not admitted",
	}
}

func (s *Service) currentLifeTrackExecutor() LifeTrackExecutor {
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if s.lifeExecutor == nil {
		return rejectingLifeTrackExecutor{}
	}
	return s.lifeExecutor
}

func (s *Service) runLifeTrackLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	if err := s.runLifeTrackSweep(ctx, time.Now().UTC()); err != nil && ctx.Err() == nil {
		s.logger.Warn("agentcore life-track sweep failed", "error", err)
	}
	ticker := time.NewTicker(lifeTrackLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			if err := s.runLifeTrackSweep(ctx, tickAt.UTC()); err != nil && ctx.Err() == nil {
				s.logger.Warn("agentcore life-track sweep failed", "error", err)
			}
		}
	}
}

func (s *Service) runLifeTrackSweep(ctx context.Context, now time.Time) error {
	_, err := s.executeDueHooks(ctx, now, s.lifeTrackHookExecutor())
	return err
}

func (s *Service) lifeTrackHookExecutor() hookExecutor {
	executor := s.currentLifeTrackExecutor()
	return func(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		return executor.ExecuteLifeTrackHook(ctx, req)
	}
}

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

func (s *Service) executeDueHooks(ctx context.Context, now time.Time, executor hookExecutor) ([]*runtimev1.HookExecutionOutcome, error) {
	if executor == nil {
		return nil, fmt.Errorf("hook executor is required")
	}
	dueHooks := s.duePendingHooks(now)
	outcomes := make([]*runtimev1.HookExecutionOutcome, 0, len(dueHooks))
	for _, item := range dueHooks {
		select {
		case <-ctx.Done():
			return outcomes, ctx.Err()
		default:
		}
		outcome, err := s.executePendingHook(ctx, item.agentID, item.hookID, now, executor)
		if err != nil {
			return outcomes, err
		}
		if outcome != nil {
			outcomes = append(outcomes, outcome)
		}
	}
	return outcomes, nil
}

func (s *Service) executePendingHook(ctx context.Context, agentID string, hookID string, now time.Time, executor hookExecutor) (*runtimev1.HookExecutionOutcome, error) {
	if executor == nil {
		return nil, fmt.Errorf("hook executor is required")
	}
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	hook := entry.Hooks[strings.TrimSpace(hookID)]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
		return nil, nil
	}
	if hook.GetScheduledFor() != nil && hook.GetScheduledFor().AsTime().After(now) {
		return nil, nil
	}
	if blocked := gateHookExecution(entry, now); blocked != nil {
		return s.applyHookDecision(agentID, hookID, blocked, now)
	}
	if _, err := s.markHookRunningAt(agentID, hookID, now); err != nil {
		return nil, err
	}
	executionEntry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	runningHook := executionEntry.Hooks[strings.TrimSpace(hookID)]
	if runningHook == nil {
		return nil, status.Error(codes.NotFound, "hook not found after transition")
	}
	recall, err := s.assembleLifeTurnRecall(ctx, executionEntry, lifeTurnRecallLimit)
	if err != nil {
		return s.applyHookDecision(agentID, hookID, failedHookDecision(reasonCodeFromError(err), err.Error(), false, 0), now)
	}
	result, err := executor(ctx, &lifeTurnRequest{
		Agent:    cloneAgentRecord(executionEntry.Agent),
		State:    cloneAgentState(executionEntry.State),
		Hook:     clonePendingHook(runningHook),
		Recall:   cloneCanonicalMemoryViews(recall),
		Autonomy: cloneAutonomy(executionEntry.Agent.GetAutonomy()),
	})
	if err != nil {
		if executionErr, ok := err.(*lifeTurnExecutionError); ok {
			return s.applyHookDecision(agentID, hookID, executionErr.decision(), now)
		}
		return s.applyHookDecision(agentID, hookID, failedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, err.Error(), false, 0), now)
	}
	if result == nil {
		result = &lifeTurnResult{}
	}
	return s.applyLifeTurnResult(ctx, agentID, hookID, result, now)
}

func (s *Service) applyHookDecision(agentID string, hookID string, decision *hookExecutionDecision, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	if decision == nil {
		return s.completeHookAt(agentID, hookID, "", 0, now)
	}
	switch decision.status {
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED:
		return s.completeHookAt(agentID, hookID, decision.summary, decision.tokensUsed, now)
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED:
		return s.failHookAt(agentID, hookID, decision.reasonCode, decision.message, decision.retryable, decision.tokensUsed, now)
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED:
		return s.rescheduleHookAt(agentID, hookID, decision.nextIntent, decision.tokensUsed, now)
	case runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED:
		return s.rejectHookAt(agentID, hookID, decision.reasonCode, decision.message, now)
	default:
		return nil, status.Error(codes.InvalidArgument, "unsupported hook execution decision")
	}
}

func (s *Service) assembleLifeTurnRecall(ctx context.Context, entry *agentEntry, limit int32) ([]*runtimev1.CanonicalMemoryView, error) {
	if entry == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = lifeTurnRecallLimit
	}
	views := make([]*runtimev1.CanonicalMemoryView, 0)
	for _, locator := range s.queryLocatorsForAgent(entry, nil) {
		if _, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: locator}); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			return nil, err
		}
		resp, err := s.memorySvc.History(ctx, &runtimev1.HistoryRequest{
			Bank: locator,
			Query: &runtimev1.MemoryHistoryQuery{
				PageSize: limit,
			},
		})
		if err != nil {
			return nil, err
		}
		for _, record := range resp.GetRecords() {
			if record == nil {
				continue
			}
			views = append(views, &runtimev1.CanonicalMemoryView{
				CanonicalClass: record.GetCanonicalClass(),
				SourceBank:     cloneLocator(record.GetBank()),
				Record:         cloneMemoryRecord(record),
				PolicyReason:   "life_track_recall",
			})
		}
	}
	sort.Slice(views, func(i, j int) bool {
		leftUpdated := views[i].GetRecord().GetUpdatedAt().AsTime()
		rightUpdated := views[j].GetRecord().GetUpdatedAt().AsTime()
		if leftUpdated.Equal(rightUpdated) {
			return views[i].GetRecord().GetMemoryId() < views[j].GetRecord().GetMemoryId()
		}
		return leftUpdated.After(rightUpdated)
	})
	if int(limit) < len(views) {
		views = views[:limit]
	}
	return views, nil
}

func (s *Service) applyLifeTurnResult(ctx context.Context, agentID string, hookID string, result *lifeTurnResult, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	entry, err := s.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	hookID = strings.TrimSpace(hookID)
	hook := entry.Hooks[hookID]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	if hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING {
		return nil, status.Error(codes.FailedPrecondition, "hook is not running")
	}

	if result == nil {
		result = &lifeTurnResult{}
	}
	accepted, rejected := s.writeLifeTurnCandidates(ctx, entry, hook, result.CanonicalMemoryCandidates, now)
	if result.StatusText != nil {
		entry.State.StatusText = *result.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
	}

	beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
	var outcome *runtimev1.HookExecutionOutcome
	var followupEvent *runtimev1.AgentEvent
	events := make([]*runtimev1.AgentEvent, 0, 4+len(accepted))
	applyTokenUsage(entry, result.TokensUsed, now)
	if result.NextHookIntent != nil {
		scheduledFor, err := scheduledTimeFromIntent(result.NextHookIntent, now)
		if err != nil {
			return s.failHookAt(agentID, hookID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error(), false, result.TokensUsed, now)
		}
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED
		followup := &runtimev1.PendingHook{
			HookId:       "hook_" + ulid.Make().String(),
			Status:       runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:      triggerDetailFromIntent(result.NextHookIntent),
			NextIntent:   cloneNextHookIntent(result.NextHookIntent),
			ScheduledFor: timestamppb.New(scheduledFor),
			AdmittedAt:   timestamppb.New(now),
		}
		entry.Hooks[followup.GetHookId()] = followup
		outcome = &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Rescheduled{
				Rescheduled: &runtimev1.HookRescheduledDetail{
					NextIntent: cloneNextHookIntent(result.NextHookIntent),
				},
			},
		}
		followupEvent = hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
			HookId:     followup.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
			Trigger:    cloneTriggerDetail(followup.GetTrigger()),
			ObservedAt: timestamppb.New(now),
		}, now)
	} else {
		hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED
		outcome = &runtimev1.HookExecutionOutcome{
			HookId:     hook.GetHookId(),
			Status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
			Trigger:    cloneTriggerDetail(hook.GetTrigger()),
			ObservedAt: timestamppb.New(now),
			Detail: &runtimev1.HookExecutionOutcome_Completed{
				Completed: &runtimev1.HookCompletedDetail{
					Summary:     strings.TrimSpace(result.Summary),
					CompletedAt: timestamppb.New(now),
				},
			},
		}
	}

	refreshLifeTrackState(entry, now)
	events = append(events, hookEventAt(entry.Agent.GetAgentId(), outcome, now))
	if followupEvent != nil {
		events = append(events, followupEvent)
	}
	if len(accepted) > 0 || len(rejected) > 0 {
		events = append(events, s.newEventAt(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
				Rejected: cloneCanonicalMemoryRejections(rejected),
			},
		}, now))
	}
	if budgetEvent := budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now); budgetEvent != nil {
		events = append(events, budgetEvent)
	}
	if err := s.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return cloneHookOutcome(outcome), nil
}

func (s *Service) writeLifeTurnCandidates(ctx context.Context, entry *agentEntry, hook *runtimev1.PendingHook, candidates []*lifeTurnMemoryCandidate, now time.Time) ([]*runtimev1.CanonicalMemoryView, []*runtimev1.CanonicalMemoryRejection) {
	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(candidates))
	rejected := make([]*runtimev1.CanonicalMemoryRejection, 0)
	for _, item := range candidates {
		candidate, rejection := buildLifeTurnCanonicalMemoryCandidate(entry, hook, item, now)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		view, writeRejection := s.writeCandidate(ctx, entry, candidate)
		if writeRejection != nil {
			rejected = append(rejected, writeRejection)
			continue
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	return accepted, rejected
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

func normalizePendingHook(input *runtimev1.PendingHook, now time.Time) (*runtimev1.PendingHook, error) {
	if input == nil || strings.TrimSpace(input.GetHookId()) == "" || input.GetTrigger() == nil || input.GetNextIntent() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateHookTriggerDetail(input.GetTrigger()); err != nil {
		return nil, err
	}
	if err := validateNextHookIntent(input.GetNextIntent()); err != nil {
		return nil, err
	}
	if input.GetTrigger().GetTriggerKind() != input.GetNextIntent().GetTriggerKind() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scheduledFor, err := resolveScheduledFor(input, now)
	if err != nil {
		return nil, err
	}
	hook := clonePendingHook(input)
	hook.Status = runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING
	hook.Trigger = cloneTriggerDetail(input.GetTrigger())
	hook.NextIntent = cloneNextHookIntent(input.GetNextIntent())
	hook.ScheduledFor = timestamppb.New(scheduledFor)
	if input.GetAdmittedAt() == nil {
		hook.AdmittedAt = timestamppb.New(now)
	} else {
		hook.AdmittedAt = cloneTimestamp(input.GetAdmittedAt())
	}
	return hook, nil
}

func resolveScheduledFor(hook *runtimev1.PendingHook, now time.Time) (time.Time, error) {
	_ = now
	intent := hook.GetNextIntent()
	if intent == nil {
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	var scheduled time.Time
	switch intent.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		detail := intent.GetScheduledTime()
		if detail == nil || detail.GetScheduledFor() == nil {
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		scheduled = detail.GetScheduledFor().AsTime()
	default:
		switch {
		case intent.GetNotBefore() != nil:
			scheduled = intent.GetNotBefore().AsTime()
		case hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero():
			scheduled = hook.GetScheduledFor().AsTime()
		default:
			return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	}
	if hook.GetScheduledFor() != nil && !hook.GetScheduledFor().AsTime().IsZero() && !hook.GetScheduledFor().AsTime().Equal(scheduled) {
		return time.Time{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return scheduled.UTC(), nil
}

func scheduledTimeFromIntent(intent *runtimev1.NextHookIntent, now time.Time) (time.Time, error) {
	return resolveScheduledFor(&runtimev1.PendingHook{
		HookId:     "hook_preview",
		Trigger:    triggerDetailFromIntent(intent),
		NextIntent: cloneNextHookIntent(intent),
	}, now)
}

func validateHookTriggerDetail(detail *runtimev1.HookTriggerDetail) error {
	if detail == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch detail.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED:
		if detail.GetTurnCompleted() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		if detail.GetScheduledTime() == nil || detail.GetScheduledTime().GetScheduledFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_USER_IDLE:
		if detail.GetUserIdle() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_CHAT_ENDED:
		if detail.GetChatEnded() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_STATE_CONDITION:
		if detail.GetStateCondition() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_WORLD_EVENT:
		if detail.GetWorldEvent() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_COMPOUND:
		compound := detail.GetCompound()
		if compound == nil || len(compound.GetTriggers()) == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		for _, nested := range compound.GetTriggers() {
			if err := validateHookTriggerDetail(nested); err != nil {
				return err
			}
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func validateNextHookIntent(intent *runtimev1.NextHookIntent) error {
	if intent == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch intent.GetTriggerKind() {
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_TURN_COMPLETED:
		if intent.GetTurnCompleted() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME:
		if intent.GetScheduledTime() == nil || intent.GetScheduledTime().GetScheduledFor() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_USER_IDLE:
		if intent.GetUserIdle() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_CHAT_ENDED:
		if intent.GetChatEnded() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_STATE_CONDITION:
		if intent.GetStateCondition() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_WORLD_EVENT:
		if intent.GetWorldEvent() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
	case runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_COMPOUND:
		compound := intent.GetCompound()
		if compound == nil || len(compound.GetIntents()) == 0 {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
		}
		for _, nested := range compound.GetIntents() {
			if err := validateNextHookIntent(nested); err != nil {
				return err
			}
		}
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return nil
}

func refreshLifeTrackState(entry *agentEntry, now time.Time) {
	if entry == nil || entry.State == nil {
		return
	}
	next := entry.State.GetExecutionState()
	switch {
	case entry.Agent != nil && entry.Agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED:
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED
	case hasHookStatus(entry, runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_RUNNING
	case hasHookStatus(entry, runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING):
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING
	case next != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE:
		next = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE
	}
	if entry.State.GetExecutionState() != next {
		entry.State.ExecutionState = next
		entry.State.UpdatedAt = timestamppb.New(now)
	}
}

func hasHookStatus(entry *agentEntry, expected runtimev1.AgentHookStatus) bool {
	if entry == nil {
		return false
	}
	for _, hook := range entry.Hooks {
		if hook != nil && hook.GetStatus() == expected {
			return true
		}
	}
	return false
}

func isCancelableHookStatus(status runtimev1.AgentHookStatus) bool {
	return status == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING ||
		status == runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RUNNING
}

func cloneNextHookIntent(input *runtimev1.NextHookIntent) *runtimev1.NextHookIntent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.NextHookIntent)
}

func worldSharedAdmissionError() error {
	return status.Error(codes.FailedPrecondition, "WORLD_SHARED canonical memory requires runtime-owned active_world_id on Agent Core")
}

func requiresExplicitWorldSharedAdmission(classes []runtimev1.MemoryCanonicalClass) bool {
	for _, class := range classes {
		if class == runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED {
			return true
		}
	}
	return false
}

func validateWorldSharedCandidateAdmission(entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) *runtimev1.CanonicalMemoryRejection {
	if candidate == nil || candidate.GetCanonicalClass() != runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED {
		return nil
	}
	if err := validateWorldSharedAgentState(entry); err != nil {
		return rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error())
	}
	target := candidate.GetTargetBank()
	if target == nil || target.GetWorldShared() == nil {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "WORLD_SHARED candidate requires world_shared target bank")
	}
	if strings.TrimSpace(target.GetWorldShared().GetWorldId()) != strings.TrimSpace(entry.State.GetActiveWorldId()) {
		return rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "WORLD_SHARED target bank must match runtime-owned active_world_id")
	}
	return nil
}

func validateWorldSharedAgentState(entry *agentEntry) error {
	if entry == nil || entry.State == nil {
		return fmt.Errorf("agent entry is required")
	}
	if strings.TrimSpace(entry.State.GetActiveWorldId()) == "" {
		return worldSharedAdmissionError()
	}
	return nil
}

func (s *Service) duePendingHooks(now time.Time) []dueHookRef {
	s.mu.RLock()
	items := make([]dueHookRef, 0)
	for agentID, entry := range s.agents {
		if entry == nil {
			continue
		}
		for hookID, hook := range entry.Hooks {
			if hook == nil || hook.GetStatus() != runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING {
				continue
			}
			if hook.GetScheduledFor() == nil || hook.GetScheduledFor().AsTime().IsZero() {
				continue
			}
			scheduledFor := hook.GetScheduledFor().AsTime()
			if scheduledFor.After(now) {
				continue
			}
			items = append(items, dueHookRef{agentID: agentID, hookID: hookID, scheduledFor: scheduledFor})
		}
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		if items[i].scheduledFor.Equal(items[j].scheduledFor) {
			if items[i].agentID == items[j].agentID {
				return items[i].hookID < items[j].hookID
			}
			return items[i].agentID < items[j].agentID
		}
		return items[i].scheduledFor.Before(items[j].scheduledFor)
	})
	return items
}

func gateHookExecution(entry *agentEntry, now time.Time) *hookExecutionDecision {
	if entry == nil || entry.Agent == nil || entry.State == nil {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "hook execution requires committed agent state")
	}
	if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "agent is not active")
	}
	autonomy := entry.Agent.GetAutonomy()
	if autonomy == nil || !autonomy.GetEnabled() {
		return rejectedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, "agent autonomy is disabled")
	}
	if suspendedUntil := autonomy.GetSuspendedUntil(); suspendedUntil != nil && suspendedUntil.AsTime().After(now) {
		return rescheduledHookDecision(&runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			NotBefore:   cloneTimestamp(suspendedUntil),
			Reason:      "autonomy suspended",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: cloneTimestamp(suspendedUntil),
				},
			},
		}, 0)
	}
	if autonomy.GetBudgetExhausted() {
		resumeAt := nextAutonomyWindowStart(autonomy, now)
		return rescheduledHookDecision(&runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			NotBefore:   timestamppb.New(resumeAt),
			Reason:      "autonomy budget exhausted",
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(resumeAt),
				},
			},
		}, 0)
	}
	return nil
}

func nextAutonomyWindowStart(autonomy *runtimev1.AgentAutonomyState, now time.Time) time.Time {
	if autonomy == nil || autonomy.GetWindowStartedAt() == nil {
		return now.Add(24 * time.Hour).UTC()
	}
	return autonomy.GetWindowStartedAt().AsTime().Add(24 * time.Hour).UTC()
}

func completedHookDecision(summary string, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED,
		summary:    strings.TrimSpace(summary),
		tokensUsed: tokensUsed,
	}
}

func failedHookDecision(reasonCode runtimev1.ReasonCode, message string, retryable bool, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_FAILED,
		reasonCode: reasonCode,
		message:    strings.TrimSpace(message),
		retryable:  retryable,
		tokensUsed: tokensUsed,
	}
}

func rescheduledHookDecision(nextIntent *runtimev1.NextHookIntent, tokensUsed int64) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_RESCHEDULED,
		nextIntent: cloneNextHookIntent(nextIntent),
		tokensUsed: tokensUsed,
	}
}

func rejectedHookDecision(reasonCode runtimev1.ReasonCode, message string) *hookExecutionDecision {
	return &hookExecutionDecision{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
		reasonCode: reasonCode,
		message:    strings.TrimSpace(message),
	}
}

func applyTokenUsage(entry *agentEntry, tokensUsed int64, now time.Time) {
	if entry == nil || entry.Agent == nil || entry.Agent.Autonomy == nil || tokensUsed <= 0 {
		return
	}
	entry.Agent.Autonomy.UsedTokensInWindow += tokensUsed
	if entry.Agent.Autonomy.WindowStartedAt == nil {
		entry.Agent.Autonomy.WindowStartedAt = timestamppb.New(now)
	}
	budget := entry.Agent.Autonomy.GetConfig().GetDailyTokenBudget()
	entry.Agent.Autonomy.BudgetExhausted = budget > 0 && entry.Agent.Autonomy.GetUsedTokensInWindow() >= budget
	entry.Agent.UpdatedAt = timestamppb.New(now)
}

type autonomySnapshot struct {
	usedTokens      int64
	remainingTokens int64
	budgetExhausted bool
	windowStartedAt time.Time
	hasWindowStart  bool
}

func snapshotAutonomy(state *runtimev1.AgentAutonomyState) autonomySnapshot {
	snapshot := autonomySnapshot{}
	if state == nil {
		return snapshot
	}
	snapshot.usedTokens = state.GetUsedTokensInWindow()
	snapshot.remainingTokens = remainingTokens(state)
	snapshot.budgetExhausted = state.GetBudgetExhausted()
	if state.GetWindowStartedAt() != nil {
		snapshot.windowStartedAt = state.GetWindowStartedAt().AsTime().UTC()
		snapshot.hasWindowStart = !snapshot.windowStartedAt.IsZero()
	}
	return snapshot
}

func budgetEventForTransition(agentID string, before autonomySnapshot, after *runtimev1.AgentAutonomyState, now time.Time) *runtimev1.AgentEvent {
	if after == nil {
		return nil
	}
	current := snapshotAutonomy(after)
	if before.usedTokens == current.usedTokens &&
		before.remainingTokens == current.remainingTokens &&
		before.budgetExhausted == current.budgetExhausted &&
		before.hasWindowStart == current.hasWindowStart &&
		(!before.hasWindowStart || before.windowStartedAt.Equal(current.windowStartedAt)) {
		return nil
	}
	return &runtimev1.AgentEvent{
		EventType: runtimev1.AgentEventType_AGENT_EVENT_TYPE_BUDGET,
		AgentId:   strings.TrimSpace(agentID),
		Timestamp: timestamppb.New(now.UTC()),
		Detail: &runtimev1.AgentEvent_Budget{
			Budget: &runtimev1.AgentBudgetEventDetail{
				BudgetExhausted: after.GetBudgetExhausted(),
				RemainingTokens: remainingTokens(after),
				WindowStartedAt: cloneTimestamp(after.GetWindowStartedAt()),
			},
		},
	}
}

func optionalEvents(events ...*runtimev1.AgentEvent) []*runtimev1.AgentEvent {
	out := make([]*runtimev1.AgentEvent, 0, len(events))
	for _, event := range events {
		if event != nil {
			out = append(out, event)
		}
	}
	return out
}

func triggerDetailFromIntent(intent *runtimev1.NextHookIntent) *runtimev1.HookTriggerDetail {
	if intent == nil {
		return nil
	}
	trigger := &runtimev1.HookTriggerDetail{
		TriggerKind: intent.GetTriggerKind(),
	}
	switch detail := intent.GetDetail().(type) {
	case *runtimev1.NextHookIntent_TurnCompleted:
		trigger.Detail = &runtimev1.HookTriggerDetail_TurnCompleted{
			TurnCompleted: &runtimev1.TurnCompletedTriggerDetail{
				TurnId: detail.TurnCompleted.GetAfterTurnId(),
				Track:  detail.TurnCompleted.GetTrack(),
			},
		}
	case *runtimev1.NextHookIntent_ScheduledTime:
		trigger.Detail = &runtimev1.HookTriggerDetail_ScheduledTime{
			ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
				ScheduledFor: cloneTimestamp(detail.ScheduledTime.GetScheduledFor()),
			},
		}
	case *runtimev1.NextHookIntent_UserIdle:
		var idleFor *durationpb.Duration
		if detail.UserIdle != nil && detail.UserIdle.GetIdleFor() != nil {
			idleFor = durationpb.New(detail.UserIdle.GetIdleFor().AsDuration())
		}
		trigger.Detail = &runtimev1.HookTriggerDetail_UserIdle{
			UserIdle: &runtimev1.UserIdleTriggerDetail{
				IdleFor: idleFor,
			},
		}
	case *runtimev1.NextHookIntent_ChatEnded:
		trigger.Detail = &runtimev1.HookTriggerDetail_ChatEnded{
			ChatEnded: &runtimev1.ChatEndedTriggerDetail{
				ConversationId: detail.ChatEnded.GetConversationId(),
			},
		}
	case *runtimev1.NextHookIntent_StateCondition:
		trigger.Detail = &runtimev1.HookTriggerDetail_StateCondition{
			StateCondition: &runtimev1.StateConditionTriggerDetail{
				ConditionKey:   detail.StateCondition.GetConditionKey(),
				ConditionValue: detail.StateCondition.GetConditionValue(),
			},
		}
	case *runtimev1.NextHookIntent_WorldEvent:
		trigger.Detail = &runtimev1.HookTriggerDetail_WorldEvent{
			WorldEvent: &runtimev1.WorldEventTriggerDetail{
				WorldId:   detail.WorldEvent.GetWorldId(),
				EventType: detail.WorldEvent.GetEventType(),
				EventId:   detail.WorldEvent.GetEventId(),
			},
		}
	case *runtimev1.NextHookIntent_Compound:
		triggers := make([]*runtimev1.HookTriggerDetail, 0, len(detail.Compound.GetIntents()))
		for _, nested := range detail.Compound.GetIntents() {
			if converted := triggerDetailFromIntent(nested); converted != nil {
				triggers = append(triggers, converted)
			}
		}
		trigger.Detail = &runtimev1.HookTriggerDetail_Compound{
			Compound: &runtimev1.CompoundHookTriggerDetail{
				Operator: detail.Compound.GetOperator(),
				Triggers: triggers,
			},
		}
	}
	return trigger
}
