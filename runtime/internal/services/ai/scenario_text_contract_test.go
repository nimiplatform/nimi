package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestExecuteScenarioTextGenerateUsesExactPrivateProviderModelID(t *testing.T) {
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
	ctx := withCloudScenarioTestIntent(fixture.context, "text.generate", fixture.targetRef)
	resp, err := fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{
			TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello runtime"}},
			},
		}},
	})
	if err != nil {
		t.Fatalf("execute scenario with exact cloud target: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected cloud output: %q", text)
	}
	wantModel := fixture.descriptor.GetProviderModelId()
	if providerModel != wantModel || resp.GetModelResolved() != wantModel {
		t.Fatalf("exact provider model mismatch: request=%q response=%q want=%q", providerModel, resp.GetModelResolved(), wantModel)
	}
	if field := resp.ProtoReflect().Descriptor().Fields().ByName("resolved_execution_binding"); field != nil {
		t.Fatalf("public response still declares resolved_execution_binding: %v", field)
	}
}
