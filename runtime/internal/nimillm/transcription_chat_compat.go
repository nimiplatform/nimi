package nimillm

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterGeminiChatTranscribe = "gemini_chat_transcribe_adapter"
const AdapterDashScopeChatTranscribe = "dashscope_chat_transcribe_adapter"

func validateCoreTranscriptionOnly(provider string, spec *runtimev1.SpeechTranscribeScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	unsupported := make([]string, 0, 4)
	if spec.GetTimestamps() {
		unsupported = append(unsupported, "timestamps")
	}
	if spec.GetDiarization() {
		unsupported = append(unsupported, "diarization")
	}
	if spec.GetSpeakerCount() > 0 {
		unsupported = append(unsupported, "speakerCount")
	}

	switch normalized := strings.ToLower(strings.TrimSpace(spec.GetResponseFormat())); normalized {
	case "", "text", "txt", "plain", "text/plain":
	default:
		unsupported = append(unsupported, "responseFormat")
	}

	if len(unsupported) == 0 {
		return nil
	}

	providerName := strings.TrimSpace(provider)
	if providerName == "" {
		providerName = "provider"
	}
	message := fmt.Sprintf(
		"%s transcription supports only core transcript output; unsupported options: %s",
		providerName,
		strings.Join(unsupported, ", "),
	)
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{
		ActionHint: "adjust_stt_core_options",
		Message:    message,
		Metadata: map[string]string{
			"provider":            providerName,
			"unsupported_options": strings.Join(unsupported, ","),
		},
	})
}

func buildCoreTranscriptionInstruction(spec *runtimev1.SpeechTranscribeScenarioSpec) string {
	parts := []string{
		"Transcribe the provided audio and return only the transcript text.",
	}
	if language := strings.TrimSpace(spec.GetLanguage()); language != "" {
		parts = append(parts, "Language hint: "+language+".")
	}
	if prompt := strings.TrimSpace(spec.GetPrompt()); prompt != "" {
		parts = append(parts, "Context: "+prompt)
	}
	return strings.Join(parts, " ")
}

func resolveInlineAudioMIME(mimeType string, audio []byte) string {
	if normalized := strings.TrimSpace(mimeType); normalized != "" {
		return normalized
	}
	detected := strings.TrimSpace(http.DetectContentType(audio))
	if strings.HasPrefix(strings.ToLower(detected), "audio/") {
		return detected
	}
	return "audio/wav"
}

func resolveInlineAudioFormat(mimeType string, audio []byte) string {
	normalized := strings.ToLower(strings.TrimSpace(resolveInlineAudioMIME(mimeType, audio)))
	switch {
	case strings.Contains(normalized, "wav"):
		return "wav"
	case strings.Contains(normalized, "mpeg"), strings.Contains(normalized, "mp3"):
		return "mp3"
	case strings.Contains(normalized, "flac"):
		return "flac"
	case strings.Contains(normalized, "ogg"), strings.Contains(normalized, "opus"):
		return "ogg"
	case strings.Contains(normalized, "webm"):
		return "webm"
	case strings.Contains(normalized, "aac"):
		return "aac"
	case strings.Contains(normalized, "mp4"), strings.Contains(normalized, "m4a"):
		return "mp4"
	default:
		subtype := strings.TrimSpace(strings.TrimPrefix(normalized, "audio/"))
		if subtype != "" {
			return subtype
		}
		return "wav"
	}
}

func encodeInlineAudioDataURI(audio []byte, mimeType string) string {
	normalizedMIME := resolveInlineAudioMIME(mimeType, audio)
	return "data:" + normalizedMIME + ";base64," + base64.StdEncoding.EncodeToString(audio)
}

func extractChatCompletionMessageText(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if text := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["text"]),
		ValueAsString(payload["output_text"]),
		ValueAsString(MapField(payload["result"], "text")),
		ValueAsString(MapField(payload["output"], "text")),
	)); text != "" {
		return text
	}

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
	if text := strings.TrimSpace(ValueAsString(message["content"])); text != "" {
		return text
	}

	contentItems, ok := message["content"].([]any)
	if !ok {
		return ""
	}
	parts := make([]string, 0, len(contentItems))
	for _, item := range contentItems {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(record["text"]),
			ValueAsString(MapField(record["text"], "value")),
			ValueAsString(MapField(record["output_text"], "text")),
		))
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func usageFromChatCompletionTranscription(payload map[string]any, audio []byte, text string) *runtimev1.UsageStats {
	fallback := &runtimev1.UsageStats{
		InputTokens:  MaxInt64(1, int64(len(audio)/256)),
		OutputTokens: EstimateTokens(text),
		ComputeMs:    MaxInt64(10, int64(len(audio)/64)),
	}
	if payload == nil {
		return fallback
	}

	usagePayload, ok := payload["usage"].(map[string]any)
	if !ok {
		return fallback
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
		return fallback
	}
	return &runtimev1.UsageStats{
		InputTokens:  MaxInt64(fallback.GetInputTokens(), inputTokens),
		OutputTokens: MaxInt64(fallback.GetOutputTokens(), outputTokens),
		ComputeMs:    fallback.GetComputeMs(),
	}
}
