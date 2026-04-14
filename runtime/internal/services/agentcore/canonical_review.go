package agentcore

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/oklog/ulid/v2"
)

const defaultCanonicalReviewLimit = 24

type CanonicalReviewRequest struct {
	AgentID string
	Bank    *runtimev1.MemoryBankLocator
	Limit   int
}

type CanonicalReviewExecutionResult struct {
	ReviewRunID    string
	Skipped        bool
	SkipReason     string
	ClusterCount   int
	LeftoverCount  int
	NarrativeCount int
	TruthCount     int
	TokensUsed     int64
}

type CanonicalReviewExecutorRequest struct {
	Agent           *runtimev1.AgentRecord
	State           *runtimev1.AgentStateProjection
	Bank            *runtimev1.MemoryBankLocator
	CheckpointBasis string
	ExistingTruths  []memoryservice.TruthCandidate
	Clusters        []memoryservice.ReviewTopicCluster
	Leftovers       []*runtimev1.MemoryRecord
}

type CanonicalReviewExecutorResult struct {
	Outcomes   memoryservice.CanonicalReviewOutcomes
	TokensUsed int64
}

type CanonicalReviewExecutor interface {
	ExecuteCanonicalReview(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error)
}

type rejectingCanonicalReviewExecutor struct{}

func (rejectingCanonicalReviewExecutor) ExecuteCanonicalReview(context.Context, *CanonicalReviewExecutorRequest) (*CanonicalReviewExecutorResult, error) {
	return nil, fmt.Errorf("runtime internal canonical review executor unavailable or not admitted")
}

func (s *Service) HasCanonicalReviewExecutor() bool {
	return canonicalReviewExecutorConfigured(s.reviewExec)
}

func (s *Service) SetCanonicalReviewExecutor(executor CanonicalReviewExecutor) {
	if executor == nil {
		s.reviewExec = rejectingCanonicalReviewExecutor{}
		return
	}
	s.reviewExec = executor
}

func (s *Service) ExecuteCanonicalReview(ctx context.Context, req CanonicalReviewRequest) (*CanonicalReviewExecutionResult, error) {
	entry, locator, err := s.resolveCanonicalReviewTarget(req)
	if err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = defaultCanonicalReviewLimit
	}
	checkpoint, err := s.memorySvc.GetReviewCheckpoint(ctx, locator)
	if err != nil {
		return nil, err
	}
	checkpointBasis := ""
	if checkpoint != nil {
		checkpointBasis = strings.TrimSpace(checkpoint.Checkpoint)
	}
	truths, err := s.memorySvc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		return nil, err
	}
	clusters, leftovers, err := s.memorySvc.ClusterCanonicalReviewInputs(ctx, locator, checkpointBasis, limit)
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
	if s.reviewExec == nil {
		s.reviewExec = rejectingCanonicalReviewExecutor{}
	}
	reviewResult, err := s.reviewExec.ExecuteCanonicalReview(ctx, &CanonicalReviewExecutorRequest{
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
	if err := s.SavePreparedReviewRun(ctx, run); err != nil {
		return nil, err
	}
	if err := s.finalizePreparedReviewRun(ctx, run); err != nil {
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

func (s *Service) finalizePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	if run.Status == "prepared" || strings.TrimSpace(run.Status) == "" {
		run.PreparedOutcomes = memoryengine.NormalizeReviewOutcomesForWave4(run.PreparedOutcomes)
		locator, err := s.reviewRunLocator(run)
		if err != nil {
			return fmt.Errorf("resolve bank locator for review run %s: %w", run.ReviewRunID, err)
		}
		if err := s.memorySvc.CommitCanonicalReview(ctx, run.ReviewRunID, locator, run.CheckpointBasis, run.PreparedOutcomes); err != nil {
			return err
		}
		if err := s.updateReviewRunStatus(ctx, run.ReviewRunID, "memory_committed", ""); err != nil {
			return err
		}
		run.Status = "memory_committed"
	}
	if err := s.recordReviewFollowUp(ctx, run); err != nil {
		return err
	}
	return s.updateReviewRunStatus(ctx, run.ReviewRunID, "completed", "")
}

func (s *Service) resolveCanonicalReviewTarget(req CanonicalReviewRequest) (*agentEntry, *runtimev1.MemoryBankLocator, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.AgentID))
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

func canonicalReviewCheckpointBasis(clusters []memoryservice.ReviewTopicCluster, previous string) string {
	if len(clusters) == 0 {
		return strings.TrimSpace(previous)
	}
	lastCluster := clusters[len(clusters)-1]
	if len(lastCluster.RecordIDs) == 0 {
		return strings.TrimSpace(previous)
	}
	return strings.TrimSpace(lastCluster.RecordIDs[len(lastCluster.RecordIDs)-1])
}

func cloneTruthCandidates(input []memoryservice.TruthCandidate) []memoryservice.TruthCandidate {
	out := make([]memoryservice.TruthCandidate, 0, len(input))
	for _, item := range input {
		cloned := item
		cloned.SourceMemoryIDs = append([]string(nil), item.SourceMemoryIDs...)
		out = append(out, cloned)
	}
	return out
}

func cloneReviewTopicClusters(input []memoryservice.ReviewTopicCluster) []memoryservice.ReviewTopicCluster {
	out := make([]memoryservice.ReviewTopicCluster, 0, len(input))
	for _, cluster := range input {
		out = append(out, memoryservice.ReviewTopicCluster{
			RecordIDs: append([]string(nil), cluster.RecordIDs...),
			Records:   cloneMemoryRecords(cluster.Records),
		})
	}
	return out
}

func cloneMemoryRecords(input []*runtimev1.MemoryRecord) []*runtimev1.MemoryRecord {
	out := make([]*runtimev1.MemoryRecord, 0, len(input))
	for _, item := range input {
		if item != nil {
			out = append(out, cloneMemoryRecord(item))
		}
	}
	return out
}

var _ = memoryengine.ReviewOutcomes{}

func canonicalReviewExecutorConfigured(executor CanonicalReviewExecutor) bool {
	if executor == nil {
		return false
	}
	_, rejecting := executor.(rejectingCanonicalReviewExecutor)
	return !rejecting
}

func validateCanonicalReviewRelations(locator *runtimev1.MemoryBankLocator, relations []memoryservice.RelationCandidate, clusters []memoryservice.ReviewTopicCluster, leftovers []*runtimev1.MemoryRecord) ([]memoryservice.RelationCandidate, error) {
	if len(relations) == 0 {
		return nil, nil
	}
	allowedRecordIDs := make(map[string]struct{})
	for _, cluster := range clusters {
		for _, recordID := range cluster.RecordIDs {
			recordID = strings.TrimSpace(recordID)
			if recordID != "" {
				allowedRecordIDs[recordID] = struct{}{}
			}
		}
	}
	for _, record := range leftovers {
		recordID := strings.TrimSpace(record.GetMemoryId())
		if recordID != "" {
			allowedRecordIDs[recordID] = struct{}{}
		}
	}
	normalized := memoryservice.NormalizeCanonicalReviewRelations(locator, relations)
	if len(normalized) != len(relations) {
		return nil, fmt.Errorf("canonical review relation candidates failed validation")
	}
	for _, relation := range normalized {
		if _, ok := allowedRecordIDs[strings.TrimSpace(relation.SourceID)]; !ok {
			return nil, fmt.Errorf("canonical review relation source_id %s is not part of the review input set", relation.SourceID)
		}
		if _, ok := allowedRecordIDs[strings.TrimSpace(relation.TargetID)]; !ok {
			return nil, fmt.Errorf("canonical review relation target_id %s is not part of the review input set", relation.TargetID)
		}
	}
	return normalized, nil
}
