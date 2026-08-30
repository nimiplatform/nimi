package runtimeagent

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

func scenarioStreamOutputItem(event *runtimev1.StreamScenarioEvent) *runtimev1.TextOutputItemDelta {
	if event == nil || event.GetDelta() == nil {
		return nil
	}
	return event.GetDelta().GetTextOutputItem()
}

func scenarioStreamText(event *runtimev1.StreamScenarioEvent) string {
	item := scenarioStreamOutputItem(event)
	if item == nil || item.GetText() == nil {
		return ""
	}
	return item.GetText().GetText()
}

func scenarioStreamReasoningSummary(event *runtimev1.StreamScenarioEvent) string {
	item := scenarioStreamOutputItem(event)
	if item == nil || item.GetReasoningSummary() == nil {
		return ""
	}
	return item.GetReasoningSummary().GetText()
}
