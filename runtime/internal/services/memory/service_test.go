package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestMemoryServiceCreateRetainRecallDelete(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

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
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-1",
				},
				Metadata: mustStruct(t, map[string]any{"source": "unit-test"}),
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:    "Alice",
						Predicate:  "works_at",
						Object:     "Nimi",
						Confidence: 0.9,
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if len(retainResp.GetRecords()) != 1 {
		t.Fatalf("expected 1 retained record, got %d", len(retainResp.GetRecords()))
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryRecallQuery{
			Query: "Where does Alice work?",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(recallResp.GetHits()) != 1 {
		t.Fatalf("expected 1 recall hit, got %d", len(recallResp.GetHits()))
	}
	if got := recallResp.GetHits()[0].GetRecord().GetMemoryId(); got != retainResp.GetRecords()[0].GetMemoryId() {
		t.Fatalf("recall record mismatch: got %s want %s", got, retainResp.GetRecords()[0].GetMemoryId())
	}

	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(historyResp.GetRecords()))
	}

	deleteResp, err := svc.DeleteMemory(ctx, &runtimev1.DeleteMemoryRequest{
		Bank:      createResp.GetBank().GetLocator(),
		MemoryIds: []string{retainResp.GetRecords()[0].GetMemoryId()},
		Reason:    "cleanup",
	})
	if err != nil {
		t.Fatalf("DeleteMemory: %v", err)
	}
	if len(deleteResp.GetDeletedMemoryIds()) != 1 {
		t.Fatalf("expected 1 deleted id, got %d", len(deleteResp.GetDeletedMemoryIds()))
	}

	historyAfterDelete, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(after delete): %v", err)
	}
	if len(historyAfterDelete.GetRecords()) != 0 {
		t.Fatalf("expected 0 history records after delete, got %d", len(historyAfterDelete.GetRecords()))
	}

}

func TestMemoryServiceRetainSemanticDedupReusesExistingRecordOnEligibleBank(t *testing.T) {
	t.Parallel()

	svc, locator := newBoundSemanticDedupTestBank(t)
	ctx := context.Background()
	first := retainSemanticMemoryForTest(t, ctx, svc, locator, "Alice", "works_at", "Nimi")

	svc.mu.RLock()
	beforeSequence := svc.sequence
	svc.mu.RUnlock()

	secondResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-semantic-duplicate",
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
		t.Fatalf("Retain(second): %v", err)
	}
	if got := secondResp.GetRecords()[0].GetMemoryId(); got != first.GetMemoryId() {
		t.Fatalf("expected dedup to reuse %s, got %s", first.GetMemoryId(), got)
	}

	svc.mu.RLock()
	afterSequence := svc.sequence
	svc.mu.RUnlock()
	if afterSequence != beforeSequence {
		t.Fatalf("expected dedup suppression not to publish a new event sequence, got %d -> %d", beforeSequence, afterSequence)
	}

	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one canonical row after dedup suppression, got %d", len(historyResp.GetRecords()))
	}
}

func TestMemoryServiceRetainSemanticDedupNormalizesCaseAndWhitespace(t *testing.T) {
	t.Parallel()

	svc, locator := newBoundSemanticDedupTestBank(t)
	ctx := context.Background()
	first := retainSemanticMemoryForTest(t, ctx, svc, locator, "  Alice ", "WORKS_AT", " Nimi  ")

	secondResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   "alice",
						Predicate: " works_at ",
						Object:    "nimi",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(second): %v", err)
	}
	if got := secondResp.GetRecords()[0].GetMemoryId(); got != first.GetMemoryId() {
		t.Fatalf("expected normalized semantic duplicate to reuse %s, got %s", first.GetMemoryId(), got)
	}
}

func TestMemoryServiceRetainSemanticDedupDoesNotRunForNullProfileBanks(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-null-profile-dedup"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Null Profile Bank", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}

	first := retainSemanticMemoryForTest(t, ctx, svc, locator, "Alice", "works_at", "Nimi")
	second := retainSemanticMemoryForTest(t, ctx, svc, locator, "Alice", "works_at", "Nimi")
	if first.GetMemoryId() == second.GetMemoryId() {
		t.Fatalf("expected null-profile bank not to dedup, both retains reused %s", first.GetMemoryId())
	}
}

func TestMemoryServiceRetainSemanticDedupDoesNotRunForObservationalRecords(t *testing.T) {
	t.Parallel()

	svc, locator := newBoundSemanticDedupTestBank(t)
	ctx := context.Background()
	firstResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "Alice mentioned Nimi"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(first observational): %v", err)
	}
	secondResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "Alice mentioned Nimi"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(second observational): %v", err)
	}
	if got := secondResp.GetRecords()[0].GetMemoryId(); got == firstResp.GetRecords()[0].GetMemoryId() {
		t.Fatalf("expected observational records not to dedup, reused %s", got)
	}
}

func TestMemoryServiceCreateBankWithoutInstalledProvider(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath: filepath.Join(t.TempDir(), "local-state.json"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	resp, err := svc.CreateBank(context.Background(), &runtimev1.CreateBankRequest{
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: "acct-1",
					AppId:     "app.test",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}
	if resp.GetBank() == nil {
		t.Fatal("expected bank response")
	}
	if resp.GetBank().GetEmbeddingProfile() != nil {
		t.Fatalf("expected nil embedding profile by default, got %#v", resp.GetBank().GetEmbeddingProfile())
	}
}

func TestMemoryServiceBoundProfileFailClosesWithoutManagedEmbedding(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath: filepath.Join(t.TempDir(), "local-state.json"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	resp, err := svc.CreateBank(context.Background(), &runtimev1.CreateBankRequest{
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: "acct-1",
					AppId:     "app.test",
				},
			},
		},
		EmbeddingProfile: profile,
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}

	_, err = svc.Retain(context.Background(), &runtimev1.RetainRequest{
		Bank: resp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "bound profile memory"},
				},
			},
		},
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected Unavailable retain failure, got %v", err)
	}

	_, err = svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Bank: resp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryRecallQuery{
			Query: "bound profile memory",
			Limit: 3,
		},
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected Unavailable recall failure, got %v", err)
	}
}

func TestMemoryServiceImportLegacyJSONIntoSQLiteAndRename(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	legacyPath := filepath.Join(dir, "memory-state.json")
	now := time.Now().UTC()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-legacy"},
		},
	}
	bank := &runtimev1.MemoryBank{
		BankId:              "bank-legacy",
		Locator:             cloneLocator(locator),
		DisplayName:         "Legacy Agent Memory",
		CanonicalAgentScope: true,
		PublicApiWritable:   false,
		CreatedAt:           timestamppb.New(now),
		UpdatedAt:           timestamppb.New(now),
	}
	record := &runtimev1.MemoryRecord{
		MemoryId:       "mem-legacy",
		Bank:           cloneLocator(locator),
		Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
		CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
		Provenance: &runtimev1.MemoryProvenance{
			SourceSystem:  "legacy",
			SourceEventId: "evt-legacy",
		},
		Replication: &runtimev1.MemoryReplicationState{
			Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING,
			LocalVersion: "mem-legacy",
			Detail: &runtimev1.MemoryReplicationState_Pending{
				Pending: &runtimev1.MemoryReplicationPending{
					EnqueuedAt: timestamppb.New(now),
				},
			},
		},
		Payload: &runtimev1.MemoryRecord_Observational{
			Observational: &runtimev1.ObservationalMemoryRecord{Observation: "legacy imported memory"},
		},
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	}
	backlog, err := marshalReplicationBacklogItem(&ReplicationBacklogItem{
		BacklogKey:   replicationBacklogKey(locator, record.GetMemoryId()),
		Locator:      cloneLocator(locator),
		MemoryID:     record.GetMemoryId(),
		LocalVersion: record.GetReplication().GetLocalVersion(),
		EnqueuedAt:   now,
		Status:       replicationBacklogStatusPending,
	})
	if err != nil {
		t.Fatalf("marshalReplicationBacklogItem: %v", err)
	}
	bankRaw, err := protojson.Marshal(bank)
	if err != nil {
		t.Fatalf("protojson.Marshal(bank): %v", err)
	}
	recordRaw, err := protojson.Marshal(record)
	if err != nil {
		t.Fatalf("protojson.Marshal(record): %v", err)
	}
	legacy := persistedMemoryState{
		SchemaVersion: memoryStateSchemaVersion,
		SavedAt:       now.Format(time.RFC3339Nano),
		Sequence:      7,
		Banks: []persistedBankState{
			{
				LocatorKey: locatorKey(locator),
				Bank:       bankRaw,
				Records:    []json.RawMessage{recordRaw},
			},
		},
		ReplicationBacklog: []persistedReplicationBacklogItem{backlog},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent: %v", err)
	}
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatalf("os.WriteFile(memory-state.json): %v", err)
	}

	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(import): %v", err)
	}

	historyResp, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(imported): %v", err)
	}
	if len(historyResp.GetRecords()) != 1 || historyResp.GetRecords()[0].GetMemoryId() != record.GetMemoryId() {
		t.Fatalf("unexpected imported history: %#v", historyResp.GetRecords())
	}
	backlogItems := svc.ListReplicationBacklog()
	if len(backlogItems) != 1 || backlogItems[0].MemoryID != record.GetMemoryId() {
		t.Fatalf("unexpected imported backlog: %#v", backlogItems)
	}
	if _, err := os.Stat(filepath.Join(dir, "memory.db")); err != nil {
		t.Fatalf("expected memory.db: %v", err)
	}
	if _, err := os.Stat(legacyPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected legacy path to be renamed, stat err=%v", err)
	}
	if _, err := os.Stat(legacyPath + ".wave3-imported.json.bak"); err != nil {
		t.Fatalf("expected imported backup rename: %v", err)
	}
	if got, err := svc.memoryMetaValue(memoryMetaLegacyImportSourcePathKey); err != nil || got != legacyPath {
		t.Fatalf("unexpected import source path metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.memoryMetaValue(memoryMetaLegacyImportSourceSchemaVersionKey); err != nil || got != "1" {
		t.Fatalf("unexpected import schema metadata: got=%q err=%v", got, err)
	}
	if got, err := svc.memoryMetaValue(memoryMetaLegacyImportSourceSHA256Key); err != nil || got == "" {
		t.Fatalf("expected import sha metadata, got=%q err=%v", got, err)
	}
	if got, err := svc.memoryMetaValue(memoryMetaLegacyImportedAtKey); err != nil || got == "" {
		t.Fatalf("expected import timestamp metadata, got=%q err=%v", got, err)
	}

	if err := svc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	svc, err = New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	defer func() {
		if err := svc.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()

	historyResp, err = svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(restart): %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one imported record after restart, got %d", len(historyResp.GetRecords()))
	}
	if got := svc.ListReplicationBacklog(); len(got) != 1 {
		t.Fatalf("expected one backlog item after restart, got %#v", got)
	}
}

func TestMemoryServiceCommitCanonicalReviewIsIdempotentAndQueryable(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	outcomes := CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-1",
				Topic:           "employment",
				Content:         "Alice works at Nimi and remains part of the core org.",
				SourceVersion:   "v1",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-1",
				Dimension:       "employment",
				NormalizedKey:   "alice:works_at",
				Statement:       "Alice works at Nimi.",
				Confidence:      0.92,
				ReviewCount:     1,
				LastReviewAt:    time.Now().UTC().Format(time.RFC3339Nano),
				Status:          "admitted",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}

	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview(first): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), outcomes); err != nil {
		t.Fatalf("CommitCanonicalReview(idempotent): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Summary: "different outcome payload",
	}); err == nil {
		t.Fatal("expected outcome hash mismatch to fail")
	}

	truths, err := svc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-1" {
		t.Fatalf("unexpected truths: %#v", truths)
	}
	checkpoint, err := svc.GetReviewCheckpoint(ctx, locator)
	if err != nil {
		t.Fatalf("GetReviewCheckpoint: %v", err)
	}
	if checkpoint == nil || checkpoint.LastReviewRun != "review-1" || checkpoint.Checkpoint != record.GetMemoryId() {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}
	narratives, err := svc.ListNarrativeContext(ctx, locator, "Alice works at Nimi", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "Where does Alice work?",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with narrative): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 1 {
		t.Fatalf("expected one narrative hit, got %#v", recallResp.GetNarrativeHits())
	}
	if got := recallResp.GetNarrativeHits()[0].GetSourceMemoryIds(); len(got) != 1 || got[0] != record.GetMemoryId() {
		t.Fatalf("unexpected narrative source ids: %#v", got)
	}
}

func TestMemoryServiceCanonicalReviewStoreAdapterIsQueryableAndIdempotent(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	store := svc.CanonicalReviewStore()
	if store == nil {
		t.Fatal("expected CanonicalReviewStore adapter")
	}
	scope, err := memoryengine.ScopeFromMemoryBankLocator(locator)
	if err != nil {
		t.Fatalf("ScopeFromMemoryBankLocator: %v", err)
	}
	ctx := context.Background()
	req := memoryengine.CommitCanonicalReviewRequest{
		ReviewRunID:     "review-store-1",
		Scope:           scope,
		CheckpointBasis: record.GetMemoryId(),
		Outcomes: memoryengine.ReviewOutcomes{
			Narratives: []memoryengine.NarrativeRecord{
				{
					NarrativeID:     "nar-store-1",
					Topic:           "employment",
					Content:         "Alice still works at Nimi.",
					SourceVersion:   "v1",
					Status:          "active",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
			Truths: []memoryengine.TruthRecord{
				{
					TruthID:         "truth-store-1",
					Dimension:       "employment",
					NormalizedKey:   "alice:works_at",
					Statement:       "Alice works at Nimi.",
					Confidence:      0.9,
					ReviewCount:     1,
					LastReviewAt:    time.Now().UTC().Format(time.RFC3339Nano),
					Status:          "admitted",
					SourceMemoryIDs: []string{record.GetMemoryId()},
				},
			},
		},
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(first): %v", err)
	}
	if err := store.CommitCanonicalReview(ctx, req); err != nil {
		t.Fatalf("CommitCanonicalReview(idempotent): %v", err)
	}
	truths, err := store.ListAdmittedTruths(ctx, scope)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-store-1" {
		t.Fatalf("unexpected truths: %#v", truths)
	}
	checkpoint, err := store.GetReviewCheckpoint(ctx, scope)
	if err != nil {
		t.Fatalf("GetReviewCheckpoint: %v", err)
	}
	if checkpoint == nil || checkpoint.LastReviewRun != "review-store-1" || checkpoint.Checkpoint != record.GetMemoryId() {
		t.Fatalf("unexpected checkpoint: %#v", checkpoint)
	}
	inputs, err := store.ListCanonicalReviewInputs(ctx, scope, "", 10)
	if err != nil {
		t.Fatalf("ListCanonicalReviewInputs: %v", err)
	}
	if len(inputs) == 0 || inputs[0].GetMemoryId() != record.GetMemoryId() {
		t.Fatalf("unexpected inputs: %#v", inputs)
	}
	narratives, err := store.ListNarrativeContext(ctx, scope, "Alice works at Nimi", 5)
	if err != nil {
		t.Fatalf("ListNarrativeContext: %v", err)
	}
	if len(narratives) != 1 || narratives[0].GetNarrativeId() != "nar-store-1" {
		t.Fatalf("unexpected narratives: %#v", narratives)
	}
}

func TestMemoryServiceRecallFeedbackIsIdempotentAndBiasesRanking(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project plan"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	firstID := retainResp.GetRecords()[0].GetMemoryId()
	secondID := retainResp.GetRecords()[1].GetMemoryId()
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-helpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(helpful): %v", err)
	}
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-helpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(idempotent helpful): %v", err)
	}
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-unhelpful-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   firstID,
		Polarity:   recallFeedbackUnhelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(unhelpful): %v", err)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "alpha",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with feedback): %v", err)
	}
	if len(recallResp.GetHits()) < 2 {
		t.Fatalf("expected at least 2 recall hits, got %#v", recallResp.GetHits())
	}
	if recallResp.GetHits()[0].GetRecord().GetMemoryId() != secondID {
		t.Fatalf("expected helpful record to rank first, got %#v", recallResp.GetHits())
	}
	if recallResp.GetHits()[1].GetRecord().GetMemoryId() != firstID {
		t.Fatalf("expected unhelpful record to rank after helpful record, got %#v", recallResp.GetHits())
	}
}

func TestMemoryServiceRecallFeedbackRejectsConflictingPayloadForSameID(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-feedback-conflict"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "alpha project note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "beta project note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	firstID := retainResp.GetRecords()[0].GetMemoryId()
	secondID := retainResp.GetRecords()[1].GetMemoryId()
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-conflict-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   firstID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(initial): %v", err)
	}
	err = svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-conflict-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   secondID,
		Polarity:   recallFeedbackHelpful,
		QueryText:  "alpha",
	})
	if err == nil {
		t.Fatal("expected conflicting feedback payload error")
	}
	if !strings.Contains(err.Error(), "already recorded with different payload") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMemoryServiceRecallExpandsCanonicalReviewRelations(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-relations"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "memory redesign review quality"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "totally unrelated archive"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	sourceID := retainResp.GetRecords()[0].GetMemoryId()
	targetID := retainResp.GetRecords()[1].GetMemoryId()
	otherID := retainResp.GetRecords()[2].GetMemoryId()
	if err := svc.CommitCanonicalReview(ctx, "review-rel-1", locator, sourceID, CanonicalReviewOutcomes{
		Relations: []RelationCandidate{
			{
				SourceID:     sourceID,
				TargetID:     targetID,
				RelationType: "thematic",
				Confidence:   0.95,
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(relations): %v", err)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "memory redesign",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with relations): %v", err)
	}
	targetIndex := -1
	otherIndex := -1
	for idx, hit := range recallResp.GetHits() {
		switch hit.GetRecord().GetMemoryId() {
		case targetID:
			targetIndex = idx
		case otherID:
			otherIndex = idx
		}
	}
	if targetIndex == -1 || otherIndex == -1 {
		t.Fatalf("expected both relation target and unrelated record in recall hits, got %#v", recallResp.GetHits())
	}
	if targetIndex >= otherIndex {
		t.Fatalf("expected relation target %s to outrank unrelated record %s, got %#v", targetID, otherID, recallResp.GetHits())
	}
}

func TestMemoryServiceNarrativeRecallUsesEmbeddingAndFallsBack(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-semantic-1",
				Topic:           "miscellaneous",
				Content:         "unrelated prose only",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(narrative): %v", err)
	}
	query := "semantic-key"
	vector := marshalFloatVector(computeEmbeddingVector(query, 4))
	if _, err := svc.PersistenceBackend().DB().Exec(`
		UPDATE memory_narrative_embedding
		SET vector_json = ?
		WHERE locator_key = ? AND narrative_id = ?
	`, vector, locatorKey(locator), "nar-semantic-1"); err != nil {
		t.Fatalf("update memory_narrative_embedding: %v", err)
	}

	recallWithEmbedding, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: query,
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(with narrative embedding): %v", err)
	}
	if len(recallWithEmbedding.GetNarrativeHits()) != 1 || recallWithEmbedding.GetNarrativeHits()[0].GetNarrativeId() != "nar-semantic-1" {
		t.Fatalf("expected semantic narrative hit, got %#v", recallWithEmbedding.GetNarrativeHits())
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		DELETE FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-semantic-1"); err != nil {
		t.Fatalf("delete memory_narrative_embedding: %v", err)
	}

	recallWithoutEmbedding, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: query,
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(without narrative embedding): %v", err)
	}
	if len(recallWithoutEmbedding.GetNarrativeHits()) != 0 {
		t.Fatalf("expected FTS-only fallback to produce no hit for non-lexical query, got %#v", recallWithoutEmbedding.GetNarrativeHits())
	}
}

func TestMemoryServiceNarrativeEmbeddingDeletedWhenNarrativeBecomesStale(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-active", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-stale-1",
				Topic:           "project direction",
				Content:         "initial active narrative",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(active narrative): %v", err)
	}
	var beforeCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&beforeCount); err != nil {
		t.Fatalf("count active narrative embedding: %v", err)
	}
	if beforeCount != 1 {
		t.Fatalf("expected active narrative embedding row, got %d", beforeCount)
	}
	vector := marshalFloatVector(computeEmbeddingVector("semantic-key", 4))
	if _, err := svc.PersistenceBackend().DB().Exec(`
		UPDATE memory_narrative_embedding
		SET vector_json = ?
		WHERE locator_key = ? AND narrative_id = ?
	`, vector, locatorKey(locator), "nar-stale-1"); err != nil {
		t.Fatalf("update active narrative embedding: %v", err)
	}
	activeSemanticResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic-key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active narrative semantic-only): %v", err)
	}
	if len(activeSemanticResp.GetNarrativeHits()) != 1 || activeSemanticResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected active narrative embedding hit before stale, got %#v", activeSemanticResp.GetNarrativeHits())
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-stale-1", "semantic key", "semantic key", 3, 0, narrativeAliasStatusActive, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert active alias row: %v", err)
	}
	activeAliasResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active narrative alias-only): %v", err)
	}
	if len(activeAliasResp.GetNarrativeHits()) != 1 || activeAliasResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected active narrative alias hit before stale, got %#v", activeAliasResp.GetNarrativeHits())
	}
	if err := svc.CommitCanonicalReview(ctx, "review-narrative-stale", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-stale-1",
				Topic:           "project direction",
				Content:         "stale narrative no longer active",
				SourceVersion:   "review-runtime",
				Status:          "stale",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(stale narrative): %v", err)
	}
	var afterCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_embedding
		WHERE locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&afterCount); err != nil {
		t.Fatalf("count stale narrative embedding: %v", err)
	}
	if afterCount != 0 {
		t.Fatalf("expected stale narrative embedding row to be removed, got %d", afterCount)
	}
	if err := svc.cleanupAcceleratorStateAt(ctx, time.Now().UTC()); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}
	var aliasCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ?
	`, locatorKey(locator), "nar-stale-1").Scan(&aliasCount); err != nil {
		t.Fatalf("count stale narrative alias rows: %v", err)
	}
	if aliasCount != 0 {
		t.Fatalf("expected stale narrative alias rows to be removed, got %d", aliasCount)
	}
	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 1 || recallResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-stale-1" {
		t.Fatalf("expected stale narrative to remain recallable, got %#v", recallResp.GetNarrativeHits())
	}
	if !recallResp.GetNarrativeHits()[0].GetIsStale() {
		t.Fatalf("expected stale narrative hit to keep stale marker, got %#v", recallResp.GetNarrativeHits()[0])
	}
	semanticResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic-key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative semantic-only): %v", err)
	}
	if len(semanticResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected stale narrative to lose embedding-only recall advantage, got %#v", semanticResp.GetNarrativeHits())
	}
	aliasResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "semantic key",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(stale narrative alias-only): %v", err)
	}
	if len(aliasResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected stale narrative to lose alias acceleration advantage, got %#v", aliasResp.GetNarrativeHits())
	}
}

func TestMemoryServiceDeleteMemoryCascadesDerivedState(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	target := seedCanonicalCascadeFixture(t, svc, locator, record, "delete")
	ctx := context.Background()

	if _, err := svc.DeleteMemory(ctx, &runtimev1.DeleteMemoryRequest{
		Bank:      locator,
		MemoryIds: []string{record.GetMemoryId()},
		Reason:    "cleanup",
	}); err != nil {
		t.Fatalf("DeleteMemory: %v", err)
	}

	assertNarrativeCascadeState(t, svc, locator, "nar-delete", "invalidated")
	assertTruthCascadeState(t, svc, locator, "truth-delete", "invalidated")
	assertRelationInactive(t, svc, locator, record.GetMemoryId(), target.GetMemoryId(), "thematic")

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(after delete cascade): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected invalidated narrative hidden from recall, got %#v", recallResp.GetNarrativeHits())
	}
}

func TestMemoryServiceReplicationInvalidationCascadesDerivedState(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	target := seedCanonicalCascadeFixture(t, svc, locator, record, "replication")
	ctx := context.Background()
	observedAt := time.Now().UTC()

	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Invalidation{
			Invalidation: &runtimev1.MemoryInvalidation{
				InvalidationId:     "inv-derived-1",
				InvalidatedVersion: record.GetReplication().GetLocalVersion(),
				Authority:          "realm",
				InvalidationReason: "moderation",
				InvalidatedAt:      timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(invalidated): %v", err)
	}

	assertNarrativeCascadeState(t, svc, locator, "nar-replication", "invalidated")
	assertTruthCascadeState(t, svc, locator, "truth-replication", "invalidated")
	assertRelationInactive(t, svc, locator, record.GetMemoryId(), target.GetMemoryId(), "thematic")

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "project direction",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(after replication cascade): %v", err)
	}
	if len(recallResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected invalidated narrative hidden from recall, got %#v", recallResp.GetNarrativeHits())
	}
}

func TestMemoryServiceTruthSupersessionMarksPriorTruthStale(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	now := time.Now().UTC().Format(time.RFC3339Nano)

	if err := svc.CommitCanonicalReview(ctx, "review-truth-old", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-old",
				Dimension:       "relational",
				NormalizedKey:   "alice:works_at",
				Statement:       "Alice works at Nimi.",
				Confidence:      0.92,
				ReviewCount:     1,
				LastReviewAt:    now,
				Status:          "admitted",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(old truth): %v", err)
	}
	if err := svc.CommitCanonicalReview(ctx, "review-truth-new", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:           "truth-new",
				Dimension:         "relational",
				NormalizedKey:     "alice:role",
				Statement:         "Alice is part of the core org.",
				Confidence:        0.95,
				ReviewCount:       2,
				LastReviewAt:      now,
				Status:            "admitted",
				SupersedesTruthID: "truth-old",
				SourceMemoryIDs:   []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(new truth): %v", err)
	}

	assertTruthCascadeState(t, svc, locator, "truth-old", "stale")
	truths, err := svc.ListAdmittedTruths(ctx, locator)
	if err != nil {
		t.Fatalf("ListAdmittedTruths: %v", err)
	}
	if len(truths) != 1 || truths[0].TruthID != "truth-new" {
		t.Fatalf("expected only new truth admitted after supersession, got %#v", truths)
	}
}

func TestMemoryServiceNarrativeAliasPromotesSuppressesAndAffectsRecall(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	if err := svc.CommitCanonicalReview(ctx, "review-alias-1", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-alias-1",
				Topic:           "miscellaneous",
				Content:         "unrelated prose only",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(narrative): %v", err)
	}

	queryResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(before alias): %v", err)
	}
	if len(queryResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected no narrative hits before alias promotion, got %#v", queryResp.GetNarrativeHits())
	}

	for idx := 1; idx <= 2; idx++ {
		if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
			FeedbackID: fmt.Sprintf("narrative-alias-helpful-%d", idx),
			Bank:       locator,
			TargetKind: recallFeedbackTargetNarrative,
			TargetID:   "nar-alias-1",
			Polarity:   recallFeedbackHelpful,
			QueryText:  "zorb",
		}); err != nil {
			t.Fatalf("RecordRecallFeedback(helpful %d): %v", idx, err)
		}
	}
	var candidateStatus string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&candidateStatus); err != nil {
		t.Fatalf("load candidate alias row: %v", err)
	}
	if candidateStatus != narrativeAliasStatusCandidate {
		t.Fatalf("expected candidate alias status after 2 helpful events, got %q", candidateStatus)
	}

	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "narrative-alias-helpful-3",
		Bank:       locator,
		TargetKind: recallFeedbackTargetNarrative,
		TargetID:   "nar-alias-1",
		Polarity:   recallFeedbackHelpful,
		QueryText:  "zorb",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(helpful 3): %v", err)
	}
	var activeStatus string
	var helpfulCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status, helpful_count
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&activeStatus, &helpfulCount); err != nil {
		t.Fatalf("load active alias row: %v", err)
	}
	if activeStatus != narrativeAliasStatusActive || helpfulCount != 3 {
		t.Fatalf("expected active alias after 3 helpful events, got status=%q helpful_count=%d", activeStatus, helpfulCount)
	}
	exactResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(active alias): %v", err)
	}
	if len(exactResp.GetNarrativeHits()) != 1 || exactResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-alias-1" {
		t.Fatalf("expected alias-promoted narrative hit, got %#v", exactResp.GetNarrativeHits())
	}
	nonExactResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb extra",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(non-exact alias): %v", err)
	}
	if len(nonExactResp.GetNarrativeHits()) != 1 || nonExactResp.GetNarrativeHits()[0].GetNarrativeId() != "nar-alias-1" {
		t.Fatalf("expected narrative feedback hit to remain available, got %#v", nonExactResp.GetNarrativeHits())
	}
	if exactResp.GetNarrativeHits()[0].GetRelevanceScore() <= nonExactResp.GetNarrativeHits()[0].GetRelevanceScore() {
		t.Fatalf("expected exact alias match to outrank non-exact query, got exact=%#v non_exact=%#v", exactResp.GetNarrativeHits(), nonExactResp.GetNarrativeHits())
	}

	for idx := 1; idx <= 3; idx++ {
		if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
			FeedbackID: fmt.Sprintf("narrative-alias-unhelpful-%d", idx),
			Bank:       locator,
			TargetKind: recallFeedbackTargetNarrative,
			TargetID:   "nar-alias-1",
			Polarity:   recallFeedbackUnhelpful,
			QueryText:  "zorb",
		}); err != nil {
			t.Fatalf("RecordRecallFeedback(unhelpful %d): %v", idx, err)
		}
	}
	var suppressedStatus string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT status
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-alias-1", "zorb").Scan(&suppressedStatus); err != nil {
		t.Fatalf("load suppressed alias row: %v", err)
	}
	if suppressedStatus != narrativeAliasStatusSuppressed {
		t.Fatalf("expected suppressed alias status, got %q", suppressedStatus)
	}
	queryResp, err = svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "zorb",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(suppressed alias): %v", err)
	}
	if len(queryResp.GetNarrativeHits()) != 0 {
		t.Fatalf("expected alias suppression to remove narrative hit, got %#v", queryResp.GetNarrativeHits())
	}
}

func TestMemoryServiceAcceleratorCleanupRetainsNewestFeedbackEventsAndPreservesSummary(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	bankKey := locatorKey(locator)
	for idx := 1; idx <= 70; idx++ {
		createdAt := time.Date(2026, 4, 1, 0, 0, idx, 0, time.UTC).Format(time.RFC3339Nano)
		if _, err := svc.PersistenceBackend().DB().Exec(`
			INSERT INTO memory_recall_feedback_event(feedback_id, bank_locator_key, target_kind, target_id, polarity, query_text, source_system, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, fmt.Sprintf("feedback-retain-%02d", idx), bankKey, recallFeedbackTargetRecord, record.GetMemoryId(), recallFeedbackHelpful, "query", "test", createdAt); err != nil {
			t.Fatalf("insert feedback event %d: %v", idx, err)
		}
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId(), 70, 0, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert feedback summary: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(ctx, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var eventCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_event
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&eventCount); err != nil {
		t.Fatalf("count feedback events: %v", err)
	}
	if eventCount != feedbackEventRetentionPerTarget {
		t.Fatalf("expected %d retained events, got %d", feedbackEventRetentionPerTarget, eventCount)
	}

	var oldestRetained string
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT feedback_id
		FROM memory_recall_feedback_event
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
		ORDER BY created_at ASC, feedback_id ASC
		LIMIT 1
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&oldestRetained); err != nil {
		t.Fatalf("load oldest retained event: %v", err)
	}
	if oldestRetained != "feedback-retain-07" {
		t.Fatalf("expected oldest retained event feedback-retain-07, got %q", oldestRetained)
	}

	var helpfulCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT helpful_count
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetRecord, record.GetMemoryId()).Scan(&helpfulCount); err != nil {
		t.Fatalf("load feedback summary: %v", err)
	}
	if helpfulCount != 70 {
		t.Fatalf("expected summary helpful_count to remain 70, got %d", helpfulCount)
	}
}

func TestMemoryServiceAcceleratorCleanupDeletesOrphanedFeedbackSummary(t *testing.T) {
	t.Parallel()

	svc, locator, _ := newCanonicalTestMemoryRecord(t)
	bankKey := locatorKey(locator)
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, bankKey, recallFeedbackTargetNarrative, "nar-missing", 2, 1, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert orphan summary: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(context.Background(), time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, bankKey, recallFeedbackTargetNarrative, "nar-missing").Scan(&count); err != nil {
		t.Fatalf("count orphan summary rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected orphan summary row to be deleted, got %d", count)
	}
}

func TestMemoryServiceAcceleratorCleanupDeletesExpiredAliasRows(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	bankKey := locatorKey(locator)
	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-alias", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-cleanup-active",
				Topic:           "cleanup topic",
				Content:         "cleanup content",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(active narrative): %v", err)
	}

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?),
			(?, ?, ?, ?, ?, ?, ?, ?)
	`,
		bankKey, "nar-cleanup-active", "old-candidate", "old-candidate", 1, 0, narrativeAliasStatusCandidate, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-active", "old-suppressed", "old-suppressed", 1, 2, narrativeAliasStatusSuppressed, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-active", "keep-active", "keep-active", 3, 0, narrativeAliasStatusActive, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
		bankKey, "nar-cleanup-missing", "missing-active", "missing-active", 3, 0, narrativeAliasStatusActive, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano),
	); err != nil {
		t.Fatalf("insert alias rows: %v", err)
	}

	if err := svc.cleanupAcceleratorStateAt(ctx, time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("cleanupAcceleratorStateAt: %v", err)
	}

	var remaining []string
	rows, err := svc.PersistenceBackend().DB().Query(`
		SELECT alias_norm
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ?
		ORDER BY alias_norm ASC
	`, bankKey, "nar-cleanup-active")
	if err != nil {
		t.Fatalf("query alias rows: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var aliasNorm string
		if err := rows.Scan(&aliasNorm); err != nil {
			t.Fatalf("scan alias row: %v", err)
		}
		remaining = append(remaining, aliasNorm)
	}
	if !slices.Equal(remaining, []string{"keep-active"}) {
		t.Fatalf("expected only active alias to remain, got %#v", remaining)
	}

	var missingCount int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, bankKey, "nar-cleanup-missing", "missing-active").Scan(&missingCount); err != nil {
		t.Fatalf("count orphan alias rows: %v", err)
	}
	if missingCount != 0 {
		t.Fatalf("expected orphan alias row to be deleted, got %d", missingCount)
	}
}

func TestMemoryServiceRecordRecallFeedbackTriggersAcceleratorCleanup(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	fixedNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixedNow }
	svc.acceleratorCleanupCooldown = 0

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), recallFeedbackTargetNarrative, "nar-missing-on-write", 2, 1, fixedNow.Add(-48*time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert orphan summary: %v", err)
	}

	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cleanup-write-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cleanup trigger",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback: %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_recall_feedback_summary
		WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
	`, locatorKey(locator), recallFeedbackTargetNarrative, "nar-missing-on-write").Scan(&count); err != nil {
		t.Fatalf("count orphan summary rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected write-path cleanup to remove orphan summary row, got %d", count)
	}
}

func TestMemoryServiceCommitCanonicalReviewTriggersAcceleratorCleanup(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	fixedNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return fixedNow }
	svc.acceleratorCleanupCooldown = 0

	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-trigger-seed", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Narratives: []NarrativeCandidate{
			{
				NarrativeID:     "nar-cleanup-trigger",
				Topic:           "cleanup trigger",
				Content:         "active narrative for cleanup trigger",
				SourceVersion:   "review-runtime",
				Status:          "active",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(seed): %v", err)
	}

	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-cleanup-trigger", "old-trigger-candidate", "old-trigger-candidate", 1, 0, narrativeAliasStatusCandidate, fixedNow.Add(-15*24*time.Hour).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert stale alias row: %v", err)
	}

	if err := svc.CommitCanonicalReview(ctx, "review-cleanup-trigger-apply", locator, record.GetMemoryId(), CanonicalReviewOutcomes{
		Truths: []TruthCandidate{
			{
				TruthID:         "truth-cleanup-trigger",
				Dimension:       "cognitive",
				Statement:       "cleanup trigger truth",
				NormalizedKey:   "cleanup-trigger-truth",
				Confidence:      0.8,
				SourceCount:     5,
				Status:          "candidate",
				SourceMemoryIDs: []string{record.GetMemoryId()},
			},
		},
	}); err != nil {
		t.Fatalf("CommitCanonicalReview(apply): %v", err)
	}

	var count int
	if err := svc.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-cleanup-trigger", "old-trigger-candidate").Scan(&count); err != nil {
		t.Fatalf("count stale alias rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected commit-path cleanup to remove stale alias row, got %d", count)
	}
}

func TestMemoryServiceAcceleratorCleanupCooldownLimitsOpportunisticRuns(t *testing.T) {
	t.Parallel()

	svc, locator, record := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	baseNow := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	currentNow := baseNow
	svc.now = func() time.Time { return currentNow }
	svc.acceleratorCleanupCooldown = time.Hour

	insertOrphanSummary := func(targetID string) {
		t.Helper()
		if _, err := svc.PersistenceBackend().DB().Exec(`
			INSERT INTO memory_recall_feedback_summary(bank_locator_key, target_kind, target_id, helpful_count, unhelpful_count, last_feedback_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, locatorKey(locator), recallFeedbackTargetNarrative, targetID, 1, 0, currentNow.Add(-48*time.Hour).Format(time.RFC3339Nano)); err != nil {
			t.Fatalf("insert orphan summary %s: %v", targetID, err)
		}
	}
	countSummary := func(targetID string) int {
		t.Helper()
		var count int
		if err := svc.PersistenceBackend().DB().QueryRow(`
			SELECT COUNT(1)
			FROM memory_recall_feedback_summary
			WHERE bank_locator_key = ? AND target_kind = ? AND target_id = ?
		`, locatorKey(locator), recallFeedbackTargetNarrative, targetID).Scan(&count); err != nil {
			t.Fatalf("count orphan summary %s: %v", targetID, err)
		}
		return count
	}

	insertOrphanSummary("nar-cooldown-first")
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-1",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown first",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(first): %v", err)
	}
	if count := countSummary("nar-cooldown-first"); count != 0 {
		t.Fatalf("expected first opportunistic cleanup to remove orphan summary, got %d rows", count)
	}

	insertOrphanSummary("nar-cooldown-second")
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-2",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown second",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(second): %v", err)
	}
	if count := countSummary("nar-cooldown-second"); count != 1 {
		t.Fatalf("expected cooldown-limited write to skip cleanup, got %d rows", count)
	}

	currentNow = currentNow.Add(2 * time.Hour)
	if err := svc.RecordRecallFeedback(ctx, RecallFeedback{
		FeedbackID: "feedback-cooldown-3",
		Bank:       locator,
		TargetKind: recallFeedbackTargetRecord,
		TargetID:   record.GetMemoryId(),
		Polarity:   recallFeedbackHelpful,
		QueryText:  "cooldown third",
	}); err != nil {
		t.Fatalf("RecordRecallFeedback(third): %v", err)
	}
	if count := countSummary("nar-cooldown-second"); count != 0 {
		t.Fatalf("expected cleanup to resume after cooldown, got %d rows", count)
	}
}

func TestMemoryServiceStartupAcceleratorCleanupRemovesExpiredAliasRows(t *testing.T) {
	t.Parallel()

	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(first): %v", err)
	}
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-startup-cleanup"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(context.Background(), locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative(narrative_id, bank_locator_key, topic, content, source_version, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, "nar-startup-cleanup", locatorKey(locator), "startup", "stale alias cleanup", "review-runtime", "active", time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert narrative: %v", err)
	}
	if _, err := svc.PersistenceBackend().DB().Exec(`
		INSERT INTO memory_narrative_alias(bank_locator_key, narrative_id, alias_norm, alias_display, helpful_count, unhelpful_count, status, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, locatorKey(locator), "nar-startup-cleanup", "startup-old-candidate", "startup-old-candidate", 1, 0, narrativeAliasStatusCandidate, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("insert stale alias row: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close(first): %v", err)
	}

	reopened, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(reopen): %v", err)
	}
	defer reopened.Close()

	var count int
	if err := reopened.PersistenceBackend().DB().QueryRow(`
		SELECT COUNT(1)
		FROM memory_narrative_alias
		WHERE bank_locator_key = ? AND narrative_id = ? AND alias_norm = ?
	`, locatorKey(locator), "nar-startup-cleanup", "startup-old-candidate").Scan(&count); err != nil {
		t.Fatalf("count alias rows after reopen: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected startup cleanup to remove stale alias row, got %d", count)
	}
}

func TestMemoryServiceReflectRejectsCanonicalScopes(t *testing.T) {
	t.Parallel()

	svc, locator, _ := newCanonicalTestMemoryRecord(t)
	_, err := svc.Reflect(context.Background(), &runtimev1.ReflectRequest{
		Bank: locator,
		Reflection: &runtimev1.MemoryReflectionRequest{
			ReflectionReason: "review",
		},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected canonical Reflect rejection, got %v", err)
	}
}

func TestMemoryServiceClusterCanonicalReviewInputsUsesPersistedEmbeddingsAndDefersSingletons(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       32,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	})

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-cluster"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(ctx, locator); err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "memory redesign review quality"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "review quality memory redesign"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "green tea preference"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "preference for green tea"},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "astronomy telescope note"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}

	clusters, leftovers, err := svc.ClusterCanonicalReviewInputs(ctx, locator, "", 10)
	if err != nil {
		t.Fatalf("ClusterCanonicalReviewInputs: %v", err)
	}
	if len(clusters) != 2 {
		t.Fatalf("expected 2 clusters, got %#v", clusters)
	}
	clusterSizes := []int{len(clusters[0].RecordIDs), len(clusters[1].RecordIDs)}
	slices.Sort(clusterSizes)
	if !slices.Equal(clusterSizes, []int{2, 2}) {
		t.Fatalf("expected two 2-record clusters, got %#v", clusterSizes)
	}
	if len(leftovers) != 1 {
		t.Fatalf("expected one singleton leftover, got %#v", leftovers)
	}
	if leftovers[0].GetMemoryId() != retainResp.GetRecords()[4].GetMemoryId() {
		t.Fatalf("expected astronomy record to remain leftover, got %#v", leftovers[0])
	}
}

func TestMemoryServiceCanonicalBindRequiresManagedProfileAndIsIdempotent(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath: filepath.Join(t.TempDir(), "local-state.json"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-bind"},
		},
	}
	bank, err := svc.EnsureCanonicalBank(context.Background(), locator, "Agent Memory", nil)
	if err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if bank.GetEmbeddingProfile() != nil {
		t.Fatalf("expected baseline canonical bank to start unbound, got %#v", bank.GetEmbeddingProfile())
	}
	if _, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator); status.Code(err) != codes.Unavailable {
		t.Fatalf("expected bind without managed profile to fail unavailable, got %v", err)
	}

	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "nimi-embed",
		Dimension:       4,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "nimi-embed",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	bound, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator)
	if err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile: %v", err)
	}
	if bound.GetEmbeddingProfile() == nil {
		t.Fatal("expected canonical bank to bind embedding profile")
	}
	boundAgain, err := svc.BindCanonicalBankEmbeddingProfile(context.Background(), locator)
	if err != nil {
		t.Fatalf("BindCanonicalBankEmbeddingProfile(idempotent): %v", err)
	}
	if !proto.Equal(bound.GetEmbeddingProfile(), boundAgain.GetEmbeddingProfile()) {
		t.Fatalf("expected idempotent bind result, got %#v vs %#v", bound.GetEmbeddingProfile(), boundAgain.GetEmbeddingProfile())
	}
}

func TestMemoryServiceWorldSharedLocatorKeyUsesWorldOnly(t *testing.T) {
	t.Parallel()

	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
		Owner: &runtimev1.MemoryBankLocator_WorldShared{
			WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
		},
	}
	if got := locatorKey(locator); got != "world-shared::world-1" {
		t.Fatalf("unexpected world_shared locator key: %s", got)
	}

	filter := &runtimev1.MemoryBankOwnerFilter{
		Owner: &runtimev1.MemoryBankOwnerFilter_WorldShared{
			WorldShared: &runtimev1.WorldSharedBankOwner{WorldId: "world-1"},
		},
	}
	if got := ownerFilterKey(filter); got != "world-shared::world-1" {
		t.Fatalf("unexpected world_shared owner filter key: %s", got)
	}
}

func TestMemoryServiceApplyReplicationObservationUpdatesCommittedStateAndEvents(t *testing.T) {
	t.Parallel()

	svc, locator, record := newTestMemoryRecord(t)
	if record.GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING {
		t.Fatalf("expected retained record to start pending, got %s", record.GetReplication().GetOutcome())
	}

	stream := newMemoryEventCaptureStream(context.Background(), 1)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeMemoryEvents(&runtimev1.SubscribeMemoryEventsRequest{
			ScopeFilters: []runtimev1.MemoryBankScope{locator.GetScope()},
			OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{
				{
					Owner: &runtimev1.MemoryBankOwnerFilter_AppPrivate{
						AppPrivate: &runtimev1.AppPrivateBankOwner{
							AccountId: "acct-1",
							AppId:     "app.test",
						},
					},
				},
			},
		}, stream)
	}()
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return len(svc.subscribers) == 1
	})

	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-v1",
				SyncedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation: %v", err)
	}
	if err := <-done; err != context.Canceled {
		t.Fatalf("SubscribeMemoryEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 1 {
		t.Fatalf("expected one replication event, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
		t.Fatalf("expected replication_updated event, got %#v", stream.events[0])
	}
	if stream.events[0].GetReplicationUpdated().GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication event, got %#v", stream.events[0].GetReplicationUpdated())
	}

	historyResp, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one record after sync, got %d", len(historyResp.GetRecords()))
	}
	if historyResp.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication in history, got %#v", historyResp.GetRecords()[0].GetReplication())
	}
}

func TestMemoryServiceApplyReplicationObservationFailClosesIllegalTransitionAndHidesInvalidated(t *testing.T) {
	t.Parallel()

	svc, locator, record := newTestMemoryRecord(t)
	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Conflict{
			Conflict: &runtimev1.MemoryReplicationConflict{
				ConflictId:     "conflict-1",
				LocalVersion:   record.GetReplication().GetLocalVersion(),
				RemoteVersion:  "realm-v2",
				ConflictReason: "version diverged",
				DetectedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(conflict): %v", err)
	}
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Invalidation{
			Invalidation: &runtimev1.MemoryInvalidation{
				InvalidationId:     "inv-1",
				InvalidatedVersion: record.GetReplication().GetLocalVersion(),
				Authority:          "realm",
				InvalidationReason: "moderation",
				InvalidatedAt:      timestamppb.New(observedAt.Add(time.Second)),
			},
		},
	}, observedAt.Add(time.Second)); err != nil {
		t.Fatalf("ApplyReplicationObservation(invalidated): %v", err)
	}

	historyHidden, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(hidden): %v", err)
	}
	if len(historyHidden.GetRecords()) != 0 {
		t.Fatalf("expected invalidated record hidden by default, got %d", len(historyHidden.GetRecords()))
	}
	historyVisible, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(visible): %v", err)
	}
	if len(historyVisible.GetRecords()) != 1 {
		t.Fatalf("expected invalidated record visible when requested, got %d", len(historyVisible.GetRecords()))
	}
	if historyVisible.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED {
		t.Fatalf("expected invalidated replication state, got %#v", historyVisible.GetRecords()[0].GetReplication())
	}

	recallHidden, err := svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query: "Where does Alice work?",
			Limit: 5,
		},
	})
	if err != nil {
		t.Fatalf("Recall(hidden): %v", err)
	}
	if len(recallHidden.GetHits()) != 0 {
		t.Fatalf("expected invalidated record hidden from recall, got %d", len(recallHidden.GetHits()))
	}
	recallVisible, err := svc.Recall(context.Background(), &runtimev1.RecallRequest{
		Bank: locator,
		Query: &runtimev1.MemoryRecallQuery{
			Query:              "Where does Alice work?",
			Limit:              5,
			IncludeInvalidated: true,
		},
	})
	if err != nil {
		t.Fatalf("Recall(visible): %v", err)
	}
	if len(recallVisible.GetHits()) != 1 {
		t.Fatalf("expected invalidated record visible when requested, got %d", len(recallVisible.GetHits()))
	}

	err = svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Pending{
			Pending: &runtimev1.MemoryReplicationPending{
				EnqueuedAt: timestamppb.New(observedAt.Add(2 * time.Second)),
			},
		},
	}, observedAt.Add(2*time.Second))
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected illegal terminal transition to fail precondition, got %v", err)
	}

	historyAfterIllegal, err := svc.History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(after illegal): %v", err)
	}
	if len(historyAfterIllegal.GetRecords()) != 1 {
		t.Fatalf("expected record preserved after illegal transition, got %d", len(historyAfterIllegal.GetRecords()))
	}
	if historyAfterIllegal.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED {
		t.Fatalf("expected invalidated state preserved, got %#v", historyAfterIllegal.GetRecords()[0].GetReplication())
	}
}

func TestMemoryServiceCanonicalRetainEnqueuesBacklogAndInfraRetainDoesNot(t *testing.T) {
	t.Parallel()

	canonicalSvc, _, canonicalRecord := newCanonicalTestMemoryRecord(t)
	backlog := canonicalSvc.ListReplicationBacklog()
	if len(backlog) != 1 {
		t.Fatalf("expected one canonical backlog item, got %d", len(backlog))
	}
	if backlog[0].MemoryID != canonicalRecord.GetMemoryId() {
		t.Fatalf("expected backlog memory %s, got %#v", canonicalRecord.GetMemoryId(), backlog[0])
	}
	if backlog[0].LocalVersion != canonicalRecord.GetReplication().GetLocalVersion() {
		t.Fatalf("expected backlog local version %s, got %#v", canonicalRecord.GetReplication().GetLocalVersion(), backlog[0])
	}

	infraSvc, _, _ := newTestMemoryRecord(t)
	if got := len(infraSvc.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected infra retain to skip backlog, got %d items", got)
	}
}

func TestMemoryServiceReplicationLoopDefaultBridgeKeepsPendingBacklog(t *testing.T) {
	t.Parallel()

	svc, _, _ := newCanonicalTestMemoryRecord(t)
	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	t.Cleanup(svc.StopReplicationLoop)

	waitForMemoryCondition(t, 2*time.Second, func() bool {
		backlog := svc.ListReplicationBacklog()
		return len(backlog) == 1 && backlog[0].AttemptCount > 0 && backlog[0].Status == replicationBacklogStatusPending
	})

	backlog := svc.ListReplicationBacklog()
	if len(backlog) != 1 {
		t.Fatalf("expected one pending backlog item, got %d", len(backlog))
	}
	if backlog[0].Status != replicationBacklogStatusPending {
		t.Fatalf("expected pending backlog status, got %#v", backlog[0])
	}
	if backlog[0].LastAttemptOutcome != replicationAttemptUnavailable {
		t.Fatalf("expected unavailable attempt outcome, got %#v", backlog[0])
	}
}

func TestMemoryServiceReplicationLoopFakeBridgeResolvesBacklogAndEmitsCommittedEvents(t *testing.T) {
	t.Parallel()

	svc, locator, first := newCanonicalTestMemoryRecord(t)
	ctx := context.Background()
	secondRetain, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "second canonical memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(second): %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	thirdRetain, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "third canonical memory"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain(third): %v", err)
	}
	initialBacklog := svc.ListReplicationBacklog()
	if len(initialBacklog) != 3 {
		t.Fatalf("expected three backlog items, got %d", len(initialBacklog))
	}

	adapter := &fakeReplicationBridgeAdapter{
		results: map[string]*runtimev1.MemoryReplicationState{
			first.GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
				LocalVersion: first.GetReplication().GetLocalVersion(),
				BasisVersion: first.GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Synced{
					Synced: &runtimev1.MemoryReplicationSynced{
						RealmVersion: "realm-1",
						SyncedAt:     timestamppb.Now(),
					},
				},
			},
			secondRetain.GetRecords()[0].GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_CONFLICT,
				LocalVersion: secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				BasisVersion: secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Conflict{
					Conflict: &runtimev1.MemoryReplicationConflict{
						ConflictId:     "conflict-2",
						LocalVersion:   secondRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
						RemoteVersion:  "realm-2",
						ConflictReason: "diverged",
						DetectedAt:     timestamppb.Now(),
					},
				},
			},
			thirdRetain.GetRecords()[0].GetMemoryId(): {
				Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_INVALIDATED,
				LocalVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				BasisVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
				Detail: &runtimev1.MemoryReplicationState_Invalidation{
					Invalidation: &runtimev1.MemoryInvalidation{
						InvalidationId:     "inv-3",
						InvalidatedVersion: thirdRetain.GetRecords()[0].GetReplication().GetLocalVersion(),
						Authority:          "realm",
						InvalidationReason: "moderation",
						InvalidatedAt:      timestamppb.Now(),
					},
				},
			},
		},
	}
	svc.SetReplicationBridgeAdapter(adapter)

	stream := newMemoryEventCaptureStream(context.Background(), 3)
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeMemoryEvents(&runtimev1.SubscribeMemoryEventsRequest{
			ScopeFilters: []runtimev1.MemoryBankScope{locator.GetScope()},
			OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{
				{
					Owner: &runtimev1.MemoryBankOwnerFilter_AgentCore{
						AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-canonical"},
					},
				},
			},
		}, stream)
	}()
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		svc.mu.RLock()
		defer svc.mu.RUnlock()
		return len(svc.subscribers) == 1
	})

	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	t.Cleanup(svc.StopReplicationLoop)

	waitForMemoryCondition(t, 2*time.Second, func() bool {
		return len(svc.ListReplicationBacklog()) == 0
	})
	if err := <-done; err != context.Canceled {
		t.Fatalf("SubscribeMemoryEvents returned %v, want context.Canceled", err)
	}
	if len(stream.events) != 3 {
		t.Fatalf("expected three replication events, got %d", len(stream.events))
	}
	if got := adapter.seenMemoryIDs(); len(got) != 3 {
		t.Fatalf("expected bridge adapter to process three memory ids, got %#v", got)
	}
	for _, event := range stream.events {
		if event.GetEventType() != runtimev1.MemoryEventType_MEMORY_EVENT_TYPE_REPLICATION_UPDATED {
			t.Fatalf("expected replication event, got %#v", event)
		}
	}

	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(historyResp.GetRecords()) != 3 {
		t.Fatalf("expected three visible records with include_invalidated, got %d", len(historyResp.GetRecords()))
	}
	historyHidden, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(hidden): %v", err)
	}
	if len(historyHidden.GetRecords()) != 2 {
		t.Fatalf("expected invalidated record hidden from default history, got %d", len(historyHidden.GetRecords()))
	}
}

func TestMemoryServicePendingBacklogMetadataSurvivesRestart(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
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
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-backlog-restart"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "pending backlog restart"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	loopCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := svc.StartReplicationLoop(loopCtx); err != nil {
		t.Fatalf("StartReplicationLoop: %v", err)
	}
	waitForMemoryCondition(t, 2*time.Second, func() bool {
		backlog := svc.ListReplicationBacklog()
		return len(backlog) == 1 && backlog[0].AttemptCount > 0
	})
	svc.StopReplicationLoop()
	before := svc.ListReplicationBacklog()
	if len(before) != 1 {
		t.Fatalf("expected one pending backlog item before restart, got %#v", before)
	}
	if err := svc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	restarted, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	defer func() {
		if err := restarted.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	after := restarted.ListReplicationBacklog()
	if len(after) != 1 {
		t.Fatalf("expected one pending backlog item after restart, got %#v", after)
	}
	if after[0].BacklogKey != before[0].BacklogKey ||
		after[0].MemoryID != retainResp.GetRecords()[0].GetMemoryId() ||
		after[0].LocalVersion != before[0].LocalVersion ||
		after[0].BasisVersion != before[0].BasisVersion ||
		after[0].AttemptCount != before[0].AttemptCount ||
		after[0].Status != before[0].Status ||
		after[0].LastAttemptOutcome != before[0].LastAttemptOutcome ||
		!after[0].EnqueuedAt.Equal(before[0].EnqueuedAt) ||
		!after[0].LastAttemptAt.Equal(before[0].LastAttemptAt) ||
		after[0].Locator.String() != before[0].Locator.String() {
		t.Fatalf("pending backlog metadata drifted across restart: before=%#v after=%#v", before[0], after[0])
	}
}

func TestMemoryServiceTerminalBacklogDoesNotReviveAfterRestart(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	svc, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
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
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-backlog-terminal"},
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
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "terminal backlog restart"},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	record := retainResp.GetRecords()[0]
	if len(svc.ListReplicationBacklog()) != 1 {
		t.Fatalf("expected one backlog item before terminal observation, got %#v", svc.ListReplicationBacklog())
	}
	observedAt := time.Now().UTC()
	if err := svc.ApplyReplicationObservation(locator, record.GetMemoryId(), &runtimev1.MemoryReplicationState{
		Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED,
		LocalVersion: record.GetReplication().GetLocalVersion(),
		BasisVersion: record.GetReplication().GetLocalVersion(),
		Detail: &runtimev1.MemoryReplicationState_Synced{
			Synced: &runtimev1.MemoryReplicationSynced{
				RealmVersion: "realm-terminal",
				SyncedAt:     timestamppb.New(observedAt),
			},
		},
	}, observedAt); err != nil {
		t.Fatalf("ApplyReplicationObservation(synced): %v", err)
	}
	if got := len(svc.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected terminal observation to remove backlog, got %d items", got)
	}
	if err := svc.PersistenceBackend().Close(); err != nil {
		t.Fatalf("Close(first backend): %v", err)
	}

	restarted, err := New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New(restart): %v", err)
	}
	defer func() {
		if err := restarted.PersistenceBackend().Close(); err != nil {
			t.Fatalf("Close(second backend): %v", err)
		}
	}()
	if got := len(restarted.ListReplicationBacklog()); got != 0 {
		t.Fatalf("expected no backlog after restart for terminal record, got %#v", restarted.ListReplicationBacklog())
	}
	historyResp, err := restarted.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(restart): %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected one record after restart, got %d", len(historyResp.GetRecords()))
	}
	if historyResp.GetRecords()[0].GetReplication().GetOutcome() != runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_SYNCED {
		t.Fatalf("expected synced replication state after restart, got %#v", historyResp.GetRecords()[0].GetReplication())
	}
}

func newTestMemoryRecord(t *testing.T) (*Service, *runtimev1.MemoryBankLocator, *runtimev1.MemoryRecord) {
	t.Helper()

	svc, err := New(nil, config.Config{
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
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
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
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
	svc.SetManagedEmbeddingProfile(&runtimev1.MemoryEmbeddingProfile{
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
