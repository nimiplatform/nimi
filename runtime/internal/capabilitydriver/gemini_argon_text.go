package capabilitydriver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const GeminiArgonInteractionsProtocol = "gemini.argon.interactions/v1"
const GeminiArgonThoughtKind = "gemini.argon.interactions.thought"

type geminiInteractionContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type geminiInteractionThought struct {
	Type      string                     `json:"type"`
	Signature string                     `json:"signature"`
	Summary   []geminiInteractionContent `json:"summary,omitempty"`
}

func geminiArgonReplay(carrier *runtimev1.ReasoningContinuityCarrier) (geminiInteractionThought, error) {
	var thought geminiInteractionThought
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_REASONING_CONTINUITY_INVALID)
	if !textbehavior.ValidContinuity(carrier) || carrier.GetKind() != GeminiArgonThoughtKind || carrier.GetVersion() != 1 {
		return thought, invalid
	}
	d := json.NewDecoder(bytes.NewReader(carrier.GetPayload()))
	d.DisallowUnknownFields()
	if d.Decode(&thought) != nil || d.Decode(new(any)) != io.EOF || !geminiArgonThoughtValid(thought) {
		return thought, invalid
	}
	return thought, nil
}

func geminiArgonThoughtValid(thought geminiInteractionThought) bool {
	if thought.Type != "thought" || strings.TrimSpace(thought.Signature) == "" {
		return false
	}
	for _, summary := range thought.Summary {
		if summary.Type != "text" {
			return false
		}
	}
	return true
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-argon-text-behaviors
func GeminiArgonRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
	return geminiArgonSerialize(spec, stream, false)
}

func geminiArgonSerialize(spec *runtimev1.TextGenerateScenarioSpec, stream, planning bool) (textbehavior.SerializedRequest, error) {
	unsupported := func() (textbehavior.SerializedRequest, error) {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	if spec == nil || spec.GetIncludeRawChunks() || textbehavior.RequiresOrderedSystemMessages(spec) ||
		spec.Temperature != nil || spec.TopP != nil || spec.TopK != nil || spec.PresencePenalty != nil || spec.FrequencyPenalty != nil || spec.Seed != nil ||
		(spec.MaxTokens != nil && (spec.GetMaxTokens() <= 0 || spec.GetMaxTokens() > 65536)) {
		return unsupported()
	}
	config := map[string]any{"thinking_summaries": "none"}
	if spec.MaxTokens != nil {
		config["max_output_tokens"] = spec.GetMaxTokens()
	}
	if len(spec.GetStop()) > 0 {
		config["stop_sequences"] = spec.GetStop()
	}
	if reasoning := spec.GetReasoning(); reasoning != nil {
		if reasoning.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_UNSPECIFIED && reasoning.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_HIDDEN && reasoning.GetPresentation() != runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
			return unsupported()
		}
		if reasoning.GetPresentation() == runtimev1.ReasoningPresentation_REASONING_PRESENTATION_SUMMARY {
			config["thinking_summaries"] = "auto"
		}
		if reasoning.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_UNSPECIFIED || reasoning.GetIntensity() != nil {
			if reasoning.GetActivation() != runtimev1.ReasoningActivation_REASONING_ACTIVATION_ADAPTIVE {
				return unsupported()
			}
			if _, ok := reasoning.GetIntensity().(*runtimev1.ReasoningConfig_Effort); !ok {
				return unsupported()
			}
			levels := map[runtimev1.ReasoningEffort]string{runtimev1.ReasoningEffort_REASONING_EFFORT_LOW: "low", runtimev1.ReasoningEffort_REASONING_EFFORT_MEDIUM: "medium", runtimev1.ReasoningEffort_REASONING_EFFORT_HIGH: "high"}
			level, ok := levels[reasoning.GetEffort()]
			if !ok && reasoning.GetEffort() != runtimev1.ReasoningEffort_REASONING_EFFORT_MODEL_DEFAULT {
				return unsupported()
			}
			if ok {
				config["thinking_level"] = level
			}
		}
	}
	var input []any
	system := spec.GetSystemPrompt()
	for _, message := range spec.GetInput() {
		if message == nil {
			return unsupported()
		}
		if len(message.GetTurnItems()) > 0 {
			if message.GetRole() != "assistant" || message.GetContent() != "" || len(message.GetParts()) > 0 {
				return unsupported()
			}
			for index, item := range message.GetTurnItems() {
				if result := item.GetToolResult(); result != nil {
					if result.GetDynamic() || result.GetPreliminary() || result.GetProviderMetadata() != nil {
						return unsupported()
					}
					// A JSON value remains a string result on the wire; no number or whitespace is rewritten by the adapter.
					value, err := json.Marshal(result.GetResult().AsInterface())
					if err != nil {
						return unsupported()
					}
					input = append(input, map[string]any{"type": "function_result", "call_id": result.GetToolCallId(), "name": result.GetToolName(), "result": string(value), "is_error": result.GetIsError()})
				} else if call := item.GetOutput().GetToolCall(); call != nil {
					var args map[string]json.RawMessage
					if call.GetDynamic() || call.GetProviderMetadata() != nil || json.Unmarshal([]byte(call.GetArgumentsJson()), &args) != nil || args == nil {
						return unsupported()
					}
					input = append(input, map[string]any{"type": "function_call", "id": call.GetId(), "name": call.GetName(), "arguments": args})
				} else if summary := item.GetOutput().GetReasoningSummary(); summary != nil {
					// The public text is a projection of the next signed thought,
					// never an extra native conversation item or substituted state.
					if index+1 >= len(message.GetTurnItems()) {
						return unsupported()
					}
					thought, err := geminiArgonReplay(message.GetTurnItems()[index+1].GetOutput().GetReasoningContinuity())
					if err != nil {
						return textbehavior.SerializedRequest{}, err
					}
					if summary.GetText() != geminiArgonSummaryText(thought.Summary) {
						return unsupported()
					}
				} else if carrier := item.GetOutput().GetReasoningContinuity(); carrier != nil {
					thought, err := geminiArgonReplay(carrier)
					if err != nil {
						return textbehavior.SerializedRequest{}, err
					}
					input = append(input, thought)
				} else if output := item.GetOutput().GetText(); output != nil {
					input = append(input, map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": output.GetText()}}})
				} else {
					return unsupported()
				}
			}
			continue
		}
		var content []map[string]any
		if message.GetContent() != "" {
			content = append(content, map[string]any{"type": "text", "text": message.GetContent()})
		}
		for _, part := range message.GetParts() {
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				content = append(content, map[string]any{"type": "text", "text": part.GetText()})
				continue
			}
			if message.GetRole() != "user" {
				return unsupported()
			}
			media, err := geminiArgonMedia(part, planning)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			content = append(content, media)
		}
		if len(content) == 0 {
			return unsupported()
		}
		switch message.GetRole() {
		case "system":
			for _, part := range content {
				if part["type"] != "text" {
					return unsupported()
				}
				system += part["text"].(string)
			}
		case "user":
			input = append(input, map[string]any{"type": "user_input", "content": content})
		case "assistant":
			input = append(input, map[string]any{"type": "model_output", "content": content})
		default:
			return unsupported()
		}
	}
	if len(input) == 0 {
		return unsupported()
	}
	body := map[string]any{"input": input, "store": false, "background": false, "stream": stream, "generation_config": config, "response_format": map[string]any{"type": "text", "mime_type": "text/plain"}}
	if system != "" {
		body["system_instruction"] = system
	}
	if len(spec.GetTools()) > 0 {
		var tools []any
		for _, tool := range spec.GetTools() {
			if tool.GetKind() != runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION || tool.GetProviderToolId() != "" || tool.GetProviderArgs() != nil || tool.GetProviderMetadata() != nil || !deepseekFunctionName(tool.GetName()) {
				return unsupported()
			}
			schema := tool.GetInputSchema().AsMap()
			if !geminiSchemaSubset(schema, 0) {
				return unsupported()
			}
			if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
				return unsupported()
			}
			tools = append(tools, map[string]any{"type": "function", "name": tool.GetName(), "description": tool.GetDescription(), "parameters": schema})
		}
		body["tools"] = tools
		switch spec.GetToolChoice() {
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED, runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO:
			config["tool_choice"] = "auto"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_NONE:
			config["tool_choice"] = "none"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_REQUIRED:
			config["tool_choice"] = "any"
		case runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL:
			config["tool_choice"] = map[string]any{"allowed_tools": map[string]any{"mode": "any", "tools": []string{spec.GetToolChoiceName()}}}
		default:
			return unsupported()
		}
	} else if spec.GetToolChoice() != runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED || spec.GetToolChoiceName() != "" {
		return unsupported()
	}
	switch spec.GetResponseFormat().GetKind() {
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED, runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT:
	case runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_SCHEMA:
		format := spec.GetResponseFormat()
		schema := format.GetJsonSchema().AsMap()
		if !format.GetStrict() || !geminiSchemaSubset(schema, 0) {
			return unsupported()
		}
		if _, err := textbehavior.CompileJSONSchema(schema); err != nil {
			return unsupported()
		}
		body["response_format"] = map[string]any{"type": "text", "mime_type": "application/json", "schema": schema}
	default:
		return unsupported()
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if len(payload) > GeminiNativeMaxRequestBytes {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Protocol: GeminiArgonInteractionsProtocol, Payload: payload}, nil
}

func geminiArgonMedia(part *runtimev1.ChatContentPart, planning bool) (map[string]any, error) {
	kind, location := part.GetType(), ""
	if planning && kind == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
		mime := part.GetArtifactRef().GetMimeType()
		mediaKind := ""
		switch mime {
		case "image/png", "image/jpeg", "image/webp", "image/gif":
			mediaKind = "image"
		case "audio/wav", "audio/mpeg":
			mediaKind = "audio"
		case "video/mp4":
			mediaKind = "video"
		default:
			return nil, geminiSchemaUnsupported()
		}
		return map[string]any{"type": mediaKind, "mime_type": mime, "data": ""}, nil
	}
	switch kind {
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
		location = part.GetImageUrl().GetUrl()
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
		location = part.GetAudioUrl()
	case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
		location = part.GetVideoUrl()
	default:
		return nil, geminiSchemaUnsupported()
	}
	native, err := gemini38NativeMediaPart(kind, location)
	if err != nil {
		return nil, err
	}
	mediaKind := map[runtimev1.ChatContentPartType]string{runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL: "image", runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL: "audio", runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL: "video"}[kind]
	if data, ok := native["inlineData"].(map[string]any); ok {
		return map[string]any{"type": mediaKind, "mime_type": data["mimeType"], "data": data["data"]}, nil
	}
	return map[string]any{"type": "image", "uri": location}, nil
}

func GeminiArgonPlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	serializer := func(input *runtimev1.TextGenerateScenarioSpec, stream bool) (textbehavior.SerializedRequest, error) {
		return geminiArgonSerialize(input, stream, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, serializer, stream)
	prepared = proto.Clone(prepared).(*runtimev1.TextGenerateScenarioSpec)
	plan, err := serializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(GeminiNativeMaxRequestBytes, int64(len(plan.Payload)))
	return prepared, budget, err
}
