package entrypoint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func TestRunDaemonFromArgsMigratesLegacyRuntimeConfigOnStartup(t *testing.T) {
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

	err := RunDaemonFromArgs("nimi serve", []string{"--shutdown-timeout=invalid-duration"})
	if err == nil {
		t.Fatalf("expected parse shutdown-timeout error")
	}
	if !strings.Contains(err.Error(), "parse shutdown-timeout") {
		t.Fatalf("unexpected startup error: %v", err)
	}

	newPath := filepath.Join(homeDir, ".nimi/config.json")
	if _, statErr := os.Stat(newPath); statErr != nil {
		t.Fatalf("migrated config missing at new path: %v", statErr)
	}
	if _, statErr := os.Stat(legacyPath); !os.IsNotExist(statErr) {
		t.Fatalf("legacy config should be removed after startup migration")
	}

	fileCfg, loadErr := config.LoadFileConfig(newPath)
	if loadErr != nil {
		t.Fatalf("load migrated config: %v", loadErr)
	}
	if fileCfg.Runtime.GRPCAddr != "127.0.0.1:59001" {
		t.Fatalf("migrated grpc addr mismatch: %q", fileCfg.Runtime.GRPCAddr)
	}
	if fileCfg.Runtime.HTTPAddr != "127.0.0.1:59002" {
		t.Fatalf("migrated http addr mismatch: %q", fileCfg.Runtime.HTTPAddr)
	}
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
