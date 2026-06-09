package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestTextL3ProtoFieldsRoundTrip(t *testing.T) {
	providerArgs, err := structpb.NewStruct(map[string]any{"maxResults": 3})
	if err != nil {
		t.Fatalf("provider args: %v", err)
	}
	providerMeta, err := structpb.NewStruct(map[string]any{"test": map[string]any{"id": "meta-1"}})
	if err != nil {
		t.Fatalf("provider metadata: %v", err)
	}
	resultValue, err := structpb.NewValue(map[string]any{"ok": true})
	if err != nil {
		t.Fatalf("result value: %v", err)
	}
	rawValue, err := structpb.NewValue(map[string]any{"provider": "raw"})
	if err != nil {
		t.Fatalf("raw value: %v", err)
	}

	req := &runtimev1.ExecuteScenarioRequest{
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{
						Role:    "tool",
						Content: "",
						ToolResults: []*runtimev1.ToolResult{{
							ToolCallId:       "call-1",
							ToolName:         "web_search",
							Result:           resultValue,
							Preliminary:      true,
							Dynamic:          true,
							ProviderMetadata: providerMeta,
						}},
						ToolApprovalResponses: []*runtimev1.ToolApprovalResponse{{
							ApprovalId:       "approval-1",
							Approved:         true,
							Reason:           "allowed",
							ProviderMetadata: providerMeta,
						}},
					}},
					Tools: []*runtimev1.ToolSpec{{
						Name:             "web_search",
						Kind:             runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER,
						ProviderToolId:   "test.web_search",
						ProviderArgs:     providerArgs,
						ProviderMetadata: providerMeta,
					}},
					IncludeRawChunks: true,
				},
			},
		},
	}

	binaryPayload, err := proto.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var binaryRoundTrip runtimev1.ExecuteScenarioRequest
	if err := proto.Unmarshal(binaryPayload, &binaryRoundTrip); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}
	spec := binaryRoundTrip.GetSpec().GetTextGenerate()
	if !spec.GetIncludeRawChunks() || spec.GetTools()[0].GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER {
		t.Fatalf("request L3 fields not preserved: %+v", spec)
	}
	if got := spec.GetInput()[0].GetToolResults()[0].GetResult().GetStructValue().AsMap()["ok"]; got != true {
		t.Fatalf("tool result not preserved: %v", got)
	}

	jsonPayload, err := protojson.Marshal(req)
	if err != nil {
		t.Fatalf("json marshal request: %v", err)
	}
	var jsonRoundTrip runtimev1.ExecuteScenarioRequest
	if err := protojson.Unmarshal(jsonPayload, &jsonRoundTrip); err != nil {
		t.Fatalf("json unmarshal request: %v", err)
	}
	if jsonRoundTrip.GetSpec().GetTextGenerate().GetTools()[0].GetProviderToolId() != "test.web_search" {
		t.Fatalf("provider tool id not preserved in JSON: %+v", jsonRoundTrip.GetSpec().GetTextGenerate().GetTools()[0])
	}

	output := &runtimev1.TextGenerateOutput{
		Text: "done",
		ToolCalls: []*runtimev1.ToolCall{{
			Id:               "call-1",
			Name:             "web_search",
			ArgumentsJson:    `{"query":"nimi"}`,
			ProviderExecuted: true,
			Dynamic:          true,
			ProviderMetadata: providerMeta,
		}},
		ToolResults: []*runtimev1.ToolResult{{
			ToolCallId:       "call-1",
			ToolName:         "web_search",
			Result:           resultValue,
			ProviderMetadata: providerMeta,
		}},
		ToolApprovalRequests: []*runtimev1.ToolApprovalRequest{{
			ApprovalId:       "approval-1",
			ToolCallId:       "call-1",
			ProviderMetadata: providerMeta,
		}},
		Sources: []*runtimev1.TextSource{{
			Id:               "source-1",
			SourceType:       runtimev1.TextSourceType_TEXT_SOURCE_TYPE_URL,
			Url:              "https://example.com",
			Title:            "Example",
			ProviderMetadata: providerMeta,
		}},
		RawChunks: []*runtimev1.RawChunk{{Value: rawValue}},
	}
	outputPayload, err := proto.Marshal(output)
	if err != nil {
		t.Fatalf("marshal output: %v", err)
	}
	var outputRoundTrip runtimev1.TextGenerateOutput
	if err := proto.Unmarshal(outputPayload, &outputRoundTrip); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if !outputRoundTrip.GetToolCalls()[0].GetProviderExecuted() ||
		outputRoundTrip.GetSources()[0].GetSourceType() != runtimev1.TextSourceType_TEXT_SOURCE_TYPE_URL ||
		outputRoundTrip.GetRawChunks()[0].GetValue().GetStructValue().AsMap()["provider"] != "raw" {
		t.Fatalf("output L3 fields not preserved: %+v", &outputRoundTrip)
	}

	event := &runtimev1.StreamScenarioEvent{
		Payload: &runtimev1.StreamScenarioEvent_Delta{
			Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Raw{Raw: &runtimev1.RawChunk{Value: rawValue}},
			},
		},
	}
	eventPayload, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("json marshal stream event: %v", err)
	}
	var eventRoundTrip runtimev1.StreamScenarioEvent
	if err := protojson.Unmarshal(eventPayload, &eventRoundTrip); err != nil {
		t.Fatalf("json unmarshal stream event: %v", err)
	}
	if eventRoundTrip.GetDelta().GetRaw().GetValue().GetStructValue().AsMap()["provider"] != "raw" {
		t.Fatalf("stream raw chunk not preserved: %+v", &eventRoundTrip)
	}
}
