package capabilitydriver

import (
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-qwen3-vl-plus-ordered-text
func validateQwenVLOrderedText(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil || !textbehavior.RequiresOrderedSystemMessages(spec) || spec.GetIncludeRawChunks() ||
		len(spec.GetTools()) != 0 || spec.GetToolChoiceName() != "" ||
		(spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE) ||
		spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.Seed != nil ||
		spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || len(spec.GetStop()) != 0 ||
		(spec.MaxTokens != nil && (spec.GetMaxTokens() <= 0 || spec.GetMaxTokens() > 32768)) {
		return deepseekUnsupported()
	}
	format := spec.GetResponseFormat()
	if (format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && format.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT) ||
		format.GetJsonSchema() != nil || format.GetStrict() || format.GetSchemaName() != "" || format.GetSchemaDescription() != "" {
		return deepseekUnsupported()
	}
	r := spec.GetReasoning()
	if (r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED && r.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED) ||
		(r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN) || r.GetIntensity() != nil {
		return deepseekUnsupported()
	}
	return nil
}

// The existing media owner resolves authorized artifacts before serialization.
// No URL fetching, file access, role rewriting or provider target selection is
// performed here.
func DashscopeQwenVLRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	if err := validateQwenVLOrderedText(spec); err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages := make([]map[string]any, 0, len(spec.Input)+1)
	if spec.SystemPrompt != "" {
		messages = append(messages, map[string]any{"role": "system", "content": spec.SystemPrompt})
	}
	for _, message := range spec.Input {
		if message == nil || (message.Role != "system" && message.Role != "user" && message.Role != "assistant") || len(message.TurnItems) != 0 {
			return textbehavior.SerializedRequest{}, deepseekUnsupported()
		}
		var content any = message.Content
		if len(message.Parts) != 0 {
			parts := make([]map[string]any, 0, len(message.Parts)+1)
			// LocalAgent carries the original question in Content and its image
			// in Parts; both belong to this same user message.
			if message.Content != "" {
				parts = append(parts, map[string]any{"type": "text", "text": message.Content})
			}
			for _, part := range message.Parts {
				if part == nil {
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
				switch part.Type {
				case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT:
					if _, ok := part.Content.(*runtimev1.ChatContentPart_Text); !ok {
						return textbehavior.SerializedRequest{}, deepseekUnsupported()
					}
					parts = append(parts, map[string]any{"type": "text", "text": part.GetText()})
				case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
					value := part.GetImageUrl()
					if message.Role != "user" || value == nil || strings.TrimSpace(value.Url) == "" {
						return textbehavior.SerializedRequest{}, deepseekUnsupported()
					}
					image := map[string]any{"url": value.Url}
					if value.Detail != "" {
						image["detail"] = value.Detail
					}
					parts = append(parts, map[string]any{"type": "image_url", "image_url": image})
				default:
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
			}
			content = parts
		}
		messages = append(messages, map[string]any{"role": message.Role, "content": content})
	}
	body := map[string]any{"messages": messages, "stream": stream, "enable_thinking": false}
	if stream {
		body["stream_options"] = map[string]bool{"include_usage": true}
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	payload, err := json.Marshal(body)
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload}, err
}

func DashscopeQwenVLNonStreamParser(payload []byte, spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	if err := validateQwenVLOrderedText(spec); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return parseChatTextResponse(payload, false)
}

func DashscopeQwenVLStreamAssembler(spec *runtimev1.TextGenerateScenarioSpec) (textbehavior.StreamFragmentAssembler, error) {
	if err := validateQwenVLOrderedText(spec); err != nil {
		return nil, err
	}
	return &deepseekJSONStream{plainText: true}, nil
}
