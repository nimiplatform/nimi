package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// Load resolves configuration from environment with sane defaults.
// Priority: env var > FileConfig field > default value. (K-DAEMON-009)
func Load() (Config, error) {
	if err := rejectRemovedModelCatalogRemoteEnv(); err != nil {
		return Config{}, err
	}
	if err := rejectLegacyLocalRuntimeEnv(); err != nil {
		return Config{}, err
	}
	fileCfg, err := loadRuntimeFileConfig()
	if err != nil {
		return Config{}, err
	}
	resolvedProviders := resolveCloudProviders(fileCfg.Providers)

	llamaEnabledFromFile := fileConfigEngineBool(fileCfg, "llama")
	llamaPortFromFile := fileConfigEngineInt(fileCfg, "llama", "port")
	mediaEnabledFromFile := fileConfigEngineBool(fileCfg, "media")
	mediaPortFromFile := fileConfigEngineInt(fileCfg, "media", "port")
	speechEnabledFromFile := fileConfigEngineBool(fileCfg, "speech")
	speechPortFromFile := fileConfigEngineInt(fileCfg, "speech", "port")

	sessionTTLMinSeconds, err := readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS", fileCfg.SessionTTLMinSeconds, 60)
	if err != nil {
		return Config{}, err
	}
	sessionTTLMaxSeconds, err := readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS", fileCfg.SessionTTLMaxSeconds, 86400)
	if err != nil {
		return Config{}, err
	}
	aiHealthIntervalSeconds, err := readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HEALTH_INTERVAL_SECONDS", fileCfg.AIHealthIntervalSeconds, 8)
	if err != nil {
		return Config{}, err
	}
	aiHTTPTimeoutSeconds, err := readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HTTP_TIMEOUT_SECONDS", fileCfg.AIHTTPTimeoutSeconds, 30)
	if err != nil {
		return Config{}, err
	}
	globalConcurrencyLimit, err := readIntWithFileConfigFallback("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", fileCfg.GlobalConcurrencyLimit, 8)
	if err != nil {
		return Config{}, err
	}
	perAppConcurrencyLimit, err := readIntWithFileConfigFallback("NIMI_RUNTIME_PER_APP_CONCURRENCY_LIMIT", fileCfg.PerAppConcurrencyLimit, 2)
	if err != nil {
		return Config{}, err
	}
	idempotencyCapacity, err := readIntWithFileConfigFallback("NIMI_RUNTIME_IDEMPOTENCY_CAPACITY", fileCfg.IdempotencyCapacity, 10000)
	if err != nil {
		return Config{}, err
	}
	maxDelegationDepth, err := readIntWithFileConfigFallback("NIMI_RUNTIME_MAX_DELEGATION_DEPTH", fileCfg.MaxDelegationDepth, 3)
	if err != nil {
		return Config{}, err
	}
	auditRingBufferSize, err := readIntWithFileConfigFallback("NIMI_RUNTIME_AUDIT_RING_BUFFER_SIZE", fileCfg.AuditRingBufferSize, 20000)
	if err != nil {
		return Config{}, err
	}
	usageStatsBufferSize, err := readIntWithFileConfigFallback("NIMI_RUNTIME_USAGE_STATS_BUFFER_SIZE", fileCfg.UsageStatsBufferSize, 50000)
	if err != nil {
		return Config{}, err
	}
	localAuditCapacity, err := readIntWithFileConfigFallback("NIMI_RUNTIME_LOCAL_AUDIT_CAPACITY", fileCfg.LocalAuditCapacity, 5000)
	if err != nil {
		return Config{}, err
	}
	engineLlamaPort, err := readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LLAMA_PORT", llamaPortFromFile, 1234)
	if err != nil {
		return Config{}, err
	}
	engineMediaPort, err := readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_MEDIA_PORT", mediaPortFromFile, 8321)
	if err != nil {
		return Config{}, err
	}
	engineSpeechPort, err := readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_SPEECH_PORT", speechPortFromFile, 8330)
	if err != nil {
		return Config{}, err
	}
	engineSidecarPort, err := readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_SIDECAR_PORT", nil, 0)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		GRPCAddr:                readString("NIMI_RUNTIME_GRPC_ADDR", nimillm.FirstNonEmpty(fileCfg.GRPCAddr, defaultGRPCAddr)),
		HTTPAddr:                readString("NIMI_RUNTIME_HTTP_ADDR", nimillm.FirstNonEmpty(fileCfg.HTTPAddr, defaultHTTPAddr)),
		ShutdownTimeout:         10 * time.Second,
		LocalStatePath:          resolveLocalStatePath(fileCfg),
		LocalModelsPath:         resolveLocalModelsPath(fileCfg),
		DefaultLocalTextModel:   readStringWithFileConfigFallback("NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL", fileCfg.DefaultLocalTextModel, ""),
		DefaultCloudProvider:    normalizeDefaultCloudProvider(readStringWithFileConfigFallback("NIMI_RUNTIME_DEFAULT_CLOUD_PROVIDER", fileCfg.DefaultCloudProvider, "")),
		SessionTTLMinSeconds:    sessionTTLMinSeconds,
		SessionTTLMaxSeconds:    sessionTTLMaxSeconds,
		AIHealthIntervalSeconds: aiHealthIntervalSeconds,
		AIHTTPTimeoutSeconds:    aiHTTPTimeoutSeconds,
		ModelCatalogCustomDir:   resolveModelCatalogCustomDir(fileCfg),
		GlobalConcurrencyLimit:  globalConcurrencyLimit,
		PerAppConcurrencyLimit:  perAppConcurrencyLimit,
		IdempotencyCapacity:     idempotencyCapacity,
		MaxDelegationDepth:      maxDelegationDepth,
		AuditRingBufferSize:     auditRingBufferSize,
		UsageStatsBufferSize:    usageStatsBufferSize,
		LocalAuditCapacity:      localAuditCapacity,
		LogLevel:                readStringWithFileConfigFallback("NIMI_RUNTIME_LOG_LEVEL", fileCfg.LogLevel, "info"),
		AuthJWTIssuer:           readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_ISSUER", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Issuer }), ""),
		AuthJWTAudience:         readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_AUDIENCE", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Audience }), ""),
		AuthJWTJWKSURL:          readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.JWKSURL }), ""),
		AuthJWTRevocationURL:    readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_REVOCATION_URL", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.RevocationURL }), ""),
		Providers:               resolvedProviders,
		EngineLlamaVersion:      readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LLAMA_VERSION", fileConfigEngineString(fileCfg, "llama", "version"), "b8575"),
		EngineLlamaPort:         engineLlamaPort,
		EngineMediaVersion:      readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_MEDIA_VERSION", fileConfigEngineString(fileCfg, "media", "version"), "0.1.0"),
		EngineMediaPort:         engineMediaPort,
		EngineSpeechVersion:     readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_SPEECH_VERSION", fileConfigEngineString(fileCfg, "speech", "version"), "0.1.0"),
		EngineSpeechPort:        engineSpeechPort,
		EngineSidecarVersion:    readString("NIMI_RUNTIME_ENGINE_SIDECAR_VERSION", ""),
		EngineSidecarPort:       engineSidecarPort,
	}
	cfg.AllowLoopbackProviderEndpoint, err = readBoolWithFileConfigFallback("NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT", nil, false)
	if err != nil {
		return Config{}, err
	}
	cfg.EngineLlamaEnabled, err = readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LLAMA_ENABLED", llamaEnabledFromFile, false)
	if err != nil {
		return Config{}, err
	}
	cfg.EngineMediaEnabled, err = readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_MEDIA_ENABLED", mediaEnabledFromFile, false)
	if err != nil {
		return Config{}, err
	}
	cfg.EngineSpeechEnabled, err = readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_SPEECH_ENABLED", speechEnabledFromFile, false)
	if err != nil {
		return Config{}, err
	}
	cfg.EngineSidecarEnabled, err = readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_SIDECAR_ENABLED", nil, false)
	if err != nil {
		return Config{}, err
	}

	localBaseURL := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL"))
	llamaEnabledExplicit := llamaEnabledFromFile != nil || isBoolEnvValueExplicit("NIMI_RUNTIME_ENGINE_LLAMA_ENABLED")
	llamaPortExplicit := llamaPortFromFile != nil || isIntEnvValueExplicit("NIMI_RUNTIME_ENGINE_LLAMA_PORT")

	if inferredPort, autoManaged := inferLoopbackLocalPort(localBaseURL, 1234); autoManaged && llamaSupervisedPlatformSupported() {
		if !llamaEnabledExplicit {
			cfg.EngineLlamaEnabled = true
			cfg.EngineLlamaAutoManaged = true
		}
		if cfg.EngineLlamaEnabled && !llamaPortExplicit {
			cfg.EngineLlamaPort = inferredPort
		}
	}

	if cfg.EngineLlamaEnabled && !llamaSupervisedPlatformSupported() {
		cfg.EngineLlamaEnabled = false
		cfg.EngineLlamaAutoManaged = false
	}
	if cfg.EngineMediaEnabled && !mediaSupervisedPlatformSupported() {
		cfg.EngineMediaEnabled = false
	}

	shutdownTimeoutRaw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_SHUTDOWN_TIMEOUT"))
	if shutdownTimeoutRaw != "" {
		d, parseErr := time.ParseDuration(shutdownTimeoutRaw)
		if parseErr != nil {
			return Config{}, fmt.Errorf("parse NIMI_RUNTIME_SHUTDOWN_TIMEOUT: %w", parseErr)
		}
		cfg.ShutdownTimeout = d
	} else if fileCfg.ShutdownTimeoutSeconds != nil {
		cfg.ShutdownTimeout = time.Duration(*fileCfg.ShutdownTimeoutSeconds) * time.Second
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// readIntWithFileConfigFallback implements three-level fallback: env > fileConfig > default.
func readIntWithFileConfigFallback(envKey string, fileValue *int, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil {
			return 0, fmt.Errorf("parse %s: %w", envKey, err)
		}
		return value, nil
	}
	if fileValue != nil {
		return *fileValue, nil
	}
	return fallback, nil
}

// readBoolWithFileConfigFallback implements three-level fallback: env > fileConfig > default.
func readBoolWithFileConfigFallback(envKey string, fileValue *bool, fallback bool) (bool, error) {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(envKey)))
	switch raw {
	case "true", "1", "yes":
		return true, nil
	case "false", "0", "no":
		return false, nil
	case "":
		if fileValue != nil {
			return *fileValue, nil
		}
		return fallback, nil
	default:
		return false, fmt.Errorf("parse %s: invalid boolean %q", envKey, raw)
	}
}

func isBoolEnvValueExplicit(envKey string) bool {
	raw, ok := os.LookupEnv(envKey)
	if !ok {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "true", "1", "yes", "false", "0", "no":
		return true
	default:
		return false
	}
}

func isIntEnvValueExplicit(envKey string) bool {
	raw, ok := os.LookupEnv(envKey)
	if !ok {
		return false
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	_, err := strconv.Atoi(raw)
	return err == nil
}

func rejectRemovedModelCatalogRemoteEnv() error {
	removedKeys := []string{
		"NIMI_RUNTIME_MODEL_CATALOG_REMOTE_ENABLED",
		"NIMI_RUNTIME_MODEL_CATALOG_REMOTE_URL",
		"NIMI_RUNTIME_MODEL_CATALOG_REFRESH_INTERVAL",
		"NIMI_RUNTIME_MODEL_CATALOG_CACHE_PATH",
	}
	for _, key := range removedKeys {
		if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
			return fmt.Errorf("%s is removed; non-scenario catalog metadata is YAML-only", key)
		}
	}
	return nil
}

func inferLoopbackLocalPort(baseURL string, fallbackPort int) (int, bool) {
	parsed, ok := parseProviderEndpointURL(baseURL)
	if !ok {
		return 0, false
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" {
		return 0, false
	}
	if host != "localhost" {
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			return 0, false
		}
	}
	if portValue := strings.TrimSpace(parsed.Port()); portValue != "" {
		if port, err := strconv.Atoi(portValue); err == nil && port > 0 {
			return port, true
		}
	}
	return fallbackPort, true
}

func parseProviderEndpointURL(raw string) (*url.URL, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, false
	}
	if strings.TrimSpace(parsed.Hostname()) != "" {
		return parsed, true
	}
	if strings.Contains(trimmed, "://") {
		return nil, false
	}
	fallback, err := url.Parse("http://" + trimmed)
	if err != nil || strings.TrimSpace(fallback.Hostname()) == "" {
		return nil, false
	}
	return fallback, true
}

func rejectLegacyLocalRuntimeEnv() error {
	legacyMessages := map[string]string{
		"NIMI_RUNTIME_LOCAL_AI_BASE_URL":                        "use NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL instead",
		"NIMI_RUNTIME_LOCAL_AI_API_KEY":                         "use NIMI_RUNTIME_LOCAL_LLAMA_API_KEY instead",
		"NIMI_RUNTIME_LOCAL_NEXA_BASE_URL":                      "Nexa support was removed; clear this variable and migrate to llama/media providers",
		"NIMI_RUNTIME_LOCAL_NEXA_API_KEY":                       "Nexa support was removed; clear this variable and migrate to llama/media providers",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL":                "use NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL instead",
		"NIMI_RUNTIME_LOCAL_NIMI_MEDIA_API_KEY":                 "use NIMI_RUNTIME_LOCAL_MEDIA_API_KEY instead",
		"NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED":                   "use NIMI_RUNTIME_ENGINE_LLAMA_ENABLED instead",
		"NIMI_RUNTIME_ENGINE_LOCALAI_VERSION":                   "use NIMI_RUNTIME_ENGINE_LLAMA_VERSION instead",
		"NIMI_RUNTIME_ENGINE_LOCALAI_PORT":                      "use NIMI_RUNTIME_ENGINE_LLAMA_PORT instead",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_MODE":        "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_NAME":        "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ADDRESS":     "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_COMMAND":     "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ARGS_JSON":   "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ENV_JSON":    "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_WORKING_DIR": "the LocalAI image-backend config surface was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_NEXA_ENABLED":                      "Nexa engine support was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_NEXA_VERSION":                      "Nexa engine support was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_NEXA_PORT":                         "Nexa engine support was removed; clear this variable",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_ENABLED":                "use NIMI_RUNTIME_ENGINE_MEDIA_ENABLED instead",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_VERSION":                "use NIMI_RUNTIME_ENGINE_MEDIA_VERSION instead",
		"NIMI_RUNTIME_ENGINE_NIMI_MEDIA_PORT":                   "use NIMI_RUNTIME_ENGINE_MEDIA_PORT instead",
	}
	for key, hint := range legacyMessages {
		if value, ok := os.LookupEnv(key); ok && strings.TrimSpace(value) != "" {
			return fmt.Errorf("%s is no longer supported; %s", key, hint)
		}
	}
	return nil
}

// readStringWithFileConfigFallback implements three-level fallback: env > fileConfig > default.
func readStringWithFileConfigFallback(envKey string, fileValue string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	if strings.TrimSpace(fileValue) != "" {
		return fileValue
	}
	return fallback
}

func readString(envKey string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	return fallback
}

func normalizeDefaultCloudProvider(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if canonical, ok := ResolveCanonicalProviderID(trimmed); ok {
		return canonical
	}
	return trimmed
}
