package nimillm

import (
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// textGenParams carries the tool, structured-output, and advanced-sampling
// surface of a text generation request from the scenario spec down to the
// provider backend. It keeps GenerateText/StreamGenerateText signatures stable
// while threading the new contract fields.
type textGenParams struct {
	tools            []*runtimev1.ToolSpec
	toolChoice       runtimev1.ToolChoiceMode
	toolChoiceName   string
	responseFormat   *runtimev1.ResponseFormat
	presencePenalty  float32
	frequencyPenalty float32
	stop             []string
	seed             int64
	topK             int32
}

// BuildTextGenParams projects the scenario spec onto the backend tool/sampling
// surface. top_k is pass-through: Runtime does not pre-judge provider/model
// support, but it must not silently drop a caller-supplied value.
func BuildTextGenParams(spec *runtimev1.TextGenerateScenarioSpec) textGenParams {
	if spec == nil {
		return textGenParams{}
	}
	return textGenParams{
		tools:            spec.GetTools(),
		toolChoice:       spec.GetToolChoice(),
		toolChoiceName:   spec.GetToolChoiceName(),
		responseFormat:   spec.GetResponseFormat(),
		presencePenalty:  spec.GetPresencePenalty(),
		frequencyPenalty: spec.GetFrequencyPenalty(),
		stop:             append([]string(nil), spec.GetStop()...),
		seed:             spec.GetSeed(),
		topK:             spec.GetTopK(),
	}
}

func (p textGenParams) hasTools() bool {
	return len(p.tools) > 0
}

// TextScenarioUsesToolSurface reports whether the spec requests tools or a
// non-text response format. The streaming text path does not yet execute these
// end-to-end and fails closed when they are present.
func TextScenarioUsesToolSurface(spec *runtimev1.TextGenerateScenarioSpec) bool {
	params := BuildTextGenParams(spec)
	return params.hasTools() || params.wantsStructuredOutput()
}

// wantsStructuredOutput reports whether a non-text response format was requested.
func (p textGenParams) wantsStructuredOutput() bool {
	if p.responseFormat == nil {
		return false
	}
	switch p.responseFormat.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT,
		runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		return true
	default:
		return false
	}
}

// openAIToolsPayload maps Nimi tool specs onto OpenAI Chat Completions tools.
func openAIToolsPayload(tools []*runtimev1.ToolSpec) []map[string]any {
	if len(tools) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		if tool == nil || strings.TrimSpace(tool.GetName()) == "" {
			continue
		}
		function := map[string]any{"name": tool.GetName()}
		if description := strings.TrimSpace(tool.GetDescription()); description != "" {
			function["description"] = description
		}
		if schema := tool.GetInputSchema(); schema != nil {
			function["parameters"] = schema.AsMap()
		}
		out = append(out, map[string]any{"type": "function", "function": function})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// openAIToolChoicePayload maps the tool-choice mode onto OpenAI's tool_choice.
func openAIToolChoicePayload(mode runtimev1.ToolChoiceMode, name string) any {
	switch mode {
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO:
		return "auto"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
		return "none"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
		return "required"
	case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
		if strings.TrimSpace(name) != "" {
			return map[string]any{"type": "function", "function": map[string]any{"name": strings.TrimSpace(name)}}
		}
		return "required"
	default:
		return nil
	}
}

// openAIResponseFormatPayload maps the response format onto OpenAI's response_format.
func openAIResponseFormatPayload(responseFormat *runtimev1.ResponseFormat) map[string]any {
	if responseFormat == nil {
		return nil
	}
	switch responseFormat.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		return map[string]any{"type": "json_object"}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		schema := map[string]any{}
		if responseFormat.GetJsonSchema() != nil {
			schema = responseFormat.GetJsonSchema().AsMap()
		}
		jsonSchema := map[string]any{"schema": schema}
		if name := strings.TrimSpace(responseFormat.GetSchemaName()); name != "" {
			jsonSchema["name"] = name
		} else {
			jsonSchema["name"] = "response"
		}
		if description := strings.TrimSpace(responseFormat.GetSchemaDescription()); description != "" {
			jsonSchema["description"] = description
		}
		if responseFormat.GetStrict() {
			jsonSchema["strict"] = true
		}
		return map[string]any{"type": "json_schema", "json_schema": jsonSchema}
	default:
		return nil
	}
}

// parseOpenAIToolCalls extracts tool calls from an OpenAI Chat Completions
// response message.
func parseOpenAIToolCalls(respBody map[string]any) []*runtimev1.ToolCall {
	choices, ok := respBody["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil
	}
	first, ok := choices[0].(map[string]any)
	if !ok {
		return nil
	}
	message, ok := first["message"].(map[string]any)
	if !ok {
		return nil
	}
	rawCalls, ok := message["tool_calls"].([]any)
	if !ok || len(rawCalls) == 0 {
		return nil
	}
	calls := make([]*runtimev1.ToolCall, 0, len(rawCalls))
	for _, raw := range rawCalls {
		callMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		function, _ := callMap["function"].(map[string]any)
		name := strings.TrimSpace(ValueAsString(function["name"]))
		if name == "" {
			continue
		}
		calls = append(calls, &runtimev1.ToolCall{
			Id:            strings.TrimSpace(ValueAsString(callMap["id"])),
			Name:          name,
			ArgumentsJson: ValueAsString(function["arguments"]),
		})
	}
	if len(calls) == 0 {
		return nil
	}
	return calls
}

// providerToolUnsupportedError is the typed fail-closed error for provider
// paths that do not yet execute tools or structured output end-to-end.
func providerToolUnsupportedError() error {
	return grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
}

// unsupportedToolSurface returns a typed fail-closed error when tools or
// structured output are requested on a provider path that does not yet
// execute them. It returns nil when the request carries neither.
func unsupportedToolSurface(params textGenParams) error {
	if params.hasTools() || params.wantsStructuredOutput() {
		return providerToolUnsupportedError()
	}
	return nil
}
