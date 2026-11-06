package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

type SiliconFlowTextBehavior struct{ model string }

func SiliconFlowTextModels() []string {
	return []string{"deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4-Flash", "deepseek-ai/DeepSeek-V4-Pro", "Pro/zai-org/GLM-5.2", "Pro/zai-org/GLM-5.1", "Qwen/Qwen3.8-27B", "moonshotai/Kimi-K2.7-Code"}
}
func NewSiliconFlowTextBehavior(model string) (SiliconFlowTextBehavior, error) {
	if !contains(SiliconFlowTextModels(), model) {
		return SiliconFlowTextBehavior{}, siliconFlowUnsupported("unreviewed model")
	}
	return SiliconFlowTextBehavior{model: model}, nil
}
func siliconFlowUnsupported(detail string) error {
	return (&responsesProfile{label: "SiliconFlow Chat Completions"}).unsupported(detail)
}
func (p SiliconFlowTextBehavior) ContinuityKind() string {
	return "siliconflow." + p.model + ".reasoning-content"
}
func (p SiliconFlowTextBehavior) Vision() bool {
	return p.model == "Qwen/Qwen3.8-27B" || p.model == "moonshotai/Kimi-K2.7-Code"
}
func (p SiliconFlowTextBehavior) Qwen() bool { return p.model == "Qwen/Qwen3.8-27B" }
func (p SiliconFlowTextBehavior) NativeEffort() bool {
	return p.model == "deepseek-ai/DeepSeek-V4-Flash" || p.model == "Pro/zai-org/GLM-5.2"
}
func (p SiliconFlowTextBehavior) reasoning(s *runtimev1.TextGenerateScenarioSpec) (map[string]any, bool, error) {
	r := s.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return nil, false, siliconFlowUnsupported("raw reasoning is not a summary")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil {
		return nil, false, nil
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && r.GetIntensity() == nil && p.Qwen() {
		return map[string]any{"enable_thinking": false}, true, nil
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED || !p.Qwen() && !p.NativeEffort() {
		return nil, false, siliconFlowUnsupported("unreviewed thinking controls; omit to retain native defaults")
	}
	body := map[string]any{"enable_thinking": true}
	if budget, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_ExactBudgetTokens); ok {
		if !p.Qwen() || budget.ExactBudgetTokens < 128 || budget.ExactBudgetTokens > 32768 {
			return nil, false, siliconFlowUnsupported("native thinking budget is exact only on the reviewed Qwen path")
		}
		body["thinking_budget"] = budget.ExactBudgetTokens
		return body, false, nil
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, false, siliconFlowUnsupported("reasoning intensity")
	}
	if r.GetEffort() == runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		return body, false, nil
	}
	if !p.NativeEffort() {
		return nil, false, siliconFlowUnsupported("relative effort is not an exact Qwen thinking budget")
	}
	switch r.GetEffort() {
	case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
		body["reasoning_effort"] = "high"
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
		body["reasoning_effort"] = "max"
	default:
		return nil, false, siliconFlowUnsupported("native effort would collapse to another tier")
	}
	return body, false, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p SiliconFlowTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p SiliconFlowTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.Seed != nil || s.PresencePenalty != nil || s.GetTopK() > 100 || len(s.GetStop()) > 4 || len(s.GetTools()) > 128 {
		return textbehavior.SerializedRequest{}, siliconFlowUnsupported("unreviewed sampling or tool controls")
	}
	controls, disabled, err := p.reasoning(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	// Native max_tokens caps only the visible answer. Never advertise it as a
	// total output cap while an independent thinking channel remains enabled.
	if s.MaxTokens != nil && !disabled {
		return textbehavior.SerializedRequest{}, siliconFlowUnsupported("native max_tokens excludes reasoning; a total output cap requires reviewed thinking-off mode")
	}
	if s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE || s.GetToolChoiceName() != "" {
		return textbehavior.SerializedRequest{}, siliconFlowUnsupported("forced or named tool choice")
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
		if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, siliconFlowUnsupported("structured fields require JSON Schema format")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if len(s.GetTools()) > 0 || f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, siliconFlowUnsupported("JSON object combination")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if f.GetSchemaName() != "" && !deepseekFunctionName(f.GetSchemaName()) {
			return textbehavior.SerializedRequest{}, siliconFlowUnsupported("schema name must be 1-64 ASCII letters, digits, underscores or hyphens")
		}
		if len(s.GetTools()) > 0 || !f.GetStrict() || f.GetJsonSchema() == nil {
			return textbehavior.SerializedRequest{}, siliconFlowUnsupported("strict schema requires a separate request")
		}
		if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
			return textbehavior.SerializedRequest{}, siliconFlowUnsupported("schema outside reviewed closed basic subset")
		}
	default:
		return textbehavior.SerializedRequest{}, siliconFlowUnsupported("response format")
	}
	messages, err := chatCompletionMessagesWithReplay(s, func(m *runtimev1.ChatMessage) (any, error) {
		return ownedChatRasterContent(m, planning, p.Vision(), 32<<20, siliconFlowUnsupported)
	}, p.ContinuityKind(), false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"messages": messages, "stream": stream}
	for k, v := range controls {
		body[k] = v
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		if s.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
			delete(body, "tools")
			delete(body, "tool_choice")
		}
	}
	if s.MaxTokens != nil {
		body["max_tokens"] = s.GetMaxTokens()
	}
	if s.Temperature != nil {
		body["temperature"] = s.GetTemperature()
	}
	if s.TopP != nil {
		body["top_p"] = s.GetTopP()
	}
	if s.TopK != nil {
		body["top_k"] = s.GetTopK()
	}
	if s.FrequencyPenalty != nil {
		body["frequency_penalty"] = s.GetFrequencyPenalty()
	}
	if len(s.GetStop()) > 0 {
		body["stop"] = s.GetStop()
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		name := f.GetSchemaName()
		if name == "" {
			name = "response"
		}
		schema := map[string]any{"name": name, "schema": f.GetJsonSchema().AsMap(), "strict": true}
		if f.GetSchemaDescription() != "" {
			schema["description"] = f.GetSchemaDescription()
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": schema}
	}
	data, err := json.Marshal(body)
	if len(data) > 32<<20 {
		return textbehavior.SerializedRequest{}, siliconFlowUnsupported("request envelope exceeds 32 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}
func (p SiliconFlowTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(32<<20, int64(len(wire.Payload)))
	return prepared, budget, err
}
func (p SiliconFlowTextBehavior) envelope(data []byte, seen, disabled bool) (bool, error) {
	var e struct {
		Model   string          `json:"model"`
		Error   json.RawMessage `json:"error"`
		Code    int             `json:"code"`
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message *struct {
				Reasoning *string `json:"reasoning_content"`
			} `json:"message"`
			Delta *struct {
				Reasoning *string `json:"reasoning_content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if !utf8.Valid(data) || json.Unmarshal(data, &e) != nil {
		return seen, deepseekJSONOutputError()
	}
	if len(e.Error) > 0 && string(e.Error) != "null" {
		return seen, fireworksStreamError(e.Error)
	}
	if e.Code != 0 {
		if e.Code == 20012 {
			return seen, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return seen, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if e.Model != "" {
		if e.Model != p.model {
			return seen, deepseekJSONOutputError()
		}
		seen = true
	}
	if !seen {
		return false, deepseekJSONOutputError()
	}
	for _, c := range e.Choices {
		if c.Finish == "length" {
			return seen, deepseekIncomplete()
		}
		if disabled && (c.Message != nil && c.Message.Reasoning != nil && *c.Message.Reasoning != "" || c.Delta != nil && c.Delta.Reasoning != nil && *c.Delta.Reasoning != "") {
			return seen, deepseekJSONOutputError()
		}
	}
	return seen, nil
}
func siliconFlowResult(r textbehavior.NormalizedResult, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && r.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		return validateStrictChatSchemaResult(r, s)
	}
	return r, nil
}
func (p SiliconFlowTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	_, disabled, err := p.reasoning(s)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if _, err = p.envelope(data, false, disabled); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	r, err := parseReasoningChatResponseWithPolicy(data, s, p.ContinuityKind(), false)
	if err != nil {
		return r, err
	}
	return siliconFlowResult(r, s)
}

type siliconFlowStream struct {
	profile        SiliconFlowTextBehavior
	spec           *runtimev1.TextGenerateScenarioSpec
	inner          textbehavior.StreamFragmentAssembler
	seen, disabled bool
}

func (p SiliconFlowTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	_, disabled, err := p.reasoning(s)
	if err != nil {
		return nil, err
	}
	inner := newReasoningChatStream(s, p.ContinuityKind()).(*reasoningChatStream)
	inner.optional = true
	return &siliconFlowStream{profile: p, spec: s, inner: inner, disabled: disabled}, nil
}
func (s *siliconFlowStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) != "[DONE]" {
		var err error
		s.seen, err = s.profile.envelope(data, s.seen, s.disabled)
		if err != nil {
			return nil, err
		}
	}
	return s.inner.Append(data)
}
func (s *siliconFlowStream) Finish() (textbehavior.NormalizedResult, error) {
	r, err := s.inner.Finish()
	if err != nil {
		return r, err
	}
	return siliconFlowResult(r, s.spec)
}
