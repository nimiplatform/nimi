package capabilitydriver

import (
	"encoding/base64"
	"encoding/json"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

const BedrockNovaConverseProtocol = "bedrock/nova-converse-v1"

type BedrockNovaBehavior struct{ model string }

func NewBedrockNovaBehavior(model string) (BedrockNovaBehavior, error) {
	switch model {
	case "amazon.nova-2-lite-v1:0", "amazon.nova-pro-v1:0", "amazon.nova-lite-v1:0", "amazon.nova-micro-v1:0":
		return BedrockNovaBehavior{model: model}, nil
	default:
		return BedrockNovaBehavior{}, deepseekUnsupported()
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-current-text
func (p BedrockNovaBehavior) Serialize(s *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	if p.model == "" || s == nil || s.GetIncludeRawChunks() || s.Seed != nil || s.FrequencyPenalty != nil || s.PresencePenalty != nil {
		return textbehavior.SerializedRequest{}, deepseekUnsupported()
	}
	if f := s.GetResponseFormat(); f != nil && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT {
		return textbehavior.SerializedRequest{}, deepseekUnsupported()
	}
	limit := int32(10000)
	if p.model == "amazon.nova-2-lite-v1:0" {
		limit = 65000
	}
	if s.MaxTokens != nil && (s.GetMaxTokens() < 1 || s.GetMaxTokens() > limit) || s.Temperature != nil && !(s.GetTemperature() >= 0 && s.GetTemperature() <= 1) || s.TopP != nil && !(s.GetTopP() >= 0 && s.GetTopP() <= 1) || s.TopK != nil && (s.GetTopK() < 0 || s.GetTopK() > 128) {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova inference bounds")
	}
	additional, config := map[string]any{}, map[string]any{}
	if s.MaxTokens != nil {
		config["maxTokens"] = s.GetMaxTokens()
	}
	if s.Temperature != nil {
		config["temperature"] = s.GetTemperature()
	}
	if s.TopP != nil {
		config["topP"] = s.GetTopP()
	}
	if len(s.Stop) > 0 {
		config["stopSequences"] = s.Stop
	}
	if s.TopK != nil {
		additional["inferenceConfig"] = map[string]any{"topK": s.GetTopK()}
	}
	if r := s.GetReasoning(); r != nil {
		if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
			return textbehavior.SerializedRequest{}, deepseekUnsupported()
		}
		switch r.GetActivation() {
		case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED:
			if r.GetIntensity() != nil {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
		case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
			if p.model != "amazon.nova-2-lite-v1:0" || r.GetIntensity() != nil {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			additional["reasoningConfig"] = map[string]any{"type": "disabled"}
		case runtimev1.ReasoningActivation_REASONING_ACTIVATION_REQUIRED:
			if p.model != "amazon.nova-2-lite-v1:0" {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			effort := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high"}[r.GetEffort()]
			if effort == "" || effort == "high" && (s.Temperature != nil || s.TopP != nil || s.TopK != nil) {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			additional["reasoningConfig"] = map[string]any{"type": "enabled", "maxReasoningEffort": effort}
		default:
			return textbehavior.SerializedRequest{}, deepseekUnsupported()
		}
	}
	messages := []map[string]any{}
	system := []map[string]string{}
	if s.GetSystemPrompt() != "" {
		system = append(system, map[string]string{"text": s.GetSystemPrompt()})
	}
	appendBlock := func(role string, block map[string]any) {
		if len(messages) == 0 || messages[len(messages)-1]["role"] != role {
			messages = append(messages, map[string]any{"role": role, "content": []map[string]any{}})
		}
		last := messages[len(messages)-1]
		last["content"] = append(last["content"].([]map[string]any), block)
	}
	images, videos := 0, 0
	for _, m := range s.GetInput() {
		if m == nil {
			return textbehavior.SerializedRequest{}, deepseekJSONInputError("empty Nova message")
		}
		if len(m.GetTurnItems()) > 0 {
			for _, item := range m.GetTurnItems() {
				if v := item.GetToolResult(); v != nil {
					status := "success"
					if v.GetIsError() {
						status = "error"
					}
					appendBlock("user", map[string]any{"toolResult": map[string]any{"toolUseId": v.GetToolCallId(), "status": status, "content": []map[string]any{{"json": v.GetResult().AsInterface()}}}})
				} else if v := item.GetOutput().GetToolCall(); v != nil {
					var args map[string]any
					if json.Unmarshal([]byte(v.GetArgumentsJson()), &args) != nil || args == nil {
						return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova tool arguments")
					}
					appendBlock("assistant", map[string]any{"toolUse": map[string]any{"toolUseId": v.GetId(), "name": v.GetName(), "input": args}})
				} else if v := item.GetOutput().GetText(); v != nil {
					appendBlock("assistant", map[string]any{"text": v.GetText()})
				} else {
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
			}
			continue
		}
		if m.GetRole() == "system" {
			if len(messages) > 0 || len(m.GetParts()) > 0 {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			system = append(system, map[string]string{"text": m.GetContent()})
			continue
		}
		if m.GetRole() != "user" && m.GetRole() != "assistant" || m.GetContent() != "" && len(m.GetParts()) > 0 {
			return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova message role or content")
		}
		if len(m.GetParts()) == 0 {
			appendBlock(m.GetRole(), map[string]any{"text": m.GetContent()})
			continue
		}
		for _, part := range m.GetParts() {
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				appendBlock(m.GetRole(), map[string]any{"text": part.GetText()})
				continue
			}
			if m.GetRole() != "user" || p.model == "amazon.nova-micro-v1:0" {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				images++
				if images > 5 || part.GetImageUrl().GetDetail() != "" {
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
				imageLimit := 3_750_000
				if p.model == "amazon.nova-2-lite-v1:0" {
					imageLimit = 18_750_000
				}
				format, data, err := bedrockInlineImage(part.GetImageUrl().GetUrl(), imageLimit)
				if err != nil {
					return textbehavior.SerializedRequest{}, err
				}
				appendBlock("user", map[string]any{"image": map[string]any{"format": format, "source": map[string]string{"bytes": data}}})
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				videos++
				if videos > 1 {
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
				header, data, ok := strings.Cut(part.GetVideoUrl(), ",")
				format := map[string]string{"data:video/mp4;base64": "mp4", "data:video/quicktime;base64": "mov", "data:video/x-matroska;base64": "mkv", "data:video/webm;base64": "webm", "data:video/mpeg;base64": "mpeg", "data:video/x-ms-wmv;base64": "wmv", "data:video/3gpp;base64": "three_gp", "data:video/x-flv;base64": "flv"}[header]
				if !ok || format == "" || len(data) > base64.StdEncoding.EncodedLen(18_750_000) {
					return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova inline video format or limit")
				}
				if decoded, err := base64.StdEncoding.Strict().DecodeString(data); err != nil || len(decoded) == 0 {
					return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova video bytes")
				}
				appendBlock("user", map[string]any{"video": map[string]any{"format": format, "source": map[string]string{"bytes": data}}})
			default:
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
		}
	}
	if len(messages) == 0 || messages[0]["role"] != "user" {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova first message must be user")
	}
	body := map[string]any{"messages": messages}
	if len(system) > 0 {
		body["system"] = system
	}
	if len(config) > 0 {
		body["inferenceConfig"] = config
	}
	if len(additional) > 0 {
		body["additionalModelRequestFields"] = additional
	}
	if len(s.GetTools()) > 0 {
		tools := []map[string]any{}
		for _, tool := range s.GetTools() {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION || tool.GetInputSchema().AsMap()["type"] != "object" {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			if _, err := textbehavior.CompileJSONSchema(tool.GetInputSchema().AsMap()); err != nil {
				return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova tool schema")
			}
			tools = append(tools, map[string]any{"toolSpec": map[string]any{"name": tool.GetName(), "description": tool.GetDescription(), "inputSchema": map[string]any{"json": tool.GetInputSchema().AsMap()}}})
		}
		choice := map[string]any{"auto": map[string]any{}}
		switch s.GetToolChoice() {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO:
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			choice = map[string]any{"any": map[string]any{}}
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			choice = map[string]any{"tool": map[string]string{"name": s.GetToolChoiceName()}}
		default:
			return textbehavior.SerializedRequest{}, deepseekUnsupported()
		}
		body["toolConfig"] = map[string]any{"tools": tools, "toolChoice": choice}
	}
	payload, err := json.Marshal(body)
	if len(payload) > 25_000_000 {
		return textbehavior.SerializedRequest{}, deepseekJSONInputError("Nova request exceeds 25 MB")
	}
	return textbehavior.SerializedRequest{Protocol: BedrockNovaConverseProtocol, ContentType: "application/json", Payload: payload}, err
}
