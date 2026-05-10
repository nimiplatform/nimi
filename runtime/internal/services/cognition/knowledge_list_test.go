package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// S2.6 — ListKnowledgeBanks returns banks the caller can read; banks
// the caller cannot read are excluded.
func TestListKnowledgeBanksAuthFilter(t *testing.T) {
	svc, _, cleanup := newTestService(t)
	defer cleanup()
	ctx := context.Background()

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
