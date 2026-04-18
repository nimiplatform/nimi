package agentcore

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
	if blocked := gateHookExecution(entry, hook, now); blocked != nil {
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
	if result.PosturePatch != nil {
		posture, err := normalizeBehavioralPosturePatch(entry.Agent.GetAgentId(), *result.PosturePatch)
		if err != nil {
			return s.failHookAt(agentID, hookID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error(), false, result.TokensUsed, now)
		}
		posture.UpdatedAt = now.UTC().Format(time.RFC3339Nano)
		if err := s.PutBehavioralPosture(ctx, posture); err != nil {
			return nil, err
		}
		entry.State.StatusText = posture.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
	} else if result.StatusText != nil {
		entry.State.StatusText = *result.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
	}
	accepted, rejected := s.writeLifeTurnCandidates(ctx, entry, hook, result.CanonicalMemoryCandidates, now)

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
	batch := make([]*runtimev1.CanonicalMemoryCandidate, 0, len(candidates))
	for _, item := range candidates {
		candidate, rejection := buildLifeTurnCanonicalMemoryCandidate(entry, hook, item, now)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		batch = append(batch, candidate)
	}
	if err := validateCanonicalMemoryCandidateBatch(batch); err != nil {
		for _, candidate := range batch {
			rejected = append(rejected, &runtimev1.CanonicalMemoryRejection{
				SourceEventId: candidate.GetSourceEventId(),
				ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				Message:       err.Error(),
			})
		}
		return accepted, rejected
	}
	for _, candidate := range batch {
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
