package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

const togetherRequestBytes = 32 << 20

type TogetherTextBehavior struct{ model string }

func TogetherTextModels() []string {
	return []string{"deepseek-ai/DeepSeek-V4-Pro-0813", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-ai/DeepSeek-V4.1-Flash-1017", "moonshotai/Kimi-K3", "moonshotai/Kimi-K3.1-Pro", "zai-org/GLM-5.3", "zai-org/GLM-5.3-Flash", "MiniMaxAI/MiniMax-M3.1-Flash", "Qwen/Qwen3.8-Flash", "meta-models/Muse-Glimmer-30B", "meta-models/Muse-Spark-Open-816B-A42B", "nvidia/NVIDIA-Nemotron-3.5-Super-VL"}
}
func NewTogetherTextBehavior(model string) (TogetherTextBehavior, error) {
	if !contains(TogetherTextModels(), model) {
		return TogetherTextBehavior{}, togetherUnsupported("unreviewed model")
	}
	return TogetherTextBehavior{model: model}, nil
}
func togetherUnsupported(detail string) error {
	return (&responsesProfile{label: "Together Chat Completions"}).unsupported(detail)
}
func (p TogetherTextBehavior) ContinuityKind() string {
	return "together." + p.model + ".native-reasoning"
}
func (p TogetherTextBehavior) Vision() bool {
	return strings.HasPrefix(p.model, "moonshotai/") || p.model == "nvidia/NVIDIA-Nemotron-3.5-Super-VL"
}
func (p TogetherTextBehavior) GLM() bool { return strings.HasPrefix(p.model, "zai-org/") }
func (p TogetherTextBehavior) CanDisableReasoning() bool {
	return p.model == "moonshotai/Kimi-K3" || p.model == "deepseek-ai/DeepSeek-V4-Pro-0813"
}
func (p TogetherTextBehavior) Efforts() []string {
	switch {
	case p.GLM():
		return []string{"low", "medium", "high", "max"}
	case p.model == "moonshotai/Kimi-K3":
		return []string{"low", "high", "max"}
	case p.model == "deepseek-ai/DeepSeek-V4-Pro-0813":
		return []string{"high", "max"}
	default:
		return nil
	}
}
func (p TogetherTextBehavior) reasoning(s *runtimev1.TextGenerateScenarioSpec) (map[string]any, bool, error) {
	r := s.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return nil, false, togetherUnsupported("raw reasoning is not a summary")
	}
	required := p.GLM() || p.model == "moonshotai/Kimi-K3" || p.model == "deepseek-ai/DeepSeek-V4-Pro-0813"
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil {
		return nil, required, nil
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && r.GetIntensity() == nil && p.CanDisableReasoning() {
		return map[string]any{"reasoning": map[string]any{"enabled": false}}, false, nil
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED || len(p.Efforts()) == 0 {
		return nil, false, togetherUnsupported("unreviewed reasoning controls; omit to retain the native default")
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, false, togetherUnsupported("exact reasoning budget")
	}
	body := map[string]any{}
	if !p.GLM() {
		body["reasoning"] = map[string]any{"enabled": true}
	}
	if r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
		effort := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}[r.GetEffort()]
		if !contains(p.Efforts(), effort) {
			return nil, false, togetherUnsupported("native effort would be silently ignored or mapped")
		}
		body["reasoning_effort"] = effort
	}
	return body, true, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p TogetherTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p TogetherTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.GetTemperature() > 1 {
		return textbehavior.SerializedRequest{}, togetherUnsupported("generation controls")
	}
	controls, required, err := p.reasoning(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if len(s.GetTools()) > 0 || f.GetStrict() || f.GetJsonSchema() != nil {
			return textbehavior.SerializedRequest{}, togetherUnsupported("JSON object combination")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if len(s.GetTools()) > 0 || !f.GetStrict() || f.GetJsonSchema() == nil {
			return textbehavior.SerializedRequest{}, togetherUnsupported("strict schema requires a separate request")
		}
		if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
			return textbehavior.SerializedRequest{}, togetherUnsupported("schema outside reviewed closed basic subset")
		}
	default:
		return textbehavior.SerializedRequest{}, togetherUnsupported("response format")
	}
	copy := proto.Clone(s).(*runtimev1.TextGenerateScenarioSpec)
	fields := []string{}
	for _, m := range copy.GetInput() {
		for _, item := range m.GetTurnItems() {
			if carrier := item.GetOutput().GetReasoningContinuity(); carrier != nil {
				native, err := p.readReplay(carrier)
				if err != nil {
					return textbehavior.SerializedRequest{}, err
				}
				fields = append(fields, native.Field)
				carrier.Payload, _ = json.Marshal(native.Text)
			}
		}
	}
	messages, err := chatCompletionMessagesWithReplay(copy, func(m *runtimev1.ChatMessage) (any, error) { return p.content(m, planning) }, p.ContinuityKind(), required)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	next := 0
	for _, m := range messages {
		if value, ok := m["reasoning_content"]; ok {
			if next >= len(fields) {
				return textbehavior.SerializedRequest{}, nativeReasoningReplayInvalid()
			}
			delete(m, "reasoning_content")
			m[fields[next]] = value
			next++
		}
	}
	body := map[string]any{"messages": messages, "stream": stream, "context_length_exceeded_behavior": "error"}
	for k, v := range controls {
		body[k] = v
	}
	if p.GLM() {
		body["chat_template_kwargs"] = map[string]any{"clear_thinking": false}
	}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
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
	if s.Seed != nil {
		body["seed"] = s.GetSeed()
	}
	if s.PresencePenalty != nil {
		body["presence_penalty"] = s.GetPresencePenalty()
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
		schema := map[string]any{"name": name, "schema": f.GetJsonSchema().AsMap()}
		if f.GetSchemaDescription() != "" {
			schema["description"] = f.GetSchemaDescription()
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": schema}
	}
	payload, err := json.Marshal(body)
	if len(payload) > togetherRequestBytes {
		return textbehavior.SerializedRequest{}, togetherUnsupported("request envelope exceeds 32 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}
func (p TogetherTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(togetherRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}
