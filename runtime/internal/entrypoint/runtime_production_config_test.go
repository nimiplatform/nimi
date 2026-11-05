package entrypoint

import (
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestProtectedRuntimeConfigBindsSpeechExecutionHostPort(t *testing.T) {
	cfg := newProtectedRuntimeConfig(t.TempDir(), "runtime-id", "https://realm.example")
	want := engine.DefaultSpeechConfig().Port
	if cfg.EngineSpeechPort != want {
		t.Fatalf("protected Runtime speech port = %d, want %d", cfg.EngineSpeechPort, want)
	}
}

func TestProtectedRuntimeConfigAllowsSlowMediaGeneration(t *testing.T) {
	cfg := newProtectedRuntimeConfig(t.TempDir(), "runtime-id", "https://realm.example")
	if cfg.AIHTTPTimeoutSeconds != 300 {
		t.Fatalf("protected Runtime generation timeout = %d, want 300 seconds", cfg.AIHTTPTimeoutSeconds)
	}
}

func TestProtectedRuntimeConfigConstructsLlamaExecutionHost(t *testing.T) {
	cfg := newProtectedRuntimeConfig(t.TempDir(), "runtime-id", "https://realm.example")
	want := engine.DefaultLlamaConfig()
	if !cfg.EngineLlamaEnabled || cfg.EngineLlamaVersion != want.Version || cfg.EngineLlamaPort != want.Port {
		t.Fatalf("protected Runtime llama config = enabled:%t version:%q port:%d, want enabled/%q/%d", cfg.EngineLlamaEnabled, cfg.EngineLlamaVersion, cfg.EngineLlamaPort, want.Version, want.Port)
	}
}
