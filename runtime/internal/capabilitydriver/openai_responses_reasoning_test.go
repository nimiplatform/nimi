package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func TestOpenAIResponsesReasoningMappingAndOffAreExact(t *testing.T) {
	for _, model := range []string{"gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"} {
		for _, effort := range []runtimev1.ReasoningEffort{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW, runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM} {
			spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Compute"}}, Reasoning: &runtimev1.ReasoningConfig{
				Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY,
				Intensity: &runtimev1.ReasoningConfig_Effort{Effort: effort},
			}}
			request, err := OpenAIResponsesTextBehaviorRequestSerializer(model, spec, false)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if json.Unmarshal(request.Payload, &body) != nil {
				t.Fatal("not JSON")
			}
			wire := body["reasoning"].(map[string]any)
			want := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}[effort]
			if wire["effort"] != want || wire["summary"] != "auto" || body["store"] != false {
				t.Fatalf("wire = %v", body)
			}
			spec.Reasoning = nil
			request, err = OpenAIResponsesTextBehaviorRequestSerializer(model, spec, true)
			if err != nil {
				t.Fatal(err)
			}
			body = nil
			_ = json.Unmarshal(request.Payload, &body)
			if _, exists := body["reasoning"]; exists {
				t.Fatal("omission fabricated a reasoning control")
			}
			spec.Reasoning = &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED}
			request, err = OpenAIResponsesTextBehaviorRequestSerializer(model, spec, true)
			if model != "gpt-6-luna" {
				if err == nil {
					t.Fatal("unsupported off accepted")
				}
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			body = nil
			_ = json.Unmarshal(request.Payload, &body)
			if body["reasoning"].(map[string]any)["effort"] != "none" {
				t.Fatal("Luna off was not none")
			}
		}
	}
}

// Multiple summary parts must not consume the provider's output indices or
// collide with the following carrier/text. Changed native seals fail closed.
func TestOpenAIResponsesSummaryPartsHaveGlobalIndicesAndReplayOnce(t *testing.T) {
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Compute"}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: nil}}, Reasoning: &runtimev1.ReasoningConfig{Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}}
	stream := newResponsesStreamAssembler(openAIResponses, spec)
	var deltas []textbehavior.OrderedDelta
	appendEvent := func(event map[string]any) {
		t.Helper()
		payload, _ := json.Marshal(event)
		items, err := stream.Append(payload)
		if err != nil {
			t.Fatal(err)
		}
		deltas = append(deltas, items...)
	}
	appendEvent(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "reasoning", "id": "rs_1"}})
	parts := []responsesSummaryPart{{Type: "summary_text", Text: "Part one"}, {Type: "summary_text", Text: "Part two"}}
	for index, part := range parts {
		base := map[string]any{"output_index": 0, "item_id": "rs_1", "summary_index": index}
		base["type"] = "response.reasoning_summary_part.added"
		base["part"] = responsesSummaryPart{Type: "summary_text"}
		appendEvent(base)
		delete(base, "part")
		base["type"] = "response.reasoning_summary_text.delta"
		base["delta"] = part.Text
		appendEvent(base)
		if len(deltas) == 0 || deltas[len(deltas)-1].Text != part.Text || deltas[len(deltas)-1].ItemCompleted {
			t.Fatal("summary activity was buffered until item completion")
		}
		delete(base, "delta")
		base["type"] = "response.reasoning_summary_text.done"
		base["text"] = part.Text
		appendEvent(base)
		delete(base, "text")
		base["type"] = "response.reasoning_summary_part.done"
		base["part"] = part
		appendEvent(base)
	}
	native := responsesEncryptedReasoning{Type: "reasoning", ID: "rs_1", Encrypted: "opaque", Summary: parts}
	appendEvent(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": native})
	message := map[string]any{"type": "message", "id": "msg_1", "content": []any{map[string]any{"type": "output_text", "text": "Final"}}}
	appendEvent(map[string]any{"type": "response.output_item.added", "output_index": 1, "item": map[string]any{"type": "message", "id": "msg_1"}})
	appendEvent(map[string]any{"type": "response.output_item.done", "output_index": 1, "item": message})
	appendEvent(map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": []any{native, message}}})
	result, err := stream.Finish()
	if err != nil {
		t.Fatal(err)
	}
	want := 4
	if len(result.Items) != want || result.Usage != nil {
		t.Fatalf("items/usage = %+v", result)
	}
	for index, delta := range deltas {
		wantIndex := []uint32{0, 0, 1, 1, 2, 3}[index]
		if delta.ItemIndex != wantIndex {
			t.Fatalf("indices = %v", deltas)
		}
	}
	var transcript []*runtimev1.TextTurnItem
	for _, item := range result.Items {
		output := &runtimev1.TextOutputItem{}
		switch item.Kind {
		case textbehavior.OrderedItemReasoningSummary:
			output.Item = &runtimev1.TextOutputItem_ReasoningSummary{ReasoningSummary: &runtimev1.ReasoningSummary{Text: item.Text}}
		case textbehavior.OrderedItemReasoningContinuity:
			output.Item = &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: item.ReasoningContinuity}
		case textbehavior.OrderedItemText:
			output.Item = &runtimev1.TextOutputItem_Text{Text: &runtimev1.TextOutputText{Text: item.Text}}
		}
		transcript = append(transcript, &runtimev1.TextTurnItem{Item: &runtimev1.TextTurnItem_Output{Output: output}})
	}
	wire, err := responsesTurnItems(openAIResponses, transcript)
	if err != nil || len(wire) != 2 {
		t.Fatalf("replay duplicated summary = %v %v", wire, err)
	}
	observed := wire[0].(responsesEncryptedReasoning)
	if observed.Summary[1].Text != parts[1].Text || observed.Encrypted != "opaque" {
		t.Fatal("native replay changed")
	}
	if _, err := responsesTurnItems(openAIResponses, transcript[2:]); err == nil {
		t.Fatal("deleting every summary was accepted")
	}
	transcript[0].GetOutput().GetReasoningSummary().Text = "edited"
	if _, err := responsesTurnItems(openAIResponses, transcript); err == nil {
		t.Fatal("changed summary replay accepted")
	}
}

func TestOpenAIResponsesHiddenNeverPublishesNativeSummary(t *testing.T) {
	for _, config := range []*runtimev1.ReasoningConfig{nil, {Activation: runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, Presentation: runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN, Intensity: &runtimev1.ReasoningConfig_Effort{Effort: runtimev1.ReasoningEffort_REASONING_EFFORT_LOW}}} {
		stream := newResponsesStreamAssembler(openAIResponses, &runtimev1.TextGenerateScenarioSpec{Reasoning: config})
		added, _ := json.Marshal(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "reasoning", "id": "rs_hidden"}})
		if deltas, err := stream.Append(added); err != nil || len(deltas) != 0 {
			t.Fatal("added item")
		}
		done, _ := json.Marshal(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": responsesEncryptedReasoning{Type: "reasoning", ID: "rs_hidden", Encrypted: "opaque", Summary: []responsesSummaryPart{{Type: "summary_text", Text: "must not reach caller"}}}})
		if deltas, err := stream.Append(done); err == nil || len(deltas) != 0 {
			t.Fatal("hidden plaintext summary was carried publicly")
		}
	}
}

func TestResponsesProfilesWithoutControlsRejectNonemptySummaryCarrier(t *testing.T) {
	profile := *openAIResponses
	profile.reasoningControls = false
	native := responsesEncryptedReasoning{Type: "reasoning", ID: "rs_unadmitted", Encrypted: "opaque", Summary: []responsesSummaryPart{{Type: "summary_text", Text: "Unadmitted"}}}
	payload, _ := json.Marshal(native)
	transcript := []*runtimev1.TextTurnItem{{Item: &runtimev1.TextTurnItem_Output{Output: &runtimev1.TextOutputItem{Item: &runtimev1.TextOutputItem_ReasoningContinuity{ReasoningContinuity: &runtimev1.ReasoningContinuityCarrier{Kind: profile.continuityKind, Version: 1, Payload: payload}}}}}}
	if _, err := responsesTurnItems(&profile, transcript); err == nil {
		t.Fatal("profile without authorized summaries accepted nonempty native summary")
	}
}
