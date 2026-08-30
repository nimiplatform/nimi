package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
	"google.golang.org/grpc/codes"
)

const gemma4SchemaResource = "urn:nimi:text-behavior:gemma4:schema"

type gemma4NoNetworkSchemaLoader struct{}

func (gemma4NoNetworkSchemaLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("remote JSON Schema resource %q is unavailable", url)
}

func Gemma4TextBehaviorRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if spec == nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("Gemma 4 text behavior request is missing")
	}
	messages, err := gemma4BehaviorMessages(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": "nimi-selected-local", "messages": messages, "stream": stream}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	gemma4ApplySampling(body, spec)
	if err := gemma4ApplyTools(body, spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if err := gemma4ApplyResponseFormat(body, spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if reasoning := spec.GetReasoning(); reasoning != nil && llamaBehaviorReasoningEnabled(spec) {
		budget, ok := reasoning.GetIntensity().(*runtimev1.ReasoningConfig_ExactBudgetTokens)
		if !ok || budget.ExactBudgetTokens == 0 {
			return textbehavior.SerializedRequest{}, fmt.Errorf("Gemma 4 reasoning requires an exact positive token budget")
		}
		body["thinking_budget_tokens"] = budget.ExactBudgetTokens
		body["reasoning_format"] = "deepseek"
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, fmt.Errorf("encode Gemma 4 behavior request: %w", err)
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, nil
}

func gemma4ApplySampling(body map[string]any, spec *runtimev1.TextGenerateScenarioSpec) {
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.TopK != nil {
		body["top_k"] = spec.GetTopK()
	}
	if spec.PresencePenalty != nil {
		body["presence_penalty"] = spec.GetPresencePenalty()
	}
	if spec.FrequencyPenalty != nil {
		body["frequency_penalty"] = spec.GetFrequencyPenalty()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = append([]string(nil), spec.GetStop()...)
	}
	if spec.Seed != nil {
		body["seed"] = spec.GetSeed()
	}
}

func gemma4BehaviorMessages(spec *runtimev1.TextGenerateScenarioSpec) ([]map[string]any, error) {
	messages := make([]map[string]any, 0, len(spec.GetInput())+1)
	if systemPrompt := strings.TrimSpace(spec.GetSystemPrompt()); systemPrompt != "" {
		messages = append(messages, map[string]any{"role": "system", "content": systemPrompt})
	}
	for _, message := range spec.GetInput() {
		if message == nil {
			continue
		}
		if len(message.GetTurnItems()) == 0 {
			projected, ok, err := projectLlamaTextMessage(message)
			if err != nil {
				return nil, err
			}
			if ok {
				messages = append(messages, projected)
			}
			continue
		}
		projected, err := gemma4BehaviorTurnMessages(message)
		if err != nil {
			return nil, err
		}
		messages = append(messages, projected...)
	}
	if len(messages) == 0 {
		return nil, fmt.Errorf("Gemma 4 behavior request has no renderable input")
	}
	return messages, nil
}

func gemma4BehaviorTurnMessages(message *runtimev1.ChatMessage) ([]map[string]any, error) {
	role := strings.TrimSpace(message.GetRole())
	switch role {
	case "assistant":
		var text strings.Builder
		toolCalls := make([]map[string]any, 0)
		seenToolCall := false
		for _, item := range message.GetTurnItems() {
			if item == nil || item.GetOutput() == nil {
				return nil, gemma4InvalidRequest("assistant behavior transcript item is invalid")
			}
			switch value := item.GetOutput().GetItem().(type) {
			case *runtimev1.TextOutputItem_Text:
				if seenToolCall || value.Text == nil || value.Text.GetText() == "" {
					return nil, gemma4InvalidRequest("assistant text must precede complete tool calls")
				}
				text.WriteString(value.Text.GetText())
			case *runtimev1.TextOutputItem_ToolCall:
				seenToolCall = true
				call := value.ToolCall
				if call == nil || call.GetDynamic() || call.GetProviderMetadata() != nil {
					return nil, gemma4InvalidRequest("assistant tool call is not portable")
				}
				toolCalls = append(toolCalls, map[string]any{"id": call.GetId(), "type": "function", "function": map[string]any{"name": call.GetName(), "arguments": call.GetArgumentsJson()}})
			default:
				return nil, gemma4InvalidRequest("assistant reasoning transcript is unsupported by this adapter")
			}
		}
		if text.Len() == 0 && len(toolCalls) == 0 {
			return nil, gemma4InvalidRequest("assistant behavior transcript is empty")
		}
		projected := map[string]any{"role": "assistant", "content": nil}
		if text.Len() > 0 {
			projected["content"] = text.String()
		}
		if len(toolCalls) > 0 {
			projected["tool_calls"] = toolCalls
		}
		return []map[string]any{projected}, nil
	case "tool":
		projected := make([]map[string]any, 0, len(message.GetTurnItems()))
		for _, item := range message.GetTurnItems() {
			if item == nil {
				return nil, gemma4InvalidRequest("tool result transcript is unsupported")
			}
			result := item.GetToolResult()
			if result == nil || result.GetPreliminary() || result.GetDynamic() || result.GetProviderMetadata() != nil {
				return nil, gemma4InvalidRequest("tool result transcript is unsupported")
			}
			content, err := gemma4ToolResultContent(result)
			if err != nil {
				return nil, err
			}
			projected = append(projected, map[string]any{"role": "tool", "tool_call_id": result.GetToolCallId(), "name": result.GetToolName(), "content": content})
		}
		if len(projected) == 0 {
			return nil, gemma4InvalidRequest("tool result transcript is empty")
		}
		return projected, nil
	default:
		return nil, gemma4InvalidRequest("ordered behavior transcript role is unsupported")
	}
}

func gemma4ToolResultContent(result *runtimev1.ToolResult) (string, error) {
	var value any
	if result.GetResult() != nil {
		value = result.GetResult().AsInterface()
	}
	if result.GetIsError() {
		value = map[string]any{"error": value}
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return "", gemma4InvalidRequest("tool result is not JSON serializable")
	}
	return string(payload), nil
}

func gemma4ApplyTools(body map[string]any, spec *runtimev1.TextGenerateScenarioSpec) error {
	if len(spec.GetTools()) == 0 {
		return nil
	}
	selectedToolName := ""
	if spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
		selectedToolName = strings.TrimSpace(spec.GetToolChoiceName())
	}
	tools := make([]map[string]any, 0, len(spec.GetTools()))
	for _, tool := range spec.GetTools() {
		if tool == nil || tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION || tool.GetProviderToolId() != "" || tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil {
			return gemma4InvalidRequest("Gemma 4 admits only portable function tools")
		}
		if selectedToolName != "" && tool.GetName() != selectedToolName {
			continue
		}
		schema := map[string]any{"type": "object", "properties": map[string]any{}}
		if tool.GetInputSchema() != nil {
			schema = tool.GetInputSchema().AsMap()
		}
		if _, err := gemma4CompileSchema(schema); err != nil {
			return gemma4InvalidRequest("tool input schema is invalid")
		}
		function := map[string]any{"name": tool.GetName(), "parameters": schema}
		if description := strings.TrimSpace(tool.GetDescription()); description != "" {
			function["description"] = description
		}
		tools = append(tools, map[string]any{"type": "function", "function": function})
	}
	body["tools"] = tools
	switch spec.GetToolChoice() {
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO:
		body["tool_choice"] = "auto"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
		body["tool_choice"] = "none"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
		body["tool_choice"] = "required"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
		if selectedToolName == "" || len(tools) != 1 {
			return gemma4InvalidRequest("selected tool choice is unavailable")
		}
		body["tool_choice"] = "required"
	default:
		return gemma4InvalidRequest("tool choice is invalid")
	}
	return nil
}

func gemma4ApplyResponseFormat(body map[string]any, spec *runtimev1.TextGenerateScenarioSpec) error {
	format := spec.GetResponseFormat()
	if format == nil {
		return nil
	}
	switch format.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
		return nil
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if format.GetJsonSchema() != nil || format.GetStrict() {
			return gemma4InvalidRequest("JSON object response format cannot carry a schema or strictness")
		}
		body["response_format"] = map[string]any{"type": "json_object"}
		return nil
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if format.GetJsonSchema() == nil || len(format.GetJsonSchema().GetFields()) == 0 {
			return gemma4InvalidRequest("JSON Schema response format requires a schema")
		}
		schema := format.GetJsonSchema().AsMap()
		if _, err := gemma4CompileSchema(schema); err != nil {
			return gemma4InvalidRequest("response JSON Schema is invalid")
		}
		name := strings.TrimSpace(format.GetSchemaName())
		if name == "" {
			name = "nimi_response"
		}
		wrapper := map[string]any{"name": name, "schema": schema, "strict": format.GetStrict()}
		if description := strings.TrimSpace(format.GetSchemaDescription()); description != "" {
			wrapper["description"] = description
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": wrapper}
		return nil
	default:
		return gemma4InvalidRequest("response format is unsupported")
	}
}

func Gemma4TextBehaviorNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	root, err := gemma4DecodeObject(payload)
	if err != nil {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	choices, ok := root["choices"].([]any)
	if !ok || len(choices) != 1 {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	finish, err := gemma4FinishReason(gemma4String(choice["finish_reason"]))
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	message, ok := choice["message"].(map[string]any)
	if !ok {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	items := make([]textbehavior.OrderedItem, 0, 1)
	if content := gemma4TextContent(message["content"]); content != "" {
		items = append(items, textbehavior.OrderedItem{Kind: textbehavior.OrderedItemText, Text: content})
	}
	toolCalls, err := gemma4ParseToolCalls(message["tool_calls"], spec)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	for _, call := range toolCalls {
		items = append(items, textbehavior.OrderedItem{Kind: textbehavior.OrderedItemToolCall, ToolCall: call})
	}
	if len(toolCalls) > 0 && finish != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	if err := gemma4ValidateStructuredItems(spec, items); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return textbehavior.NormalizedResult{Items: items, FinishReason: finish, Usage: gemma4Usage(root)}, nil
}

func gemma4ParseToolCalls(value any, spec *runtimev1.TextGenerateScenarioSpec) ([]*runtimev1.ToolCall, error) {
	if value == nil {
		return nil, nil
	}
	rows, ok := value.([]any)
	if !ok || len(rows) == 0 {
		return nil, gemma4ToolCallInvalid()
	}
	out := make([]*runtimev1.ToolCall, 0, len(rows))
	seen := map[string]struct{}{}
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok || (item["type"] != nil && gemma4String(item["type"]) != "function") {
			return nil, gemma4ToolCallInvalid()
		}
		function, ok := item["function"].(map[string]any)
		if !ok {
			return nil, gemma4ToolCallInvalid()
		}
		id, name := gemma4String(item["id"]), gemma4String(function["name"])
		arguments, _ := function["arguments"].(string)
		if id == "" || name == "" || strings.TrimSpace(arguments) == "" {
			return nil, gemma4ToolCallInvalid()
		}
		if _, duplicate := seen[id]; duplicate {
			return nil, gemma4ToolCallInvalid()
		}
		tool := gemma4DeclaredTool(spec, name)
		if tool == nil || gemma4ValidateToolArguments(tool, arguments) != nil {
			return nil, gemma4ToolCallInvalid()
		}
		seen[id] = struct{}{}
		out = append(out, &runtimev1.ToolCall{Id: id, Name: name, ArgumentsJson: strings.TrimSpace(arguments)})
	}
	return out, nil
}

func Gemma4TextBehaviorStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if spec == nil {
		return nil, gemma4InvalidRequest("Gemma 4 stream request is missing")
	}
	for _, tool := range spec.GetTools() {
		if tool != nil && tool.GetInputSchema() != nil {
			if _, err := gemma4CompileSchema(tool.GetInputSchema().AsMap()); err != nil {
				return nil, gemma4InvalidRequest("tool input schema is invalid")
			}
		}
	}
	return &gemma4StreamAssembler{spec: spec, ordered: textbehavior.NewOrderedStreamAssembler(spec.GetTools(), gemma4ValidateToolArguments), toolItems: map[int]uint32{}, openItems: map[uint32]textbehavior.OrderedItemKind{}}, nil
}

type gemma4StreamAssembler struct {
	spec      *runtimev1.TextGenerateScenarioSpec
	ordered   *textbehavior.OrderedStreamAssembler
	textItem  *uint32
	toolItems map[int]uint32
	openItems map[uint32]textbehavior.OrderedItemKind
	nextItem  uint32
	usage     *runtimev1.UsageStats
	finish    runtimev1.FinishReason
	sealed    bool
	usageTail bool
}

func (assembler *gemma4StreamAssembler) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if assembler == nil {
		return nil, gemma4OutputInvalid()
	}
	root, err := gemma4DecodeObject(payload)
	if err != nil {
		return nil, gemma4OutputInvalid()
	}
	usage := gemma4Usage(root)
	choices, ok := root["choices"].([]any)
	if assembler.sealed {
		if !ok || len(choices) != 0 || usage == nil || assembler.usageTail {
			return nil, gemma4OutputInvalid()
		}
		assembler.usage = usage
		assembler.usageTail = true
		return nil, nil
	}
	if usage != nil {
		assembler.usage = usage
	}
	if !ok {
		return nil, gemma4OutputInvalid()
	}
	if len(choices) == 0 {
		return nil, nil
	}
	if len(choices) != 1 {
		return nil, gemma4OutputInvalid()
	}
	choice, ok := choices[0].(map[string]any)
	if !ok {
		return nil, gemma4OutputInvalid()
	}
	deltas := make([]textbehavior.OrderedDelta, 0)
	delta, _ := choice["delta"].(map[string]any)
	if content := gemma4TextContent(delta["content"]); content != "" {
		index, err := assembler.ensureTextItem()
		if err != nil {
			return nil, err
		}
		part, err := assembler.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: index, Kind: textbehavior.OrderedItemText, Text: content})
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, part...)
	}
	toolDeltas, err := assembler.appendToolFragments(delta["tool_calls"])
	if err != nil {
		return nil, err
	}
	deltas = append(deltas, toolDeltas...)
	if rawFinish := gemma4String(choice["finish_reason"]); rawFinish != "" {
		assembler.finish, err = gemma4FinishReason(rawFinish)
		if err != nil {
			return nil, err
		}
		sealed, err := assembler.sealOpenItems()
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, sealed...)
		assembler.sealed = true
	}
	return deltas, nil
}

func (assembler *gemma4StreamAssembler) ensureTextItem() (uint32, error) {
	if assembler.textItem != nil {
		return *assembler.textItem, nil
	}
	if len(assembler.toolItems) > 0 {
		return 0, gemma4OutputInvalid()
	}
	index := assembler.nextItem
	assembler.nextItem++
	assembler.textItem = &index
	assembler.openItems[index] = textbehavior.OrderedItemText
	return index, nil
}

func (assembler *gemma4StreamAssembler) appendToolFragments(value any) ([]textbehavior.OrderedDelta, error) {
	if value == nil {
		return nil, nil
	}
	rows, ok := value.([]any)
	if !ok {
		return nil, gemma4ToolCallInvalid()
	}
	type fragment struct {
		engineIndex         int
		id, name, arguments string
	}
	fragments := make([]fragment, 0, len(rows))
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok || (item["type"] != nil && gemma4String(item["type"]) != "function") {
			return nil, gemma4ToolCallInvalid()
		}
		engineIndex, ok := gemma4Integer(item["index"])
		if !ok || engineIndex < 0 || engineIndex > 31 {
			return nil, gemma4ToolCallInvalid()
		}
		function, _ := item["function"].(map[string]any)
		arguments, _ := function["arguments"].(string)
		fragments = append(fragments, fragment{engineIndex: engineIndex, id: gemma4RawString(item["id"]), name: gemma4RawString(function["name"]), arguments: arguments})
	}
	sort.SliceStable(fragments, func(i, j int) bool { return fragments[i].engineIndex < fragments[j].engineIndex })
	deltas := make([]textbehavior.OrderedDelta, 0, len(fragments))
	for _, value := range fragments {
		itemIndex, exists := assembler.toolItems[value.engineIndex]
		if !exists {
			if value.engineIndex != len(assembler.toolItems) {
				return nil, gemma4ToolCallInvalid()
			}
			itemIndex = assembler.nextItem
			assembler.nextItem++
			assembler.toolItems[value.engineIndex] = itemIndex
			assembler.openItems[itemIndex] = textbehavior.OrderedItemToolCall
		}
		part, err := assembler.ordered.AppendFragment(textbehavior.PrivateFragment{ItemIndex: itemIndex, Kind: textbehavior.OrderedItemToolCall, ToolCall: &textbehavior.ToolCallFragment{IDPart: value.id, NamePart: value.name, ArgumentsJSONPart: value.arguments}})
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, part...)
	}
	return deltas, nil
}

func (assembler *gemma4StreamAssembler) sealOpenItems() ([]textbehavior.OrderedDelta, error) {
	indices := make([]int, 0, len(assembler.openItems))
	for index := range assembler.openItems {
		indices = append(indices, int(index))
	}
	sort.Ints(indices)
	deltas := make([]textbehavior.OrderedDelta, 0, len(indices))
	for _, raw := range indices {
		index := uint32(raw)
		kind := assembler.openItems[index]
		fragment := textbehavior.PrivateFragment{ItemIndex: index, Kind: kind, Complete: true}
		if kind == textbehavior.OrderedItemToolCall {
			fragment.ToolCall = &textbehavior.ToolCallFragment{}
		}
		part, err := assembler.ordered.AppendFragment(fragment)
		if err != nil {
			return nil, err
		}
		deltas = append(deltas, part...)
		delete(assembler.openItems, index)
	}
	return deltas, nil
}

func (assembler *gemma4StreamAssembler) Finish() (textbehavior.NormalizedResult, error) {
	if assembler == nil || !assembler.sealed || assembler.finish == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
	}
	items, err := assembler.ordered.FinishItems()
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if assembler.finish == runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		hasCall := false
		for _, item := range items {
			hasCall = hasCall || item.Kind == textbehavior.OrderedItemToolCall
		}
		if !hasCall {
			return textbehavior.NormalizedResult{}, gemma4OutputInvalid()
		}
	}
	if err := gemma4ValidateStructuredItems(assembler.spec, items); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return textbehavior.NormalizedResult{Items: items, Usage: assembler.usage, FinishReason: assembler.finish}, nil
}

func gemma4ValidateStructuredItems(spec *runtimev1.TextGenerateScenarioSpec, items []textbehavior.OrderedItem) error {
	format := spec.GetResponseFormat()
	if format == nil || format.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED || format.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return nil
	}
	var text strings.Builder
	for _, item := range items {
		if item.Kind != textbehavior.OrderedItemText {
			return gemma4OutputInvalid()
		}
		text.WriteString(item.Text)
	}
	var instance any
	if err := gemma4DecodeJSON([]byte(strings.TrimSpace(text.String())), &instance); err != nil {
		return gemma4OutputInvalid()
	}
	switch format.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if _, ok := instance.(map[string]any); !ok {
			return gemma4OutputInvalid()
		}
		return nil
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if format.GetJsonSchema() == nil {
			return gemma4OutputInvalid()
		}
		schema, err := gemma4CompileSchema(format.GetJsonSchema().AsMap())
		if err != nil || schema.Validate(instance) != nil {
			return gemma4OutputInvalid()
		}
		return nil
	default:
		return gemma4OutputInvalid()
	}
}

func gemma4ValidateToolArguments(tool *runtimev1.ToolSpec, arguments string) error {
	var instance any
	if err := gemma4DecodeJSON([]byte(strings.TrimSpace(arguments)), &instance); err != nil {
		return gemma4ToolCallInvalid()
	}
	if _, ok := instance.(map[string]any); !ok {
		return gemma4ToolCallInvalid()
	}
	if tool == nil || tool.GetInputSchema() == nil {
		return nil
	}
	schema, err := gemma4CompileSchema(tool.GetInputSchema().AsMap())
	if err != nil || schema.Validate(instance) != nil {
		return gemma4ToolCallInvalid()
	}
	return nil
}

func gemma4CompileSchema(document map[string]any) (*jsonschema.Schema, error) {
	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(gemma4NoNetworkSchemaLoader{})
	if err := compiler.AddResource(gemma4SchemaResource, document); err != nil {
		return nil, err
	}
	return compiler.Compile(gemma4SchemaResource)
}

func gemma4DeclaredTool(spec *runtimev1.TextGenerateScenarioSpec, name string) *runtimev1.ToolSpec {
	for _, tool := range spec.GetTools() {
		if tool != nil && tool.GetName() == name {
			return tool
		}
	}
	return nil
}

func gemma4Usage(root map[string]any) *runtimev1.UsageStats {
	usage, _ := root["usage"].(map[string]any)
	input := gemma4Int64(usage["prompt_tokens"])
	output := gemma4Int64(usage["completion_tokens"])
	if output == 0 {
		total := gemma4Int64(usage["total_tokens"])
		if total > input {
			output = total - input
		}
	}
	compute := gemma4Int64(usage["compute_ms"])
	if compute == 0 {
		timings, _ := root["timings"].(map[string]any)
		compute = gemma4Int64(timings["prompt_ms"]) + gemma4Int64(timings["predicted_ms"])
	}
	if input == 0 && output == 0 && compute == 0 {
		return nil
	}
	return &runtimev1.UsageStats{InputTokens: input, OutputTokens: output, ComputeMs: compute}
}

func gemma4Int64(value any) int64 {
	switch typed := value.(type) {
	case json.Number:
		result, _ := typed.Int64()
		return result
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func gemma4TextContent(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		var result strings.Builder
		for _, raw := range typed {
			part, _ := raw.(map[string]any)
			if text := gemma4String(part["text"]); text != "" {
				result.WriteString(text)
			}
		}
		return result.String()
	default:
		return ""
	}
}

func gemma4FinishReason(value string) (runtimev1.FinishReason, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "stop":
		return runtimev1.FinishReason_FINISH_REASON_STOP, nil
	case "length", "max_tokens":
		return runtimev1.FinishReason_FINISH_REASON_LENGTH, nil
	case "tool_calls", "function_call":
		return runtimev1.FinishReason_FINISH_REASON_TOOL_CALL, nil
	case "content_filter":
		return runtimev1.FinishReason_FINISH_REASON_CONTENT_FILTER, nil
	default:
		return runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, gemma4OutputInvalid()
	}
}

func gemma4DecodeObject(payload []byte) (map[string]any, error) {
	var root map[string]any
	if err := gemma4DecodeJSON(payload, &root); err != nil || root == nil {
		return nil, fmt.Errorf("invalid JSON object")
	}
	return root, nil
}

func gemma4DecodeJSON(payload []byte, destination any) error {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.UseNumber()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("multiple JSON values")
		}
		return err
	}
	return nil
}

func gemma4Integer(value any) (int, bool) {
	switch typed := value.(type) {
	case json.Number:
		integer, err := typed.Int64()
		return int(integer), err == nil && integer >= 0 && int64(int(integer)) == integer
	case float64:
		integer := int(typed)
		return integer, float64(integer) == typed && integer >= 0
	default:
		return 0, false
	}
}

func gemma4RawString(value any) string { text, _ := value.(string); return text }
func gemma4String(value any) string    { return strings.TrimSpace(gemma4RawString(value)) }
func gemma4InvalidRequest(message string) error {
	return fmt.Errorf("Gemma 4 text behavior request: %s", message)
}
func gemma4OutputInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}
func gemma4ToolCallInvalid() error {
	return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_TOOL_CALL_INVALID)
}

func llamaBehaviorReasoningEnabled(spec *runtimev1.TextGenerateScenarioSpec) bool {
	if spec == nil || spec.GetReasoning() == nil {
		return false
	}
	switch spec.GetReasoning().GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE, runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		return true
	default:
		return false
	}
}
