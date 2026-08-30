package nimillm

import (
	"context"
	"encoding/json"
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
	includeRawChunks bool
	wireFields       *textWireFields
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
		includeRawChunks: spec.GetIncludeRawChunks(),
	}
}

func (b *Backend) supportsOpenAICompatibleTopK() bool {
	if b.isGeminiOpenAICompatibleBackend() {
		return false
	}
	return true
}

func (b *Backend) supportsOpenAICompatibleStreamOptions() bool {
	if b.isGeminiOpenAICompatibleBackend() {
		return false
	}
	return true
}

func (b *Backend) isGeminiOpenAICompatibleBackend() bool {
	if b == nil {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(b.Name))
	base := strings.ToLower(strings.TrimSpace(b.baseURL))
	// Gemini's OpenAI-compatible chat surface is OpenAI-shaped, but not a byte-for-byte
	// superset of OpenAI chat options. Provider-specific wire omissions stay here so
	// the Runtime spec remains stable and other OpenAI-compatible backends keep pass-through.
	if strings.Contains(name, "gemini") || strings.Contains(base, "generativelanguage.googleapis.com") {
		return true
	}
	return false
}

func (p textGenParams) hasTools() bool {
	return len(p.tools) > 0
}

func (p textGenParams) requestsToolUse() bool {
	return p.hasTools() || p.toolChoice != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED || strings.TrimSpace(p.toolChoiceName) != ""
}

func (p textGenParams) hasProviderTools() bool {
	for _, tool := range p.tools {
		if tool != nil && tool.GetKind() == runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER {
			return true
		}
	}
	return false
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
		if tool.GetKind() == runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER {
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
func parseOpenAIToolCalls(respBody map[string]any) ([]*runtimev1.ToolCall, error) {
	choices, ok := respBody["choices"].([]any)
	if !ok || len(choices) == 0 {
		return nil, nil
	}
	first, ok := choices[0].(map[string]any)
	if !ok {
		return nil, nil
	}
	message, ok := first["message"].(map[string]any)
	if !ok {
		return nil, nil
	}
	rawCalls, ok := message["tool_calls"].([]any)
	if !ok || len(rawCalls) == 0 {
		return nil, nil
	}
	calls := make([]*runtimev1.ToolCall, 0, len(rawCalls))
	seenIDs := make(map[string]struct{}, len(rawCalls))
	for _, raw := range rawCalls {
		callMap, ok := raw.(map[string]any)
		if !ok {
			return nil, invalidCanonicalToolTurn("provider tool call is malformed")
		}
		function, ok := callMap["function"].(map[string]any)
		if !ok {
			return nil, invalidCanonicalToolTurn("provider tool call function is missing")
		}
		id := strings.TrimSpace(ValueAsString(callMap["id"]))
		name := strings.TrimSpace(ValueAsString(function["name"]))
		arguments := strings.TrimSpace(ValueAsString(function["arguments"]))
		if id == "" || name == "" {
			return nil, invalidCanonicalToolTurn("provider tool call id and name are required")
		}
		if _, duplicate := seenIDs[id]; duplicate {
			return nil, invalidCanonicalToolTurn("provider tool call id is duplicated")
		}
		seenIDs[id] = struct{}{}
		if arguments == "" {
			arguments = "{}"
		}
		var argumentsObject map[string]any
		if err := json.Unmarshal([]byte(arguments), &argumentsObject); err != nil || argumentsObject == nil {
			return nil, invalidCanonicalToolTurn("provider tool call arguments_json must be one JSON object")
		}
		calls = append(calls, &runtimev1.ToolCall{
			Id:            id,
			Name:          name,
			ArgumentsJson: arguments,
		})
	}
	return calls, nil
}

func validateReturnedToolCalls(calls []*runtimev1.ToolCall, specs []*runtimev1.ToolSpec) error {
	if len(calls) == 0 {
		return nil
	}
	declared := make(map[string]struct{}, len(specs))
	for _, spec := range specs {
		if spec != nil && spec.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_PROVIDER {
			if name := strings.TrimSpace(spec.GetName()); name != "" {
				declared[name] = struct{}{}
			}
		}
	}
	for _, call := range calls {
		if call == nil {
			return invalidCanonicalToolTurn("provider tool call is missing")
		}
		if _, ok := declared[strings.TrimSpace(call.GetName())]; !ok {
			return invalidCanonicalToolTurn("provider tool call names no declared ToolSpec")
		}
	}
	return nil
}

// textBehaviorUnsupportedError is the typed fail-closed result when no exact
// private adapter owns the requested behavior mapping.
func textBehaviorUnsupportedError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)
}

func providerRawChunksUnsupportedError() error {
	return grpcerr.WithReasonCodeOptions(codes.Unimplemented, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, grpcerr.ReasonOptions{
		ActionHint: "raw_chunks_require_true_provider_stream_chunk_capture",
	})
}

// unsupportedTextBehaviorSurface admits Tool Use or Structured Output only
// with one request-scoped exact adapter proof. Current stream serializers have
// no registered ordered Tool/Structured mapping and therefore stay closed.
func unsupportedTextBehaviorSurface(ctx context.Context, backend *Backend, modelID string, params textGenParams, input []*runtimev1.ChatMessage, stream bool) error {
	if params.includeRawChunks {
		return providerRawChunksUnsupportedError()
	}
	turnToolUse, turnReasoning := textMessagesRequestBehavior(input)
	toolUse := params.requestsToolUse() || turnToolUse
	structured := params.wantsStructuredOutput()
	if turnReasoning || params.hasProviderTools() {
		return textBehaviorUnsupportedError()
	}
	if !toolUse && !structured {
		return nil
	}
	admission := textBehaviorAdmissionFromContext(ctx)
	if admission == nil || !textBehaviorAdmissionMatchesTarget(admission, backend, modelID) ||
		(toolUse && !admission.ToolUse) || (structured && !admission.StructuredOutput) ||
		(toolUse && structured && !admission.ToolStructuredCombination) ||
		(stream && !admission.Stream) || (!stream && !admission.Sync && !admission.Async) {
		return textBehaviorUnsupportedError()
	}
	if stream {
		return textBehaviorUnsupportedError()
	}
	return nil
}

func textBehaviorAdmissionMatchesTarget(admission *TextBehaviorAdmission, backend *Backend, modelID string) bool {
	if admission == nil || backend == nil || strings.TrimSpace(modelID) == "" || modelID != strings.TrimSpace(modelID) {
		return false
	}
	provider := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(backend.Name)), "cloud-")
	provider = ResolveProviderAlias(provider)
	return provider == admission.Provider && modelID == admission.ProviderModelID
}
