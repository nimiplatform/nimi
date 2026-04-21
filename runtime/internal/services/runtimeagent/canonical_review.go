package runtimeagent

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
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
	return s.reviewRuntime().hasExecutor()
}

func (s *Service) SetCanonicalReviewExecutor(executor CanonicalReviewExecutor) {
	s.setCanonicalReviewExecutor(executor)
}

func (s *Service) ExecuteCanonicalReview(ctx context.Context, req CanonicalReviewRequest) (*CanonicalReviewExecutionResult, error) {
	return s.reviewRuntime().execute(ctx, req)
}

func (s *Service) finalizePreparedReviewRun(ctx context.Context, run ReviewRunRecord) error {
	return s.reviewRuntime().finalizePreparedRun(ctx, run)
}

func (s *Service) resolveCanonicalReviewTarget(req CanonicalReviewRequest) (*agentEntry, *runtimev1.MemoryBankLocator, error) {
	return s.reviewRuntime().resolveTarget(req)
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
