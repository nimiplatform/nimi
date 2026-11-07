package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const MiniMaxMessagesProtocol = "minimax.messages/v1"
const MiniMaxMessagesMaxRequestBytes = 64_000_000

type MiniMaxMessagesBehavior struct{ model string }

func NewMiniMaxMessagesBehavior(model string) (MiniMaxMessagesBehavior, error) {
	if model != "MiniMax-M3.1-Flash" && model != "MiniMax-M3" {
		return MiniMaxMessagesBehavior{}, deepseekUnsupported()
	}
	return MiniMaxMessagesBehavior{model: model}, nil
}

func (p MiniMaxMessagesBehavior) ContinuityKind() string {
	return "minimax.messages.native-reasoning-replay." + p.model
}

// @nimi-authority: rule.nimi.runtime.ai-provider.minimax-m3-messages
func (p MiniMaxMessagesBehavior) controls(spec *runtimev1.TextGenerateScenarioSpec) (map[string]any, bool, error) {
	if p.model == "" || spec == nil || spec.GetIncludeRawChunks() || spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || spec.Seed != nil || len(spec.GetStop()) > 0 {
		return nil, false, deepseekUnsupported()
	}
	if spec.MaxTokens != nil && (spec.GetMaxTokens() < 1 || spec.GetMaxTokens() > 524288) {
		return nil, false, miniMaxTextInput("output token limit")
	}
	f := spec.GetResponseFormat()
	if f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED && f.GetKind() != runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT || f.GetStrict() || f.GetJsonSchema() != nil {
		return nil, false, deepseekUnsupported()
	}
	if spec.GetToolChoiceName() != "" || spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO || len(spec.GetTools()) == 0 && spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO {
		return nil, false, deepseekUnsupported()
	}
	body := map[string]any{}
	thinking := p.model == "MiniMax-M3.1-Flash"
	r := spec.GetReasoning()
	if r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && r.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN {
		return nil, false, deepseekUnsupported()
	}
	switch r.GetActivation() {
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED:
		if r.GetIntensity() != nil {
			return nil, false, deepseekUnsupported()
		}
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_DISABLED:
		if p.model != "MiniMax-M3" || r.GetIntensity() != nil {
			return nil, false, deepseekUnsupported()
		}
		body["thinking"] = map[string]string{"type": "disabled"}
		thinking = false
	case runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE:
		if _, ok := r.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
			return nil, false, deepseekUnsupported()
		}
		body["thinking"] = map[string]string{"type": "adaptive"}
		thinking = true
		if r.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
			if p.model != "MiniMax-M3.1-Flash" {
				return nil, false, deepseekUnsupported()
			}
			effort, ok := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high", runtimev1.ReasoningEffort_REASONING_EFFORT_XHIGH: "xhigh", runtimev1.ReasoningEffort_REASONING_EFFORT_MAXIMUM: "max"}[r.GetEffort()]
			if !ok {
				return nil, false, deepseekUnsupported()
			}
			body["output_config"] = map[string]string{"effort": effort}
		}
	default:
		return nil, false, deepseekUnsupported()
	}
	return body, thinking, nil
}

func (p MiniMaxMessagesBehavior) Serialize(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return p.serialize(spec, stream, false)
}

func (p MiniMaxMessagesBehavior) serialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	body, _, err := p.controls(spec)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	messages := []map[string]any{}
	system := []map[string]any{}
	if spec.GetSystemPrompt() != "" {
		system = append(system, map[string]any{"type": "text", "text": spec.GetSystemPrompt()})
	}
	appendBlock := func(role string, block any) {
		if len(messages) == 0 || messages[len(messages)-1]["role"] != role {
			messages = append(messages, map[string]any{"role": role, "content": []any{}})
		}
		m := messages[len(messages)-1]
		m["content"] = append(m["content"].([]any), block)
	}
	for _, m := range spec.GetInput() {
		if m == nil {
			return textbehavior.SerializedRequest{}, miniMaxTextInput("missing message")
		}
		if m.GetRole() == "system" {
			if len(messages) > 0 || len(m.GetTurnItems()) > 0 {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			text := m.GetContent()
			if text != "" && len(m.GetParts()) > 0 {
				return textbehavior.SerializedRequest{}, miniMaxTextInput("conflicting system content")
			}
			for _, part := range m.GetParts() {
				if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
				text += part.GetText()
			}
			system = append(system, map[string]any{"type": "text", "text": text})
			continue
		}
		if len(m.GetTurnItems()) > 0 {
			if m.GetRole() != "assistant" && m.GetRole() != "tool" || m.GetContent() != "" || len(m.GetParts()) > 0 {
				return textbehavior.SerializedRequest{}, miniMaxTextInput("ordered transcript")
			}
			for _, item := range m.GetTurnItems() {
				if result := item.GetToolResult(); result != nil {
					if result.GetDynamic() || result.GetPreliminary() || result.GetProviderMetadata() != nil {
						return textbehavior.SerializedRequest{}, deepseekUnsupported()
					}
					value := any(nil)
					if result.GetResult() != nil {
						value = result.GetResult().AsInterface()
					}
					if result.GetIsError() {
						value = map[string]any{"error": value}
					}
					content, ok := value.(string)
					if !ok {
						encoded, err := json.Marshal(value)
						if err != nil {
							return textbehavior.SerializedRequest{}, err
						}
						content = string(encoded)
					}
					appendBlock("user", map[string]any{"type": "tool_result", "tool_use_id": result.GetToolCallId(), "content": content})
					continue
				}
				if m.GetRole() != "assistant" || item.GetOutput() == nil {
					return textbehavior.SerializedRequest{}, miniMaxTextInput("assistant output item")
				}
				switch value := item.GetOutput().GetItem().(type) {
				case *runtimev1.TextOutputItem_Text:
					appendBlock("assistant", map[string]any{"type": "text", "text": value.Text.GetText()})
				case *runtimev1.TextOutputItem_ToolCall:
					call := value.ToolCall
					if call == nil || call.GetDynamic() || call.GetProviderMetadata() != nil {
						return textbehavior.SerializedRequest{}, deepseekUnsupported()
					}
					var input map[string]any
					if json.Unmarshal([]byte(call.GetArgumentsJson()), &input) != nil || input == nil {
						return textbehavior.SerializedRequest{}, miniMaxTextInput("tool input")
					}
					appendBlock("assistant", map[string]any{"type": "tool_use", "id": call.GetId(), "name": call.GetName(), "input": input})
				case *runtimev1.TextOutputItem_ReasoningContinuity:
					block, err := p.readThinking(value.ReasoningContinuity)
					if err != nil {
						return textbehavior.SerializedRequest{}, err
					}
					appendBlock("assistant", block)
				default:
					return textbehavior.SerializedRequest{}, deepseekUnsupported()
				}
			}
			continue
		}
		if m.GetRole() != "user" && m.GetRole() != "assistant" {
			return textbehavior.SerializedRequest{}, miniMaxTextInput("message role")
		}
		if len(m.GetParts()) == 0 {
			appendBlock(m.GetRole(), map[string]any{"type": "text", "text": m.GetContent()})
			continue
		}
		if m.GetContent() != "" {
			return textbehavior.SerializedRequest{}, miniMaxTextInput("conflicting content")
		}
		for _, part := range m.GetParts() {
			if part == nil {
				return textbehavior.SerializedRequest{}, miniMaxTextInput("missing content part")
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				appendBlock(m.GetRole(), map[string]any{"type": "text", "text": part.GetText()})
				continue
			}
			if m.GetRole() != "user" {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			block, err := miniMaxMediaBlock(part, planning)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			appendBlock("user", block)
		}
	}
	if len(messages) == 0 {
		return textbehavior.SerializedRequest{}, miniMaxTextInput("missing conversation")
	}
	body["model"], body["messages"], body["stream"] = p.model, messages, stream
	if len(system) > 0 {
		body["system"] = system
	}
	if spec.MaxTokens != nil {
		body["max_tokens"] = spec.GetMaxTokens()
	}
	if len(spec.GetTools()) > 0 {
		tools := []map[string]any{}
		declared := map[string]bool{}
		for _, tool := range spec.GetTools() {
			if tool == nil || tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION || tool.GetProviderToolId() != "" || tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil {
				return textbehavior.SerializedRequest{}, deepseekUnsupported()
			}
			if !deepseekFunctionName(tool.GetName()) || declared[tool.GetName()] {
				return textbehavior.SerializedRequest{}, miniMaxTextInput("tool name")
			}
			declared[tool.GetName()] = true
			schema := map[string]any{"type": "object", "properties": map[string]any{}}
			if tool.GetInputSchema() != nil {
				schema = tool.GetInputSchema().AsMap()
			}
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return textbehavior.SerializedRequest{}, miniMaxTextInput("tool schema")
			}
			tools = append(tools, map[string]any{"name": tool.GetName(), "description": tool.GetDescription(), "input_schema": schema})
		}
		body["tools"], body["tool_choice"] = tools, map[string]string{"type": "auto"}
	}
	payload, err := json.Marshal(body)
	if len(payload) > MiniMaxMessagesMaxRequestBytes {
		return textbehavior.SerializedRequest{}, miniMaxTextInput("64 MB native body limit")
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Protocol: MiniMaxMessagesProtocol, Payload: payload}, err
}

func miniMaxMediaBlock(part *runtimev1.ChatContentPart, planning bool) (map[string]any, error) {
	kind, location, detail := "", "", ""
	switch part.GetType() {
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF:
		if !planning {
			return nil, deepseekUnsupported()
		}
		mime := part.GetArtifactRef().GetMimeType()
		if mime == "video/mp4" {
			kind = "video"
		} else if deepseekImageMIME(mime) {
			kind = "image"
		} else {
			return nil, deepseekUnsupported()
		}
		// Only envelope overhead; captured owned bytes replace this before dispatch.
		return map[string]any{"type": kind, "source": map[string]any{"type": "base64", "media_type": mime, "data": ""}}, nil
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
		kind, location, detail = "image", part.GetImageUrl().GetUrl(), part.GetImageUrl().GetDetail()
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
		kind, location = "video", part.GetVideoUrl()
	default:
		return nil, deepseekUnsupported()
	}
	var source map[string]any
	if strings.HasPrefix(location, "data:") {
		fields := strings.SplitN(location, ",", 2)
		if len(fields) != 2 || !strings.HasSuffix(fields[0], ";base64") {
			return nil, miniMaxTextInput("inline media")
		}
		mime := strings.TrimSuffix(strings.TrimPrefix(fields[0], "data:"), ";base64")
		limit := 10_000_000
		if kind == "video" {
			limit = 50_000_000
			if mime != "video/mp4" {
				return nil, deepseekUnsupported()
			}
		} else if !deepseekImageMIME(mime) {
			return nil, deepseekUnsupported()
		}
		if len(fields[1]) > base64.StdEncoding.EncodedLen(limit) {
			return nil, miniMaxTextInput("media byte limit")
		}
		decoded, err := base64.StdEncoding.DecodeString(fields[1])
		if err != nil || len(decoded) == 0 || len(decoded) > limit {
			return nil, miniMaxTextInput("media byte limit")
		}
		if kind == "image" {
			config, format, err := image.DecodeConfig(bytes.NewReader(decoded))
			if err != nil || "image/"+format != mime || config.Width <= 0 || config.Height <= 0 {
				return nil, miniMaxTextInput("image content")
			}
		} else if len(decoded) < 12 || string(decoded[4:8]) != "ftyp" {
			return nil, miniMaxTextInput("MP4 content")
		}
		source = map[string]any{"type": "base64", "media_type": mime, "data": fields[1]}
	} else {
		u, err := url.Parse(location)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.Fragment != "" {
			return nil, miniMaxTextInput("public media URL")
		}
		source = map[string]any{"type": "url", "url": location}
	}
	switch detail {
	case "", "auto":
	case "low", "high":
		source["detail"] = detail
	default:
		return nil, deepseekUnsupported()
	}
	return map[string]any{"type": kind, "source": source}, nil
}

func (p MiniMaxMessagesBehavior) PlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(s *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return p.serialize(s, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	prepared = proto.Clone(prepared).(*runtimev1.TextGenerateScenarioSpec)
	wire, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(MiniMaxMessagesMaxRequestBytes, int64(len(wire.Payload)))
	return prepared, budget, err
}

func miniMaxTextInput(detail string) error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "MiniMax text input: " + detail})
}
