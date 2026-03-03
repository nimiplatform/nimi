package entrypoint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunDaemonFromArgsDoesNotMigrateLegacyRuntimeConfigOnStartup(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigEnvForStartupTest(t)

	legacyPath := filepath.Join(homeDir, ".nimi/runtime/config.json")
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("mkdir legacy config dir: %v", err)
	}
	legacyBody := `{
  "runtime": {
    "grpcAddr": "127.0.0.1:59001",
    "httpAddr": "127.0.0.1:59002"
  }
}`
	if err := os.WriteFile(legacyPath, []byte(legacyBody), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	err := RunDaemonFromArgs("nimi serve", []string{"--shutdown-timeout=invalid-duration"})
	if err == nil {
		t.Fatalf("expected parse shutdown-timeout error")
	}
	if !strings.Contains(err.Error(), "parse shutdown-timeout") {
		t.Fatalf("unexpected startup error: %v", err)
	}

	if _, statErr := os.Stat(legacyPath); statErr != nil {
		t.Fatalf("legacy config should not be touched: %v", statErr)
	}
	newPath := filepath.Join(homeDir, ".nimi/config.json")
	if _, statErr := os.Stat(newPath); !os.IsNotExist(statErr) {
		t.Fatalf("canonical config should not be auto-created on startup")
	}
}

func TestAcquireRuntimeInstanceLock(t *testing.T) {
	homeDir := t.TempDir()
	t.Setenv("HOME", homeDir)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", "")

	unlock, err := acquireRuntimeInstanceLock()
	if err != nil {
		t.Fatalf("acquire first runtime lock: %v", err)
	}
	lockPath, err := runtimeInstanceLockPath()
	if err != nil {
		t.Fatalf("resolve runtime lock path: %v", err)
	}
	if _, statErr := os.Stat(lockPath); statErr != nil {
		t.Fatalf("runtime lock file should exist: %v", statErr)
	}

	if _, err := acquireRuntimeInstanceLock(); err == nil {
		t.Fatalf("expected second runtime lock acquire to fail")
	}

	unlock()
	if _, statErr := os.Stat(lockPath); !os.IsNotExist(statErr) {
		t.Fatalf("runtime lock file should be removed after unlock")
	}

	unlockAgain, err := acquireRuntimeInstanceLock()
	if err != nil {
		t.Fatalf("acquire runtime lock after unlock: %v", err)
	}
	unlockAgain()
}

func clearRuntimeConfigEnvForStartupTest(t *testing.T) {
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
