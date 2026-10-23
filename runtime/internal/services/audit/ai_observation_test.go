package audit

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aitelemetry"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func homeAIContext(account string) context.Context {
	principal := protectedprincipal.NewDirectDesktopAccountProduct(&runtimev1.AccountProjection{AccountId: account, RealmEnvironmentId: "realm-test"}, 1, make(chan struct{}), make(chan struct{}))
	return protectedprincipal.With(context.Background(), principal)
}

func homeAIService(t *testing.T) (*Service, *aitelemetry.Store) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	backend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner := aitelemetry.Open(backend, logger)
	t.Cleanup(func() { _ = owner.Close(); _ = backend.Close() })
	service := New(health.NewState(), logger)
	service.SetAIObservationStore(owner)
	return service, owner
}

func TestDesktopAIReadsRejectEveryNonAccountPurpose(t *testing.T) {
	service, _ := homeAIService(t)
	wrong := protectedprincipal.NewDirect("unrelated-app", "app-purpose", "ai.execute", &runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-test"}, 1, make(chan struct{}), make(chan struct{}))
	contexts := map[string]context.Context{
		"anonymous":               context.Background(),
		"public subject":          authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "account-a"}),
		"forged metadata":         metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-protected-first-party-profile", "desktop_account_product_v1", "x-nimi-subject-user-id", "account-a")),
		"wrong protected purpose": protectedprincipal.With(context.Background(), wrong),
	}
	for name, ctx := range contexts {
		t.Run(name, func(t *testing.T) {
			if _, err := service.GetDesktopAIActivitySnapshot(ctx, &runtimev1.GetDesktopAIActivitySnapshotRequest{}); status.Code(err) != codes.PermissionDenied && status.Code(err) != codes.Unauthenticated {
				t.Fatalf("activity accepted unrelated purpose: %v", err)
			}
			if _, err := service.GetDesktopAIUsageSummary(ctx, &runtimev1.GetDesktopAIUsageSummaryRequest{}); status.Code(err) != codes.PermissionDenied && status.Code(err) != codes.Unauthenticated {
				t.Fatalf("usage accepted unrelated purpose: %v", err)
			}
		})
	}
}

func TestDesktopAIReadUsesPrincipalScopeAndBounds(t *testing.T) {
	service, owner := homeAIService(t)
	for _, account := range []string{"account-a", "account-b"} {
		owner.Begin(aitelemetry.Facts{AccountID: account, OperationID: account, Source: aitelemetry.Source{Kind: "app", ID: account, ParentID: account, ParentKind: "scenario-job"}, Capability: "text.generate", Models: []*runtimev1.DesktopAIExecutionModel{{ModelId: account}}, Route: runtimev1.DesktopAIExecutionRoute_DESKTOP_AI_EXECUTION_ROUTE_LOCAL})
	}
	ctx := homeAIContext("account-a")
	response, err := service.GetDesktopAIActivitySnapshot(ctx, &runtimev1.GetDesktopAIActivitySnapshotRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Snapshot.Executions) != 1 || response.Snapshot.Executions[0].Models[0].ModelId != "account-a" {
		t.Fatalf("cross-account activity: %+v", response)
	}
	if _, err := service.GetDesktopAIActivitySnapshot(ctx, &runtimev1.GetDesktopAIActivitySnapshotRequest{Limit: 101}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("oversized activity request: %v", err)
	}
	now := time.Now().UTC()
	if err := owner.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	usage, err := service.GetDesktopAIUsageSummary(ctx, &runtimev1.GetDesktopAIUsageSummaryRequest{FromTime: timestamppb.New(now.Add(-time.Hour)), ToTime: timestamppb.New(now.Add(time.Hour))})
	if err != nil {
		t.Fatal(err)
	}
	if usage.Summary.Totals.AttemptCount != 1 {
		t.Fatalf("cross-account usage: %+v", usage)
	}
	if _, err := service.GetDesktopAIUsageSummary(ctx, &runtimev1.GetDesktopAIUsageSummaryRequest{FromTime: timestamppb.New(now.Add(-8 * 24 * time.Hour)), ToTime: timestamppb.New(now)}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("oversized range accepted: %v", err)
	}
}

func TestDesktopAIReadRejectsInvalidatedAccount(t *testing.T) {
	service, _ := homeAIService(t)
	invalidated := make(chan struct{})
	principal := protectedprincipal.NewDirectDesktopAccountProduct(&runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-test"}, 1, invalidated, make(chan struct{}))
	ctx := protectedprincipal.With(context.Background(), principal)
	close(invalidated)
	if _, err := service.GetDesktopAIActivitySnapshot(ctx, &runtimev1.GetDesktopAIActivitySnapshotRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("stale principal accepted: %v", err)
	}
}
