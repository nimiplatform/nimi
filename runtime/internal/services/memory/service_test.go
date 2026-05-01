package memory

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func closeMemoryServiceForTest(t *testing.T, svc *Service) {
	t.Helper()
	t.Cleanup(func() {
		if svc == nil {
			return
		}
		if err := svc.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	})
}

func TestMemoryServiceCreateRetainRecallDelete(t *testing.T) {
	t.Parallel()

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

func TestMemoryServiceRecallUsesInjectedEmbeddingExecutor(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{
		LocalStatePath: filepath.Join(t.TempDir(), "local-state.json"),
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "local/embed-memory-test",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-memory-test@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		out := make([][]float64, 0, len(inputs))
		for _, input := range inputs {
			lower := strings.ToLower(strings.TrimSpace(input))
			switch {
			case strings.Contains(lower, "needle"), strings.Contains(lower, "beta"):
				out = append(out, []float64{1, 0})
			case strings.Contains(lower, "alpha"):
				out = append(out, []float64{0, 1})
			default:
				out = append(out, []float64{0.5, 0.5})
			}
		}
		return out, nil
	})

	ctx := context.Background()
	createResp, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.embed.test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{
					AccountId: "acct-embed",
					AppId:     "app.embed.test",
				},
			},
		},
		DisplayName:      "Embedding Test Bank",
		EmbeddingProfile: cloneEmbeddingProfile(profile),
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}

	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   "Alpha",
						Predicate: "stores",
						Object:    "Document",
					},
				},
			},
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_SEMANTIC,
				Payload: &runtimev1.MemoryRecordInput_Semantic{
					Semantic: &runtimev1.SemanticMemoryRecord{
						Subject:   "Beta",
						Predicate: "stores",
						Object:    "Document",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if len(retainResp.GetRecords()) != 2 {
		t.Fatalf("expected 2 retained records, got %d", len(retainResp.GetRecords()))
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Bank: createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryRecallQuery{
			Query: "needle",
			Limit: 2,
		},
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(recallResp.GetHits()) < 2 {
		t.Fatalf("expected 2 recall hits, got %d", len(recallResp.GetHits()))
	}
	top := recallResp.GetHits()[0].GetRecord()
	if top == nil || !strings.Contains(strings.ToLower(top.String()), "beta") {
		t.Fatalf("expected injected embedding executor to rank beta first, got %#v", top)
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
	closeMemoryServiceForTest(t, svc)

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
	closeMemoryServiceForTest(t, svc)

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
	closeMemoryServiceForTest(t, svc)

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
	closeMemoryServiceForTest(t, svc)

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
	closeMemoryServiceForTest(t, svc)
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
	closeMemoryServiceForTest(t, svc)
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
