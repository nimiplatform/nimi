package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const GeminiNativeBaseProtocol = "gemini.generate-content/v1"
const GeminiNativeMaxRequestBytes = 20000000

func gemini38BaseSpec(spec *runtimev1.TextGenerateScenarioSpec) bool {
	return spec != nil && len(spec.GetTools()) == 0 &&
		(spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_UNSPECIFIED || spec.GetResponseFormat().GetKind() == runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_TEXT) &&
		spec.GetToolChoice() == runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_UNSPECIFIED && spec.GetToolChoiceName() == "" && !llamaBehaviorReasoningEnabled(spec)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-native-base-text
func Gemini38FlashBaseRequestSerializer(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
	return gemini38BaseSerialize(spec, false)
}

func gemini38BaseSerialize(spec *runtimev1.TextGenerateScenarioSpec, planning bool) (textbehavior.SerializedRequest, error) {
	if !gemini38BaseSpec(spec) || spec.GetIncludeRawChunks() {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	var contents, system []map[string]any
	if spec.GetSystemPrompt() != "" {
		system = append(system, map[string]any{"text": spec.GetSystemPrompt()})
	}
	for _, message := range spec.GetInput() {
		if message == nil {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		role := message.GetRole()
		var parts []map[string]any
		if message.GetContent() != "" {
			parts = append(parts, map[string]any{"text": message.GetContent()})
		}
		for _, item := range message.GetTurnItems() {
			if item.GetOutput().GetText() == nil {
				return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
			}
			parts = append(parts, map[string]any{"text": item.GetOutput().GetText().GetText()})
		}
		for _, part := range message.GetParts() {
			if part == nil {
				return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
			}
			if part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
				parts = append(parts, map[string]any{"text": part.GetText()})
				continue
			}
			if role != "user" {
				return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
			}
			if planning && part.GetType() == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_ARTIFACT_REF {
				mime := part.GetArtifactRef().GetMimeType()
				if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" && mime != "image/gif" && mime != "audio/wav" && mime != "audio/mpeg" && mime != "video/mp4" {
					return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
				}
				// Empty data is a size template only, never a provider request.
				parts = append(parts, map[string]any{"inlineData": map[string]any{"mimeType": mime, "data": ""}})
				continue
			}
			location := ""
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				location = part.GetImageUrl().GetUrl()
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				location = part.GetAudioUrl()
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				location = part.GetVideoUrl()
			default:
				return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
			}
			media, err := gemini38NativeMediaPart(part.GetType(), location)
			if err != nil {
				return textbehavior.SerializedRequest{}, err
			}
			parts = append(parts, media)
		}
		if len(parts) == 0 {
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
		switch role {
		case "system":
			system = append(system, parts...)
		case "user":
			contents = append(contents, map[string]any{"role": "user", "parts": parts})
		case "assistant":
			contents = append(contents, map[string]any{"role": "model", "parts": parts})
		default:
			return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
		}
	}
	if len(contents) == 0 {
		return textbehavior.SerializedRequest{}, geminiSchemaUnsupported()
	}
	config := map[string]any{"responseModalities": []string{"TEXT"}}
	if spec.Temperature != nil {
		config["temperature"] = spec.GetTemperature()
	}
	if spec.TopP != nil {
		config["topP"] = spec.GetTopP()
	}
	if spec.TopK != nil {
		config["topK"] = spec.GetTopK()
	}
	if spec.MaxTokens != nil {
		config["maxOutputTokens"] = spec.GetMaxTokens()
	}
	if spec.PresencePenalty != nil {
		config["presencePenalty"] = spec.GetPresencePenalty()
	}
	if spec.FrequencyPenalty != nil {
		config["frequencyPenalty"] = spec.GetFrequencyPenalty()
	}
	if spec.Seed != nil {
		config["seed"] = spec.GetSeed()
	}
	if len(spec.GetStop()) != 0 {
		config["stopSequences"] = spec.GetStop()
	}
	body := map[string]any{"contents": contents, "generationConfig": config}
	if len(system) != 0 {
		body["systemInstruction"] = map[string]any{"parts": system}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return textbehavior.SerializedRequest{}, err
	}
	if len(payload) > GeminiNativeMaxRequestBytes {
		return textbehavior.SerializedRequest{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return textbehavior.SerializedRequest{ContentType: "application/json", Payload: payload, Protocol: GeminiNativeBaseProtocol}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-native-base-text
// Build the exact native JSON overhead before any owned media is read.
func Gemini38FlashPlanMaterialization(ctx context.Context, spec *runtimev1.TextGenerateScenarioSpec, stream bool) (*runtimev1.TextGenerateScenarioSpec, *textbehavior.OwnedMediaInputBudget, error) {
	if !gemini38BaseSpec(spec) {
		if gemini38HasAudioVideoInput(spec) {
			return nil, nil, geminiSchemaUnsupported()
		}
		return spec, nil, nil
	}
	planSerializer := func(input *runtimev1.TextGenerateScenarioSpec, _ bool) (textbehavior.SerializedRequest, error) {
		return gemini38BaseSerialize(input, true)
	}
	prepared := textbehavior.ApplyInternalOutputBudget(ctx, spec, planSerializer, stream)
	// Keep a distinct captured clone rather than mutating the caller's request.
	prepared, _ = proto.Clone(prepared).(*runtimev1.TextGenerateScenarioSpec)
	plan, err := planSerializer(prepared, stream)
	if err != nil {
		return nil, nil, err
	}
	budget, err := textbehavior.NewOwnedMediaInputBudget(GeminiNativeMaxRequestBytes, int64(len(plan.Payload)))
	return prepared, budget, err
}

func gemini38NativeMediaPart(kind runtimev1.ChatContentPartType, location string) (map[string]any, error) {
	invalid := func() (map[string]any, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if strings.HasPrefix(location, "data:") {
		fields := strings.SplitN(location, ",", 2)
		if len(fields) != 2 || !strings.HasSuffix(fields[0], ";base64") {
			return invalid()
		}
		mime := strings.TrimSuffix(strings.TrimPrefix(fields[0], "data:"), ";base64")
		valid := (kind == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL && (mime == "audio/wav" || mime == "audio/mpeg")) ||
			(kind == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL && mime == "video/mp4") ||
			(kind == runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL && (mime == "image/png" || mime == "image/jpeg" || mime == "image/webp" || mime == "image/gif"))
		decoded, err := base64.StdEncoding.DecodeString(fields[1])
		if !valid || err != nil || len(decoded) == 0 {
			return invalid()
		}
		return map[string]any{"inlineData": map[string]any{"mimeType": mime, "data": fields[1]}}, nil
	}
	parsed, err := url.Parse(location)
	if kind != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL || err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return invalid()
	}
	return map[string]any{"fileData": map[string]any{"fileUri": location}}, nil
}

type gemini38BaseStream struct {
	text   strings.Builder
	finish runtimev1.FinishReason
	usage  *runtimev1.UsageStats
}

func (s *gemini38BaseStream) Append(payload []byte) ([]textbehavior.OrderedDelta, error) {
	invalid := func() ([]textbehavior.OrderedDelta, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	var body struct {
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
		Candidates []struct {
			Content struct {
				Parts []map[string]json.RawMessage `json:"parts"`
			} `json:"content"`
			Finish string `json:"finishReason"`
		} `json:"candidates"`
		Usage *struct {
			Prompt *int64 `json:"promptTokenCount"`
			Total  *int64 `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if json.Unmarshal(payload, &body) != nil || len(body.Candidates) > 1 {
		return invalid()
	}
	if body.PromptFeedback.BlockReason != "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
	}
	if body.Usage != nil {
		if (body.Usage.Prompt != nil && *body.Usage.Prompt < 0) || (body.Usage.Total != nil && *body.Usage.Total < 0) {
			return invalid()
		}
		if body.Usage.Prompt != nil && body.Usage.Total != nil {
			if *body.Usage.Total < *body.Usage.Prompt {
				return invalid()
			}
			s.usage = &runtimev1.UsageStats{InputTokens: *body.Usage.Prompt, OutputTokens: *body.Usage.Total - *body.Usage.Prompt}
		}
	}
	if len(body.Candidates) == 0 {
		if body.Usage == nil {
			return invalid()
		}
		return nil, nil
	}
	var delta strings.Builder
	for _, part := range body.Candidates[0].Content.Parts {
		for key := range part {
			if key != "text" && key != "thought" && key != "thoughtSignature" {
				return invalid()
			}
		}
		var thought bool
		if raw, ok := part["thought"]; ok && json.Unmarshal(raw, &thought) != nil {
			return invalid()
		}
		if thought {
			continue
		}
		var text string
		if raw, ok := part["text"]; ok {
			if json.Unmarshal(raw, &text) != nil {
				return invalid()
			}
			delta.WriteString(text)
		}
	}
	if s.finish != runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED && (delta.Len() != 0 || body.Candidates[0].Finish != "") {
		return invalid()
	}
	if s.text.Len()+delta.Len() > 256*1024 {
		return invalid()
	}
	s.text.WriteString(delta.String())
	if finish := body.Candidates[0].Finish; finish != "" {
		switch finish {
		case "STOP":
			s.finish = runtimev1.FinishReason_FINISH_REASON_STOP
		case "MAX_TOKENS":
			s.finish = runtimev1.FinishReason_FINISH_REASON_LENGTH
		case "SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY":
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED)
		default:
			return invalid()
		}
	}
	if delta.Len() == 0 && body.Candidates[0].Finish == "" {
		return nil, nil
	}
	return []textbehavior.OrderedDelta{{ItemIndex: 0, Kind: textbehavior.OrderedItemText, Text: delta.String(), ItemCompleted: body.Candidates[0].Finish != ""}}, nil
}

func (s *gemini38BaseStream) Finish() (textbehavior.NormalizedResult, error) {
	if s.finish == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED || strings.TrimSpace(s.text.String()) == "" {
		return textbehavior.NormalizedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return textbehavior.NormalizedResult{Items: []textbehavior.OrderedItem{{Kind: textbehavior.OrderedItemText, Text: s.text.String()}}, FinishReason: s.finish, Usage: s.usage}, nil
}

func Gemini38FlashBaseNonStreamParser(payload []byte, _ *runtimev1.TextGenerateScenarioSpec) (textbehavior.NormalizedResult, error) {
	s := &gemini38BaseStream{}
	if _, err := s.Append(payload); err != nil {
		return textbehavior.NormalizedResult{}, err
	}
	return s.Finish()
}
