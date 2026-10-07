package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-voice-preview
func projectDashScopeVoicePreview(response map[string]any, result *VoiceWorkflowResult) error {
	output, _ := response["output"].(map[string]any)
	raw, present := output["preview_audio"]
	if !present {
		return nil
	}
	var audio []byte
	invalid := func(stage string) error {
		// Diagnose only structure and format, never the audio, prompt or handle.
		preview, _ := raw.(map[string]any)
		format := "missing"
		if value, present := preview["response_format"]; present {
			format = "unrecognized"
			if value == "wav" || value == "mp3" || value == "pcm" || value == "pcm16" {
				format = value.(string)
			}
		}
		if len(audio) == 0 {
			if encoded, ok := preview["data"].(string); ok && len(encoded) <= maxGeminiTTSAudioBase64Bytes {
				audio, _ = base64.StdEncoding.Strict().DecodeString(encoded)
			}
		}
		attributes := []any{"stage", stage, "known_handle", result.ProviderVoiceRef != "", "format", format, "rate_type", fmt.Sprintf("%T", preview["sample_rate"]), "bytes", len(audio)}
		if len(audio) >= 36 && string(audio[:4]) == "RIFF" && string(audio[8:12]) == "WAVE" && string(audio[12:16]) == "fmt " {
			attributes = append(attributes, "declared_bytes", uint64(binary.LittleEndian.Uint32(audio[4:8]))+8, "wav_format", binary.LittleEndian.Uint16(audio[20:22]), "channels", binary.LittleEndian.Uint16(audio[22:24]), "sample_rate", binary.LittleEndian.Uint32(audio[24:28]), "bits", binary.LittleEndian.Uint16(audio[34:36]))
		}
		slog.Error("DashScope voice preview rejected", attributes...)
		return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, grpcerr.ReasonOptions{Message: "DashScope voice preview rejected: " + stage, ActionHint: "inspect_dashscope_voice_preview_" + stage})
	}
	preview, ok := raw.(map[string]any)
	if !ok || ValueAsString(preview["response_format"]) != "wav" {
		return invalid("format")
	}
	encoded, ok := preview["data"].(string)
	if !ok || encoded == "" || len(encoded) > maxGeminiTTSAudioBase64Bytes {
		return invalid("data")
	}
	rate, ok := preview["sample_rate"].(float64)
	if !ok || rate < 1 || rate > 96000 || rate != float64(uint32(rate)) {
		return invalid("sample_rate")
	}
	var err error
	audio, err = base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return invalid("base64")
	}
	audio, err = finishCompletedDashScopeWAV(audio)
	if err != nil {
		return invalid("wav_completion")
	}
	wavRate, duration, err := finiteASRWAVInfo(audio)
	if err != nil || duration <= 0 || float64(wavRate) != rate {
		return invalid("wav")
	}
	result.PreviewAudio, result.PreviewMime = audio, "audio/wav"
	return nil
}

func executeDashScopeVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL("dashscope", cfg)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	var defaults []string
	switch workflow {
	case "reference_audio":
		defaults = []string{"/api/v1/services/audio/tts/customization"}
	case "text_description":
		defaults = []string{"/api/v1/services/audio/tts/customization"}
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	path := resolveVoiceEndpointPath(req.WorkflowType, defaults)
	headers := voiceWorkflowHeaders("dashscope", cfg)
	payload, err := buildDashScopeVoiceWorkflowPayload(req)
	if err != nil {
		return VoiceWorkflowResult{}, err
	}

	return voiceWorkflowPost(ctx, baseURL, cfg.APIKey, path, payload, headers, "dashscope", req.WorkflowType, req.WorkflowModelID)
}

func buildDashScopeVoiceWorkflowPayload(req VoiceWorkflowRequest) (map[string]any, error) {
	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	workflowModelID := strings.TrimSpace(req.WorkflowModelID)
	apiWorkflowModelID := dashScopeVoiceWorkflowAPIModelID(workflowModelID)
	targetModelID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["target_model"]),
		ValueAsString(req.Payload["target_model_id"]),
		ValueAsString(req.Payload["model"]),
		ValueAsString(req.Payload["model_id"]),
		ValueAsString(MapField(req.Payload["input"], "target_model")),
		ValueAsString(MapField(req.Payload["input"], "target_model_id")),
		req.ModelID,
	))
	name := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["preferred_name"]),
		ValueAsString(MapField(req.Payload["input"], "preferred_name")),
		ValueAsString(req.Payload["prefix"]),
		ValueAsString(MapField(req.Payload["input"], "prefix")),
	))
	safeName := normalizeDashScopePreferredName(name)
	isCosyVoiceWorkflow := isDashScopeCosyVoiceWorkflow(workflowModelID, targetModelID)
	switch workflow {
	case "reference_audio":
		audioData := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["url"]),
			ValueAsString(req.Payload["audio_url"]),
			ValueAsString(req.Payload["reference_audio_uri"]),
			ValueAsString(MapField(req.Payload["input"], "url")),
			ValueAsString(MapField(req.Payload["input"], "audio_url")),
			ValueAsString(MapField(req.Payload["input"], "reference_audio_uri")),
			buildDashScopeVoiceReferenceAudioData(
				FirstNonEmpty(
					ValueAsString(req.Payload["reference_audio_mime"]),
					ValueAsString(MapField(req.Payload["input"], "reference_audio_mime")),
				),
				FirstNonEmpty(
					ValueAsString(req.Payload["reference_audio_base64"]),
					ValueAsString(MapField(req.Payload["input"], "reference_audio_base64")),
				),
			),
		))
		if isCosyVoiceWorkflow {
			if !isDashScopePublicHTTPURL(audioData) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
			}
			input := map[string]any{
				"action":       "create_voice",
				"target_model": targetModelID,
				"url":          audioData,
			}
			input["prefix"] = normalizeDashScopeCosyVoicePrefix(name)
			if hints := dashScopeVoiceWorkflowLanguageHints(req.Payload); len(hints) > 0 {
				input["language_hints"] = hints
			}
			payload := map[string]any{
				"model": apiWorkflowModelID,
				"input": input,
			}
			if parameters := dashScopeVoiceWorkflowParameters(req.Payload); len(parameters) > 0 {
				payload["parameters"] = parameters
			}
			return payload, nil
		}
		input := map[string]any{
			"action":       "create",
			"target_model": targetModelID,
			"audio": map[string]any{
				"data": audioData,
			},
		}
		if safeName != "" {
			input["preferred_name"] = safeName
			input["prefix"] = safeName
		}
		return map[string]any{
			"model": apiWorkflowModelID,
			"input": input,
		}, nil
	case "text_description":
		voicePrompt := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["instruction_text"]),
			ValueAsString(req.Payload["description"]),
			ValueAsString(MapField(req.Payload["input"], "instruction_text")),
			ValueAsString(MapField(req.Payload["input"], "description")),
		))
		previewText := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["preview_text"]),
			ValueAsString(req.Payload["text"]),
			ValueAsString(MapField(req.Payload["input"], "preview_text")),
			ValueAsString(MapField(req.Payload["input"], "text")),
		))
		if voicePrompt == "" || previewText == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		language := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["language"]),
			ValueAsString(MapField(req.Payload["input"], "language")),
		))
		action := "create"
		if isCosyVoiceWorkflow {
			action = "create_voice"
		}
		input := map[string]any{
			"action":       action,
			"target_model": targetModelID,
			"voice_prompt": voicePrompt,
		}
		if previewText != "" {
			input["preview_text"] = previewText
		}
		if language != "" && !isCosyVoiceWorkflow {
			input["language"] = language
		}
		if isCosyVoiceWorkflow {
			input["prefix"] = normalizeDashScopeCosyVoicePrefix(name)
			if hints := dashScopeVoiceWorkflowLanguageHints(req.Payload); len(hints) > 0 {
				input["language_hints"] = hints
			} else if language != "" {
				input["language_hints"] = []string{language}
			}
		} else if safeName != "" {
			input["preferred_name"] = safeName
		}
		payload := map[string]any{
			"model": apiWorkflowModelID,
			"input": input,
		}
		if isCosyVoiceWorkflow {
			if parameters := dashScopeVoiceWorkflowParameters(req.Payload); len(parameters) > 0 {
				payload["parameters"] = parameters
			}
		} else {
			// The existing preview carrier owns a finite WAV, never unframed
			// provider PCM or an implicit conversion after creation.
			payload["parameters"] = map[string]any{"sample_rate": 24000, "response_format": "wav"}
		}
		return payload, nil
	default:
		return req.Payload, nil
	}
}

func dashScopeVoiceWorkflowAPIModelID(workflowModelID string) string {
	normalized := strings.ToLower(strings.TrimSpace(workflowModelID))
	if strings.HasPrefix(normalized, "voice-enrollment") {
		return "voice-enrollment"
	}
	return strings.TrimSpace(workflowModelID)
}

func isDashScopeCosyVoiceWorkflow(workflowModelID string, targetModelID string) bool {
	workflow := strings.ToLower(strings.TrimSpace(workflowModelID))
	target := strings.ToLower(strings.TrimSpace(targetModelID))
	return strings.HasPrefix(workflow, "voice-enrollment") || strings.HasPrefix(target, "cosyvoice-")
}

func isDashScopePublicHTTPURL(value string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(trimmed, "http://")
}

func dashScopeVoiceWorkflowLanguageHints(payload map[string]any) []string {
	hints := dashScopeStringArray(FirstNonNil(
		payload["language_hints"],
		payload["languageHints"],
		MapField(payload["input"], "language_hints"),
		MapField(payload["input"], "languageHints"),
	))
	if len(hints) > 0 {
		return hints
	}
	language := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["language"]),
		ValueAsString(MapField(payload["input"], "language")),
	))
	if language == "" {
		return nil
	}
	return []string{language}
}

func dashScopeVoiceWorkflowParameters(payload map[string]any) map[string]any {
	out := map[string]any{}
	if sampleRate := ValueAsInt64(FirstNonNil(
		payload["sample_rate"],
		payload["sample_rate_hz"],
		MapField(payload["input"], "sample_rate"),
		MapField(payload["input"], "sample_rate_hz"),
	)); sampleRate > 0 {
		out["sample_rate"] = sampleRate
	}
	if responseFormat := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["response_format"]),
		ValueAsString(payload["audio_format"]),
		ValueAsString(MapField(payload["input"], "response_format")),
		ValueAsString(MapField(payload["input"], "audio_format")),
	)); responseFormat != "" {
		out["response_format"] = responseFormat
	}
	return out
}

func buildDashScopeVoiceReferenceAudioData(mimeType string, base64Data string) string {
	encoded := strings.TrimSpace(base64Data)
	if encoded == "" {
		return ""
	}
	mime := strings.TrimSpace(mimeType)
	if mime == "" {
		mime = "audio/wav"
	}
	return "data:" + mime + ";base64," + encoded
}

func normalizeDashScopePreferredName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "nimi_voice"
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastUnderscore = false
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r + ('a' - 'A'))
			lastUnderscore = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastUnderscore = false
		default:
			if lastUnderscore {
				continue
			}
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	normalized := strings.Trim(builder.String(), "_")
	if normalized == "" {
		return "nimi_voice"
	}
	first := normalized[0]
	if first >= '0' && first <= '9' {
		normalized = "voice_" + normalized
	}
	if len(normalized) > 16 {
		normalized = strings.Trim(normalized[:16], "_")
	}
	if normalized == "" {
		return "nimi_voice"
	}
	return normalized
}

func normalizeDashScopeCosyVoicePrefix(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "nimivoice"
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "nimi-voice-") {
		var suffix strings.Builder
		for _, r := range trimmed[len("nimi-voice-"):] {
			switch {
			case r >= 'a' && r <= 'z':
				suffix.WriteRune(r)
			case r >= 'A' && r <= 'Z':
				suffix.WriteRune(r + ('a' - 'A'))
			case r >= '0' && r <= '9':
				suffix.WriteRune(r)
			}
			if suffix.Len() >= 7 {
				break
			}
		}
		if suffix.Len() > 0 {
			return "nv" + suffix.String()
		}
	}
	var builder strings.Builder
	for _, r := range trimmed {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r + ('a' - 'A'))
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		}
		if builder.Len() >= 9 {
			break
		}
	}
	normalized := builder.String()
	if normalized == "" {
		return "nimivoice"
	}
	return normalized
}
