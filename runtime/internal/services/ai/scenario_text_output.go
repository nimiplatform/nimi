package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r087
func canonicalTextGenerateOutput(text string, toolCalls []*runtimev1.ToolCall) *runtimev1.TextGenerateOutput {
	items := make([]*runtimev1.TextOutputItem, 0, 1+len(toolCalls))
	if text != "" {
		items = append(items, &runtimev1.TextOutputItem{
			Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: text}},
		})
	}
	clonedCalls := make([]*runtimev1.ToolCall, 0, len(toolCalls))
	for _, call := range toolCalls {
		if call == nil {
			continue
		}
		cloned, _ := proto.Clone(call).(*runtimev1.ToolCall)
		if cloned == nil {
			continue
		}
		clonedCalls = append(clonedCalls, cloned)
		items = append(items, &runtimev1.TextOutputItem{
			Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: cloned},
		})
	}
	return &runtimev1.TextGenerateOutput{
		Text:      text,
		ToolCalls: clonedCalls,
		Items:     items,
	}
}

func canonicalTextGenerateOutputFromOrdered(items []textbehavior.OrderedItem) *runtimev1.TextGenerateOutput {
	output := &runtimev1.TextGenerateOutput{}
	var text strings.Builder
	var summary strings.Builder
	for _, item := range items {
		var projected *runtimev1.TextOutputItem
		switch item.Kind {
		case textbehavior.OrderedItemText:
			text.WriteString(item.Text)
			projected = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: item.Text}}}
		case textbehavior.OrderedItemReasoningSummary:
			summary.WriteString(item.Text)
			projected = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: item.Text}}}
		case textbehavior.OrderedItemToolCall:
			call, _ := proto.Clone(item.ToolCall).(*runtimev1.ToolCall)
			if call != nil {
				output.ToolCalls = append(output.ToolCalls, call)
				projected = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ToolCall{ToolCall: call}}
			}
		case textbehavior.OrderedItemReasoningContinuity:
			continuity, _ := proto.Clone(item.ReasoningContinuity).(*runtimev1.ReasoningContinuityCarrier)
			if continuity != nil {
				projected = &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: continuity}}
			}
		}
		if projected != nil {
			output.Items = append(output.Items, projected)
		}
	}
	output.Text = text.String()
	output.ReasoningSummary = summary.String()
	return output
}

func textOutputDelta(index uint32, text string, completed bool) *runtimev1.ScenarioStreamDelta {
	delta := &runtimev1.TextOutputItemDelta{
		ItemIndex:     index,
		ItemCompleted: completed,
	}
	if text != "" {
		delta.Delta = &runtimev1.TextOutputItemDelta_Text{
			Text: &runtimev1.TextOutputTextDelta{Text: text},
		}
	}
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: delta},
	}
}

func toolCallOutputDelta(index uint32, call *runtimev1.ToolCall) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{
			TextOutputItem: &runtimev1.TextOutputItemDelta{
				ItemIndex:     index,
				ItemCompleted: true,
				Delta:         &runtimev1.TextOutputItemDelta_ToolCall{ToolCall: call},
			},
		},
	}
}

func orderedTextOutputDelta(delta textbehavior.OrderedDelta) *runtimev1.ScenarioStreamDelta {
	projected := &runtimev1.TextOutputItemDelta{ItemIndex: delta.ItemIndex, ItemCompleted: delta.ItemCompleted}
	switch delta.Kind {
	case textbehavior.OrderedItemText:
		if delta.Text != "" {
			projected.Delta = &runtimev1.TextOutputItemDelta_Text{Text: &runtimev1.TextOutputTextDelta{Text: delta.Text}}
		}
	case textbehavior.OrderedItemReasoningSummary:
		if delta.Text != "" {
			projected.Delta = &runtimev1.TextOutputItemDelta_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummaryDelta{Text: delta.Text}}
		}
	case textbehavior.OrderedItemToolCall:
		if delta.ToolCall != nil {
			call, _ := proto.Clone(delta.ToolCall).(*runtimev1.ToolCall)
			projected.Delta = &runtimev1.TextOutputItemDelta_ToolCall{ToolCall: call}
		}
	case textbehavior.OrderedItemReasoningContinuity:
		if delta.ReasoningContinuity != nil {
			continuity, _ := proto.Clone(delta.ReasoningContinuity).(*runtimev1.ReasoningContinuityCarrier)
			projected.Delta = &runtimev1.TextOutputItemDelta_ReasoningContinuity{ReasoningContinuity: continuity}
		}
	}
	return &runtimev1.ScenarioStreamDelta{Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: projected}}
}
