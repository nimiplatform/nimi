package ai

import (
	"net/http"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestCloudTextBehaviorRejectsRawChunksBeforeDispatch(t *testing.T) {
	for _, provider := range []string{"anthropic", "codex"} {
		t.Run(provider, func(t *testing.T) {
			var calls atomic.Int32
			handler := func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				http.Error(w, "unexpected raw chunk request", http.StatusBadRequest)
			}
			var fixture managedCloudScenarioTestFixture
			if provider == "anthropic" {
				fixture, _ = anthropicAppFixture(t, handler)
			} else {
				fixture, _ = codexAppFixture(t, "gpt-5.6-sol", handler)
			}
			app := "app." + provider
			ctx := scenarioJobUserContext(app, "user-001")
			head := &runtimev1.ScenarioRequestHead{AppId: app, SubjectUserId: "user-001", TimeoutMs: 10_000}
			spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
				Input:            []*runtimev1.ChatMessage{{Role: "user", Content: "respond"}},
				Tools:            []*runtimev1.ToolSpec{localAppLookupTool(t)},
				ToolChoice:       runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
				IncludeRawChunks: true,
			}}}
			for _, mode := range []string{"sync", "stream"} {
				t.Run(mode, func(t *testing.T) {
					var err error
					if mode == "sync" {
						_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
							Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
							ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: spec,
						})
					} else {
						err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
							Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, Spec: spec,
						}, &mockScenarioEventStream{ctx: ctx})
					}
					reason, _ := grpcerr.ExtractReasonCode(err)
					if reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED || calls.Load() != 0 {
						t.Fatalf("raw chunk request = %v, provider calls = %d", err, calls.Load())
					}
				})
			}
		})
	}
}
