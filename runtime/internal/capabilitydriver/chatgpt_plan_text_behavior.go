package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const (
	chatGPTPlanContinuityKind = "openai_chatgpt_plan.responses.encrypted-reasoning"
	// ChatGPTPlanToolNamespace groups caller function tools as the public
	// ChatGPT-plan Responses preview requires.
	ChatGPTPlanToolNamespace = "nimi_app_tools"
	// ChatGPTPlanManageUsageHint points the user at ChatGPT usage settings.
	ChatGPTPlanManageUsageHint = "manage_chatgpt_plan_usage"
	chatGPTPlanItemTextLimit   = 256 * 1024
)

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-text-behaviors
// ChatGPTPlanTextBehaviorRequestSerializer maps one exact text step to a
// stateless public Responses request with store false and SSE delivery.
func ChatGPTPlanTextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, chatGPTPlanInput("missing request")
	}
	if spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("raw provider chunks")
	}
	// The ChatGPT-plan route rejects output limits and sampling controls.
	if spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.MaxTokens != nil || spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || len(spec.Stop) > 0 {
		return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("generation controls")
	}
	if reasoning := spec.Reasoning; reasoning != nil && (reasoning.Intensity != nil ||
		reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && reasoning.Activation != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED ||
		reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && reasoning.Presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN) {
		return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("reasoning controls")
	}
	input := make([]any, 0, len(spec.Input))
	instructions := []string{}
	if spec.SystemPrompt != "" {
		instructions = append(instructions, spec.SystemPrompt)
	}
	for _, message := range spec.Input {
		if message == nil {
			return textbehavior.SerializedRequest{}, chatGPTPlanInput("nil message")
		}
		if len(message.TurnItems) > 0 {
			items, err := chatGPTPlanTurnItems(message.TurnItems)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			input = append(input, items...)
			continue
		}
		if message.Content != "" && len(message.Parts) > 0 {
			return textbehavior.SerializedRequest{}, chatGPTPlanInput("conflicting text representations")
		}
		var text strings.Builder
		text.WriteString(message.Content)
		content := make([]map[string]any, 0, len(message.Parts))
		hasImage := false
		for _, part := range message.Parts {
			if part == nil {
				return textbehavior.SerializedRequest{}, chatGPTPlanInput("nil content part")
			}
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
				if _, ok := part.GetContent().(*runtimev1.ChatContentPart_Text); !ok {
					return textbehavior.SerializedRequest{}, chatGPTPlanInput("text content part")
				}
				text.WriteString(part.GetText())
				content = append(content, map[string]any{"type": "input_text", "text": part.GetText()})
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				image := part.GetImageUrl()
				if message.Role != "user" || image == nil || strings.TrimSpace(image.GetUrl()) == "" {
					return textbehavior.SerializedRequest{}, chatGPTPlanInput("user image content part")
				}
				item := map[string]any{"type": "input_image", "image_url": image.GetUrl()}
				if image.GetDetail() != "" {
					item["detail"] = image.GetDetail()
				}
				content = append(content, item)
				hasImage = true
			default:
				return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("non-text input")
			}
		}
		// Explicit system message items are rejected by this route; system
		// text travels only as Responses instructions.
		if message.Role == "system" {
			if hasImage {
				return textbehavior.SerializedRequest{}, chatGPTPlanInput("system image content")
			}
			instructions = append(instructions, text.String())
			continue
		}
		if message.Role != "user" && message.Role != "assistant" {
			return textbehavior.SerializedRequest{}, chatGPTPlanInput("message role")
		}
		if hasImage {
			input = append(input, map[string]any{"role": message.Role, "content": content})
		} else {
			input = append(input, map[string]any{"role": message.Role, "content": text.String()})
		}
	}
	if len(input) == 0 {
		return textbehavior.SerializedRequest{}, chatGPTPlanInput("empty input")
	}
	body := map[string]any{"input": input, "store": false, "stream": true, "include": []string{"reasoning.encrypted_content"}}
	if len(instructions) > 0 {
		body["instructions"] = strings.Join(instructions, "\n\n")
	}
	if len(spec.Tools) > 0 {
		tools := make([]any, 0, len(spec.Tools))
		for _, tool := range spec.Tools {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION {
				return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("provider tool")
			}
			schema := tool.GetInputSchema().AsMap()
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return textbehavior.SerializedRequest{}, chatGPTPlanInput("tool schema")
			}
			// Preserve the caller's schema; Runtime validates every completed
			// call against it before exposing the call.
			tools = append(tools, map[string]any{"type": "function", "name": tool.Name, "description": tool.Description, "parameters": schema, "strict": false})
		}
		body["tools"] = []any{map[string]any{
			"type": "namespace", "name": ChatGPTPlanToolNamespace,
			"description": "Functions executed by the requesting Nimi app after it receives the call.",
			"tools":       tools,
		}}
		body["parallel_tool_calls"] = false
		choice := any("auto")
		switch spec.ToolChoice {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
			choice = "none"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			choice = "required"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("named tool choice")
		}
		body["tool_choice"] = choice
	}
	if format := spec.ResponseFormat; format != nil && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		if format.Kind != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA || !format.Strict {
			return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("response format combination")
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return textbehavior.SerializedRequest{}, chatGPTPlanInput("response schema")
		}
		if schema["type"] != "object" || schema["anyOf"] != nil {
			return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("structured root")
		}
		if err := validateChatGPTPlanStructuredSchema(schema, true); err != nil {
			return textbehavior.SerializedRequest{}, chatGPTPlanUnsupported("strict JSON Schema subset")
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
		return textbehavior.SerializedRequest{}, chatGPTPlanInput("request JSON")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

func chatGPTPlanTurnItems(turnItems []*runtimev1.TextTurnItem) ([]any, error) {
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
				return nil, chatGPTPlanInput("tool result JSON")
			}
			items = append(items, map[string]any{"type": "function_call_output", "call_id": result.ToolCallId, "output": string(value)})
		case item.GetOutput().GetText() != nil:
			items = append(items, map[string]any{"role": "assistant", "content": item.GetOutput().GetText().Text})
		case item.GetOutput().GetToolCall() != nil:
			call := item.GetOutput().GetToolCall()
			items = append(items, map[string]any{
				"type": "function_call", "call_id": call.Id, "name": call.Name, "namespace": ChatGPTPlanToolNamespace, "arguments": call.ArgumentsJson,
			})
		case item.GetOutput().GetReasoningContinuity() != nil:
			carrier := item.GetOutput().GetReasoningContinuity()
			if !textbehavior.ValidContinuity(carrier) || carrier.Kind != chatGPTPlanContinuityKind || carrier.Version != 1 {
				return nil, chatGPTPlanInput("continuity identity")
			}
			var reasoning chatGPTPlanEncryptedReasoning
			decoder := json.NewDecoder(bytes.NewReader(carrier.Payload))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&reasoning) != nil || decoder.Decode(new(any)) != io.EOF || !reasoning.valid() {
				return nil, chatGPTPlanInput("continuity payload")
			}
			items = append(items, reasoning)
		default:
			return nil, chatGPTPlanUnsupported("ordered content kind")
		}
	}
	return items, nil
}

type chatGPTPlanBehaviorItem struct {
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

type chatGPTPlanProviderError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param"`
}

type chatGPTPlanBehaviorResponse struct {
	Status            string                    `json:"status"`
	Output            []chatGPTPlanBehaviorItem `json:"output"`
	Error             *chatGPTPlanProviderError `json:"error"`
	IncompleteDetails *struct {
		Reason string `json:"reason"`
	} `json:"incomplete_details"`
	Usage struct {
		Input  int64 `json:"input_tokens"`
		Output int64 `json:"output_tokens"`
	} `json:"usage"`
}

type chatGPTPlanBehaviorBlock struct {
	item            chatGPTPlanBehaviorItem
	text, arguments strings.Builder
	emitted         int
	done            bool
}

type chatGPTPlanBehaviorStream struct {
	spec      *runtimev1.TextGenerateScenarioSpec
	assembler *textbehavior.OrderedStreamAssembler
	blocks    []*chatGPTPlanBehaviorBlock
	next      uint32
	completed bool
	response  chatGPTPlanBehaviorResponse
}

// ChatGPTPlanTextBehaviorStreamAssembler parses the public Responses SSE
// stream. Only response.completed with every output item sealed succeeds.
func ChatGPTPlanTextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	return &chatGPTPlanBehaviorStream{spec: spec, assembler: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), textbehavior.ValidateToolArguments)}, nil
}

func (stream *chatGPTPlanBehaviorStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if string(payload) == "[DONE]" && stream.completed {
		return nil, nil
	}
	var event struct {
		Type      string                      `json:"type"`
		Index     uint32                      `json:"output_index"`
		ItemID    string                      `json:"item_id"`
		Delta     string                      `json:"delta"`
		Arguments string                      `json:"arguments"`
		Code      string                      `json:"code"`
		Item      chatGPTPlanBehaviorItem     `json:"item"`
		Response  chatGPTPlanBehaviorResponse `json:"response"`
	}
	if json.Unmarshal(payload, &event) != nil || stream.completed {
		return nil, chatGPTPlanOutput("stream event")
	}
	switch event.Type {
	case "response.created", "response.in_progress", "response.queued":
		return nil, nil
	case "error":
		return nil, ChatGPTPlanFailure(0, event.Code)
	case "response.failed":
		code := ""
		if event.Response.Error != nil {
			code = event.Response.Error.Code
		}
		return nil, ChatGPTPlanFailure(0, code)
	case "response.incomplete":
		reason := ""
		if event.Response.IncompleteDetails != nil {
			reason = event.Response.IncompleteDetails.Reason
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TEXT_OUTPUT_INCOMPLETE,
			fmt.Errorf("ChatGPT plan response incomplete: %s", reason), grpcerr.ReasonOptions{})
	case "response.completed":
		if event.Response.Status != "completed" || int(stream.next) != len(stream.blocks) {
			return nil, chatGPTPlanOutput(fmt.Sprintf("response completion: status=%q complete=%d items=%d", event.Response.Status, stream.next, len(stream.blocks)))
		}
		stream.completed, stream.response = true, event.Response
		return nil, nil
	case "response.output_item.added":
		if int(event.Index) != len(stream.blocks) || event.Item.ID == "" {
			return nil, chatGPTPlanOutput("output item association")
		}
		if event.Item.Type != "message" && event.Item.Type != "function_call" && event.Item.Type != "reasoning" {
			return nil, chatGPTPlanOutput("output item kind " + event.Item.Type)
		}
		if event.Item.Type == "function_call" && !chatGPTPlanNamespaceAdmitted(event.Item.Namespace) {
			return nil, chatGPTPlanOutput("function call namespace")
		}
		stream.blocks = append(stream.blocks, &chatGPTPlanBehaviorBlock{item: event.Item})
		return nil, nil
	}
	if int(event.Index) >= len(stream.blocks) {
		return nil, chatGPTPlanOutput("event without output item")
	}
	block := stream.blocks[event.Index]
	if block.done || event.ItemID != "" && event.ItemID != block.item.ID {
		return nil, chatGPTPlanOutput("output item association")
	}
	switch event.Type {
	case "response.output_text.delta":
		if block.item.Type != "message" {
			return nil, chatGPTPlanOutput("text delta kind")
		}
		block.text.WriteString(event.Delta)
	case "response.function_call_arguments.delta":
		if block.item.Type != "function_call" {
			return nil, chatGPTPlanOutput("arguments delta kind")
		}
		block.arguments.WriteString(event.Delta)
	case "response.function_call_arguments.done":
		if block.item.Type != "function_call" || block.arguments.Len() > 0 && block.arguments.String() != event.Arguments {
			return nil, chatGPTPlanOutput("arguments completion")
		}
	case "response.output_item.done":
		if event.Item.ID != block.item.ID || event.Item.Type != block.item.Type {
			return nil, chatGPTPlanOutput("item completion association")
		}
		if event.Item.Type == "function_call" && (event.Item.CallID == "" || block.item.CallID != "" && event.Item.CallID != block.item.CallID ||
			event.Item.Name != block.item.Name || !chatGPTPlanNamespaceAdmitted(event.Item.Namespace) ||
			block.arguments.Len() > 0 && block.arguments.String() != event.Item.Arguments) {
			return nil, chatGPTPlanOutput("complete call association")
		}
		if event.Item.Type == "message" {
			var text strings.Builder
			for _, part := range event.Item.Content {
				if part.Type != "output_text" {
					return nil, chatGPTPlanOutput("message content")
				}
				text.WriteString(part.Text)
			}
			if block.text.Len() > 0 && block.text.String() != text.String() {
				return nil, chatGPTPlanOutput("text completion")
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
		return nil, chatGPTPlanOutput("unsupported stream event " + event.Type)
	}
	if block.text.Len()+block.arguments.Len() > chatGPTPlanItemTextLimit {
		return nil, chatGPTPlanOutput("output size")
	}
	return stream.flush()
}

// flush exposes complete calls in output order while text at the current
// output index can still stream incrementally.
func (stream *chatGPTPlanBehaviorStream) flush() ([]textbehavior.OrderedDelta, error) {
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
			reasoning := chatGPTPlanEncryptedReasoning{Type: "reasoning", ID: block.item.ID, Encrypted: block.item.Encrypted, Summary: []any{}}
			if !reasoning.valid() {
				return nil, chatGPTPlanOutput("missing encrypted continuity")
			}
			payload, err := json.Marshal(reasoning)
			if err != nil {
				return nil, chatGPTPlanOutput("continuity JSON")
			}
			fragment.Kind, fragment.ReasoningContinuity = textbehavior.OrderedItemReasoningContinuity, &runtimev1.ReasoningContinuityCarrier{Kind: chatGPTPlanContinuityKind, Version: 1, Payload: payload}
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

func (stream *chatGPTPlanBehaviorStream) Finish() (textbehavior.NormalizedResult, error) {
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
			return textbehavior.NormalizedResult{}, chatGPTPlanOutput("structured JSON")
		}
		schema, err := textbehavior.CompileJSONSchema(stream.spec.ResponseFormat.JsonSchema.AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return textbehavior.NormalizedResult{}, chatGPTPlanOutput("structured schema mismatch")
		}
	}
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: &runtimev1.UsageStats{InputTokens: stream.response.Usage.Input, OutputTokens: stream.response.Usage.Output}}, nil
}

// ChatGPTPlanTextBehaviorNonStreamParser exists for the hook contract only:
// this route always streams, including synchronous collection.
func ChatGPTPlanTextBehaviorNonStreamParser(_ []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	return textbehavior.NormalizedResult{}, chatGPTPlanOutput("non-stream response on a stream-only route")
}

func chatGPTPlanNamespaceAdmitted(namespace string) bool {
	return namespace == ChatGPTPlanToolNamespace
}

// ChatGPTPlanFailure maps a documented ChatGPT-plan admission or Responses
// error to its typed Runtime reason without retrying or switching route.
func ChatGPTPlanFailure(status int, code string) error {
	code = strings.TrimSpace(code)
	reason, grpcCode, hint := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable, "retry_later"
	switch code {
	case "subscription_sharing_usage_limit_exceeded":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted, ChatGPTPlanManageUsageHint
	case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable, "retry_later"
	case "subscription_sharing_user_not_eligible":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "chatgpt_plan_not_eligible"
	case "subscription_sharing_invalid_user":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.Unauthenticated, "check_chatgpt_plan_account"
	case "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "check_chatgpt_plan_account"
	case "subscription_sharing_route_not_supported":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, codes.FailedPrecondition, ""
	case "subscription_sharing_unsupported_capability":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, codes.InvalidArgument, ""
	case "model_not_found":
		reason, grpcCode, hint = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound, "select_available_model"
	default:
		switch {
		case status == http.StatusUnauthorized:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.Unauthenticated, "check_chatgpt_plan_account"
		case status == http.StatusForbidden:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.PermissionDenied, "check_chatgpt_plan_account"
		case status == http.StatusNotFound:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, codes.NotFound, "select_available_model"
		case status == http.StatusTooManyRequests:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted, ChatGPTPlanManageUsageHint
		case status >= 300 && status < 400:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, codes.FailedPrecondition, ""
		case status == http.StatusBadRequest:
			reason, grpcCode, hint = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument, ""
		}
	}
	return grpcerr.WithReasonCodeOptions(grpcCode, reason, grpcerr.ReasonOptions{
		ActionHint: hint, Message: "ChatGPT plan request failed",
		Metadata: map[string]string{"provider_error_code": code},
	})
}

func chatGPTPlanInput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, fmt.Errorf("ChatGPT plan text input: %s", detail), grpcerr.ReasonOptions{})
}

func chatGPTPlanUnsupported(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED, fmt.Errorf("ChatGPT plan text behavior: %s", detail), grpcerr.ReasonOptions{})
}

func chatGPTPlanOutput(detail string) error {
	return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("ChatGPT plan text output: %s", detail), grpcerr.ReasonOptions{})
}

// Only encrypted continuity and the identity needed by Responses are retained.
// Raw reasoning and reasoning summaries never enter a public output item.
type chatGPTPlanEncryptedReasoning struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Encrypted string `json:"encrypted_content"`
	Summary   []any  `json:"summary"`
}

func (value chatGPTPlanEncryptedReasoning) valid() bool {
	return value.Type == "reasoning" && value.ID != "" && value.Encrypted != "" && value.Summary != nil && len(value.Summary) == 0
}

func validateChatGPTPlanStructuredSchema(schema map[string]any, strict bool) error {
	for key, value := range schema {
		switch key {
		case "$schema", "title", "description", "type", "enum", "required", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "$ref":
		case "default", "const", "minLength", "maxLength", "minProperties", "maxProperties":
			if strict {
				return chatGPTPlanUnsupported("strict JSON Schema keyword " + key)
			}
		case "additionalProperties":
			if strict && value != false {
				return chatGPTPlanUnsupported("open structured object")
			}
			if child, ok := value.(map[string]any); ok {
				if err := validateChatGPTPlanStructuredSchema(child, strict); err != nil {
					return err
				}
			}
		case "properties", "$defs":
			children, ok := value.(map[string]any)
			if !ok {
				return chatGPTPlanInput("schema object")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return chatGPTPlanInput("schema child")
				}
				if err := validateChatGPTPlanStructuredSchema(node, strict); err != nil {
					return err
				}
			}
		case "items":
			child, ok := value.(map[string]any)
			if !ok {
				return chatGPTPlanUnsupported("tuple schema")
			}
			if err := validateChatGPTPlanStructuredSchema(child, strict); err != nil {
				return err
			}
		case "anyOf", "oneOf", "allOf":
			if strict && key != "anyOf" {
				return chatGPTPlanUnsupported("strict schema composition")
			}
			children, ok := value.([]any)
			if !ok {
				return chatGPTPlanInput("schema alternatives")
			}
			for _, child := range children {
				node, ok := child.(map[string]any)
				if !ok {
					return chatGPTPlanInput("schema alternative")
				}
				if err := validateChatGPTPlanStructuredSchema(node, strict); err != nil {
					return err
				}
			}
		default:
			return chatGPTPlanUnsupported("JSON Schema keyword " + key)
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
			return chatGPTPlanUnsupported("optional structured property")
		}
		for name := range properties {
			if !fields[name] {
				return chatGPTPlanUnsupported("optional structured property")
			}
		}
	}
	return nil
}
