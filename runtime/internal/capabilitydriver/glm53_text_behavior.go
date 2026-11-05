package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"math"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/proto"
)

const glm53MaxRequestBytes = 48 << 20

// GLM53TextBehavior binds every hook and replay kind to one reviewed API target.
// It does not promote adjacent model names or select a target from request flags.
type GLM53TextBehavior struct {
	model  string
	vision bool
}

func NewGLM53TextBehavior(model string) (GLM53TextBehavior, error) {
	switch model {
	case "glm-5.3":
		return GLM53TextBehavior{model: model}, nil
	case "glm-5.3-flash", "glm-5.3-flashx", "glm-5.3-flashx-legal":
		return GLM53TextBehavior{model: model, vision: true}, nil
	default:
		return GLM53TextBehavior{}, deepseekUnsupported()
	}
}

func (p GLM53TextBehavior) ContinuityKind() string {
	return "glm.chat.native-reasoning-replay." + p.model
}

// @nimi-authority: rule.nimi.runtime.ai-provider.glm53-native-text
func (p GLM53TextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (string, error) {
	if p.model == "" || spec == nil || spec.GetIncludeRawChunks() || spec.TopK != nil || spec.Seed != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil {
		return "", deepseekUnsupported()
	}
	if spec.Temperature != nil && !glm53Decimal(spec.GetTemperature(), 0) || spec.TopP != nil && !glm53Decimal(spec.GetTopP(), .01) ||
		spec.MaxTokens != nil && (spec.GetMaxTokens() < 1 || spec.GetMaxTokens() > 131072) || len(spec.GetStop()) > 4 {
		return "", deepseekJSONInputError("GLM sampling or output bounds")
	}
	if spec.GetToolChoiceName() != "" || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO || len(spec.GetTools()) == 0 && spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO {
		return "", deepseekUnsupported()
	}
	f := spec.GetResponseFormat()
	if f.GetStrict() || f.GetJsonSchema() != nil {
		return "", deepseekUnsupported()
	}
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if len(spec.GetTools()) > 0 {
			return "", deepseekUnsupported()
		}
	default:
		return "", deepseekUnsupported()
	}
	effort := ""
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", deepseekUnsupported()
	}
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED || r.GetIntensity() != nil {
		if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED {
			return "", deepseekUnsupported()
		}
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
			return "", deepseekUnsupported()
		}
		switch r.GetEffort() {
		case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
			effort = "low"
		case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
			effort = "high"
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
			effort = "max"
		default:
			return "", deepseekUnsupported()
		}
	}
	user := false
	for _, m := range spec.GetInput() {
		user = user || m.GetRole() == "user"
	}
	if !user {
		return "", deepseekJSONInputError("GLM requires a user message")
	}
	return effort, nil
}

func glm53Decimal(value, minimum float32) bool {
	scaled := float64(value) * 100
	return value >= minimum && value <= 1 && math.Abs(scaled-math.Round(scaled)) < 1e-5
}

func (p GLM53TextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p GLM53TextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	images := 0
	project := func(m *runtimev1.ChatMessage) (any, error) {
		if len(m.GetParts()) == 0 {
			return m.GetContent(), nil
		}
		if m.GetContent() != "" {
			return nil, deepseekJSONInputError("conflicting GLM content")
		}
		parts := []map[string]any{}
		var plain strings.Builder
		hasImage := false
		for _, part := range m.GetParts() {
			if part == nil {
				return nil, deepseekJSONInputError("empty GLM part")
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
				plain.WriteString(part.GetText())
				continue
			}
			if !p.vision || m.GetRole() != "user" {
				return nil, deepseekUnsupported()
			}
			images++
			hasImage = true
			if images > 50 {
				return nil, deepseekJSONInputError("GLM accepts at most 50 images")
			}
			location := ""
			if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if mime != "image/jpeg" && mime != "image/png" {
					return nil, deepseekUnsupported()
				}
				location = "data:" + mime + ";base64,"
			} else {
				if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || part.GetImageUrl().GetDetail() != "" && part.GetImageUrl().GetDetail() != "auto" {
					return nil, deepseekUnsupported()
				}
				location = part.GetImageUrl().GetUrl()
				if err := validateGLM53Image(location); err != nil {
					return nil, err
				}
			}
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": location}})
		}
		if !hasImage {
			return plain.String(), nil
		}
		return parts, nil
	}
	messages, err := chatCompletionMessages(spec, project, p.ContinuityKind())
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream, "thinking": map[string]any{"type": "enabled", "clear_thinking": false}}
	if effort != "" {
		body["reasoning_effort"] = effort
	}
	if len(spec.GetTools()) > 0 {
		if err = deepseekChatTools(body, spec); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
		if stream {
			body["tool_stream"] = true
		}
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if spec.Temperature != nil {
		body["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		body["top_p"] = spec.GetTopP()
	}
	if len(spec.GetStop()) > 0 {
		body["stop"] = spec.GetStop()
	}
	payload, err := json.Marshal(body)
	if len(payload) > glm53MaxRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("GLM native request exceeds 48 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func validateGLM53Image(location string) error {
	invalid := func() error { return deepseekJSONInputError("GLM image format, size or dimensions") }
	if strings.HasPrefix(location, "data:") {
		parts := strings.SplitN(location, ",", 2)
		if len(parts) != 2 || parts[0] != "data:image/png;base64" && parts[0] != "data:image/jpeg;base64" || len(parts[1]) > base64.StdEncoding.EncodedLen(5<<20) {
			return invalid()
		}
		body, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil || len(body) == 0 || len(body) >= 5<<20 {
			return invalid()
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(body))
		if err != nil || "data:image/"+format+";base64" != parts[0] || config.Width <= 0 || config.Height <= 0 || config.Width > 6000 || config.Height > 6000 {
			return invalid()
		}
		return nil
	}
	u, err := url.Parse(location)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return invalid()
	}
	return nil
}

func (p GLM53TextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	prepared = proto.Clone(prepared).(*runtimev1.TextGenerateScenarioSpec)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(glm53MaxRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p GLM53TextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.validate(spec); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return parseReasoningChatResponse(payload, spec, p.ContinuityKind())
}

func (p GLM53TextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if _, err := p.validate(spec); err != nil {
		return nil, err
	}
	return newReasoningChatStream(spec, p.ContinuityKind()), nil
}
