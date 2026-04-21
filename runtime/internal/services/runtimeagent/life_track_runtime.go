package runtimeagent

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

type lifeTrackController struct {
	svc *Service
}

func (s *Service) lifeTrackController() lifeTrackController {
	return lifeTrackController{svc: s}
}

func (c lifeTrackController) hasExecutor() bool {
	executor := c.currentExecutor()
	_, rejecting := executor.(rejectingLifeTrackExecutor)
	return !rejecting
}

func (c lifeTrackController) currentExecutor() LifeTrackExecutor {
	if c.svc == nil {
		return rejectingLifeTrackExecutor{}
	}
	return c.svc.currentLifeTrackExecutorFromBridge()
}

func (c lifeTrackController) runLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	runMaintenanceSweep := func(now time.Time, lastCanonicalReviewSweep *time.Time) {
		if shouldRunCanonicalReviewSchedulingSweep(*lastCanonicalReviewSweep, now) {
			*lastCanonicalReviewSweep = now
			if err := c.svc.runCanonicalReviewSchedulingSweep(ctx, now); err != nil && ctx.Err() == nil {
				c.svc.logger.Warn("runtime-agent canonical-review scheduling sweep failed", "error", err)
			}
		}
		if err := c.runSweep(ctx, now); err != nil && ctx.Err() == nil {
			c.svc.logger.Warn("runtime-agent life-track sweep failed", "error", err)
		}
	}
	var lastCanonicalReviewSweep time.Time
	runMaintenanceSweep(time.Now().UTC(), &lastCanonicalReviewSweep)
	ticker := time.NewTicker(lifeTrackLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			runMaintenanceSweep(tickAt.UTC(), &lastCanonicalReviewSweep)
		}
	}
}

func (c lifeTrackController) runSweep(ctx context.Context, now time.Time) error {
	if err := c.svc.reconcileCadenceHooks(now); err != nil {
		return err
	}
	_, err := c.executeDueHooks(ctx, now, c.hookExecutor())
	if err != nil {
		return err
	}
	return c.svc.reconcileCadenceHooks(now)
}

func (c lifeTrackController) hookExecutor() hookExecutor {
	executor := c.currentExecutor()
	return func(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		return executor.ExecuteLifeTrackHook(ctx, req)
	}
}

func (c lifeTrackController) executeDueHooks(ctx context.Context, now time.Time, executor hookExecutor) ([]*runtimev1.HookExecutionOutcome, error) {
	if executor == nil {
		return nil, fmt.Errorf("hook executor is required")
	}
	dueHooks := c.svc.duePendingHooks(now)
	outcomes := make([]*runtimev1.HookExecutionOutcome, 0, len(dueHooks))
	for _, item := range dueHooks {
		select {
		case <-ctx.Done():
			return outcomes, ctx.Err()
		default:
		}
		outcome, err := c.executePendingHook(ctx, item.agentID, item.hookID, now, executor)
		if err != nil {
			return outcomes, err
		}
		if outcome != nil {
			outcomes = append(outcomes, outcome)
		}
	}
	return outcomes, nil
}

func (c lifeTrackController) executePendingHook(ctx context.Context, agentID string, intentID string, now time.Time, executor hookExecutor) (*runtimev1.HookExecutionOutcome, error) {
	if executor == nil {
		return nil, fmt.Errorf("hook executor is required")
	}
	entry, err := c.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	hook := entry.Hooks[strings.TrimSpace(intentID)]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	if hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING {
		return nil, nil
	}
	if hook.GetScheduledFor() != nil && hook.GetScheduledFor().AsTime().After(now) {
		return nil, nil
	}
	if blocked := gateHookExecution(entry, hook, now); blocked != nil {
		return c.applyHookDecision(agentID, intentID, blocked, now)
	}
	if _, err := c.svc.markHookRunningAt(agentID, intentID, now); err != nil {
		return nil, err
	}
	executionEntry, err := c.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	runningHook := executionEntry.Hooks[strings.TrimSpace(intentID)]
	if runningHook == nil {
		return nil, status.Error(codes.NotFound, "hook not found after transition")
	}
	recall, err := c.assembleRecall(ctx, executionEntry, lifeTurnRecallLimit)
	if err != nil {
		return c.applyHookDecision(agentID, intentID, failedHookDecision(reasonCodeFromError(err), err.Error(), false, 0), now)
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
			return c.applyHookDecision(agentID, intentID, executionErr.decision(), now)
		}
		return c.applyHookDecision(agentID, intentID, failedHookDecision(runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, err.Error(), false, 0), now)
	}
	if result == nil {
		result = &lifeTurnResult{}
	}
	return c.applyResult(ctx, agentID, intentID, result, now)
}

func (c lifeTrackController) applyHookDecision(agentID string, intentID string, decision *hookExecutionDecision, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	if decision == nil {
		return c.svc.completeHookAt(agentID, intentID, "", 0, now)
	}
	switch decision.admissionState {
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED:
		return c.svc.completeHookAt(agentID, intentID, decision.summary, decision.tokensUsed, now)
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_FAILED:
		return c.svc.failHookAt(agentID, intentID, decision.reasonCode, decision.message, decision.retryable, decision.tokensUsed, now)
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED:
		return c.svc.rescheduleHookAt(agentID, intentID, decision.nextIntent, decision.tokensUsed, now)
	case runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED:
		return c.svc.rejectHookAt(agentID, intentID, decision.reasonCode, decision.message, now)
	default:
		return nil, status.Error(codes.InvalidArgument, "unsupported hook execution decision")
	}
}

func (c lifeTrackController) assembleRecall(ctx context.Context, entry *agentEntry, limit int32) ([]*runtimev1.CanonicalMemoryView, error) {
	if entry == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = lifeTurnRecallLimit
	}
	views := make([]*runtimev1.CanonicalMemoryView, 0)
	for _, locator := range c.svc.queryLocatorsForAgent(entry, nil) {
		if _, err := c.svc.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: locator}); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			return nil, err
		}
		resp, err := c.svc.memorySvc.History(ctx, &runtimev1.HistoryRequest{
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

func (c lifeTrackController) applyResult(ctx context.Context, agentID string, intentID string, result *lifeTurnResult, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	entry, err := c.svc.agentByID(strings.TrimSpace(agentID))
	if err != nil {
		return nil, err
	}
	intentID = strings.TrimSpace(intentID)
	hook := entry.Hooks[intentID]
	if hook == nil {
		return nil, status.Error(codes.NotFound, "hook not found")
	}
	if hookAdmissionState(hook) != runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RUNNING {
		return nil, status.Error(codes.FailedPrecondition, "hook is not running")
	}

	if result == nil {
		result = &lifeTurnResult{}
	}
	// Life-track posture/status origin linkage is OPTIONAL per K-AGCORE-037
	// state_envelope: `originating_turn_id` is NOT a chat turn here, but hook
	// lifecycle does carry its own `originating_turn_id`/`originating_stream_id`
	// when the hook itself originated from a chat turn. We forward only what is
	// real on the triggering HookIntent; runtime MUST NOT fabricate linkage.
	triggerIntent := hook.GetIntent()
	lifePostureOrigin := stateEventOrigin{
		ConversationAnchorID: strings.TrimSpace(triggerIntent.GetConversationAnchorId()),
		OriginatingTurnID:    strings.TrimSpace(triggerIntent.GetOriginatingTurnId()),
		OriginatingStreamID:  strings.TrimSpace(triggerIntent.GetOriginatingStreamId()),
	}
	var postureStateEvents []*runtimev1.AgentEvent
	previousStatusText := strings.TrimSpace(entry.State.GetStatusText())
	hadPreviousStatus := previousStatusText != ""
	if result.PosturePatch != nil {
		posture, err := normalizeBehavioralPosturePatch(entry.Agent.GetAgentId(), *result.PosturePatch)
		if err != nil {
			return c.svc.failHookAt(agentID, intentID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error(), false, result.TokensUsed, now)
		}
		posture.UpdatedAt = now.UTC().Format(time.RFC3339Nano)
		stateEvents, err := c.svc.applyBehavioralPostureUpdate(ctx, entry, posture, lifePostureOrigin, now)
		if err != nil {
			return nil, err
		}
		entry.State.StatusText = posture.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
		postureStateEvents = stateEvents
	} else if result.StatusText != nil {
		entry.State.StatusText = *result.StatusText
		entry.State.UpdatedAt = timestamppb.New(now)
		if newStatus := strings.TrimSpace(*result.StatusText); newStatus != previousStatusText {
			postureStateEvents = []*runtimev1.AgentEvent{
				c.svc.stateStatusTextChangedEvent(entry.Agent.GetAgentId(), newStatus, previousStatusText, hadPreviousStatus, lifePostureOrigin, now),
			}
		}
	}
	accepted, rejected := c.writeCandidates(ctx, entry, hook, result.CanonicalMemoryCandidates, now)

	beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
	var outcome *runtimev1.HookExecutionOutcome
	var followupEvents []*runtimev1.AgentEvent
	events := make([]*runtimev1.AgentEvent, 0, 4+len(accepted))
	applyTokenUsage(entry, result.TokensUsed, now)
	if result.NextHookIntent != nil {
		if err := validateHookIntent(result.NextHookIntent); err != nil {
			return c.svc.failHookAt(agentID, intentID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error(), false, result.TokensUsed, now)
		}
		scheduledFor, err := resolveHookScheduledFor(result.NextHookIntent, now)
		if err != nil {
			return c.svc.failHookAt(agentID, intentID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err.Error(), false, result.TokensUsed, now)
		}
		// Transition current hook to RESCHEDULED.
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_RESCHEDULED
		// Admit follow-up HookIntent as new PendingHook.
		followupIntent := cloneHookIntent(result.NextHookIntent)
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
			AdmittedAt:   timestamppb.New(now),
		}
		entry.Hooks[followupIntent.GetIntentId()] = followup
		outcome = &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
		}
		proposedFollowup := cloneHookIntent(followupIntent)
		proposedFollowup.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PROPOSED
		followupEvents = []*runtimev1.AgentEvent{
			hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				Intent:     proposedFollowup,
				ObservedAt: timestamppb.New(now),
			}, now),
			hookEventAt(entry.Agent.GetAgentId(), &runtimev1.HookExecutionOutcome{
				Intent:     cloneHookIntent(followupIntent),
				ObservedAt: timestamppb.New(now),
			}, now),
		}
	} else {
		hook.Intent.AdmissionState = runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED
		outcome = &runtimev1.HookExecutionOutcome{
			Intent:     cloneHookIntent(hook.GetIntent()),
			ObservedAt: timestamppb.New(now),
			Message:    strings.TrimSpace(result.Summary),
		}
	}

	refreshLifeTrackState(entry, now)
	events = append(events, postureStateEvents...)
	events = append(events, hookEventAt(entry.Agent.GetAgentId(), outcome, now))
	events = append(events, followupEvents...)
	if len(accepted) > 0 || len(rejected) > 0 {
		events = append(events, c.svc.newEventAt(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
				Rejected: cloneCanonicalMemoryRejections(rejected),
			},
		}, now))
	}
	if event := budgetEventForTransition(entry.Agent.GetAgentId(), beforeBudget, entry.Agent.GetAutonomy(), now); event != nil {
		events = append(events, event)
	}
	if err := c.svc.updateAgent(entry, events...); err != nil {
		return nil, err
	}
	return outcome, nil
}

func (s *Service) writeLifeTurnCandidates(ctx context.Context, entry *agentEntry, hook *runtimev1.PendingHook, candidates []*lifeTurnMemoryCandidate, now time.Time) ([]*runtimev1.CanonicalMemoryView, []*runtimev1.CanonicalMemoryRejection) {
	return s.lifeTrackController().writeCandidates(ctx, entry, hook, candidates, now)
}

func (c lifeTrackController) writeCandidates(ctx context.Context, entry *agentEntry, hook *runtimev1.PendingHook, candidates []*lifeTurnMemoryCandidate, now time.Time) ([]*runtimev1.CanonicalMemoryView, []*runtimev1.CanonicalMemoryRejection) {
	if len(candidates) == 0 {
		return nil, nil
	}
	prepared := make([]*runtimev1.CanonicalMemoryCandidate, 0, len(candidates))
	rejected := make([]*runtimev1.CanonicalMemoryRejection, 0)
	sourceEventID := ""
	if hook != nil {
		sourceEventID = hookIntentID(hook)
	}
	for _, candidate := range candidates {
		item, rejection := buildLifeTurnCanonicalMemoryCandidate(entry, hook, candidate, now)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		prepared = append(prepared, item)
	}
	if err := validateCanonicalMemoryCandidateBatch(prepared); err != nil {
		reason := strings.TrimSpace(err.Error())
		for _, item := range prepared {
			rejected = append(rejected, &runtimev1.CanonicalMemoryRejection{
				SourceEventId: firstNonEmpty(strings.TrimSpace(item.GetSourceEventId()), sourceEventID),
				ReasonCode:    runtimev1.ReasonCode_AI_OUTPUT_INVALID,
				Message:       reason,
			})
		}
		return nil, rejected
	}
	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(prepared))
	for _, item := range prepared {
		view, rejection := c.svc.writeCandidate(ctx, entry, item)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	return accepted, rejected
}
