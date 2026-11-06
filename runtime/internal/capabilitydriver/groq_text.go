package capabilitydriver

import (
	"context"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const groqTextBodyBytes = 20_000_000

type GroqTextBehavior struct {
	model     string
	maxOutput int32
	maxImages int
}

func NewGroqTextBehavior(model string) (GroqTextBehavior, error) {
	p := GroqTextBehavior{model: model}
	switch model {
	case "openai/gpt-oss-120b", "openai/gpt-oss-20b":
		p.maxOutput = 65536
	case "qwen/qwen3.8-27b":
		p.maxOutput, p.maxImages = 16384, 3
	case "meta-models/muse-spark-open":
		p.maxOutput, p.maxImages = 131072, 5
	case "minimaxai/minimax-m2.7":
		p.maxOutput = 131072
	default:
		return GroqTextBehavior{}, groqUnsupported("unreviewed model")
	}
	return p, nil
}
func (p GroqTextBehavior) ParallelTools() bool { return !strings.HasPrefix(p.model, "openai/") }
func (p GroqTextBehavior) StrictSchema() bool  { return p.model != "minimaxai/minimax-m2.7" }
func groqUnsupported(detail string) error {
	return (&responsesProfile{label: "Groq"}).unsupported(detail)
}
func groqInvalid(detail string) error { return (&responsesProfile{label: "Groq"}).outputError(detail) }

func (p GroqTextBehavior) validate(s *runtimev1.TextGenerateScenarioSpec, stream bool) (string, error) {
	if s == nil || s.GetIncludeRawChunks() || s.TopK != nil || s.PresencePenalty != nil || s.FrequencyPenalty != nil || s.Temperature != nil && s.GetTemperature() == 0 || s.MaxTokens != nil && (s.GetMaxTokens() <= 0 || s.GetMaxTokens() > p.maxOutput) || len(s.GetStop()) > 4 {
		return "", groqUnsupported("generation controls")
	}
	for _, stop := range s.GetStop() {
		if stop == "" {
			return "", groqUnsupported("empty stop sequence")
		}
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if f.GetStrict() || f.GetJsonSchema() != nil {
			return "", groqUnsupported("schema on a non-schema response")
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if !p.StrictSchema() || stream || len(s.GetTools()) > 0 || !f.GetStrict() || f.GetJsonSchema() == nil {
			return "", groqUnsupported("strict schema requires a supported model, synchronous execution and no tools")
		}
		if _, err := textbehavior.CompileJSONSchema(f.GetJsonSchema().AsMap()); err != nil {
			return "", groqUnsupported("JSON Schema")
		}
		if err := validateGroqStrictSchema(f.GetJsonSchema().AsMap()); err != nil {
			return "", err
		}
	default:
		return "", groqUnsupported("response format")
	}
	r := s.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", groqUnsupported("raw reasoning is not a reasoning summary")
	}
	qwen := p.model == "qwen/qwen3.8-27b"
	if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED {
		if !qwen || r.GetIntensity() != nil {
			return "", groqUnsupported("this model cannot disable thinking")
		}
		return "none", nil
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
		return "", groqUnsupported("reasoning activation")
	}
	if r.GetIntensity() == nil {
		if qwen {
			if r.GetActivation() == runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
				return "", groqUnsupported("choose an explicit Qwen thinking effort")
			}
			return "none", nil
		}
		if p.model == "meta-models/muse-spark-open" {
			return "xhigh", nil
		}
		if p.model == "minimaxai/minimax-m2.7" {
			return "", nil
		}
		return "medium", nil
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return "", groqUnsupported("exact thinking budget")
	}
	if p.model == "minimaxai/minimax-m2.7" {
		if r.GetEffort() == runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
			return "", nil
		}
		return "", groqUnsupported("MiniMax on Groq uses its native thinking intensity")
	}
	switch r.GetEffort() {
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT:
		if qwen {
			return "", groqUnsupported("Qwen native-default thinking is not established by the current API contract")
		}
		if p.model == "meta-models/muse-spark-open" {
			return "xhigh", nil
		}
		return "medium", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
		return "low", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:
		return "medium", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
		return "high", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH:
		if p.model == "meta-models/muse-spark-open" {
			return "xhigh", nil
		}
	}
	return "", groqUnsupported("thinking effort")
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p GroqTextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p GroqTextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(s, stream)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	images := 0
	messages, err := chatCompletionMessagesWithReplay(s, func(m *runtimev1.ChatMessage) (any, error) { return p.content(m, planning, &images) }, "", false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream, "reasoning_format": "hidden"}
	if effort != "" {
		body["reasoning_effort"] = effort
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		body["parallel_tool_calls"] = p.ParallelTools()
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
	if s.Seed != nil {
		body["seed"] = s.GetSeed()
	}
	if len(s.GetStop()) > 0 {
		body["stop"] = s.GetStop()
	}
	f := s.GetResponseFormat()
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	if f.GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		name := f.GetSchemaName()
		if name == "" {
			name = "response"
		}
		schema := map[string]any{"name": name, "strict": true, "schema": f.GetJsonSchema().AsMap()}
		if f.GetSchemaDescription() != "" {
			schema["description"] = f.GetSchemaDescription()
		}
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": schema}
	}
	data, err := json.Marshal(body)
	if len(data) > groqTextBodyBytes {
		return textbehavior.SerializedRequest{}, groqUnsupported("request exceeds the admitted 20 MB body")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}

func (p GroqTextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serialize := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serialize, stream)
	wire, err := serialize(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(groqTextBodyBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}
func (p GroqTextBehavior) Parse(payload []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.validate(s, false); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	clean, _, err := p.nativeEnvelope(payload, false, false)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	var result textbehavior.NormalizedResult
	if len(s.GetTools()) > 0 {
		result, err = parseDeepseekToolResponse(clean, s)
	} else {
		result, err = parseChatTextResponse(clean, s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
	}
	if err != nil {
		return result, err
	}
	return groqStructuredResult(result, s)
}
func (p GroqTextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if _, err := p.validate(s, true); err != nil {
		return nil, err
	}
	var inner textbehavior.StreamFragmentAssembler = &deepseekJSONStream{plainText: s.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}
	if len(s.GetTools()) > 0 {
		inner = newDeepseekToolStream(s)
	}
	return &groqTextStream{profile: p, spec: s, inner: inner}, nil
}

type groqTextStream struct {
	profile   GroqTextBehavior
	spec      *runtimev1.TextGenerateScenarioSpec
	inner     textbehavior.StreamFragmentAssembler
	seenModel bool
}

func (s *groqTextStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	if strings.TrimSpace(string(payload)) == "[DONE]" {
		return s.inner.Append(payload)
	}
	clean, seen, err := s.profile.nativeEnvelope(payload, true, s.seenModel)
	if err != nil {
		return nil, err
	}
	s.seenModel = seen
	return s.inner.Append(clean)
}
func (s *groqTextStream) Finish() (textbehavior.NormalizedResult, error) {
	r, err := s.inner.Finish()
	if err != nil {
		return r, err
	}
	return groqStructuredResult(r, s.spec)
}
func groqStructuredResult(r textbehavior.NormalizedResult, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if r.FinishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		return r, nil
	}
	if s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA {
		return validateStrictChatSchemaResult(r, s)
	}
	if len(s.GetTools()) > 0 && s.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		var text strings.Builder
		for _, i := range r.Items {
			if i.Kind == textbehavior.OrderedItemText {
				text.WriteString(i.Text)
			}
		}
		if err := deepseekJSONObject(text.String()); err != nil {
			return textbehavior.NormalizedResult{}, err
		}
	}
	return r, nil
}
