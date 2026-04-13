package memory

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/memoryengine"
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
