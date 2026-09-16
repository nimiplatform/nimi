package capabilitydriver

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.deepseek-v4-json-output
func validateDeepseekChatSpec(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil || llamaBehaviorReasoningEnabled(spec) || spec.TopK != nil || spec.Seed != nil {
		return deepseekUnsupported()
	}
	if len(spec.GetTools()) == 0 && (spec.GetToolChoiceName() != "" || (spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE)) {
		return deepseekUnsupported()
	}
	format := spec.GetResponseFormat()
	switch format.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if len(spec.GetTools()) != 0 {
			return deepseekUnsupported()
		}
	default:
		return deepseekUnsupported()
	}
	if format.GetStrict() || format.GetJsonSchema() != nil {
		return deepseekUnsupported()
	}
	if len(spec.GetTools()) == 0 && format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		return deepseekUnsupported()
	}
	return nil
}

func deepseekChatMessages(spec *runtimev1.TextGenerateScenarioSpec) ([]map[string]any, error) {
	messages := []map[string]any{}
	if spec.GetSystemPrompt() != "" {
		messages = append(messages, map[string]any{"role": "system", "content": spec.GetSystemPrompt()})
	}
	for _, m := range spec.GetInput() {
		if m == nil {
			return nil, deepseekJSONInputError("missing message")
		}
		if len(m.GetTurnItems()) == 0 {
			if m.Role != "system" && m.Role != "user" && m.Role != "assistant" {
				return nil, deepseekJSONInputError("message role")
			}
			text := m.GetContent()
			if len(m.GetParts()) > 0 {
				if text != "" {
					return nil, deepseekJSONInputError("conflicting content")
				}
				for _, part := range m.GetParts() {
					if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
						return nil, deepseekUnsupported()
					}
					text += part.GetText()
				}
			}
			messages = append(messages, map[string]any{"role": m.Role, "content": text})
			continue
		}
		if (m.Role != "assistant" && m.Role != "tool") || m.GetContent() != "" || len(m.GetParts()) > 0 {
			return nil, deepseekJSONInputError("ordered transcript")
		}
		var assistant map[string]any
		calls := []map[string]any{}
		flush := func() {
			if assistant != nil {
				if len(calls) > 0 {
					assistant["tool_calls"] = calls
				}
				messages = append(messages, assistant)
				assistant = nil
				calls = nil
			}
		}
		for _, item := range m.GetTurnItems() {
			if item == nil {
				return nil, deepseekJSONInputError("empty turn item")
			}
			if result := item.GetToolResult(); result != nil {
				flush()
				if result.GetDynamic() || result.GetPreliminary() || result.GetProviderMetadata() != nil {
					return nil, deepseekUnsupported()
				}
				var value any
				if result.GetResult() != nil {
					value = result.GetResult().AsInterface()
				}
				if result.GetIsError() {
					value = map[string]any{"error": value}
				}
				content, ok := value.(string)
				if !ok {
					encoded, err := json.Marshal(value)
					if err != nil {
						return nil, err
					}
					content = string(encoded)
				}
				messages = append(messages, map[string]any{"role": "tool", "tool_call_id": result.GetToolCallId(), "content": content})
				continue
			}
			if m.Role == "tool" || item.GetOutput() == nil {
				return nil, deepseekJSONInputError("ordered output")
			}
			if assistant == nil {
				assistant = map[string]any{"role": "assistant", "content": ""}
			}
			switch v := item.GetOutput().GetItem().(type) {
			case *runtimev1.TextOutputItem_Text:
				if v.Text == nil || len(calls) > 0 {
					return nil, deepseekUnsupported()
				}
				assistant["content"] = assistant["content"].(string) + v.Text.GetText()
			case *runtimev1.TextOutputItem_ToolCall:
				call := v.ToolCall
				if call == nil || call.GetDynamic() || call.GetProviderMetadata() != nil {
					return nil, deepseekUnsupported()
				}
				calls = append(calls, map[string]any{"id": call.GetId(), "type": "function", "function": map[string]any{"name": call.GetName(), "arguments": call.GetArgumentsJson()}})
			default:
				return nil, deepseekUnsupported()
			}
		}
		flush()
	}
	if len(messages) == 0 {
		return nil, deepseekJSONInputError("missing text input")
	}
	return messages, nil
}

func deepseekChatTools(body map[string]any, spec *runtimev1.TextGenerateScenarioSpec) error {
	tools := []map[string]any{}
	declared := map[string]bool{}
	for _, tool := range spec.GetTools() {
		if tool == nil || tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION || tool.GetProviderToolId() != "" || tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil {
			return deepseekUnsupported()
		}
		if !deepseekFunctionName(tool.GetName()) || declared[tool.GetName()] {
			return deepseekJSONInputError("invalid tool declaration")
		}
		declared[tool.GetName()] = true
		schema := map[string]any{"type": "object", "properties": map[string]any{}}
		if tool.GetInputSchema() != nil {
			schema = tool.GetInputSchema().AsMap()
		}
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return deepseekJSONInputError("unsupported tool schema")
		}
		tools = append(tools, map[string]any{"type": "function", "function": map[string]any{"name": tool.GetName(), "description": tool.GetDescription(), "parameters": schema}})
	}
	body["tools"] = tools
	if spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL && spec.GetToolChoiceName() != "" {
		return deepseekJSONInputError("unexpected tool choice name")
	}
	switch spec.GetToolChoice() {
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO:
		body["tool_choice"] = "auto"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
		body["tool_choice"] = "none"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
		body["tool_choice"] = "required"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
		if !declared[spec.GetToolChoiceName()] {
			return deepseekJSONInputError("undeclared named tool")
		}
		body["tool_choice"] = map[string]any{"type": "function", "function": map[string]string{"name": spec.GetToolChoiceName()}}
	default:
		return deepseekUnsupported()
	}
	return nil
}

type deepseekToolFragment struct {
	Index    *int    `json:"index"`
	ID       *string `json:"id"`
	Type     *string `json:"type"`
	Function *struct {
		Name      *string `json:"name"`
		Arguments *string `json:"arguments"`
	} `json:"function"`
}

func deepseekCalls(raw json.RawMessage) ([]deepseekToolFragment, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var calls []deepseekToolFragment
	if err := json.Unmarshal(raw, &calls); err != nil {
		return nil, deepseekToolInvalid()
	}
	return calls, nil
}
func deepseekToolFinish(reason *string, hasCalls bool, spec *runtimev1.TextGenerateScenarioSpec) (runtimev1.FinishReason, error) {
	if reason == nil {
		return 0, deepseekJSONOutputError()
	}
	if *reason == "length" {
		return 0, deepseekIncomplete()
	}
	if *reason == "content_filter" {
		return 0, deepseekRefused()
	}
	if (*reason == "tool_calls") != hasCalls || (*reason != "stop" && *reason != "tool_calls") {
		return 0, deepseekJSONOutputError()
	}
	if !hasCalls && (spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED || spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL) {
		return 0, deepseekToolInvalid()
	}
	if hasCalls {
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL, nil
	}
	return runtimev1.FinishReason_FINISH_REASON_STOP, nil
}
func deepseekValidateCallChoice(spec *runtimev1.TextGenerateScenarioSpec, name string) error {
	if spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE || (spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL && name != spec.GetToolChoiceName()) {
		return deepseekToolInvalid()
	}
	return nil
}
func deepseekMessageContent(m *deepseekJSONMessage) (string, error) {
	if m == nil {
		return "", deepseekJSONOutputError()
	}
	if m.Refusal != nil && *m.Refusal != "" {
		return "", deepseekRefused()
	}
	if m.ReasoningContent != nil && *m.ReasoningContent != "" {
		return "", deepseekJSONOutputError()
	}
	if m.Content != nil {
		return *m.Content, nil
	}
	return "", nil
}

func parseDeepseekToolResponse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if len(value.Choices) != 1 || (value.Choices[0].Index == nil || *value.Choices[0].Index != 0) {
		return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
	}
	choice := value.Choices[0]
	text, err := deepseekMessageContent(choice.Message)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	calls, err := deepseekCalls(choice.Message.ToolCalls)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	finish, err := deepseekToolFinish(choice.FinishReason, len(calls) > 0, spec)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	ordered := textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)
	var index uint32
	if text != "" {
		if _, err = ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: index, Kind: textbehavior.OrderedItemText, Text: text, Complete: true}); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
		index++
	}
	for _, call := range calls {
		if call.ID == nil || !deepseekCallID(*call.ID) || call.Type == nil || *call.Type != "function" || call.Function == nil || call.Function.Name == nil || !deepseekFunctionName(*call.Function.Name) || call.Function.Arguments == nil {
			return textbehavior.NormalizedResult{}, deepseekToolInvalid()
		}
		if err = deepseekValidateCallChoice(spec, *call.Function.Name); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
		if _, err = ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: index, Kind: textbehavior.OrderedItemToolCall, Complete: true, ToolCall: &textbehavior.ToolCallFragment{IDPart: *call.ID, NamePart: *call.Function.Name, ArgumentsJSONPart: *call.Function.Arguments}}); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
		index++
	}
	items, err := ordered.FinishItems()
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: deepseekJSONUsage(value)}, err
}

type deepseekStreamCall struct {
	index    uint32
	id, name string
}
type deepseekToolStream struct {
	spec                      *runtimev1.TextGenerateScenarioSpec
	ordered                   *textbehavior.OrderedStreamAssembler
	textOpen                  bool
	nextIndex                 uint32
	calls                     []deepseekStreamCall
	finished, done, usageTail bool
	finish                    runtimev1.FinishReason
	usage                     *runtimev1.UsageStats
}

func newDeepseekToolStream(spec *runtimev1.TextGenerateScenarioSpec) *deepseekToolStream {
	cloned := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	return &deepseekToolStream{spec: cloned, ordered: textbehavior.NewOrderedStreamAssembler(cloned.GetTools(), textbehavior.ValidateToolArguments)}
}
func (s *deepseekToolStream) sealText() ([]textbehavior.OrderedDelta, error) {
	if !s.textOpen {
		return nil, nil
	}
	s.textOpen = false
	return s.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: 0, Kind: textbehavior.OrderedItemText, Complete: true})
}
func (s *deepseekToolStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if s.done {
		return nil, deepseekJSONOutputError()
	}
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		if !s.finished {
			return nil, deepseekIncomplete()
		}
		s.done = true
		return nil, nil
	}
	value, err := decodeDeepseekJSONEnvelope(payload)
	if err != nil {
		return nil, err
	}
	if s.finished {
		if len(value.Choices) != 0 || value.Usage == nil || s.usageTail {
			return nil, deepseekJSONOutputError()
		}
		s.usageTail = true
		s.usage = deepseekJSONUsage(value)
		return nil, nil
	}
	if len(value.Choices) != 1 || (value.Choices[0].Index == nil || *value.Choices[0].Index != 0) {
		return nil, deepseekJSONOutputError()
	}
	if value.Usage != nil {
		s.usage = deepseekJSONUsage(value)
	}
	choice := value.Choices[0]
	var deltas []textbehavior.OrderedDelta
	if choice.Delta != nil {
		content, err := deepseekMessageContent(choice.Delta)
		if err != nil {
			return nil, err
		}
		if content != "" {
			if len(s.calls) > 0 {
				return nil, deepseekJSONOutputError()
			}
			if !s.textOpen {
				s.textOpen = true
				s.nextIndex++
			}
			more, err := s.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: 0, Kind: textbehavior.OrderedItemText, Text: content})
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, more...)
		}
		calls, err := deepseekCalls(choice.Delta.ToolCalls)
		if err != nil {
			return nil, err
		}
		if len(calls) > 0 {
			more, err := s.sealText()
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, more...)
		}
		for _, call := range calls {
			if call.Index == nil || *call.Index < 0 || *call.Index > len(s.calls) || call.Function == nil || (call.Type != nil && *call.Type != "function") {
				return nil, deepseekToolInvalid()
			}
			fresh := *call.Index == len(s.calls)
			fragment := &textbehavior.ToolCallFragment{}
			if fresh {
				if call.ID == nil || !deepseekCallID(*call.ID) || call.Function.Name == nil || !deepseekFunctionName(*call.Function.Name) || call.Type == nil {
					return nil, deepseekToolInvalid()
				}
				if err := deepseekValidateCallChoice(s.spec, *call.Function.Name); err != nil {
					return nil, err
				}
				s.calls = append(s.calls, deepseekStreamCall{index: s.nextIndex, id: *call.ID, name: *call.Function.Name})
				s.nextIndex++
				fragment.IDPart = *call.ID
				fragment.NamePart = *call.Function.Name
			}
			state := s.calls[*call.Index]
			if (call.ID != nil && *call.ID != "" && *call.ID != state.id) || (call.Function.Name != nil && *call.Function.Name != "" && *call.Function.Name != state.name) {
				return nil, deepseekToolInvalid()
			}
			if call.Function.Arguments != nil {
				fragment.ArgumentsJSONPart = *call.Function.Arguments
			}
			more, err := s.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: state.index, Kind: textbehavior.OrderedItemToolCall, ToolCall: fragment})
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, more...)
		}
	} else if choice.FinishReason == nil {
		return nil, deepseekJSONOutputError()
	}
	if choice.FinishReason != nil {
		s.finish, err = deepseekToolFinish(choice.FinishReason, len(s.calls) > 0, s.spec)
		if err != nil {
			return nil, err
		}
		more, err := s.sealText()
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, more...)
		for _, call := range s.calls {
			more, err := s.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: call.index, Kind: textbehavior.OrderedItemToolCall, Complete: true, ToolCall: &textbehavior.ToolCallFragment{}})
			if err != nil {
				return nil, err
			}
			deltas = append(deltas, more...)
		}
		if _, err = s.ordered.FinishItems(); err != nil {
			return nil, err
		}
		s.finished = true
	}
	return deltas, nil
}
func (s *deepseekToolStream) Finish() (textbehavior.NormalizedResult, error) {
	if !s.finished || !s.done {
		return textbehavior.NormalizedResult{}, deepseekIncomplete()
	}
	items, err := s.ordered.FinishItems()
	return textbehavior.NormalizedResult{Items: items, FinishReason: s.finish, Usage: s.usage}, err
}
func deepseekUnsupported() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
}
func deepseekToolInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}
func deepseekIncomplete() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
}
func deepseekRefused() error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
}

func deepseekFunctionName(name string) bool {
	if len(name) == 0 || len(name) > 64 {
		return false
	}
	for _, c := range name {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}
func deepseekCallID(id string) bool {
	if id == "" || strings.TrimSpace(id) != id {
		return false
	}
	for _, c := range id {
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}
