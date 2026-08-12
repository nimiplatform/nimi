package aicapabilities

import (
	"errors"
	"strings"
)

const (
	TextGenerate      = "text.generate"
	FeatureInputImage = "input.image"
	FeatureInputMask  = "input.mask"
	FeatureInputAudio = "input.audio"
	FeatureInputText  = "input.text"
	FeatureInputVideo = "input.video"
	TextEmbed         = "text.embed"
	ImageGenerate     = "image.generate"
	VideoGenerate     = "video.generate"
	WorldGenerate     = "world.generate"
	AudioSynthesize   = "audio.synthesize"
	AudioTranscribe   = "audio.transcribe"
	VoiceCreate       = "voice.create"
	MusicGenerate     = "music.generate"
)

var ErrUnknownCatalogCapability = errors.New("unknown catalog capability")

// canonicalCatalog is the Runtime registry projection of the closed Platform
// canonical capability catalog. Consumers obtain a fresh snapshot rather than
// maintaining feature-local capability lists.
var canonicalCatalog = []string{
	TextGenerate,
	TextEmbed,
	AudioSynthesize,
	AudioTranscribe,
	VoiceCreate,
	ImageGenerate,
	VideoGenerate,
	WorldGenerate,
	MusicGenerate,
}

var standardizedFeaturesByCapability = map[string]map[string]struct{}{
	TextGenerate: {
		FeatureInputImage: {},
		FeatureInputAudio: {},
		FeatureInputVideo: {},
	},
	ImageGenerate: {
		FeatureInputImage: {},
		FeatureInputMask:  {},
	},
	VideoGenerate: {
		FeatureInputImage: {},
	},
	MusicGenerate: {
		FeatureInputAudio: {},
	},
	VoiceCreate: {
		FeatureInputText:  {},
		FeatureInputAudio: {},
	},
}

func CanonicalCatalog() []string {
	return append([]string(nil), canonicalCatalog...)
}

// IsCanonicalCatalogCapability accepts only an exact current token. It is the
// storage/admission boundary used by AIConfig, LCC, and selection owners; it
// never normalizes legacy or case-variant identities.
func IsCanonicalCatalogCapability(value string) bool {
	canonical, err := NormalizeCatalogCapability(value)
	return err == nil && value == canonical
}

// SupportsStandardizedFeature reports whether an exact feature belongs to the
// exact current CapabilityContract. Provider- or Driver-private options do not
// enter this public feature vocabulary.
func SupportsStandardizedFeature(capability string, feature string) bool {
	if !IsCanonicalCatalogCapability(capability) || strings.TrimSpace(feature) != feature {
		return false
	}
	_, ok := standardizedFeaturesByCapability[capability][feature]
	return ok
}

// NormalizeCatalogCapability returns the canonical catalog capability token.
// Unknown values are rejected rather than auto-mapped to preserve hard-cut semantics.
func NormalizeCatalogCapability(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case TextGenerate:
		return TextGenerate, nil
	case TextEmbed:
		return TextEmbed, nil
	case ImageGenerate:
		return ImageGenerate, nil
	case VideoGenerate:
		return VideoGenerate, nil
	case WorldGenerate:
		return WorldGenerate, nil
	case AudioSynthesize:
		return AudioSynthesize, nil
	case AudioTranscribe:
		return AudioTranscribe, nil
	case VoiceCreate:
		return VoiceCreate, nil
	case MusicGenerate:
		return MusicGenerate, nil
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
