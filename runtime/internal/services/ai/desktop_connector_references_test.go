package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"testing"
)

func referenceAccountContext(account string) context.Context {
	return protectedprincipal.With(context.Background(), protectedprincipal.NewDirectDesktopAccountProduct(&runtimev1.AccountProjection{AccountId: account, RealmEnvironmentId: "realm-test"}, 1, make(chan struct{}), make(chan struct{})))
}

func TestReferenceIndexDoesNotGrantConfigurationAccessAndInvalidatesChangedPages(t *testing.T) {
	store := aiconfig.NewMemoryStore()
	svc := &Service{aiConfigStore: store}
	for _, id := range []string{"not-projected.a", "not-projected.b"} {
		if _, _, ok, err := store.Overwrite(context.Background(), "account-a", "0", appAIConfig(id, cloudAIConfigIntent(t, "text.generate"))); err != nil || !ok {
			t.Fatalf("write: %v", err)
		}
	}
	request := &runtimev1.ListDesktopConnectorReferencesRequest{ConnectorRef: "connector:test", PageSize: 1}
	if _, err := svc.ListDesktopConnectorReferences(context.Background(), request); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("anonymous: %v", err)
	}
	wrong := protectedprincipal.With(context.Background(), protectedprincipal.NewDirect("another-app", "app-purpose", "ai.execute", &runtimev1.AccountProjection{AccountId: "account-a"}, 1, make(chan struct{}), make(chan struct{})))
	if _, err := svc.ListDesktopConnectorReferences(wrong, request); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("wrong purpose: %v", err)
	}
	ctx := referenceAccountContext("account-a")
	first, err := svc.ListDesktopConnectorReferences(ctx, request)
	if err != nil || len(first.GetReferences()) != 1 || first.GetNextPageToken() == "" {
		t.Fatalf("first page: %v %v", first, err)
	}
	if _, err := svc.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{Owner: appAIConfigOwner("not-projected.a")}); err == nil {
		t.Fatal("index visibility granted complete config access")
	}
	if _, _, ok, err := store.Overwrite(context.Background(), "account-a", "1", appAIConfig("not-projected.a")); err != nil || !ok {
		t.Fatal(err)
	}
	request.PageToken = first.NextPageToken
	if _, err := svc.ListDesktopConnectorReferences(ctx, request); status.Code(err) != codes.Aborted {
		t.Fatalf("mixed snapshots accepted: %v", err)
	}
	request.PageToken = ""
	other, err := svc.ListDesktopConnectorReferences(referenceAccountContext("account-b"), request)
	if err != nil || len(other.GetReferences()) != 0 {
		t.Fatalf("cross-account references: %v %v", other, err)
	}
}

type invalidatingConnectorReferenceStore struct {
	*aiconfig.MemoryStore
	invalidated chan struct{}
}

func (s *invalidatingConnectorReferenceStore) ConnectorReferences(ctx context.Context, account, connector string) (*aiconfig.ConnectorReferenceSnapshot, error) {
	snapshot, err := s.MemoryStore.ConnectorReferences(ctx, account, connector)
	close(s.invalidated)
	return snapshot, err
}

func TestReferenceIndexRejectsAccountInvalidatedDuringRead(t *testing.T) {
	invalidated := make(chan struct{})
	store := &invalidatingConnectorReferenceStore{MemoryStore: aiconfig.NewMemoryStore(), invalidated: invalidated}
	if _, _, ok, err := store.Overwrite(context.Background(), "account-a", "0", appAIConfig("app.a", cloudAIConfigIntent(t, "text.generate"))); err != nil || !ok {
		t.Fatalf("write: %v", err)
	}
	ctx := protectedprincipal.With(context.Background(), protectedprincipal.NewDirectDesktopAccountProduct(
		&runtimev1.AccountProjection{AccountId: "account-a", RealmEnvironmentId: "realm-test"}, 1, invalidated, make(chan struct{}),
	))
	svc := &Service{aiConfigStore: store}
	response, err := svc.ListDesktopConnectorReferences(ctx, &runtimev1.ListDesktopConnectorReferencesRequest{ConnectorRef: "connector:test", PageSize: 50})
	if ctx.Err() != nil {
		t.Fatal("test must retain an uncancelled context to exercise the invalidation race")
	}
	if status.Code(err) != codes.PermissionDenied || response != nil {
		t.Fatalf("invalidated account received references: response=%v err=%v", response, err)
	}
}
