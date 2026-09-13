package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-sonnet46-text-behaviors
func AnthropicTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("missing text request")
	}
	if spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("raw provider chunks")
	}
	if spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || spec.Temperature != nil && spec.TopP != nil {
		return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("sampling controls")
	}
	messages := make([]map[string]any, 0, len(spec.GetInput()))
	system := []string{}
	if spec.GetSystemPrompt() != "" {
		system = append(system, spec.GetSystemPrompt())
	}
	appendBlock := func(role string, block map[string]any) {
		if len(messages) == 0 || messages[len(messages)-1]["role"] != role {
			messages = append(messages, map[string]any{"role": role, "content": []map[string]any{}})
		}
		last := messages[len(messages)-1]
		last["content"] = append(last["content"].([]map[string]any), block)
	}
	for _, message := range spec.GetInput() {
		if message == nil {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("nil message")
		}
		role := message.GetRole()
		if len(message.GetTurnItems()) > 0 {
			for _, item := range message.GetTurnItems() {
				if result := item.GetToolResult(); result != nil {
					value, err := json.Marshal(result.GetResult().AsInterface())
					if err != nil {
						return textbehavior.SerializedRequest{}, anthropicBehaviorInput("tool result JSON")
					}
					appendBlock("user", map[string]any{"type": "tool_result", "tool_use_id": result.GetToolCallId(), "content": string(value), "is_error": result.GetIsError()})
				} else if text := item.GetOutput().GetText(); text != nil {
					appendBlock("assistant", map[string]any{"type": "text", "text": text.GetText()})
				} else if call := item.GetOutput().GetToolCall(); call != nil {
					var args map[string]json.RawMessage
					if json.Unmarshal([]byte(call.GetArgumentsJson()), &args) != nil || args == nil {
						return textbehavior.SerializedRequest{}, anthropicBehaviorInput("tool arguments JSON")
					}
					appendBlock("assistant", map[string]any{"type": "tool_use", "id": call.GetId(), "name": call.GetName(), "input": args})
				} else {
					return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("ordered content kind")
				}
			}
			continue
		}
		if message.GetContent() != "" && len(message.GetParts()) > 0 {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("conflicting text representations")
		}
		text := message.GetContent()
		if len(message.GetParts()) > 0 {
			var content strings.Builder
			for _, part := range message.GetParts() {
				if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
					return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("non-text content")
				}
				content.WriteString(part.GetText())
			}
			text = content.String()
		}
		if role == "system" {
			system = append(system, text)
			continue
		}
		if role != "user" && role != "assistant" {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("message role")
		}
		appendBlock(role, map[string]any{"type": "text", "text": text})
	}
	if len(messages) == 0 {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("empty messages")
	}
	maxTokens := spec.GetMaxTokens()
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	body := map[string]any{"messages": messages, "max_tokens": maxTokens, "stream": stream}
	if len(system) > 0 {
		body["system"] = strings.Join(system, "\n\n")
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if spec.TopK != nil {
		body["top_k"] = spec.GetTopK()
	}
	if len(spec.GetStop()) > 0 {
		body["stop_sequences"] = spec.GetStop()
	}
	if len(spec.GetTools()) > 0 {
		tools := make([]map[string]any, 0, len(spec.GetTools()))
		for _, tool := range spec.GetTools() {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION {
				return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("provider tool")
			}
			schema := tool.GetInputSchema().AsMap()
			if len(schema) == 0 {
				schema = map[string]any{"type": "object"}
			}
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return textbehavior.SerializedRequest{}, anthropicBehaviorInput("tool schema")
			}
			tools = append(tools, map[string]any{"name": tool.GetName(), "description": tool.GetDescription(), "input_schema": schema})
		}
		body["tools"] = tools
		choice := map[string]any{"type": "auto"}
		switch spec.GetToolChoice() {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
			choice["type"] = "none"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			choice["type"] = "any"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			choice["type"], choice["name"] = "tool", spec.GetToolChoiceName()
		}
		body["tool_choice"] = choice
	}
	if format := spec.GetResponseFormat(); format != nil && format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT && format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED {
		if format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
			return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("response format")
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("response schema")
		}
		if err := validateAnthropicStructuredSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		body["output_config"] = map[string]any{"format": map[string]any{"type": "json_schema", "schema": schema}}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("request JSON")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

// This first slice accepts Vane's inline object/array/scalar schemas. Unsupported
// constraints are rejected, never erased to make the provider accept a request.
func validateAnthropicStructuredSchema(schema map[string]any) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "required", "default":
		case "enum":
			values, ok := value.([]any)
			if !ok {
				return anthropicBehaviorInput("schema enum")
			}
			for _, item := range values {
				switch item.(type) {
				case map[string]any, []any:
					return anthropicBehaviorUnsupported("complex enum")
				}
			}
		case "const":
			switch value.(type) {
			case map[string]any, []any:
				return anthropicBehaviorUnsupported("complex const")
			}
		case "additionalProperties":
			if value != false {
				return anthropicBehaviorUnsupported("additionalProperties")
			}
		case "properties":
			properties, ok := value.(map[string]any)
			if !ok {
				return anthropicBehaviorInput("schema properties")
			}
			for _, property := range properties {
				child, ok := property.(map[string]any)
				if !ok {
					return anthropicBehaviorInput("schema property")
				}
				if err := validateAnthropicStructuredSchema(child); err != nil {
					return err
				}
			}
		case "items":
			child, ok := value.(map[string]any)
			if !ok {
				return anthropicBehaviorUnsupported("tuple items")
			}
			if err := validateAnthropicStructuredSchema(child); err != nil {
				return err
			}
		case "anyOf":
			children, ok := value.([]any)
			if !ok {
				return anthropicBehaviorInput("anyOf")
			}
			for _, item := range children {
				child, ok := item.(map[string]any)
				if !ok {
					return anthropicBehaviorInput("anyOf schema")
				}
				if err := validateAnthropicStructuredSchema(child); err != nil {
					return err
				}
			}
		default:
			return anthropicBehaviorUnsupported("JSON Schema keyword " + key)
		}
	}
	if schema["type"] == "object" && schema["additionalProperties"] != false {
		return anthropicBehaviorUnsupported("open object schema")
	}
	return nil
}

type anthropicBehaviorBlock struct {
	Type  string          `json:"type"`
	Text  string          `json:"text"`
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}
type anthropicBehaviorUsage struct {
	Input  int64 `json:"input_tokens"`
	Output int64 `json:"output_tokens"`
}
type anthropicBehaviorMessage struct {
	Content []anthropicBehaviorBlock `json:"content"`
	Stop    string                   `json:"stop_reason"`
	Usage   anthropicBehaviorUsage   `json:"usage"`
}

func AnthropicTextBehaviorNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var message anthropicBehaviorMessage
	if json.Unmarshal(payload, &message) != nil {
		return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("response JSON")
	}
	assembler := textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)
	for index, block := range message.Content {
		fragment := textbehavior.PrivateFragment{ItemIndex: uint32(index), Complete: true}
		switch block.Type {
		case "text":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, block.Text
		case "tool_use":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: block.ID, NamePart: block.Name, ArgumentsJSONPart: string(block.Input)}
		default:
			return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("content block kind")
		}
		if _, err := assembler.AppendFragment(fragment); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
	}
	return finishAnthropicBehavior(assembler, message.Stop, message.Usage, spec)
}

type anthropicBehaviorStream struct {
	spec       *runtimev1.TextGenerateScenarioSpec
	assembler  *textbehavior.OrderedStreamAssembler
	blocks     map[uint32]anthropicBehaviorBlock
	arguments  map[uint32]bool
	started    bool
	stopped    bool
	stopReason string
	usage      anthropicBehaviorUsage
}

func AnthropicTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &anthropicBehaviorStream{spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments), blocks: map[uint32]anthropicBehaviorBlock{}, arguments: map[uint32]bool{}}, nil
}

func (stream *anthropicBehaviorStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	var event struct {
		Type    string                   `json:"type"`
		Index   uint32                   `json:"index"`
		Message anthropicBehaviorMessage `json:"message"`
		Block   anthropicBehaviorBlock   `json:"content_block"`
		Delta   struct {
			Type string `json:"type"`
			Text string `json:"text"`
			JSON string `json:"partial_json"`
			Stop string `json:"stop_reason"`
		} `json:"delta"`
		Usage anthropicBehaviorUsage `json:"usage"`
	}
	if json.Unmarshal(payload, &event) != nil || stream.stopped {
		return nil, anthropicBehaviorOutput("stream event")
	}
	if event.Type == "ping" {
		return nil, nil
	}
	if event.Type == "error" {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if event.Type == "message_start" {
		if stream.started || len(event.Message.Content) != 0 {
			return nil, anthropicBehaviorOutput("message start")
		}
		stream.started, stream.usage = true, event.Message.Usage
		return nil, nil
	}
	if !stream.started {
		return nil, anthropicBehaviorOutput("event before message start")
	}
	fragment := textbehavior.PrivateFragment{ItemIndex: event.Index}
	switch event.Type {
	case "content_block_start":
		if _, exists := stream.blocks[event.Index]; exists {
			return nil, anthropicBehaviorOutput("duplicate content block")
		}
		stream.blocks[event.Index] = event.Block
		switch event.Block.Type {
		case "text":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, event.Block.Text
		case "tool_use":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: event.Block.ID, NamePart: event.Block.Name}
		default:
			return nil, anthropicBehaviorOutput("stream content kind")
		}
	case "content_block_delta":
		block, exists := stream.blocks[event.Index]
		if !exists {
			return nil, anthropicBehaviorOutput("delta without block")
		}
		if block.Type == "text" && event.Delta.Type == "text_delta" {
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, event.Delta.Text
		} else if block.Type == "tool_use" && event.Delta.Type == "input_json_delta" {
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{ArgumentsJSONPart: event.Delta.JSON}
			if event.Delta.JSON != "" {
				stream.arguments[event.Index] = true
			}
		} else {
			return nil, anthropicBehaviorOutput("stream delta kind")
		}
	case "content_block_stop":
		block, exists := stream.blocks[event.Index]
		if !exists {
			return nil, anthropicBehaviorOutput("stop without block")
		}
		fragment.Complete = true
		if block.Type == "text" {
			fragment.Kind = textbehavior.OrderedItemText
		} else {
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{}
			if !stream.arguments[event.Index] {
				fragment.ToolCall.ArgumentsJSONPart = string(block.Input)
			}
		}
	case "message_delta":
		if event.Delta.Stop != "" {
			stream.stopReason = event.Delta.Stop
		}
		stream.usage.Output = event.Usage.Output
		return nil, nil
	case "message_stop":
		if stream.stopReason == "" {
			return nil, anthropicBehaviorOutput("missing stop reason")
		}
		stream.stopped = true
		return nil, nil
	default:
		return nil, anthropicBehaviorOutput("unknown stream event")
	}
	return stream.assembler.AppendFragment(fragment)
}

func (stream *anthropicBehaviorStream) Finish() (textbehavior.NormalizedResult, error) {
	if !stream.stopped {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	return finishAnthropicBehavior(stream.assembler, stream.stopReason, stream.usage, stream.spec)
}

func finishAnthropicBehavior(assembler *textbehavior.OrderedStreamAssembler, stop string, usage anthropicBehaviorUsage, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var finish runtimev1.FinishReason
	switch stop {
	case "end_turn", "stop_sequence":
		finish = runtimev1.FinishReason_FINISH_REASON_STOP
	case "tool_use":
		finish = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
	case "max_tokens":
		finish = runtimev1.FinishReason_FINISH_REASON_LENGTH
	case "refusal":
		finish = runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER
	default:
		return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("stop reason")
	}
	items, err := assembler.FinishItems()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
			return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
		}
		var text strings.Builder
		for _, item := range items {
			if item.Kind != textbehavior.OrderedItemText {
				return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("non-text structured output")
			}
			text.WriteString(item.Text)
		}
		var instance any
		if json.Unmarshal([]byte(text.String()), &instance) != nil {
			return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("invalid structured JSON")
		}
		schema, err := textbehavior.CompileJSONSchema(spec.GetResponseFormat().GetJsonSchema().AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("structured schema mismatch")
		}
	}
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: &runtimev1.UsageStats{InputTokens: usage.Input, OutputTokens: usage.Output}}, nil
}

func anthropicBehaviorInput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, fmt.Errorf("Anthropic text input: %s", detail), grpcerr.ReasonOptions{})
}
func anthropicBehaviorUnsupported(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, fmt.Errorf("Anthropic text behavior: %s", detail), grpcerr.ReasonOptions{})
}
func anthropicBehaviorOutput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("Anthropic text output: %s", detail), grpcerr.ReasonOptions{})
}
