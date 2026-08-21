package localservice

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc/metadata"
)

func TestModelInstallPlanCannotCrossProtectedDesktopConnections(t *testing.T) {
	firstContext := modelInstallPlanProtectedContext(0x31)
	secondContext := modelInstallPlanProtectedContext(0x32)
	service := &Service{heldModelInstallPlans: make(map[string]heldModelInstallPlan)}
	plan := &runtimev1.LocalInstallPlanDescriptor{PlanId: "plan-protected-connection-owner"}
	service.holdModelInstallPlan(firstContext, plan)

	if _, err := service.takeModelInstallPlan(secondContext, plan.GetPlanId()); !errors.Is(err, errModelInstallPlanOwner) {
		t.Fatalf("second verified Desktop connection consumed first connection's plan: %v", err)
	}
	owned, err := service.takeModelInstallPlan(firstContext, plan.GetPlanId())
	if err != nil {
		t.Fatalf("owning verified Desktop connection could not consume its plan: %v", err)
	}
	if owned.GetPlanId() != plan.GetPlanId() {
		t.Fatalf("consumed plan id = %q, want %q", owned.GetPlanId(), plan.GetPlanId())
	}
}

func TestModelInstallPlanOwnerKeyKeepsUnprotectedContextFallback(t *testing.T) {
	ctx := authn.WithIdentity(context.Background(), &authn.Identity{
		SubjectUserID: "same-user",
		SessionID:     "same-account-session",
	})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-app-id", "desktop",
		"x-nimi-app-instance-id", "same-desktop-instance",
		"x-nimi-caller-id", "same-caller",
	))
	want := strings.Join([]string{
		"same-user",
		"same-account-session",
		"desktop",
		"same-desktop-instance",
		"same-caller",
	}, "\x00")
	if got := modelInstallPlanOwnerKey(ctx); got != want {
		t.Fatalf("unprotected identity and metadata owner key = %q, want %q", got, want)
	}
	if got := modelInstallPlanOwnerKey(context.Background()); got != "runtime-local-owner" {
		t.Fatalf("plain context owner key = %q, want runtime-local-owner", got)
	}
}

func TestHeldModelInstallPlanPreservesCatalogTotalSize(t *testing.T) {
	svc := newTestService(t)
	const totalSizeBytes int64 = 9_876_543_210
	const sourceProvenance = "upstream/model converted by exact-owner"
	svc.mu.Lock()
	svc.catalog = []*runtimev1.LocalCatalogModelDescriptor{{
		ItemId:           "catalog.total-size",
		Source:           "verified",
		TemplateId:       "local.total-size",
		ModelId:          "local/total-size",
		Repo:             "test/total-size",
		Revision:         "revision",
		Capabilities:     []string{"text.generate"},
		Entry:            "model.gguf",
		Files:            []string{"model.gguf"},
		Hashes:           map[string]string{"model.gguf": "sha256:" + strings.Repeat("a", 64)},
		TotalSizeBytes:   totalSizeBytes,
		SourceProvenance: sourceProvenance,
	}}
	svc.mu.Unlock()

	resolved, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		ItemId: "catalog.total-size",
	})
	if err != nil {
		t.Fatalf("resolve total-size plan: %v", err)
	}
	if got := resolved.GetPlan().GetTotalSizeBytes(); got != totalSizeBytes {
		t.Fatalf("resolved total size=%d, want %d", got, totalSizeBytes)
	}
	if got := resolved.GetPlan().GetSourceProvenance(); got != sourceProvenance {
		t.Fatalf("resolved source provenance=%q, want %q", got, sourceProvenance)
	}
	held, err := svc.takeModelInstallPlan(context.Background(), resolved.GetPlan().GetPlanId())
	if err != nil {
		t.Fatalf("take held total-size plan: %v", err)
	}
	if got := held.GetTotalSizeBytes(); got != totalSizeBytes {
		t.Fatalf("held total size=%d, want %d", got, totalSizeBytes)
	}
	if got := held.GetSourceProvenance(); got != sourceProvenance {
		t.Fatalf("held source provenance=%q, want %q", got, sourceProvenance)
	}
}

func modelInstallPlanProtectedContext(connectionByte byte) context.Context {
	ctx := authn.WithIdentity(context.Background(), &authn.Identity{
		SubjectUserID: "same-user",
		SessionID:     "same-account-session",
	})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-app-id", "desktop",
		"x-nimi-app-instance-id", "same-desktop-instance",
		"x-nimi-caller-id", "same-caller",
	))
	var ownerToken rpcctx.ProtectedConnectionOwnerToken
	for index := range ownerToken {
		ownerToken[index] = connectionByte
	}
	return rpcctx.WithProtectedConnectionOwnerToken(ctx, ownerToken)
}
