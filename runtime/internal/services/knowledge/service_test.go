package knowledge

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestKnowledgeBankAndPageLifecycle(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}

	createBankResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
		DisplayName: "Desktop Knowledge",
	})
	if err != nil {
		t.Fatalf("create knowledge bank: %v", err)
	}
	bankID := createBankResp.GetBank().GetBankId()
	if bankID == "" {
		t.Fatal("expected bank id")
	}

	putPageResp, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context:    reqCtx,
		BankId:     bankID,
		Slug:       "alice-profile",
		Title:      "Alice",
		Content:    "Alice likes sci-fi novels and writes every day.",
		EntityType: "person",
	})
	if err != nil {
		t.Fatalf("put page: %v", err)
	}
	pageID := putPageResp.GetPage().GetPageId()
	if pageID == "" {
		t.Fatal("expected page id")
	}

	getPageResp, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Lookup: &runtimev1.GetPageRequest_PageId{
			PageId: pageID,
		},
	})
	if err != nil {
		t.Fatalf("get page: %v", err)
	}
	if getPageResp.GetPage().GetSlug() != "alice-profile" {
		t.Fatalf("unexpected page slug: %s", getPageResp.GetPage().GetSlug())
	}

	listPagesResp, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{
		Context:  reqCtx,
		BankId:   bankID,
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("list pages: %v", err)
	}
	if len(listPagesResp.GetPages()) != 1 {
		t.Fatalf("expected 1 page, got %d", len(listPagesResp.GetPages()))
	}

	searchResp, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{
		Context: reqCtx,
		BankIds: []string{bankID},
		Query:   "sci-fi",
		TopK:    3,
	})
	if err != nil {
		t.Fatalf("search keyword: %v", err)
	}
	if len(searchResp.GetHits()) != 1 {
		t.Fatalf("expected 1 search hit, got %d", len(searchResp.GetHits()))
	}

	searchHybridResp, err := svc.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{
		Context:  reqCtx,
		BankId:   bankID,
		Query:    "writes every day",
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("search hybrid: %v", err)
	}
	if len(searchHybridResp.GetHits()) != 1 {
		t.Fatalf("expected 1 hybrid hit, got %d", len(searchHybridResp.GetHits()))
	}

	deletePageResp, err := svc.DeletePage(ctx, &runtimev1.DeletePageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Lookup: &runtimev1.DeletePageRequest_PageId{
			PageId: pageID,
		},
	})
	if err != nil {
		t.Fatalf("delete page: %v", err)
	}
	if !deletePageResp.GetAck().GetOk() {
		t.Fatal("delete page must succeed")
	}

	deleteBankResp, err := svc.DeleteKnowledgeBank(ctx, &runtimev1.DeleteKnowledgeBankRequest{
		Context: reqCtx,
		BankId:  bankID,
	})
	if err != nil {
		t.Fatalf("delete bank: %v", err)
	}
	if !deleteBankResp.GetAck().GetOk() {
		t.Fatal("delete bank must succeed")
	}
}

func TestCreateKnowledgeBankDuplicateReasonCode(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	req := &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
		},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	}

	if _, err := svc.CreateKnowledgeBank(ctx, req); err != nil {
		t.Fatalf("initial create: %v", err)
	}
	_, err := svc.CreateKnowledgeBank(ctx, req)
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("expected already exists, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS {
		t.Fatalf("unexpected reason: got=%v ok=%v", reason, ok)
	}
}

func TestGetKnowledgeBankMissingReasonCode(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.GetKnowledgeBank(context.Background(), &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
		},
		BankId: "missing-bank",
	})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected not found, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND {
		t.Fatalf("unexpected reason: got=%v ok=%v", reason, ok)
	}
}

func TestKnowledgeBankAccessDeniedReasonCode(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
		},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}

	_, err = svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.other",
			SubjectUserId: "user-002",
		},
		BankId: createResp.GetBank().GetBankId(),
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
		t.Fatalf("unexpected reason: got=%v ok=%v", reason, ok)
	}
}

func TestPutPageSlugConflictReasonCode(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()

	firstResp, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "shared-slug",
		Title:   "First",
		Content: "hello",
	})
	if err != nil {
		t.Fatalf("put first page: %v", err)
	}

	_, err = svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		PageId:  "another-page-id",
		Slug:    "shared-slug",
		Title:   "Second",
		Content: "world",
	})
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("expected already exists, got %v", err)
	}
	if firstResp.GetPage().GetPageId() == "" {
		t.Fatal("expected first page id")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT {
		t.Fatalf("unexpected reason: got=%v ok=%v", reason, ok)
	}
}

func TestListPagesPaginationAndSnippetUTF8(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()

	for _, item := range []struct {
		slug    string
		content string
	}{
		{"page-1", "你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界query"},
		{"page-2", "query second result"},
	} {
		if _, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
			Context: reqCtx,
			BankId:  bankID,
			Slug:    item.slug,
			Title:   item.slug,
			Content: item.content,
		}); err != nil {
			t.Fatalf("put page %s: %v", item.slug, err)
		}
	}

	page1, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{
		Context:  reqCtx,
		BankId:   bankID,
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("list pages page1: %v", err)
	}
	if len(page1.GetPages()) != 1 || page1.GetNextPageToken() == "" {
		t.Fatalf("unexpected first page payload: %+v", page1)
	}

	page2, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{
		Context:   reqCtx,
		BankId:    bankID,
		PageSize:  1,
		PageToken: page1.GetNextPageToken(),
	})
	if err != nil {
		t.Fatalf("list pages page2: %v", err)
	}
	if len(page2.GetPages()) != 1 {
		t.Fatalf("unexpected second page payload: %+v", page2)
	}

	searchResp, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{
		Context: reqCtx,
		BankIds: []string{bankID},
		Query:   "query",
		TopK:    999,
	})
	if err != nil {
		t.Fatalf("search keyword: %v", err)
	}
	if len(searchResp.GetHits()) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(searchResp.GetHits()))
	}
	if !utf8.ValidString(searchResp.GetHits()[0].GetSnippet()) {
		t.Fatal("snippet must preserve UTF-8 boundaries")
	}
}

func TestKnowledgeStatePersistsAcrossRestart(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	statePath := filepath.Join(t.TempDir(), "runtime-state")
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}

	svc, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("new persistent service: %v", err)
	}

	createResp, err := svc.CreateKnowledgeBank(context.Background(), &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
		DisplayName: "Persistent Knowledge",
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()
	if _, err := svc.PutPage(context.Background(), &runtimev1.PutPageRequest{
		Context:    reqCtx,
		BankId:     bankID,
		Slug:       "persisted-page",
		Title:      "Persisted Page",
		Content:    "runtime local knowledge survives restart",
		EntityType: "document",
	}); err != nil {
		t.Fatalf("put page: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("close persistent service: %v", err)
	}

	restarted, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("restart persistent service: %v", err)
	}
	defer func() {
		if err := restarted.Close(); err != nil {
			t.Fatalf("close restarted service: %v", err)
		}
	}()

	getBankResp, err := restarted.GetKnowledgeBank(context.Background(), &runtimev1.GetKnowledgeBankRequest{
		Context: reqCtx,
		BankId:  bankID,
	})
	if err != nil {
		t.Fatalf("get bank after restart: %v", err)
	}
	if getBankResp.GetBank().GetDisplayName() != "Persistent Knowledge" {
		t.Fatalf("unexpected bank after restart: %+v", getBankResp.GetBank())
	}

	getPageResp, err := restarted.GetPage(context.Background(), &runtimev1.GetPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Lookup: &runtimev1.GetPageRequest_Slug{
			Slug: "persisted-page",
		},
	})
	if err != nil {
		t.Fatalf("get page after restart: %v", err)
	}
	if got := getPageResp.GetPage().GetContent(); got != "runtime local knowledge survives restart" {
		t.Fatalf("unexpected page content after restart: %q", got)
	}
}

func TestKnowledgeIngestTaskLifecycle(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}

	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
		DisplayName: "Ingest Knowledge",
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}

	ingestResp, err := svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context:    reqCtx,
		BankId:     createResp.GetBank().GetBankId(),
		Slug:       "ingested-page",
		Title:      "Ingested Page",
		Content:    "runtime local ingest task content",
		EntityType: "document",
	})
	if err != nil {
		t.Fatalf("ingest document: %v", err)
	}
	if !ingestResp.GetAccepted() || ingestResp.GetTaskId() == "" {
		t.Fatalf("unexpected ingest response: %+v", ingestResp)
	}

	task := waitForIngestTaskStatus(t, svc, reqCtx, ingestResp.GetTaskId(), runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED, 2*time.Second)
	if task.GetPageId() == "" {
		t.Fatalf("expected completed task page id: %+v", task)
	}
	if task.GetProgressPercent() != 100 {
		t.Fatalf("expected completed progress=100, got %+v", task)
	}

	pageResp, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx,
		BankId:  createResp.GetBank().GetBankId(),
		Lookup: &runtimev1.GetPageRequest_PageId{
			PageId: task.GetPageId(),
		},
	})
	if err != nil {
		t.Fatalf("get ingested page: %v", err)
	}
	if got := pageResp.GetPage().GetContent(); got != "runtime local ingest task content" {
		t.Fatalf("unexpected ingested page content: %q", got)
	}
}

func TestKnowledgeIngestTaskPersistsAcrossRestart(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	statePath := filepath.Join(t.TempDir(), "runtime-state")
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}

	svc, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("new persistent service: %v", err)
	}
	createResp, err := svc.CreateKnowledgeBank(context.Background(), &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
		DisplayName: "Persistent Ingest",
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	ingestResp, err := svc.IngestDocument(context.Background(), &runtimev1.IngestDocumentRequest{
		Context: reqCtx,
		BankId:  createResp.GetBank().GetBankId(),
		Slug:    "persisted-ingest",
		Title:   "Persisted Ingest",
		Content: "persisted ingest content",
	})
	if err != nil {
		t.Fatalf("ingest document: %v", err)
	}
	task := waitForIngestTaskStatus(t, svc, reqCtx, ingestResp.GetTaskId(), runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED, 2*time.Second)
	if err := svc.Close(); err != nil {
		t.Fatalf("close persistent service: %v", err)
	}

	restarted, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("restart persistent service: %v", err)
	}
	defer func() {
		if err := restarted.Close(); err != nil {
			t.Fatalf("close restarted service: %v", err)
		}
	}()

	taskResp, err := restarted.GetIngestTask(context.Background(), &runtimev1.GetIngestTaskRequest{
		Context: reqCtx,
		TaskId:  ingestResp.GetTaskId(),
	})
	if err != nil {
		t.Fatalf("get ingest task after restart: %v", err)
	}
	if taskResp.GetTask().GetStatus() != runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED || taskResp.GetTask().GetPageId() != task.GetPageId() {
		t.Fatalf("unexpected ingest task after restart: %+v", taskResp.GetTask())
	}
}

func TestKnowledgeGraphLifecycleAndTraversal(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()

	pageIDs := make(map[string]string)
	for _, slug := range []string{"root", "child-a", "child-b"} {
		putResp, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
			Context: reqCtx,
			BankId:  bankID,
			Slug:    slug,
			Title:   strings.ToUpper(slug),
			Content: slug + " page",
		})
		if err != nil {
			t.Fatalf("put page %s: %v", slug, err)
		}
		pageIDs[slug] = putResp.GetPage().GetPageId()
	}

	firstLink, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageIDs["root"],
		ToPageId:   pageIDs["child-a"],
		LinkType:   "references",
	})
	if err != nil {
		t.Fatalf("add link root->child-a: %v", err)
	}
	if _, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageIDs["child-a"],
		ToPageId:   pageIDs["child-b"],
		LinkType:   "references",
	}); err != nil {
		t.Fatalf("add link child-a->child-b: %v", err)
	}

	outgoingResp, err := svc.ListLinks(ctx, &runtimev1.ListLinksRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageIDs["root"],
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("list links: %v", err)
	}
	if len(outgoingResp.GetLinks()) != 1 || outgoingResp.GetLinks()[0].GetToSlug() != "child-a" {
		t.Fatalf("unexpected outgoing links: %+v", outgoingResp.GetLinks())
	}

	backlinksResp, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{
		Context:  reqCtx,
		BankId:   bankID,
		ToPageId: pageIDs["child-a"],
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("list backlinks: %v", err)
	}
	if len(backlinksResp.GetBacklinks()) != 1 || backlinksResp.GetBacklinks()[0].GetFromSlug() != "root" {
		t.Fatalf("unexpected backlinks: %+v", backlinksResp.GetBacklinks())
	}

	traversalResp, err := svc.TraverseGraph(ctx, &runtimev1.TraverseGraphRequest{
		Context:    reqCtx,
		BankId:     bankID,
		RootPageId: pageIDs["root"],
		MaxDepth:   2,
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("traverse graph: %v", err)
	}
	if len(traversalResp.GetNodes()) != 3 {
		t.Fatalf("expected 3 traversal nodes, got %d", len(traversalResp.GetNodes()))
	}
	if traversalResp.GetNodes()[0].GetDepth() != 0 || traversalResp.GetNodes()[0].GetSlug() != "root" {
		t.Fatalf("unexpected traversal root: %+v", traversalResp.GetNodes()[0])
	}

	removeResp, err := svc.RemoveLink(ctx, &runtimev1.RemoveLinkRequest{
		Context: reqCtx,
		BankId:  bankID,
		LinkId:  firstLink.GetLink().GetLinkId(),
	})
	if err != nil {
		t.Fatalf("remove link: %v", err)
	}
	if !removeResp.GetAck().GetOk() {
		t.Fatal("remove link must succeed")
	}
}

func TestAddLinkRejectsDuplicateAndInvalidRelations(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}
	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()

	pageA, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "page-a",
		Title:   "Page A",
	})
	if err != nil {
		t.Fatalf("put page a: %v", err)
	}
	pageB, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "page-b",
		Title:   "Page B",
	})
	if err != nil {
		t.Fatalf("put page b: %v", err)
	}

	if _, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageA.GetPage().GetPageId(),
		ToPageId:   pageB.GetPage().GetPageId(),
		LinkType:   "references",
	}); err != nil {
		t.Fatalf("add first link: %v", err)
	}

	_, err = svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageA.GetPage().GetPageId(),
		ToPageId:   pageB.GetPage().GetPageId(),
		LinkType:   "references",
	})
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("expected already exists, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_LINK_ALREADY_EXISTS {
		t.Fatalf("unexpected duplicate reason: got=%v ok=%v", reason, ok)
	}

	_, err = svc.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: pageA.GetPage().GetPageId(),
		ToPageId:   pageA.GetPage().GetPageId(),
		LinkType:   "references",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID {
		t.Fatalf("unexpected invalid relation reason: got=%v ok=%v", reason, ok)
	}
}

func TestKnowledgeGraphPersistsAcrossRestart(t *testing.T) {
	t.Parallel()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	statePath := filepath.Join(t.TempDir(), "runtime-state")
	reqCtx := &runtimev1.KnowledgeRequestContext{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
	}

	svc, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("new persistent service: %v", err)
	}
	createResp, err := svc.CreateKnowledgeBank(context.Background(), &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
	})
	if err != nil {
		t.Fatalf("create bank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()
	rootPage, err := svc.PutPage(context.Background(), &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "root",
		Title:   "Root",
	})
	if err != nil {
		t.Fatalf("put root page: %v", err)
	}
	childPage, err := svc.PutPage(context.Background(), &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "child",
		Title:   "Child",
	})
	if err != nil {
		t.Fatalf("put child page: %v", err)
	}
	if _, err := svc.AddLink(context.Background(), &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: rootPage.GetPage().GetPageId(),
		ToPageId:   childPage.GetPage().GetPageId(),
		LinkType:   "references",
	}); err != nil {
		t.Fatalf("add link: %v", err)
	}
	if err := svc.Close(); err != nil {
		t.Fatalf("close persistent service: %v", err)
	}

	restarted, err := NewPersistent(logger, statePath)
	if err != nil {
		t.Fatalf("restart persistent service: %v", err)
	}
	defer func() {
		if err := restarted.Close(); err != nil {
			t.Fatalf("close restarted service: %v", err)
		}
	}()

	linksResp, err := restarted.ListLinks(context.Background(), &runtimev1.ListLinksRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: rootPage.GetPage().GetPageId(),
		PageSize:   10,
	})
	if err != nil {
		t.Fatalf("list links after restart: %v", err)
	}
	if len(linksResp.GetLinks()) != 1 || linksResp.GetLinks()[0].GetToSlug() != "child" {
		t.Fatalf("unexpected links after restart: %+v", linksResp.GetLinks())
	}
}

func waitForIngestTaskStatus(t *testing.T, svc *Service, reqCtx *runtimev1.KnowledgeRequestContext, taskID string, expected runtimev1.KnowledgeIngestTaskStatus, timeout time.Duration) *runtimev1.KnowledgeIngestTask {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetIngestTask(context.Background(), &runtimev1.GetIngestTaskRequest{
			Context: reqCtx,
			TaskId:  taskID,
		})
		if err == nil && resp.GetTask().GetStatus() == expected {
			return resp.GetTask()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetIngestTask(context.Background(), &runtimev1.GetIngestTaskRequest{
		Context: reqCtx,
		TaskId:  taskID,
	})
	if err != nil {
		t.Fatalf("get ingest task after timeout: %v", err)
	}
	t.Fatalf("ingest task %s did not reach %s: %+v", taskID, expected.String(), resp.GetTask())
	return nil
}
