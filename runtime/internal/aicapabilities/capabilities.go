package aicapabilities

import "strings"

const (
	TextGenerate       = "text.generate"
	TextGenerateVision = "text.generate.vision"
	TextGenerateAudio  = "text.generate.audio"
	TextGenerateVideo  = "text.generate.video"
	TextEmbed          = "text.embed"
	ImageGenerate       = "image.generate"
	VideoGenerate       = "video.generate"
	AudioSynthesize     = "audio.synthesize"
	AudioTranscribe     = "audio.transcribe"
	VoiceWorkflowTTSV2V = "voice_workflow.tts_v2v"
	VoiceWorkflowTTST2V = "voice_workflow.tts_t2v"
)

// NormalizeCatalogCapability returns the canonical catalog capability token.
// Unknown values are rejected rather than auto-mapped to preserve hard-cut semantics.
func NormalizeCatalogCapability(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case TextGenerate:
		return TextGenerate
	case TextGenerateVision:
		return TextGenerateVision
	case TextGenerateAudio:
		return TextGenerateAudio
	case TextGenerateVideo:
		return TextGenerateVideo
	case TextEmbed:
		return TextEmbed
	case ImageGenerate:
		return ImageGenerate
	case VideoGenerate:
		return VideoGenerate
	case AudioSynthesize:
		return AudioSynthesize
	case AudioTranscribe:
		return AudioTranscribe
	case VoiceWorkflowTTSV2V:
		return VoiceWorkflowTTSV2V
	case VoiceWorkflowTTST2V:
		return VoiceWorkflowTTST2V
	default:
		return ""
	}
}

func HasCatalogCapability(capabilities []string, expected string) bool {
	normalizedExpected := NormalizeCatalogCapability(expected)
	if normalizedExpected == "" {
		return false
	}
	for _, capability := range capabilities {
		if NormalizeCatalogCapability(capability) == normalizedExpected {
			return true
		}
	}
	return false
}
