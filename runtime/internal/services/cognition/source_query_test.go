package cognition

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
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

func TestSourceQueryCorruptVectorKeepsOnlyVerifiedExactBody(t *testing.T) {
	svc, scope, snapshot, query, unit := readySourceQuery(t)
	db, err := sql.Open("sqlite", filepath.Join(svc.root, "cognition-agent-source-v1.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	}()
	if _, err := db.Exec(`UPDATE runtime_source_unit SET embedding_json='bad'`); err != nil {
		t.Fatal(err)
	}
	svc.SetAgentSourceEmbeddingExecutor(func(context.Context, string, string, []string, string) (AgentSourceEmbeddingExecution, error) {
		t.Fatal("known corrupt vector dispatched an embedding")
		return AgentSourceEmbeddingExecution{}, nil
	})
	out, err := svc.SearchAgentSource(context.Background(), "account", "local-agent", scope, snapshot, query)
	if err != nil || out.Status != "failure" || out.ExactStatus != "ready" || len(out.Units) != 1 || out.Units[0].Text != unit.Text || out.Units[0].HasSemanticScore {
		t.Fatalf("bad exact outcome: %+v %v", out, err)
	}
	query.ExactSourceRefs = nil
	out, err = svc.SearchAgentSource(context.Background(), "account", "local-agent", scope, snapshot, query)
	if !nimicognition.IsRuntimeSourceVectorCorrupt(err) || len(out.Units) > 0 {
		t.Fatalf("semantic failure hidden: %+v %v", out, err)
	}
}

// Saturate a single semantic phase until its actual child deadline. Exact
// reads still delegate to the authorized SQLite bridge with the original hash.
type delayedSourceReader struct {
	agentSourceBridge
	block string
}

func (d delayedSourceReader) InspectAgentSource(ctx context.Context, a nimicognition.RuntimeAuthorization, scope, snapshot string) (nimicognition.RuntimeSourceOutcome, error) {
	if d.block == "inspect" {
		<-ctx.Done()
		return nimicognition.RuntimeSourceOutcome{}, ctx.Err()
	}
	return d.agentSourceBridge.InspectAgentSource(ctx, a, scope, snapshot)
}
func (d delayedSourceReader) SearchAgentSource(ctx context.Context, a nimicognition.RuntimeAuthorization, scope, snapshot, embedding, query string, vector []float64, limit int) (nimicognition.RuntimeSourceOutcome, error) {
	if d.block == "score" {
		<-ctx.Done()
		return nimicognition.RuntimeSourceOutcome{}, ctx.Err()
	}
	return d.agentSourceBridge.SearchAgentSource(ctx, a, scope, snapshot, embedding, query, vector, limit)
}
func (d delayedSourceReader) ReadAgentSourceReferences(ctx context.Context, a nimicognition.RuntimeAuthorization, r nimicognition.RuntimeSourceReferenceRead) (nimicognition.RuntimeSourceOutcome, error) {
	if d.block == "exact" {
		<-ctx.Done()
		return nimicognition.RuntimeSourceOutcome{}, ctx.Err()
	}
	return d.agentSourceBridge.ReadAgentSourceReferences(ctx, a, r)
}
func TestExactSourceBudgetStartsBeforeInspection(t *testing.T) {
	for _, phase := range []string{"inspect", "score", "exact"} {
		t.Run(phase, func(t *testing.T) {
			svc, scope, snapshot, query, unit := readySourceQuery(t)
			svc.sourceBridge = delayedSourceReader{svc.sourceBridge, phase}
			calls := 0
			svc.SetAgentSourceEmbeddingExecutor(func(context.Context, string, string, []string, string) (AgentSourceEmbeddingExecution, error) {
				calls++
				return AgentSourceEmbeddingExecution{Status: "ready", Identity: "embed", Dimension: 2, Vectors: [][]float64{{1, 0}}}, nil
			})
			start := time.Now()
			out, err := svc.SearchAgentSource(context.Background(), "account", "agent", scope, snapshot, query)
			if phase == "exact" {
				if !errors.Is(err, context.DeadlineExceeded) || len(out.Units) != 0 {
					t.Fatalf("exact deadline: %+v %v", out, err)
				}
			} else if err != nil || out.Status != "timeout" || out.ExactStatus != "ready" || len(out.Units) != 1 || out.Units[0].Text != unit.Text || out.Units[0].HasSemanticScore {
				t.Fatalf("exact body lost after %s: %+v %v", phase, out, err)
			}
			if phase == "inspect" && calls != 0 || phase != "inspect" && calls != 1 {
				t.Fatalf("model calls=%d", calls)
			}
			t.Logf("phase=%s elapsed=%s model_calls=%d exact=%d", phase, time.Since(start), calls, len(out.Units))
		})
	}
}

func BenchmarkAgentSourceSemanticSearch(b *testing.B) {
	for _, count := range []int{128, 512} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			svc, close := newSourceTestService(b)
			b.Cleanup(close)
			ctx := context.Background()
			scope := "agent_source_benchmark"
			snapshot := strings.Repeat("a", 64)
			envelope := nimicognition.RuntimeSourceIngestionEnvelope{ScopeID: scope, SnapshotIdentity: snapshot, PartitionIdentity: strings.Repeat("b", 64), EmbeddingStatus: "building", CoverageCount: uint32(count), Omissions: []nimicognition.RuntimeSourceOmission{}}
			ref := nimicognition.RuntimeSourceRef{Kind: "worldEntity", WorldID: "world", RefID: "entity", SchemaVersion: "entity/v1", ContentHash: strings.Repeat("c", 64)}
			for i := 0; i < count; i++ {
				id := fmt.Sprintf("unit-%05d", i)
				envelope.Units = append(envelope.Units, nimicognition.RuntimeSourceUnit{UnitID: id, Category: "world_fact", SourcePath: "world.fact." + id, SourceRef: ref, Text: "a bounded world fact", ProvenanceRefs: []string{}, Priority: 20})
			}
			auth := agentSourceAuthorization("account", scope, nimicognition.RuntimeAuthorizationActionIngestAgentSource, nimicognition.RuntimeBridgeOperationIngestAgentSource)
			created, err := svc.sourceBridge.IngestAgentSource(ctx, auth, envelope)
			if err != nil {
				b.Fatal(err)
			}
			vec := make([]float64, 768)
			for i := range vec {
				vec[i] = float64((i%31)+1) / 31
			}
			envelope.Generation, envelope.EmbeddingIdentity, envelope.EmbeddingDimension, envelope.EmbeddingStatus = created.Generation, "bench", len(vec), "ready"
			for i := range envelope.Units {
				envelope.Units[i].Embedding = vec
			}
			if _, err = svc.sourceBridge.IngestAgentSource(ctx, auth, envelope); err != nil {
				b.Fatal(err)
			}
			svc.SetAgentSourceEmbeddingExecutor(func(context.Context, string, string, []string, string) (AgentSourceEmbeddingExecution, error) {
				return AgentSourceEmbeddingExecution{Status: "ready", Identity: "bench", Dimension: len(vec), Vectors: [][]float64{vec}}, nil
			})
			for b.Loop() {
				out, err := svc.SearchAgentSource(ctx, "account", "agent", scope, snapshot, AgentSourceQuery{Text: "world fact", Limit: 12})
				if err != nil || len(out.Units) != 12 {
					b.Fatalf("query count=%d err=%v", len(out.Units), err)
				}
			}
		})
	}
}
