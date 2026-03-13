package aicapabilities

import "testing"

func TestNormalizeCatalogCapability(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{TextGenerate, TextGenerate},
		{TextEmbed, TextEmbed},
		{ImageGenerate, ImageGenerate},
		{VideoGenerate, VideoGenerate},
		{AudioSynthesize, AudioSynthesize},
		{AudioTranscribe, AudioTranscribe},
		{VoiceWorkflowTTSV2V, VoiceWorkflowTTSV2V},
		{VoiceWorkflowTTST2V, VoiceWorkflowTTST2V},
		{MusicGenerate, MusicGenerate},
		{MusicGenerateIteration, MusicGenerateIteration},
		{"TEXT.GENERATE", TextGenerate},
		{"  text.generate  ", TextGenerate},
		{"unknown.cap", ""},
		{"", ""},
	}
	for _, tt := range tests {
		got := NormalizeCatalogCapability(tt.input)
		if got != tt.want {
			t.Errorf("NormalizeCatalogCapability(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestHasCatalogCapability(t *testing.T) {
	caps := []string{"text.generate", "image.generate", "music.generate.iteration"}

	if !HasCatalogCapability(caps, TextGenerate) {
		t.Fatal("should find text.generate")
	}
	if !HasCatalogCapability(caps, ImageGenerate) {
		t.Fatal("should find image.generate")
	}
	if HasCatalogCapability(caps, VideoGenerate) {
		t.Fatal("should not find video.generate")
	}
	if !HasCatalogCapability(caps, MusicGenerateIteration) {
		t.Fatal("should find music.generate.iteration")
	}
}

func TestHasCatalogCapabilityCaseInsensitive(t *testing.T) {
	caps := []string{"TEXT.GENERATE"}
	if !HasCatalogCapability(caps, "text.generate") {
		t.Fatal("should match case-insensitively")
	}
}

func TestHasCatalogCapabilityUnknownExpected(t *testing.T) {
	caps := []string{"text.generate"}
	if HasCatalogCapability(caps, "unknown") {
		t.Fatal("unknown expected should return false")
	}
}

func TestHasCatalogCapabilityEmptyList(t *testing.T) {
	if HasCatalogCapability(nil, TextGenerate) {
		t.Fatal("nil list should return false")
	}
	if HasCatalogCapability([]string{}, TextGenerate) {
		t.Fatal("empty list should return false")
	}
}
