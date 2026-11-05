package capabilitydriver

import (
	"encoding/json"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type geminiInteractionStep struct {
	Type      string                     `json:"type"`
	ID        string                     `json:"id,omitempty"`
	Name      string                     `json:"name,omitempty"`
	Arguments json.RawMessage            `json:"arguments,omitempty"`
	Content   []geminiInteractionContent `json:"content,omitempty"`
	Signature string                     `json:"signature,omitempty"`
	Summary   []geminiInteractionContent `json:"summary,omitempty"`
}

type geminiInteractionUsage struct {
	Input *int64 `json:"total_input_tokens"`
	Total *int64 `json:"total_tokens"`
}

type geminiTextInteraction struct {
	ID     string                  `json:"id"`
	Object string                  `json:"object"`
	Model  string                  `json:"model"`
	Status string                  `json:"status"`
	Steps  []geminiInteractionStep `json:"steps"`
	Usage  *geminiInteractionUsage `json:"usage"`
}

func geminiArgonOutputInvalid(stage string) error {
	// Only adapter-authored stage names reach the public diagnostic. Provider
	// bodies, generated text, signatures and tool arguments remain private.
	slog.Warn("Gemini Argon response rejected", "stage", stage)
	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{Message: "Gemini Argon returned an invalid " + stage + "."})
}

func geminiArgonUsage(usage *geminiInteractionUsage) (*runtimev1.UsageStats, error) {
	if usage == nil {
		return nil, nil
	}
	if usage.Input != nil && *usage.Input < 0 || usage.Total != nil && *usage.Total < 0 {
		return nil, gemini38OutputInvalid()
	}
	if usage.Input == nil || usage.Total == nil {
		return nil, nil
	}
	if *usage.Total < *usage.Input {
		return nil, gemini38OutputInvalid()
	}
	return &runtimev1.UsageStats{InputTokens: *usage.Input, OutputTokens: *usage.Total - *usage.Input}, nil
}

func geminiArgonNormalizeStep(step geminiInteractionStep) (textbehavior.OrderedItem, error) {
	item := textbehavior.OrderedItem{}
	switch step.Type {
	case "model_output":
		var text strings.Builder
		for _, content := range step.Content {
			if content.Type != "text" {
				return item, gemini38OutputInvalid()
			}
			text.WriteString(content.Text)
		}
		if text.Len() == 0 {
			return item, gemini38OutputInvalid()
		}
		item.Kind, item.Text = textbehavior.OrderedItemText, text.String()
	case "function_call":
		var args map[string]json.RawMessage
		if !deepseekCallID(step.ID) || !deepseekFunctionName(step.Name) || json.Unmarshal(step.Arguments, &args) != nil || args == nil {
			return item, gemini38OutputInvalid()
		}
		item.Kind = textbehavior.OrderedItemToolCall
		item.ToolCall = &runtimev1.ToolCall{Id: step.ID, Name: step.Name, ArgumentsJson: string(step.Arguments)}
	case "thought":
		thought := geminiInteractionThought{Type: step.Type, Signature: step.Signature, Summary: step.Summary}
		if !geminiArgonThoughtValid(thought) {
			return item, gemini38OutputInvalid()
		}
		payload, err := json.Marshal(thought)
		if err != nil {
			return item, err
		}
		carrier := &runtimev1.ReasoningContinuityCarrier{Kind: GeminiArgonThoughtKind, Version: 1, Payload: payload}
		if !textbehavior.ValidContinuity(carrier) {
			return item, gemini38OutputInvalid()
		}
		item.Kind, item.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, carrier
	default:
		return item, gemini38OutputInvalid()
	}
	return item, nil
}

func geminiArgonSummaryText(parts []geminiInteractionContent) string {
	var text strings.Builder
	for _, part := range parts {
		text.WriteString(part.Text)
	}
	return text.String()
}

func geminiArgonStepItems(step geminiInteractionStep, summary bool) ([]textbehavior.OrderedItem, error) {
	item, err := geminiArgonNormalizeStep(step)
	if err != nil {
		return nil, err
	}
	if step.Type == "thought" && summary {
		if text := geminiArgonSummaryText(step.Summary); text != "" {
			return []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemReasoningSummary, Text: text}, item}, nil
		}
	}
	return []textbehavior.OrderedItem{item}, nil
}

func geminiArgonTerminal(interaction geminiTextInteraction, result *textbehavior.NormalizedResult, partial bool) error {
	usage, err := geminiArgonUsage(interaction.Usage)
	if err != nil {
		return err
	}
	result.Usage = usage
	// store=false returns no retrievable Interaction resource id. The exact
	// model and object remain mandatory; a supplied stream id must stay stable.
	if (!partial || interaction.Object != "") && interaction.Object != "interaction" || (!partial || interaction.Model != "") && interaction.Model != "gemini-4-argon" {
		return geminiArgonOutputInvalid("terminal identity")
	}
	toolCalls := false
	for _, item := range result.Items {
		toolCalls = toolCalls || item.Kind == textbehavior.OrderedItemToolCall
	}
	switch interaction.Status {
	case "completed":
		if toolCalls {
			return geminiArgonOutputInvalid("completed terminal containing function calls")
		}
		result.FinishReason = runtimev1.FinishReason_FINISH_REASON_STOP
	case "requires_action":
		if !toolCalls {
			return geminiArgonOutputInvalid("requires-action terminal without function calls")
		}
		result.FinishReason = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "incomplete", "requires_continuation":
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	case "cancelled":
		return grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	default:
		return geminiArgonOutputInvalid("terminal status")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-argon-text-behaviors
func GeminiArgonNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var interaction geminiTextInteraction
	result := textbehavior.NormalizedResult{}
	if json.Unmarshal(payload, &interaction) != nil {
		return result, geminiArgonOutputInvalid("JSON interaction")
	}
	for _, step := range interaction.Steps {
		items, err := geminiArgonStepItems(step, spec.GetReasoning().GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY)
		if err != nil {
			stage := "step"
			switch step.Type {
			case "thought":
				stage = "thought step"
			case "function_call":
				stage = "function-call step"
			case "model_output":
				stage = "model-output step"
			}
			return result, geminiArgonOutputInvalid(stage)
		}
		result.Items = append(result.Items, items...)
	}
	err := geminiArgonTerminal(interaction, &result, false)
	return result, err
}

type geminiArgonStream struct {
	id                      string
	created, terminal, done bool
	active                  *geminiInteractionStep
	index                   int
	nativeSteps             int
	itemIndex               uint32
	summary                 bool
	summaryBytes            int
	arguments               strings.Builder
	result                  textbehavior.NormalizedResult
}

func GeminiArgonStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &geminiArgonStream{summary: spec.GetReasoning().GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY}, nil
}

func (s *geminiArgonStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	stage := "stream envelope"
	invalid := func() ([]textbehavior.OrderedDelta, error) { return nil, geminiArgonOutputInvalid(stage) }
	if string(payload) == "[DONE]" {
		if !s.terminal || s.done {
			return invalid()
		}
		s.done = true
		return nil, nil
	}
	if s.terminal {
		return invalid()
	}
	var event struct {
		Type          string                  `json:"event_type"`
		Index         *int                    `json:"index"`
		Step          *geminiInteractionStep  `json:"step"`
		Interaction   geminiTextInteraction   `json:"interaction"`
		InteractionID string                  `json:"interaction_id"`
		Status        string                  `json:"status"`
		Usage         *geminiInteractionUsage `json:"usage"`
		Delta         struct {
			Type      string                    `json:"type"`
			Text      *string                   `json:"text"`
			Arguments *string                   `json:"arguments"`
			Signature *string                   `json:"signature"`
			Content   *geminiInteractionContent `json:"content"`
		} `json:"delta"`
	}
	if json.Unmarshal(payload, &event) != nil {
		return invalid()
	}
	switch event.Type {
	case "interaction.created":
		stage = "stream creation"
	case "interaction.status_update":
		stage = "stream status update"
	case "step.start":
		stage = "stream step start"
	case "step.delta":
		stage = "stream step delta"
	case "step.stop":
		stage = "stream step stop"
	case "interaction.completed":
		stage = "stream completion"
	case "error":
		stage = "provider error event"
	}
	if event.Type == "interaction.created" {
		v := event.Interaction
		// SSE interaction resources are partial: model and object are optional,
		// while an explicitly reported foreign identity still fails closed.
		if s.created {
			return nil, geminiArgonOutputInvalid("duplicate stream creation")
		}
		if v.Object != "" && v.Object != "interaction" {
			return nil, geminiArgonOutputInvalid("stream creation object")
		}
		if v.Model != "" && v.Model != "gemini-4-argon" {
			return nil, geminiArgonOutputInvalid("stream creation model")
		}
		// Creation is only an envelope; stateless partial resources may omit
		// status or already be queued, waiting for tools, or completed. Only
		// the later interaction.completed event seals this model step.
		switch v.Status {
		case "", "queued", "in_progress", "requires_action", "completed":
		default:
			return nil, geminiArgonOutputInvalid("stream creation status")
		}
		s.created, s.id = true, v.ID
		return nil, nil
	}
	if !s.created {
		return invalid()
	}
	switch event.Type {
	case "interaction.status_update":
		if event.InteractionID != s.id || (event.Status != "queued" && event.Status != "in_progress" && event.Status != "requires_action" && event.Status != "completed") {
			return invalid()
		}
		return nil, nil
	case "step.start":
		if s.active != nil || event.Index == nil || *event.Index != s.nativeSteps || event.Step == nil {
			return invalid()
		}
		step := event.Step
		if step.Type != "thought" && step.Type != "model_output" && step.Type != "function_call" {
			return invalid()
		}
		s.active, s.index = step, *event.Index
		s.itemIndex = uint32(len(s.result.Items))
		s.summaryBytes = 0
		for _, part := range step.Summary {
			s.summaryBytes += len(part.Text) + 32
		}
		if s.summaryBytes > textbehavior.MaxReasoningContinuityPayloadBytes || len(step.Signature) > textbehavior.MaxReasoningContinuityPayloadBytes {
			return invalid()
		}
		s.arguments.Reset()
		if step.Type == "function_call" && len(step.Arguments) > 0 && strings.TrimSpace(string(step.Arguments)) != "{}" {
			s.arguments.Write(step.Arguments)
		}
		if step.Type == "model_output" && len(step.Content) > 0 {
			return invalid()
		}
		return nil, nil
	case "step.delta":
		if s.active == nil || event.Index == nil || *event.Index != s.index {
			return invalid()
		}
		switch event.Delta.Type {
		case "text":
			if s.active.Type != "model_output" || event.Delta.Text == nil {
				return invalid()
			}
			if *event.Delta.Text == "" {
				return nil, nil
			}
			s.active.Content = append(s.active.Content, geminiInteractionContent{Type: "text", Text: *event.Delta.Text})
			return []textbehavior.OrderedDelta{{ItemIndex: s.itemIndex, Kind: textbehavior.OrderedItemText, Text: *event.Delta.Text}}, nil
		case "arguments_delta":
			if s.active.Type != "function_call" || event.Delta.Arguments == nil {
				return invalid()
			}
			s.arguments.WriteString(*event.Delta.Arguments)
			if s.arguments.Len() > GeminiNativeMaxRequestBytes {
				return invalid()
			}
		case "thought_signature":
			if s.active.Type != "thought" || event.Delta.Signature == nil {
				return invalid()
			}
			s.active.Signature += *event.Delta.Signature
			if len(s.active.Signature) > textbehavior.MaxReasoningContinuityPayloadBytes {
				return invalid()
			}
		case "thought_summary":
			if s.active.Type != "thought" || event.Delta.Content == nil || event.Delta.Content.Type != "text" {
				return invalid()
			}
			s.summaryBytes += len(event.Delta.Content.Text) + 32
			if s.summaryBytes > textbehavior.MaxReasoningContinuityPayloadBytes {
				return invalid()
			}
			s.active.Summary = append(s.active.Summary, *event.Delta.Content)
		default:
			return invalid()
		}
		return nil, nil
	case "step.stop":
		if s.active == nil || event.Index == nil || *event.Index != s.index {
			return invalid()
		}
		if s.active.Type == "function_call" {
			if s.arguments.Len() > 0 {
				s.active.Arguments = json.RawMessage(s.arguments.String())
			} else if len(s.active.Arguments) == 0 {
				return invalid()
			}
		}
		items, err := geminiArgonStepItems(*s.active, s.summary)
		if err != nil {
			return nil, err
		}
		s.result.Items = append(s.result.Items, items...)
		s.active = nil
		s.nativeSteps++
		if event.Usage != nil {
			s.result.Usage, err = geminiArgonUsage(event.Usage)
			if err != nil {
				return nil, err
			}
		}
		deltas := make([]textbehavior.OrderedDelta, 0, len(items))
		for i, item := range items {
			delta := textbehavior.OrderedDelta{ItemIndex: s.itemIndex + uint32(i), Kind: item.Kind, ItemCompleted: true, ToolCall: item.ToolCall, ReasoningContinuity: item.ReasoningContinuity}
			if item.Kind == textbehavior.OrderedItemReasoningSummary {
				delta.Text = item.Text
			}
			deltas = append(deltas, delta)
		}
		return deltas, nil
	case "interaction.completed":
		if s.active != nil || event.Interaction.ID != s.id || len(event.Interaction.Steps) != 0 {
			return invalid()
		}
		if err := geminiArgonTerminal(event.Interaction, &s.result, true); err != nil {
			return nil, err
		}
		s.terminal = true
		return nil, nil
	case "error":
		return invalid()
	default:
		return invalid()
	}
}

func (s *geminiArgonStream) Finish() (textbehavior.NormalizedResult, error) {
	if !s.terminal || s.active != nil {
		return textbehavior.NormalizedResult{Usage: s.result.Usage}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	return s.result, nil
}
