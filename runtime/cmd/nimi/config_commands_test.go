package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestRunRuntimeConfigInitGetValidate(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	initOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"init", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig init: %v", err)
	}
	initPayload := parseJSONMap(t, initOutput)
	configPath := asString(initPayload["path"])
	if configPath != filepath.Join(homeDir, ".nimi/config.json") {
		t.Fatalf("config path mismatch: got=%q", configPath)
	}
	if _, statErr := os.Stat(configPath); statErr != nil {
		t.Fatalf("config file missing after init: %v", statErr)
	}

	getOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"get", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig get: %v", err)
	}
	getPayload := parseJSONMap(t, getOutput)
	cfg, ok := getPayload["config"].(map[string]any)
	if !ok {
		t.Fatalf("config payload missing: %s", getOutput)
	}
	if int(asFloat(cfg["schemaVersion"])) != 1 {
		t.Fatalf("schema version mismatch: %#v", cfg["schemaVersion"])
	}

	validateOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"validate", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig validate: %v", err)
	}
	validatePayload := parseJSONMap(t, validateOutput)
	if validatePayload["valid"] != true {
		t.Fatalf("validate payload mismatch: %s", validateOutput)
	}
}

func TestRunRuntimeConfigSetAndSecretPolicy(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	setOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{
			"set",
			"--set", "runtime.grpcAddr=127.0.0.1:50051",
			"--set", "ai.providers.gemini.baseUrl=https://generativelanguage.googleapis.com/v1beta/openai",
			"--set", "ai.providers.gemini.apiKeyEnv=GEMINI_API_KEY",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig set: %v", err)
	}
	setPayload := parseJSONMap(t, setOutput)
	if asString(setPayload["reasonCode"]) != configReasonRestartRequired {
		t.Fatalf("set reasonCode mismatch: %s", setOutput)
	}

	cfgPath := filepath.Join(homeDir, ".nimi/config.json")
	cfg, loadErr := config.LoadFileConfig(cfgPath)
	if loadErr != nil {
		t.Fatalf("LoadFileConfig: %v", loadErr)
	}
	if cfg.Runtime.GRPCAddr != "127.0.0.1:50051" {
		t.Fatalf("grpc addr mismatch: got=%q", cfg.Runtime.GRPCAddr)
	}
	provider := cfg.AI.Providers["gemini"]
	if provider.APIKeyEnv != "GEMINI_API_KEY" {
		t.Fatalf("apiKeyEnv mismatch: got=%q", provider.APIKeyEnv)
	}

	err = runRuntimeConfig([]string{
		"set",
		"--set", "ai.providers.gemini.apiKey=plaintext",
	})
	if err == nil {
		t.Fatalf("expected secret policy error")
	}
	if !strings.Contains(err.Error(), configReasonSecretPolicyViolation) {
		t.Fatalf("expected %s, got %v", configReasonSecretPolicyViolation, err)
	}
}

func TestRunRuntimeConfigMigrate(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	legacyPath := filepath.Join(homeDir, ".nimi/runtime/config.json")
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("mkdir legacy dir: %v", err)
	}
	legacyContent := `{
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
	if err := os.WriteFile(legacyPath, []byte(legacyContent), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeConfig([]string{"migrate", "--json"})
	})
	if err != nil {
		t.Fatalf("runRuntimeConfig migrate: %v", err)
	}
	payload := parseJSONMap(t, output)
	if payload["migrated"] != true {
		t.Fatalf("migrated flag mismatch: %s", output)
	}
	newPath := asString(payload["path"])
	if newPath != filepath.Join(homeDir, ".nimi/config.json") {
		t.Fatalf("migrate path mismatch: got=%q", newPath)
	}
	if _, statErr := os.Stat(legacyPath); !os.IsNotExist(statErr) {
		t.Fatalf("legacy path should be removed after migrate")
	}
}

func TestRunRuntimeConfigSetReturnsWriteLocked(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	cfgPath := filepath.Join(homeDir, ".nimi/config.json")
	lockPath := cfgPath + ".lock"
	if err := os.WriteFile(lockPath, []byte("lock"), 0o600); err != nil {
		t.Fatalf("write lock file: %v", err)
	}

	err := runRuntimeConfig([]string{
		"set",
		"--set", "runtime.grpcAddr=127.0.0.1:50099",
	})
	if err == nil {
		t.Fatalf("expected write lock error")
	}
	if !strings.Contains(err.Error(), configReasonWriteLocked) {
		t.Fatalf("expected %s, got %v", configReasonWriteLocked, err)
	}
}

func TestRunRuntimeConfigValidateFailsOnInvalidSchema(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	cfgPath := filepath.Join(homeDir, ".nimi/config.json")
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	invalid := `{
  "schemaVersion": 2,
  "ai": {
    "providers": {
      "gemini": {
        "apiKeyEnv": "GEMINI_API_KEY"
      }
    }
  }
}`
	if err := os.WriteFile(cfgPath, []byte(invalid), 0o600); err != nil {
		t.Fatalf("write invalid config: %v", err)
	}

	err := runRuntimeConfig([]string{"validate", "--json"})
	if err == nil {
		t.Fatalf("expected schema invalid error")
	}
	if !strings.Contains(err.Error(), configReasonSchemaInvalid) {
		t.Fatalf("expected %s, got %v", configReasonSchemaInvalid, err)
	}
}

func parseJSONMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	parsed := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		t.Fatalf("parse json output: %v output=%q", err, raw)
	}
	return parsed
}

func clearRuntimeConfigCommandEnv(t *testing.T) {
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
		"NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_LITELLM_API_KEY",
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
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}
