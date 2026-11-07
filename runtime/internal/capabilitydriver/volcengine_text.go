package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

const volcengineTextBodyLimit = 64_000_000

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p VolcengineTextBehavior) reasoning(s *runtimev1.TextGenerateScenarioSpec) (map[string]any, bool, error) {
	r := s.GetReasoning()
	presentation := r.GetPresentation()
	if presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN && !(p.EncryptedReasoning() && presentation == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY) {
		return nil, false, volcengineTextUnsupported("only documented native summaries may be exposed")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil && presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
		return nil, p.HasThinking(), nil
	}
	if !p.HasThinking() {
		return nil, false, volcengineTextUnsupported("this target has no reviewed explicit thinking control")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && r.GetIntensity() == nil && presentation != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY && !p.AlwaysThinking() {
		return map[string]any{"thinking": map[string]string{"type": "disabled"}}, false, nil
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
		return nil, false, volcengineTextUnsupported("thinking activation")
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, false, volcengineTextUnsupported("select an exact supported effort or model default, not a token budget")
	}
	allowed := false
	for _, effort := range p.Efforts() {
		allowed = allowed || effort == r.GetEffort()
	}
	if !allowed {
		return nil, false, volcengineTextUnsupported("the native effort would disable thinking or collapse into another tier")
	}
	body := map[string]any{}
	if p.model != "kimi-k3-1-pro-261024" {
		body["thinking"] = map[string]string{"type": "enabled"}
	}
	if r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		body["reasoning_effort"] = map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}[r.GetEffort()]
	}
	return body, true, nil
}

func (p VolcengineTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p VolcengineTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.TopK != nil || s.Seed != nil || len(s.GetTools()) > 128 {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("unreviewed controls or tools")
	}
	controls, thinking, err := p.reasoning(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	limit := int32(65536)
	if s.MaxTokens != nil && (s.GetMaxTokens() < 1 || s.GetMaxTokens() > limit) {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("output limit")
	}
	if s.Temperature != nil && !(s.GetTemperature() >= 0 && s.GetTemperature() <= 2) || s.TopP != nil && !(s.GetTopP() >= 0 && s.GetTopP() <= 1) {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("sampling bounds")
	}
	if p.model == "doubao-seed-2-0-pro-260215" || p.model == "kimi-k3-1-pro-261024" {
		if s.Temperature != nil && s.GetTemperature() != 1 || s.TopP != nil && s.GetTopP() != .95 {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("this target has fixed temperature1 and top_p0.95")
		}
	}
	if p.deepseek41() && s.TopP != nil && (thinking && s.GetTopP() < .95 || !thinking && s.GetTopP() != 1) {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("native top_p would be changed or ignored")
	}
	penalty := func(v *float32) bool {
		if v == nil {
			return true
		}
		if !(*v >= -2 && *v <= 2) {
			return false
		}
		if p.model == "kimi-k3-1-pro-261024" {
			return *v == 0
		}
		if strings.HasPrefix(p.model, "doubao-seed-2-") || p.model == "doubao-seed-evolving" || p.deepseek41() {
			return false
		}
		if strings.HasPrefix(p.model, "deepseek-v4-") {
			return !thinking
		}
		return true
	}
	if !penalty(s.FrequencyPenalty) || !penalty(s.PresencePenalty) {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("native penalty control is unavailable for this mode")
	}
	maxStop := 4
	if strings.HasPrefix(p.model, "deepseek-v4-") {
		maxStop = 16
	} else if p.model == "kimi-k3-1-pro-261024" {
		maxStop = 5
	} else if p.HasThinking() {
		maxStop = 0
	}
	if len(s.GetStop()) > maxStop {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("stop sequences")
	}
	for _, stop := range s.GetStop() {
		if stop == "" {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("empty stop sequence")
		}
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
		if f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("format fields without a structured format")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if !p.Schema() || len(s.GetTools()) > 0 || f.GetStrict() || f.GetJsonSchema() != nil || f.GetSchemaName() != "" || f.GetSchemaDescription() != "" {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("JSON object combination")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if !p.Schema() || len(s.GetTools()) > 0 || f.GetJsonSchema() == nil || s.FrequencyPenalty != nil || s.PresencePenalty != nil || f.GetSchemaName() != "" && !deepseekFunctionName(f.GetSchemaName()) {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("JSON Schema combination")
		}
		if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
			return textbehavior.SerializedRequest{}, volcengineTextUnsupported("schema outside the reviewed basic subset")
		}
	default:
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("response format")
	}
	prepared, err := p.withoutDisplaySummaries(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages, err := chatCompletionMessagesWithReplay(prepared, func(m *runtimev1.ChatMessage) (any, error) { return p.messageContent(m, planning) }, p.ContinuityKind(), false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if p.EncryptedReasoning() {
		for _, message := range messages {
			if replay, ok := message["reasoning_content"]; ok {
				message["encrypted_content"] = replay
				delete(message, "reasoning_content")
			}
		}
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream}
	for k, v := range controls {
		body[k] = v
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
	} else if s.GetToolChoiceName() != "" || s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && s.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("tool choice without declarations")
	}
	if s.MaxTokens != nil {
		body["max_completion_tokens"] = s.GetMaxTokens()
	}
	if s.Temperature != nil {
		body["temperature"] = s.GetTemperature()
	}
	if s.TopP != nil {
		body["top_p"] = s.GetTopP()
	}
	if s.FrequencyPenalty != nil {
		body["frequency_penalty"] = s.GetFrequencyPenalty()
	}
	if s.PresencePenalty != nil {
		body["presence_penalty"] = s.GetPresencePenalty()
	}
	if len(s.GetStop()) > 0 {
		body["stop"] = s.GetStop()
	}
	if stream && p.model != "deepseek-v4-1-flash-261017" && p.model != "deepseek-v4-1-flash-economy-261017" {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]any{"type": "json_object"}
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		name := f.GetSchemaName()
		if name == "" {
			name = "response"
		}
		schema := map[string]any{"name": name, "schema": f.GetJsonSchema().AsMap(), "strict": f.GetStrict()}
		if f.GetSchemaDescription() != "" {
			schema["description"] = f.GetSchemaDescription()
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": schema}
	}
	raw, err := json.Marshal(body)
	if len(raw) > volcengineTextBodyLimit {
		return textbehavior.SerializedRequest{}, volcengineTextUnsupported("request exceeds the native64MB envelope")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: raw}, err
}

// Public summary text is a display projection. Only the original encrypted
// carrier supplies reasoning state to the next native assistant message.
func (p VolcengineTextBehavior) withoutDisplaySummaries(s *runtimev1.TextGenerateScenarioSpec) (*runtimev1.TextGenerateScenarioSpec, error) {
	var copy *runtimev1.TextGenerateScenarioSpec
	for index, m := range s.GetInput() {
		summary, carrier := false, false
		for _, item := range m.GetTurnItems() {
			summary = summary || item.GetOutput().GetReasoningSummary() != nil
			carrier = carrier || item.GetOutput().GetReasoningContinuity() != nil
		}
		if !summary {
			continue
		}
		if !p.EncryptedReasoning() || !carrier {
			return nil, nativeReasoningReplayInvalid()
		}
		if copy == nil {
			copy = proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
		}
		filtered := []*runtimev1.TextTurnItem{}
		for _, item := range copy.Input[index].TurnItems {
			if item.GetOutput().GetReasoningSummary() == nil {
				filtered = append(filtered, item)
			}
		}
		copy.Input[index].TurnItems = filtered
	}
	if copy != nil {
		return copy, nil
	}
	return s, nil
}
func (p VolcengineTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(volcengineTextBodyLimit, int64(len(wire.Payload)))
	return prepared, budget, err
}
