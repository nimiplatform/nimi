package nimillm

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type dashScopeTTSRequestContract int

const (
	dashScopeTTSRequestContractQwenMultimodal dashScopeTTSRequestContract = iota
	dashScopeTTSRequestContractCosyVoiceSpeechSynthesizer
)

func (contract dashScopeTTSRequestContract) String() string {
	switch contract {
	case dashScopeTTSRequestContractCosyVoiceSpeechSynthesizer:
		return "cosyvoice_speech_synthesizer"
	default:
		return "qwen_multimodal_generation"
	}
}

func resolveDashScopeTTSRequestContract(modelResolved string) dashScopeTTSRequestContract {
	normalized := strings.ToLower(strings.TrimSpace(modelResolved))
	if strings.HasPrefix(normalized, "cosyvoice-") {
		return dashScopeTTSRequestContractCosyVoiceSpeechSynthesizer
	}
	return dashScopeTTSRequestContractQwenMultimodal
}

func resolveAlibabaTTSPath(contract dashScopeTTSRequestContract) string {
	defaults := []string{"/api/v1/services/aigc/multimodal-generation/generation"}
	if contract == dashScopeTTSRequestContractCosyVoiceSpeechSynthesizer {
		defaults = []string{"/api/v1/services/audio/tts/SpeechSynthesizer"}
	}
	return firstProviderEndpointPath(defaults)
}

func buildAlibabaTTSPayload(
	modelResolved string,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	requestedVoice string,
	scenarioExtensions map[string]any,
	contract dashScopeTTSRequestContract,
) map[string]any {
	switch contract {
	case dashScopeTTSRequestContractCosyVoiceSpeechSynthesizer:
		return buildAlibabaCosyVoiceTTSPayload(modelResolved, spec, requestedVoice, scenarioExtensions)
	default:
		return buildAlibabaQwenTTSPayload(modelResolved, spec, requestedVoice, scenarioExtensions)
	}
}

func buildAlibabaQwenTTSPayload(
	modelResolved string,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	requestedVoice string,
	scenarioExtensions map[string]any,
) map[string]any {
	sampleRateHz := spec.GetSampleRateHz()
	parameters := map[string]any{
		"voice":    requestedVoice,
		"language": strings.TrimSpace(spec.GetLanguage()),
		"emotion":  strings.TrimSpace(spec.GetEmotion()),
		"speed":    scenarioSpeechSpeed(spec),
		"pitch":    spec.GetPitch(),
		"volume":   spec.GetVolume(),
		"format":   strings.TrimSpace(spec.GetAudioFormat()),
	}
	if sampleRateHz > 0 {
		parameters["sample_rate"] = sampleRateHz
	}
	applyAlibabaTTSScenarioExtensions(parameters, scenarioExtensions)
	payload := map[string]any{
		"model": modelResolved,
		"input": map[string]any{
			"text":  strings.TrimSpace(spec.GetText()),
			"voice": requestedVoice,
		},
		"parameters":   parameters,
		"text":         strings.TrimSpace(spec.GetText()),
		"audio_format": strings.TrimSpace(spec.GetAudioFormat()),
	}
	if sampleRateHz > 0 {
		payload["sample_rate_hz"] = sampleRateHz
	}
	if len(scenarioExtensions) > 0 {
		payload["extensions"] = scenarioExtensions
	}
	return payload
}

func buildAlibabaCosyVoiceTTSPayload(
	modelResolved string,
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	requestedVoice string,
	scenarioExtensions map[string]any,
) map[string]any {
	input := map[string]any{
		"text":  strings.TrimSpace(spec.GetText()),
		"voice": requestedVoice,
	}
	if audioFormat := strings.TrimSpace(spec.GetAudioFormat()); audioFormat != "" {
		input["format"] = audioFormat
	}
	if sampleRateHz := spec.GetSampleRateHz(); sampleRateHz > 0 {
		input["sample_rate"] = sampleRateHz
	}
	if volume := spec.GetVolume(); volume > 0 {
		input["volume"] = volume
	}
	if speed := scenarioSpeechSpeed(spec); speed > 0 {
		input["rate"] = speed
	}
	if pitch := spec.GetPitch(); pitch > 0 {
		input["pitch"] = pitch
	}
	if instruction := dashScopeCosyVoiceInstruction(scenarioExtensions); instruction != "" {
		input["instruction"] = instruction
	}
	if hints := dashScopeCosyVoiceLanguageHints(spec, scenarioExtensions); len(hints) > 0 {
		input["language_hints"] = hints
	}
	if ValueAsBool(FirstNonNil(scenarioExtensions["enable_ssml"], scenarioExtensions["enableSSML"])) {
		input["enable_ssml"] = true
	}
	if dashScopeCosyVoiceWordTimestampsRequested(spec, scenarioExtensions) {
		input["word_timestamp_enabled"] = true
	}
	if seed := ValueAsInt64(scenarioExtensions["seed"]); seed > 0 {
		input["seed"] = seed
	}
	if bitRate := ValueAsInt64(FirstNonNil(scenarioExtensions["bit_rate"], scenarioExtensions["bitRate"])); bitRate > 0 {
		input["bit_rate"] = bitRate
	}
	payload := map[string]any{
		"model": modelResolved,
		"input": input,
	}
	if len(scenarioExtensions) > 0 {
		payload["extensions"] = scenarioExtensions
	}
	return payload
}

func applyAlibabaTTSScenarioExtensions(parameters map[string]any, scenarioExtensions map[string]any) {
	if parameters == nil || len(scenarioExtensions) == 0 {
		return
	}

	instructions := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(scenarioExtensions["instructions"]),
		ValueAsString(scenarioExtensions["instruct"]),
		ValueAsString(scenarioExtensions["instruction_text"]),
	))
	if instructions != "" {
		parameters["instructions"] = instructions
	}

	if optimizeValue := FirstNonNil(
		scenarioExtensions["optimize_instructions"],
		scenarioExtensions["optimizeInstructions"],
	); optimizeValue != nil {
		parameters["optimize_instructions"] = ValueAsBool(optimizeValue)
	}
}

func dashScopeCosyVoiceInstruction(scenarioExtensions map[string]any) string {
	if len(scenarioExtensions) == 0 {
		return ""
	}
	return strings.TrimSpace(FirstNonEmpty(
		ValueAsString(scenarioExtensions["instruction"]),
		ValueAsString(scenarioExtensions["instructions"]),
		ValueAsString(scenarioExtensions["instruct"]),
		ValueAsString(scenarioExtensions["instruction_text"]),
	))
}

func dashScopeCosyVoiceLanguageHints(
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	scenarioExtensions map[string]any,
) []string {
	hints := dashScopeStringArray(FirstNonNil(
		scenarioExtensions["language_hints"],
		scenarioExtensions["languageHints"],
	))
	if len(hints) > 0 {
		return hints
	}
	language := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(scenarioExtensions["language"]),
		ValueAsString(scenarioExtensions["language_hint"]),
		spec.GetLanguage(),
	))
	if language == "" {
		return nil
	}
	return []string{language}
}

func dashScopeCosyVoiceWordTimestampsRequested(
	spec *runtimev1.SpeechSynthesizeScenarioSpec,
	scenarioExtensions map[string]any,
) bool {
	if ValueAsBool(FirstNonNil(
		scenarioExtensions["word_timestamp_enabled"],
		scenarioExtensions["wordTimestampEnabled"],
		scenarioExtensions["enable_word_timestamp"],
		scenarioExtensions["enableWordTimestamp"],
	)) {
		return true
	}
	return spec.GetTimingMode() == runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD
}

func dashScopeStringArray(value any) []string {
	switch typed := value.(type) {
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(ValueAsString(item))
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
		return out
	default:
		trimmed := strings.TrimSpace(ValueAsString(value))
		if trimmed == "" {
			return nil
		}
		return []string{trimmed}
	}
}
