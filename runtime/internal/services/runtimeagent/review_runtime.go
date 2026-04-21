package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type reviewRuntime struct {
	svc *Service
}

func (s *Service) reviewRuntime() reviewRuntime {
	return reviewRuntime{svc: s}
}

func (r reviewRuntime) hasExecutor() bool {
	return canonicalReviewExecutorConfigured(r.currentExecutor())
}

func (r reviewRuntime) currentExecutor() CanonicalReviewExecutor {
	if r.svc == nil {
		return rejectingCanonicalReviewExecutor{}
	}
	return r.svc.currentCanonicalReviewExecutor()
}

func (r reviewRuntime) execute(ctx context.Context, req CanonicalReviewRequest) (*CanonicalReviewExecutionResult, error) {
	entry, locator, err := r.resolveTarget(req)
	if err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultCanonicalReviewLimit
	}
	checkpoint, err := r.svc.memorySvc.GetReviewCheckpoint(ctx, locator)
	if err != nil {
		return nil, err
	}
	checkpointBasis := ""
	if checkpoint != nil {
		checkpointBasis = strings.TrimSpace(checkpoint.Checkpoint)
	}
	truths, err := r.svc.memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		return nil, err
	}
	clusters, leftovers, err := r.svc.memorySvc.ClusterCanonicalReviewInputs(ctx, locator, checkpointBasis, limit)
	if err != nil {
		return nil, err
	}
	if len(clusters) == 0 {
		return &CanonicalReviewExecutionResult{
			Skipped:       true,
			SkipReason:    "no_review_clusters",
			LeftoverCount: len(leftovers),
		}, nil
	}
	reviewResult, err := r.currentExecutor().ExecuteCanonicalReview(ctx, &CanonicalReviewExecutorRequest{
		Agent:           cloneAgentRecord(entry.Agent),
		State:           cloneAgentState(entry.State),
		Bank:            cloneLocator(locator),
		CheckpointBasis: checkpointBasis,
		ExistingTruths:  cloneTruthCandidates(truths),
		Clusters:        cloneReviewTopicClusters(clusters),
		Leftovers:       cloneMemoryRecords(leftovers),
	})
	if err != nil {
		return nil, err
	}
	normalizedRelations, err := validateCanonicalReviewRelations(locator, reviewResult.Outcomes.Relations, clusters, leftovers)
	if err != nil {
		return nil, err
	}
	reviewResult.Outcomes.Relations = normalizedRelations
	reviewRunID := "review_" + ulid.Make().String()
	run := ReviewRunRecord{
		ReviewRunID:      reviewRunID,
		AgentID:          entry.Agent.GetAgentId(),
		BankLocatorKey:   memoryservice.LocatorKey(locator),
		CheckpointBasis:  canonicalReviewCheckpointBasis(clusters, checkpointBasis),
		PreparedOutcomes: reviewResult.Outcomes,
	}
	if err := r.savePreparedReviewRun(ctx, run); err != nil {
		return nil, err
	}
	if err := r.finalizePreparedRun(ctx, run); err != nil {
		return nil, err
	}
	return &CanonicalReviewExecutionResult{
		ReviewRunID:    reviewRunID,
		ClusterCount:   len(clusters),
		LeftoverCount:  len(leftovers),
		NarrativeCount: len(reviewResult.Outcomes.Narratives),
		TruthCount:     len(reviewResult.Outcomes.Truths),
		TokensUsed:     reviewResult.TokensUsed,
	}, nil
}

func (r reviewRuntime) finalizePreparedRun(ctx context.Context, run ReviewRunRecord) error {
	if run.Status == "prepared" || strings.TrimSpace(run.Status) == "" {
		run.PreparedOutcomes = memoryengine.NormalizeReviewOutcomesForWave4(run.PreparedOutcomes)
		locator, err := r.reviewRunLocator(run)
		if err != nil {
			return fmt.Errorf("resolve bank locator for review run %s: %w", run.ReviewRunID, err)
		}
		if err := r.svc.memorySvc.CommitCanonicalReview(ctx, run.ReviewRunID, locator, run.CheckpointBasis, run.PreparedOutcomes); err != nil {
			return err
		}
		if err := r.updateReviewRunStatus(ctx, run.ReviewRunID, "memory_committed", ""); err != nil {
			return err
		}
		run.Status = "memory_committed"
	}
	if err := r.recordReviewFollowUp(ctx, run); err != nil {
		return err
	}
	return r.updateReviewRunStatus(ctx, run.ReviewRunID, "completed", "")
}

func (r reviewRuntime) resolveTarget(req CanonicalReviewRequest) (*agentEntry, *runtimev1.MemoryBankLocator, error) {
	entry, err := r.svc.agentByID(strings.TrimSpace(req.AgentID))
	if err != nil {
		return nil, nil, err
	}
	locator := cloneLocator(req.Bank)
	if locator == nil {
		locator = &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: entry.Agent.GetAgentId()},
			},
		}
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		if locator.GetAgentCore() == nil || strings.TrimSpace(locator.GetAgentCore().GetAgentId()) != strings.TrimSpace(entry.Agent.GetAgentId()) {
			return nil, nil, fmt.Errorf("agent_core review bank must match agent_id")
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		if locator.GetAgentDyadic() == nil || strings.TrimSpace(locator.GetAgentDyadic().GetAgentId()) != strings.TrimSpace(entry.Agent.GetAgentId()) {
			return nil, nil, fmt.Errorf("agent_dyadic review bank must match agent_id")
		}
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		if err := validateWorldSharedAgentState(entry); err != nil {
			return nil, nil, err
		}
		if locator.GetWorldShared() == nil || strings.TrimSpace(locator.GetWorldShared().GetWorldId()) != strings.TrimSpace(entry.State.GetActiveWorldId()) {
			return nil, nil, fmt.Errorf("world_shared review bank must match runtime-owned active_world_id")
		}
	default:
		return nil, nil, fmt.Errorf("canonical review requires canonical agent-facing bank scope")
	}
	return entry, locator, nil
}

func (r reviewRuntime) runSchedulingSweep(ctx context.Context, now time.Time) error {
	if !r.hasExecutor() {
		return nil
	}
	recoverableBanks, err := r.recoverableBanks(ctx)
	if err != nil {
		return err
	}
	for _, target := range r.schedulingTargets() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if target.locator == nil {
			continue
		}
		if _, blocked := recoverableBanks[memoryservice.LocatorKey(target.locator)]; blocked {
			continue
		}
		eligible, err := r.bankEligible(ctx, target.locator, now)
		if err != nil {
			return err
		}
		if !eligible {
			continue
		}
		if _, err := r.execute(ctx, CanonicalReviewRequest{
			AgentID: target.agentID,
			Bank:    cloneLocator(target.locator),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r reviewRuntime) schedulingTargets() []scheduledCanonicalReviewTarget {
	r.svc.mu.RLock()
	entries := make([]*agentEntry, 0, len(r.svc.agents))
	for _, entry := range r.svc.agents {
		entries = append(entries, &agentEntry{
			Agent: cloneAgentRecord(entry.Agent),
			State: cloneAgentState(entry.State),
		})
	}
	r.svc.mu.RUnlock()

	targets := make([]scheduledCanonicalReviewTarget, 0)
	for _, entry := range entries {
		if entry == nil || entry.Agent == nil || entry.State == nil {
			continue
		}
		if entry.Agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			continue
		}
		if entry.State.GetExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			continue
		}
		for _, locator := range r.svc.memoryPolicyRuntime().queryLocators(entry, nil) {
			if locator == nil {
				continue
			}
			targets = append(targets, scheduledCanonicalReviewTarget{
				agentID: entry.Agent.GetAgentId(),
				locator: cloneLocator(locator),
			})
		}
	}
	return targets
}

func (r reviewRuntime) recoverableBanks(ctx context.Context) (map[string]struct{}, error) {
	if r.svc.reviews == nil {
		return nil, nil
	}
	runs, err := r.svc.reviews.ListRecoverableReviewRuns(ctx)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(runs))
	for _, run := range runs {
		key := strings.TrimSpace(run.BankLocatorKey)
		if key == "" {
			continue
		}
		out[key] = struct{}{}
	}
	return out, nil
}

func (r reviewRuntime) bankEligible(ctx context.Context, locator *runtimev1.MemoryBankLocator, now time.Time) (bool, error) {
	if locator == nil {
		return false, nil
	}
	if _, err := r.svc.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: cloneLocator(locator)}); err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, err
	}
	followUp, err := r.getReviewFollowUp(ctx, locator)
	if err != nil {
		return false, err
	}
	if followUp == nil {
		return true, nil
	}
	completedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(followUp.CompletedAt))
	if err != nil {
		return false, err
	}
	return !completedAt.After(now.Add(-canonicalReviewEligibilityWindow)), nil
}

func (r reviewRuntime) putBehavioralPosture(ctx context.Context, posture BehavioralPosture) error {
	if r.svc.postures == nil {
		return fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return r.svc.postures.PutBehavioralPosture(ctx, posture)
}

func (r reviewRuntime) getBehavioralPosture(ctx context.Context, agentID string) (*BehavioralPosture, error) {
	if r.svc.postures == nil {
		return nil, fmt.Errorf("behavioral posture persistence is unavailable")
	}
	return r.svc.postures.GetBehavioralPosture(ctx, agentID)
}

func (r reviewRuntime) savePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	if r.svc.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return r.svc.reviews.SavePreparedReviewRun(ctx, run)
}

func (r reviewRuntime) updateReviewRunStatus(ctx context.Context, reviewRunID string, statusValue string, failureMessage string) error {
	if r.svc.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return r.svc.reviews.UpdateReviewRunStatus(ctx, reviewRunID, statusValue, failureMessage)
}

func (r reviewRuntime) recordReviewFollowUp(ctx context.Context, run ReviewRunRecord) error {
	if r.svc.reviews == nil {
		return fmt.Errorf("review persistence is unavailable")
	}
	return r.svc.reviews.RecordReviewFollowUp(ctx, run)
}

func (r reviewRuntime) getReviewFollowUp(ctx context.Context, locator *runtimev1.MemoryBankLocator) (*ReviewFollowUpRecord, error) {
	if r.svc.reviews == nil {
		return nil, fmt.Errorf("review persistence is unavailable")
	}
	return r.svc.reviews.GetReviewFollowUp(ctx, locator)
}

func (r reviewRuntime) recordRecallFeedback(ctx context.Context, feedback AgentMemoryRecallFeedback) error {
	_, locator, err := r.resolveTarget(CanonicalReviewRequest{
		AgentID: feedback.AgentID,
		Bank:    feedback.Bank,
	})
	if err != nil {
		return err
	}
	return r.svc.memorySvc.RecordRecallFeedback(ctx, memoryservice.RecallFeedback{
		FeedbackID:   feedback.FeedbackID,
		Bank:         locator,
		TargetKind:   feedback.TargetKind,
		TargetID:     feedback.TargetID,
		Polarity:     feedback.Polarity,
		QueryText:    feedback.QueryText,
		SourceSystem: feedback.SourceSystem,
	})
}

func (r reviewRuntime) recoverRuns(ctx context.Context) error {
	if r.svc.reviews == nil {
		return nil
	}
	runs, err := r.svc.reviews.ListRecoverableReviewRuns(ctx)
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := r.finalizePreparedRun(ctx, run); err != nil {
			_ = r.updateReviewRunStatus(ctx, run.ReviewRunID, "failed", err.Error())
			continue
		}
	}
	return nil
}

func (r reviewRuntime) reviewRunLocator(run ReviewRunRecord) (*runtimev1.MemoryBankLocator, error) {
	locator, err := memoryengine.LocatorKeyToMemoryBankLocator(run.BankLocatorKey)
	if err != nil {
		return nil, fmt.Errorf("resolve bank locator for review run %s: %w", run.ReviewRunID, err)
	}
	return locator, nil
}
