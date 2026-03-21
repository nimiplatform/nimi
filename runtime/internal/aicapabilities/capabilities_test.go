package aicapabilities

import "testing"

func TestNormalizeCatalogCapability(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{TextGenerate, TextGenerate, true},
		{TextGenerateVision, TextGenerateVision, true},
		{TextGenerateAudio, TextGenerateAudio, true},
		{TextGenerateVideo, TextGenerateVideo, true},
		{TextEmbed, TextEmbed, true},
		{ImageGenerate, ImageGenerate, true},
		{VideoGenerate, VideoGenerate, true},
		{AudioSynthesize, AudioSynthesize, true},
		{AudioTranscribe, AudioTranscribe, true},
		{VoiceWorkflowTTSV2V, VoiceWorkflowTTSV2V, true},
		{VoiceWorkflowTTST2V, VoiceWorkflowTTST2V, true},
		{MusicGenerate, MusicGenerate, true},
		{MusicGenerateIteration, MusicGenerateIteration, true},
		{"TEXT.GENERATE", TextGenerate, true},
		{"  text.generate  ", TextGenerate, true},
		{"unknown.cap", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got, err := NormalizeCatalogCapability(tt.input)
		if got != tt.want {
			t.Errorf("NormalizeCatalogCapability(%q) = %q, want %q", tt.input, got, tt.want)
		}
		if (err == nil) != tt.ok {
			t.Errorf("NormalizeCatalogCapability(%q) err = %v, ok=%v", tt.input, err, tt.ok)
		}
	}
}

func TestHasCatalogCapability(t *testing.T) {
	caps := []string{"text.generate", "IMAGE.GENERATE", "music.generate.iteration"}

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
	caps := []string{"TEXT.GENERATE", "Text.Generate.Video"}
	if !HasCatalogCapability(caps, "text.generate") {
		t.Fatal("should match case-insensitively")
	}
	if !HasCatalogCapability(caps, TextGenerateVideo) {
		t.Fatal("should match mixed-case capability entries")
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
