package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadRejectsNestedRuntimeObjectAtCanonicalPath(t *testing.T) {
	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", "")
	clearRuntimeConfigEnv(t)

	configPath := filepath.Join(homeDir, ".nimi", "runtime", "config.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("mkdir canonical config dir: %v", err)
	}
	body := `{"schemaVersion":1,"runtime":{"grpcAddr":"127.0.0.1:59001"}}`
	if err := os.WriteFile(configPath, []byte(body), 0o600); err != nil {
		t.Fatalf("write nested runtime config: %v", err)
	}

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "nested runtime object is removed") {
		t.Fatalf("expected nested runtime object rejection, got %v", err)
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
	if got := strings.TrimSpace(target.APIKeyEnv); got != "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY" {
		t.Fatalf("gemini key env mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.APIKey); got != "" {
		t.Fatalf("env-only provider must not retain resolved key material in config target: %q", got)
	}
	if got := strings.TrimSpace(target.BaseURL); got != defaultCloudGeminiBaseURL {
		t.Fatalf("gemini default base mismatch: %q", got)
	}
}

func TestLoadAppliesCatalogDefaultBaseURLForRegistryProvider(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", filepath.Join(t.TempDir(), "missing-config.json"))
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY", "deepseek-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	target, ok := cfg.Providers["deepseek"]
	if !ok {
		t.Fatalf("expected env-only deepseek provider to be resolved")
	}
	if got := strings.TrimSpace(ResolveProviderAPIKey(target)); got != "deepseek-key" {
		t.Fatalf("deepseek key mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.APIKeyEnv); got != "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY" {
		t.Fatalf("deepseek key env mismatch: %q", got)
	}
	if got := strings.TrimSpace(target.APIKey); got != "" {
		t.Fatalf("env-only provider must not retain resolved key material in config target: %q", got)
	}
	if got := strings.TrimSpace(target.BaseURL); got != "https://api.deepseek.com/v1" {
		t.Fatalf("deepseek default base mismatch: %q", got)
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

func TestResolveCanonicalProviderIDSupportsRegistryRemoteProviders(t *testing.T) {
	if id, ok := ResolveCanonicalProviderID("stepfun"); !ok || id != "stepfun" {
		t.Fatalf("stepfun canonical resolve mismatch: id=%q ok=%v", id, ok)
	}
	if id, ok := ResolveCanonicalProviderID("together"); !ok || id != "together" {
		t.Fatalf("together canonical resolve mismatch: id=%q ok=%v", id, ok)
	}
	if id, ok := ResolveCanonicalProviderID("local"); ok || id != "" {
		t.Fatalf("local must not resolve as cloud provider")
	}
}

func TestLoadAcceptsRegistryDrivenCanonicalProviderNameInConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "defaultCloudProvider": "together",
  "providers": {
    "together": {
      "baseUrl": "https://api.together.xyz/v1",
      "apiKey": "together-inline-key"
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
	if cfg.DefaultCloudProvider != "together" {
		t.Fatalf("defaultCloudProvider mismatch: %q", cfg.DefaultCloudProvider)
	}
	target, ok := cfg.Providers["together"]
	if !ok {
		t.Fatalf("expected together provider to be loaded")
	}
	if got := strings.TrimSpace(target.BaseURL); got != "https://api.together.xyz/v1" {
		t.Fatalf("together base mismatch: %q", got)
	}
	if got := strings.TrimSpace(ResolveProviderAPIKey(target)); got != "together-inline-key" {
		t.Fatalf("together key mismatch: %q", got)
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
  "dataRootRef": "~/custom/nimi-data",
  "managedRoots": {
    "models": "~/custom/nimi-data/models"
  }
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
	if cfg.DataRootRef != filepath.Join(homeDir, "custom/nimi-data") {
		t.Fatalf("dataRootRef mismatch: %q", cfg.DataRootRef)
	}
	if cfg.LocalModelsPath != filepath.Join(homeDir, "custom/nimi-data/models") {
		t.Fatalf("models path mismatch: %q", cfg.LocalModelsPath)
	}
}

func TestLoadAppRegistryPathEnvOverridesFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "runtime-config.json")
	configBody := `{
  "schemaVersion": 1,
  "appRegistryPath": "~/from-file/nimi-app-registry.yaml"
}`
	if err := os.WriteFile(configPath, []byte(configBody), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	homeDir := t.TempDir()
	setRuntimeTestHome(t, homeDir)
	t.Setenv("NIMI_RUNTIME_CONFIG_PATH", configPath)
	clearRuntimeConfigEnv(t)
	t.Setenv("NIMI_RUNTIME_APP_REGISTRY_PATH", "~/from-env/nimi-app-registry.yaml")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.AppRegistryPath != filepath.Join(homeDir, "from-env/nimi-app-registry.yaml") {
		t.Fatalf("app registry env override mismatch: %q", cfg.AppRegistryPath)
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
		"NIMI_RUNTIME_APP_REGISTRY_PATH",
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
		"NIMI_RUNTIME_AUTH_JWT_ISSUER",
		"NIMI_RUNTIME_AUTH_JWT_AUDIENCE",
		"NIMI_RUNTIME_AUTH_JWT_JWKS_URL",
		"NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL",
		"NIMI_RUNTIME_ACCOUNT_REALM_BASE_URL",
		"NIMI_RUNTIME_ACCOUNT_AUTHORIZATION_URL",
		"NIMI_RUNTIME_ACCOUNT_TOKEN_URL",
		"SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET",
		"NIMI_REALM_URL",
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
	for _, binding := range providerEnvBindings {
		keys = append(keys, binding.baseURLKey, binding.apiKeyKey)
	}
	for _, key := range keys {
		t.Setenv(key, "")
	}
}

func TestLoadFileConfigRejectsMissingSchemaVersion(t *testing.T) {
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

	if _, err := LoadFileConfig(path); err == nil || !strings.Contains(err.Error(), "schemaVersion must be 1") {
		t.Fatalf("expected missing schemaVersion rejection, got %v", err)
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
