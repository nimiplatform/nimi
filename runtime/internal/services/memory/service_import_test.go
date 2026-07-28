package memory

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func newTestMemoryRecord(t *testing.T) (*Service, *runtimev1.MemoryBankLocator, *runtimev1.MemoryRecord) {
	t.Helper()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	ctx := context.Background()
	createResp, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: "acct-1",
					AppId:     "app.test",
				},
			},
		},
		DisplayName: "App Memory",
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-1",
				},
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   "Alice",
						Predicate: "works_at",
						Object:    "Nimi",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if len(retainResp.GetRecords()) != 1 {
		t.Fatalf("expected one retained record, got %d", len(retainResp.GetRecords()))
	}
	return svc, createResp.GetBank().GetLocator(), retainResp.GetRecords()[0]
}

func newCanonicalTestMemoryRecord(t *testing.T) (*Service, *runtimev1.MemoryBankLocator, *runtimev1.MemoryRecord) {
	t.Helper()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-canonical"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{
						Observation: "canonical memory",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	return svc, locator, retainResp.GetRecords()[0]
}

func newBoundSemanticDedupTestBank(t *testing.T) (*Service, *runtimev1.MemoryBankLocator) {
	t.Helper()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	setManagedEmbeddingProfileForTest(svc, &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-semantic-dedup"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Semantic Dedup Bank", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	return svc, locator
}

func retainSemanticMemoryForTest(t *testing.T, ctx context.Context, svc *Service, locator *runtimev1.MemoryBankLocator, subject string, predicate string, object string) *runtimev1.MemoryRecord {
	t.Helper()

	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: ulid.Make().String(),
				},
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   subject,
						Predicate: predicate,
						Object:    object,
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(%s/%s/%s): %v", subject, predicate, object, err)
	}
	if len(retainResp.GetRecords()) != 1 {
		t.Fatalf("expected one retained record, got %d", len(retainResp.GetRecords()))
	}
	return retainResp.GetRecords()[0]
}

func seedCanonicalCascadeFixture(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, sourceRecord *runtimev1.MemoryRecord, suffix string) *runtimev1.MemoryRecord {
	t.Helper()

	ctx := context.Background()
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	targetResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(target): %v", err)
	}
	target := targetResp.GetRecords()[0]
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := svc.CommitCanonicalReview(ctx, "review-cascade-"+suffix, locator, sourceRecord.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-" + suffix,
				Topic:           "project direction",
				Content:         "memory redesign review quality",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{sourceRecord.GetMemoryId()},
			},
		},
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-" + suffix,
				Dimension:       "relational",
				NormalizedKey:   "alice:" + suffix,
				Statement:       "Alice remains connected to Nimi.",
				Confidence:      0.93,
				ReviewCount:     1,
				LastReviewAt:    now,
				Status:          "admitted",
				SourceMemoryIDs: []string{sourceRecord.GetMemoryId()},
			},
		},
		Relations: []RelationCandidate{
			{
				SourceID:     sourceRecord.GetMemoryId(),
				TargetID:     target.GetMemoryId(),
				RelationType: "thematic",
				Confidence:   0.95,
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(cascade fixture): %v", err)
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-"+suffix, "project direction", "project direction", 3, 0, narrativeAliasStatusActive, now); err != nil {
		t.Fatalf("insert active alias row: %v", err)
	}
	return target
}

func assertNarrativeCascadeState(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, narrativeID string, wantStatus string) {
	t.Helper()

	var status string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM memory_narrative
		WHERE bank_locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), narrativeID).Scan(&status); err != nil {
		t.Fatalf("load memory_narrative status: %v", err)
	}
	if status != wantStatus {
		t.Fatalf("expected narrative status %q, got %q", wantStatus, status)
	}
	var activeSources int
	var deactivatedSources int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN is_active = 0 AND deactivated_at IS NOT NULL THEN 1 ELSE 0 END), 0)
		FROM narrative_source
		WHERE bank_locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), narrativeID).Scan(&activeSources, &deactivatedSources); err != nil {
		t.Fatalf("load narrative_source state: %v", err)
	}
	if activeSources != 0 || deactivatedSources == 0 {
		t.Fatalf("expected narrative_source soft-deactivated, got active=%d deactivated=%d", activeSources, deactivatedSources)
	}
	var embeddingCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), narrativeID).Scan(&embeddingCount); err != nil {
		t.Fatalf("count memory_narrative_embedding rows: %v", err)
	}
	if embeddingCount != 0 {
		t.Fatalf("expected no narrative embedding rows after cascade, got %d", embeddingCount)
	}
	var aliasCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), narrativeID).Scan(&aliasCount); err != nil {
		t.Fatalf("count memory_narrative_alias rows: %v", err)
	}
	if aliasCount != 0 {
		t.Fatalf("expected no narrative alias rows after cascade, got %d", aliasCount)
	}
}

func assertTruthCascadeState(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, truthID string, wantStatus string) {
	t.Helper()

	var status string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM agent_truth
		WHERE bank_locator_key = ? AND truth_id = ?
	`, locatorKey(locator), truthID).Scan(&status); err != nil {
		t.Fatalf("load agent_truth status: %v", err)
	}
	if status != wantStatus {
		t.Fatalf("expected truth status %q, got %q", wantStatus, status)
	}
	var activeSources int
	var deactivatedSources int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN is_active = 0 AND deactivated_at IS NOT NULL THEN 1 ELSE 0 END), 0)
		FROM truth_source
		WHERE bank_locator_key = ? AND truth_id = ?
	`, locatorKey(locator), truthID).Scan(&activeSources, &deactivatedSources); err != nil {
		t.Fatalf("load truth_source state: %v", err)
	}
	if activeSources != 0 || deactivatedSources == 0 {
		t.Fatalf("expected truth_source soft-deactivated, got active=%d deactivated=%d", activeSources, deactivatedSources)
	}
}

func assertRelationInactive(t *testing.T, svc *Service, locator *runtimev1.MemoryBankLocator, sourceID string, targetID string, relationType string) {
	t.Helper()

	var active int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT is_active
		FROM memory_relation
		WHERE bank_locator_key = ? AND source_id = ? AND target_id = ? AND relation_type = ?
	`, locatorKey(locator), sourceID, targetID, relationType).Scan(&active); err != nil {
		t.Fatalf("load memory_relation active state: %v", err)
	}
	if active != 0 {
		t.Fatalf("expected memory_relation to deactivate, got is_active=%d", active)
	}
}

type memoryEventCaptureStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	events []*runtimev1.MemoryEvent
	max    int
}

func newMemoryEventCaptureStream(parent context.Context, max int) *memoryEventCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &memoryEventCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *memoryEventCaptureStream) SetHeader(metadata.MD) error  { return nil }
func (s *memoryEventCaptureStream) SendHeader(metadata.MD) error { return nil }
func (s *memoryEventCaptureStream) SetTrailer(metadata.MD)       {}
func (s *memoryEventCaptureStream) Context() context.Context     { return s.ctx }
func (s *memoryEventCaptureStream) SendMsg(any) error            { return nil }
func (s *memoryEventCaptureStream) RecvMsg(any) error            { return nil }

func (s *memoryEventCaptureStream) Send(event *runtimev1.MemoryEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.MemoryEvent))
	if s.max <= 0 || len(s.events) >= s.max {
		s.cancel()
	}
	return nil
}

func waitForMemoryCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not satisfied before timeout")
}

type fakeReplicationBridgeAdapter struct {
	mu      sync.Mutex
	results map[string]*runtimev1.MemoryReplicationState
	seen    []string
}

func (f *fakeReplicationBridgeAdapter) SyncPendingMemory(_ context.Context, item *ReplicationBacklogItem) (*runtimev1.MemoryReplicationState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seen = append(f.seen, item.MemoryID)
	if f.results == nil {
		return nil, nil
	}
	state := f.results[item.MemoryID]
	if state == nil {
		return nil, nil
	}
	return proto.Clone(state).(*runtimev1.MemoryReplicationState), nil
}

func (f *fakeReplicationBridgeAdapter) seenMemoryIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.seen...)
}

func mustStruct(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}
