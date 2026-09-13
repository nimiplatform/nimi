package ai

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func localAppLookupTool(t *testing.T) *runtimev1.ToolSpec {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{
		"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}},
		"required": []any{"query"}, "additionalProperties": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.ToolSpec{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}
}

func localAppLookupCall() *runtimev1.ToolCall {
	return &runtimev1.ToolCall{Id: "lookup-1", Name: "lookup", ArgumentsJson: `{"query":"runtime tools"}`}
}

func TestLocalAppTextBehaviorAcceptsOrderedToolTranscript(t *testing.T) {
	value, _ := structpb.NewValue(map[string]any{"sources": []any{"result"}})
	request := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{
			{Role: "system", Text: "Return a sourced answer."},
			{Role: "user", Text: "Research runtime tools."},
			{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: localAppLookupCall()}}}},
				{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "lookup-1", ToolName: "lookup", Result: value}}},
			}},
		},
		Tools: []*runtimev1.ToolSpec{localAppLookupTool(t)}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE,
	}
	spec, err := localAppTextGenerateSpec(request)
	if err != nil {
		t.Fatal(err)
	}
	if spec.GetSystemPrompt() != request.Messages[0].Text || len(spec.GetInput()) != 2 || len(spec.GetInput()[1].GetTurnItems()) != 2 {
		t.Fatalf("ordered transcript was lost: %v", spec)
	}
	if spec.GetTools()[0] == request.GetTools()[0] {
		t.Fatal("request tool was not captured")
	}
	request.Messages[2].TurnItems[1].GetToolResult().ToolCallId = "unknown"
	_, err = localAppTextGenerateSpec(request)
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}

func TestLocalAppTextBehaviorRejectsPrivilegedOrInvalidValues(t *testing.T) {
	base := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "lookup"}},
		Tools:    []*runtimev1.ToolSpec{localAppLookupTool(t)},
	}
	for name, mutate := range map[string]func(*runtimev1.StreamLocalAppTextTurnRequest){
		"provider tool": func(r *runtimev1.StreamLocalAppTextTurnRequest) {
			r.Tools[0].Kind = runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER
		},
		"provider metadata": func(r *runtimev1.StreamLocalAppTextTurnRequest) { r.Tools[0].ProviderMetadata = &structpb.Struct{} },
		"too much input": func(r *runtimev1.StreamLocalAppTextTurnRequest) {
			r.Messages[0].Text = strings.Repeat("x", maxLocalAppTextRequestBytes+1)
		},
		"too many messages": func(r *runtimev1.StreamLocalAppTextTurnRequest) {
			for len(r.Messages) <= maxLocalAppTextMessages {
				r.Messages = append(r.Messages, r.Messages[0])
			}
		},
		"mixed transcript": func(r *runtimev1.StreamLocalAppTextTurnRequest) {
			r.Messages[0].TurnItems = []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: "other"}}}}}}
		},
	} {
		t.Run(name, func(t *testing.T) {
			request := proto.Clone(base).(*runtimev1.StreamLocalAppTextTurnRequest)
			mutate(request)
			_, err := localAppTextGenerateSpec(request)
			assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		})
	}
}

func TestLocalAppTextBehaviorPreservesResponseSchemaAndNarrowCandidate(t *testing.T) {
	schema, _ := structpb.NewStruct(map[string]any{"type": "object"})
	request := &runtimev1.StreamLocalAppTextTurnRequest{
		Messages:       []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Return JSON."}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema, Strict: true},
	}
	spec, err := localAppTextGenerateSpec(request)
	if err != nil || !proto.Equal(spec.GetResponseFormat(), request.GetResponseFormat()) {
		t.Fatalf("schema: %v %v", spec, err)
	}
	candidate := validLocalAppTextCandidateRequest()
	candidate.Messages[0].TurnItems = []*runtimev1.TextTurnItem{{}}
	_, _, err = validateLocalAppTextCandidateRequest(candidate)
	if err == nil {
		t.Fatal("narrow candidate admitted ordered items")
	}
}

func TestLocalAppTextBehaviorStreamPreservesMixedItemOrder(t *testing.T) {
	sink := &mockLocalAppTextTurnStream{ctx: context.Background()}
	bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: sink, tools: map[string]*runtimev1.ToolSpec{"lookup": localAppLookupTool(t)}}
	for _, payload := range []*runtimev1.ScenarioStreamDelta{
		textOutputDelta(0, "Searching.", true),
		toolCallOutputDelta(1, localAppLookupCall()),
		textOutputDelta(2, "Checking sources.", true),
	} {
		if err := bridge.Send(&runtimev1.StreamScenarioEvent{TraceId: "trace-tools", Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: payload}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := bridge.Send(&runtimev1.StreamScenarioEvent{TraceId: "trace-tools", Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{FinishReason: runtimev1.FinishReason_FINISH_REASON_TOOL_CALL}}}); err != nil {
		t.Fatal(err)
	}
	if len(sink.events) != 4 || sink.events[1].GetToolCall().GetItemIndex() != 1 || sink.events[2].GetDelta().GetItemIndex() != 2 || sink.events[3].GetCompleted() == nil {
		t.Fatalf("mixed output order: %v", sink.events)
	}
	for index, event := range sink.events {
		if event.GetSequence() != uint64(index+1) {
			t.Fatal("non-dense public sequence")
		}
	}
}

func TestLocalAppTextBehaviorRejectsInvalidOutputCallsAndChoice(t *testing.T) {
	tool := localAppLookupTool(t)
	for name, mutate := range map[string]func(*runtimev1.ToolCall){
		"unknown tool":         func(c *runtimev1.ToolCall) { c.Name = "other" },
		"incomplete arguments": func(c *runtimev1.ToolCall) { c.ArgumentsJson = `{"query":` },
		"wrong schema":         func(c *runtimev1.ToolCall) { c.ArgumentsJson = `{"query":7}` },
	} {
		t.Run(name, func(t *testing.T) {
			call := localAppLookupCall()
			mutate(call)
			bridge := &localAppTextTurnStreamBridge{ServerStreamingServer: &mockLocalAppTextTurnStream{ctx: context.Background()}, tools: map[string]*runtimev1.ToolSpec{"lookup": tool}}
			err := bridge.Send(&runtimev1.StreamScenarioEvent{Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: toolCallOutputDelta(0, call)}})
			assertLocalAppTextCandidateError(t, err, codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
		})
	}
	_, err := projectLocalAppTextOutput(canonicalTextGenerateOutput("ignored tool choice", nil), runtimev1.FinishReason_FINISH_REASON_STOP, &runtimev1.TextGenerateScenarioSpec{Tools: []*runtimev1.ToolSpec{tool}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED})
	assertLocalAppTextCandidateError(t, err, codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}

func TestExecuteLocalAppTextScenarioUsesAppAIConfig(t *testing.T) {
	svc := newTestService(nil)
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("text.generate"))); err != nil {
		t.Fatal(err)
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "config-app", "app.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{result: localexecution.TextResult{Text: "owner selected text", FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}})
	response, err := svc.ExecuteLocalAppScenario(localAppScenarioExecuteContext(), &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "Generate text."}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if response.GetTextGenerate() == nil || response.GetTextGenerate().GetItems()[0].GetText().GetText() != "owner selected text" || response.GetTraceId() == "" {
		t.Fatalf("text response: %v", response)
	}
}
