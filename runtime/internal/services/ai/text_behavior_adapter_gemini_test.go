package ai

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGeminiNativeBasePreservesSystemThroughProtectedConversionAndCapture(t *testing.T) {
	const instruction = "The secret answer is SIGNAL-RIVER. Return only that answer."
	spec, err := localAppTextGenerateSpec(&runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{
		{Role: "system", Text: instruction}, {Role: "user", Text: "What is the secret answer?"},
	}})
	if err != nil || spec.GetSystemPrompt() != instruction || len(spec.Input) != 1 {
		t.Fatalf("protected conversion=%v err=%v", spec, err)
	}
	identity := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini"}
	config, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": "gemini-3.8-flash", "remoteModelCatalogId": "reviewed-target"})
	driver, target, err := capabilitydriver.NewProductionCloudTextRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "gemini", DriverID: "nimillm", DriverDialect: "gemini"}, config)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		adapter, err := resolveTextBehaviorAdapter(productionTextBehaviorAdapterRegistrations(), identity, "gemini", "gemini-3.8-flash", mode, spec)
		if err != nil {
			t.Fatal(err)
		}
		hooks, err := adapter.runtimeAdapter()
		if err != nil {
			t.Fatal(err)
		}
		mapped, err := driver.MapRequest(target, spec, nil, mode == runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, hooks)
		if err != nil {
			t.Fatal(err)
		}
		bound, err := bindCloudTextBehavior(mapped, adapter)
		if err != nil {
			t.Fatal(err)
		}
		_, serialized := bound.TextBehavior()
		var body struct {
			SystemInstruction struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"systemInstruction"`
			Contents []struct {
				Role string `json:"role"`
			} `json:"contents"`
		}
		if json.Unmarshal(serialized.Payload, &body) != nil || len(body.SystemInstruction.Parts) != 1 || body.SystemInstruction.Parts[0].Text != instruction || len(body.Contents) != 1 || body.Contents[0].Role != "user" {
			t.Fatalf("mode=%v lost or duplicated protected system: %s", mode, serialized.Payload)
		}
	}
}

func TestGemini38FlashBehaviorRegistrationIsExactAndNarrow(t *testing.T) {
	identity := &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini",
	}
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{
		"ok": map[string]any{"type": "boolean"}}, "required": []any{"ok"}, "additionalProperties": false})
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA,
			JsonSchema: schema, Strict: true},
	}
	registrations := productionTextBehaviorAdapterRegistrations()
	adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec)
	if err != nil || adapter == nil || adapter.registration.AdapterID != "gemini.38-flash.chat" || adapter.registration.Version != "3" {
		t.Fatalf("exact Gemini schema registration=%+v err=%v", adapter, err)
	}
	for _, target := range []string{"gemini-3.5-flash", "gemini-3.8-flash-lite"} {
		if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", target, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, spec); adapter != nil || textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("neighboring target %s inherited schema: %+v %v", target, adapter, err)
		}
	}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB} {
		if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", mode, spec); adapter != nil || textBehaviorReason(err) != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
			t.Fatalf("unverified mode %v admitted: %+v %v", mode, adapter, err)
		}
	}
	toolSpec := testTextBehaviorToolSpec()
	if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, toolSpec); adapter == nil || err != nil {
		t.Fatalf("exact synchronous tool cell absent: %+v %v", adapter, err)
	}
	plain := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Hello."}}}
	for _, mode := range []runtimev1.ExecutionMode{runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM} {
		if adapter, err := resolveTextBehaviorAdapter(registrations, identity, "gemini", "gemini-3.8-flash", mode, plain); adapter == nil || err != nil || adapter.registration.Version != "3" {
			t.Fatalf("native base mode missing: %+v %v", adapter, err)
		}
	}
}
