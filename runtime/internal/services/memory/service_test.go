package memory

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
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

func TestMemoryServiceDeleteMemoryFailsClosedForMissingIDs(t *testing.T) {
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
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-1",
				},
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "first"},
				},
			},
			{
				Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_NONE,
				Provenance: &runtimev1.MemoryProvenance{
					SourceSystem:  "test",
					SourceEventId: "evt-2",
				},
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "second"},
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

	_, err = svc.DeleteMemory(ctx, &runtimev1.DeleteMemoryRequest{
		Bank:      createResp.GetBank().GetLocator(),
		MemoryIds: []string{retainResp.GetRecords()[0].GetMemoryId(), "mem-missing"},
		Reason:    "partial delete must fail closed",
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound for partial delete, got %v", err)
	}

	historyResp, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History(after failed delete): %v", err)
	}
	if len(historyResp.GetRecords()) != 2 {
		t.Fatalf("expected failed partial delete to preserve both records, got %d", len(historyResp.GetRecords()))
	}

	deleteResp, err := svc.DeleteMemory(ctx, &runtimev1.DeleteMemoryRequest{
		Bank:      createResp.GetBank().GetLocator(),
		MemoryIds: []string{retainResp.GetRecords()[0].GetMemoryId()},
		Reason:    "single delete",
	})
	if err != nil {
		t.Fatalf("DeleteMemory(single): %v", err)
	}
	if got := deleteResp.GetDeletedMemoryIds(); len(got) != 1 || got[0] != retainResp.GetRecords()[0].GetMemoryId() {
		t.Fatalf("expected only the actually deleted id, got %v", got)
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

func TestMemoryServiceRetainFailsClosedWhenEmbeddingExecutorMissing(t *testing.T) {
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
		ModelId:         "local/embed-missing-executor",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-missing-executor@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)

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

	_, err = svc.Retain(ctx, &runtimev1.RetainRequest{
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
		},
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected Unavailable without embedding executor, got %v", err)
	}
}

func TestMemoryServiceRetainEmbeddingFailureRestoresOwnerState(t *testing.T) {
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
		ModelId:         "local/embed-retain-rollback",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-retain-rollback@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		vectors := make([][]float64, len(inputs))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return vectors, nil
	})

	ctx := context.Background()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-retain-rollback"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, locator, "Rollback Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankResolvedEmbeddingProfile(ctx, locator, profile); err != nil {
		t.Fatalf("BindCanonicalBankResolvedEmbeddingProfile: %v", err)
	}
	seeded, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: "existing committed memory"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("Retain(seed): %v", err)
	}
	if len(seeded.GetRecords()) != 1 {
		t.Fatalf("seeded records = %d want 1", len(seeded.GetRecords()))
	}
	executorErr := errors.New("embedding executor failed")
	svc.SetRuntimeEmbeddingVectorExecutor(func(context.Context, *runtimev1.MemoryEmbeddingProfile, []string) ([][]float64, error) {
		return nil, executorErr
	})

	svc.mu.RLock()
	before := cloneBankState(svc.banks[locatorKey(locator)])
	beforeSequence := svc.sequence
	svc.mu.RUnlock()
	beforeBacklog := svc.ListReplicationBacklog()

	_, err = svc.Retain(ctx, &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{
				Observational: &runtimev1.ObservationalMemoryRecord{Observation: "must not survive failed retention"},
			},
		}},
	})
	if !errors.Is(err, executorErr) {
		t.Fatalf("Retain error = %v, want executor failure", err)
	}

	svc.mu.RLock()
	after := cloneBankState(svc.banks[locatorKey(locator)])
	afterSequence := svc.sequence
	svc.mu.RUnlock()
	if !proto.Equal(after.Bank, before.Bank) {
		t.Fatalf("bank changed after failed retention: before=%v after=%v", before.Bank, after.Bank)
	}
	if len(after.Records) != len(before.Records) || len(after.Order) != len(before.Order) {
		t.Fatalf("record owner state changed after failed retention: records=%d/%d order=%d/%d", len(after.Records), len(before.Records), len(after.Order), len(before.Order))
	}
	if afterSequence != beforeSequence {
		t.Fatalf("sequence changed after failed retention: got %d want %d", afterSequence, beforeSequence)
	}
	if backlog := svc.ListReplicationBacklog(); !reflect.DeepEqual(backlog, beforeBacklog) {
		t.Fatalf("replication backlog changed after failed retention: before=%#v after=%#v", beforeBacklog, backlog)
	}

	history, err := svc.History(ctx, &runtimev1.HistoryRequest{
		Bank:  locator,
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10},
	})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history.GetRecords()) != 1 || history.GetRecords()[0].GetMemoryId() != seeded.GetRecords()[0].GetMemoryId() {
		t.Fatalf("failed retention changed visible history: %#v", history.GetRecords())
	}
	var persistedRecords int
	if err := svc.PersistenceBackend().DB().QueryRow(`SELECT COUNT(*) FROM memory_record WHERE locator_key = ?`, locatorKey(locator)).Scan(&persistedRecords); err != nil {
		t.Fatalf("count persisted records: %v", err)
	}
	if persistedRecords != 1 {
		t.Fatalf("persisted records after failed retention = %d want 1", persistedRecords)
	}
}

func TestMemoryServiceRetainPropagatesCallerCancellationToPersistedEmbedding(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "local/embed-retain-cancel",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-retain-cancel@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		vectors := make([][]float64, len(inputs))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return vectors, nil
	})
	locator := testMemoryEmbeddingLocator("agent-retain-cancel")
	if _, err := svc.EnsureCanonicalBank(context.Background(), locator, "Cancel Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankResolvedEmbeddingProfile(context.Background(), locator, profile); err != nil {
		t.Fatalf("BindCanonicalBankResolvedEmbeddingProfile: %v", err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	svc.SetRuntimeEmbeddingVectorExecutor(func(ctx context.Context, _ *runtimev1.MemoryEmbeddingProfile, _ []string) ([][]float64, error) {
		close(started)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-release:
			return nil, errors.New("released unbounded embedding executor")
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, retainErr := svc.Retain(ctx, &runtimev1.RetainRequest{
			Bank: locator,
			Records: []*runtimev1.MemoryRecordInput{{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{Observational: &runtimev1.ObservationalMemoryRecord{
					Observation: "must not survive canceled retention",
				}},
			}},
		})
		result <- retainErr
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("embedding executor did not start")
	}
	cancel()
	var retainErr error
	timedOut := false
	select {
	case retainErr = <-result:
	case <-time.After(time.Second):
		timedOut = true
		close(release)
		retainErr = <-result
	}
	if timedOut {
		t.Fatal("Retain did not stop after caller cancellation")
	}
	if !errors.Is(retainErr, context.Canceled) {
		t.Fatalf("Retain error = %v, want context.Canceled", retainErr)
	}
	history, err := svc.History(context.Background(), &runtimev1.HistoryRequest{Bank: locator, Query: &runtimev1.MemoryHistoryQuery{PageSize: 10}})
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(history.GetRecords()) != 0 {
		t.Fatalf("canceled retention changed owner history: %#v", history.GetRecords())
	}
	var persistedRecords int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM memory_record WHERE locator_key = ?`, locatorKey(locator)).Scan(&persistedRecords); err != nil {
		t.Fatalf("count persisted records: %v", err)
	}
	if persistedRecords != 0 {
		t.Fatalf("canceled retention persisted %d records", persistedRecords)
	}
}

func TestMemoryServiceRetainEmbeddingRunsOutsideOwnerLock(t *testing.T) {
	t.Parallel()

	svc, err := New(nil, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	closeMemoryServiceForTest(t, svc)
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "local/embed-retain-lock",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-retain-lock@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		vectors := make([][]float64, len(inputs))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return vectors, nil
	})
	locator := testMemoryEmbeddingLocator("agent-retain-lock")
	if _, err := svc.EnsureCanonicalBank(context.Background(), locator, "Lock Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankResolvedEmbeddingProfile(context.Background(), locator, profile); err != nil {
		t.Fatalf("BindCanonicalBankResolvedEmbeddingProfile: %v", err)
	}
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		if !svc.mu.TryRLock() {
			return nil, errors.New("embedding executor ran while the Memory owner lock was held")
		}
		svc.mu.RUnlock()
		vectors := make([][]float64, len(inputs))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return vectors, nil
	})
	if _, err := svc.Retain(context.Background(), &runtimev1.RetainRequest{
		Bank: locator,
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
			Payload: &runtimev1.MemoryRecordInput_Observational{Observational: &runtimev1.ObservationalMemoryRecord{
				Observation: "embedding runs outside Memory owner lock",
			}},
		}},
	}); err != nil {
		t.Fatalf("Retain: %v", err)
	}
}

func TestMemoryServiceCloseCancelsInFlightRetainEmbeddingBeforeBackendClose(t *testing.T) {
	t.Parallel()

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(nil, config.Config{LocalStatePath: statePath})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "local",
		ModelId:         "local/embed-retain-close",
		Dimension:       2,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "local/embed-retain-close@v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	svc.SetManagedEmbeddingProfile(profile)
	svc.SetRuntimeEmbeddingVectorExecutor(func(_ context.Context, _ *runtimev1.MemoryEmbeddingProfile, inputs []string) ([][]float64, error) {
		vectors := make([][]float64, len(inputs))
		for index := range vectors {
			vectors[index] = []float64{1, 0}
		}
		return vectors, nil
	})
	locator := testMemoryEmbeddingLocator("agent-retain-close")
	if _, err := svc.EnsureCanonicalBank(context.Background(), locator, "Close Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	if _, err := svc.BindCanonicalBankResolvedEmbeddingProfile(context.Background(), locator, profile); err != nil {
		t.Fatalf("BindCanonicalBankResolvedEmbeddingProfile: %v", err)
	}
	started := make(chan struct{})
	svc.SetRuntimeEmbeddingVectorExecutor(func(ctx context.Context, _ *runtimev1.MemoryEmbeddingProfile, _ []string) ([][]float64, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	retainResult := make(chan error, 1)
	go func() {
		_, retainErr := svc.Retain(context.Background(), &runtimev1.RetainRequest{
			Bank: locator,
			Records: []*runtimev1.MemoryRecordInput{{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{Observational: &runtimev1.ObservationalMemoryRecord{
					Observation: "must not survive service close",
				}},
			}},
		})
		retainResult <- retainErr
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("embedding executor did not start")
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	select {
	case retainErr := <-retainResult:
		if !errors.Is(retainErr, context.Canceled) {
			t.Fatalf("Retain error = %v, want context.Canceled", retainErr)
		}
	case <-time.After(time.Second):
		t.Fatal("Retain did not finish before Close returned")
	}

	restarted, err := New(nil, config.Config{LocalStatePath: statePath})
	if err != nil {
		t.Fatalf("New(restarted): %v", err)
	}
	defer func() { _ = restarted.Close() }()
	history, err := restarted.History(context.Background(), &runtimev1.HistoryRequest{Bank: locator, Query: &runtimev1.MemoryHistoryQuery{PageSize: 10}})
	if err != nil {
		t.Fatalf("History(restarted): %v", err)
	}
	if len(history.GetRecords()) != 0 {
		t.Fatalf("closed in-flight retention reached durable state: %#v", history.GetRecords())
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

func TestMemoryServicePublicBankAccessRejectsRuntimeOwnedCanonicalScopes(t *testing.T) {
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
	canonical := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: "agent-public-denied"},
		},
	}
	if _, err := svc.EnsureCanonicalBank(ctx, canonical, "Agent Memory", nil); err != nil {
		t.Fatalf("EnsureCanonicalBank: %v", err)
	}
	appResp, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app.test"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}

	if _, err := svc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: canonical}); err != nil {
		t.Fatalf("internal GetBank canonical: %v", err)
	}
	if _, err := svc.GetBank(ctx, &runtimev1.GetBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.test", SubjectUserId: "user-1"},
		Locator: canonical,
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("public GetBank canonical code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	if _, err := svc.ListBanks(ctx, &runtimev1.ListBanksRequest{
		Context:      &runtimev1.MemoryRequestContext{AppId: "app.test", SubjectUserId: "user-1"},
		ScopeFilters: []runtimev1.MemoryBankScope{runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE},
	}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("public ListBanks canonical filter code=%v err=%v, want PermissionDenied", status.Code(err), err)
	}
	listResp, err := svc.ListBanks(ctx, &runtimev1.ListBanksRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app.test", SubjectUserId: "user-1"},
	})
	if err != nil {
		t.Fatalf("public ListBanks: %v", err)
	}
	if len(listResp.GetBanks()) != 1 || listResp.GetBanks()[0].GetBankId() != appResp.GetBank().GetBankId() {
		t.Fatalf("public ListBanks must only return direct app-accessible banks, got=%v", listResp.GetBanks())
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
