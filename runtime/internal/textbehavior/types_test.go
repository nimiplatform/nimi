package textbehavior

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestNormalizedAdapterResultRequiresPrimaryOutputAndRejectsConfirmedBudgetExhaustion(t *testing.T) {
	for _, test := range []struct {
		name   string
		result NormalizedResult
		spec   *runtimev1.TextGenerateScenarioSpec
		want   runtimev1.ReasonCode
	}{
		{name: "hidden reasoning only", result: NormalizedResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}, want: runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{name: "reasoning partial text exhausted", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "partial"}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_LENGTH}, spec: reasoningSummarySpecForTest(), want: runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE},
		{name: "missing normalized terminal", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "done"}}}, want: runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{name: "error terminal cannot succeed", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "partial"}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_ERROR}, want: runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{name: "tool terminal requires tool call", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "done"}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_TOOL_CALL}, want: runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{name: "base partial text length", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "partial"}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_LENGTH}},
		{name: "complete text", result: NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "done"}}, FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.spec == nil {
				test.spec = &runtimev1.TextGenerateScenarioSpec{}
			}
			_, err := validateAndCloneNormalizedResult(test.result, test.spec)
			if test.want == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != test.want {
				t.Fatalf("result error = %v reason=%v ok=%v", err, reason, ok)
			}
		})
	}
}

func reasoningSummarySpecForTest() *runtimev1.TextGenerateScenarioSpec {
	return &runtimev1.TextGenerateScenarioSpec{Reasoning: &runtimev1.ReasoningConfig{
		Activation:   runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED,
		Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
		Intensity:    &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW},
	}}
}

type scriptedNormalizedStreamAssembler struct {
	appends [][]OrderedDelta
	index   int
}

func (assembler *scriptedNormalizedStreamAssembler) Append([]byte) ([]OrderedDelta, error) {
	if assembler.index >= len(assembler.appends) {
		return nil, nil
	}
	result := assembler.appends[assembler.index]
	assembler.index++
	return result, nil
}

func (*scriptedNormalizedStreamAssembler) Finish() (NormalizedResult, error) {
	return NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "done"}}}, nil
}

func TestValidatingStreamAssemblerRejectsUndeclaredAndDuplicateToolCallsBeforePublication(t *testing.T) {
	for _, test := range []struct {
		name    string
		appends [][]OrderedDelta
	}{
		{name: "undeclared tool", appends: [][]OrderedDelta{{{
			ItemIndex: 0, Kind: OrderedItemToolCall, ItemCompleted: true,
			ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "weather", ArgumentsJson: "{}"},
		}}}},
		{name: "duplicate call id", appends: [][]OrderedDelta{{{
			ItemIndex: 0, Kind: OrderedItemToolCall, ItemCompleted: true,
			ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"},
		}}, {{
			ItemIndex: 1, Kind: OrderedItemToolCall, ItemCompleted: true,
			ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: "{}"},
		}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapter, err := NewAdapter(AdapterCapture{
				AdapterID: "test", Version: "1", RequestSerializerID: "request/v1",
				NonStreamParserID: "sync/v1", StreamAssemblerID: "stream/v1",
				ProcessIdentityImpact: ProcessIdentityUnaffected,
			}, func(*runtimev1.TextGenerateScenarioSpec, bool) (SerializedRequest, error) {
				return SerializedRequest{ContentType: "application/json", Payload: []byte("{}")}, nil
			}, func([]byte, *runtimev1.TextGenerateScenarioSpec) (NormalizedResult, error) {
				return NormalizedResult{Items: []OrderedItem{{Kind: OrderedItemText, Text: "done"}}}, nil
			}, func(*runtimev1.TextGenerateScenarioSpec) (StreamFragmentAssembler, error) {
				return &scriptedNormalizedStreamAssembler{appends: test.appends}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			invocation, err := adapter.Bind(&runtimev1.TextGenerateScenarioSpec{Tools: []*runtimev1.ToolSpec{{
				Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup",
			}}})
			if err != nil {
				t.Fatal(err)
			}
			assembler, err := invocation.NewStreamAssembler()
			if err != nil {
				t.Fatal(err)
			}
			for index := range test.appends {
				_, err = assembler.Append(nil)
				if index+1 < len(test.appends) && err != nil {
					t.Fatalf("early append %d: %v", index, err)
				}
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_TOOL_CALL_INVALID {
				t.Fatalf("invalid stream tool call error = %v reason=%v present=%v", err, reason, ok)
			}
		})
	}
}

func TestReasoningContinuityUsesCanonicalTransportBound(t *testing.T) {
	valid := &runtimev1.ReasoningContinuityCarrier{Kind: "native", Version: 1, Payload: make([]byte, MaxReasoningContinuityPayloadBytes)}
	if !ValidContinuity(valid) {
		t.Fatal("maximum-size reasoning continuity carrier was rejected")
	}
	valid.Payload = make([]byte, MaxReasoningContinuityPayloadBytes+1)
	if ValidContinuity(valid) {
		t.Fatal("oversized reasoning continuity carrier was accepted")
	}
	_, err := validateAndCloneNormalizedResult(NormalizedResult{
		Items: []OrderedItem{
			{Kind: OrderedItemText, Text: "done"},
			{Kind: OrderedItemReasoningContinuity, ReasoningContinuity: valid},
		},
		FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
	}, &runtimev1.TextGenerateScenarioSpec{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID {
		t.Fatalf("oversized normalized continuity error = %v reason=%v present=%v", err, reason, ok)
	}
}
