package capabilitydriver

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGemma4BehaviorSerializerMapsToolsRoundTripStructuredAndReasoning(t *testing.T) {
	tool := gemma4ToolForTest(t, "weather")
	toolResult := structpb.NewStringValue("sunny")
	spec := &runtimev1.TextGenerateScenarioSpec{
		SystemPrompt: "Use tools precisely.",
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "Weather in Paris?"},
			{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "weather", ArgumentsJson: `{"city":"Paris"}`}}}}}}},
			{Role: "tool", TurnItems: []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "weather", Result: toolResult}}}}},
		},
		Tools: []*runtimev1.ToolSpec{tool}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
	}
	serialized, err := Gemma4TextBehaviorRequestSerializer(spec, true)
	if err != nil {
		t.Fatalf("serialize tools round-trip: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if serialized.ContentType != "application/json" || body["tool_choice"] != "required" || body["stream"] != true {
		t.Fatalf("serialized tool request = %#v", body)
	}
	messages, _ := body["messages"].([]any)
	if len(messages) != 4 {
		t.Fatalf("serialized messages = %#v", messages)
	}
	assistant, _ := messages[2].(map[string]any)
	toolMessage, _ := messages[3].(map[string]any)
	if len(assistant["tool_calls"].([]any)) != 1 || toolMessage["tool_call_id"] != "call-1" || toolMessage["content"] != `"sunny"` {
		t.Fatalf("serialized round-trip messages = %#v / %#v", assistant, toolMessage)
	}

	reasoning := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Solve it."}},
		Reasoning: &runtimev1.ReasoningConfig{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 32},
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
	}
	serialized, err = Gemma4TextBehaviorRequestSerializer(reasoning, false)
	if err != nil {
		t.Fatalf("serialize reasoning: %v", err)
	}
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	if body["thinking_budget_tokens"] != float64(32) || body["reasoning_format"] != "deepseek" {
		t.Fatalf("serialized reasoning request = %#v", body)
	}
}

func TestGemma4BehaviorSerializerLowersNamedChoiceToOneRequiredTool(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Use lookup."}},
		Tools: []*runtimev1.ToolSpec{
			gemma4ToolForTest(t, "weather"),
			gemma4ToolForTest(t, "lookup"),
		},
		ToolChoice:     runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL,
		ToolChoiceName: "lookup",
	}
	serialized, err := Gemma4TextBehaviorRequestSerializer(spec, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(serialized.Payload, &body); err != nil {
		t.Fatal(err)
	}
	tools, _ := body["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("named tool choice tools = %#v", tools)
	}
	tool, _ := tools[0].(map[string]any)
	function, _ := tool["function"].(map[string]any)
	if body["tool_choice"] != "required" || function["name"] != "lookup" {
		t.Fatalf("named tool choice mapping = %#v", body)
	}
}

func TestGemma4BehaviorParsersNormalizeParallelCallsAndHiddenReasoning(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input:      []*runtimev1.ChatMessage{{Role: "user", Content: "Compare weather."}},
		Tools:      []*runtimev1.ToolSpec{gemma4ToolForTest(t, "weather")},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
	}
	payload, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{
			"finish_reason": "tool_calls",
			"message": map[string]any{"content": nil, "tool_calls": []any{
				map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "weather", "arguments": `{"city":"Paris"}`}},
				map[string]any{"id": "call-2", "type": "function", "function": map[string]any{"name": "weather", "arguments": `{"city":"Berlin"}`}},
			}},
		}},
		"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 8},
	})
	result, err := Gemma4TextBehaviorNonStreamParser(payload, spec)
	if err != nil || len(result.Items) != 2 || result.Items[0].ToolCall.GetId() != "call-1" || result.Items[1].ToolCall.GetId() != "call-2" ||
		result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("parallel non-stream result = %+v err=%v", result, err)
	}

	reasoningSpec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Answer."}},
		Reasoning: &runtimev1.ReasoningConfig{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 16},
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
	}
	payload, _ = json.Marshal(map[string]any{"choices": []any{map[string]any{
		"finish_reason": "stop", "message": map[string]any{"reasoning_content": "private", "content": "public"},
	}}})
	result, err = Gemma4TextBehaviorNonStreamParser(payload, reasoningSpec)
	if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemText || result.Items[0].Text != "public" {
		t.Fatalf("hidden reasoning result = %+v err=%v", result, err)
	}
}

func TestGemma4BehaviorStreamKeepsParallelFragmentsPrivateUntilComplete(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input:      []*runtimev1.ChatMessage{{Role: "user", Content: "Compare weather."}},
		Tools:      []*runtimev1.ToolSpec{gemma4ToolForTest(t, "weather")},
		ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED,
	}
	assembler, err := Gemma4TextBehaviorStreamAssembler(spec)
	if err != nil {
		t.Fatal(err)
	}
	first := gemma4ChunkForTest(t, map[string]any{"tool_calls": []any{
		map[string]any{"index": 0, "id": "call-1", "type": "function", "function": map[string]any{"name": "weather", "arguments": `{"city":"Pa`}},
		map[string]any{"index": 1, "id": "call-2", "type": "function", "function": map[string]any{"name": "weather", "arguments": `{"city":"Ber`}},
	}}, nil)
	deltas, err := assembler.Append(first)
	if err != nil {
		t.Fatal(err)
	}
	for _, delta := range deltas {
		if delta.HasPublicPayload() {
			t.Fatalf("private tool fragment leaked: %+v", delta)
		}
	}
	second := gemma4ChunkForTest(t, map[string]any{"tool_calls": []any{
		map[string]any{"index": 0, "function": map[string]any{"arguments": `ris"}`}},
		map[string]any{"index": 1, "function": map[string]any{"arguments": `lin"}`}},
	}}, nil)
	if _, err := assembler.Append(second); err != nil {
		t.Fatal(err)
	}
	final := gemma4ChunkForTest(t, map[string]any{}, "tool_calls")
	deltas, err = assembler.Append(final)
	if err != nil || len(deltas) != 2 || deltas[0].ToolCall.GetId() != "call-1" || deltas[1].ToolCall.GetId() != "call-2" {
		t.Fatalf("completed stream deltas = %+v err=%v", deltas, err)
	}
	result, err := assembler.Finish()
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("stream result = %+v err=%v", result, err)
	}
}

func TestGemma4BehaviorStreamAcceptsHiddenReasoningThenUsageTail(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "What is 8 times 8?"}},
		Reasoning: &runtimev1.ReasoningConfig{
			Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
			Intensity:    &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 32},
			Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN,
		},
	}
	assembler, err := Gemma4TextBehaviorStreamAssembler(spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, reasoning := range []string{"We need answer.", " Eight times eight is sixty-four."} {
		deltas, appendErr := assembler.Append(gemma4ChunkForTest(t, map[string]any{"reasoning_content": reasoning}, nil))
		if appendErr != nil || len(deltas) != 0 {
			t.Fatalf("hidden reasoning chunk deltas=%+v err=%v", deltas, appendErr)
		}
	}
	for _, content := range []string{"6", "4"} {
		if _, err := assembler.Append(gemma4ChunkForTest(t, map[string]any{"content": content}, nil)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := assembler.Append(gemma4ChunkForTest(t, map[string]any{}, "stop")); err != nil {
		t.Fatal(err)
	}
	usageTail, err := json.Marshal(map[string]any{
		"choices": []any{},
		"usage":   map[string]any{"prompt_tokens": 31, "completion_tokens": 18, "total_tokens": 49},
	})
	if err != nil {
		t.Fatal(err)
	}
	if deltas, err := assembler.Append(usageTail); err != nil || len(deltas) != 0 {
		t.Fatalf("usage tail deltas=%+v err=%v", deltas, err)
	}
	result, err := assembler.Finish()
	if err != nil || len(result.Items) != 1 || result.Items[0].Kind != textbehavior.OrderedItemText || result.Items[0].Text != "64" ||
		result.Usage.GetInputTokens() != 31 || result.Usage.GetOutputTokens() != 18 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("hidden reasoning stream result=%+v err=%v", result, err)
	}
}

func TestGemma4StructuredOutputValidatesCapturedSchema(t *testing.T) {
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}},
		"required": []any{"city"}, "additionalProperties": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input:          []*runtimev1.ChatMessage{{Role: "user", Content: "Return a city."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, SchemaName: "city", Strict: true},
	}
	valid := gemma4CompletionForTest(t, `{"city":"Paris"}`, "stop")
	result, err := Gemma4TextBehaviorNonStreamParser(valid, spec)
	if err != nil || len(result.Items) != 1 {
		t.Fatalf("valid schema result = %+v err=%v", result, err)
	}
	invalid := gemma4CompletionForTest(t, `{"city":7}`, "stop")
	if _, err := Gemma4TextBehaviorNonStreamParser(invalid, spec); textBehaviorReasonForDriverTest(err) != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("invalid schema output error = %v", err)
	}
	remote, _ := structpb.NewStruct(map[string]any{"$ref": "https://example.invalid/schema.json"})
	spec.ResponseFormat.JsonSchema = remote
	if _, err := Gemma4TextBehaviorRequestSerializer(spec, false); err == nil {
		t.Fatal("remote schema reference was accepted")
	}
}

func TestGemma4ReasoningChangesLlamaProcessIdentityAndHidesRawOnlyExhaustion(t *testing.T) {
	templateIdentity := "sha256:" + strings.Repeat("c", 64)
	main := InvocationExactBinding{
		RequirementID: MainGGUFRequirementID, ModelAssetID: "main", AbsolutePath: filepath.Join(t.TempDir(), "main.gguf"),
		VerifiedContentID: "sha256:" + strings.Repeat("a", 64), EntrySHA256: strings.Repeat("b", 64), TemplateIdentity: templateIdentity,
	}
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{
		AdapterID: "gemma4", Version: "1", RequestSerializerID: "request/v1", NonStreamParserID: "sync/v1", StreamAssemblerID: "stream/v1",
		RequiredTemplateIdentity: templateIdentity, ProcessIdentityImpact: textbehavior.ProcessIdentityAdapterAndTemplate,
	}, Gemma4TextBehaviorRequestSerializer, Gemma4TextBehaviorNonStreamParser, Gemma4TextBehaviorStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	planFor := func(spec *runtimev1.TextGenerateScenarioSpec) *TextInvocationPlan {
		plan, err := (LlamaTextDriver{}).PlanTextInvocation(TextInvocationInput{
			ModelContextWindowTokens: 32768, ExactBindings: []InvocationExactBinding{main},
			BehaviorMatch: llamaBehaviorMatchFactsForTest(main), BehaviorAdapter: adapter, Request: spec,
		})
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	toolPlan := planFor(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "tool"}}, Tools: []*runtimev1.ToolSpec{gemma4ToolForTest(t, "weather")}})
	reasoningSpec := &runtimev1.TextGenerateScenarioSpec{
		Input:     []*runtimev1.ChatMessage{{Role: "user", Content: "reason"}},
		Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_ExactBudgetTokens{ExactBudgetTokens: 8}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN},
	}
	reasoningPlan := planFor(reasoningSpec)
	if strings.Contains(strings.Join(toolPlan.ProcessArgs(), " "), "--reasoning on") || !strings.Contains(strings.Join(reasoningPlan.ProcessArgs(), " "), "--reasoning on --reasoning-format deepseek") || toolPlan.ProcessKey() == reasoningPlan.ProcessKey() {
		t.Fatalf("process args/identity tool=%q reasoning=%q", toolPlan.ProcessArgs(), reasoningPlan.ProcessArgs())
	}
	invocation, err := adapter.Bind(reasoningSpec)
	if err != nil {
		t.Fatal(err)
	}
	rawOnly := gemma4CompletionForTestWithReasoning(t, "", "private", "length")
	if _, err := invocation.ParseNonStream(rawOnly); textBehaviorReasonForDriverTest(err) != runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE {
		t.Fatalf("raw-only exhausted reasoning error = %v", err)
	}
}

func gemma4ToolForTest(t *testing.T, name string) *runtimev1.ToolSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}},
		"required": []any{"city"}, "additionalProperties": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.ToolSpec{Name: name, Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, InputSchema: schema}
}

func gemma4ChunkForTest(t *testing.T, delta map[string]any, finish any) []byte {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": delta, "finish_reason": finish}}})
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func gemma4CompletionForTest(t *testing.T, content, finish string) []byte {
	return gemma4CompletionForTestWithReasoning(t, content, "", finish)
}

func gemma4CompletionForTestWithReasoning(t *testing.T, content, reasoning, finish string) []byte {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"choices": []any{map[string]any{"finish_reason": finish, "message": map[string]any{"content": content, "reasoning_content": reasoning}}}})
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func textBehaviorReasonForDriverTest(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
