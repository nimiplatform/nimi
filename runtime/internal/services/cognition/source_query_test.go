package cognition

import (
	"context"
	"strings"
	"testing"

	nimicognition "github.com/nimiplatform/nimi/nimi-cognition/cognition"
)

func TestAgentSourceExactReadPreservesUnavailableQueryEmbedding(t *testing.T) {
	for _, queryStatus := range []string{"unconfigured", "building", "unavailable", "failure", "ready", "invalid_ready"} {
		t.Run(queryStatus, func(t *testing.T) {
			svc, cleanup := newSourceTestService(t)
			defer cleanup()
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
			query := AgentSourceQuery{Text: "第一页", PartitionIdentity: partition, UnitCount: 1, Limit: 12, ExactSourceRefs: []AgentSourceSelection{{SourceRef: ref, Basis: "alias", Term: "第一页", Units: []AgentSourceUnitBinding{{UnitID: unit.UnitID, ContentHash: AgentSourceUnitContentHash(unit)}}}}}
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
