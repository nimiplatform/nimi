package config

import (
	"os"
	"path/filepath"
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
	if cfg.LocalModelsPath != "" {
		t.Fatalf("models path should fail closed without dataRootRef: got=%q", cfg.LocalModelsPath)
	}
	if cfg.DataRootRef != "" {
		t.Fatalf("dataRootRef default mismatch: got=%q want empty", cfg.DataRootRef)
	}
	if cfg.ManagedRoots.Models != "" {
		t.Fatalf("managed models root should fail closed without dataRootRef: got=%q", cfg.ManagedRoots.Models)
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
	if cfg.AppRegistryPath != "" {
		t.Fatalf("app registry path should default empty, got=%q", cfg.AppRegistryPath)
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
  "dataRootRef": "~/runtime/nimi-data",
  "managedRoots": {
    "models": "~/runtime/nimi-data/custom-models"
  },
  "appRegistryPath": "~/runtime/nimi-app-registry.yaml",
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
	if cfg.DataRootRef != filepath.Join(homeDir, "runtime/nimi-data") {
		t.Fatalf("dataRootRef mismatch: %q", cfg.DataRootRef)
	}
	if cfg.LocalModelsPath != filepath.Join(homeDir, "runtime/nimi-data/custom-models") {
		t.Fatalf("local models path mismatch: %q", cfg.LocalModelsPath)
	}
	if cfg.AppRegistryPath != filepath.Join(homeDir, "runtime/nimi-app-registry.yaml") {
		t.Fatalf("app registry path mismatch: %q", cfg.AppRegistryPath)
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
	if got := strings.TrimSpace(target.APIKeyEnv); got != "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY" {
		t.Fatalf("gemini key env mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.APIKey); got != "" {
		t.Fatalf("env-backed provider must not retain resolved key material in config target: %q", got)
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
	if got := strings.TrimSpace(target.APIKeyEnv); got != "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY" {
		t.Fatalf("gemini key env should keep env override source: %q", got)
	}
	if got := strings.TrimSpace(target.APIKey); got != "" {
		t.Fatalf("env override must not persist resolved key material in config target: %q", got)
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

func TestLoadRejectsNestedRuntimeConfigSchema(t *testing.T) {
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

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "nested runtime object is removed") {
		t.Fatalf("expected nested runtime config rejection, got %v", err)
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

func TestProviderEnvBindingsFollowProbeTargetFactSource(t *testing.T) {
	expected := readProviderProbeTargetBindingsForTest(t)
	actual := make(map[string]providerEnvBinding, len(providerEnvBindings))
	for _, binding := range providerEnvBindings {
		actual[binding.canonicalID] = binding
	}
	if len(actual) != len(expected) {
		t.Fatalf("provider env binding count mismatch: got=%d want=%d actual=%v expected=%v", len(actual), len(expected), actual, expected)
	}
	for providerID, want := range expected {
		got, ok := actual[providerID]
		if !ok {
			t.Fatalf("missing provider env binding for %s", providerID)
		}
		if got.baseURLKey != want.baseURLKey || got.apiKeyKey != want.apiKeyKey {
			t.Fatalf("provider env binding mismatch for %s: got=%+v want=%+v", providerID, got, want)
		}
	}
}

func TestResolveCloudProvidersIgnoresRegistryOnlyEnvWithoutProbeTarget(t *testing.T) {
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY", "anthropic-key")
	t.Setenv("NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")

	targets := ResolveCloudProviderTargets(nil)
	for _, target := range targets {
		if target.CanonicalID == "anthropic" {
			t.Fatalf("registry-only provider env binding was admitted without probe-target fact source: %+v", target)
		}
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

	legacyPath := filepath.Join(homeDir, ".nimi/config.json")
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
	if _, statErr := os.Stat(filepath.Join(homeDir, ".nimi/runtime/config.json")); !os.IsNotExist(statErr) {
		t.Fatalf("canonical config should not be auto-created")
	}
}

func readProviderProbeTargetBindingsForTest(t *testing.T) map[string]providerEnvBinding {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", ".nimi", "spec", "runtime", "kernel", "tables", "provider-probe-targets.yaml"))
	if err != nil {
		t.Fatalf("read provider probe targets: %v", err)
	}
	type target struct {
		name       string
		category   string
		baseURLKey string
		apiKeyKey  string
	}
	out := make(map[string]providerEnvBinding)
	current := target{}
	flush := func() {
		if current.category != "cloud" {
			current = target{}
			return
		}
		if current.name == "" || !strings.HasPrefix(current.name, "cloud-") {
			t.Fatalf("cloud provider probe target must use cloud-* name: %+v", current)
		}
		if !strings.HasPrefix(current.baseURLKey, "NIMI_RUNTIME_") || !strings.HasPrefix(current.apiKeyKey, "NIMI_RUNTIME_") {
			t.Fatalf("cloud provider probe target must use concrete runtime env keys: %+v", current)
		}
		providerID := strings.ReplaceAll(strings.TrimPrefix(current.name, "cloud-"), "-", "_")
		out[providerID] = providerEnvBinding{
			canonicalID: providerID,
			baseURLKey:  current.baseURLKey,
			apiKeyKey:   current.apiKeyKey,
		}
		current = target{}
	}
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- name: ") {
			flush()
			current.name = strings.TrimSpace(strings.TrimPrefix(trimmed, "- name: "))
			continue
		}
		if strings.HasPrefix(trimmed, "base_url_env: ") {
			current.baseURLKey = strings.TrimSpace(strings.TrimPrefix(trimmed, "base_url_env: "))
			continue
		}
		if strings.HasPrefix(trimmed, "api_key_env: ") {
			current.apiKeyKey = strings.TrimSpace(strings.TrimPrefix(trimmed, "api_key_env: "))
			continue
		}
		if strings.HasPrefix(trimmed, "category: ") {
			current.category = strings.TrimSpace(strings.TrimPrefix(trimmed, "category: "))
			continue
		}
	}
	flush()
	return out
}
