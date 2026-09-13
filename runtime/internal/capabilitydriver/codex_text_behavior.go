package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const codexContinuityKind = "openai_codex.responses.encrypted-reasoning"

// @nimi-authority: rule.nimi.runtime.ai-provider.codex-text-behaviors
func CodexTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, codexInput("missing request")
	}
	if spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, codexUnsupported("raw provider chunks")
	}
	// The subscription endpoint does not admit these generation controls.
	if spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.MaxTokens != nil || spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || len(spec.Stop) > 0 {
		return textbehavior.SerializedRequest{}, codexUnsupported("generation controls")
	}
	if reasoning := spec.Reasoning; reasoning != nil && (reasoning.Intensity != nil ||
		reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED ||
		reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN) {
		return textbehavior.SerializedRequest{}, codexUnsupported("reasoning controls")
	}
	input := make([]any, 0, len(spec.Input))
	instructions := []string{}
	if spec.SystemPrompt != "" {
		instructions = append(instructions, spec.SystemPrompt)
	}
	for _, message := range spec.Input {
		if message == nil {
			return textbehavior.SerializedRequest{}, codexInput("nil message")
		}
		if len(message.TurnItems) > 0 {
			for _, item := range message.TurnItems {
				switch {
				case item.GetToolResult() != nil:
					result := item.GetToolResult()
					output := result.GetResult().AsInterface()
					if result.IsError {
						output = map[string]any{"isError": true, "result": output}
					}
					value, err := json.Marshal(output)
					if err != nil {
						return textbehavior.SerializedRequest{}, codexInput("tool result JSON")
					}
					input = append(input, map[string]any{"type": "function_call_output", "call_id": result.ToolCallId, "output": string(value)})
				case item.GetOutput().GetText() != nil:
					input = append(input, map[string]any{"role": "assistant", "content": item.GetOutput().GetText().Text})
				case item.GetOutput().GetToolCall() != nil:
					call := item.GetOutput().GetToolCall()
					input = append(input, map[string]any{"type": "function_call", "call_id": call.Id, "name": call.Name, "arguments": call.ArgumentsJson})
				case item.GetOutput().GetReasoningContinuity() != nil:
					carrier := item.GetOutput().GetReasoningContinuity()
					if !textbehavior.ValidContinuity(carrier) || carrier.Kind != codexContinuityKind || carrier.Version != 1 {
						return textbehavior.SerializedRequest{}, codexInput("continuity identity")
					}
					var reasoning codexEncryptedReasoning
					decoder := json.NewDecoder(bytes.NewReader(carrier.Payload))
					decoder.DisallowUnknownFields()
					if decoder.Decode(&reasoning) != nil || decoder.Decode(new(any)) != io.EOF || !reasoning.valid() {
						return textbehavior.SerializedRequest{}, codexInput("continuity payload")
					}
					input = append(input, reasoning)
				default:
					return textbehavior.SerializedRequest{}, codexUnsupported("ordered content kind")
				}
			}
			continue
		}
		if message.Content != "" && len(message.Parts) > 0 {
			return textbehavior.SerializedRequest{}, codexInput("conflicting text representations")
		}
		var text strings.Builder
		text.WriteString(message.Content)
		for _, part := range message.Parts {
			if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				return textbehavior.SerializedRequest{}, codexUnsupported("non-text input")
			}
			text.WriteString(part.GetText())
		}
		if message.Role == "system" {
			instructions = append(instructions, text.String())
			continue
		}
		if message.Role != "user" && message.Role != "assistant" {
			return textbehavior.SerializedRequest{}, codexInput("message role")
		}
		input = append(input, map[string]any{"role": message.Role, "content": text.String()})
	}
	if len(input) == 0 {
		return textbehavior.SerializedRequest{}, codexInput("empty input")
	}
	if len(instructions) == 0 {
		instructions = append(instructions, "You are helpful, knowledgeable, and direct.")
	}
	body := map[string]any{"input": input, "instructions": strings.Join(instructions, "\n\n"), "store": false, "stream": true, "include": []string{"reasoning.encrypted_content"}}
	if len(spec.Tools) > 0 {
		tools := make([]any, 0, len(spec.Tools))
		for _, tool := range spec.Tools {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION {
				return textbehavior.SerializedRequest{}, codexUnsupported("provider tool")
			}
			schema := tool.GetInputSchema().AsMap()
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return textbehavior.SerializedRequest{}, codexInput("tool schema")
			}
			// Preserve the caller's schema, including optional fields. Runtime
			// still validates every completed call before exposing it.
			tools = append(tools, map[string]any{"type": "function", "name": tool.Name, "description": tool.Description, "parameters": schema, "strict": false})
		}
		body["tools"], body["parallel_tool_calls"] = tools, true
		choice := any("auto")
		switch spec.ToolChoice {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
			choice = "none"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			choice = "required"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			choice = map[string]any{"type": "function", "name": spec.ToolChoiceName}
		}
		body["tool_choice"] = choice
	}
	if format := spec.ResponseFormat; format != nil && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		if len(spec.Tools) > 0 || format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
			return textbehavior.SerializedRequest{}, codexUnsupported("response format combination")
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, codexInput("response schema")
		}
		if schema["type"] != "object" || schema["anyOf"] != nil {
			return textbehavior.SerializedRequest{}, codexUnsupported("structured root")
		}
		if err := validateCodexStructuredSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		name := format.SchemaName
		if name == "" {
			name = "response"
		}
		body["text"] = map[string]any{"format": map[string]any{"type": "json_schema", "name": name, "description": format.SchemaDescription, "schema": schema, "strict": true}}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, codexInput("request JSON")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

func validateCodexStructuredSchema(schema map[string]any) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "enum", "required", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "$ref":
		case "additionalProperties":
			if value != false {
				return codexUnsupported("open structured object")
			}
		case "properties", "$defs":
			children, ok := value.(map[string]any)
			if !ok {
				return codexInput("schema object")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return codexInput("schema child")
				}
				if err := validateCodexStructuredSchema(node); err != nil {
					return err
				}
			}
		case "items":
			child, ok := value.(map[string]any)
			if !ok {
				return codexUnsupported("tuple schema")
			}
			if err := validateCodexStructuredSchema(child); err != nil {
				return err
			}
		case "anyOf":
			children, ok := value.([]any)
			if !ok {
				return codexInput("schema alternatives")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return codexInput("schema alternative")
				}
				if err := validateCodexStructuredSchema(node); err != nil {
					return err
				}
			}
		default:
			return codexUnsupported("JSON Schema keyword " + key)
		}
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		required, _ := schema["required"].([]any)
		fields := map[string]bool{}
		for _, name := range required {
			if key, ok := name.(string); ok {
				fields[key] = true
			}
		}
		if schema["additionalProperties"] != false || len(fields) != len(properties) {
			return codexUnsupported("optional structured property")
		}
		for name := range properties {
			if !fields[name] {
				return codexUnsupported("optional structured property")
			}
		}
	}
	return nil
}

// Only encrypted continuity and the identity needed by Responses are retained.
// Raw reasoning and reasoning summaries never enter a public output item.
type codexEncryptedReasoning struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Encrypted string `json:"encrypted_content"`
	Summary   []any  `json:"summary"`
}

func (value codexEncryptedReasoning) valid() bool {
	return value.Type == "reasoning" && value.ID != "" && value.Encrypted != "" && value.Summary != nil && len(value.Summary) == 0
}

type codexBehaviorItem struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	CallID    string `json:"call_id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Encrypted string `json:"encrypted_content"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}
type codexBehaviorResponse struct {
	Status string              `json:"status"`
	Output []codexBehaviorItem `json:"output"`
	Usage  struct {
		Input  int64 `json:"input_tokens"`
		Output int64 `json:"output_tokens"`
	} `json:"usage"`
}
type codexBehaviorBlock struct {
	item            codexBehaviorItem
	text, arguments strings.Builder
	emitted         int
	done            bool
}
type codexBehaviorStream struct {
	spec      *runtimev1.TextGenerateScenarioSpec
	assembler *textbehavior.OrderedStreamAssembler
	blocks    []*codexBehaviorBlock
	next      uint32
	completed bool
	response  codexBehaviorResponse
}

func CodexTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &codexBehaviorStream{spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)}, nil
}

func (stream *codexBehaviorStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if string(payload) == "[DONE]" && stream.completed {
		return nil, nil
	}
	var event struct {
		Type      string                `json:"type"`
		Index     uint32                `json:"output_index"`
		ItemID    string                `json:"item_id"`
		Delta     string                `json:"delta"`
		Arguments string                `json:"arguments"`
		Item      codexBehaviorItem     `json:"item"`
		Response  codexBehaviorResponse `json:"response"`
	}
	if json.Unmarshal(payload, &event) != nil || stream.completed {
		return nil, codexOutput("stream event")
	}
	switch event.Type {
	case "response.created", "response.in_progress":
		return nil, nil
	case "error", "response.failed":
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	case "response.incomplete":
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	case "response.completed":
		// The subscription endpoint omits already-streamed items from the
		// terminal response. Completion seals the items collected above.
		if event.Response.Status != "completed" || int(stream.next) != len(stream.blocks) {
			return nil, codexOutput(fmt.Sprintf("response completion: status=%q complete=%d items=%d terminalItems=%d", event.Response.Status, stream.next, len(stream.blocks), len(event.Response.Output)))
		}
		stream.completed, stream.response = true, event.Response
		return nil, nil
	case "response.output_item.added":
		if int(event.Index) != len(stream.blocks) || event.Item.ID == "" {
			return nil, codexOutput("output item association")
		}
		if event.Item.Type != "message" && event.Item.Type != "function_call" && event.Item.Type != "reasoning" {
			return nil, codexOutput("output item kind")
		}
		stream.blocks = append(stream.blocks, &codexBehaviorBlock{item: event.Item})
		return nil, nil
	}
	if int(event.Index) >= len(stream.blocks) {
		return nil, codexOutput("event without output item")
	}
	block := stream.blocks[event.Index]
	if block.done || event.ItemID != "" && event.ItemID != block.item.ID {
		return nil, codexOutput("output item association")
	}
	switch event.Type {
	case "response.output_text.delta":
		if block.item.Type != "message" {
			return nil, codexOutput("text delta kind")
		}
		block.text.WriteString(event.Delta)
	case "response.function_call_arguments.delta":
		if block.item.Type != "function_call" {
			return nil, codexOutput("arguments delta kind")
		}
		block.arguments.WriteString(event.Delta)
	case "response.function_call_arguments.done":
		if block.item.Type != "function_call" || block.arguments.Len() > 0 && block.arguments.String() != event.Arguments {
			return nil, codexOutput("arguments completion")
		}
	case "response.output_item.done":
		if event.Item.ID != block.item.ID || event.Item.Type != block.item.Type {
			return nil, codexOutput("item completion association")
		}
		if event.Item.Type == "function_call" && (event.Item.CallID != block.item.CallID || event.Item.Name != block.item.Name || block.arguments.Len() > 0 && block.arguments.String() != event.Item.Arguments) {
			return nil, codexOutput("complete call association")
		}
		if event.Item.Type == "message" {
			var text strings.Builder
			for _, part := range event.Item.Content {
				if part.Type != "output_text" {
					return nil, codexOutput("message content")
				}
				text.WriteString(part.Text)
			}
			if block.text.Len() > 0 && block.text.String() != text.String() {
				return nil, codexOutput("text completion")
			}
			if block.text.Len() == 0 {
				block.text.WriteString(text.String())
			}
		}
		block.item, block.done = event.Item, true
	case "response.content_part.added", "response.content_part.done", "response.output_text.done",
		"response.reasoning_summary_part.added", "response.reasoning_summary_part.done", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.done":
		return nil, nil
	default:
		return nil, codexOutput("unsupported stream event " + event.Type)
	}
	if block.text.Len()+block.arguments.Len() > 256*1024 {
		return nil, codexOutput("output size")
	}
	return stream.flush()
}

// Responses can interleave argument fragments. Expose complete calls in output
// order; text at the current output index can still stream incrementally.
func (stream *codexBehaviorStream) flush() ([]textbehavior.OrderedDelta, error) {
	var deltas []textbehavior.OrderedDelta
	for int(stream.next) < len(stream.blocks) {
		block := stream.blocks[stream.next]
		fragment := textbehavior.PrivateFragment{ItemIndex: stream.next, Complete: block.done}
		switch block.item.Type {
		case "message":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, block.text.String()[block.emitted:]
			if fragment.Text == "" && !block.done {
				return deltas, nil
			}
			block.emitted = block.text.Len()
		case "function_call":
			if !block.done {
				return deltas, nil
			}
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{IDPart: block.item.CallID, NamePart: block.item.Name, ArgumentsJSONPart: block.item.Arguments}
		case "reasoning":
			if !block.done {
				return deltas, nil
			}
			reasoning := codexEncryptedReasoning{Type: "reasoning", ID: block.item.ID, Encrypted: block.item.Encrypted, Summary: []any{}}
			if !reasoning.valid() {
				return nil, codexOutput("missing encrypted continuity")
			}
			payload, err := json.Marshal(reasoning)
			if err != nil {
				return nil, codexOutput("continuity JSON")
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, &runtimev1.ReasoningContinuityCarrier{Kind: codexContinuityKind, Version: 1, Payload: payload}
		}
		items, err := stream.assembler.AppendFragment(fragment)
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, items...)
		if !block.done {
			return deltas, nil
		}
		stream.next++
	}
	return deltas, nil
}

func (stream *codexBehaviorStream) Finish() (textbehavior.NormalizedResult, error) {
	if !stream.completed {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE)
	}
	items, err := stream.assembler.FinishItems()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	finish := runtimev1.FinishReason_FINISH_REASON_STOP
	var text strings.Builder
	for _, item := range items {
		if item.Kind == textbehavior.OrderedItemToolCall {
			finish = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
		}
		if item.Kind == textbehavior.OrderedItemText {
			text.WriteString(item.Text)
		}
	}
	if stream.spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		var instance any
		decoder := json.NewDecoder(strings.NewReader(text.String()))
		decoder.UseNumber()
		if finish != runtimev1.FinishReason_FINISH_REASON_STOP || decoder.Decode(&instance) != nil || decoder.Decode(new(any)) != io.EOF {
			return textbehavior.NormalizedResult{}, codexOutput("structured JSON")
		}
		schema, err := textbehavior.CompileJSONSchema(stream.spec.ResponseFormat.JsonSchema.AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return textbehavior.NormalizedResult{}, codexOutput("structured schema mismatch")
		}
	}
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: &runtimev1.UsageStats{InputTokens: stream.response.Usage.Input, OutputTokens: stream.response.Usage.Output}}, nil
}

// Normalizes a completed Responses object for the hook contract. The Codex
// subscription transport always uses the SSE assembler, including sync calls.
func CodexTextBehaviorNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	var response codexBehaviorResponse
	if json.Unmarshal(payload, &response) != nil || response.Status != "completed" {
		return textbehavior.NormalizedResult{}, codexOutput("response JSON")
	}
	stream := &codexBehaviorStream{spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments), response: response}
	for _, item := range response.Output {
		block := &codexBehaviorBlock{item: item, done: true}
		if item.Type != "message" && item.Type != "function_call" && item.Type != "reasoning" {
			return textbehavior.NormalizedResult{}, codexOutput("output kind")
		}
		for _, part := range item.Content {
			if part.Type != "output_text" {
				return textbehavior.NormalizedResult{}, codexOutput("message content")
			}
			block.text.WriteString(part.Text)
		}
		stream.blocks = append(stream.blocks, block)
	}
	if _, err := stream.flush(); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	stream.completed = true
	return stream.Finish()
}

func codexInput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, fmt.Errorf("Codex text input: %s", detail), grpcerr.ReasonOptions{})
}
func codexUnsupported(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, fmt.Errorf("Codex text behavior: %s", detail), grpcerr.ReasonOptions{})
}
func codexOutput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("Codex text output: %s", detail), grpcerr.ReasonOptions{})
}
