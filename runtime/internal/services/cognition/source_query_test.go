package cognition

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	nimicognition "github.com/nimiplatform/nimi/nimi-cognition/cognition"
)

func TestAgentSourceExactReadPreservesUnavailableQueryEmbedding(t *testing.T) {
	for _, queryStatus := range []string{"unconfigured", "building", "unavailable", "failure", "ready", "invalid_ready"} {
		t.Run(queryStatus, func(t *testing.T) {
			svc, scope, snapshot, query, unit := readySourceQuery(t)
			calls := 0
			svc.SetAgentSourceEmbeddingExecutor(func(context.Context, string, string, []string, string) (AgentSourceEmbeddingExecution, error) {
				calls++
				if queryStatus == "ready" {
					return AgentSourceEmbeddingExecution{Status: "ready", Identity: "embed", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
				}
				if queryStatus == "invalid_ready" {
					return AgentSourceEmbeddingExecution{Status: "ready"}, nil
				}
				return AgentSourceEmbeddingExecution{Status: queryStatus}, nil
			})

			out, err := svc.SearchAgentSource(context.Background(), "account", "local-agent", scope, snapshot, query)
			wantStatus := queryStatus
			if queryStatus == "invalid_ready" || queryStatus == "building" {
				wantStatus = "failure"
			}
			if err != nil || out.Status != wantStatus || out.GenerationStatus != "ready" || out.ExactStatus != "ready" || len(out.Units) != 1 || calls != 1 {
				t.Fatalf("query result = %#v calls=%d err=%v", out, calls, err)
			}
			hit := out.Units[0]
			if hit.Text != unit.Text || hit.SelectionBasis != "alias" || hit.MatchedTerm != "第一页" {
				t.Fatalf("exact match changed: %#v", hit)
			}
			if queryStatus == "ready" {
				if !hit.HasSemanticScore || hit.Score <= 0 {
					t.Fatalf("real semantic score was lost: %#v", hit)
				}
			} else if hit.HasSemanticScore || hit.Score != 0 {
				t.Fatalf("unavailable semantics manufactured a score: %#v", hit)
			}
		})
	}
}

func readySourceQuery(t *testing.T) (*Service, string, string, AgentSourceQuery, AgentSourceUnit) {
	t.Helper()
	svc, cleanup := newSourceTestService(t)
	t.Cleanup(cleanup)
	scope, snapshot, partition := "agent_source_exact_query", strings.Repeat("a", 64), strings.Repeat("b", 64)
	ref := AgentSourceRef{Kind: "worldEntity", WorldID: "world", RefID: "world:page", SchemaVersion: "entity/v1", ContentHash: strings.Repeat("c", 64)}
	unit := AgentSourceUnit{UnitID: "page", Category: "world_fact", SourcePath: "world.fact.page", SourceRef: ref, Text: "固定正文", ProvenanceRefs: []string{}, Priority: 100}
	coreRef := nimicognition.RuntimeSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash}
	envelope := nimicognition.RuntimeSourceIngestionEnvelope{ScopeID: scope, SnapshotIdentity: snapshot, PartitionIdentity: partition, EmbeddingStatus: "building", CoverageCount: 1, Units: []nimicognition.RuntimeSourceUnit{{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: coreRef, Text: unit.Text, ProvenanceRefs: unit.ProvenanceRefs, Priority: unit.Priority}}, Omissions: []nimicognition.RuntimeSourceOmission{}}
	auth := agentSourceAuthorization("account", scope, nimicognition.RuntimeAuthorizationActionIngestAgentSource, nimicognition.RuntimeBridgeOperationIngestAgentSource)
	building, err := svc.sourceBridge.IngestAgentSource(context.Background(), auth, envelope)
	if err != nil {
		t.Fatal(err)
	}
	envelope.Generation, envelope.EmbeddingStatus, envelope.EmbeddingIdentity, envelope.EmbeddingDimension = building.Generation, "ready", "embed", 2
	envelope.Units[0].Embedding = []float64{1, 0}
	if _, err := svc.sourceBridge.IngestAgentSource(context.Background(), auth, envelope); err != nil {
		t.Fatal(err)
	}
	query := AgentSourceQuery{Text: "第一页", PartitionIdentity: partition, UnitCount: 1, Limit: 12, ExactSourceRefs: []AgentSourceSelection{{SourceRef: ref, Basis: "alias", Term: "第一页", Units: []AgentSourceUnitBinding{{UnitID: unit.UnitID, ContentHash: AgentSourceUnitContentHash(unit)}}}}}
	return svc, scope, snapshot, query, unit
}

// Only the embedding executor is controlled; reads, scores and source deletion
// go through the actual Cognition owner in a temporary database.
func TestSourceQuerySeparatesModelExecutionFromIndexReadBudget(t *testing.T) {
	svc, scope, snapshot, query, _ := readySourceQuery(t)
	svc.SetAgentSourceEmbeddingExecutor(func(ctx context.Context, _, _ string, _ []string, purpose string) (AgentSourceEmbeddingExecution, error) {
		if purpose != "retrieval-query" {
			t.Fatalf("wrong purpose: %s", purpose)
		}
		select {
		case <-time.After(agentSourceIndexReadBudget + 100*time.Millisecond):
			return AgentSourceEmbeddingExecution{Status: "ready", Identity: "embed", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
		case <-ctx.Done():
			return AgentSourceEmbeddingExecution{}, ctx.Err()
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := svc.SearchAgentSource(ctx, "account", "local-agent", scope, snapshot, query)
	if err != nil || out.Status != "ready" || len(out.Units) != 1 || !out.Units[0].HasSemanticScore {
		t.Fatalf("model execution consumed the index budget: %+v %v", out, err)
	}
}

func TestSourceQueryRejectsCanceledOrInvalidatedInFlightResult(t *testing.T) {
	for _, change := range []string{"cancel", "delete", "new generation"} {
		t.Run(change, func(t *testing.T) {
			svc, scope, snapshot, query, unit := readySourceQuery(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			svc.SetAgentSourceEmbeddingExecutor(func(context.Context, string, string, []string, string) (AgentSourceEmbeddingExecution, error) {
				if change == "cancel" {
					cancel()
				} else if change == "delete" {
					if _, err := svc.DeleteAgentSource(ctx, "account", scope, snapshot); err != nil {
						t.Fatal(err)
					}
				} else {
					ref := unit.SourceRef
					envelope := nimicognition.RuntimeSourceIngestionEnvelope{ScopeID: scope, SnapshotIdentity: snapshot, PartitionIdentity: query.PartitionIdentity, EmbeddingStatus: "building", CoverageCount: 1, Units: []nimicognition.RuntimeSourceUnit{{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: nimicognition.RuntimeSourceRef{Kind: ref.Kind, WorldID: ref.WorldID, RefID: ref.RefID, SchemaVersion: ref.SchemaVersion, ContentHash: ref.ContentHash}, Text: unit.Text, ProvenanceRefs: unit.ProvenanceRefs, Priority: unit.Priority}}, Omissions: []nimicognition.RuntimeSourceOmission{}}
					if _, err := svc.sourceBridge.IngestAgentSource(ctx, agentSourceAuthorization("account", scope, nimicognition.RuntimeAuthorizationActionIngestAgentSource, nimicognition.RuntimeBridgeOperationIngestAgentSource), envelope); err != nil {
						t.Fatal(err)
					}
				}
				// A late executor success cannot revive the original source.
				return AgentSourceEmbeddingExecution{Status: "ready", Identity: "embed", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
			})
			out, err := svc.SearchAgentSource(ctx, "account", "local-agent", scope, snapshot, query)
			if change == "new generation" {
				if err != nil || out.Status == "ready" || out.Generation <= 1 || len(out.Units) != 1 || out.Units[0].HasSemanticScore {
					t.Fatalf("old vector entered the new generation: %+v %v", out, err)
				}
				return
			}
			if len(out.Units) != 0 || (change == "cancel" && !errors.Is(err, context.Canceled)) {
				t.Fatalf("late result survived %s: %+v %v", change, out, err)
			}
		})
	}
}
