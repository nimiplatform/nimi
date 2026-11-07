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

type SparkTextBehavior struct{ provider, model string }

func NewSparkTextBehavior(provider, model string) (SparkTextBehavior, error) {
	if provider == "spark" && (model == "4.0Ultra" || model == "lite") || provider == "spark_reasoning" && model == "spark-x" {
		return SparkTextBehavior{provider: provider, model: model}, nil
	}
	return SparkTextBehavior{}, sparkUnsupported("unreviewed exact target")
}
func sparkUnsupported(detail string) error {
	return (&responsesProfile{label: "Spark native Chat"}).unsupported(detail)
}
func (p SparkTextBehavior) Reasoning() bool     { return p.provider == "spark_reasoning" }
func (p SparkTextBehavior) Tools() bool         { return p.model != "lite" }
func (p SparkTextBehavior) OrderedSystem() bool { return p.model == "4.0Ultra" }
func (p SparkTextBehavior) reasoning(r *runtimev1.ReasoningConfig) (string, error) {
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil && (r.GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED || r.GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN) {
		return "", nil
	}
	if !p.Reasoning() || r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", sparkUnsupported("reasoning presentation or model")
	}
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if r.GetIntensity() != nil {
			return "", sparkUnsupported("disabled thinking intensity")
		}
		return "disabled", nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED, runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE:
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok || r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
			return "", sparkUnsupported("native default thinking intensity required")
		}
		if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE {
			return "auto", nil
		}
		return "enabled", nil
	default:
		return "", sparkUnsupported("reasoning activation")
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p SparkTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.Seed != nil || len(s.GetStop()) > 0 || s.TopP != nil && s.GetTopP() <= 0 || s.TopK != nil && (s.GetTopK() < 1 || s.GetTopK() > 6) || s.PresencePenalty != nil && s.GetPresencePenalty() < 0 || s.FrequencyPenalty != nil && (s.GetFrequencyPenalty() < 0 || s.GetFrequencyPenalty() > 1) || p.Reasoning() && s.Temperature != nil && s.GetTemperature() <= 0 {
		return textbehavior.SerializedRequest{}, sparkUnsupported("sampling control")
	}
	thinking, err := p.reasoning(s.GetReasoning())
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	limit := int32(32768)
	if p.model == "lite" {
		limit = 4096
	}
	if p.Reasoning() {
		limit = 131072
	}
	if s.MaxTokens != nil && (s.GetMaxTokens() < 1 || s.GetMaxTokens() > limit || p.Reasoning() && thinking != "disabled") {
		return textbehavior.SerializedRequest{}, sparkUnsupported("X2 total-output cap is unreviewed while thinking is enabled; native output bounds")
	}
	f := s.GetResponseFormat()
	if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
		return textbehavior.SerializedRequest{}, sparkUnsupported("strict schema")
	}
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if p.Reasoning() || len(s.GetTools()) > 0 {
			return textbehavior.SerializedRequest{}, sparkUnsupported("JSON mode combination")
		}
	default:
		return textbehavior.SerializedRequest{}, sparkUnsupported("response format")
	}
	messages, err := chatCompletionMessagesWithReplay(s, nil, "", false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if !p.OrderedSystem() {
		for _, m := range messages {
			if m["role"] == "system" {
				return textbehavior.SerializedRequest{}, sparkUnsupported("system messages on this model")
			}
		}
	}
	body := map[string]any{"messages": messages, "stream": stream}
	if len(s.GetTools()) > 0 {
		if !p.Tools() {
			return textbehavior.SerializedRequest{}, sparkUnsupported("Lite functions")
		}
		if !p.Reasoning() {
			for _, tool := range s.GetTools() {
				if len(tool.GetName()) > 32 || strings.Contains(tool.GetName(), "-") || strings.TrimSpace(tool.GetDescription()) == "" {
					return textbehavior.SerializedRequest{}, sparkUnsupported("Ultra function name or description")
				}
			}
		}
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		if p.Reasoning() && s.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL {
			body["tool_choice"] = map[string]any{"type": "function", "name": s.GetToolChoiceName()}
		}
		if !p.Reasoning() {
			body["tool_calls_switch"] = true
		}
	} else if s.GetToolChoiceName() != "" || s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
		return textbehavior.SerializedRequest{}, sparkUnsupported("choice without tools")
	}
	if p.model == "4.0Ultra" {
		nativeTools, _ := body["tools"].([]map[string]any)
		body["tools"] = append(nativeTools, map[string]any{"type": "web_search", "web_search": map[string]any{"enable": false}})
	}
	if p.Reasoning() && len(s.GetTools()) == 0 {
		body["tools"] = []any{map[string]any{"type": "web_search", "web_search": map[string]any{"enable": false}}}
	}
	if thinking != "" {
		body["thinking"] = map[string]any{"type": thinking}
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
	if s.PresencePenalty != nil {
		body["presence_penalty"] = s.GetPresencePenalty()
	}
	if s.FrequencyPenalty != nil {
		body["frequency_penalty"] = s.GetFrequencyPenalty()
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	data, err := json.Marshal(body)
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}
func (p SparkTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, p.Serialize, stream)
	_, err := p.Serialize(prepared, stream)
	return prepared, nil, err
}

type sparkMessage struct {
	Role      string          `json:"role,omitempty"`
	Content   *string         `json:"content,omitempty"`
	Reasoning *string         `json:"reasoning_content,omitempty"`
	ToolCalls json.RawMessage `json:"tool_calls,omitempty"`
	Refusal   *string         `json:"refusal,omitempty"`
	Security  *struct {
		Action string `json:"action"`
	} `json:"security_suggest,omitempty"`
}
type sparkEnvelope struct {
	Code    *int            `json:"code"`
	Error   json.RawMessage `json:"error"`
	SID     string          `json:"sid"`
	ID      string          `json:"id"`
	Model   string          `json:"model"`
	Status  json.RawMessage `json:"status"`
	Choices []struct {
		Index   *int          `json:"index"`
		Message *sparkMessage `json:"message,omitempty"`
		Delta   *sparkMessage `json:"delta,omitempty"`
		Finish  *string       `json:"finish_reason,omitempty"`
	} `json:"choices"`
	Usage *struct {
		Input  *int64 `json:"prompt_tokens"`
		Output *int64 `json:"completion_tokens"`
		Total  *int64 `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

func (p SparkTextBehavior) decode(data []byte, sid string, disabled bool) (sparkEnvelope, error) {
	var e sparkEnvelope
	if !utf8.Valid(data) || json.Unmarshal(data, &e) != nil {
		return e, deepseekJSONOutputError()
	}
	if len(e.Error) > 0 && string(e.Error) != "null" {
		return e, fireworksStreamError(e.Error)
	}
	if e.Code == nil {
		return e, deepseekJSONOutputError()
	}
	if *e.Code != 0 {
		return e, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	switch string(e.Status) {
	case "", "null", "0", "1", "2", `"complete"`:
	default:
		return e, deepseekJSONOutputError()
	}
	if e.SID == "" || sid != "" && e.SID != sid || e.ID != "" && e.ID != e.SID || e.Model != "" && e.Model != p.model || len(e.Choices) != 1 || e.Choices[0].Index == nil || *e.Choices[0].Index != 0 {
		return e, deepseekJSONOutputError()
	}
	for _, m := range []*sparkMessage{e.Choices[0].Message, e.Choices[0].Delta} {
		if m == nil {
			continue
		}
		if m.Role != "" && m.Role != "assistant" {
			return e, deepseekJSONOutputError()
		}
		if m.Security != nil && m.Security.Action != "" {
			return e, deepseekRefused()
		}
		if m.Reasoning != nil && *m.Reasoning != "" && (disabled || !p.Reasoning()) {
			return e, deepseekJSONOutputError()
		}
		m.Reasoning = nil
		m.Security = nil
	}
	if u := e.Usage; u != nil {
		if u.Input == nil || u.Output == nil || *u.Input < 0 || *u.Output < 0 || u.Total != nil && *u.Total < 0 {
			return e, deepseekJSONOutputError()
		}
	}
	return e, nil
}
func sparkHasCalls(m *sparkMessage) bool {
	return m != nil && len(m.ToolCalls) > 0 && string(m.ToolCalls) != "null" && string(m.ToolCalls) != "[]"
}
func sparkEnd(e sparkEnvelope) bool {
	if string(e.Status) == "0" || string(e.Status) == "1" {
		return false
	}
	return e.Usage != nil || string(e.Status) == `"complete"` || string(e.Status) == "2"
}
func sparkStop(tools bool) *string {
	// Legacy Spark reports a successful native terminal without an OpenAI
	// finish_reason. Normalize that terminal only after its code, sid and end
	// frame are validated; token counts never manufacture a stop or truncation.
	v := "stop"
	if tools {
		v = "tool_calls"
	}
	return &v
}
func (p SparkTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	thinking, err := p.reasoning(s.GetReasoning())
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	e, err := p.decode(data, "", thinking == "disabled")
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if !sparkEnd(e) || e.Choices[0].Message == nil || e.Choices[0].Delta != nil {
		return textbehavior.NormalizedResult{}, deepseekIncomplete()
	}
	if e.Choices[0].Finish == nil {
		e.Choices[0].Finish = sparkStop(sparkHasCalls(e.Choices[0].Message))
	}
	clean, _ := json.Marshal(e)
	if len(s.GetTools()) > 0 {
		return parseDeepseekToolResponse(clean, s)
	}
	return parseChatTextResponse(clean, s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
}

type sparkStream struct {
	profile                SparkTextBehavior
	inner                  textbehavior.StreamFragmentAssembler
	sid                    string
	disabled, tools, ended bool
}

func (p SparkTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	thinking, err := p.reasoning(s.GetReasoning())
	if err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler = &deepseekJSONStream{plainText: s.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if len(s.GetTools()) > 0 {
		inner = newDeepseekToolStream(s)
	}
	return &sparkStream{profile: p, inner: inner, disabled: thinking == "disabled"}, nil
}
func (s *sparkStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) == "[DONE]" {
		if !s.ended {
			return nil, deepseekIncomplete()
		}
		return s.inner.Append(data)
	}
	e, err := s.profile.decode(data, s.sid, s.disabled)
	if err != nil {
		return nil, err
	}
	s.sid = e.SID
	c := &e.Choices[0]
	if c.Delta == nil || c.Message != nil {
		return nil, deepseekJSONOutputError()
	}
	if s.ended {
		if e.Usage == nil || c.Delta.Content != nil && *c.Delta.Content != "" || sparkHasCalls(c.Delta) || c.Finish != nil {
			return nil, deepseekJSONOutputError()
		}
		e.Choices = e.Choices[:0]
	} else {
		s.tools = s.tools || sparkHasCalls(c.Delta)
		if c.Finish == nil && sparkEnd(e) {
			c.Finish = sparkStop(s.tools)
		}
		if c.Finish != nil {
			s.ended = true
		}
	}
	clean, _ := json.Marshal(e)
	return s.inner.Append(clean)
}
func (s *sparkStream) Finish() (textbehavior.NormalizedResult, error) { return s.inner.Finish() }
