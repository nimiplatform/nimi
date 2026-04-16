package cognition

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	knowledgeservice "github.com/nimiplatform/nimi/runtime/internal/services/knowledge"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRuntimeCognitionMemoryUsesNimiCognitionMainline(t *testing.T) {
	svc, memorySvc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	createResp, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app-test"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}

	retainResp, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC,
			Payload: &runtimev1.MemoryRecordInput_Episodic{
				Episodic: &runtimev1.EpisodicMemoryRecord{
					Summary: "runtime cognition memory bridge",
				},
			},
		}},
	})
	if err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if len(retainResp.GetRecords()) != 1 {
		t.Fatalf("retain records mismatch: got=%d want=1", len(retainResp.GetRecords()))
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Query:   &runtimev1.MemoryRecallQuery{Query: "bridge", Limit: 5},
	})
	if err != nil {
		t.Fatalf("Recall: %v", err)
	}
	if len(recallResp.GetHits()) != 1 {
		t.Fatalf("recall hits mismatch: got=%d want=1", len(recallResp.GetHits()))
	}

	legacyResp, err := memorySvc.Recall(ctx, &runtimev1.RecallRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Query:   &runtimev1.MemoryRecallQuery{Query: "bridge", Limit: 5},
	})
	if err != nil {
		t.Fatalf("legacy Recall: %v", err)
	}
	if len(legacyResp.GetHits()) != 0 {
		t.Fatalf("legacy memory baseline unexpectedly became mainline: got=%d hits", len(legacyResp.GetHits()))
	}
}

func TestRuntimeCognitionKnowledgeUsesNimiCognitionMainline(t *testing.T) {
	svc, _, knowledgeSvc, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app-test"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}

	putResp, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context:    &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:     createResp.GetBank().GetBankId(),
		Slug:       "runtime-cognition",
		Title:      "Runtime Cognition",
		Content:    "nimi cognition bridge search body",
		EntityType: "note",
	})
	if err != nil {
		t.Fatalf("PutPage: %v", err)
	}
	if putResp.GetPage().GetPageId() == "" {
		t.Fatal("PutPage returned empty page_id")
	}

	searchResp, err := svc.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:  createResp.GetBank().GetBankId(),
		Query:   "bridge",
	})
	if err != nil {
		t.Fatalf("SearchHybrid: %v", err)
	}
	if len(searchResp.GetHits()) != 1 {
		t.Fatalf("search hits mismatch: got=%d want=1", len(searchResp.GetHits()))
	}

	_, err = knowledgeSvc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:  createResp.GetBank().GetBankId(),
		Lookup: &runtimev1.GetPageRequest_PageId{
			PageId: putResp.GetPage().GetPageId(),
		},
	})
	if err == nil {
		t.Fatal("legacy knowledge baseline unexpectedly served runtime cognition page")
	}
}

func TestRuntimeCognitionMemoryHonorsBoundEmbeddingProfileAvailability(t *testing.T) {
	svc, memorySvc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	profile := &runtimev1.MemoryEmbeddingProfile{
		Provider:        "test-provider",
		ModelId:         "embed-small",
		Dimension:       16,
		DistanceMetric:  runtimev1.MemoryDistanceMetric_MEMORY_DISTANCE_METRIC_COSINE,
		Version:         "v1",
		MigrationPolicy: runtimev1.MemoryMigrationPolicy_MEMORY_MIGRATION_POLICY_REINDEX,
	}
	createResp, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Locator: &runtimev1.PublicMemoryBankLocator{
			Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app-test"},
			},
		},
		EmbeddingProfile: profile,
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}

	_, err = svc.Retain(ctx, &runtimev1.RetainRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC,
			Payload: &runtimev1.MemoryRecordInput_Episodic{
				Episodic: &runtimev1.EpisodicMemoryRecord{Summary: "needs embedding gate"},
			},
		}},
	})
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected Unavailable retain failure, got %v", err)
	}

	memorySvc.SetManagedEmbeddingProfile(profile)
	if _, err := svc.Retain(ctx, &runtimev1.RetainRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{{
			Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_EPISODIC,
			Payload: &runtimev1.MemoryRecordInput_Episodic{
				Episodic: &runtimev1.EpisodicMemoryRecord{Summary: "embedding gate satisfied"},
			},
		}},
	}); err != nil {
		t.Fatalf("Retain with managed embedding profile: %v", err)
	}

	recallResp, err := svc.Recall(ctx, &runtimev1.RecallRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		Bank:    createResp.GetBank().GetLocator(),
		Query:   &runtimev1.MemoryRecallQuery{Query: "satisfied", Limit: 5},
	})
	if err != nil {
		t.Fatalf("Recall with managed embedding profile: %v", err)
	}
	if len(recallResp.GetHits()) != 1 {
		t.Fatalf("recall hits mismatch: got=%d want=1", len(recallResp.GetHits()))
	}
}

func TestRuntimeCognitionKnowledgeIngestRejectsInvalidEnvelope(t *testing.T) {
	svc, _, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app-test"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}

	_, err = svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:  createResp.GetBank().GetBankId(),
		Content: "missing slug should fail",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument ingest failure, got %v", err)
	}

	_, err = svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:  createResp.GetBank().GetBankId(),
		Slug:    "missing-content",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument ingest failure for missing content, got %v", err)
	}
}

func TestRuntimeCognitionKnowledgeIngestTaskPreservesSlugAndTitle(t *testing.T) {
	svc, _, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := context.Background()
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app-test"},
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}

	ingestResp, err := svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		BankId:  createResp.GetBank().GetBankId(),
		Slug:    "runtime-cognition-ingest",
		Title:   "Runtime Cognition Ingest",
		Content: "ingest body",
	})
	if err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}

	taskResp, err := svc.GetIngestTask(ctx, &runtimev1.GetIngestTaskRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app-test"},
		TaskId:  ingestResp.GetTaskId(),
	})
	if err != nil {
		t.Fatalf("GetIngestTask: %v", err)
	}
	if taskResp.GetTask().GetSlug() != "runtime-cognition-ingest" {
		t.Fatalf("unexpected ingest task slug: %q", taskResp.GetTask().GetSlug())
	}
	if taskResp.GetTask().GetTitle() != "Runtime Cognition Ingest" {
		t.Fatalf("unexpected ingest task title: %q", taskResp.GetTask().GetTitle())
	}
}

func newTestService(t *testing.T) (*Service, *memoryservice.Service, *knowledgeservice.Service, func()) {
	t.Helper()

	root := t.TempDir()
	cfg := config.Config{LocalStatePath: filepath.Join(root, "local-state.json")}
	logger := slog.New(slog.NewTextHandler(testWriter{t: t}, nil))

	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		t.Fatalf("memoryservice.New: %v", err)
	}
	knowledgeSvc, err := knowledgeservice.NewWithBackend(logger, memorySvc.PersistenceBackend())
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("knowledgeservice.NewWithBackend: %v", err)
	}
	svc, err := New(logger, cfg, memorySvc, knowledgeSvc)
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("cognition.New: %v", err)
	}

	cleanup := func() {
		_ = svc.Close()
		_ = knowledgeSvc.Close()
		_ = memorySvc.Close()
	}
	return svc, memorySvc, knowledgeSvc, cleanup
}

type testWriter struct {
	t *testing.T
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}
