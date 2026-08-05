package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestExecuteScenarioTextEmbedCloudTargetUsesResolvedBindingAndProviderPath(t *testing.T) {
	var providerModel string
	var capturedPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		if r.URL.Path != "/v1beta/openai/embeddings" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		if len(body.Input) != 2 {
			t.Fatalf("provider input length = %d, want 2", len(body.Input))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]},{"embedding":[0.4,0.5,0.6]}],"usage":{"prompt_tokens":6,"total_tokens":6}}`))
	}))
	defer func() { server.Close() }()

	endpoint := server.URL + "/v1beta/openai"
	fixture := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-embedding-001", endpoint, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: endpoint, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	})

	resp, err := fixture.service.ExecuteScenario(fixture.context, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			ModelId:       "gemini/gemini-embedding-001",
			TargetRef:     fixture.targetRef,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"alpha", "beta"}}},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario cloud text embed: %v; provider path=%q", err, capturedPath)
	}
	if providerModel != fixture.descriptor.GetProviderModelId() {
		t.Fatalf("provider request model = %q, want descriptor provider_model_id %q", providerModel, fixture.descriptor.GetProviderModelId())
	}
	if count := outputVectorCount(resp.GetOutput()); count != 2 {
		t.Fatalf("expected 2 vectors, got %d", count)
	}
	cloud := resp.GetResolvedExecutionBinding().GetCloud()
	if cloud == nil {
		t.Fatal("expected cloud resolved execution binding")
	}
	if cloud.GetRemoteModelCatalogId() != fixture.descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("remote_model_catalog_id = %q want %q", cloud.GetRemoteModelCatalogId(), fixture.descriptor.GetRemoteModelCatalogId())
	}
	if cloud.GetProviderModelId() != fixture.descriptor.GetProviderModelId() {
		t.Fatalf("provider_model_id = %q want %q", cloud.GetProviderModelId(), fixture.descriptor.GetProviderModelId())
	}
	if cloud.GetEndpointProfileId() != fixture.descriptor.GetEndpointProfileId() {
		t.Fatalf("endpoint_profile_id = %q want %q", cloud.GetEndpointProfileId(), fixture.descriptor.GetEndpointProfileId())
	}
}

func TestExecuteScenarioTextEmbedResolvedBindingUsesAdmittedRemoteTarget(t *testing.T) {
	var fixture managedCloudScenarioTestFixture
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/openai/embeddings" {
			http.NotFound(w, r)
			return
		}
		fixture.service.speechCatalog = nil
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":3,"total_tokens":3}}`))
	}))
	defer func() { server.Close() }()

	endpoint := server.URL + "/v1beta/openai"
	fixture = newManagedCloudScenarioTestFixture(t, "gemini", "gemini-embedding-001", endpoint, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"gemini": {BaseURL: endpoint, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	})

	resp, err := fixture.service.ExecuteScenario(fixture.context, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			ModelId:       "gemini-embedding-001",
			TargetRef:     fixture.targetRef,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"alpha"}}},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario should reuse admitted remote target binding: %v", err)
	}
	cloud := resp.GetResolvedExecutionBinding().GetCloud()
	if cloud == nil {
		t.Fatal("expected cloud resolved execution binding")
	}
	if cloud.GetProviderModelId() != fixture.descriptor.GetProviderModelId() {
		t.Fatalf("provider_model_id = %q want %q", cloud.GetProviderModelId(), fixture.descriptor.GetProviderModelId())
	}
	if cloud.GetEndpointProfileId() != fixture.descriptor.GetEndpointProfileId() {
		t.Fatalf("endpoint_profile_id = %q want %q", cloud.GetEndpointProfileId(), fixture.descriptor.GetEndpointProfileId())
	}
}

func TestListScenarioProfiles(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.ListScenarioProfiles(context.Background(), &runtimev1.ListScenarioProfilesRequest{})
	if err != nil {
		t.Fatalf("list scenario profiles: %v", err)
	}
	if len(resp.GetProfiles()) != 10 {
		t.Fatalf("expected 10 scenario profiles, got %d", len(resp.GetProfiles()))
	}
	var foundTextGenerate bool
	var foundWorldGenerate bool
	for _, profile := range resp.GetProfiles() {
		switch profile.GetScenarioType() {
		case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
			foundTextGenerate = true
			if len(profile.GetSupportedExecutionModes()) < 2 {
				t.Fatalf("text generate profile should expose sync+stream modes")
			}
		case runtimev1.ScenarioType_SCENARIO_TYPE_WORLD_GENERATE:
			foundWorldGenerate = true
			if got := profile.GetSupportedExecutionModes(); len(got) != 1 || got[0] != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
				t.Fatalf("world generate profile should expose async-job-only, got=%v", got)
			}
		}
	}
	if !foundTextGenerate {
		t.Fatalf("text generate profile not found")
	}
	if !foundWorldGenerate {
		t.Fatalf("world generate profile not found")
	}
}
