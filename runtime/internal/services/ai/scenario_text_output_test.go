package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func TestCanonicalTextOutputDerivesConvenienceViewsFromOrderedAdapterItems(t *testing.T) {
	items := []textbehavior.OrderedItem{
		{Kind: textbehavior.OrderedItemReasoningSummary, Text: "checked"},
		{Kind: textbehavior.OrderedItemToolCall, ToolCall: &runtimev1.ToolCall{Id: "call-1", Name: "lookup", ArgumentsJson: `{}`}},
		{Kind: textbehavior.OrderedItemText, Text: "done"},
		{Kind: textbehavior.OrderedItemReasoningContinuity, ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: "native", Version: 1, Payload: []byte("opaque")}},
	}
	output := canonicalTextGenerateOutputFromOrdered(items)
	if output.GetText() != "done" || output.GetReasoningSummary() != "checked" || len(output.GetToolCalls()) != 1 ||
		output.GetToolCalls()[0].GetId() != "call-1" || len(output.GetItems()) != 4 ||
		string(output.GetItems()[3].GetReasoningContinuity().GetPayload()) != "opaque" {
		t.Fatalf("canonical ordered output = %+v", output)
	}
	items[1].ToolCall.Id = "mutated"
	items[3].ReasoningContinuity.Payload[0] = 'x'
	if output.GetToolCalls()[0].GetId() != "call-1" || string(output.GetItems()[3].GetReasoningContinuity().GetPayload()) != "opaque" {
		t.Fatal("canonical ordered output retained mutable adapter storage")
	}
}

func TestOrderedTextStreamDeltaProjectsOnlyCanonicalTypedBranch(t *testing.T) {
	projected := orderedTextOutputDelta(textbehavior.OrderedDelta{
		ItemIndex: 2, Kind: textbehavior.OrderedItemToolCall, ItemCompleted: true,
		ToolCall: &runtimev1.ToolCall{Id: "call-2", Name: "weather", ArgumentsJson: `{}`},
	})
	delta := projected.GetTextOutputItem()
	if delta.GetItemIndex() != 2 || !delta.GetItemCompleted() || delta.GetToolCall().GetId() != "call-2" || delta.GetText() != nil || delta.GetReasoningSummary() != nil {
		t.Fatalf("ordered public stream delta = %+v", delta)
	}
}
