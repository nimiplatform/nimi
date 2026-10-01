package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const anthropicThinkingContinuityKind = "anthropic.messages.thinking"
const AnthropicThinkingContinuityKind = anthropicThinkingContinuityKind

// anthropicMessagesProfile fixes what one reviewed Claude cohort admits on
// the shared Messages adapter.
type anthropicMessagesProfile struct {
	// adaptiveThinking sends thinking {type adaptive, display omitted} and
	// carries each signed thinking or redacted_thinking block as an opaque
	// continuity carrier that is replayed verbatim; thinking text never
	// leaves Runtime.
	adaptiveThinking bool
	// samplingControls admits temperature or top_p, never both, and top_k.
	samplingControls bool
	// forcedToolChoice admits required and named tool choice.
	forcedToolChoice bool
	defaultMaxTokens int32
}

// Claude models whose thinking stays off unless requested.
var anthropicLegacyMessages = &anthropicMessagesProfile{samplingControls: true, forcedToolChoice: true, defaultMaxTokens: 4096}

// Claude models that always think adaptively: they refuse non-default
// sampling and forced tool use on every request, and thinking shares the
// output budget, so the default limit leaves room for both.
var anthropicAdaptiveMessages = &anthropicMessagesProfile{adaptiveThinking: true, defaultMaxTokens: 16384}

// @nimi-authority: rule.nimi.runtime.ai-provider.anthropic-messages-text-behaviors
func AnthropicTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return serializeAnthropicRequest(anthropicLegacyMessages, spec, stream)
}

func AnthropicAdaptiveTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return serializeAnthropicRequest(anthropicAdaptiveMessages, spec, stream)
}

func serializeAnthropicRequest(profile *anthropicMessagesProfile, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("missing text request")
	}
	if spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("raw provider chunks")
	}
	if spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || spec.Temperature != nil && spec.TopP != nil ||
		!profile.samplingControls && (spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil) {
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
				} else if carrier := item.GetOutput().GetReasoningContinuity(); carrier != nil && profile.adaptiveThinking {
					block, err := anthropicThinkingReplay(carrier)
					if err != nil {
						return textbehavior.SerializedRequest{}, err
					}
					appendBlock("assistant", block)
				} else {
					return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("ordered content kind")
				}
			}
			continue
		}
		if message.GetContent() != "" && len(message.GetParts()) > 0 {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("conflicting text representations")
		}
		if role != "system" && role != "user" && role != "assistant" {
			return textbehavior.SerializedRequest{}, anthropicBehaviorInput("message role")
		}
		if len(message.GetParts()) == 0 {
			if role == "system" {
				system = append(system, message.GetContent())
			} else {
				appendBlock(role, map[string]any{"type": "text", "text": message.GetContent()})
			}
			continue
		}
		var systemText strings.Builder
		for _, part := range message.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				if role == "system" {
					systemText.WriteString(part.GetText())
				} else {
					appendBlock(role, map[string]any{"type": "text", "text": part.GetText()})
				}
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				if role != "user" || part.GetImageUrl() == nil {
					return textbehavior.SerializedRequest{}, anthropicBehaviorInput("user image content part")
				}
				block, err := AnthropicImageBlock(part.GetImageUrl().GetUrl())
				if err != nil {
					return textbehavior.SerializedRequest{}, err
				}
				appendBlock(role, block)
			default:
				return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("non-text content")
			}
		}
		if role == "system" {
			system = append(system, systemText.String())
		}
	}
	if len(messages) == 0 {
		return textbehavior.SerializedRequest{}, anthropicBehaviorInput("empty messages")
	}
	maxTokens := spec.GetMaxTokens()
	if maxTokens <= 0 {
		maxTokens = profile.defaultMaxTokens
	}
	body := map[string]any{"messages": messages, "max_tokens": maxTokens, "stream": stream}
	if profile.adaptiveThinking {
		body["thinking"] = map[string]any{"type": "adaptive", "display": "omitted"}
	}
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
		if !profile.forcedToolChoice && choice["type"] != "auto" && choice["type"] != "none" {
			return textbehavior.SerializedRequest{}, anthropicBehaviorUnsupported("forced tool choice")
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

// AnthropicImageBlock maps one admitted user image to a Messages image block:
// an inline base64 data URL becomes a base64 source and an HTTP(S) URL a url
// source. Other schemes and media types are rejected, never fetched here.
func AnthropicImageBlock(rawURL string) (map[string]any, error) {
	value := strings.TrimSpace(rawURL)
	if rest, ok := strings.CutPrefix(value, "data:"); ok {
		header, data, found := strings.Cut(rest, ",")
		mediaType, encoding, _ := strings.Cut(header, ";")
		switch mediaType {
		case "image/jpeg", "image/png", "image/gif", "image/webp":
		default:
			return nil, anthropicBehaviorInput("image media type")
		}
		if !found || encoding != "base64" || data == "" {
			return nil, anthropicBehaviorInput("image data URL")
		}
		return map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mediaType, "data": data}}, nil
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" && parsed.Scheme != "http" || parsed.Host == "" || parsed.User != nil {
		return nil, anthropicBehaviorInput("image URL")
	}
	return map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": value}}, nil
}

// anthropicThinkingBlock is exactly what a signed thinking block or a
// redacted_thinking block carries; with display omitted, thinking is empty.
type anthropicThinkingBlock struct {
	Type      string  `json:"type"`
	Thinking  *string `json:"thinking,omitempty"`
	Signature string  `json:"signature,omitempty"`
	Data      string  `json:"data,omitempty"`
}

func (block anthropicThinkingBlock) valid() bool {
	switch block.Type {
	case "thinking":
		return block.Thinking != nil && *block.Thinking == "" && block.Signature != "" && block.Data == ""
	case "redacted_thinking":
		return block.Thinking == nil && block.Signature == "" && block.Data != ""
	}
	return false
}

func anthropicThinkingCarrier(block anthropicThinkingBlock) (*runtimev1.ReasoningContinuityCarrier, error) {
	if !block.valid() {
		return nil, anthropicBehaviorOutput("thinking continuity")
	}
	payload, err := json.Marshal(block)
	if err != nil {
		return nil, anthropicBehaviorOutput("thinking continuity JSON")
	}
	carrier := &runtimev1.ReasoningContinuityCarrier{Kind: anthropicThinkingContinuityKind, Version: 1, Payload: payload}
	if !textbehavior.ValidContinuity(carrier) {
		return nil, anthropicBehaviorOutput("thinking continuity size")
	}
	return carrier, nil
}

func anthropicThinkingReplay(carrier *runtimev1.ReasoningContinuityCarrier) (map[string]any, error) {
	if !textbehavior.ValidContinuity(carrier) || carrier.GetKind() != anthropicThinkingContinuityKind || carrier.GetVersion() != 1 {
		return nil, anthropicBehaviorInput("continuity identity")
	}
	var block anthropicThinkingBlock
	decoder := json.NewDecoder(bytes.NewReader(carrier.GetPayload()))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&block) != nil || decoder.Decode(new(any)) != io.EOF || !block.valid() {
		return nil, anthropicBehaviorInput("continuity payload")
	}
	if block.Type == "thinking" {
		return map[string]any{"type": "thinking", "thinking": "", "signature": block.Signature}, nil
	}
	return map[string]any{"type": "redacted_thinking", "data": block.Data}, nil
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
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	Thinking  *string         `json:"thinking"`
	Signature string          `json:"signature"`
	Data      string          `json:"data"`
}

func (block anthropicBehaviorBlock) thinking() anthropicThinkingBlock {
	return anthropicThinkingBlock{Type: block.Type, Thinking: block.Thinking, Signature: block.Signature, Data: block.Data}
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
	return parseAnthropicMessage(anthropicLegacyMessages, payload, spec)
}

func AnthropicAdaptiveTextBehaviorNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return parseAnthropicMessage(anthropicAdaptiveMessages, payload, spec)
}

func parseAnthropicMessage(profile *anthropicMessagesProfile, payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
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
		case "thinking", "redacted_thinking":
			if !profile.adaptiveThinking {
				return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("content block kind")
			}
			carrier, err := anthropicThinkingCarrier(block.thinking())
			if err != nil {
				return textbehavior.NormalizedResult{}, err
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, carrier
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
	profile    *anthropicMessagesProfile
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
	return newAnthropicBehaviorStream(anthropicLegacyMessages, spec), nil
}

func AnthropicAdaptiveTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return newAnthropicBehaviorStream(anthropicAdaptiveMessages, spec), nil
}

func newAnthropicBehaviorStream(profile *anthropicMessagesProfile, spec *runtimev1.TextGenerateScenarioSpec) *anthropicBehaviorStream {
	return &anthropicBehaviorStream{profile: profile, spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments), blocks: map[uint32]anthropicBehaviorBlock{}, arguments: map[uint32]bool{}}
}

func (stream *anthropicBehaviorStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	var event struct {
		Type    string                   `json:"type"`
		Index   uint32                   `json:"index"`
		Message anthropicBehaviorMessage `json:"message"`
		Block   anthropicBehaviorBlock   `json:"content_block"`
		Delta   struct {
			Type      string  `json:"type"`
			Text      string  `json:"text"`
			JSON      string  `json:"partial_json"`
			Stop      string  `json:"stop_reason"`
			Thinking  *string `json:"thinking"`
			Signature string  `json:"signature"`
		} `json:"delta"`
		Usage anthropicBehaviorUsage `json:"usage"`
		Error struct {
			Type string `json:"type"`
		} `json:"error"`
	}
	if json.Unmarshal(payload, &event) != nil || stream.stopped {
		return nil, anthropicBehaviorOutput("stream event")
	}
	if event.Type == "ping" {
		return nil, nil
	}
	if event.Type == "error" {
		logProviderStreamErrorEvent("Anthropic Messages", event.Error.Type)
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
		case "thinking", "redacted_thinking":
			// A continuity carrier is published only once its block is sealed.
			if !stream.profile.adaptiveThinking {
				return nil, anthropicBehaviorOutput("stream content kind")
			}
			return nil, nil
		default:
			return nil, anthropicBehaviorOutput("stream content kind")
		}
	case "content_block_delta":
		block, exists := stream.blocks[event.Index]
		if !exists {
			return nil, anthropicBehaviorOutput("delta without block")
		}
		switch {
		case block.Type == "text" && event.Delta.Type == "text_delta":
			fragment.Kind, fragment.Text = textbehavior.OrderedItemText, event.Delta.Text
		case block.Type == "tool_use" && event.Delta.Type == "input_json_delta":
			fragment.Kind, fragment.ToolCall = textbehavior.OrderedItemToolCall, &textbehavior.ToolCallFragment{ArgumentsJSONPart: event.Delta.JSON}
			if event.Delta.JSON != "" {
				stream.arguments[event.Index] = true
			}
		case block.Type == "thinking" && event.Delta.Type == "thinking_delta":
			// With display omitted the provider streams no thinking text.
			if event.Delta.Thinking == nil || *event.Delta.Thinking != "" {
				return nil, anthropicBehaviorOutput("thinking text")
			}
			if block.Thinking == nil {
				empty := ""
				block.Thinking = &empty
			}
			stream.blocks[event.Index] = block
			return nil, nil
		case block.Type == "thinking" && event.Delta.Type == "signature_delta":
			block.Signature += event.Delta.Signature
			stream.blocks[event.Index] = block
			return nil, nil
		default:
			return nil, anthropicBehaviorOutput("stream delta kind")
		}
	case "content_block_stop":
		block, exists := stream.blocks[event.Index]
		if !exists {
			return nil, anthropicBehaviorOutput("stop without block")
		}
		fragment.Complete = true
		switch block.Type {
		case "text":
			fragment.Kind = textbehavior.OrderedItemText
		case "thinking", "redacted_thinking":
			thinking := block.thinking()
			if block.Type == "thinking" && thinking.Thinking == nil {
				empty := ""
				thinking.Thinking = &empty
			}
			carrier, err := anthropicThinkingCarrier(thinking)
			if err != nil {
				return nil, err
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, carrier
		default:
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
			switch item.Kind {
			case textbehavior.OrderedItemText:
				text.WriteString(item.Text)
			case textbehavior.OrderedItemReasoningContinuity:
			default:
				return textbehavior.NormalizedResult{}, anthropicBehaviorOutput("non-text structured output")
			}
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
