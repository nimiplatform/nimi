package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadDefaultsWithoutConfigFile(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.GRPCAddr != defaultGRPCAddr {
		t.Fatalf("grpc default mismatch: got=%q want=%q", cfg.GRPCAddr, defaultGRPCAddr)
	}
	if cfg.HTTPAddr != defaultHTTPAddr {
		t.Fatalf("http default mismatch: got=%q want=%q", cfg.HTTPAddr, defaultHTTPAddr)
	}
	if cfg.ShutdownTimeout != 10*time.Second {
		t.Fatalf("shutdown timeout mismatch: got=%s want=10s", cfg.ShutdownTimeout)
	}

	expectedStatePath := filepath.Join(homeDir, defaultLocalRuntimeStateRelPath)
	if cfg.LocalRuntimeStatePath != expectedStatePath {
		t.Fatalf("state path mismatch: got=%q want=%q", cfg.LocalRuntimeStatePath, expectedStatePath)
	}
}

func TestLoadFromConfigFileAppliesRuntimeAndProviderDefaults(t *testing.T) {
	homeDir := t.TempDir()
	configDir := t.TempDir()
	configPath := filepath.Join(configDir, "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "runtime": {
    "grpcAddr": "127.0.0.1:50001",
    "httpAddr": "127.0.0.1:50002",
    "shutdownTimeout": "13s",
    "localRuntimeStatePath": "~/runtime/custom-state.json"
  },
  "ai": {
    "httpTimeout": "21s",
    "healthInterval": "3s",
    "providers": {
      "gemini": {
        "apiKeyEnv": "GEMINI_API_KEY"
      },
      "local": {
        "baseUrl": "http://127.0.0.1:11434",
        "apiKeyEnv": "LOCALAI_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("GEMINI_API_KEY", "gemini-from-env")
	t.Setenv("LOCALAI_API_KEY", "local-ai-key-from-env")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if cfg.GRPCAddr != "127.0.0.1:50001" {
		t.Fatalf("grpc value mismatch: %q", cfg.GRPCAddr)
	}
	if cfg.HTTPAddr != "127.0.0.1:50002" {
		t.Fatalf("http value mismatch: %q", cfg.HTTPAddr)
	}
	if cfg.ShutdownTimeout != 13*time.Second {
		t.Fatalf("shutdown value mismatch: %s", cfg.ShutdownTimeout)
	}
	if cfg.LocalRuntimeStatePath != filepath.Join(homeDir, "runtime/custom-state.json") {
		t.Fatalf("local runtime state path mismatch: %q", cfg.LocalRuntimeStatePath)
	}

	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_AI_HTTP_TIMEOUT")); got != "21s" {
		t.Fatalf("ai http timeout env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_AI_HEALTH_INTERVAL")); got != "3s" {
		t.Fatalf("ai health interval env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")); got != "gemini-from-env" {
		t.Fatalf("gemini key env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")); got != defaultCloudGeminiBaseURL {
		t.Fatalf("gemini base env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL")); got != "http://127.0.0.1:11434" {
		t.Fatalf("local ai base env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_API_KEY")); got != "local-ai-key-from-env" {
		t.Fatalf("local ai key env mismatch: %q", got)
	}
}

func TestLoadEnvOverridesConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "runtime": {
    "grpcAddr": "127.0.0.1:50001",
    "httpAddr": "127.0.0.1:50002"
  },
  "ai": {
    "providers": {
      "gemini": {
        "baseUrl": "https://config.example.com/openai",
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:46399")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL", "https://env.example.com/openai")
	t.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY", "env-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:46399" {
		t.Fatalf("grpc env override mismatch: %q", cfg.GRPCAddr)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")); got != "https://env.example.com/openai" {
		t.Fatalf("gemini base should keep env override: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")); got != "env-key" {
		t.Fatalf("gemini key should keep env override: %q", got)
	}
}

func TestLoadInvalidConfigFileReturnsError(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	if err := os.WriteFile(configPath, []byte(`{"runtime":`), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatalf("expected parse error, got nil")
	}
	if !strings.Contains(err.Error(), "parse runtime config file") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsPlaintextProviderAPIKey(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "ai": {
    "providers": {
      "gemini": {
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
        "apiKey": "plaintext-forbidden",
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatalf("expected secret policy violation, got nil")
	}
	if !strings.Contains(err.Error(), "apiKey is forbidden") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsLegacyProviderKey(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "ai": {
    "providers": {
      "cloudlitellm": {
        "baseUrl": "https://legacy.invalid/v1",
        "apiKeyEnv": "LEGACY_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatalf("expected legacy provider key violation, got nil")
	}
	if !strings.Contains(err.Error(), `provider "cloudlitellm" is forbidden`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadAcceptsCloudNimiLLMAlias(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "ai": {
    "providers": {
      "cloudnimillm": {
        "baseUrl": "https://api.example.com/v1",
        "apiKeyEnv": "NIMI_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_KEY", "nimi-key")

	if _, err := Load(); err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL")); got != "https://api.example.com/v1" {
		t.Fatalf("cloudnimillm base env mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY")); got != "nimi-key" {
		t.Fatalf("cloudnimillm key env mismatch: %q", got)
	}
}

func TestResolveRuntimeConfigPathForLoadMigratesLegacyPath(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigEnv(t)

	legacyPath := filepath.Join(homeDir, legacyRuntimeConfigRelPath)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("mkdir legacy dir: %v", err)
	}
	legacyBody := `{
  "runtime": {
    "grpcAddr": "127.0.0.1:59001",
    "httpAddr": "127.0.0.1:59002"
  },
  "ai": {
    "providers": {
      "gemini": {
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(legacyPath, []byte(legacyBody), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	resolvedPath, err := ResolveRuntimeConfigPathForLoad()
	if err != nil {
		t.Fatalf("ResolveRuntimeConfigPathForLoad returned error: %v", err)
	}
	if resolvedPath != filepath.Join(homeDir, defaultRuntimeConfigRelPath) {
		t.Fatalf("resolved path mismatch: got=%q", resolvedPath)
	}
	if _, statErr := os.Stat(legacyPath); !os.IsNotExist(statErr) {
		t.Fatalf("legacy config should be removed after migration")
	}

	migrated, err := LoadFileConfig(resolvedPath)
	if err != nil {
		t.Fatalf("LoadFileConfig migrated path: %v", err)
	}
	if migrated.SchemaVersion != DefaultSchemaVersion {
		t.Fatalf("migrated schema version mismatch: got=%d want=%d", migrated.SchemaVersion, DefaultSchemaVersion)
	}
	if migrated.Runtime.GRPCAddr != "127.0.0.1:59001" {
		t.Fatalf("migrated grpc addr mismatch: got=%q", migrated.Runtime.GRPCAddr)
	}
}

func TestMigrateLegacyConfigSkipsWhenExplicitPathSet(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	explicitPath := filepath.Join(t.TempDir(), "explicit-runtime-config.json")
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", explicitPath)
	clearRuntimeConfigEnv(t)

	legacyPath := filepath.Join(homeDir, legacyRuntimeConfigRelPath)
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("mkdir legacy dir: %v", err)
	}
	if err := os.WriteFile(legacyPath, []byte(`{"runtime":{"grpcAddr":"127.0.0.1:59999"}}`), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	migrated, resolved, err := MigrateLegacyConfig()
	if err != nil {
		t.Fatalf("MigrateLegacyConfig returned error: %v", err)
	}
	if migrated {
		t.Fatalf("migration should be skipped when NIMI_RUNTIME_CONFIG_PATH is set")
	}
	if resolved != explicitPath {
		t.Fatalf("resolved explicit path mismatch: got=%q want=%q", resolved, explicitPath)
	}
	if _, statErr := os.Stat(legacyPath); statErr != nil {
		t.Fatalf("legacy config should remain when migration skipped: %v", statErr)
	}
}

func TestLoadAppliesGeminiAliasFromEnvironment(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("GEMINI_API_KEY", "alias-key")

	_, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")); got != "alias-key" {
		t.Fatalf("gemini alias key mismatch: %q", got)
	}
	if got := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")); got != defaultCloudGeminiBaseURL {
		t.Fatalf("gemini default base mismatch: %q", got)
	}
}

func clearRuntimeConfigEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"NIMI_RUNTIME_GRPC_ADDR",
		"NIMI_RUNTIME_HTTP_ADDR",
		"NIMI_RUNTIME_SHUTDOWN_TIMEOUT",
		"NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH",
		"NIMI_RUNTIME_AI_HTTP_TIMEOUT",
		"NIMI_RUNTIME_AI_HEALTH_INTERVAL",
		"NIMI_RUNTIME_LOCAL_AI_BASE_URL",
		"NIMI_RUNTIME_LOCAL_AI_API_KEY",
		"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		"NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY",
		"NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ADAPTER_GLM_API_KEY",
		"GEMINI_API_KEY",
		"LOCALAI_API_KEY",
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}
