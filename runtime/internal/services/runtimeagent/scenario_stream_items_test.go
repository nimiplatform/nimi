package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func runtimeAgentTextStreamDelta(text string) *runtimev1.ScenarioStreamDelta {
	return runtimeAgentTextStreamDeltaAt(0, true, text)
}

func runtimeAgentTextStreamDeltaAt(itemIndex uint32, itemCompleted bool, text string) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{
			ItemIndex:     itemIndex,
			ItemCompleted: itemCompleted,
			Delta: &runtimev1.TextOutputItemDelta_Text{
				Text: &runtimev1.TextOutputTextDelta{Text: text},
			},
		}},
	}
}

func runtimeAgentReasoningSummaryStreamDelta(text string) *runtimev1.ScenarioStreamDelta {
	return runtimeAgentReasoningSummaryStreamDeltaAt(0, true, text)
}

func runtimeAgentReasoningSummaryStreamDeltaAt(itemIndex uint32, itemCompleted bool, text string) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{
			ItemIndex:     itemIndex,
			ItemCompleted: itemCompleted,
			Delta: &runtimev1.TextOutputItemDelta_ReasoningSummary{
				ReasoningSummary: &runtimev1.ReasoningSummaryDelta{Text: text},
			},
		}},
	}
}

func runtimeAgentToolCallStreamDelta(itemIndex uint32, call *runtimev1.ToolCall) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{
			ItemIndex:     itemIndex,
			ItemCompleted: true,
			Delta: &runtimev1.TextOutputItemDelta_ToolCall{
				ToolCall: call,
			},
		}},
	}
}

func runtimeAgentReasoningContinuityStreamDelta(itemIndex uint32, carrier *runtimev1.ReasoningContinuityCarrier) *runtimev1.ScenarioStreamDelta {
	return &runtimev1.ScenarioStreamDelta{
		Delta: &runtimev1.ScenarioStreamDelta_TextOutputItem{TextOutputItem: &runtimev1.TextOutputItemDelta{
			ItemIndex:     itemIndex,
			ItemCompleted: true,
			Delta: &runtimev1.TextOutputItemDelta_ReasoningContinuity{
				ReasoningContinuity: carrier,
			},
		}},
	}
}
