package cognition

import (
	"context"
	"log/slog"
	"net"
	"path/filepath"
	"testing"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestRuntimeKnowledgeGRPCE2EAppPrivateLifecycle(t *testing.T) {
	h := startKnowledgeGRPCHarness(t, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")})
	defer h.close()

	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.g3"}
	ctx := testKnowledgeGRPCContext(reqCtx.GetAppId())
	createResp, err := h.client.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.g3"},
			},
		},
		DisplayName: "G3 Bank",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()
	if bankID == "" {
		t.Fatal("CreateKnowledgeBank returned empty bank_id")
	}

	listResp, err := h.client.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: reqCtx})
	if err != nil {
		t.Fatalf("ListKnowledgeBanks: %v", err)
	}
	if len(listResp.GetBanks()) != 1 || listResp.GetBanks()[0].GetBankId() != bankID {
		t.Fatalf("ListKnowledgeBanks mismatch: got=%v bankID=%q", listResp.GetBanks(), bankID)
	}

	rootPage := putKnowledgePageGRPC(t, h.client, reqCtx, bankID, "root", "Root", "runtime hard cut root body")
	childPage := putKnowledgePageGRPC(t, h.client, reqCtx, bankID, "child", "Child", "runtime hard cut child body")

	if _, err := h.client.GetPage(ctx, &runtimev1.GetPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Lookup:  &runtimev1.GetPageRequest_Slug{Slug: "root"},
	}); err != nil {
		t.Fatalf("GetPage by slug: %v", err)
	}

	pagesResp, err := h.client.ListPages(ctx, &runtimev1.ListPagesRequest{Context: reqCtx, BankId: bankID, PageSize: 10})
	if err != nil {
		t.Fatalf("ListPages: %v", err)
	}
	if len(pagesResp.GetPages()) != 2 {
		t.Fatalf("ListPages count mismatch: got=%d want=2", len(pagesResp.GetPages()))
	}

	keywordResp, err := h.client.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{
		Context: reqCtx,
		BankIds: []string{bankID},
		Query:   "hard cut",
		TopK:    10,
	})
	if err != nil {
		t.Fatalf("SearchKeyword: %v", err)
	}
	if len(keywordResp.GetHits()) == 0 {
		t.Fatal("SearchKeyword returned no hits")
	}

	hybridResp, err := h.client.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{
		Context:  reqCtx,
		BankId:   bankID,
		Query:    "hard cut",
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("SearchHybrid: %v", err)
	}
	if len(hybridResp.GetHits()) == 0 {
		t.Fatal("SearchHybrid returned no hits")
	}

	linkResp, err := h.client.AddLink(ctx, &runtimev1.AddLinkRequest{
		Context:    reqCtx,
		BankId:     bankID,
		FromPageId: rootPage.GetPageId(),
		ToPageId:   childPage.GetPageId(),
		LinkType:   "supports",
	})
	if err != nil {
		t.Fatalf("AddLink: %v", err)
	}
	if linkResp.GetLink().GetLinkId() == "" {
		t.Fatal("AddLink returned empty link_id")
	}

	linksResp, err := h.client.ListLinks(ctx, &runtimev1.ListLinksRequest{Context: reqCtx, BankId: bankID, FromPageId: rootPage.GetPageId()})
	if err != nil {
		t.Fatalf("ListLinks: %v", err)
	}
	if len(linksResp.GetLinks()) != 1 {
		t.Fatalf("ListLinks count mismatch: got=%d want=1", len(linksResp.GetLinks()))
	}

	backlinksResp, err := h.client.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{Context: reqCtx, BankId: bankID, ToPageId: childPage.GetPageId()})
	if err != nil {
		t.Fatalf("ListBacklinks: %v", err)
	}
	if len(backlinksResp.GetBacklinks()) != 1 {
		t.Fatalf("ListBacklinks count mismatch: got=%d want=1", len(backlinksResp.GetBacklinks()))
	}

	traverseResp, err := h.client.TraverseGraph(ctx, &runtimev1.TraverseGraphRequest{
		Context:    reqCtx,
		BankId:     bankID,
		RootPageId: rootPage.GetPageId(),
		MaxDepth:   1,
	})
	if err != nil {
		t.Fatalf("TraverseGraph: %v", err)
	}
	if len(traverseResp.GetNodes()) == 0 {
		t.Fatal("TraverseGraph returned no nodes")
	}

	ingestResp, err := h.client.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "ingested",
		Title:   "Ingested",
		Content: "runtime hard cut ingested body",
	})
	if err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}
	taskResp := waitKnowledgeIngestCompletedGRPC(t, h.client, reqCtx, ingestResp.GetTaskId())
	if taskResp.GetTask().GetSlug() != "ingested" {
		t.Fatalf("GetIngestTask slug mismatch: got=%q", taskResp.GetTask().GetSlug())
	}

	if _, err := h.client.DeleteKnowledgeBank(ctx, &runtimev1.DeleteKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err != nil {
		t.Fatalf("DeleteKnowledgeBank: %v", err)
	}
	_, err = h.client.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("GetKnowledgeBank after delete: got=%v want NotFound", err)
	}
}

func TestRuntimeKnowledgeGRPCE2ERestartDurability(t *testing.T) {
	cfg := config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")}
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.g3.restart"}
	ctx := testKnowledgeGRPCContext(reqCtx.GetAppId())

	h := startKnowledgeGRPCHarness(t, cfg)
	createResp, err := h.client.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.g3.restart"},
			},
		},
		DisplayName: "Durable Bank",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()
	rootPage := putKnowledgePageGRPC(t, h.client, reqCtx, bankID, "durable-root", "Durable Root", "durable hard cut body")
	childPage := putKnowledgePageGRPC(t, h.client, reqCtx, bankID, "durable-child", "Durable Child", "durable child body")
	if _, err := h.client.AddLink(ctx, &runtimev1.AddLinkRequest{Context: reqCtx, BankId: bankID, FromPageId: rootPage.GetPageId(), ToPageId: childPage.GetPageId(), LinkType: "durable"}); err != nil {
		t.Fatalf("AddLink: %v", err)
	}
	ingestResp, err := h.client.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    "durable-ingested",
		Title:   "Durable Ingested",
		Content: "durable ingested body",
	})
	if err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}
	taskID := ingestResp.GetTaskId()
	waitKnowledgeIngestCompletedGRPC(t, h.client, reqCtx, taskID)
	if _, err := h.client.GetPage(ctx, &runtimev1.GetPageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.GetPageRequest_Slug{Slug: "durable-ingested"}}); err != nil {
		t.Fatalf("GetPage durable ingest before restart: %v", err)
	}
	h.close()

	h = startKnowledgeGRPCHarness(t, cfg)
	defer h.close()
	if _, err := h.client.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err != nil {
		t.Fatalf("GetKnowledgeBank after restart: %v", err)
	}
	if _, err := h.client.GetPage(ctx, &runtimev1.GetPageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.GetPageRequest_Slug{Slug: "durable-root"}}); err != nil {
		t.Fatalf("GetPage after restart: %v", err)
	}
	backlinksResp, err := h.client.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{Context: reqCtx, BankId: bankID, ToPageId: childPage.GetPageId()})
	if err != nil {
		t.Fatalf("ListBacklinks after restart: %v", err)
	}
	if len(backlinksResp.GetBacklinks()) != 1 {
		t.Fatalf("ListBacklinks after restart count mismatch: got=%d want=1", len(backlinksResp.GetBacklinks()))
	}
	taskResp, err := h.client.GetIngestTask(ctx, &runtimev1.GetIngestTaskRequest{Context: reqCtx, TaskId: taskID})
	if err != nil {
		t.Fatalf("GetIngestTask after restart: %v", err)
	}
	if taskResp.GetTask().GetSlug() != "durable-ingested" {
		t.Fatalf("GetIngestTask after restart slug mismatch: got=%q", taskResp.GetTask().GetSlug())
	}
	keywordResp, err := h.client.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{Context: reqCtx, BankIds: []string{bankID}, Query: "durable", TopK: 10})
	if err != nil {
		t.Fatalf("SearchKeyword after restart: %v", err)
	}
	if len(keywordResp.GetHits()) == 0 {
		t.Fatal("SearchKeyword after restart returned no hits")
	}
}

func TestRuntimeKnowledgeGRPCE2EWorkspacePrivateDeny(t *testing.T) {
	h := startKnowledgeGRPCHarness(t, config.Config{LocalStatePath: filepath.Join(t.TempDir(), "local-state.json")})
	defer h.close()

	ctx := testKnowledgeGRPCContext("app.grpc")
	scope, err := h.svc.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws.grpc"},
		DisplayName: "Workspace gRPC Bank",
	})
	if err != nil {
		t.Fatalf("seed workspace bank: %v", err)
	}
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.grpc"}

	calls := []struct {
		name string
		fn   func() error
	}{
		{"ListKnowledgeBanks", func() error {
			_, err := h.client.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{
				Context:      reqCtx,
				ScopeFilters: []runtimev1.KnowledgeBankScope{runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE},
			})
			return err
		}},
		{"GetKnowledgeBank", func() error {
			_, err := h.client.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: scope.ScopeID})
			return err
		}},
		{"SearchKeyword", func() error {
			_, err := h.client.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{Context: reqCtx, BankIds: []string{scope.ScopeID}, Query: "q"})
			return err
		}},
		{"SearchHybrid", func() error {
			_, err := h.client.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{Context: reqCtx, BankId: scope.ScopeID, Query: "q"})
			return err
		}},
	}

	for _, call := range calls {
		err := call.fn()
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("%s: got=%v want PermissionDenied", call.name, err)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
			t.Fatalf("%s: reason mismatch got=%v ok=%v", call.name, reason, ok)
		}
		md, _ := grpcerr.ExtractReasonMetadata(err)
		if md["action_hint"] != "use_an_admitted_workspace_authorization_carrier" {
			t.Fatalf("%s: action_hint mismatch got=%q", call.name, md["action_hint"])
		}
	}
}

type knowledgeGRPCHarness struct {
	client   runtimev1.RuntimeCognitionServiceClient
	conn     *grpc.ClientConn
	listener *bufconn.Listener
	server   *grpc.Server
	svc      *Service
	memory   *memoryservice.Service
}

func startKnowledgeGRPCHarness(t *testing.T, cfg config.Config) *knowledgeGRPCHarness {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(testWriter{t: t}, nil))
	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		t.Fatalf("memoryservice.New: %v", err)
	}
	setMemoryEmbeddingVectorExecutorForTest(memorySvc)
	svc, err := New(logger, cfg, memorySvc, NewAccountKnowledgeAuthorizer(logger))
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("cognition.New: %v", err)
	}
	listener := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer(grpc.UnaryInterceptor(func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		meta, err := envelope.Validate(ctx, req, false)
		if err != nil {
			return nil, err
		}
		handlerCtx := envelope.WithMetadata(ctx, meta)
		handlerCtx = withTestKnowledgeAuthorization(handlerCtx, meta.AppID, "acct-e2e")
		return handler(handlerCtx, req)
	}))
	runtimev1.RegisterRuntimeCognitionServiceServer(server, svc)
	go func() {
		_ = server.Serve(listener)
	}()

	conn, err := grpc.DialContext(context.Background(), "bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		server.Stop()
		_ = svc.Close()
		_ = memorySvc.Close()
		t.Fatalf("grpc dial: %v", err)
	}
	return &knowledgeGRPCHarness{
		client:   runtimev1.NewRuntimeCognitionServiceClient(conn),
		conn:     conn,
		listener: listener,
		server:   server,
		svc:      svc,
		memory:   memorySvc,
	}
}

func (h *knowledgeGRPCHarness) close() {
	if h == nil {
		return
	}
	if h.conn != nil {
		_ = h.conn.Close()
	}
	if h.server != nil {
		h.server.Stop()
	}
	if h.listener != nil {
		_ = h.listener.Close()
	}
	if h.svc != nil {
		_ = h.svc.Close()
	}
	if h.memory != nil {
		_ = h.memory.Close()
	}
}

func putKnowledgePageGRPC(t *testing.T, client runtimev1.RuntimeCognitionServiceClient, reqCtx *runtimev1.KnowledgeRequestContext, bankID, slug, title, content string) *runtimev1.KnowledgePage {
	t.Helper()
	resp, err := client.PutPage(testKnowledgeGRPCContext(reqCtx.GetAppId()), &runtimev1.PutPageRequest{
		Context: reqCtx,
		BankId:  bankID,
		Slug:    slug,
		Title:   title,
		Content: content,
	})
	if err != nil {
		t.Fatalf("PutPage %q: %v", slug, err)
	}
	if resp.GetPage().GetPageId() == "" {
		t.Fatalf("PutPage %q returned empty page_id", slug)
	}
	return resp.GetPage()
}

func waitKnowledgeIngestCompletedGRPC(t *testing.T, client runtimev1.RuntimeCognitionServiceClient, reqCtx *runtimev1.KnowledgeRequestContext, taskID string) *runtimev1.GetIngestTaskResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var last *runtimev1.GetIngestTaskResponse
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.GetIngestTask(testKnowledgeGRPCContext(reqCtx.GetAppId()), &runtimev1.GetIngestTaskRequest{Context: reqCtx, TaskId: taskID})
		if err == nil {
			last = resp
			if resp.GetTask().GetStatus() == runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED {
				return resp
			}
		} else {
			lastErr = err
		}
		time.Sleep(10 * time.Millisecond)
	}
	if lastErr != nil {
		t.Fatalf("GetIngestTask did not complete: %v", lastErr)
	}
	t.Fatalf("GetIngestTask did not complete: last=%v", last.GetTask().GetStatus())
	return nil
}
