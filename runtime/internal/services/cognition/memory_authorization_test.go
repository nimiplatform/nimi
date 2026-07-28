package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestRuntimeCognitionMemoryRequiresAuthenticatedAppOwner(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	create := func(ctx context.Context, locator *runtimev1.PublicMemoryBankLocator) error {
		_, err := svc.CreateBank(ctx, &runtimev1.CreateBankRequest{
			Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
			Locator: locator,
		})
		return err
	}
	assertDenied := func(name string, err error) {
		t.Helper()
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("%s: expected PermissionDenied, got %v", name, err)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
			t.Fatalf("%s: deny reason = %v, present=%v", name, reason, ok)
		}
	}

	ownLocator := &runtimev1.PublicMemoryBankLocator{
		Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
			AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app-test"},
		},
	}
	assertDenied("missing authenticated session", create(context.Background(), ownLocator))

	ctx := testKnowledgeEnvelopeContext("app-test")
	forgedLocator := &runtimev1.PublicMemoryBankLocator{
		Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
			AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-2", AppId: "app-test"},
		},
	}
	assertDenied("forged account owner", create(ctx, forgedLocator))

	workspaceLocator := &runtimev1.PublicMemoryBankLocator{
		Locator: &runtimev1.PublicMemoryBankLocator_WorkspacePrivate{
			WorkspacePrivate: &runtimev1.WorkspacePrivateBankOwner{
				AccountId:   "acct-1",
				WorkspaceId: "workspace-1",
			},
		},
	}
	assertDenied("workspace private public access", create(ctx, workspaceLocator))
}

func TestRuntimeCognitionMemoryListIsNarrowedToSessionOwner(t *testing.T) {
	svc, memorySvc, cleanup := newTestService(t)
	defer cleanup()

	seed := func(accountID string, appID string) {
		t.Helper()
		if _, err := memorySvc.CreateBank(context.Background(), &runtimev1.CreateBankRequest{
			Locator: &runtimev1.PublicMemoryBankLocator{
				Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
					AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: accountID, AppId: appID},
				},
			},
		}); err != nil {
			t.Fatalf("seed %s/%s: %v", accountID, appID, err)
		}
	}
	seed("acct-1", "app-test")
	seed("acct-1", "app-other")
	seed("acct-2", "app-test")

	resp, err := svc.ListBanks(testKnowledgeEnvelopeContext("app-test"), &runtimev1.ListBanksRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
	})
	if err != nil {
		t.Fatalf("ListBanks: %v", err)
	}
	if len(resp.GetBanks()) != 1 {
		t.Fatalf("ListBanks returned %d banks, want only the authenticated app owner", len(resp.GetBanks()))
	}
	owner := resp.GetBanks()[0].GetLocator().GetAppPrivate()
	if owner.GetAccountId() != "acct-1" || owner.GetAppId() != "app-test" {
		t.Fatalf("ListBanks returned foreign owner: account=%q app=%q", owner.GetAccountId(), owner.GetAppId())
	}

	_, err = svc.ListBanks(testKnowledgeEnvelopeContext("app-test"), &runtimev1.ListBanksRequest{
		Context: &runtimev1.MemoryRequestContext{AppId: "app-test"},
		OwnerFilters: []*runtimev1.MemoryBankOwnerFilter{{
			Owner: &runtimev1.MemoryBankOwnerFilter_AppPrivate{
				AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app-other"},
			},
		}},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign owner filter: expected PermissionDenied, got %v", err)
	}
}
