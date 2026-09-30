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

const responsesItemTextLimit = 256 * 1024

// responsesProfile fixes what one public Responses route admits. Request
// serialization, transcript replay and the SSE assembler are otherwise shared,
// and every route sends a stateless store-false request streamed over SSE.
type responsesProfile struct {
	// label names the route in typed error details.
	label string
	// continuityKind identifies this route's encrypted reasoning carriers; a
	// carrier from another route is never replayed here.
	continuityKind string
	// toolNamespace, when set, groups function tools under one namespace
	// item and is required on every returned or replayed call.
	toolNamespace            string
	toolNamespaceDescription string
	// outputLimit admits max_output_tokens. Sampling, stop and seed controls
	// are admitted by no route.
	outputLimit       bool
	namedToolChoice   bool
	parallelToolCalls bool
	failure           func(status int, code string) error
}

func (profile *responsesProfile) inputError(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, fmt.Errorf("%s text input: %s", profile.label, detail), grpcerr.ReasonOptions{})
}

func (profile *responsesProfile) unsupported(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, fmt.Errorf("%s text behavior: %s", profile.label, detail), grpcerr.ReasonOptions{})
}

func (profile *responsesProfile) outputError(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("%s text output: %s", profile.label, detail), grpcerr.ReasonOptions{})
}

func (profile *responsesProfile) namespaceAdmitted(namespace string) bool {
	return namespace == profile.toolNamespace
}

// serializeResponsesRequest maps one exact text step to a stateless public
// Responses request with store false and SSE delivery.
func serializeResponsesRequest(profile *responsesProfile, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, profile.inputError("missing request")
	}
	if spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, profile.unsupported("raw provider chunks")
	}
	if spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || len(spec.Stop) > 0 ||
		spec.MaxTokens != nil && (!profile.outputLimit || spec.GetMaxTokens() <= 0) {
		return textbehavior.SerializedRequest{}, profile.unsupported("generation controls")
	}
	if reasoning := spec.Reasoning; reasoning != nil && (reasoning.Intensity != nil ||
		reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED ||
		reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN) {
		return textbehavior.SerializedRequest{}, profile.unsupported("reasoning controls")
	}
	input := make([]any, 0, len(spec.Input))
	instructions := []string{}
	if spec.SystemPrompt != "" {
		instructions = append(instructions, spec.SystemPrompt)
	}
	for _, message := range spec.Input {
		if message == nil {
			return textbehavior.SerializedRequest{}, profile.inputError("nil message")
		}
		if len(message.TurnItems) > 0 {
			items, err := responsesTurnItems(profile, message.TurnItems)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			input = append(input, items...)
			continue
		}
		if message.Content != "" && len(message.Parts) > 0 {
			return textbehavior.SerializedRequest{}, profile.inputError("conflicting text representations")
		}
		var text strings.Builder
		text.WriteString(message.Content)
		content := make([]map[string]any, 0, len(message.Parts))
		hasImage := false
		for _, part := range message.Parts {
			if part == nil {
				return textbehavior.SerializedRequest{}, profile.inputError("nil content part")
			}
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				if _, ok := part.GetContent().(*runtimev1.ChatContentPart_Text); !ok {
					return textbehavior.SerializedRequest{}, profile.inputError("text content part")
				}
				text.WriteString(part.GetText())
				content = append(content, map[string]any{"type": "input_text", "text": part.GetText()})
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				image := part.GetImageUrl()
				if message.Role != "user" || image == nil || strings.TrimSpace(image.GetUrl()) == "" {
					return textbehavior.SerializedRequest{}, profile.inputError("user image content part")
				}
				item := map[string]any{"type": "input_image", "image_url": image.GetUrl()}
				if image.GetDetail() != "" {
					item["detail"] = image.GetDetail()
				}
				content = append(content, item)
				hasImage = true
			default:
				return textbehavior.SerializedRequest{}, profile.unsupported("non-text input")
			}
		}
		// System text travels only as Responses instructions.
		if message.Role == "system" {
			if hasImage {
				return textbehavior.SerializedRequest{}, profile.inputError("system image content")
			}
			instructions = append(instructions, text.String())
			continue
		}
		if message.Role != "user" && message.Role != "assistant" {
			return textbehavior.SerializedRequest{}, profile.inputError("message role")
		}
		if hasImage {
			input = append(input, map[string]any{"role": message.Role, "content": content})
		} else {
			input = append(input, map[string]any{"role": message.Role, "content": text.String()})
		}
	}
	if len(input) == 0 {
		return textbehavior.SerializedRequest{}, profile.inputError("empty input")
	}
	body := map[string]any{"input": input, "store": false, "stream": true, "include": []string{"reasoning.encrypted_content"}}
	if len(instructions) > 0 {
		body["instructions"] = strings.Join(instructions, "\n\n")
	}
	if spec.MaxTokens != nil {
		body["max_output_tokens"] = spec.GetMaxTokens()
	}
	if len(spec.Tools) > 0 {
		tools := make([]any, 0, len(spec.Tools))
		for _, tool := range spec.Tools {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION {
				return textbehavior.SerializedRequest{}, profile.unsupported("provider tool")
			}
			schema := tool.GetInputSchema().AsMap()
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return textbehavior.SerializedRequest{}, profile.inputError("tool schema")
			}
			// Preserve the caller's schema; Runtime validates every completed
			// call against it before exposing the call.
			tools = append(tools, map[string]any{"type": "function", "name": tool.Name, "description": tool.Description, "parameters": schema, "strict": false})
		}
		if profile.toolNamespace != "" {
			body["tools"] = []any{map[string]any{
				"type": "namespace", "name": profile.toolNamespace,
				"description": profile.toolNamespaceDescription,
				"tools":       tools,
			}}
		} else {
			body["tools"] = tools
		}
		body["parallel_tool_calls"] = profile.parallelToolCalls
		choice := any("auto")
		switch spec.ToolChoice {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
			choice = "none"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			choice = "required"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			if !profile.namedToolChoice {
				return textbehavior.SerializedRequest{}, profile.unsupported("named tool choice")
			}
			choice = map[string]any{"type": "function", "name": spec.ToolChoiceName}
		}
		body["tool_choice"] = choice
	}
	if format := spec.ResponseFormat; format != nil && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		if format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA || !format.Strict {
			return textbehavior.SerializedRequest{}, profile.unsupported("response format combination")
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, profile.inputError("response schema")
		}
		if schema["type"] != "object" || schema["anyOf"] != nil {
			return textbehavior.SerializedRequest{}, profile.unsupported("structured root")
		}
		if err := validateResponsesStructuredSchema(profile, schema, true); err != nil {
			return textbehavior.SerializedRequest{}, profile.unsupported("strict JSON Schema subset")
		}
		name := format.SchemaName
		if name == "" {
			name = "response"
		}
		textFormat := map[string]any{"type": "json_schema", "name": name, "schema": schema, "strict": true}
		if format.SchemaDescription != "" {
			textFormat["description"] = format.SchemaDescription
		}
		body["text"] = map[string]any{"format": textFormat}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, profile.inputError("request JSON")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

func responsesTurnItems(profile *responsesProfile, turnItems []*runtimev1.TextTurnItem) ([]any, error) {
	items := make([]any, 0, len(turnItems))
	for _, item := range turnItems {
		switch {
		case item.GetToolResult() != nil:
			result := item.GetToolResult()
			output := result.GetResult().AsInterface()
			if result.IsError {
				output = map[string]any{"isError": true, "result": output}
			}
			value, err := json.Marshal(output)
			if err != nil {
				return nil, profile.inputError("tool result JSON")
			}
			items = append(items, map[string]any{"type": "function_call_output", "call_id": result.ToolCallId, "output": string(value)})
		case item.GetOutput().GetText() != nil:
			items = append(items, map[string]any{"role": "assistant", "content": item.GetOutput().GetText().Text})
		case item.GetOutput().GetToolCall() != nil:
			call := item.GetOutput().GetToolCall()
			replayed := map[string]any{"type": "function_call", "call_id": call.Id, "name": call.Name, "arguments": call.ArgumentsJson}
			if profile.toolNamespace != "" {
				replayed["namespace"] = profile.toolNamespace
			}
			items = append(items, replayed)
		case item.GetOutput().GetReasoningContinuity() != nil:
			carrier := item.GetOutput().GetReasoningContinuity()
			if !textbehavior.ValidContinuity(carrier) || carrier.Kind != profile.continuityKind || carrier.Version != 1 {
				return nil, profile.inputError("continuity identity")
			}
			var reasoning responsesEncryptedReasoning
			decoder := json.NewDecoder(bytes.NewReader(carrier.Payload))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&reasoning) != nil || decoder.Decode(new(any)) != io.EOF || !reasoning.valid() {
				return nil, profile.inputError("continuity payload")
			}
			items = append(items, reasoning)
		default:
			return nil, profile.unsupported("ordered content kind")
		}
	}
	return items, nil
}

type responsesBehaviorItem struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	CallID    string `json:"call_id"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Arguments string `json:"arguments"`
	Encrypted string `json:"encrypted_content"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

type responsesProviderError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param"`
}

type responsesBehaviorResponse struct {
	Status            string                  `json:"status"`
	Output            []responsesBehaviorItem `json:"output"`
	Error             *responsesProviderError `json:"error"`
	IncompleteDetails *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
	Usage struct {
		Input  int64 `json:"input_tokens"`
		Output int64 `json:"output_tokens"`
	} `json:"usage"`
}

type responsesBehaviorBlock struct {
	item            responsesBehaviorItem
	text, arguments strings.Builder
	emitted         int
	done            bool
}

type responsesBehaviorStream struct {
	profile   *responsesProfile
	spec      *runtimev1.TextGenerateScenarioSpec
	assembler *textbehavior.OrderedStreamAssembler
	blocks    []*responsesBehaviorBlock
	next      uint32
	completed bool
	response  responsesBehaviorResponse
}

// newResponsesStreamAssembler parses the public Responses SSE stream. Only
// response.completed with every output item sealed succeeds.
func newResponsesStreamAssembler(profile *responsesProfile, spec *runtimev1.TextGenerateScenarioSpec) *responsesBehaviorStream {
	return &responsesBehaviorStream{profile: profile, spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)}
}

func (stream *responsesBehaviorStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	profile := stream.profile
	if string(payload) == "[DONE]" && stream.completed {
		return nil, nil
	}
	var event struct {
		Type      string                    `json:"type"`
		Index     uint32                    `json:"output_index"`
		ItemID    string                    `json:"item_id"`
		Delta     string                    `json:"delta"`
		Arguments string                    `json:"arguments"`
		Code      string                    `json:"code"`
		Item      responsesBehaviorItem     `json:"item"`
		Response  responsesBehaviorResponse `json:"response"`
	}
	if json.Unmarshal(payload, &event) != nil || stream.completed {
		return nil, profile.outputError("stream event")
	}
	switch event.Type {
	case "response.created", "response.in_progress", "response.queued":
		return nil, nil
	case "error":
		logProviderStreamErrorEvent(profile.label, event.Code)
		return nil, profile.failure(0, event.Code)
	case "response.failed":
		code := ""
		if event.Response.Error != nil {
			code = event.Response.Error.Code
		}
		logProviderStreamErrorEvent(profile.label, code)
		return nil, profile.failure(0, code)
	case "response.incomplete":
		reason := ""
		if event.Response.IncompleteDetails != nil {
			reason = event.Response.IncompleteDetails.Reason
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE,
			fmt.Errorf("%s response incomplete: %s", profile.label, reason), grpcerr.ReasonOptions{})
	case "response.completed":
		if event.Response.Status != "completed" || int(stream.next) != len(stream.blocks) {
			return nil, profile.outputError(fmt.Sprintf("response completion: status=%q complete=%d items=%d", event.Response.Status, stream.next, len(stream.blocks)))
		}
		stream.completed, stream.response = true, event.Response
		return nil, nil
	case "response.output_item.added":
		if int(event.Index) != len(stream.blocks) || event.Item.ID == "" {
			return nil, profile.outputError("output item association")
		}
		if event.Item.Type != "message" && event.Item.Type != "function_call" && event.Item.Type != "reasoning" {
			return nil, profile.outputError("output item kind " + event.Item.Type)
		}
		if event.Item.Type == "function_call" && !profile.namespaceAdmitted(event.Item.Namespace) {
			return nil, profile.outputError("function call namespace")
		}
		stream.blocks = append(stream.blocks, &responsesBehaviorBlock{item: event.Item})
		return nil, nil
	}
	if int(event.Index) >= len(stream.blocks) {
		return nil, profile.outputError("event without output item")
	}
	block := stream.blocks[event.Index]
	if block.done || event.ItemID != "" && event.ItemID != block.item.ID {
		return nil, profile.outputError("output item association")
	}
	switch event.Type {
	case "response.output_text.delta":
		if block.item.Type != "message" {
			return nil, profile.outputError("text delta kind")
		}
		block.text.WriteString(event.Delta)
	case "response.function_call_arguments.delta":
		if block.item.Type != "function_call" {
			return nil, profile.outputError("arguments delta kind")
		}
		block.arguments.WriteString(event.Delta)
	case "response.function_call_arguments.done":
		if block.item.Type != "function_call" || block.arguments.Len() > 0 && block.arguments.String() != event.Arguments {
			return nil, profile.outputError("arguments completion")
		}
	case "response.output_item.done":
		if event.Item.ID != block.item.ID || event.Item.Type != block.item.Type {
			return nil, profile.outputError("item completion association")
		}
		if event.Item.Type == "function_call" && (event.Item.CallID == "" || block.item.CallID != "" && event.Item.CallID != block.item.CallID ||
			event.Item.Name != block.item.Name || !profile.namespaceAdmitted(event.Item.Namespace) ||
			block.arguments.Len() > 0 && block.arguments.String() != event.Item.Arguments) {
			return nil, profile.outputError("complete call association")
		}
		if event.Item.Type == "message" {
			var text strings.Builder
			for _, part := range event.Item.Content {
				if part.Type != "output_text" {
					return nil, profile.outputError("message content")
				}
				text.WriteString(part.Text)
			}
			if block.text.Len() > 0 && block.text.String() != text.String() {
				return nil, profile.outputError("text completion")
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
		return nil, profile.outputError("unsupported stream event " + event.Type)
	}
	if block.text.Len()+block.arguments.Len() > responsesItemTextLimit {
		return nil, profile.outputError("output size")
	}
	return stream.flush()
}

// flush exposes complete calls in output order while text at the current
// output index can still stream incrementally.
func (stream *responsesBehaviorStream) flush() ([]textbehavior.OrderedDelta, error) {
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
			reasoning := responsesEncryptedReasoning{Type: "reasoning", ID: block.item.ID, Encrypted: block.item.Encrypted, Summary: []any{}}
			if !reasoning.valid() {
				return nil, stream.profile.outputError("missing encrypted continuity")
			}
			payload, err := json.Marshal(reasoning)
			if err != nil {
				return nil, stream.profile.outputError("continuity JSON")
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, &runtimev1.ReasoningContinuityCarrier{Kind: stream.profile.continuityKind, Version: 1, Payload: payload}
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

func (stream *responsesBehaviorStream) Finish() (textbehavior.NormalizedResult, error) {
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
		switch item.Kind {
		case textbehavior.OrderedItemToolCall:
			finish = runtimev1.FinishReason_FINISH_REASON_TOOL_CALL
		case textbehavior.OrderedItemText:
			text.WriteString(item.Text)
		}
	}
	if stream.spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && finish == runtimev1.FinishReason_FINISH_REASON_STOP {
		var instance any
		decoder := json.NewDecoder(strings.NewReader(text.String()))
		decoder.UseNumber()
		if decoder.Decode(&instance) != nil || decoder.Decode(new(any)) != io.EOF {
			return textbehavior.NormalizedResult{}, stream.profile.outputError("structured JSON")
		}
		schema, err := textbehavior.CompileJSONSchema(stream.spec.ResponseFormat.JsonSchema.AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return textbehavior.NormalizedResult{}, stream.profile.outputError("structured schema mismatch")
		}
	}
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: &runtimev1.UsageStats{InputTokens: stream.response.Usage.Input, OutputTokens: stream.response.Usage.Output}}, nil
}

// Only encrypted continuity and the identity needed by Responses are retained.
// Raw reasoning and reasoning summaries never enter a public output item.
type responsesEncryptedReasoning struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Encrypted string `json:"encrypted_content"`
	Summary   []any  `json:"summary"`
}

func (value responsesEncryptedReasoning) valid() bool {
	return value.Type == "reasoning" && value.ID != "" && value.Encrypted != "" && value.Summary != nil && len(value.Summary) == 0
}

func validateResponsesStructuredSchema(profile *responsesProfile, schema map[string]any, strict bool) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "enum", "required", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "$ref":
		case "default", "const", "minLength", "maxLength", "minProperties", "maxProperties":
			if strict {
				return profile.unsupported("strict JSON Schema keyword " + key)
			}
		case "additionalProperties":
			if strict && value != false {
				return profile.unsupported("open structured object")
			}
			if child, ok := value.(map[string]any); ok {
				if err := validateResponsesStructuredSchema(profile, child, strict); err != nil {
					return err
				}
			}
		case "properties", "$defs":
			children, ok := value.(map[string]any)
			if !ok {
				return profile.inputError("schema object")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return profile.inputError("schema child")
				}
				if err := validateResponsesStructuredSchema(profile, node, strict); err != nil {
					return err
				}
			}
		case "items":
			child, ok := value.(map[string]any)
			if !ok {
				return profile.unsupported("tuple schema")
			}
			if err := validateResponsesStructuredSchema(profile, child, strict); err != nil {
				return err
			}
		case "anyOf", "oneOf", "allOf":
			if strict && key != "anyOf" {
				return profile.unsupported("strict schema composition")
			}
			children, ok := value.([]any)
			if !ok {
				return profile.inputError("schema alternatives")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return profile.inputError("schema alternative")
				}
				if err := validateResponsesStructuredSchema(profile, node, strict); err != nil {
					return err
				}
			}
		default:
			return profile.unsupported("JSON Schema keyword " + key)
		}
	}
	if properties, ok := schema["properties"].(map[string]any); ok && strict {
		required, _ := schema["required"].([]any)
		fields := map[string]bool{}
		for _, name := range required {
			if key, ok := name.(string); ok {
				fields[key] = true
			}
		}
		if schema["additionalProperties"] != false || len(fields) != len(properties) {
			return profile.unsupported("optional structured property")
		}
		for name := range properties {
			if !fields[name] {
				return profile.unsupported("optional structured property")
			}
		}
	}
	return nil
}
