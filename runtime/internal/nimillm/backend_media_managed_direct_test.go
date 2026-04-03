package nimillm

import (
	"math"
	"path/filepath"
	"testing"
)

func TestResolveManagedMediaModelPath(t *testing.T) {
	t.Run("joins relative model under models root", func(t *testing.T) {
		modelsRoot := filepath.Join(string(filepath.Separator), "tmp", "models")
		got := resolveManagedMediaModelPath(modelsRoot, "resolved/nimi/example/model.gguf")
		want := filepath.Join(modelsRoot, "resolved", "nimi", "example", "model.gguf")
		if got != want {
			t.Fatalf("resolveManagedMediaModelPath() = %q, want %q", got, want)
		}
	})

	t.Run("keeps absolute model path", func(t *testing.T) {
		absolute := filepath.Join(string(filepath.Separator), "tmp", "models", "resolved", "nimi", "example", "model.gguf")
		if got := resolveManagedMediaModelPath("/ignored", absolute); got != absolute {
			t.Fatalf("resolveManagedMediaModelPath() = %q, want %q", got, absolute)
		}
	})
}

func almostEqual(a, b float32) bool {
	return math.Abs(float64(a)-float64(b)) < 0.001
}

func TestManagedMediaResolveCFGScale(t *testing.T) {
	cases := []struct {
		name               string
		profile            map[string]any
		scenarioExtensions map[string]any
		want               float32
	}{
		{
			name:    "profile cfg_scale",
			profile: map[string]any{"cfg_scale": float64(4)},
			want:    4,
		},
		{
			name:    "profile parameters cfg_scale fallback",
			profile: map[string]any{"parameters": map[string]any{"cfg_scale": float64(4.5)}},
			want:    4.5,
		},
		{
			name:               "scenarioExtensions cfg_scale overrides profile",
			profile:            map[string]any{"cfg_scale": float64(3)},
			scenarioExtensions: map[string]any{"cfg_scale": float64(9)},
			want:               9,
		},
		{
			name:    "string 7.5 preserved as float",
			profile: map[string]any{"cfg_scale": "7.5"},
			want:    7.5,
		},
		{
			name:    "numeric 7.5 preserved as float",
			profile: map[string]any{"cfg_scale": float64(7.5)},
			want:    7.5,
		},
		{
			name:               "guidance_scale is ignored",
			scenarioExtensions: map[string]any{"guidance_scale": float64(5.5)},
			want:               0,
		},
		{
			name:               "invalid string ignored",
			scenarioExtensions: map[string]any{"cfg_scale": "bad"},
			want:               0,
		},
		{
			name:               "zero ignored",
			scenarioExtensions: map[string]any{"cfg_scale": float64(0)},
			want:               0,
		},
		{
			name:               "negative ignored",
			scenarioExtensions: map[string]any{"cfg_scale": float64(-2)},
			want:               0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := managedMediaResolveCFGScale(tc.profile, tc.scenarioExtensions)
			if !almostEqual(got, tc.want) {
				t.Fatalf("got %f, want %f", got, tc.want)
			}
		})
	}
}

func TestManagedMediaAppliedOptions(t *testing.T) {
	t.Run("tracks cfg_scale from extensions", func(t *testing.T) {
		applied := managedMediaAppliedOptions(
			map[string]any{},
			map[string]any{"cfg_scale": float64(7)},
		)
		found := false
		for _, v := range applied {
			if v == "cfg_scale" {
				found = true
			}
		}
		if !found {
			t.Fatalf("applied = %v, want cfg_scale in list", applied)
		}
	})

	t.Run("does not treat guidance_scale as applied", func(t *testing.T) {
		applied := managedMediaAppliedOptions(
			map[string]any{},
			map[string]any{"guidance_scale": float64(5)},
		)
		for _, v := range applied {
			if v == "guidance_scale->cfg_scale" || v == "guidance_scale" {
				t.Fatalf("applied = %v, guidance_scale must stay ignored", applied)
			}
		}
	})

	t.Run("tracks profile mode", func(t *testing.T) {
		applied := managedMediaAppliedOptions(
			map[string]any{"mode": "euler"},
			map[string]any{},
		)
		found := false
		for _, v := range applied {
			if v == "profile.mode" {
				found = true
			}
		}
		if !found {
			t.Fatalf("applied = %v, want profile.mode in list", applied)
		}
	})
}

func TestManagedMediaIgnoredOptions(t *testing.T) {
	t.Run("tracks ignored request options", func(t *testing.T) {
		ignored := managedMediaIgnoredOptions(map[string]any{
			"eta":            0.5,
			"strength":       0.7,
			"guidance_scale": 7,
			"clip_skip":      2,
		})
		want := []string{"guidance_scale", "eta", "strength", "clip_skip"}
		if len(ignored) != len(want) {
			t.Fatalf("ignored = %v, want %v", ignored, want)
		}
		for index, expected := range want {
			if ignored[index] != expected {
				t.Fatalf("ignored[%d] = %q, want %q; full=%v", index, ignored[index], expected, ignored)
			}
		}
	})
}

func TestManagedMediaResolveLoadOverrides(t *testing.T) {
	t.Run("scenario overrides drive sampler and cfg_scale", func(t *testing.T) {
		got := managedMediaResolveLoadOverrides(
			map[string]any{
				"mode":      "heun",
				"cfg_scale": float64(2),
			},
			map[string]any{
				"method":    "dpm++2m",
				"cfg_scale": "7.5",
			},
		)
		if !almostEqual(got.CFGScale, 7.5) {
			t.Fatalf("CFGScale = %f, want 7.5", got.CFGScale)
		}
		if got.Sampler != "dpmpp2m" {
			t.Fatalf("Sampler = %q, want dpmpp2m", got.Sampler)
		}
	})

	t.Run("profile sampler fallback remains canonical", func(t *testing.T) {
		got := managedMediaResolveLoadOverrides(
			map[string]any{"sampling_method": "Euler_A"},
			map[string]any{},
		)
		if got.Sampler != "euler_a" {
			t.Fatalf("Sampler = %q, want euler_a", got.Sampler)
		}
		if got.CFGScale != 0 {
			t.Fatalf("CFGScale = %f, want 0", got.CFGScale)
		}
	})
}
