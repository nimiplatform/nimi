package cognition

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// S2.1 — CreateKnowledgeBank for app_private succeeds and registers a
// typed scope. Verified by GetKnowledgeBank round-trip.
func TestCreateKnowledgeBankAppPrivateRegistersTypedScope(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := testKnowledgeEnvelopeContext("app.s2-1")
	resp, err := svc.CreateKnowledgeBank(ctx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.s2-1"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.s2-1"},
			},
		},
		DisplayName: "S2.1 Bank",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if resp.GetBank().GetBankId() == "" {
		t.Fatalf("expected non-empty bank_id")
	}
	if got := resp.GetBank().GetLocator().GetAppPrivate().GetAppId(); got != "app.s2-1" {
		t.Fatalf("expected locator app_id app.s2-1, got %q", got)
	}

	getResp, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.s2-1"},
		BankId:  resp.GetBank().GetBankId(),
	})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if getResp.GetBank().GetDisplayName() != "S2.1 Bank" {
		t.Fatalf("expected display_name preserved, got %q", getResp.GetBank().GetDisplayName())
	}
}

// CreateKnowledgeBank duplicate yields KNOWLEDGE_BANK_ALREADY_EXISTS.
func TestCreateKnowledgeBankDuplicateReasonCode(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := testKnowledgeEnvelopeContext("app.s2-2")
	first := &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.s2-2"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.s2-2"},
			},
		},
		DisplayName: "Duplicate Bank",
	}
	if _, err := svc.CreateKnowledgeBank(ctx, first); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := svc.CreateKnowledgeBank(ctx, first); err == nil {
		t.Fatalf("expected duplicate to fail")
	} else {
		if status.Code(err) != codes.AlreadyExists {
			t.Fatalf("expected AlreadyExists, got %v", err)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS {
			t.Fatalf("expected KNOWLEDGE_BANK_ALREADY_EXISTS, got reason=%v ok=%v", reason, ok)
		}
	}
}

// GetKnowledgeBank for a missing bank surfaces KNOWLEDGE_BANK_NOT_FOUND.
func TestGetKnowledgeBankMissingReasonCode(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ctx := testKnowledgeEnvelopeContext("app.s2-2-miss")
	_, err := svc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.s2-2-miss"},
		BankId:  "nonexistent01JXYZ12345678901234567",
	})
	if err == nil {
		t.Fatalf("expected error for missing bank")
	}
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND {
		t.Fatalf("expected KNOWLEDGE_BANK_NOT_FOUND, got reason=%v ok=%v", reason, ok)
	}
}

// S2.5 — GetKnowledgeBank from a different caller's app_id yields
// KNOWLEDGE_BANK_ACCESS_DENIED.
func TestGetKnowledgeBankCrossAppDenied(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ownerCtx := testKnowledgeEnvelopeContext("app.owner")
	resp, err := svc.CreateKnowledgeBank(ownerCtx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.owner"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.owner"},
			},
		},
		DisplayName: "Owner Bank",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	intruderCtx := testKnowledgeEnvelopeContext("app.intruder")
	_, err = svc.GetKnowledgeBank(intruderCtx, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.intruder"},
		BankId:  resp.GetBank().GetBankId(),
	})
	if err == nil {
		t.Fatalf("expected cross-app deny")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
		t.Fatalf("expected KNOWLEDGE_BANK_ACCESS_DENIED, got reason=%v ok=%v", reason, ok)
	}
}

func TestGetKnowledgeBankIgnoresForgedRequestContextAppID(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()

	ownerCtx := testKnowledgeEnvelopeContext("app.owner")
	resp, err := svc.CreateKnowledgeBank(ownerCtx, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.owner"},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "app.owner"},
			},
		},
		DisplayName: "Owner Bank",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	intruderCtx := testKnowledgeEnvelopeContext("app.intruder")
	_, err = svc.GetKnowledgeBank(intruderCtx, &runtimev1.GetKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "app.owner"},
		BankId:  resp.GetBank().GetBankId(),
	})
	if err == nil {
		t.Fatalf("expected forged request context app_id to be denied")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected PermissionDenied, got %v", err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED {
		t.Fatalf("expected KNOWLEDGE_BANK_ACCESS_DENIED, got reason=%v ok=%v", reason, ok)
	}
}
