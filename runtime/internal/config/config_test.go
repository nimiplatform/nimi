package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func setLlamaSupervisedPlatformForTest(t *testing.T, supported bool, platform string) {
	t.Helper()
	originalSupported := llamaSupervisedPlatformSupported
	llamaSupervisedPlatformSupported = func() bool { return supported }
	_ = platform
	t.Cleanup(func() {
		llamaSupervisedPlatformSupported = originalSupported
	})
}

func setMediaSupervisedPlatformForTest(t *testing.T, supported bool) {
	t.Helper()
	original := mediaSupervisedPlatformSupported
	mediaSupervisedPlatformSupported = func() bool { return supported }
	t.Cleanup(func() {
		mediaSupervisedPlatformSupported = original
	})
}

func setRuntimeTestHome(t *testing.T, homeDir string) {
	t.Helper()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	volume := filepath.VolumeName(homeDir)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(homeDir, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}
	t.Setenv("HOMEDRIVE", volume)
	t.Setenv("HOMEPATH", homePath)
}

func TestLoadDefaultsWithoutConfigFile(t *testing.T) {
	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
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

	expectedStatePath := filepath.Join(homeDir, defaultLocalStateRelPath)
	if cfg.LocalStatePath != expectedStatePath {
		t.Fatalf("state path mismatch: got=%q want=%q", cfg.LocalStatePath, expectedStatePath)
	}
	expectedModelsPath := filepath.Join(homeDir, defaultLocalModelsRelPath)
	if cfg.LocalModelsPath != expectedModelsPath {
		t.Fatalf("models path mismatch: got=%q want=%q", cfg.LocalModelsPath, expectedModelsPath)
	}

	if cfg.AIHealthIntervalSeconds != 8 {
		t.Fatalf("aiHealthIntervalSeconds default mismatch: got=%d want=8", cfg.AIHealthIntervalSeconds)
	}
	if cfg.EngineLlamaVersion != engine.DefaultLlamaConfig().Version {
		t.Fatalf("llama version default mismatch: got=%q want=%q", cfg.EngineLlamaVersion, engine.DefaultLlamaConfig().Version)
	}
	if cfg.AIHTTPTimeoutSeconds != 30 {
		t.Fatalf("aiHttpTimeoutSeconds default mismatch: got=%d want=30", cfg.AIHTTPTimeoutSeconds)
	}
	if cfg.GlobalConcurrencyLimit != 8 {
		t.Fatalf("globalConcurrencyLimit default mismatch: got=%d want=8", cfg.GlobalConcurrencyLimit)
	}
	if cfg.PerAppConcurrencyLimit != 2 {
		t.Fatalf("perAppConcurrencyLimit default mismatch: got=%d want=2", cfg.PerAppConcurrencyLimit)
	}
	if cfg.IdempotencyCapacity != 10000 {
		t.Fatalf("idempotencyCapacity default mismatch: got=%d want=10000", cfg.IdempotencyCapacity)
	}
	if cfg.MaxDelegationDepth != 3 {
		t.Fatalf("maxDelegationDepth default mismatch: got=%d want=3", cfg.MaxDelegationDepth)
	}
	if cfg.AuditRingBufferSize != 20000 {
		t.Fatalf("auditRingBufferSize default mismatch: got=%d want=20000", cfg.AuditRingBufferSize)
	}
	if cfg.UsageStatsBufferSize != 50000 {
		t.Fatalf("usageStatsBufferSize default mismatch: got=%d want=50000", cfg.UsageStatsBufferSize)
	}
	if cfg.LocalAuditCapacity != 5000 {
		t.Fatalf("localAuditCapacity default mismatch: got=%d want=5000", cfg.LocalAuditCapacity)
	}
	expectedCatalogCustomDir := filepath.Join(homeDir, defaultModelCatalogCustomRelPath)
	if cfg.ModelCatalogCustomDir != expectedCatalogCustomDir {
		t.Fatalf("model catalog custom dir mismatch: got=%q want=%q", cfg.ModelCatalogCustomDir, expectedCatalogCustomDir)
	}
}

func TestLoadFromConfigFileAppliesRuntimeAndProviderDefaults(t *testing.T) {
	homeDir := t.TempDir()
	configDir := t.TempDir()
	configPath := filepath.Join(configDir, "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "grpcAddr": "127.0.0.1:50001",
  "httpAddr": "127.0.0.1:50002",
  "shutdownTimeoutSeconds": 13,
  "localStatePath": "~/runtime/custom-state.json",
  "localModelsPath": "~/runtime/custom-models",
  "defaultCloudProvider": "gemini",
  "aiHttpTimeoutSeconds": 21,
  "aiHealthIntervalSeconds": 3,
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY", "gemini-from-env")
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
	if cfg.LocalStatePath != filepath.Join(homeDir, "runtime/custom-state.json") {
		t.Fatalf("local runtime state path mismatch: %q", cfg.LocalStatePath)
	}
	if cfg.LocalModelsPath != filepath.Join(homeDir, "runtime/custom-models") {
		t.Fatalf("local models path mismatch: %q", cfg.LocalModelsPath)
	}
	if cfg.DefaultCloudProvider != "gemini" {
		t.Fatalf("defaultCloudProvider mismatch: %q", cfg.DefaultCloudProvider)
	}

	if cfg.AIHTTPTimeoutSeconds != 21 {
		t.Fatalf("aiHttpTimeoutSeconds mismatch: got=%d want=21", cfg.AIHTTPTimeoutSeconds)
	}
	if cfg.AIHealthIntervalSeconds != 3 {
		t.Fatalf("aiHealthIntervalSeconds mismatch: got=%d want=3", cfg.AIHealthIntervalSeconds)
	}
	target, ok := cfg.Providers["gemini"]
	if !ok {
		t.Fatalf("expected gemini provider to be resolved from config")
	}
	if got := ResolveProviderAPIKey(target); got != "gemini-from-env" {
		t.Fatalf("gemini key mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.BaseURL); got != defaultCloudGeminiBaseURL {
		t.Fatalf("gemini base mismatch: %q", got)
	}
}

func TestLoadEngineConfigFromFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "engines": {
    "llama": {
      "enabled": true,
      "version": "3.12.9",
      "port": 2234
    },
    "media": {
      "enabled": true,
      "version": "0.2.0",
      "port": 9321
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	setLlamaSupervisedPlatformForTest(t, true, "linux/amd64")
	setMediaSupervisedPlatformForTest(t, true)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.EngineLlamaEnabled || cfg.EngineLlamaVersion != "3.12.9" || cfg.EngineLlamaPort != 2234 {
		t.Fatalf("llama engine config mismatch: %+v", cfg)
	}
	if !cfg.EngineMediaEnabled || cfg.EngineMediaVersion != "0.2.0" || cfg.EngineMediaPort != 9321 {
		t.Fatalf("media engine config mismatch: %+v", cfg)
	}
}

func TestLoadAutoManagesLlamaForLoopbackProvider(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "runtime-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_API_KEY", "llama-key")
	setLlamaSupervisedPlatformForTest(t, true, "linux/amd64")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if !cfg.EngineLlamaEnabled {
		t.Fatalf("llama should be auto-enabled for loopback local endpoint")
	}
	if !cfg.EngineLlamaAutoManaged {
		t.Fatalf("llama should be marked auto-managed for loopback local endpoint")
	}
	if cfg.EngineLlamaPort != 2234 {
		t.Fatalf("llama port should be inferred from loopback endpoint: got=%d want=2234", cfg.EngineLlamaPort)
	}
}

func TestLoadDoesNotAutoManageLlamaForLoopbackProviderOnUnsupportedPlatform(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "runtime-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")
	setLlamaSupervisedPlatformForTest(t, false, "windows/amd64")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.EngineLlamaEnabled {
		t.Fatalf("llama should stay disabled on unsupported supervised platforms")
	}
	if cfg.EngineLlamaAutoManaged {
		t.Fatalf("llama should not be marked auto-managed on unsupported supervised platforms")
	}
}

func TestLoadDoesNotAutoManageLlamaForNonLoopbackProvider(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "runtime-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "https://example.com/v1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.EngineLlamaEnabled {
		t.Fatalf("llama should remain disabled for non-loopback endpoint")
	}
	if cfg.EngineLlamaAutoManaged {
		t.Fatalf("llama should not be marked auto-managed for non-loopback endpoint")
	}
}

func TestLoadLlamaExplicitEnabledFalseDisablesAutoManagement(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "engines": {
    "llama": {
      "enabled": false
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.EngineLlamaEnabled {
		t.Fatalf("explicit engines.llama.enabled=false must override auto-management")
	}
	if cfg.EngineLlamaAutoManaged {
		t.Fatalf("auto-managed flag should be false when llama.enabled is explicitly configured")
	}
}

func TestLoadDisablesExplicitLlamaEnableOnUnsupportedPlatform(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "engines": {
    "llama": {
      "enabled": true
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	setLlamaSupervisedPlatformForTest(t, false, "windows/amd64")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.EngineLlamaEnabled {
		t.Fatalf("explicit supervised llama should be disabled on unsupported platforms")
	}
	if cfg.EngineLlamaAutoManaged {
		t.Fatalf("unsupported platforms must not mark llama auto-managed")
	}
}

func TestLoadDisablesExplicitMediaEnableOnUnsupportedPlatform(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "engines": {
    "media": {
      "enabled": true
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	setMediaSupervisedPlatformForTest(t, false)
	setLlamaSupervisedPlatformForTest(t, false, "unsupported")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.EngineMediaEnabled {
		t.Fatalf("explicit supervised media should be disabled when neither media nor llama supervised platforms are supported")
	}
}

func TestLoadAutoManagedLlamaPortInferenceFallbackAndOverride(t *testing.T) {
	t.Run("fallback default port", func(t *testing.T) {
		t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "runtime-config.json"))
		clearRuntimeConfigEnv(t)
		t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://localhost/v1")
		setLlamaSupervisedPlatformForTest(t, true, "linux/amd64")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if !cfg.EngineLlamaEnabled || !cfg.EngineLlamaAutoManaged {
			t.Fatalf("llama should be auto-managed for localhost endpoint")
		}
		if cfg.EngineLlamaPort != 1234 {
			t.Fatalf("llama port fallback mismatch: got=%d want=1234", cfg.EngineLlamaPort)
		}
	})

	t.Run("explicit port override", func(t *testing.T) {
		configPath := filepath.Join(t.TempDir(), "runtime-config.json")
		configBody := `{
  "schemaVersion": 1,
  "engines": {
    "llama": {
      "port": 3344
    }
  }
}`
		if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
			t.Fatalf("write config file: %v", err)
		}

		t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
		clearRuntimeConfigEnv(t)
		t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:2234/v1")
		setLlamaSupervisedPlatformForTest(t, true, "linux/amd64")

		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load returned error: %v", err)
		}
		if !cfg.EngineLlamaEnabled || !cfg.EngineLlamaAutoManaged {
			t.Fatalf("llama should be auto-managed for loopback endpoint")
		}
		if cfg.EngineLlamaPort != 3344 {
			t.Fatalf("explicit llama port must override inferred provider port: got=%d want=3344", cfg.EngineLlamaPort)
		}
	})
}

func TestLoadEnvOverridesConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "grpcAddr": "127.0.0.1:50001",
  "httpAddr": "127.0.0.1:50002",
  "providers": {
    "gemini": {
      "baseUrl": "https://config.example.com/openai",
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:46399")
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", "https://env.example.com/openai")
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY", "env-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:46399" {
		t.Fatalf("grpc env override mismatch: %q", cfg.GRPCAddr)
	}
	target := cfg.Providers["gemini"]
	if got := strings.TrimSpace(target.BaseURL); got != "https://env.example.com/openai" {
		t.Fatalf("gemini base should keep env override: %q", got)
	}
	if got := strings.TrimSpace(ResolveProviderAPIKey(target)); got != "env-key" {
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

func TestLoadMigratesLegacyNestedConfigSchema(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "runtime": {
    "grpcAddr": "127.0.0.1:50001"
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:50001" {
		t.Fatalf("grpc addr mismatch after nested migration: got=%q", cfg.GRPCAddr)
	}
	if _, statErr := os.Stat(configPath + ".bak"); statErr != nil {
		t.Fatalf("expected migration backup file: %v", statErr)
	}
}

func TestLoadIgnoresUnknownConfigFields(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "grpcAddr": "127.0.0.1:50101",
  "unknownFutureField": "ignored"
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected unknown fields to be ignored, got: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:50101" {
		t.Fatalf("grpc addr mismatch: %q", cfg.GRPCAddr)
	}
}

func TestLoadAllowsInlineProviderAPIKey(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "providers": {
    "gemini": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "apiKey": "inline-key"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if got := ResolveProviderAPIKey(cfg.Providers["gemini"]); got != "inline-key" {
		t.Fatalf("inline api key mismatch: got=%q", got)
	}
	if got := strings.TrimSpace(cfg.Providers["gemini"].BaseURL); got != "https://generativelanguage.googleapis.com/v1beta/openai" {
		t.Fatalf("provider base mismatch: got=%q", got)
	}
}

func TestResolveProviderAPIKeyTreatsGenericEnvInterpolationAsLiteralInlineAPIKey(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_UNSAFE_API_KEY", "secret-from-env")
	got := ResolveProviderAPIKey(RuntimeFileTarget{
		APIKey: "${NIMI_RUNTIME_UNSAFE_API_KEY}",
	})
	if got != "${NIMI_RUNTIME_UNSAFE_API_KEY}" {
		t.Fatalf("generic env interpolation should stay literal inline secret, got=%q", got)
	}
}

func TestLoadRejectsProviderAPIKeyAndEnvConflict(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "providers": {
    "gemini": {
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "apiKey": "inline-key",
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
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
		t.Fatalf("expected provider credential conflict, got nil")
	}
	if !strings.Contains(err.Error(), "cannot set both apiKey and apiKeyEnv") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsDefaultCloudProviderWithoutConfiguredTarget(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "defaultCloudProvider": "openai",
  "providers": {
    "gemini": {
      "apiKey": "inline-key"
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
		t.Fatalf("expected invalid defaultCloudProvider error")
	}
	if !strings.Contains(err.Error(), `defaultCloudProvider "openai" must reference a configured provider`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadDefaultCloudProviderEnvOverrideWinsAndNormalizes(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "defaultCloudProvider": "gemini",
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_DEFAULT_CLOUD_PROVIDER", " Gemini ")
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY", "gemini-from-env")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.DefaultCloudProvider != "gemini" {
		t.Fatalf("expected normalized env override, got %q", cfg.DefaultCloudProvider)
	}
}

func TestLoadRejectsLegacyProviderKey(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "providers": {
    "cloudlitellm": {
      "baseUrl": "https://legacy.invalid/v1",
      "apiKeyEnv": "LEGACY_API_KEY"
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

func TestLoadRejectsLegacyProviderAlias(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "providers": {
    "cloudnimillm": {
      "baseUrl": "https://api.example.com/v1",
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY"
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
		t.Fatalf("expected legacy alias violation, got nil")
	}
	if !strings.Contains(err.Error(), `provider "cloudnimillm" is forbidden`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadIgnoresLegacyRuntimeConfigPath(t *testing.T) {
	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigEnv(t)

	legacyPath := filepath.Join(homeDir, ".nimi/runtime/config.json")
	if err := os.MkdirAll(filepath.Dir(legacyPath), 0o755); err != nil {
		t.Fatalf("mkdir legacy dir: %v", err)
	}
	legacyBody := `{"runtime":{"grpcAddr":"127.0.0.1:59001"}}`
	if err := os.WriteFile(legacyPath, []byte(legacyBody), 0o600); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != defaultGRPCAddr {
		t.Fatalf("grpc should use canonical default config path only: got=%q", cfg.GRPCAddr)
	}
	if _, statErr := os.Stat(legacyPath); statErr != nil {
		t.Fatalf("legacy config should not be touched: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(homeDir, ".nimi/config.json")); !os.IsNotExist(statErr) {
		t.Fatalf("canonical config should not be auto-created")
	}
}

func TestLoadMigratesLegacyNestedRuntimeObjectAtCanonicalPath(t *testing.T) {
	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigEnv(t)

	configPath := filepath.Join(homeDir, ".nimi", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("mkdir canonical config dir: %v", err)
	}
	legacyBody := `{"schemaVersion":1,"runtime":{"grpcAddr":"127.0.0.1:59001"}}`
	if err := os.WriteFile(configPath, []byte(legacyBody), 0o600); err != nil {
		t.Fatalf("write legacy canonical config: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:59001" {
		t.Fatalf("grpc addr mismatch after legacy canonical migration: got=%q", cfg.GRPCAddr)
	}

	fileCfg, err := LoadFileConfig(configPath)
	if err != nil {
		t.Fatalf("LoadFileConfig after migration: %v", err)
	}
	if fileCfg.GRPCAddr != "127.0.0.1:59001" {
		t.Fatalf("migrated file grpc addr mismatch: got=%q", fileCfg.GRPCAddr)
	}
	if _, statErr := os.Stat(configPath + ".bak"); statErr != nil {
		t.Fatalf("expected migration backup file: %v", statErr)
	}
}

func TestLoadAppliesGeminiDefaultBaseURLWhenCanonicalKeyPresent(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY", "canonical-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	target, ok := cfg.Providers["gemini"]
	if !ok {
		t.Fatalf("expected env-only gemini provider to be resolved")
	}
	if got := strings.TrimSpace(ResolveProviderAPIKey(target)); got != "canonical-key" {
		t.Fatalf("gemini key mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.BaseURL); got != defaultCloudGeminiBaseURL {
		t.Fatalf("gemini default base mismatch: %q", got)
	}
}

func TestResolveCanonicalProviderIDRejectsLegacyAliases(t *testing.T) {
	if id, ok := ResolveCanonicalProviderID("alibaba"); ok || id != "" {
		t.Fatalf("legacy alias alibaba must be rejected")
	}
	if id, ok := ResolveCanonicalProviderID("dashscope"); !ok || id != "dashscope" {
		t.Fatalf("dashscope canonical resolve mismatch: id=%q ok=%v", id, ok)
	}
	if id, ok := ResolveCanonicalProviderID("moonshot"); ok || id != "" {
		t.Fatalf("legacy alias moonshot must be rejected")
	}
	if id, ok := ResolveCanonicalProviderID("openai_compatible"); !ok || id != "openai_compatible" {
		t.Fatalf("openai_compatible canonical resolve mismatch: id=%q ok=%v", id, ok)
	}
}

func TestLoadEnvOverridesNewFields(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", "16")
	t.Setenv("NIMI_RUNTIME_PER_APP_CONCURRENCY_LIMIT", "4")
	t.Setenv("NIMI_RUNTIME_IDEMPOTENCY_CAPACITY", "5000")
	t.Setenv("NIMI_RUNTIME_MAX_DELEGATION_DEPTH", "5")
	t.Setenv("NIMI_RUNTIME_AUDIT_RING_BUFFER_SIZE", "10000")
	t.Setenv("NIMI_RUNTIME_USAGE_STATS_BUFFER_SIZE", "25000")
	t.Setenv("NIMI_RUNTIME_LOCAL_AUDIT_CAPACITY", "2000")
	t.Setenv("NIMI_RUNTIME_AI_HEALTH_INTERVAL_SECONDS", "15")
	t.Setenv("NIMI_RUNTIME_AI_HTTP_TIMEOUT_SECONDS", "60")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GlobalConcurrencyLimit != 16 {
		t.Fatalf("globalConcurrencyLimit got=%d want=16", cfg.GlobalConcurrencyLimit)
	}
	if cfg.PerAppConcurrencyLimit != 4 {
		t.Fatalf("perAppConcurrencyLimit got=%d want=4", cfg.PerAppConcurrencyLimit)
	}
	if cfg.IdempotencyCapacity != 5000 {
		t.Fatalf("idempotencyCapacity got=%d want=5000", cfg.IdempotencyCapacity)
	}
	if cfg.MaxDelegationDepth != 5 {
		t.Fatalf("maxDelegationDepth got=%d want=5", cfg.MaxDelegationDepth)
	}
	if cfg.AuditRingBufferSize != 10000 {
		t.Fatalf("auditRingBufferSize got=%d want=10000", cfg.AuditRingBufferSize)
	}
	if cfg.UsageStatsBufferSize != 25000 {
		t.Fatalf("usageStatsBufferSize got=%d want=25000", cfg.UsageStatsBufferSize)
	}
	if cfg.LocalAuditCapacity != 2000 {
		t.Fatalf("localAuditCapacity got=%d want=2000", cfg.LocalAuditCapacity)
	}
	if cfg.AIHealthIntervalSeconds != 15 {
		t.Fatalf("aiHealthIntervalSeconds got=%d want=15", cfg.AIHealthIntervalSeconds)
	}
	if cfg.AIHTTPTimeoutSeconds != 60 {
		t.Fatalf("aiHttpTimeoutSeconds got=%d want=60", cfg.AIHTTPTimeoutSeconds)
	}
}

func TestLoadRejectsRemovedModelCatalogRemoteConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "modelCatalogRemoteEnabled": true,
  "modelCatalogRemoteUrl": "https://catalog.config.test/model-catalog.yaml",
  "modelCatalogRefreshIntervalSeconds": 120,
  "modelCatalogCachePath": "~/runtime/model-catalog-cache.yaml",
  "modelCatalogCustomDir": "~/runtime/model-catalog/providers"
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatalf("expected removed model catalog remote config to be rejected")
	}
	if !strings.Contains(err.Error(), "modelCatalogRemoteEnabled is removed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsRemovedModelCatalogRemoteEnv(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "modelCatalogCustomDir": "~/runtime/model-catalog/providers"
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_MODEL_CATALOG_REMOTE_ENABLED", "false")
	t.Setenv("NIMI_RUNTIME_MODEL_CATALOG_REMOTE_URL", "https://catalog.env.test/model-catalog.yaml")
	t.Setenv("NIMI_RUNTIME_MODEL_CATALOG_REFRESH_INTERVAL", "5m")
	t.Setenv("NIMI_RUNTIME_MODEL_CATALOG_CACHE_PATH", "~/runtime/env-cache.yaml")

	_, err := Load()
	if err == nil {
		t.Fatalf("expected removed model catalog remote env to be rejected")
	}
	if !strings.Contains(err.Error(), "NIMI_RUNTIME_MODEL_CATALOG_REMOTE_ENABLED is removed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadFlatFileConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "grpcAddr": "127.0.0.1:50001",
  "httpAddr": "127.0.0.1:50002",
  "shutdownTimeoutSeconds": 15,
  "localStatePath": "~/custom/state.json",
  "localModelsPath": "~/custom/models"
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.GRPCAddr != "127.0.0.1:50001" {
		t.Fatalf("grpc mismatch: %q", cfg.GRPCAddr)
	}
	if cfg.HTTPAddr != "127.0.0.1:50002" {
		t.Fatalf("http mismatch: %q", cfg.HTTPAddr)
	}
	if cfg.ShutdownTimeout != 15*time.Second {
		t.Fatalf("shutdown timeout mismatch: %s", cfg.ShutdownTimeout)
	}
	if cfg.LocalStatePath != filepath.Join(homeDir, "custom/state.json") {
		t.Fatalf("state path mismatch: %q", cfg.LocalStatePath)
	}
	if cfg.LocalModelsPath != filepath.Join(homeDir, "custom/models") {
		t.Fatalf("models path mismatch: %q", cfg.LocalModelsPath)
	}
}

func TestLoadAuthJWTFromConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.nimi.xyz",
      "audience": "nimi-runtime",
      "jwksUrl": "https://realm.nimi.xyz/api/auth/jwks",
      "revocationUrl": "https://realm.nimi.xyz/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AuthJWTIssuer != "https://realm.nimi.xyz" {
		t.Fatalf("issuer mismatch: %q", cfg.AuthJWTIssuer)
	}
	if cfg.AuthJWTAudience != "nimi-runtime" {
		t.Fatalf("audience mismatch: %q", cfg.AuthJWTAudience)
	}
	if cfg.AuthJWTJWKSURL != "https://realm.nimi.xyz/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.AuthJWTJWKSURL)
	}
	if cfg.AuthJWTRevocationURL != "https://realm.nimi.xyz/api/auth/revocation" {
		t.Fatalf("revocationUrl mismatch: %q", cfg.AuthJWTRevocationURL)
	}
}

func TestLoadAuthJWTEnvOverridesConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.config.test",
      "audience": "runtime-config",
      "jwksUrl": "https://realm.config.test/api/auth/jwks",
      "revocationUrl": "https://realm.config.test/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_ISSUER", "https://realm.env.test")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_AUDIENCE", "runtime-env")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", "https://realm.env.test/api/auth/jwks")
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL", "https://realm.env.test/api/auth/revocation")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AuthJWTIssuer != "https://realm.env.test" {
		t.Fatalf("issuer env override mismatch: %q", cfg.AuthJWTIssuer)
	}
	if cfg.AuthJWTAudience != "runtime-env" {
		t.Fatalf("audience env override mismatch: %q", cfg.AuthJWTAudience)
	}
	if cfg.AuthJWTJWKSURL != "https://realm.env.test/api/auth/jwks" {
		t.Fatalf("jwksUrl env override mismatch: %q", cfg.AuthJWTJWKSURL)
	}
	if cfg.AuthJWTRevocationURL != "https://realm.env.test/api/auth/revocation" {
		t.Fatalf("revocationUrl env override mismatch: %q", cfg.AuthJWTRevocationURL)
	}
}

func TestLoadRejectsInvalidIntegerEnvOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", "invalid")

	_, err := Load()
	if err == nil {
		t.Fatal("expected invalid integer env override to fail")
	}
	if !strings.Contains(err.Error(), "parse NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsIncompleteJWTConfig(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", "https://realm.env.test/api/auth/jwks")

	_, err := Load()
	if err == nil {
		t.Fatal("expected incomplete jwt config to fail")
	}
	if !strings.Contains(err.Error(), "requires issuer, audience, jwks url, and revocation url together") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadAllowsLoopbackHTTPJWKSURL(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "http://localhost:3002",
      "audience": "nimi-runtime",
      "jwksUrl": "http://127.0.0.1:3002/api/auth/jwks",
      "revocationUrl": "http://127.0.0.1:3002/api/auth/revocation"
    }
  }
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected loopback http jwks url to load, got: %v", err)
	}
	if cfg.AuthJWTJWKSURL != "http://127.0.0.1:3002/api/auth/jwks" {
		t.Fatalf("jwksUrl mismatch: %q", cfg.AuthJWTJWKSURL)
	}
}

func TestLoadRejectsNonLoopbackHTTPJWKSURL(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "auth": {
    "jwt": {
      "issuer": "https://realm.nimi.xyz",
      "audience": "nimi-runtime",
      "jwksUrl": "http://realm.nimi.xyz/api/auth/jwks",
      "revocationUrl": "https://realm.nimi.xyz/api/auth/revocation"
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
		t.Fatal("expected non-loopback http jwks url to fail")
	}
	if !strings.Contains(err.Error(), "auth jwt jwks url must use https unless host is loopback") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRejectsOutOfRangeNumericConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "globalConcurrencyLimit": 0
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)

	_, err := Load()
	if err == nil {
		t.Fatal("expected invalid numeric config to fail")
	}
	if !strings.Contains(err.Error(), "globalConcurrencyLimit must be between 1 and 256") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func clearRuntimeConfigEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"NIMI_RUNTIME_GRPC_ADDR",
		"NIMI_RUNTIME_HTTP_ADDR",
		"NIMI_RUNTIME_SHUTDOWN_TIMEOUT",
		"NIMI_RUNTIME_LOCAL_STATE_PATH",
		"NIMI_RUNTIME_LOCAL_MODELS_PATH",
		"NIMI_RUNTIME_DEFAULT_CLOUD_PROVIDER",
		"NIMI_RUNTIME_AI_HTTP_TIMEOUT",
		"NIMI_RUNTIME_AI_HEALTH_INTERVAL",
		"NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_LLAMA_API_KEY",
		"NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_MEDIA_API_KEY",
		"NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL",
		"NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY",
		"NIMI_RUNTIME_LOCAL_AI_BASE_URL",
		"NIMI_RUNTIME_LOCAL_AI_API_KEY",
		"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_API_KEY",
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
		"NIMI_RUNTIME_AUTH_JWT_ISSUER",
		"NIMI_RUNTIME_AUTH_JWT_AUDIENCE",
		"NIMI_RUNTIME_AUTH_JWT_JWKS_URL",
		"NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL",
		"LOCALAI_API_KEY",
		"NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT",
		"NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS",
		"NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS",
		"NIMI_RUNTIME_AI_HEALTH_INTERVAL_SECONDS",
		"NIMI_RUNTIME_AI_HTTP_TIMEOUT_SECONDS",
		"NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT",
		"NIMI_RUNTIME_PER_APP_CONCURRENCY_LIMIT",
		"NIMI_RUNTIME_IDEMPOTENCY_CAPACITY",
		"NIMI_RUNTIME_MAX_DELEGATION_DEPTH",
		"NIMI_RUNTIME_AUDIT_RING_BUFFER_SIZE",
		"NIMI_RUNTIME_USAGE_STATS_BUFFER_SIZE",
		"NIMI_RUNTIME_LOCAL_AUDIT_CAPACITY",
		"NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED",
		"NIMI_RUNTIME_ENGINE_LOCALAI_VERSION",
		"NIMI_RUNTIME_ENGINE_LOCALAI_PORT",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_MODE",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_NAME",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ADDRESS",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_COMMAND",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ARGS_JSON",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ENV_JSON",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_WORKING_DIR",
		"NIMI_RUNTIME_ENGINE_NEXA_ENABLED",
		"NIMI_RUNTIME_ENGINE_NEXA_VERSION",
		"NIMI_RUNTIME_ENGINE_NEXA_PORT",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_ENABLED",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_VERSION",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_PORT",
		"NIMI_RUNTIME_MODEL_CATALOG_REMOTE_ENABLED",
		"NIMI_RUNTIME_MODEL_CATALOG_REMOTE_URL",
		"NIMI_RUNTIME_MODEL_CATALOG_REFRESH_INTERVAL",
		"NIMI_RUNTIME_MODEL_CATALOG_CACHE_PATH",
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}

func TestLoadFileConfigMigratesMissingSchemaVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	raw := `{
  "grpcAddr": "127.0.0.1:47001",
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	fileCfg, err := LoadFileConfig(path)
	if err != nil {
		t.Fatalf("LoadFileConfig: %v", err)
	}
	if fileCfg.SchemaVersion != DefaultSchemaVersion {
		t.Fatalf("unexpected schema version: got=%d want=%d", fileCfg.SchemaVersion, DefaultSchemaVersion)
	}
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatalf("expected migration backup file, got %v", err)
	}
}

func TestMigrationIsIdempotent(t *testing.T) {
	// K-CFG-015: replaying the same migration yields the same migrated output.
	path := filepath.Join(t.TempDir(), "config.json")
	raw := `{
  "grpcAddr": "127.0.0.1:47001",
  "providers": {
    "gemini": {
      "apiKeyEnv": "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY"
    }
  }
}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	firstCfg, err := LoadFileConfig(path)
	if err != nil {
		t.Fatalf("LoadFileConfig first pass: %v", err)
	}
	firstContent, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config: %v", err)
	}

	secondCfg, err := LoadFileConfig(path)
	if err != nil {
		t.Fatalf("LoadFileConfig second pass: %v", err)
	}
	secondContent, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migrated config second pass: %v", err)
	}

	if !reflect.DeepEqual(firstCfg, secondCfg) {
		t.Fatalf("expected repeated migration loads to match: first=%+v second=%+v", firstCfg, secondCfg)
	}
	if string(firstContent) != string(secondContent) {
		t.Fatalf("expected migrated config to be idempotent across reloads")
	}
}

func TestConfigDefaultsMatchSpec(t *testing.T) {
	// Verify that Load() defaults match the spec values from config-schema.yaml.
	// The spec values are embedded directly as a truth table rather than parsing
	// YAML, so any drift between code defaults and schema spec fails this test.
	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	type specEntry struct {
		field string
		got   any
		want  any
	}

	table := []specEntry{
		{"grpcAddr", cfg.GRPCAddr, "127.0.0.1:46371"},
		{"httpAddr", cfg.HTTPAddr, "127.0.0.1:46372"},
		{"globalConcurrencyLimit", cfg.GlobalConcurrencyLimit, 8},
		{"perAppConcurrencyLimit", cfg.PerAppConcurrencyLimit, 2},
		{"idempotencyCapacity", cfg.IdempotencyCapacity, 10000},
		{"maxDelegationDepth", cfg.MaxDelegationDepth, 3},
		{"auditRingBufferSize", cfg.AuditRingBufferSize, 20000},
		{"usageStatsBufferSize", cfg.UsageStatsBufferSize, 50000},
		{"localAuditCapacity", cfg.LocalAuditCapacity, 5000},
		{"sessionTtlMinSeconds", cfg.SessionTTLMinSeconds, 60},
		{"sessionTtlMaxSeconds", cfg.SessionTTLMaxSeconds, 86400},
		{"aiHealthIntervalSeconds", cfg.AIHealthIntervalSeconds, 8},
		{"aiHttpTimeoutSeconds", cfg.AIHTTPTimeoutSeconds, 30},
		{"allowLoopbackProviderEndpoint", cfg.AllowLoopbackProviderEndpoint, false},
		{"engineLlamaEnabled", cfg.EngineLlamaEnabled, false},
		{"engineMediaEnabled", cfg.EngineMediaEnabled, false},
	}

	for _, tc := range table {
		if !reflect.DeepEqual(tc.got, tc.want) {
			t.Errorf("spec alignment %s: got=%v want=%v", tc.field, tc.got, tc.want)
		}
	}
}

func TestRejectLegacyLocalRuntimeEnvIncludesMigrationHints(t *testing.T) {
	clearRuntimeConfigEnv(t)

	testCases := []struct {
		name    string
		key     string
		value   string
		substrs []string
	}{
		{
			name:    "local ai base url",
			key:     "NIMI_RUNTIME_LOCAL_AI_BASE_URL",
			value:   "http://127.0.0.1:1234/v1",
			substrs: []string{"NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "no longer supported"},
		},
		{
			name:    "nimi media base url",
			key:     "NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL",
			value:   "http://127.0.0.1:8321/v1",
			substrs: []string{"NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", "no longer supported"},
		},
		{
			name:    "nexa removed",
			key:     "NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
			value:   "http://127.0.0.1:8001/v1",
			substrs: []string{"removed", "migrate to llama/media providers"},
		},
		{
			name:    "localai image backend removed",
			key:     "NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_MODE",
			value:   "official",
			substrs: []string{"image-backend", "removed"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			clearRuntimeConfigEnv(t)
			t.Setenv(tc.key, tc.value)
			err := rejectLegacyLocalRuntimeEnv()
			if err == nil {
				t.Fatalf("expected legacy env %s to be rejected", tc.key)
			}
			message := err.Error()
			for _, substr := range tc.substrs {
				if !strings.Contains(message, substr) {
					t.Fatalf("expected error %q to contain %q", message, substr)
				}
			}
		})
	}
}
