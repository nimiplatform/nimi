package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/url"
	"path"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	_ "golang.org/x/image/webp"
)

const Qwen38OmniModel = "qwen3.8-omni-flash"
const qwen38OmniRequestBytes = 48 << 20

type Qwen38OmniTextBehavior struct{}

func (Qwen38OmniTextBehavior) ContinuityKind() string {
	return "dashscope.chat.native-reasoning-replay." + Qwen38OmniModel
}

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-qwen38-omni
func (Qwen38OmniTextBehavior) validate(spec *runtimev1.TextGenerateScenarioSpec) (string, error) {
	if err := validateChatFunctionSpec(spec, true); err != nil {
		return "", err
	}
	if spec.GetIncludeRawChunks() || spec.Temperature != nil || spec.TopP != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || len(spec.GetStop()) != 0 {
		return "", deepseekUnsupported()
	}
	if spec.GetResponseFormat().GetSchemaName() != "" || spec.GetResponseFormat().GetSchemaDescription() != "" {
		return "", deepseekUnsupported()
	}
	if spec.MaxTokens != nil && (spec.GetMaxTokens() < 1 || spec.GetMaxTokens() > 131072) {
		return "", deepseekJSONInputError("Qwen Omni output limit")
	}
	if spec.GetToolChoiceName() != "" || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE {
		return "", deepseekUnsupported()
	}
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return "", deepseekUnsupported()
	}
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED:
		if r.GetIntensity() != nil {
			return "", deepseekUnsupported()
		}
		return "", nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if r.GetIntensity() != nil {
			return "", deepseekUnsupported()
		}
		return "none", nil
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
			return "", deepseekUnsupported()
		}
		switch r.GetEffort() {
		case runtimev1.ReasoningEffort_REASONING_EFFORT_LOW:
			return "low", nil
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM:
			return "medium", nil
		case runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH:
			return "xhigh", nil
		case runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT:
			return "", nil
		}
	}
	return "", deepseekUnsupported()
}

func (p Qwen38OmniTextBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p Qwen38OmniTextBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	counts := map[string]int{}
	project := func(message *runtimev1.ChatMessage) (any, error) {
		if len(message.Parts) == 0 {
			return message.Content, nil
		}
		if message.Content != "" {
			return nil, deepseekJSONInputError("conflicting Qwen Omni content")
		}
		parts := []map[string]any{}
		for _, part := range message.Parts {
			if part == nil {
				return nil, deepseekJSONInputError("empty Qwen Omni part")
			}
			if part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
				continue
			}
			if message.Role != "user" {
				return nil, deepseekUnsupported()
			}
			media, kind, inline, err := qwen38OmniMediaPart(part, planning)
			if err != nil {
				return nil, err
			}
			counts[kind]++
			if inline {
				counts[kind+"_inline"]++
			}
			if counts["image"] > 2048 || counts["audio"] > 2048 || counts["video"] > 64 || counts["image_inline"] > 250 || counts["audio_inline"] > 250 {
				return nil, deepseekJSONInputError("Qwen Omni media count")
			}
			parts = append(parts, media)
		}
		return parts, nil
	}
	// A history produced with reasoning disabled legitimately has no replay.
	// Existing replay remains model-bound and is never filled or reconstructed.
	messages, err := chatCompletionMessagesWithReplay(spec, project, p.ContinuityKind(), false)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	body := map[string]any{"model": Qwen38OmniModel, "messages": messages, "stream": stream, "modalities": []string{"text"}, "preserve_thinking": true, "enable_search": false}
	if effort != "" {
		body["reasoning_effort"] = effort
	}
	if stream {
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if len(spec.Tools) > 0 {
		if err = deepseekChatTools(body, spec); err != nil {
			return textbehavior.SerializedRequest{}, err
		}
	}
	if spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT {
		body["response_format"] = map[string]string{"type": "json_object"}
	}
	payload, err := json.Marshal(body)
	if len(payload) > qwen38OmniRequestBytes {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Qwen Omni request exceeds 48 MiB")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func qwen38OmniMediaPart(part *runtimev1.ChatContentPart, planning bool) (map[string]any, string, bool, error) {
	invalid := func() (map[string]any, string, bool, error) { return nil, "", false, deepseekUnsupported() }
	kind, location, mimeType := "", "", ""
	if planning && part.Type == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
		mimeType = part.GetArtifactRef().GetMimeType()
		switch mimeType {
		case "image/png", "image/jpeg", "image/webp":
			kind = "image"
		case "audio/wav", "audio/mpeg":
			kind = "audio"
		case "video/mp4":
			kind = "video"
		default:
			return invalid()
		}
		location = "data:" + mimeType + ";base64,"
	} else {
		switch part.Type {
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
			if part.GetImageUrl().GetDetail() != "" && part.GetImageUrl().GetDetail() != "auto" {
				return invalid()
			}
			kind, location = "image", part.GetImageUrl().GetUrl()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
			kind, location = "audio", part.GetAudioUrl()
		case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
			kind, location = "video", part.GetVideoUrl()
		default:
			return invalid()
		}
	}
	inline := strings.HasPrefix(location, "data:")
	format := ""
	if inline {
		header, data, ok := strings.Cut(location, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return invalid()
		}
		mimeType = strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		if !planning {
			if data == "" || (kind == "audio" || kind == "video") && len(data) >= 10_000_000 || kind == "image" && len(data) > base64.StdEncoding.EncodedLen(20_000_000) {
				return invalid()
			}
			decoded, err := base64.StdEncoding.Strict().DecodeString(data)
			if err != nil {
				return invalid()
			}
			if kind == "image" {
				config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
				if err != nil || mimeType != "image/"+format || len(decoded) > 20_000_000 || config.Width <= 10 || config.Height <= 10 || float64(config.Width)/float64(config.Height) > 200 || float64(config.Height)/float64(config.Width) > 200 {
					return invalid()
				}
			}
		}
		switch kind {
		case "image":
			if mimeType != "image/png" && mimeType != "image/jpeg" && mimeType != "image/webp" {
				return invalid()
			}
		case "audio":
			switch mimeType {
			case "audio/wav":
				format = "wav"
			case "audio/mpeg":
				format = "mp3"
			default:
				return invalid()
			}
			location = "data:;base64," + data
		case "video":
			if mimeType != "video/mp4" {
				return invalid()
			}
			location = "data:;base64," + data
		}
	} else {
		u, err := url.Parse(location)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
			return invalid()
		}
		if kind == "audio" {
			format = strings.TrimPrefix(strings.ToLower(path.Ext(u.Path)), ".")
			if format != "wav" && format != "mp3" {
				return invalid()
			}
		}
	}
	switch kind {
	case "image":
		return map[string]any{"type": "image_url", "image_url": map[string]string{"url": location}}, kind, inline, nil
	case "audio":
		return map[string]any{"type": "input_audio", "input_audio": map[string]string{"data": location, "format": format}}, kind, inline, nil
	case "video":
		return map[string]any{"type": "video_url", "video_url": map[string]string{"url": location}}, kind, inline, nil
	}
	return invalid()
}

func (p Qwen38OmniTextBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(spec, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(qwen38OmniRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func (p Qwen38OmniTextBehavior) Parse(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	if effort != "none" {
		return parseReasoningChatResponse(payload, spec, p.ContinuityKind())
	}
	if len(spec.Tools) > 0 {
		return parseDeepseekToolResponse(payload, spec)
	}
	return parseChatTextResponse(payload, spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT)
}
func (p Qwen38OmniTextBehavior) Stream(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	effort, err := p.validate(spec)
	if err != nil {
		return nil, err
	}
	if effort != "none" {
		return newReasoningChatStream(spec, p.ContinuityKind()), nil
	}
	if len(spec.Tools) > 0 {
		return newDeepseekToolStream(spec), nil
	}
	return &deepseekJSONStream{plainText: spec.GetResponseFormat().GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}, nil
}
