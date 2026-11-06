package capabilitydriver

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

const fireworksRequestBytes = 32 << 20
const fireworksEncodedImageBytes = 10_000_000

func FireworksTextModels() []string {
	return []string{"accounts/fireworks/models/kimi-k3p1-pro", "accounts/fireworks/models/deepseek-v4p1-flash", "accounts/fireworks/models/deepseek-v4p1-flash-1017", "accounts/fireworks/models/ember-1", "accounts/fireworks/models/minimax-m3p1-flash", "accounts/fireworks/models/glm-5p3-flash", "accounts/fireworks/models/glm-5p3"}
}

type FireworksTextBehavior struct{ model string }

func NewFireworksTextBehavior(model string) (FireworksTextBehavior, error) {
	for _, reviewed := range FireworksTextModels() {
		if model == reviewed {
			return FireworksTextBehavior{model: model}, nil
		}
	}
	return FireworksTextBehavior{}, fireworksUnsupported("unreviewed model")
}
func fireworksUnsupported(detail string) error {
	return (&responsesProfile{label: "Fireworks"}).unsupported(detail)
}
func fireworksInvalid(detail string) error {
	return (&responsesProfile{label: "Fireworks"}).outputError(detail)
}
func (p FireworksTextBehavior) ContinuityKind() string {
	return "fireworks." + p.model + ".reasoning-content"
}
func (p FireworksTextBehavior) Vision() bool { return p.model != "accounts/fireworks/models/glm-5p3" }
func (p FireworksTextBehavior) DeepSeek() bool {
	return strings.HasPrefix(p.model, "accounts/fireworks/models/deepseek-v4p1-")
}
func (p FireworksTextBehavior) MiniMax() bool {
	return p.model == "accounts/fireworks/models/minimax-m3p1-flash"
}

func (p FireworksTextBehavior) reasoning(s *runtimev1.TextGenerateScenarioSpec) (any, bool, error) {
	r := s.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return nil, false, fireworksUnsupported("raw reasoning is not a summary")
	}
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetIntensity() == nil {
		return nil, true, nil
	}
	if p.DeepSeek() && r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED && r.GetIntensity() == nil {
		return "none", false, nil
	}
	if !p.DeepSeek() && !p.MiniMax() || r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
		return nil, false, fireworksUnsupported("unreviewed activation; omit reasoning to preserve the native default")
	}
	if budget, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_ExactBudgetTokens); ok {
		// V4.1 values below 1024 are a prompt scale, not a token cap.
		if !p.DeepSeek() || budget.ExactBudgetTokens < 1024 {
			return nil, false, fireworksUnsupported("this value is not an exact thinking-token budget")
		}
		return budget.ExactBudgetTokens, true, nil
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return nil, false, fireworksUnsupported("reasoning intensity")
	}
	switch r.GetEffort() {
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT:
		return nil, true, nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
		return "low", true, nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
		return "high", true, nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
		return "max", true, nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:
		if p.MiniMax() {
			return "medium", true, nil
		}
	case runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH:
		if p.MiniMax() {
			return "xhigh", true, nil
		}
	}
	return nil, false, fireworksUnsupported("native effort would collapse to another tier")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p FireworksTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p FireworksTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	if s == nil || s.GetIncludeRawChunks() || s.GetTopK() > 100 || len(s.GetStop()) > 4 {
		return textbehavior.SerializedRequest{}, fireworksUnsupported("generation controls")
	}
	effort, thinking, err := p.reasoning(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if len(s.GetTools()) > 0 || f.GetStrict() || f.GetJsonSchema() != nil {
			return textbehavior.SerializedRequest{}, fireworksUnsupported("JSON object combination")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if len(s.GetTools()) > 0 || !f.GetStrict() || f.GetJsonSchema() == nil {
			return textbehavior.SerializedRequest{}, fireworksUnsupported("strict schema requires an independent request without active tools")
		}
		if _, err := textbehavior.CompileJSONSchema(f.GetJsonSchema().AsMap()); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		if err := validateFireworksSchema(f.GetJsonSchema().AsMap(), true); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
	default:
		return textbehavior.SerializedRequest{}, fireworksUnsupported("response format")
	}
	images, encoded := 0, 0
	messages, err := chatCompletionMessagesWithReplay(s, func(m *runtimev1.ChatMessage) (any, error) { return p.content(m, planning, &images, &encoded) }, p.ContinuityKind(), thinking)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"messages": messages, "stream": stream, "context_length_exceeded_behavior": "error"}
	if effort != nil {
		body["reasoning_effort"] = effort
	}
	if stream {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		body["parallel_tool_calls"] = true
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
	data, err := json.Marshal(body)
	if len(data) > fireworksRequestBytes {
		return textbehavior.SerializedRequest{}, fireworksUnsupported("request envelope exceeds 32 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}

func (p FireworksTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	existing := 0
	for _, m := range prepared.GetInput() {
		for _, part := range m.GetParts() {
			if u := part.GetImageUrl(); u != nil {
				_, encoded, _ := strings.Cut(u.GetUrl(), ",")
				existing += len(encoded)
			}
		}
	}
	overhead := int64(len(wire.Payload))
	limit := min(int64(fireworksRequestBytes), overhead+int64(fireworksEncodedImageBytes-1-existing))
	budget, err := textbehavior.NewOwnedMediaInputBudget(limit, overhead)
	return prepared, budget, err
}

func (p FireworksTextBehavior) Parse(data []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.envelope(data, false); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	_, thinking, err := p.reasoning(s)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	var r textbehavior.NormalizedResult
	if thinking {
		r, err = parseReasoningChatResponse(data, s, p.ContinuityKind())
	} else if len(s.GetTools()) > 0 {
		r, err = parseDeepseekToolResponse(data, s)
	} else {
		r, err = parseChatTextResponse(data, s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
	}
	if err != nil {
		return r, err
	}
	return fireworksResult(r, s)
}
func (p FireworksTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	_, thinking, err := p.reasoning(s)
	if err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler
	if thinking {
		inner = newReasoningChatStream(s, p.ContinuityKind())
	} else if len(s.GetTools()) > 0 {
		inner = newDeepseekToolStream(s)
	} else {
		inner = &deepseekJSONStream{plainText: s.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	}
	return &fireworksTextStream{profile: p, spec: s, inner: inner}, nil
}
func fireworksResult(r textbehavior.NormalizedResult, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && r.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		return validateStrictChatSchemaResult(r, s)
	}
	return r, nil
}
func (p FireworksTextBehavior) envelope(data []byte, seen bool) (bool, error) {
	var e struct {
		Model   string          `json:"model"`
		Error   json.RawMessage `json:"error"`
		Choices []struct {
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &e) != nil {
		return seen, fireworksInvalid("response JSON")
	}
	if len(e.Error) > 0 && string(e.Error) != "null" {
		return seen, fireworksStreamError(e.Error)
	}
	if e.Model != "" {
		if e.Model != p.model {
			return seen, fireworksInvalid("response changed the selected model")
		}
		seen = true
	}
	if !seen {
		return false, fireworksInvalid("missing model identity")
	}
	for _, c := range e.Choices {
		if c.FinishReason == "length" {
			return seen, deepseekIncomplete()
		}
	}
	return seen, nil
}

func fireworksStreamError(raw json.RawMessage) error {
	var value struct {
		Code json.RawMessage `json:"code"`
	}
	_ = json.Unmarshal(raw, &value)
	code, _ := strconv.Atoi(strings.Trim(string(value.Code), "\""))
	reason, grpcCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, codes.Unavailable
	switch code {
	case 400, 413, 422:
		reason, grpcCode = runtimev1.ReasonCode_AI_INPUT_INVALID, codes.InvalidArgument
	case 401, 403:
		reason, grpcCode = runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, codes.FailedPrecondition
	case 402, 429:
		reason, grpcCode = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, codes.ResourceExhausted
	case 408, 504:
		reason, grpcCode = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, codes.DeadlineExceeded
	}
	return grpcerr.WithReasonCode(grpcCode, reason)
}

type fireworksTextStream struct {
	profile   FireworksTextBehavior
	spec      *runtimev1.TextGenerateScenarioSpec
	inner     textbehavior.StreamFragmentAssembler
	seenModel bool
}

func (s *fireworksTextStream) Append(data []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(data)) != "[DONE]" {
		seen, err := s.profile.envelope(data, s.seenModel)
		if err != nil {
			return nil, err
		}
		s.seenModel = seen
	}
	return s.inner.Append(data)
}
func (s *fireworksTextStream) Finish() (textbehavior.NormalizedResult, error) {
	r, err := s.inner.Finish()
	if err != nil {
		return r, err
	}
	return fireworksResult(r, s.spec)
}
