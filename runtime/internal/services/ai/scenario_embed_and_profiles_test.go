package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestExecuteScenarioTextEmbedSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]},{"embedding":[0.4,0.5,0.6]}],"usage":{"prompt_tokens":6,"total_tokens":8}}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/embedding-model",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
		t.Fatalf("execute scenario text embed: %v", err)
	}
	if count := outputVectorCount(resp.GetOutput()); count != 2 {
		t.Fatalf("expected 2 vectors, got %d", count)
	}
	if resp.GetUsage().GetInputTokens() == 0 {
		t.Fatalf("usage input tokens should be set")
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
