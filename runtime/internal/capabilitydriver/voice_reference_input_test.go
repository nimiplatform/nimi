package capabilitydriver

import "testing"

func TestVoiceReferenceInputReflectsConfiguredSource(t *testing.T) {
	for _, driver := range []VoiceReferenceInputProjector{Qwen3VoiceCreateDriver{}, Qwen3VoiceLibraryDriver{}} {
		if driver.ReferenceAudioInputCapabilities([]string{"input.text"}) != nil {
			t.Fatal("design-only configuration advertised cloning")
		}
		input := driver.ReferenceAudioInputCapabilities([]string{"input.audio", "input.text"})
		if input == nil || !input.SupportsBytes || !input.SupportsUri || input.TextMode != "optional" {
			t.Fatalf("Qwen reference inputs lost: %+v", input)
		}
	}
}
