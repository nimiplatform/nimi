package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestListTokenProviderModelsReturnsUnimplemented(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.ListTokenProviderModels(context.Background(), &runtimev1.ListTokenProviderModelsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ProviderId:    "nimillm",
	})
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("expected Unimplemented, got=%v", status.Code(err))
	}
}

func TestCheckTokenProviderHealthReturnsUnimplemented(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.CheckTokenProviderHealth(context.Background(), &runtimev1.CheckTokenProviderHealthRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ProviderId:    "nimillm",
	})
	if status.Code(err) != codes.Unimplemented {
		t.Fatalf("expected Unimplemented, got=%v", status.Code(err))
	}
}

func tokenProbeContext(apiKey string, endpoint string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		metadataKeySourceKey, keySourceInline,
		metadataProviderAPIKeyKey, apiKey,
		metadataProviderEndpointKey, endpoint,
	))
}
