package config

import (
	"encoding/json"
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
	fileCfg, err := loadRuntimeFileConfig()
	if err != nil {
		return Config{}, err
	}
	applyProviderEnvDefaults(fileCfg)
	applyImplicitProviderDefaults()

	localAIEnabledFromFile := fileConfigEngineBool(fileCfg, "localai")
	localAIPortFromFile := fileConfigEngineInt(fileCfg, "localai", "port")
	nexaEnabledFromFile := fileConfigEngineBool(fileCfg, "nexa")
	nexaPortFromFile := fileConfigEngineInt(fileCfg, "nexa", "port")

	cfg := Config{
		GRPCAddr:                      readString("NIMI_RUNTIME_GRPC_ADDR", nimillm.FirstNonEmpty(fileCfg.GRPCAddr, defaultGRPCAddr)),
		HTTPAddr:                      readString("NIMI_RUNTIME_HTTP_ADDR", nimillm.FirstNonEmpty(fileCfg.HTTPAddr, defaultHTTPAddr)),
		ShutdownTimeout:               10 * time.Second,
		LocalStatePath:                resolveLocalStatePath(fileCfg),
		LocalModelsPath:               resolveLocalModelsPath(fileCfg),
		DefaultLocalTextModel:         readStringWithFileConfigFallback("NIMI_RUNTIME_DEFAULT_LOCAL_TEXT_MODEL", fileCfg.DefaultLocalTextModel, ""),
		DefaultCloudProvider:          strings.TrimSpace(fileCfg.DefaultCloudProvider),
		AllowLoopbackProviderEndpoint: readBoolWithFileConfigFallback("NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT", nil, false),
		SessionTTLMinSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS", fileCfg.SessionTTLMinSeconds, 60),
		SessionTTLMaxSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS", fileCfg.SessionTTLMaxSeconds, 86400),
		AIHealthIntervalSeconds:       readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HEALTH_INTERVAL_SECONDS", fileCfg.AIHealthIntervalSeconds, 8),
		AIHTTPTimeoutSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HTTP_TIMEOUT_SECONDS", fileCfg.AIHTTPTimeoutSeconds, 30),
		ModelCatalogCustomDir:         resolveModelCatalogCustomDir(fileCfg),
		GlobalConcurrencyLimit:        readIntWithFileConfigFallback("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", fileCfg.GlobalConcurrencyLimit, 8),
		PerAppConcurrencyLimit:        readIntWithFileConfigFallback("NIMI_RUNTIME_PER_APP_CONCURRENCY_LIMIT", fileCfg.PerAppConcurrencyLimit, 2),
		IdempotencyCapacity:           readIntWithFileConfigFallback("NIMI_RUNTIME_IDEMPOTENCY_CAPACITY", fileCfg.IdempotencyCapacity, 10000),
		MaxDelegationDepth:            readIntWithFileConfigFallback("NIMI_RUNTIME_MAX_DELEGATION_DEPTH", fileCfg.MaxDelegationDepth, 3),
		AuditRingBufferSize:           readIntWithFileConfigFallback("NIMI_RUNTIME_AUDIT_RING_BUFFER_SIZE", fileCfg.AuditRingBufferSize, 20000),
		UsageStatsBufferSize:          readIntWithFileConfigFallback("NIMI_RUNTIME_USAGE_STATS_BUFFER_SIZE", fileCfg.UsageStatsBufferSize, 50000),
		LocalAuditCapacity:            readIntWithFileConfigFallback("NIMI_RUNTIME_LOCAL_AUDIT_CAPACITY", fileCfg.LocalAuditCapacity, 5000),
		LogLevel:                      readStringWithFileConfigFallback("NIMI_RUNTIME_LOG_LEVEL", fileCfg.LogLevel, "info"),
		AuthJWTIssuer:                 readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_ISSUER", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Issuer }), ""),
		AuthJWTAudience:               readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_AUDIENCE", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Audience }), ""),
		AuthJWTJWKSURL:                readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_JWKS_URL", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.JWKSURL }), ""),
		Providers:                     fileCfg.Providers,
		EngineLocalAIEnabled:          readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED", localAIEnabledFromFile, false),
		EngineLocalAIVersion:          readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_VERSION", fileConfigEngineString(fileCfg, "localai", "version"), "3.12.1"),
		EngineLocalAIPort:             readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_PORT", localAIPortFromFile, 1234),
		EngineLocalAIImageBackendMode: readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_MODE", fileConfigLocalAIImageBackendString(fileCfg, "mode"), defaultLocalAIImageBackendMode()),
		EngineLocalAIImageBackendName: readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_NAME", fileConfigLocalAIImageBackendString(fileCfg, "backendName"), "stablediffusion-ggml"),
		EngineLocalAIImageBackendAddress: readStringWithFileConfigFallback(
			"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ADDRESS",
			fileConfigLocalAIImageBackendString(fileCfg, "address"),
			"127.0.0.1:50052",
		),
		EngineLocalAIImageBackendCommand: readStringWithFileConfigFallback(
			"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_COMMAND",
			fileConfigLocalAIImageBackendString(fileCfg, "command"),
			"",
		),
		EngineLocalAIImageBackendWorkingDir: readStringWithFileConfigFallback(
			"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_WORKING_DIR",
			fileConfigLocalAIImageBackendString(fileCfg, "workingDir"),
			"",
		),
		EngineNexaEnabled: readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_ENABLED", nexaEnabledFromFile, false),
		EngineNexaVersion: readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_VERSION", fileConfigEngineString(fileCfg, "nexa", "version"), ""),
		EngineNexaPort:    readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_PORT", nexaPortFromFile, 8000),
	}

	imageBackendArgs, err := readStringSliceJSONWithFileConfigFallback(
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ARGS_JSON",
		fileConfigLocalAIImageBackendArgs(fileCfg),
	)
	if err != nil {
		return Config{}, fmt.Errorf("parse localai image backend args: %w", err)
	}
	cfg.EngineLocalAIImageBackendArgs = imageBackendArgs

	imageBackendEnv, err := readStringMapJSONWithFileConfigFallback(
		"NIMI_RUNTIME_ENGINE_LOCALAI_IMAGE_BACKEND_ENV_JSON",
		fileConfigLocalAIImageBackendEnv(fileCfg),
	)
	if err != nil {
		return Config{}, fmt.Errorf("parse localai image backend env: %w", err)
	}
	cfg.EngineLocalAIImageBackendEnv = imageBackendEnv

	localBaseURL := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_AI_BASE_URL"))
	localAIEnabledExplicit := localAIEnabledFromFile != nil || isBoolEnvValueExplicit("NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED")
	localAIPortExplicit := localAIPortFromFile != nil || isIntEnvValueExplicit("NIMI_RUNTIME_ENGINE_LOCALAI_PORT")

	if inferredPort, autoManaged := inferLoopbackLocalAIPort(localBaseURL); autoManaged && localAISupervisedPlatformSupported() {
		if !localAIEnabledExplicit {
			cfg.EngineLocalAIEnabled = true
			cfg.EngineLocalAIAutoManaged = true
		}
		if cfg.EngineLocalAIEnabled && !localAIPortExplicit {
			cfg.EngineLocalAIPort = inferredPort
		}
	}

	if cfg.EngineLocalAIEnabled && !localAISupervisedPlatformSupported() {
		cfg.EngineLocalAIEnabled = false
		cfg.EngineLocalAIAutoManaged = false
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
func readIntWithFileConfigFallback(envKey string, fileValue *int, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw != "" {
		if value, err := strconv.Atoi(raw); err == nil {
			return value
		}
	}
	if fileValue != nil {
		return *fileValue
	}
	return fallback
}

// readBoolWithFileConfigFallback implements three-level fallback: env > fileConfig > default.
func readBoolWithFileConfigFallback(envKey string, fileValue *bool, fallback bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(envKey)))
	switch raw {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		if fileValue != nil {
			return *fileValue
		}
		return fallback
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

func inferLoopbackLocalAIPort(baseURL string) (int, bool) {
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
	return 1234, true
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

func readStringSliceJSONWithFileConfigFallback(envKey string, fileValue []string) ([]string, error) {
	if raw := strings.TrimSpace(os.Getenv(envKey)); raw != "" {
		var parsed []string
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, err
		}
		return normalizeStringSlice(parsed), nil
	}
	return normalizeStringSlice(fileValue), nil
}

func readStringMapJSONWithFileConfigFallback(envKey string, fileValue map[string]string) (map[string]string, error) {
	if raw := strings.TrimSpace(os.Getenv(envKey)); raw != "" {
		parsed := make(map[string]string)
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, err
		}
		return normalizeStringMap(parsed), nil
	}
	return normalizeStringMap(fileValue), nil
}
