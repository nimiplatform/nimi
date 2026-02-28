package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestListTokenProviderModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4.1","display_name":"GPT 4.1"}]}`))
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.ListTokenProviderModels(tokenProbeContext("sk-test", server.URL), &runtimev1.ListTokenProviderModelsRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "nimillm",
		ProviderEndpoint: server.URL,
		TimeoutMs:        5_000,
	})
	if err != nil {
		t.Fatalf("list token provider models: %v", err)
	}
	if resp.GetProviderId() != "nimillm" {
		t.Fatalf("provider id mismatch: got=%q", resp.GetProviderId())
	}
	if resp.GetProviderEndpoint() != server.URL {
		t.Fatalf("provider endpoint mismatch: got=%q want=%q", resp.GetProviderEndpoint(), server.URL)
	}
	if len(resp.GetModels()) != 2 {
		t.Fatalf("models length mismatch: got=%d", len(resp.GetModels()))
	}
	if resp.GetModels()[1].GetModelLabel() != "GPT 4.1" {
		t.Fatalf("second model label mismatch: %q", resp.GetModels()[1].GetModelLabel())
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
}

func TestListTokenProviderModelsRejectsLegacyProviderID(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.ListTokenProviderModels(tokenProbeContext("sk-test", "https://example.invalid"), &runtimev1.ListTokenProviderModelsRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "litellm",
		ProviderEndpoint: "https://example.invalid",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v", status.Code(err))
	}
	if st, ok := status.FromError(err); !ok || st.Message() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String() {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestListTokenProviderModelsRejectsRuntimeConfigCredentialSource(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		metadataCredentialSourceKey, credentialSourceRuntimeConfig,
	))
	_, err := svc.ListTokenProviderModels(ctx, &runtimev1.ListTokenProviderModelsRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ProviderId:    "nimillm",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v", status.Code(err))
	}
	if st, ok := status.FromError(err); !ok || st.Message() != runtimev1.ReasonCode_AI_REQUEST_CREDENTIAL_REQUIRED.String() {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestCheckTokenProviderHealthMapsStatuses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"}]}`))
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	healthyResp, healthyErr := svc.CheckTokenProviderHealth(tokenProbeContext("sk-test", server.URL), &runtimev1.CheckTokenProviderHealthRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "nimillm",
		ProviderEndpoint: server.URL,
		ModelId:          "model-a",
	})
	if healthyErr != nil {
		t.Fatalf("check token provider health (healthy): %v", healthyErr)
	}
	if healthyResp.GetHealth().GetStatus() != runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY {
		t.Fatalf("expected HEALTHY, got=%s", healthyResp.GetHealth().GetStatus())
	}

	unsupportedResp, unsupportedErr := svc.CheckTokenProviderHealth(tokenProbeContext("sk-test", server.URL), &runtimev1.CheckTokenProviderHealthRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "nimillm",
		ProviderEndpoint: server.URL,
		ModelId:          "model-x",
	})
	if unsupportedErr != nil {
		t.Fatalf("check token provider health (unsupported): %v", unsupportedErr)
	}
	if unsupportedResp.GetHealth().GetStatus() != runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED {
		t.Fatalf("expected UNSUPPORTED, got=%s", unsupportedResp.GetHealth().GetStatus())
	}
}

func TestCheckTokenProviderHealthUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"unauthorized"}}`))
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.CheckTokenProviderHealth(tokenProbeContext("sk-test", server.URL), &runtimev1.CheckTokenProviderHealthRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "nimillm",
		ProviderEndpoint: server.URL,
	})
	if err != nil {
		t.Fatalf("check token provider health: %v", err)
	}
	if resp.GetHealth().GetStatus() != runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED {
		t.Fatalf("expected UNAUTHORIZED, got=%s", resp.GetHealth().GetStatus())
	}
}

func TestCheckTokenProviderHealthUnreachable(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.CheckTokenProviderHealth(tokenProbeContext("sk-test", "http://127.0.0.1:1"), &runtimev1.CheckTokenProviderHealthRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		ProviderId:       "nimillm",
		ProviderEndpoint: "http://127.0.0.1:1",
		TimeoutMs:        100,
	})
	if err != nil {
		t.Fatalf("check token provider health: %v", err)
	}
	if resp.GetHealth().GetStatus() != runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE {
		t.Fatalf("expected UNREACHABLE, got=%s", resp.GetHealth().GetStatus())
	}
}

func tokenProbeContext(apiKey string, endpoint string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		metadataCredentialSourceKey, credentialSourceRequestInjected,
		metadataProviderAPIKeyKey, apiKey,
		metadataProviderEndpointKey, endpoint,
	))
}
