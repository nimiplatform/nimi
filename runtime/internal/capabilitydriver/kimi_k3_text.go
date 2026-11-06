package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const kimiK3RequestBytes = 100_000_000

type KimiK3TextBehavior struct{ model string }

func NewKimiK3TextBehavior(model string) (KimiK3TextBehavior, error) {
	switch model {
	case "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k3":
		return KimiK3TextBehavior{model: model}, nil
	default:
		return KimiK3TextBehavior{}, deepseekUnsupported()
	}
}
func (p KimiK3TextBehavior) ContinuityKind() string {
	return "kimi.chat.native-reasoning-replay." + p.model
}
func (p KimiK3TextBehavior) validate(s *runtimev1.TextGenerateScenarioSpec) (string, error) {
	if s == nil || p.model == "" || s.GetIncludeRawChunks() || s.TopK != nil || s.Seed != nil || s.Temperature != nil && s.GetTemperature() != 1 || s.TopP != nil && s.GetTopP() != float32(.95) || s.PresencePenalty != nil && s.GetPresencePenalty() != 0 || s.FrequencyPenalty != nil && s.GetFrequencyPenalty() != 0 || s.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL || s.GetToolChoiceName() != "" {
		return "", deepseekUnsupported()
	}
	if s.MaxTokens != nil && (s.GetMaxTokens() < 1 || s.GetMaxTokens() > 1048576) || len(s.GetStop()) > 5 {
		return "", deepseekUnsupported()
	}
	for _, stop := range s.GetStop() {
		if len(stop) == 0 || len(stop) > 32 || !utf8.ValidString(stop) {
			return "", deepseekUnsupported()
		}
	}
	f := s.GetResponseFormat()
	switch f.GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT:
		if f.GetStrict() || f.GetJsonSchema() != nil {
			return "", deepseekUnsupported()
		}
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		if !f.GetStrict() || f.GetJsonSchema() == nil {
			return "", deepseekUnsupported()
		}
		if _, err := textbehavior.CompileJSONSchema(f.GetJsonSchema().AsMap()); err != nil {
			return "", deepseekJSONInputError("Kimi JSON Schema")
		}
	default:
		return "", deepseekUnsupported()
	}
	r := s.GetReasoning()
	if r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED || r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", deepseekUnsupported()
	}
	if r.GetIntensity() == nil {
		return "max", nil
	}
	if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
		return "", deepseekUnsupported()
	}
	switch r.GetEffort() {
	case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT, runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM:
		return "max", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
		return "low", nil
	case runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH:
		return "high", nil
	default:
		return "", deepseekUnsupported()
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r088
func (p KimiK3TextBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(s, stream, false)
}
func (p KimiK3TextBehavior) serialize(s *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(s)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages, err := chatCompletionMessages(s, func(message *runtimev1.ChatMessage) (any, error) { return kimiK3Content(message, planning) }, p.ContinuityKind())
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": p.model, "messages": messages, "stream": stream, "reasoning_effort": effort}
	if stream {
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	if len(s.GetTools()) > 0 {
		if err := deepseekChatTools(body, s); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
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
	if s.PresencePenalty != nil {
		body["presence_penalty"] = s.GetPresencePenalty()
	}
	if s.FrequencyPenalty != nil {
		body["frequency_penalty"] = s.GetFrequencyPenalty()
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
	if len(data) > kimiK3RequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Kimi request exceeds 100M")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: data}, err
}
func kimiK3Content(m *runtimev1.ChatMessage, planning bool) (any, error) {
	if len(m.GetParts()) == 0 {
		return m.GetContent(), nil
	}
	if m.GetContent() != "" {
		return nil, deepseekJSONInputError("conflicting Kimi text representations")
	}
	parts := []map[string]any{}
	for _, part := range m.GetParts() {
		if part == nil {
			return nil, deepseekUnsupported()
		}
		if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			if _, ok := part.GetContent().(*runtimev1.ChatContentPart_Text); !ok {
				return nil, deepseekUnsupported()
			}
			parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
			continue
		}
		if m.GetRole() != "user" {
			return nil, deepseekUnsupported()
		}
		kind, location := "image_url", ""
		if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
			mime := part.GetArtifactRef().GetMimeType()
			if !kimiK3MediaMIME(mime) || part.GetArtifactRef().GetArtifactId() == "" {
				return nil, deepseekUnsupported()
			}
			if mime == "video/mp4" {
				kind = "video_url"
			}
			location = "data:" + mime + ";base64,"
		} else {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				if part.GetImageUrl().GetDetail() != "" {
					return nil, deepseekUnsupported()
				}
				location = part.GetImageUrl().GetUrl()
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				kind, location = "video_url", part.GetVideoUrl()
			default:
				return nil, deepseekUnsupported()
			}
			if err := validateKimiK3Media(location, kind); err != nil {
				return nil, err
			}
		}
		parts = append(parts, map[string]any{"type": kind, kind: map[string]string{"url": location}})
	}
	return parts, nil
}
func kimiK3MediaMIME(mime string) bool {
	return mime == "image/png" || mime == "image/jpeg" || mime == "image/webp" || mime == "image/gif" || mime == "video/mp4"
}
func validateKimiK3Media(location, kind string) error {
	invalid := func() error {
		return deepseekJSONInputError("Kimi requires complete inline raster or MP4 media within the Runtime limit")
	}
	header, encoded, ok := strings.Cut(location, ",")
	mime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(header, ";base64") || !kimiK3MediaMIME(mime) || len(encoded) > base64.StdEncoding.EncodedLen(32<<20) || (mime == "video/mp4") != (kind == "video_url") {
		return invalid()
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) == 0 || len(data) > 32<<20 {
		return invalid()
	}
	if mime == "video/mp4" {
		if len(data) < 12 || string(data[4:8]) != "ftyp" {
			return invalid()
		}
		return nil
	}
	geometry, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || geometry.Width <= 0 || geometry.Height <= 0 || mime != "image/"+format {
		return invalid()
	}
	// Keep animated image bytes intact: Kimi explicitly accepts GIF/WebP in
	// this native part type and may account for their frames as video input.
	return nil
}
func (p KimiK3TextBehavior) PlanMaterialization(ctx context.Context, s *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, s, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(kimiK3RequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}
func (p KimiK3TextBehavior) Parse(payload []byte, s *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if _, err := p.validate(s); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	result, err := parseReasoningChatResponse(payload, s, p.ContinuityKind())
	if err != nil {
		return result, err
	}
	return kimiK3StructuredResult(result, s)
}
func (p KimiK3TextBehavior) Stream(s *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if _, err := p.validate(s); err != nil {
		return nil, err
	}
	return &kimiK3Stream{StreamFragmentAssembler: newReasoningChatStream(s, p.ContinuityKind()), spec: s}, nil
}

type kimiK3Stream struct {
	textbehavior.StreamFragmentAssembler
	spec *runtimev1.TextGenerateScenarioSpec
}

func (s *kimiK3Stream) Finish() (textbehavior.NormalizedResult, error) {
	result, err := s.StreamFragmentAssembler.Finish()
	if err != nil {
		return result, err
	}
	return kimiK3StructuredResult(result, s.spec)
}
func kimiK3StructuredResult(result textbehavior.NormalizedResult, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if len(spec.GetTools()) > 0 && spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT && result.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		var text strings.Builder
		for _, item := range result.Items {
			if item.Kind == textbehavior.OrderedItemText {
				text.WriteString(item.Text)
			}
		}
		var value map[string]json.RawMessage
		if json.Unmarshal([]byte(text.String()), &value) != nil || value == nil {
			return textbehavior.NormalizedResult{}, deepseekJSONOutputError()
		}
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA && result.FinishReason == runtimev1.FinishReason_FINISH_REASON_STOP {
		return validateStrictChatSchemaResult(result, spec)
	}
	return result, nil
}
