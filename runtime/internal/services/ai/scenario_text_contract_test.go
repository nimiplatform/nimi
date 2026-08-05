package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestExecuteScenarioTextGenerateCloudAliasUsesAPIModelID(t *testing.T) {
	var providerModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seed-2.0-pro", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	})

	resp, err := fixture.service.ExecuteScenario(fixture.context, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			ModelId:       "doubao-seed-2.0-pro",
			TargetRef: cloudScenarioTargetRef(
				fixture.connectorID,
				fixture.descriptor.GetRemoteModelCatalogId(),
				"doubao-seed-2.0-pro",
				fixture.descriptor.GetProvider(),
			),
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:   30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario with cloud alias: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected cloud alias output: %q", text)
	}
	if providerModel != "doubao-seed-2-0-pro-260215" {
		t.Fatalf("provider request model = %q, want canonical API model id", providerModel)
	}
	if resp.GetResolvedExecutionBinding().GetCloud().GetProviderModelId() != "doubao-seed-2-0-pro-260215" {
		t.Fatalf("resolved binding provider_model_id = %q want canonical API model id", resp.GetResolvedExecutionBinding().GetCloud().GetProviderModelId())
	}
}
