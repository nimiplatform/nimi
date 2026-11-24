package textbehavior

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestOrderedStreamAssemblerToolCallActivityPreservesHasPublicPayload(t *testing.T) {
	assembler := NewOrderedStreamAssembler([]*runtimev1.ToolSpec{
		{Name: "write_file"},
	}, nil)

	deltas, err := assembler.AppendFragment(PrivateFragment{
		ItemIndex: 0,
		Kind:      OrderedItemToolCall,
		ToolCall: &ToolCallFragment{
			IDPart:            "call_1",
			NamePart:          "write_file",
			ArgumentsJSONPart: `{"path":"README.md",`,
		},
		Complete: false,
	})
	if err != nil {
		t.Fatalf("append partial tool fragment: %v", err)
	}
	if len(deltas) != 1 {
		t.Fatalf("expected 1 delta, got %d", len(deltas))
	}
	if deltas[0].HasPublicPayload() {
		t.Fatal("ToolCallActivity must never flip HasPublicPayload() to true")
	}
	if !deltas[0].HasToolCallActivity() {
		t.Fatal("expected transient ToolCallActivity liveness payload on partial tool-call delta")
	}
	if deltas[0].ToolCallActivity.CallID != "call_1" || deltas[0].ToolCallActivity.ToolName != "write_file" {
		t.Fatalf("unexpected activity metadata: %+v", deltas[0].ToolCallActivity)
	}
	if deltas[0].ToolCallActivity.ArgumentsDeltaBytes == 0 || deltas[0].ToolCallActivity.AccumulatedBytes != deltas[0].ToolCallActivity.ArgumentsDeltaBytes {
		t.Fatalf("unexpected activity byte counts: %+v", deltas[0].ToolCallActivity)
	}

	finalDeltas, err := assembler.AppendFragment(PrivateFragment{
		ItemIndex: 0,
		Kind:      OrderedItemToolCall,
		ToolCall: &ToolCallFragment{
			ArgumentsJSONPart: `"content":"ok"}`,
		},
		Complete: true,
	})
	if err != nil {
		t.Fatalf("append final tool fragment: %v", err)
	}
	if len(finalDeltas) != 1 || !finalDeltas[0].HasPublicPayload() || finalDeltas[0].ToolCall == nil {
		t.Fatalf("expected sealed public ToolCall on complete fragment, got %+v", finalDeltas)
	}
	if finalDeltas[0].HasToolCallActivity() {
		t.Fatalf("completed tool call must not also carry partial ToolCallActivity: %+v", finalDeltas[0])
	}
}
