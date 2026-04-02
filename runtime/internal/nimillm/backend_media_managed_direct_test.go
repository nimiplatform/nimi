package nimillm

import (
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
