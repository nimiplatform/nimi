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
		{provider: "localai", capability: "text.generate", want: true},
		{provider: "localai", capability: "music.generate", want: true},
		{provider: "nexa", capability: "audio.synthesize", want: true},
		{provider: "nexa", capability: "video.generate", want: false},
		{provider: "nimi_media", capability: "image.generate", want: true},
		{provider: "nimi_media", capability: "text.generate", want: false},
		{provider: "sidecar", capability: "music.generate", want: true},
		{provider: "sidecar", capability: "audio.transcribe", want: false},
	}

	for _, tc := range testCases {
		if got := ProviderSupportsCapability(tc.provider, tc.capability); got != tc.want {
			t.Fatalf("ProviderSupportsCapability(%q, %q): got=%v want=%v", tc.provider, tc.capability, got, tc.want)
		}
	}
}

func TestPreferenceOrderWindowsHardCutByCapability(t *testing.T) {
	testCases := map[string][]string{
		"text.generate":    {"nexa"},
		"text.embed":       {"nexa"},
		"audio.synthesize": {"nexa"},
		"audio.transcribe": {"nexa"},
		"image.generate":   {"nimi_media"},
		"video.generate":   {"nimi_media"},
		"music.generate":   {"sidecar"},
	}

	for capability, want := range testCases {
		if got := PreferenceOrder("windows", capability); !reflect.DeepEqual(got, want) {
			t.Fatalf("PreferenceOrder(windows, %q): got=%v want=%v", capability, got, want)
		}
	}
}

func TestPreferenceOrderNonWindowsFiltersUnsupportedFallbacks(t *testing.T) {
	if got, want := PreferenceOrder("darwin", "text.generate"), []string{"localai", "nexa"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(darwin, text.generate): got=%v want=%v", got, want)
	}
	if got, want := PreferenceOrder("linux", "image.generate"), []string{"localai", "nimi_media"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(linux, image.generate): got=%v want=%v", got, want)
	}
}
