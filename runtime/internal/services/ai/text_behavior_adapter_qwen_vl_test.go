package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestQwenVLRegistrationIsExactAndLeavesBaseTextAlone(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "dashscope", DriverId: "nimillm", DriverDialect: "dashscope"}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "system", Content: "policy"}, {Role: "user", Content: "question"}, {Role: "system", Content: "later"}}}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "dashscope", "qwen3-vl-plus", mode, spec)
		if err != nil || adapter == nil {
			t.Fatalf("ordered text not admitted: %v", err)
		}
	}
	for _, model := range []string{"qwen3-vl-flash", "qwen3-vl-plus-2025-12-19"} {
		if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "dashscope", model, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, spec); textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unregistered target %s admitted", model)
		}
	}
	if _, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "dashscope", "qwen3-vl-plus", runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, spec); err == nil {
		t.Fatal("async widened")
	}
	plain := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "ordinary text"}}}
	if adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "dashscope", "qwen3-vl-plus", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, plain); err != nil || adapter != nil {
		t.Fatal("plain text stopped using its existing base path")
	}
}

func TestQwenVLScenarioMaterializesOwnedImageAndKeepsSystemOrder(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Model    string
			Messages []struct {
				Role    string
				Content json.RawMessage
			}
			Stream   bool
			Thinking bool `json:"enable_thinking"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.Model != "qwen3-vl-plus" || body.Thinking || len(body.Messages) != 4 || body.Messages[2].Role != "system" || string(body.Messages[2].Content) != `"later system"` {
			t.Errorf("request semantics changed: %+v", body)
		}
		if !strings.Contains(string(body.Messages[3].Content), `data:image/png;base64,`) || !strings.Contains(string(body.Messages[3].Content), `"text":"look"`) {
			t.Errorf("owned image missing: %s", body.Messages[3].Content)
		}
		if body.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"<message>blue</message>\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		} else {
			fmt.Fprint(w, `{"choices":[{"index":0,"message":{"content":"<message>blue</message>"},"finish_reason":"stop"}]}`)
		}
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-vl-plus", server.URL, Config{AllowLoopbackEndpoint: true})
	head := &runtimev1.ScenarioRequestHead{AppId: "app.qwen-vl", SubjectUserId: "user-001"}
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	f.service.scenarioJobs.create(&runtimev1.ScenarioJob{JobId: "owned-input", Head: head, Artifacts: []*runtimev1.ScenarioArtifact{{ArtifactId: "owned-image", MimeType: "image/png", Bytes: imageBytes.Bytes()}}}, func() {})
	f.service.scenarioJobs.create(&runtimev1.ScenarioJob{JobId: "foreign-input", Head: &runtimev1.ScenarioRequestHead{AppId: head.AppId, SubjectUserId: "other-user"}, Artifacts: []*runtimev1.ScenarioArtifact{{ArtifactId: "foreign-image", MimeType: "image/png", Bytes: imageBytes.Bytes()}}}, func() {})
	target, _ := structpb.NewStruct(map[string]any{"provider": "dashscope", "providerModelId": "qwen3-vl-plus", "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	ctx := executionintent.WithIntent(scenarioJobUserContext(head.AppId, head.SubjectUserId), executionintent.Intent{CapabilityContract: "text.generate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorRef: f.connectorID, CloudImplementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "dashscope", DriverId: "nimillm", DriverDialect: "dashscope"}, ProviderModelTarget: target})
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "system", Content: "policy"}, {Role: "assistant", Content: "old answer"}, {Role: "system", Content: "later system"}, {Role: "user", Content: "look", Parts: []*runtimev1.ChatContentPart{artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: "owned-image", MimeType: "image/png"})}}}}
	scenario := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: spec}}
	stream := &mockScenarioEventStream{ctx: ctx}
	if err := f.service.StreamScenario(&runtimev1.StreamScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, Spec: scenario}, stream); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) == 0 || stream.events[len(stream.events)-1].GetCompleted() == nil {
		t.Fatalf("stream did not complete: %v", stream.events)
	}
	spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
	if _, err := f.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: scenario}); err != nil {
		t.Fatal(err)
	}
	spec.Input[3].Parts[0] = artifactRefPart(&runtimev1.ChatContentArtifactRef{ArtifactId: "foreign-image", MimeType: "image/png"})
	_, err := f.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, Spec: scenario})
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_INPUT_INVALID || calls.Load() != 2 {
		t.Fatalf("foreign input dispatched: err=%v calls=%d", err, calls.Load())
	}
}
