package main

import (
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
			"--set", "grpcAddr=127.0.0.1:50051",
			"--set", "providers.gemini.baseUrl=https://generativelanguage.googleapis.com/v1beta/openai",
			"--set", "providers.gemini.apiKeyEnv=NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
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
	if cfg.GRPCAddr != "127.0.0.1:50051" {
		t.Fatalf("grpc addr mismatch: got=%q", cfg.GRPCAddr)
	}
	provider := cfg.Providers["gemini"]
	if provider.APIKeyEnv != "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY" {
		t.Fatalf("apiKeyEnv mismatch: got=%q", provider.APIKeyEnv)
	}

	err = runRuntimeConfig([]string{
		"set",
		"--set", "providers.gemini.apiKey=plaintext",
	})
	if err == nil {
		t.Fatalf("expected secret policy error")
	}
	if !strings.Contains(err.Error(), configReasonSecretPolicyViolation) {
		t.Fatalf("expected %s, got %v", configReasonSecretPolicyViolation, err)
	}
}

func TestRunRuntimeConfigRejectsMigrateSubcommand(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	err := runRuntimeConfig([]string{"migrate", "--json"})
	if !errors.Is(err, flag.ErrHelp) {
		t.Fatalf("migrate should be rejected as unsupported subcommand, got: %v", err)
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
		"--set", "grpcAddr=127.0.0.1:50099",
	})
	if err == nil {
		t.Fatalf("expected write lock error")
	}
	if !strings.Contains(err.Error(), configReasonWriteLocked) {
		t.Fatalf("expected %s, got %v", configReasonWriteLocked, err)
	}
}

func TestRunRuntimeConfigSetConcurrentWriteConflict(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigCommandEnv(t)

	if err := runRuntimeConfig([]string{"init", "--json"}); err != nil {
		t.Fatalf("init config: %v", err)
	}

	lockAcquired := make(chan struct{})
	releaseLock := make(chan struct{})
	var blockOnce sync.Once
	restoreHook := setConfigWriteLockHookForTest(func(_ string) {
		blockOnce.Do(func() {
			close(lockAcquired)
			<-releaseLock
		})
	})
	defer restoreHook()

	firstErrCh := make(chan error, 1)
	go func() {
		firstErrCh <- runRuntimeConfig([]string{
			"set",
			"--set", "grpcAddr=127.0.0.1:50101",
			"--json",
		})
	}()

	<-lockAcquired

	secondErr := runRuntimeConfig([]string{
		"set",
		"--set", "grpcAddr=127.0.0.1:50102",
		"--json",
	})
	if secondErr == nil {
		t.Fatalf("expected concurrent write lock error")
	}
	if !strings.Contains(secondErr.Error(), configReasonWriteLocked) {
		t.Fatalf("expected %s, got %v", configReasonWriteLocked, secondErr)
	}

	close(releaseLock)

	firstErr := <-firstErrCh
	if firstErr != nil {
		t.Fatalf("first set should succeed, got: %v", firstErr)
	}

	cfgPath := filepath.Join(homeDir, ".nimi/config.json")
	fileCfg, err := config.LoadFileConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadFileConfig after concurrent set: %v", err)
	}
	if fileCfg.SchemaVersion != config.DefaultSchemaVersion {
		t.Fatalf("schema version mismatch: got=%d want=%d", fileCfg.SchemaVersion, config.DefaultSchemaVersion)
	}
	if fileCfg.GRPCAddr != "127.0.0.1:50101" {
		t.Fatalf("grpc addr mismatch after concurrent set: %q", fileCfg.GRPCAddr)
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
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
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
		"NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL",
		"NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL",
		"NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY",
		"NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		"NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL",
		"NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY",
		"NIMI_RUNTIME_CLOUD_KIMI_BASE_URL",
		"NIMI_RUNTIME_CLOUD_KIMI_API_KEY",
		"NIMI_RUNTIME_CLOUD_GLM_BASE_URL",
		"NIMI_RUNTIME_CLOUD_GLM_API_KEY",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL",
		"NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL",
		"NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY",
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}
