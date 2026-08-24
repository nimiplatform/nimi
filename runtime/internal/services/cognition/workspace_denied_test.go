package cognition

import (
	"testing"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// S2.3 — Every WORKSPACE_PRIVATE knowledge RPC returns
// KNOWLEDGE_BANK_ACCESS_DENIED with action_hint
// use_an_admitted_workspace_authorization_carrier. Seeded via the
// typed registry directly (bypassing the authorizer) so the deny
// surfaces from the cognition facade, not from create_bank.
func TestWorkspacePrivateRPCsAlwaysDenied(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := testKnowledgeEnvelopeContext("app.s2-3")
	scope, err := svc.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       cognitionpkg.KnowledgeScopeOwner{Kind: cognitionpkg.KnowledgeScopeOwnerKindWorkspace, WorkspaceID: "ws.s2-3"},
		DisplayName: "WS Bank",
	})
	if err != nil {
		t.Fatalf("seed workspace bank: %v", err)
	}
	bankID := scope.ScopeID
	reqCtx := &runtimev1.KnowledgeRequestContext{AppId: "app.s2-3"}

	type rpcCall struct {
		name string
		fn   func() error
	}
	calls := []rpcCall{
		{"CreateKnowledgeBank", func() error {
			_, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
				Context: reqCtx,
				Locator: &runtimev1.PublicKnowledgeBankLocator{
					Locator: &runtimev1.PublicKnowledgeBankLocator_WorkspacePrivate{
						WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: "ws.s2-3-create"},
					},
				},
				DisplayName: "Workspace Create Attempt",
			})
			return err
		}},
		{"GetKnowledgeBank", func() error {
			_, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{Context: reqCtx, BankId: bankID})
			return err
		}},
		{"ListKnowledgeBanksByWorkspaceScope", func() error {
			_, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{
				Context:     reqCtx,
				ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
				OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{Owner: &runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate{
					WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: "ws.s2-3"},
				}},
			})
			return err
		}},
		{"DeleteKnowledgeBank", func() error {
			_, err := svc.DeleteKnowledgeBank(ctx, &runtimev1.DeleteKnowledgeBankRequest{Context: reqCtx, BankId: bankID})
			return err
		}},
		{"PutPage", func() error {
			_, err := svc.PutPage(ctx, &runtimev1.PutPageRequest{Context: reqCtx, BankId: bankID, Slug: "p", Title: "P", Content: "x"})
			return err
		}},
		{"GetPage", func() error {
			_, err := svc.GetPage(ctx, &runtimev1.GetPageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.GetPageRequest_Slug{Slug: "p"}})
			return err
		}},
		{"ListPages", func() error {
			_, err := svc.ListPages(ctx, &runtimev1.ListPagesRequest{Context: reqCtx, BankId: bankID})
			return err
		}},
		{"DeletePage", func() error {
			_, err := svc.DeletePage(ctx, &runtimev1.DeletePageRequest{Context: reqCtx, BankId: bankID, Lookup: &runtimev1.DeletePageRequest_Slug{Slug: "p"}})
			return err
		}},
		{"SearchHybrid", func() error {
			_, err := svc.SearchHybrid(ctx, &runtimev1.SearchHybridRequest{Context: reqCtx, BankId: bankID, Query: "q"})
			return err
		}},
		{"SearchKeyword", func() error {
			_, err := svc.SearchKeyword(ctx, &runtimev1.SearchKeywordRequest{Context: reqCtx, BankIds: []string{bankID}, Query: "q"})
			return err
		}},
		{"AddLink", func() error {
			_, err := svc.AddLink(ctx, &runtimev1.AddLinkRequest{Context: reqCtx, BankId: bankID, FromPageId: "a", ToPageId: "b", LinkType: "rel"})
			return err
		}},
		{"RemoveLink", func() error {
			_, err := svc.RemoveLink(ctx, &runtimev1.RemoveLinkRequest{Context: reqCtx, BankId: bankID, LinkId: "x"})
			return err
		}},
		{"ListLinks", func() error {
			_, err := svc.ListLinks(ctx, &runtimev1.ListLinksRequest{Context: reqCtx, BankId: bankID, FromPageId: "a"})
			return err
		}},
		{"ListBacklinks", func() error {
			_, err := svc.ListBacklinks(ctx, &runtimev1.ListBacklinksRequest{Context: reqCtx, BankId: bankID, ToPageId: "b"})
			return err
		}},
		{"TraverseGraph", func() error {
			_, err := svc.TraverseGraph(ctx, &runtimev1.TraverseGraphRequest{Context: reqCtx, BankId: bankID, RootPageId: "a", MaxDepth: 1})
			return err
		}},
		{"IngestDocument", func() error {
			_, err := svc.IngestDocument(ctx, &runtimev1.IngestDocumentRequest{Context: reqCtx, BankId: bankID, Slug: "p", Content: "x"})
			return err
		}},
	}

	for _, call := range calls {
		err := call.fn()
		if err == nil {
			t.Fatalf("%s: expected workspace deny, got nil", call.name)
		}
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("%s: expected PermissionDenied, got %v", call.name, err)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
			t.Fatalf("%s: expected KNOWLEDGE_BANK_ACCESS_DENIED, got reason=%v ok=%v", call.name, reason, ok)
		}
		md, _ := grpcerr.ExtractReasonMetadata(err)
		if md["action_hint"] != "use_an_admitted_workspace_authorization_carrier" {
			t.Fatalf("%s: expected workspace action_hint, got %q", call.name, md["action_hint"])
		}
	}
}
