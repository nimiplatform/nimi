package localrouting

import (
	"reflect"
	"testing"
)

func TestProviderSupportsCapability(t *testing.T) {
	testCases := []struct {
		provider   string
		capability string
		want       bool
	}{
		{provider: "llama", capability: "text.generate", want: true},
		{provider: "llama", capability: "music.generate", want: false},
		{provider: "media", capability: "image.generate", want: true},
		{provider: "media", capability: "text.generate", want: false},
		{provider: "speech", capability: "audio.transcribe", want: true},
		{provider: "speech", capability: "video.generate", want: false},
		{provider: "sidecar", capability: "music.generate", want: true},
		{provider: "sidecar", capability: "audio.transcribe", want: false},
	}

	for _, tc := range testCases {
		t.Run(tc.provider+"-"+tc.capability, func(t *testing.T) {
			if got := ProviderSupportsCapability(tc.provider, tc.capability); got != tc.want {
				t.Errorf("ProviderSupportsCapability(%q, %q): got=%v want=%v", tc.provider, tc.capability, got, tc.want)
			}
		})
	}
}

func TestPreferenceOrderHardCutByCapability(t *testing.T) {
	testCases := map[string][]string{
		"text.generate":    {"llama"},
		"text.embed":       {"llama"},
		"audio.understand": {"llama"},
		"image.generate":   {"media"},
		"video.generate":   {"media"},
		"audio.transcribe": {"speech"},
		"audio.synthesize": {"speech"},
		"music.generate":   {"sidecar"},
	}

	for capability, want := range testCases {
		t.Run(capability, func(t *testing.T) {
			if got := PreferenceOrder("windows", capability); !reflect.DeepEqual(got, want) {
				t.Fatalf("PreferenceOrder(windows, %q): got=%v want=%v", capability, got, want)
			}
		})
	}
}

func TestPreferenceOrderNonWindowsFiltersUnsupportedFallbacks(t *testing.T) {
	if got, want := PreferenceOrder("darwin", "text.generate"), []string{"llama"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(darwin, text.generate): got=%v want=%v", got, want)
	}
	if got, want := PreferenceOrder("linux", "image.generate"), []string{"media"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(linux, image.generate): got=%v want=%v", got, want)
	}
}

func TestNormalizeAndRankingHelpers(t *testing.T) {
	if got := NormalizeCapability("  CHAT "); got != "text.generate" {
		t.Fatalf("NormalizeCapability alias mismatch: %q", got)
	}
	if got := NormalizeCapability("text.generate.vision"); got != "text.generate" {
		t.Fatalf("vision capability should collapse to text.generate, got %q", got)
	}
	if got := NormalizeCapability("music"); got != "music.generate" {
		t.Fatalf("music alias should collapse to music.generate, got %q", got)
	}
	if got := NormalizeCapability("music.generate.iteration"); got != "music.generate" {
		t.Fatalf("music iteration capability should collapse to music.generate, got %q", got)
	}
	if got := NormalizeProvider(" Speech "); got != "speech" {
		t.Fatalf("NormalizeProvider mismatch: %q", got)
	}
	if !IsKnownProvider("Media") {
		t.Fatal("expected Media to be recognized as known provider")
	}
	if IsKnownProvider("custom") {
		t.Fatal("did not expect custom to be recognized as known provider")
	}
	if got := PreferenceRank("linux", "text.generate", "llama"); got != 0 {
		t.Fatalf("PreferenceRank mismatch: %d", got)
	}
	if got := PreferenceRank("linux", "text.generate", "media"); got != 1 {
		t.Fatalf("unexpected fallback rank: %d", got)
	}
}
