package connector

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
)

type fakeLocalModelLister struct {
	models []*runtimev1.LocalAssetRecord
	err    error
}

func (f *fakeLocalModelLister) ListLocalAssets(_ context.Context, req *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	result := make([]*runtimev1.LocalAssetRecord, 0, len(f.models))
	for _, model := range f.models {
		if req.GetStatusFilter() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED &&
			model.GetStatus() != req.GetStatusFilter() {
			continue
		}
		result = append(result, model)
	}
	return &runtimev1.ListLocalAssetsResponse{Assets: result}, nil
}

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
