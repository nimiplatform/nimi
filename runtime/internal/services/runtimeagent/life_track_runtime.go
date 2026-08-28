package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
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
	runMaintenanceSweep := func(now time.Time) {
		if err := c.runSweep(ctx, now); err != nil && ctx.Err() == nil {
			c.svc.logger.Warn("runtime-agent life-track sweep failed", "error", err)
		}
	}
	runMaintenanceSweep(time.Now().UTC())
	ticker := time.NewTicker(lifeTrackLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			runMaintenanceSweep(tickAt.UTC())
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
	recall, err := c.assembleRecall(ctx, executionEntry, runningHook, lifeTurnRecallLimit)
	if err != nil {
		return c.applyHookDecision(agentID, intentID, failedHookDecision(reasonCodeFromError(err), err.Error(), false, 0), now)
	}
	// K-AGCORE-147: the Life Track executor consumes the committed execution
	// config text.generate binding; a missing binding is an observable
	// terminal hook failure, never a silent constant fallback.
	executionBinding, _, err := c.svc.committedTextGenerateExecutionBinding(executionEntry.Agent.GetLocalAgentRef())
	if err != nil {
		return c.applyHookDecision(agentID, intentID, failedHookDecision(reasonCodeFromError(err), err.Error(), false, 0), now)
	}
	result, err := executor(ctx, &lifeTurnRequest{
		Agent:            cloneLocalAgentRecord(executionEntry.Agent),
		State:            cloneAgentState(executionEntry.State),
		Hook:             clonePendingHook(runningHook),
		Recall:           append([]lifeTurnRecallItem(nil), recall...),
		Autonomy:         cloneAutonomy(executionEntry.Agent.GetAutonomy()),
		ExecutionBinding: executionBinding,
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

func (c lifeTrackController) assembleRecall(ctx context.Context, entry *agentEntry, hook *runtimev1.PendingHook, limit int32) ([]lifeTurnRecallItem, error) {
	if entry == nil || c.svc == nil || c.svc.cognitionMemoryFacade == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = lifeTurnRecallLimit
	}
	queryParts := make([]string, 0, 2)
	if hook != nil {
		queryParts = append(queryParts, strings.TrimSpace(hook.GetIntent().GetReason()))
	}
	queryParts = append(queryParts, strings.TrimSpace(entry.State.GetStatusText()))
	query := strings.TrimSpace(strings.Join(queryParts, " "))
	if query == "" {
		query = "agent preferences"
	}
	recalled, err := c.svc.cognitionMemoryFacade.Recall(ctx, cognitionmemory.RecallIntent{LocalAgentRef: entry.Agent.GetLocalAgentRef(), Query: query, Limit: int(limit)})
	if err != nil {
		if c.svc.logger != nil {
			c.svc.logger.Warn("optional Life Track Cognition Memory Recall unavailable", "local_agent_ref", entry.Agent.GetLocalAgentRef(), "outcome", recalled.Outcome, "error", err)
		}
		return nil, nil
	}
	if recalled.Outcome != memoryv1.OutcomeReady {
		return nil, nil
	}
	items := make([]lifeTurnRecallItem, 0, len(recalled.Hits))
	for _, hit := range recalled.Hits {
		if hit.Lifecycle != memoryv1.LifecycleCurrent || strings.TrimSpace(hit.MemoryRef) == "" || strings.TrimSpace(hit.Content) == "" || strings.TrimSpace(hit.EventRef) == "" {
			return nil, fmt.Errorf("Life Track Cognition Memory hit is incomplete or non-current")
		}
		items = append(items, lifeTurnRecallItem{
			MemoryRef: hit.MemoryRef, Content: hit.Content, EpistemicStatus: string(hit.EpistemicStatus),
			SourceExplanation: hit.SourceExplanation, ProvenanceRef: hit.EventRef,
		})
	}
	return items, nil
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
		posture, err := normalizeBehavioralPosturePatch(entry.Agent.GetLocalAgentRef(), *result.PosturePatch)
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
				c.svc.stateStatusTextChangedEvent(entry.Agent.GetLocalAgentRef(), newStatus, previousStatusText, hadPreviousStatus, lifePostureOrigin, now),
			}
		}
	}
	// Long-term Memory is derived only from the committed activity terminal
	// outbox. Runtime never promotes Life Track model candidates directly.

	beforeBudget := snapshotAutonomy(entry.Agent.GetAutonomy())
	var outcome *runtimev1.HookExecutionOutcome
	var followupEvents []*runtimev1.AgentEvent
	events := make([]*runtimev1.AgentEvent, 0, 4)
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
			followupIntent.AgentId = entry.Agent.GetLocalAgentRef()
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
			hookEventAt(entry.Agent.GetLocalAgentRef(), &runtimev1.HookExecutionOutcome{
				Intent:     proposedFollowup,
				ObservedAt: timestamppb.New(now),
			}, now),
			hookEventAt(entry.Agent.GetLocalAgentRef(), &runtimev1.HookExecutionOutcome{
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

	executionStateEvent := c.svc.refreshLifeTrackExecutionState(entry, stateEventOriginFromPendingHook(hook), now)
	events = append(events, postureStateEvents...)
	events = append(events, hookEventAt(entry.Agent.GetLocalAgentRef(), outcome, now))
	events = append(events, followupEvents...)
	if executionStateEvent != nil {
		events = append(events, executionStateEvent)
	}
	if event := budgetEventForTransition(entry.Agent.GetLocalAgentRef(), beforeBudget, entry.Agent.GetAutonomy(), now); event != nil {
		events = append(events, event)
	}
	txHook, triggerMemory, err := c.svc.cognitionMemoryActivityTerminalTxHook(entry, outcome, now)
	if err != nil {
		return nil, err
	}
	if err := c.svc.agentStateRuntime().updateAgentWithTxHook(entry, txHook, events...); err != nil {
		return nil, err
	}
	if triggerMemory {
		c.svc.triggerCognitionMemory(entry.Agent.GetLocalAgentRef())
	}
	return outcome, nil
}
