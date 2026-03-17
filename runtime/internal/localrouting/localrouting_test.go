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
		{provider: "media.diffusers", capability: "video.generate", want: true},
		{provider: "media.diffusers", capability: "text.generate", want: false},
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
		"text.generate":    {"llama"},
		"text.embed":       {"llama"},
		"audio.understand": {"llama"},
		"image.generate":   {"media", "media.diffusers"},
		"video.generate":   {"media", "media.diffusers"},
		"music.generate":   {"sidecar"},
	}

	for capability, want := range testCases {
		if got := PreferenceOrder("windows", capability); !reflect.DeepEqual(got, want) {
			t.Fatalf("PreferenceOrder(windows, %q): got=%v want=%v", capability, got, want)
		}
	}
}

func TestPreferenceOrderNonWindowsFiltersUnsupportedFallbacks(t *testing.T) {
	if got, want := PreferenceOrder("darwin", "text.generate"), []string{"llama"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(darwin, text.generate): got=%v want=%v", got, want)
	}
	if got, want := PreferenceOrder("linux", "image.generate"), []string{"media", "media.diffusers"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PreferenceOrder(linux, image.generate): got=%v want=%v", got, want)
	}
}
