package nimillm

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	AdapterMimoChatTranscribe = "mimo_chat_transcribe_adapter"
	AdapterMimoChatSynthesize = "mimo_chat_synthesize_adapter"

	mimoVoiceRefPrefix = "mimo:"
)

func (b *Backend) supportsMimoChatCompletions() bool {
	if b == nil {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(b.Name))
	name = strings.TrimPrefix(name, "cloud-")
	name = strings.TrimPrefix(name, "cloud_")
	return name == "mimo" || strings.Contains(name, "xiaomimimo")
}

func isMimoModelID(modelID string) bool {
	normalized := normalizeMimoModelID(modelID)
	return strings.HasPrefix(normalized, "mimo-")
}

func normalizeMimoModelID(modelID string) string {
	normalized := strings.ToLower(strings.TrimSpace(modelID))
	normalized = strings.TrimPrefix(normalized, "cloud/")
	normalized = strings.TrimPrefix(normalized, "mimo/")
	return normalized
}

func mimoTTSModelKind(modelID string) string {
	switch normalizeMimoModelID(modelID) {
	case "mimo-v2.5-tts-voiceclone":
		return "voice_clone"
	case "mimo-v2.5-tts-voicedesign":
		return "voice_design"
	default:
		return "preset"
	}
}

func encodeMimoProviderVoiceRef(workflow string, payload string) string {
	normalizedWorkflow := strings.ToLower(strings.TrimSpace(workflow))
	normalizedPayload := strings.TrimSpace(payload)
	if normalizedWorkflow == "" || normalizedPayload == "" {
		return ""
	}
	switch normalizedWorkflow {
	case "voice_design":
		return mimoVoiceRefPrefix + normalizedWorkflow + ":" + base64.RawURLEncoding.EncodeToString([]byte(normalizedPayload))
	default:
		return mimoVoiceRefPrefix + normalizedWorkflow + ":" + normalizedPayload
	}
}

func decodeMimoProviderVoiceRef(raw string) (workflow string, payload string, ok bool) {
	value := strings.TrimSpace(raw)
	if !strings.HasPrefix(strings.ToLower(value), mimoVoiceRefPrefix) {
		return "", "", false
	}
	rest := value[len(mimoVoiceRefPrefix):]
	workflowPart, payloadPart, found := strings.Cut(rest, ":")
	if !found {
		return "", "", false
	}
	workflow = strings.ToLower(strings.TrimSpace(workflowPart))
	payload = strings.TrimSpace(payloadPart)
	if workflow == "" || payload == "" {
		return "", "", false
	}
	if workflow == "voice_design" {
		decoded, err := base64.RawURLEncoding.DecodeString(payload)
		if err != nil || len(decoded) == 0 {
			return "", "", false
		}
		payload = strings.TrimSpace(string(decoded))
		if payload == "" {
			return "", "", false
		}
	}
	return workflow, payload, true
}

func (b *Backend) transcribeMimoChat(
	ctx context.Context,
	modelID string,
	spec *runtimev1.SpeechTranscribeScenarioSpec,
	audio []byte,
	mimeType string,
) (string, *runtimev1.UsageStats, error) {
	if len(audio) == 0 {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := validateCoreTranscriptionOnly("mimo", spec); err != nil {
		return "", nil, err
	}
	dataURI := encodeInlineAudioDataURI(audio, mimeType)
	if dataURI == "" {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if err := validateMimoASRMIME(resolveInlineAudioMIME(mimeType, audio)); err != nil {
		return "", nil, err
	}
	language, err := normalizeMimoASRLanguage(spec.GetLanguage())
	if err != nil {
		return "", nil, err
	}

	reqBody := map[string]any{
		"model": strings.TrimSpace(modelID),
		"messages": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{
						"type": "input_audio",
						"input_audio": map[string]any{
							"data": dataURI,
						},
					},
				},
			},
		},
		"asr_options": map[string]any{
			"language": language,
		},
	}

	respBody := map[string]any{}
	if err := b.postJSON(ctx, resolveOpenAICompatiblePath(b.baseURL, "/chat/completions"), reqBody, &respBody); err != nil {
		return "", nil, err
	}
	text := strings.TrimSpace(extractChatCompletionMessageText(respBody))
	if text == "" {
		return "", nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := usageFromChatCompletionTranscription(respBody, audio, text)
	if usage == nil {
		usage = &runtimev1.UsageStats{
			InputTokens:  MaxInt64(1, int64(len(audio)/256)),
			OutputTokens: EstimateTokens(text),
			ComputeMs:    MaxInt64(10, int64(len(audio)/64)),
		}
	}
	return text, usage, nil
}

func normalizeMimoASRLanguage(language string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(language))
	if normalized == "" {
		return "auto", nil
	}
	switch normalized {
	case "auto", "zh", "en":
		return normalized, nil
	default:
		return "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "adjust_mimo_asr_language",
			Message:    fmt.Sprintf("mimo transcription supports language auto, zh, or en; got %q", language),
			Metadata: map[string]string{
				"provider":            "mimo",
				"unsupported_options": "language",
			},
		})
	}
}

func validateMimoASRMIME(mimeType string) error {
	normalized := strings.ToLower(strings.TrimSpace(mimeType))
	switch normalized {
	case "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3":
		return nil
	default:
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "use_mimo_supported_audio_mime",
			Message:    fmt.Sprintf("mimo transcription supports wav or mp3 audio; got %q", mimeType),
			Metadata: map[string]string{
				"provider":            "mimo",
				"unsupported_options": "mime_type",
			},
		})
	}
}

func (b *Backend) synthesizeMimoChat(
	ctx context.Context,
	modelID string,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	scenarioExtensions map[string]any,
) ([]byte, *runtimev1.UsageStats, error) {
	if spec == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	text := strings.TrimSpace(spec.GetText())
	if text == "" {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	audioFormat, err := normalizeMimoTTSFormat(spec.GetAudioFormat())
	if err != nil {
		return nil, nil, err
	}
	modelKind := mimoTTSModelKind(modelID)
	instruction := buildMimoTTSInstruction(spec, scenarioExtensions)

	audio := map[string]any{
		"format": audioFormat,
	}
	switch modelKind {
	case "voice_clone":
		voice, err := resolveMimoVoiceCloneAudioRef(spec)
		if err != nil {
			return nil, nil, err
		}
		audio["voice"] = voice
	case "voice_design":
		designPrompt, err := resolveMimoVoiceDesignPrompt(spec, scenarioExtensions)
		if err != nil {
			return nil, nil, err
		}
		instruction = designPrompt
		if ValueAsBool(FirstNonNil(scenarioExtensions["optimize_text_preview"], scenarioExtensions["optimizeTextPreview"])) {
			audio["optimize_text_preview"] = true
		}
	default:
		voice := strings.TrimSpace(scenarioVoiceRef(spec))
		if voice == "" {
			voice = "mimo_default"
		}
		audio["voice"] = voice
	}

	reqBody := map[string]any{
		"model": strings.TrimSpace(modelID),
		"messages": []map[string]any{
			{
				"role":    "user",
				"content": instruction,
			},
			{
				"role":    "assistant",
				"content": text,
			},
		},
		"audio": audio,
	}

	respBody := map[string]any{}
	if err := b.postJSON(ctx, resolveOpenAICompatiblePath(b.baseURL, "/chat/completions"), reqBody, &respBody); err != nil {
		return nil, nil, err
	}
	audioData := strings.TrimSpace(extractMimoChatAudioData(respBody))
	payload, ok := DecodeBase64ArtifactPayload(audioData)
	if !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	usage := usageFromMimoSpeechResponse(respBody, text, payload)
	if usage == nil {
		usage = ArtifactUsage(text, payload, 120)
	}
	return payload, usage, nil
}

func resolveMimoVoiceCloneAudioRef(spec *runtimev1.SpeechSynthesizeScenarioSpec) (string, error) {
	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	if voiceRef == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if workflow, payload, ok := decodeMimoProviderVoiceRef(voiceRef); ok {
		if workflow != "voice_clone" {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
		}
		voiceRef = payload
	} else if strings.HasPrefix(strings.ToLower(voiceRef), mimoVoiceRefPrefix) {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	mimeType, ok := mimoAudioDataURIMIME(voiceRef)
	if !ok {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if err := validateMimoVoiceReferenceMIME(mimeType); err != nil {
		return "", err
	}
	if decoded, valid := DecodeBase64ArtifactPayload(voiceRef); !valid || len(decoded) == 0 {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	return voiceRef, nil
}

func resolveMimoVoiceDesignPrompt(spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) (string, error) {
	voiceRef := strings.TrimSpace(scenarioVoiceRef(spec))
	if voiceRef != "" {
		if workflow, payload, ok := decodeMimoProviderVoiceRef(voiceRef); ok {
			if workflow != "voice_design" {
				return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
			}
			return payload, nil
		}
		if strings.HasPrefix(strings.ToLower(voiceRef), mimoVoiceRefPrefix) {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if spec.GetVoiceRef().GetKind() == runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF {
			return voiceRef, nil
		}
	}
	if len(scenarioExtensions) > 0 {
		for _, key := range []string{"instruction", "instructions", "voice_prompt", "voicePrompt", "description"} {
			if value := strings.TrimSpace(ValueAsString(scenarioExtensions[key])); value != "" {
				return value, nil
			}
		}
	}
	return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
}

func mimoAudioDataURIMIME(dataURI string) (string, bool) {
	value := strings.TrimSpace(dataURI)
	lower := strings.ToLower(value)
	if !strings.HasPrefix(lower, "data:") {
		return "", false
	}
	header, _, found := strings.Cut(value, ",")
	if !found {
		return "", false
	}
	headerLower := strings.ToLower(strings.TrimSpace(header))
	if !strings.Contains(headerLower, ";base64") {
		return "", false
	}
	mimeType := strings.TrimSpace(header[len("data:"):])
	if semi := strings.Index(mimeType, ";"); semi >= 0 {
		mimeType = strings.TrimSpace(mimeType[:semi])
	}
	return strings.ToLower(mimeType), mimeType != ""
}

func normalizeMimoTTSFormat(format string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(format))
	if normalized == "" {
		return "wav", nil
	}
	switch normalized {
	case "wav", "audio/wav":
		return "wav", nil
	default:
		return "", grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
			ActionHint: "use_mimo_supported_tts_format",
			Message:    fmt.Sprintf("mimo tts supports wav output; got %q", format),
			Metadata: map[string]string{
				"provider":            "mimo",
				"unsupported_options": "audio_format",
			},
		})
	}
}

func buildMimoTTSInstruction(spec *runtimev1.SpeechSynthesizeScenarioSpec, scenarioExtensions map[string]any) string {
	if len(scenarioExtensions) > 0 {
		for _, key := range []string{"instruction", "instructions", "style", "voice_prompt"} {
			if value := strings.TrimSpace(ValueAsString(scenarioExtensions[key])); value != "" {
				return value
			}
		}
	}
	parts := []string{"Speak naturally and clearly."}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		parts = append(parts, "Language: "+language+".")
	}
	if emotion := strings.TrimSpace(spec.GetEmotion()); emotion != "" {
		parts = append(parts, "Emotion: "+emotion+".")
	}
	return strings.Join(parts, " ")
}

func extractMimoChatAudioData(payload map[string]any) string {
	choices, ok := payload["choices"].([]any)
	if !ok || len(choices) == 0 {
		return ""
	}
	firstChoice, ok := choices[0].(map[string]any)
	if !ok {
		return ""
	}
	message, ok := firstChoice["message"].(map[string]any)
	if !ok {
		return ""
	}
	audio := MapField(message, "audio")
	if audioMap, ok := audio.(map[string]any); ok {
		if data := strings.TrimSpace(ValueAsString(audioMap["data"])); data != "" {
			return data
		}
	}
	return strings.TrimSpace(ValueAsString(audio))
}

func usageFromMimoSpeechResponse(payload map[string]any, text string, audio []byte) *runtimev1.UsageStats {
	usagePayload, ok := payload["usage"].(map[string]any)
	if !ok {
		return nil
	}
	inputTokens := ValueAsInt64(usagePayload["prompt_tokens"])
	outputTokens := ValueAsInt64(usagePayload["completion_tokens"])
	if outputTokens == 0 {
		totalTokens := ValueAsInt64(usagePayload["total_tokens"])
		if totalTokens > inputTokens {
			outputTokens = totalTokens - inputTokens
		}
	}
	if inputTokens == 0 && outputTokens == 0 {
		return nil
	}
	return &runtimev1.UsageStats{
		InputTokens:  inputTokens,
		OutputTokens: MaxInt64(outputTokens, estimateArtifactOutputTokens(audio)),
		ComputeMs:    MaxInt64(120, int64(len(text))*2),
	}
}
