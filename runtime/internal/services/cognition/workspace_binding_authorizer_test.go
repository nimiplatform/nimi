package cognition

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	workspaceAuthAppID       = "nimi.desktop"
	workspaceAuthAppInstance = "desktop-1"
	workspaceAuthDeviceID    = "device-1"
	workspaceAuthAccountID   = "acct-1"
	workspaceAuthWorkspaceID = "workspace-1"
)

type cognitionMemoryCustody struct {
	material accountservice.AccountMaterial
	has      bool
}

func (m *cognitionMemoryCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	if !m.has {
		return accountservice.AccountMaterial{}, accountservice.ErrNoStoredAccount
	}
	return m.material, nil
}

func (m *cognitionMemoryCustody) Store(_ context.Context, _ string, material accountservice.AccountMaterial) error {
	m.material = material
	m.has = true
	return nil
}

func (m *cognitionMemoryCustody) Clear(context.Context, string) error {
	m.material = accountservice.AccountMaterial{}
	m.has = false
	return nil
}

type cognitionStaticExchanger struct {
	material accountservice.AccountMaterial
}

func (s cognitionStaticExchanger) Exchange(context.Context, accountservice.LoginAttempt, string) (accountservice.AccountMaterial, error) {
	return s.material, nil
}

// AuthorizationURL satisfies accountservice.LoginAuthorizationURLProvider, which
// BeginLogin requires of its exchanger; without it BeginLogin fails closed into
// the login-exchange-unavailable response and returns an empty LoginAttemptId.
func (s cognitionStaticExchanger) AuthorizationURL(attempt accountservice.LoginAttempt) string {
	u := "https://realm.test/api/auth/oauth/authorize?response_type=code&client_id=nimi-desktop"
	u += "&redirect_uri=http%3A%2F%2Flocalhost%3A46373%2Fauth%2Fcallback"
	u += "&code_challenge=" + attempt.PKCEChallenge
	u += "&code_challenge_method=S256"
	u += "&state=" + attempt.State
	return u
}

func workspaceAuthCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         workspaceAuthAppID,
		AppInstanceId: workspaceAuthAppInstance,
		DeviceId:      workspaceAuthDeviceID,
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
}

func workspaceAuthDesktopAccountCaller() *runtimev1.AccountCaller {
	return &runtimev1.AccountCaller{
		AppId:         workspaceAuthAppID,
		AppInstanceId: workspaceAuthAppInstance,
		DeviceId:      workspaceAuthDeviceID,
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
	}
}

func workspaceAuthMaterial() accountservice.AccountMaterial {
	return accountservice.AccountMaterial{
		AccountID:          workspaceAuthAccountID,
		DisplayName:        "Workspace User",
		RealmEnvironmentID: "realm-local",
		WorkspaceMemberships: []*runtimev1.WorkspaceMembershipProjection{{
			WorkspaceId:        workspaceAuthWorkspaceID,
			MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
			RealmEnvironmentId: "realm-local",
			ObservedAt:         timestamppb.New(time.Now().UTC()),
			DisplayMetadata:    map[string]string{"name": "Workspace One"},
		}},
		AccessToken:        "access-1",
		AccessTokenExpires: time.Now().UTC().Add(5 * time.Minute),
		RefreshToken:       "refresh-1",
	}
}

func newWorkspaceAuthorizedCognitionService(t *testing.T, scopes ...string) (*Service, *runtimev1.WorkspaceBindingAttachment, context.Context, func()) {
	t.Helper()
	if len(scopes) == 0 {
		scopes = []string{"runtime.knowledge.admin"}
	}
	registry := appregistry.New()
	if err := registry.UpsertInstance(workspaceAuthAppID, workspaceAuthAppInstance, workspaceAuthDeviceID, nil); err != nil {
		t.Fatalf("register app instance: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	accountSvc := accountservice.New(logger,
		accountservice.WithNonProductionHarnessMode(),
		accountservice.WithCustody(&cognitionMemoryCustody{}),
		accountservice.WithLoginExchanger(cognitionStaticExchanger{material: workspaceAuthMaterial()}),
		accountservice.WithAppRegistry(registry),
	)
	begin, err := accountSvc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: workspaceAuthDesktopAccountCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	complete, err := accountSvc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         workspaceAuthDesktopAccountCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil || !complete.GetAccepted() {
		t.Fatalf("CompleteLogin: resp=%+v err=%v", complete, err)
	}
	issued, err := accountSvc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
		Caller:      workspaceAuthCaller(),
		WorkspaceId: workspaceAuthWorkspaceID,
		Scopes:      scopes,
		TtlSeconds:  600,
	})
	if err != nil || !issued.GetAccepted() {
		t.Fatalf("IssueWorkspaceBinding: resp=%+v err=%v", issued, err)
	}

	root := t.TempDir()
	cfg := config.Config{LocalStatePath: filepath.Join(root, "local-state.json")}
	memorySvc, err := memoryservice.New(logger, cfg)
	if err != nil {
		t.Fatalf("memoryservice.New: %v", err)
	}
	setMemoryEmbeddingVectorExecutorForTest(memorySvc)
	svc, err := New(logger, cfg, memorySvc, NewAccountKnowledgeAuthorizer(logger, accountSvc))
	if err != nil {
		_ = memorySvc.Close()
		t.Fatalf("cognition.New: %v", err)
	}
	ctx := envelope.WithMetadata(context.Background(), envelope.Metadata{
		AppID:         workspaceAuthAppID,
		AppInstanceID: workspaceAuthAppInstance,
	})
	ctx = withTestKnowledgeAuthorization(ctx, workspaceAuthAppID, workspaceAuthAccountID)
	cleanup := func() {
		_ = svc.Close()
		_ = memorySvc.Close()
	}
	return svc, issued.GetAttachment(), ctx, cleanup
}

func workspaceReqCtx(attachment *runtimev1.WorkspaceBindingAttachment) *runtimev1.KnowledgeRequestContext {
	return &runtimev1.KnowledgeRequestContext{
		AppId:            workspaceAuthAppID,
		SubjectUserId:    workspaceAuthAccountID,
		WorkspaceBinding: attachment,
	}
}

func TestWorkspacePrivateAllowsOnlyThroughResolver(t *testing.T) {
	svc, attachment, ctx, cleanup := newWorkspaceAuthorizedCognitionService(t, "runtime.knowledge.admin")
	defer cleanup()
	reqCtx := workspaceReqCtx(attachment)

	createResp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: reqCtx,
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: workspaceAuthWorkspaceID},
			},
		},
		DisplayName: "Workspace Bank",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBank: %v", err)
	}
	bankID := createResp.GetBank().GetBankId()

	first, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{Context: reqCtx, BankId: bankID, Slug: "from", Title: "From", Content: "workspace bridge body"})
	if err != nil {
		t.Fatalf("PutPage first: %v", err)
	}
	second, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{Context: reqCtx, BankId: bankID, Slug: "to", Title: "To", Content: "workspace graph body"})
	if err != nil {
		t.Fatalf("PutPage second: %v", err)
	}
	if _, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err != nil {
		t.Fatalf("GetKnowledgeBank: %v", err)
	}
	listResp, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{
		Context:     reqCtx,
		ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
		OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{
			Owner: &runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: workspaceAuthWorkspaceID},
			},
		},
	})
	if err != nil || len(listResp.GetBanks()) != 1 {
		t.Fatalf("ListKnowledgeBanks: resp=%+v err=%v", listResp, err)
	}
	if _, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.GetPageRequest_Slug{Slug: "from"}}); err != nil {
		t.Fatalf("GetPage: %v", err)
	}
	if pages, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{Context: reqCtx, BankId: bankID}); err != nil || len(pages.GetPages()) != 2 {
		t.Fatalf("ListPages: pages=%+v err=%v", pages, err)
	}
	if hits, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{Context: reqCtx, BankIds: []string{bankID}, Query: "workspace"}); err != nil || len(hits.GetHits()) == 0 {
		t.Fatalf("SearchKeyword: hits=%+v err=%v", hits, err)
	}
	if hybrid, err := svc.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{Context: reqCtx, BankId: bankID, Query: "workspace"}); err != nil || len(hybrid.GetHits()) == 0 {
		t.Fatalf("SearchHybrid: hits=%+v err=%v", hybrid, err)
	}
	addResp, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{Context: reqCtx, BankId: bankID, FromPageId: first.GetPage().GetPageId(), ToPageId: second.GetPage().GetPageId(), LinkType: "extends"})
	if err != nil {
		t.Fatalf("AddLink: %v", err)
	}
	if links, err := svc.ListLinks(ctx, &runtimev1.ListLinksRequest{Context: reqCtx, BankId: bankID, FromPageId: first.GetPage().GetPageId()}); err != nil || len(links.GetLinks()) != 1 {
		t.Fatalf("ListLinks: links=%+v err=%v", links, err)
	}
	if backlinks, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{Context: reqCtx, BankId: bankID, ToPageId: second.GetPage().GetPageId()}); err != nil || len(backlinks.GetBacklinks()) != 1 {
		t.Fatalf("ListBacklinks: backlinks=%+v err=%v", backlinks, err)
	}
	if graph, err := svc.TraverseGraph(ctx, &runtimev1.TraverseGraphRequest{Context: reqCtx, BankId: bankID, RootPageId: first.GetPage().GetPageId(), MaxDepth: 1}); err != nil || len(graph.GetNodes()) == 0 {
		t.Fatalf("TraverseGraph: graph=%+v err=%v", graph, err)
	}
	if _, err := svc.RemoveLink(ctx, &runtimev1.RemoveLinkRequest{Context: reqCtx, BankId: bankID, LinkId: addResp.GetLink().GetLinkId()}); err != nil {
		t.Fatalf("RemoveLink: %v", err)
	}
	ingest, err := svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{Context: reqCtx, BankId: bankID, Slug: "ingest", Content: "workspace ingest"})
	if err != nil {
		t.Fatalf("IngestDocument: %v", err)
	}
	if _, err := svc.GetIngestTask(ctx, &runtimev1.GetIngestTaskRequest{Context: reqCtx, TaskId: ingest.GetTaskId()}); err != nil {
		t.Fatalf("GetIngestTask: %v", err)
	}
	waitWorkspaceIngestTaskTerminal(t, svc, ctx, reqCtx, ingest.GetTaskId())
	if _, err := svc.DeletePage(ctx, &runtimev1.DeletePageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.DeletePageRequest_PageId{PageId: second.GetPage().GetPageId()}}); err != nil {
		t.Fatalf("DeletePage: %v", err)
	}
	if _, err := svc.DeleteKnowledgeBank(ctx, &runtimev1.DeleteKnowledgeBankRequest{Context: reqCtx, BankId: bankID}); err != nil {
		t.Fatalf("DeleteKnowledgeBank: %v", err)
	}
}

func waitWorkspaceIngestTaskTerminal(t *testing.T, svc *Service, ctx context.Context, reqCtx *runtimev1.KnowledgeRequestContext, taskID string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		resp, err := svc.GetIngestTask(ctx, &runtimev1.GetIngestTaskRequest{Context: reqCtx, TaskId: taskID})
		if err != nil {
			t.Fatalf("GetIngestTask terminal poll: %v", err)
		}
		switch resp.GetTask().GetStatus() {
		case runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED,
			runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_FAILED:
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("ingest task did not reach terminal status: %+v", resp.GetTask())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestWorkspacePrivateRejectsBodyOrAttachmentIdentityProof(t *testing.T) {
	svc, attachment, ctx, cleanup := newWorkspaceAuthorizedCognitionService(t, "runtime.knowledge.read")
	defer cleanup()
	scope, err := svc.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, cognitionScopeDescriptor(workspaceAuthWorkspaceID))
	if err != nil {
		t.Fatalf("seed workspace bank: %v", err)
	}

	noInstanceCtx := envelope.WithMetadata(context.Background(), envelope.Metadata{AppID: workspaceAuthAppID})
	noInstanceCtx = withTestKnowledgeAuthorization(noInstanceCtx, workspaceAuthAppID, workspaceAuthAccountID)
	_, err = svc.GetKnowledgeBank(noInstanceCtx, &runtimev1.GetKnowledgeBankRequest{Context: workspaceReqCtx(attachment), BankId: scope.ScopeID})
	assertWorkspaceDeniedReason(t, err, runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH)

	forgedAttachment := cloneWorkspaceBindingAttachmentForCognition(attachment)
	forgedAttachment.RuntimeAppId = "forged.attachment.app"
	_, err = svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: workspaceReqCtx(forgedAttachment), BankId: scope.ScopeID})
	assertWorkspaceDeniedReason(t, err, runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY)

	mismatchAttachment := cloneWorkspaceBindingAttachmentForCognition(attachment)
	mismatchAttachment.WorkspaceId = "workspace-other"
	_, err = svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: workspaceReqCtx(mismatchAttachment), BankId: scope.ScopeID})
	assertWorkspaceDeniedReason(t, err, runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY)
}

func TestWorkspacePrivateListDoesNotEnumerateWithoutBinding(t *testing.T) {
	svc, _, ctx, cleanup := newWorkspaceAuthorizedCognitionService(t, "runtime.knowledge.read")
	defer cleanup()
	if _, err := svc.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, cognitionScopeDescriptor(workspaceAuthWorkspaceID)); err != nil {
		t.Fatalf("seed workspace bank: %v", err)
	}
	resp, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: &runtimev1.KnowledgeRequestContext{AppId: workspaceAuthAppID}})
	if err != nil {
		t.Fatalf("ListKnowledgeBanks default: %v", err)
	}
	if len(resp.GetBanks()) != 0 {
		t.Fatalf("default list must not enumerate workspace banks without binding: %+v", resp)
	}
}

func TestWorkspacePrivateRejectsMissingScope(t *testing.T) {
	svc, attachment, ctx, cleanup := newWorkspaceAuthorizedCognitionService(t, "runtime.knowledge.read")
	defer cleanup()
	_, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: workspaceReqCtx(attachment),
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: workspaceAuthWorkspaceID},
			},
		},
		DisplayName: "Workspace Bank",
	})
	assertWorkspaceDeniedReason(t, err, runtimev1.ReasonCode_WORKSPACE_BINDING_SCOPE_MISSING)
}

func cognitionScopeDescriptor(workspaceID string) cognitionpkg.KnowledgeScopeDescriptor {
	return cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace, WorkspaceID: workspaceID},
		DisplayName: "Workspace Bank",
	}
}

func cloneWorkspaceBindingAttachmentForCognition(in *runtimev1.WorkspaceBindingAttachment) *runtimev1.WorkspaceBindingAttachment {
	return &runtimev1.WorkspaceBindingAttachment{
		BindingId:          in.GetBindingId(),
		BindingHandle:      in.GetBindingHandle(),
		RuntimeAppId:       in.GetRuntimeAppId(),
		AppInstanceId:      in.GetAppInstanceId(),
		WorkspaceId:        in.GetWorkspaceId(),
		RealmEnvironmentId: in.GetRealmEnvironmentId(),
	}
}

func assertWorkspaceDeniedReason(t *testing.T, err error, reason runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected workspace deny reason %s, got nil", reason)
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	actual, ok := grpcerr.ExtractReasonCode(err)
	if !ok || actual != reason {
		t.Fatalf("expected reason %s, got %s ok=%v err=%v", reason, actual, ok, err)
	}
}
