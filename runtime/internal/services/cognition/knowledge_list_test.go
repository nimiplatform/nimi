package cognition

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// S2.6 — ListKnowledgeBanks returns banks the caller can read; banks
// the caller cannot read are excluded.
func TestListKnowledgeBanksAuthFilter(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.s2-6")

	for _, name := range []string{"Bank A", "Bank B", "Bank C"} {
		newAppPrivateBank(t, svc, "app.s2-6", name)
	}
	// Seed an unrelated app's bank.
	newAppPrivateBank(t, svc, "app.other", "Other Bank")

	resp, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.s2-6"},
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(resp.GetBanks()) != 3 {
		t.Fatalf("expected 3 banks for app.s2-6, got %d", len(resp.GetBanks()))
	}
	for _, bank := range resp.GetBanks() {
		if got := bank.GetLocator().GetAppPrivate().GetAppId(); got != "app.s2-6" {
			t.Fatalf("expected only app.s2-6 banks, got owner %q", got)
		}
	}
}

func TestListKnowledgeBanksPaginationIsBoundedOpaqueAndStable(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	const appID = "app.pagination"
	ctx := testKnowledgeEnvelopeContext(appID)
	requestContext := &runtimev1.KnowledgeRequestContext{AppId: appID}
	for index := 0; index < 101; index++ {
		newAppPrivateBank(t, svc, appID, fmt.Sprintf("Bank %03d", index))
	}

	defaultPage, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: requestContext})
	if err != nil {
		t.Fatalf("default page: %v", err)
	}
	if len(defaultPage.GetBanks()) != 50 || defaultPage.GetNextPageToken() == "" {
		t.Fatalf("default page = %d token=%q, want 50 and continuation", len(defaultPage.GetBanks()), defaultPage.GetNextPageToken())
	}
	if _, err := strconv.Atoi(defaultPage.GetNextPageToken()); err == nil {
		t.Fatalf("public page token exposed a raw decimal offset: %q", defaultPage.GetNextPageToken())
	}

	maxPage, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: 100})
	if err != nil {
		t.Fatalf("maximum page: %v", err)
	}
	if len(maxPage.GetBanks()) != 100 || maxPage.GetNextPageToken() == "" {
		t.Fatalf("maximum page = %d token=%q, want 100 and continuation", len(maxPage.GetBanks()), maxPage.GetNextPageToken())
	}

	var ids []string
	token := ""
	for {
		page, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{
			Context: requestContext, PageSize: 17, PageToken: token,
		})
		if err != nil {
			t.Fatalf("stable page: %v", err)
		}
		for _, bank := range page.GetBanks() {
			ids = append(ids, bank.GetBankId())
		}
		token = page.GetNextPageToken()
		if token == "" {
			break
		}
	}
	if len(ids) != 101 || !sort.StringsAreSorted(ids) {
		t.Fatalf("stable pages returned %d ids in non-scope_id order", len(ids))
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			t.Fatalf("duplicate bank %q across pages", id)
		}
		seen[id] = struct{}{}
	}
}

func TestListKnowledgeBanksRejectsInvalidPagination(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	const appID = "app.pagination-invalid"
	ctx := testKnowledgeEnvelopeContext(appID)
	requestContext := &runtimev1.KnowledgeRequestContext{AppId: appID}
	for index := 0; index < 2; index++ {
		newAppPrivateBank(t, svc, appID, fmt.Sprintf("Bank %d", index))
	}
	first, err := svc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: 1})
	if err != nil || first.GetNextPageToken() == "" {
		t.Fatalf("first page: resp=%+v err=%v", first, err)
	}

	tests := []struct {
		name       string
		ctx        context.Context
		request    *runtimev1.ListKnowledgeBanksRequest
		wantReason runtimev1.ReasonCode
	}{
		{name: "negative page size", ctx: ctx, request: &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: -1}, wantReason: runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID},
		{name: "oversized page size", ctx: ctx, request: &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: 101}, wantReason: runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID},
		{name: "raw decimal token", ctx: ctx, request: &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: 1, PageToken: "1"}, wantReason: runtimev1.ReasonCode_PAGE_TOKEN_INVALID},
		{name: "malformed token", ctx: ctx, request: &runtimev1.ListKnowledgeBanksRequest{Context: requestContext, PageSize: 1, PageToken: "not-a-page-token"}, wantReason: runtimev1.ReasonCode_PAGE_TOKEN_INVALID},
		{
			name: "token bound to another exact owner",
			ctx:  testKnowledgeEnvelopeContext("app.pagination-other"),
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context:   &runtimev1.KnowledgeRequestContext{AppId: "app.pagination-other"},
				PageSize:  1,
				PageToken: first.GetNextPageToken(),
			},
			wantReason: runtimev1.ReasonCode_PAGE_TOKEN_INVALID,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.ListKnowledgeBanks(test.ctx, test.request)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("error = %v, want InvalidArgument", err)
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != test.wantReason {
				t.Fatalf("reason = %v, %t, want %v", reason, ok, test.wantReason)
			}
		})
	}
}

func TestListKnowledgeBanksRejectsIncompleteOrMismatchedSingularOwner(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := testKnowledgeEnvelopeContext("app.singular")
	requestContext := &runtimev1.KnowledgeRequestContext{AppId: "app.singular"}

	tests := []struct {
		name    string
		request *runtimev1.ListKnowledgeBanksRequest
	}{
		{
			name: "app scope without owner",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context: requestContext, ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
			},
		},
		{
			name: "workspace scope without owner",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context: requestContext, ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
			},
		},
		{
			name: "app owner without scope",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context: requestContext,
				OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{Owner: &runtimev1.KnowledgeBankOwnerFilter_AppPrivate{
					AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.singular"},
				}},
			},
		},
		{
			name: "workspace owner without scope",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context: requestContext,
				OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{Owner: &runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate{
					WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: "workspace-1"},
				}},
			},
		},
		{
			name: "workspace owner with app scope",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context:     requestContext,
				ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
				OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{Owner: &runtimev1.KnowledgeBankOwnerFilter_WorkspacePrivate{
					WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: "workspace-1"},
				}},
			},
		},
		{
			name: "different app owner",
			request: &runtimev1.ListKnowledgeBanksRequest{
				Context:     requestContext,
				ScopeFilter: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
				OwnerFilter: &runtimev1.KnowledgeBankOwnerFilter{Owner: &runtimev1.KnowledgeBankOwnerFilter_AppPrivate{
					AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.other"},
				}},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := svc.ListKnowledgeBanks(ctx, test.request)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("ListKnowledgeBanks error = %v, want InvalidArgument", err)
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID {
				t.Fatalf("ListKnowledgeBanks reason = %v, %t", reason, ok)
			}
		})
	}
}
