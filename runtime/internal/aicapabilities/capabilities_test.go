package aicapabilities

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"gopkg.in/yaml.v3"
)

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
		{ImageEdit, ImageEdit, true},
		{VideoGenerate, VideoGenerate, true},
		{AudioSynthesize, AudioSynthesize, true},
		{AudioTranscribe, AudioTranscribe, true},
		{VoiceWorkflowVoiceClone, VoiceWorkflowVoiceClone, true},
		{VoiceWorkflowVoiceDesign, VoiceWorkflowVoiceDesign, true},
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

func TestCanonicalCatalogMatchesPlatformCatalog(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "config", "platform-canonical-capability-catalog.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	var source struct {
		Capabilities []struct {
			CapabilityID string `yaml:"capabilityId"`
		} `yaml:"capabilities"`
	}
	if err := yaml.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	want := make([]string, 0, len(source.Capabilities))
	for _, item := range source.Capabilities {
		want = append(want, item.CapabilityID)
	}
	if got := CanonicalCatalog(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Runtime canonical capability registry = %v, want config catalog %v", got, want)
	}
	got := CanonicalCatalog()
	got[0] = "mutated"
	if CanonicalCatalog()[0] == "mutated" {
		t.Fatal("canonical catalog returned mutable registry storage")
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
