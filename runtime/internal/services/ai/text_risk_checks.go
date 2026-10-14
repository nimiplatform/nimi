package ai

import (
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/riskcontrol"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.text-content-boundaries
// Fields in diagnostics are Runtime constants, never caller-controlled paths.
func (s *Service) textRiskError(rule, stage, part string) error {
	if rule == "" {
		return nil
	}
	if s.logger != nil {
		s.logger.Warn("text content refused", "rule_id", rule, "stage", stage, "part", part)
	}
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED, grpcerr.ReasonOptions{
		Message:    "content filtering blocked this request or response",
		ActionHint: "provide_redacted_content_or_change_context", Retryable: &retryable,
		Metadata: map[string]string{"rule_id": rule, "failure_stage": stage, "content_part": part},
	})
}

func (s *Service) checkTextRisk(text, stage, part string) error {
	return s.textRiskError(s.textRisk.Text(text), stage, part)
}

func (s *Service) checkJSONValueRisk(value *structpb.Value, stage, part string) error {
	if value == nil {
		return nil
	}
	switch v := value.GetKind().(type) {
	case *structpb.Value_StringValue:
		return s.checkTextRisk(v.StringValue, stage, part)
	case *structpb.Value_StructValue:
		return s.checkJSONStructRisk(v.StructValue, stage, part)
	case *structpb.Value_ListValue:
		for _, item := range v.ListValue.GetValues() {
			if err := s.checkJSONValueRisk(item, stage, part); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) checkJSONStructRisk(value *structpb.Struct, stage, part string) error {
	for _, item := range value.GetFields() {
		if err := s.checkJSONValueRisk(item, stage, part); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) checkToolCallRisk(call *runtimev1.ToolCall, stage string) error {
	if call == nil {
		return nil
	}
	if err := s.checkTextRisk(call.GetName(), stage, "tool_name"); err != nil {
		return err
	}
	// Decode escapes and check actual JSON values independently. Existing
	// schema/association validation remains with the text behavior owner.
	var value structpb.Value
	if err := json.Unmarshal([]byte(call.GetArgumentsJson()), &value); err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
	}
	return s.checkJSONValueRisk(&value, stage, "tool_arguments")
}

func (s *Service) checkTextInputRisk(spec *runtimev1.TextGenerateScenarioSpec) error {
	const stage = "input"
	if err := s.checkTextRisk(spec.GetSystemPrompt(), stage, "system"); err != nil {
		return err
	}
	for _, message := range spec.GetInput() {
		for _, text := range []string{message.GetContent(), message.GetName()} {
			if err := s.checkTextRisk(text, stage, "message"); err != nil {
				return err
			}
		}
		for _, part := range message.GetParts() {
			for _, text := range []string{part.GetText(), part.GetImageUrl().GetUrl(), part.GetAudioUrl(), part.GetVideoUrl(), part.GetArtifactRef().GetDisplayName()} {
				if err := s.checkTextRisk(text, stage, "message_part"); err != nil {
					return err
				}
			}
		}
		for _, item := range message.GetTurnItems() {
			output := item.GetOutput()
			for _, text := range []string{output.GetText().GetText(), output.GetReasoningSummary().GetText()} {
				if err := s.checkTextRisk(text, stage, "history"); err != nil {
					return err
				}
			}
			if err := s.checkToolCallRisk(output.GetToolCall(), stage); err != nil {
				return err
			}
			if err := s.checkJSONValueRisk(item.GetToolResult().GetResult(), stage, "tool_result"); err != nil {
				return err
			}
		}
	}
	for _, tool := range spec.GetTools() {
		for _, text := range []string{tool.GetName(), tool.GetDescription()} {
			if err := s.checkTextRisk(text, stage, "tool_definition"); err != nil {
				return err
			}
		}
		if err := s.checkJSONStructRisk(tool.GetInputSchema(), stage, "tool_schema"); err != nil {
			return err
		}
	}
	format := spec.GetResponseFormat()
	for _, text := range append([]string{format.GetSchemaName(), format.GetSchemaDescription(), spec.GetToolChoiceName()}, spec.GetStop()...) {
		if err := s.checkTextRisk(text, stage, "text_options"); err != nil {
			return err
		}
	}
	return s.checkJSONStructRisk(format.GetJsonSchema(), stage, "response_schema")
}

func (s *Service) checkTextResultRisk(text string, items []textbehavior.OrderedItem) error {
	// With ordered items, Text is only a concatenated convenience projection.
	// Inspect canonical values separately; do not invent matches across items.
	if len(items) == 0 {
		if err := s.checkTextRisk(text, "output", "text"); err != nil {
			return err
		}
	}
	for _, item := range items {
		if item.Kind == textbehavior.OrderedItemText || item.Kind == textbehavior.OrderedItemReasoningSummary {
			if err := s.checkTextRisk(item.Text, "output", "text_item"); err != nil {
				return err
			}
		}
		if err := s.checkToolCallRisk(item.ToolCall, "output"); err != nil {
			return err
		}
	}
	return nil
}

// Retain only active logical text items. Existing adapters/consumers own item
// ordering and capacity; inspection adds neither ordering nor size restrictions.
// Each active item holds constant state, and completion releases it immediately.
type textRiskStream struct {
	s     *Service
	items map[uint32]*riskcontrol.Stream
}

func (r *textRiskStream) delta(delta textbehavior.OrderedDelta) error {
	if delta.Kind == textbehavior.OrderedItemToolCall {
		return r.s.checkToolCallRisk(delta.ToolCall, "output")
	}
	if delta.Kind != textbehavior.OrderedItemText && delta.Kind != textbehavior.OrderedItemReasoningSummary {
		return nil
	}
	if r.items == nil {
		r.items = make(map[uint32]*riskcontrol.Stream)
	}
	state := r.items[delta.ItemIndex]
	if state == nil {
		state = &riskcontrol.Stream{}
		r.items[delta.ItemIndex] = state
	}
	if err := r.s.textRiskError(state.Feed(delta.Text), "output", "text_item"); err != nil {
		return err
	}
	if delta.ItemCompleted {
		delete(r.items, delta.ItemIndex)
		return r.s.textRiskError(state.Finish(), "output", "text_item")
	}
	return nil
}

func (r *textRiskStream) finish() error {
	for index, state := range r.items {
		delete(r.items, index)
		if err := r.s.textRiskError(state.Finish(), "output", "text_item"); err != nil {
			return err
		}
	}
	return nil
}
