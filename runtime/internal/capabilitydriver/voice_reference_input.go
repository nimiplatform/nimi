package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-reference-input-projection
// This optional projection describes accepted public inputs, including Runtime
// URI capture before the private invocation. It is not an admission decision.
type VoiceReferenceInputProjector interface {
	ReferenceAudioInputCapabilities(configuredFeatures []string) *runtimev1.VoiceReferenceInputCapabilities
}

func (Qwen3VoiceCreateDriver) ReferenceAudioInputCapabilities(features []string) *runtimev1.VoiceReferenceInputCapabilities {
	if !contains(features, "input.audio") {
		return nil
	}
	return &runtimev1.VoiceReferenceInputCapabilities{SupportsBytes: true, SupportsUri: true, TextMode: "optional"}
}

func (Qwen3VoiceLibraryDriver) ReferenceAudioInputCapabilities(features []string) *runtimev1.VoiceReferenceInputCapabilities {
	return (Qwen3VoiceCreateDriver{}).ReferenceAudioInputCapabilities(features)
}
