package connector

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	store := newTestStore(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(logger, store, nil)
}

func newTestServiceWithModelCatalog(t *testing.T) *Service {
	t.Helper()
	svc := newTestService(t)
	resolver, err := aicatalog.NewResolver(aicatalog.ResolverConfig{
		CustomDir: filepath.Join(t.TempDir(), "provider-catalog"),
	})
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	svc.SetModelCatalogResolver(resolver)
	return svc
}

func userContext(userID string) context.Context {
	return authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: userID})
}
