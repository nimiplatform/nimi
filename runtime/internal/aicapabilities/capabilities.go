package aicapabilities

import (
	"errors"
	"strings"
)

const (
	TextGenerate             = "text.generate"
	TextGenerateVision       = "text.generate.vision"
	TextGenerateAudio        = "text.generate.audio"
	TextGenerateVideo        = "text.generate.video"
	TextEmbed                = "text.embed"
	ImageGenerate            = "image.generate"
	ImageEdit                = "image.edit"
	VideoGenerate            = "video.generate"
	WorldGenerate            = "world.generate"
	AudioSynthesize          = "audio.synthesize"
	AudioTranscribe          = "audio.transcribe"
	VoiceWorkflowVoiceClone  = "voice_workflow.voice_clone"
	VoiceWorkflowVoiceDesign = "voice_workflow.voice_design"
	MusicGenerate            = "music.generate"
	MusicGenerateIteration   = "music.generate.iteration"
)

var ErrUnknownCatalogCapability = errors.New("unknown catalog capability")

// canonicalCatalog is the Runtime registry projection of the closed Platform
// canonical capability catalog. Consumers obtain a fresh snapshot rather than
// maintaining feature-local capability lists.
var canonicalCatalog = []string{
	TextGenerate,
	TextGenerateVision,
	TextEmbed,
	AudioSynthesize,
	AudioTranscribe,
	VoiceWorkflowVoiceClone,
	VoiceWorkflowVoiceDesign,
	ImageGenerate,
	ImageEdit,
	VideoGenerate,
	WorldGenerate,
}

func CanonicalCatalog() []string {
	return append([]string(nil), canonicalCatalog...)
}

// NormalizeCatalogCapability returns the canonical catalog capability token.
// Unknown values are rejected rather than auto-mapped to preserve hard-cut semantics.
func NormalizeCatalogCapability(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case TextGenerate:
		return TextGenerate, nil
	case TextGenerateVision:
		return TextGenerateVision, nil
	case TextGenerateAudio:
		return TextGenerateAudio, nil
	case TextGenerateVideo:
		return TextGenerateVideo, nil
	case TextEmbed:
		return TextEmbed, nil
	case ImageGenerate:
		return ImageGenerate, nil
	case ImageEdit:
		return ImageEdit, nil
	case VideoGenerate:
		return VideoGenerate, nil
	case WorldGenerate:
		return WorldGenerate, nil
	case AudioSynthesize:
		return AudioSynthesize, nil
	case AudioTranscribe:
		return AudioTranscribe, nil
	case VoiceWorkflowVoiceClone:
		return VoiceWorkflowVoiceClone, nil
	case VoiceWorkflowVoiceDesign:
		return VoiceWorkflowVoiceDesign, nil
	case MusicGenerate:
		return MusicGenerate, nil
	case MusicGenerateIteration:
		return MusicGenerateIteration, nil
	default:
		return "", ErrUnknownCatalogCapability
	}
}

// HasCatalogCapability reports whether capabilities contains the expected
// canonical catalog capability token, ignoring case and surrounding whitespace.
func HasCatalogCapability(capabilities []string, expected string) bool {
	normalizedExpected, err := NormalizeCatalogCapability(expected)
	if err != nil {
		return false
	}
	for _, capability := range capabilities {
		normalizedCapability, err := NormalizeCatalogCapability(capability)
		if err != nil {
			continue
		}
		if normalizedCapability == normalizedExpected {
			return true
		}
	}
	return false
}
