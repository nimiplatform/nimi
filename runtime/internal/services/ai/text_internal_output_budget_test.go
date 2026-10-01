package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

// A Runtime-owned output budget reaches a target whose protocol carries an
// output limit as that limit, and a caller max_tokens still wins over it.
// @nimi-authority: rule.nimi.runtime.ai-provider.internal-output-budget
func TestCloudTextSendsRuntimeOutputBudgetOnlyWhereTheTargetTakesALimit(t *testing.T) {
	var mu sync.Mutex
	var sent []*int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MaxTokens *int32 `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode provider request: %v", err)
		}
		mu.Lock()
		sent = append(sent, body.MaxTokens)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seed-2-0-pro-260215", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	})
	execute := func(ctx context.Context, caller *int32) {
		t.Helper()
		_, err := fixture.service.ExecuteScenario(withCloudScenarioTestIntent(ctx, "text.generate", fixture.targetRef), &runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "acme.widget", SubjectUserId: "user-001", TimeoutMs: 30_000},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello runtime"}}, MaxTokens: caller,
			}}},
		})
		if err != nil {
			t.Fatalf("execute text: %v", err)
		}
	}
	budgeted := textbehavior.WithInternalOutputBudget(fixture.context, 4096)
	execute(budgeted, nil)
	execute(budgeted, proto.Int32(300))
	execute(fixture.context, nil)
	mu.Lock()
	defer mu.Unlock()
	if len(sent) != 3 || sent[0] == nil || *sent[0] != 4096 || sent[1] == nil || *sent[1] != 300 || sent[2] != nil {
		t.Fatalf("provider max_tokens = %v, want 4096, 300, none", sent)
	}
}
