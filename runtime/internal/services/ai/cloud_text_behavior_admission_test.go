package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestCloudTextBehaviorRequestsFailBeforeJobWithoutExactAdapter(t *testing.T) {
	for _, test := range []struct {
		name string
		mode runtimev1.ExecutionMode
		spec *runtimev1.TextGenerateScenarioSpec
	}{
		{
			name: "sync tool use", mode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			spec: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "use a tool"}},
				Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}},
			},
		},
		{
			name: "stream tool use", mode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
			spec: &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "stream a tool"}},
				Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup"}},
			},
		},
		{
			name: "sync structured output", mode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			spec: &runtimev1.TextGenerateScenarioSpec{
				Input:          []*runtimev1.ChatMessage{{Role: "user", Content: "return json"}},
				ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT},
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", "https://api.openai.com/v1", Config{
				CloudProviders: map[string]nimillm.ProviderCredentials{},
			})
			const appID = "app.cloud.behavior"
			ctx := withCloudScenarioTestIntent(scenarioJobUserContext(appID, "user-001"), "text.generate", fixture.targetRef)
			head := &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001"}
			scenarioSpec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: test.spec}}
			var err error
			if test.mode == runtimev1.ExecutionMode_EXECUTION_MODE_SYNC {
				_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
					Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
					ExecutionMode: test.mode, Spec: scenarioSpec,
				})
			} else {
				err = fixture.service.StreamScenario(&runtimev1.StreamScenarioRequest{
					Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
					ExecutionMode: test.mode, Spec: scenarioSpec,
				}, &mockScenarioEventStream{ctx: ctx})
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
				t.Fatalf("behavior admission error = %v reason=%v present=%v", err, reason, ok)
			}
			fixture.service.scenarioJobs.mu.RLock()
			jobCount := len(fixture.service.scenarioJobs.jobs)
			fixture.service.scenarioJobs.mu.RUnlock()
			if jobCount != 0 {
				t.Fatalf("unadmitted behavior published %d ScenarioJobs", jobCount)
			}
		})
	}
}
