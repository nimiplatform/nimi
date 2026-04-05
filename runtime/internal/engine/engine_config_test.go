package engine

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDefaultLlamaConfig(t *testing.T) {
	cfg := DefaultLlamaConfig()
	if cfg.Kind != EngineLlama {
		t.Errorf("expected kind %s, got %s", EngineLlama, cfg.Kind)
	}
	if cfg.Port != 1234 {
		t.Errorf("expected port 1234, got %d", cfg.Port)
	}
	if cfg.Version != defaultLlamaVersion {
		t.Errorf("expected version %s, got %s", defaultLlamaVersion, cfg.Version)
	}
	if cfg.HealthPath != "/v1/models" {
		t.Errorf("expected health path /v1/models, got %s", cfg.HealthPath)
	}
	if cfg.MaxRestarts != 5 {
		t.Errorf("expected max restarts 5, got %d", cfg.MaxRestarts)
	}
	if cfg.StartupTimeout != 120*time.Second {
		t.Errorf("expected startup timeout 120s, got %s", cfg.StartupTimeout)
	}
}

func TestLlamaCommandArgsUsesExplicitManagedTarget(t *testing.T) {
	cfg := EngineConfig{
		Kind:       EngineLlama,
		BinaryPath: "/usr/local/bin/llama-server",
		Port:       5555,
		ModelsPath: "/data/models",
		ManagedLlamaTarget: &ManagedLlamaTarget{
			ModelPath:  "qwen/qwen3.gguf",
			ModelAlias: "managed-qwen-explicit",
			EngineConfig: ManagedLlamaEngineConfig{
				CtxSize:    16384,
				CacheTypeK: "q4_0",
			},
		},
	}
	cmd, err := llamaCommand(cfg)
	if err != nil {
		t.Fatalf("llamaCommand: %v", err)
	}
	args := strings.Join(cmd.Args[1:], " ")

	for _, want := range []string{
		"--host", "127.0.0.1",
		"--port", "5555",
		"--model", filepath.Join("/data/models", "qwen/qwen3.gguf"),
		"--reasoning", "off",
		"--alias", "managed-qwen-explicit",
		"--ctx-size", "16384",
		"--cache-type-k", "q4_0",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("expected args to contain %q, got: %s", want, args)
		}
	}
}
