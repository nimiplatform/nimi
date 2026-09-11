package grpcserver

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func textBusinessJSONRequest(t *testing.T) *runtimev1.StreamLocalAppTextTurnRequest {
	t.Helper()
	schema, err := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"subject": map[string]any{"type": "string"}}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := structpb.NewValue(map[string]any{"subject": "email subject", "token": "application-owned value"})
	if err != nil {
		t.Fatal(err)
	}
	return &runtimev1.StreamLocalAppTextTurnRequest{
		Messages: []*runtimev1.LocalAppTextCandidateMessage{
			{Role: "user", Text: "read the selected document"},
			{Role: "assistant", TurnItems: []*runtimev1.TextTurnItem{
				{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "read", ArgumentsJson: `{}`}}}}},
				{Item: &runtimev1.TextTurnItem_ToolResult{ToolResult: &runtimev1.ToolResult{ToolCallId: "call-1", ToolName: "read", Result: result}}},
			}},
		},
		Tools:          []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "read", InputSchema: schema}},
		ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA, JsonSchema: schema},
	}
}

func TestProtectedLocalAppTextBusinessJSONDoesNotAssertCallerAuthority(t *testing.T) {
	request := textBusinessJSONRequest(t)
	if protectedLocalAppRequestHasCallerAssertionForMethod(context.Background(), request, protectedStreamTextTurnMethod) {
		t.Fatal("declared schemas and tool results were treated as caller identity")
	}
	execute := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: request}}
	if protectedLocalAppRequestHasCallerAssertionForMethod(context.Background(), execute, protectedExecuteLocalAppScenarioMethod) {
		t.Fatal("synchronous text business JSON was rejected")
	}
	if !protectedLocalAppRequestHasCallerAssertion(context.Background(), request) {
		t.Fatal("text data exception leaked outside the exact text operation")
	}
	request.Tools[0].ProviderArgs = request.Tools[0].InputSchema
	if !protectedLocalAppRequestHasCallerAssertionForMethod(context.Background(), request, protectedStreamTextTurnMethod) {
		t.Fatal("the schema exception admitted another provider field")
	}
}

func TestProtectedLocalAppTextUnknownFieldsStillFailClosed(t *testing.T) {
	unknown := protowire.AppendVarint(protowire.AppendTag(nil, 199, protowire.VarintType), 1)
	request := textBusinessJSONRequest(t)
	request.ProtoReflect().SetUnknown(unknown)
	if !protectedLocalAppRequestHasCallerAssertionForMethod(context.Background(), request, protectedStreamTextTurnMethod) {
		t.Fatal("unknown protobuf fields were silently accepted")
	}
	request = proto.Clone(textBusinessJSONRequest(t)).(*runtimev1.StreamLocalAppTextTurnRequest)
	request.Tools[0].InputSchema.ProtoReflect().SetUnknown(unknown)
	if !protectedLocalAppRequestHasCallerAssertionForMethod(context.Background(), request, protectedStreamTextTurnMethod) {
		t.Fatal("business JSON bypassed unknown protobuf field validation")
	}
}
