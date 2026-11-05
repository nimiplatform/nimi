package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestHaiku55PublicAppAdmitsForcedToolsWithAdaptiveEffort(t *testing.T) {
	calls := 0
	fixture, decision := anthropicAdaptiveAppFixture(t, "claude-haiku-5-5", func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["model"] != "claude-haiku-5-5" || body["tool_choice"].(map[string]any)["type"] != "any" || body["output_config"].(map[string]any)["effort"] != "low" {
			t.Errorf("wire = %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"content":[{"type":"tool_use","id":"call-haiku","name":"lookup","input":{"query":"one"}}],"stop_reason":"tool_use","usage":{"input_tokens":4,"output_tokens":8}}`)
	})
	result, err := fixture.service.ExecuteLocalAppScenario(decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Use lookup."}}, Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
		Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}},
	}}})
	if err != nil || calls != 1 || len(result.GetTextGenerate().GetItems()) != 1 || result.GetTextGenerate().GetItems()[0].GetToolCall().GetId() != "call-haiku" {
		t.Fatalf("public forced call = %+v %v, calls %d", result, err, calls)
	}
}
