package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultSchemaVersion            = 1
	defaultGRPCAddr                 = "127.0.0.1:46371"
	defaultHTTPAddr                 = "127.0.0.1:46372"
	defaultLocalRuntimeStateRelPath = ".nimi/runtime/local-runtime-state.json"
	defaultRuntimeConfigRelPath     = ".nimi/config.json"
	legacyRuntimeConfigRelPath      = ".nimi/runtime/config.json"
	defaultCloudGeminiBaseURL       = "https://generativelanguage.googleapis.com/v1beta/openai"
)

// Config defines daemon boot configuration. (K-DAEMON-009)
type Config struct {
	GRPCAddr              string
	HTTPAddr              string
	ShutdownTimeout       time.Duration
	LocalRuntimeStatePath string

	// AllowLoopbackProviderEndpoint permits HTTP (non-TLS) connections to
	// loopback addresses (127.0.0.0/8, ::1, localhost) for provider endpoints.
	// Default: false. (K-SEC-002, K-DAEMON-009)
	AllowLoopbackProviderEndpoint bool

	// SessionTTLMinSeconds is the minimum TTL in seconds allowed for auth
	// sessions. Requests below this bound are rejected. Default: 60. (K-AUTHSVC-004)
	SessionTTLMinSeconds int

	// SessionTTLMaxSeconds is the maximum TTL in seconds allowed for auth
	// sessions. Requests above this bound are rejected. Default: 86400. (K-AUTHSVC-004)
	SessionTTLMaxSeconds int

	// WorkerMode enables runtime worker supervisor/proxy mode.
	// Default: false. (K-DAEMON-004, K-DAEMON-009)
	WorkerMode bool

	// AIHealthIntervalSeconds is the interval in seconds between AI provider
	// health probes. Default: 8. (K-DAEMON-009)
	AIHealthIntervalSeconds int

	// AIHTTPTimeoutSeconds is the HTTP timeout in seconds for AI provider
	// requests. Default: 30. (K-DAEMON-009)
	AIHTTPTimeoutSeconds int

	// GlobalConcurrencyLimit is the maximum number of concurrent AI requests
	// across all apps. Default: 8. (K-DAEMON-009)
	GlobalConcurrencyLimit int

	// PerAppConcurrencyLimit is the maximum number of concurrent AI requests
	// per app. Default: 2. (K-DAEMON-009)
	PerAppConcurrencyLimit int

	// IdempotencyCapacity is the maximum number of idempotency entries retained
	// before LRU eviction. Default: 10000. (K-DAEMON-009)
	IdempotencyCapacity int

	// MaxDelegationDepth is the maximum depth of delegation chains.
	// Default: 3. (K-DAEMON-009)
	MaxDelegationDepth int

	// AuditRingBufferSize is the capacity of the in-memory audit event ring
	// buffer. Default: 20000. (K-DAEMON-009)
	AuditRingBufferSize int

	// UsageStatsBufferSize is the capacity of the in-memory usage stats ring
	// buffer. Default: 50000. (K-DAEMON-009)
	UsageStatsBufferSize int

	// LocalAuditCapacity is the capacity of the local runtime audit event
	// buffer. Default: 5000. (K-DAEMON-009)
	LocalAuditCapacity int

	// LogLevel controls the minimum log level for the daemon logger.
	// Valid values: "debug", "info", "warn", "error". Default: "info". (K-DAEMON-009)
	LogLevel string
}

// FileConfig is the on-disk JSON schema for runtime configuration.
// All fields are flat top-level keys per K-DAEMON-009. Cloud provider
// credentials are env-only and not represented here (except apiKeyEnv).
// Pointer types distinguish "not set" from zero value for three-level fallback.
type FileConfig struct {
	SchemaVersion         int    `json:"schemaVersion"`
	GRPCAddr              string `json:"grpcAddr,omitempty"`
	HTTPAddr              string `json:"httpAddr,omitempty"`
	ShutdownTimeoutSeconds *int  `json:"shutdownTimeoutSeconds,omitempty"`
	LocalRuntimeStatePath string `json:"localRuntimeStatePath,omitempty"`

	WorkerMode              *bool `json:"workerMode,omitempty"`
	AIHealthIntervalSeconds *int  `json:"aiHealthIntervalSeconds,omitempty"`
	AIHTTPTimeoutSeconds    *int  `json:"aiHttpTimeoutSeconds,omitempty"`
	GlobalConcurrencyLimit  *int  `json:"globalConcurrencyLimit,omitempty"`
	PerAppConcurrencyLimit  *int  `json:"perAppConcurrencyLimit,omitempty"`
	IdempotencyCapacity     *int  `json:"idempotencyCapacity,omitempty"`
	MaxDelegationDepth      *int  `json:"maxDelegationDepth,omitempty"`
	AuditRingBufferSize     *int  `json:"auditRingBufferSize,omitempty"`
	UsageStatsBufferSize    *int  `json:"usageStatsBufferSize,omitempty"`
	LocalAuditCapacity      *int  `json:"localAuditCapacity,omitempty"`
	SessionTTLMinSeconds    *int  `json:"sessionTtlMinSeconds,omitempty"`
	SessionTTLMaxSeconds    *int  `json:"sessionTtlMaxSeconds,omitempty"`
	LogLevel                string `json:"logLevel,omitempty"`

	Providers map[string]RuntimeFileTarget `json:"providers,omitempty"`
}

type RuntimeFileTarget struct {
	BaseURL   string `json:"baseUrl"`
	APIKey    string `json:"apiKey"`
	APIKeyEnv string `json:"apiKeyEnv"`
}

// intPtr returns a pointer to the given int value.
func intPtr(v int) *int { return &v }

// boolPtr returns a pointer to the given bool value.
func boolPtr(v bool) *bool { return &v }

func DefaultFileConfig() FileConfig {
	return FileConfig{
		SchemaVersion:           DefaultSchemaVersion,
		GRPCAddr:                defaultGRPCAddr,
		HTTPAddr:                defaultHTTPAddr,
		ShutdownTimeoutSeconds:  intPtr(10),
		LocalRuntimeStatePath:   "~/" + defaultLocalRuntimeStateRelPath,
		WorkerMode:              boolPtr(false),
		AIHealthIntervalSeconds: intPtr(8),
		AIHTTPTimeoutSeconds:    intPtr(30),
		GlobalConcurrencyLimit:  intPtr(8),
		PerAppConcurrencyLimit:  intPtr(2),
		IdempotencyCapacity:     intPtr(10000),
		MaxDelegationDepth:      intPtr(3),
		AuditRingBufferSize:     intPtr(20000),
		UsageStatsBufferSize:    intPtr(50000),
		LocalAuditCapacity:      intPtr(5000),
		SessionTTLMinSeconds:    intPtr(60),
		SessionTTLMaxSeconds:    intPtr(86400),
		Providers:               map[string]RuntimeFileTarget{},
	}
}

// Load resolves configuration from environment with sane defaults.
// Priority: env var > FileConfig field > default value. (K-DAEMON-009)
func Load() (Config, error) {
	fileCfg, err := loadRuntimeFileConfig()
	if err != nil {
		return Config{}, err
	}
	applyProviderEnvDefaults(fileCfg)
	applyImplicitProviderDefaults()

	cfg := Config{
		GRPCAddr:                      readString("NIMI_RUNTIME_GRPC_ADDR", firstNonEmptyString(fileCfg.GRPCAddr, defaultGRPCAddr)),
		HTTPAddr:                      readString("NIMI_RUNTIME_HTTP_ADDR", firstNonEmptyString(fileCfg.HTTPAddr, defaultHTTPAddr)),
		ShutdownTimeout:               10 * time.Second,
		LocalRuntimeStatePath:         resolveLocalRuntimeStatePath(fileCfg),
		AllowLoopbackProviderEndpoint: readBoolWithFileConfigFallback("NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT", nil, false),
		SessionTTLMinSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS", fileCfg.SessionTTLMinSeconds, 60),
		SessionTTLMaxSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS", fileCfg.SessionTTLMaxSeconds, 86400),
		WorkerMode:                    readBoolWithFileConfigFallback("NIMI_RUNTIME_WORKER_MODE", fileCfg.WorkerMode, false),
		AIHealthIntervalSeconds:       readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HEALTH_INTERVAL_SECONDS", fileCfg.AIHealthIntervalSeconds, 8),
		AIHTTPTimeoutSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_AI_HTTP_TIMEOUT_SECONDS", fileCfg.AIHTTPTimeoutSeconds, 30),
		GlobalConcurrencyLimit:        readIntWithFileConfigFallback("NIMI_RUNTIME_GLOBAL_CONCURRENCY_LIMIT", fileCfg.GlobalConcurrencyLimit, 8),
		PerAppConcurrencyLimit:        readIntWithFileConfigFallback("NIMI_RUNTIME_PER_APP_CONCURRENCY_LIMIT", fileCfg.PerAppConcurrencyLimit, 2),
		IdempotencyCapacity:           readIntWithFileConfigFallback("NIMI_RUNTIME_IDEMPOTENCY_CAPACITY", fileCfg.IdempotencyCapacity, 10000),
		MaxDelegationDepth:            readIntWithFileConfigFallback("NIMI_RUNTIME_MAX_DELEGATION_DEPTH", fileCfg.MaxDelegationDepth, 3),
		AuditRingBufferSize:           readIntWithFileConfigFallback("NIMI_RUNTIME_AUDIT_RING_BUFFER_SIZE", fileCfg.AuditRingBufferSize, 20000),
		UsageStatsBufferSize:          readIntWithFileConfigFallback("NIMI_RUNTIME_USAGE_STATS_BUFFER_SIZE", fileCfg.UsageStatsBufferSize, 50000),
		LocalAuditCapacity:            readIntWithFileConfigFallback("NIMI_RUNTIME_LOCAL_AUDIT_CAPACITY", fileCfg.LocalAuditCapacity, 5000),
		LogLevel:                      readStringWithFileConfigFallback("NIMI_RUNTIME_LOG_LEVEL", fileCfg.LogLevel, "info"),
	}

	// shutdownTimeoutSeconds: env (duration string) > FileConfig (int seconds) > default 10
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

// Validate ensures addresses and timeout are usable before boot.
func (c Config) Validate() error {
	if err := validateAddr(c.GRPCAddr, "grpc"); err != nil {
		return err
	}
	if err := validateAddr(c.HTTPAddr, "http"); err != nil {
		return err
	}
	if c.ShutdownTimeout <= 0 {
		return fmt.Errorf("shutdown timeout must be > 0")
	}
	if _, err := ParseLogLevel(c.LogLevel); err != nil {
		return err
	}
	return nil
}

// ParseLogLevel converts a string log level to slog.Level.
func ParseLogLevel(raw string) (slog.Level, error) {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info", "":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("invalid log level %q: must be debug, info, warn, or error", raw)
	}
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


func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func validateAddr(value string, name string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s address must not be empty", name)
	}
	if _, _, err := net.SplitHostPort(value); err != nil {
		return fmt.Errorf("invalid %s address %q: %w", name, value, err)
	}
	return nil
}

func resolveLocalRuntimeStatePath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH")); value != "" {
		return value
	}
	if value := strings.TrimSpace(fileCfg.LocalRuntimeStatePath); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalRuntimeStateRelPath)
}

func runtimeConfigPath() string {
	if raw := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")); raw != "" {
		return expandUserPath(raw)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultRuntimeConfigRelPath)
}

func LegacyRuntimeConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, legacyRuntimeConfigRelPath)
}

func RuntimeConfigPath() string {
	return runtimeConfigPath()
}

func ResolveRuntimeConfigPathForLoad() (string, error) {
	targetPath := runtimeConfigPath()
	if targetPath == "" {
		return "", nil
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")) != "" {
		return targetPath, nil
	}
	legacyPath := LegacyRuntimeConfigPath()
	if legacyPath == "" || legacyPath == targetPath {
		return targetPath, nil
	}
	if _, err := os.Stat(targetPath); err == nil {
		return targetPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("stat runtime config file %q: %w", targetPath, err)
	}
	if _, err := os.Stat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return targetPath, nil
	} else if err != nil {
		return "", fmt.Errorf("stat legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := migrateLegacyConfigFile(legacyPath, targetPath); err != nil {
		return "", err
	}
	return targetPath, nil
}

func MigrateLegacyConfig() (bool, string, error) {
	targetPath := runtimeConfigPath()
	if targetPath == "" {
		return false, "", nil
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CONFIG_PATH")) != "" {
		return false, targetPath, nil
	}
	legacyPath := LegacyRuntimeConfigPath()
	if legacyPath == "" || legacyPath == targetPath {
		return false, targetPath, nil
	}
	if _, err := os.Stat(targetPath); err == nil {
		return false, targetPath, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, "", fmt.Errorf("stat runtime config file %q: %w", targetPath, err)
	}
	if _, err := os.Stat(legacyPath); errors.Is(err, os.ErrNotExist) {
		return false, targetPath, nil
	} else if err != nil {
		return false, "", fmt.Errorf("stat legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := migrateLegacyConfigFile(legacyPath, targetPath); err != nil {
		return false, "", err
	}
	return true, targetPath, nil
}

func migrateLegacyConfigFile(legacyPath string, targetPath string) error {
	content, err := os.ReadFile(legacyPath)
	if err != nil {
		return fmt.Errorf("read legacy runtime config file %q: %w", legacyPath, err)
	}
	normalized, err := normalizeMigratedConfigContent(content)
	if err != nil {
		return fmt.Errorf("normalize legacy runtime config file %q: %w", legacyPath, err)
	}
	if err := writeBytesAtomic(targetPath, normalized, 0o600); err != nil {
		return fmt.Errorf("write migrated runtime config file %q: %w", targetPath, err)
	}
	if err := os.Remove(legacyPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove legacy runtime config file %q: %w", legacyPath, err)
	}
	return nil
}

func normalizeMigratedConfigContent(content []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		defaultCfg := DefaultFileConfig()
		return MarshalFileConfig(defaultCfg)
	}
	var payload map[string]any
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, err
	}
	if _, exists := payload["schemaVersion"]; !exists {
		payload["schemaVersion"] = DefaultSchemaVersion
	}
	// Flatten legacy nested "runtime" and "ai" keys into top-level keys.
	flattenLegacyConfig(payload)
	normalized, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(normalized, '\n'), nil
}

// flattenLegacyConfig promotes legacy nested "runtime" and "ai" keys into
// top-level flat keys per K-DAEMON-009. Top-level keys take precedence.
func flattenLegacyConfig(payload map[string]any) {
	if rt, ok := payload["runtime"].(map[string]any); ok {
		promoteIfMissing(payload, rt, "grpcAddr")
		promoteIfMissing(payload, rt, "httpAddr")
		if v, exists := rt["shutdownTimeout"]; exists {
			if _, topExists := payload["shutdownTimeoutSeconds"]; !topExists {
				if s, ok := v.(string); ok {
					if d, err := time.ParseDuration(s); err == nil {
						payload["shutdownTimeoutSeconds"] = int(d.Seconds())
					}
				}
			}
		}
		promoteIfMissing(payload, rt, "localRuntimeStatePath")
		delete(payload, "runtime")
	}
	if ai, ok := payload["ai"].(map[string]any); ok {
		if v, exists := ai["httpTimeout"]; exists {
			if _, topExists := payload["aiHttpTimeoutSeconds"]; !topExists {
				if s, ok := v.(string); ok {
					if d, err := time.ParseDuration(s); err == nil {
						payload["aiHttpTimeoutSeconds"] = int(d.Seconds())
					}
				}
			}
		}
		if v, exists := ai["healthInterval"]; exists {
			if _, topExists := payload["aiHealthIntervalSeconds"]; !topExists {
				if s, ok := v.(string); ok {
					if d, err := time.ParseDuration(s); err == nil {
						payload["aiHealthIntervalSeconds"] = int(d.Seconds())
					}
				}
			}
		}
		if providers, exists := ai["providers"]; exists {
			if _, topExists := payload["providers"]; !topExists {
				payload["providers"] = providers
			}
		}
		delete(payload, "ai")
	}
}

func promoteIfMissing(dst map[string]any, src map[string]any, key string) {
	if v, exists := src[key]; exists {
		if _, topExists := dst[key]; !topExists {
			dst[key] = v
		}
	}
}

func writeBytesAtomic(path string, content []byte, mode os.FileMode) error {
	if path == "" {
		return fmt.Errorf("runtime config path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create runtime config directory: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, mode); err != nil {
		return fmt.Errorf("write temp runtime config file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename temp runtime config file: %w", err)
	}
	return nil
}

func loadRuntimeFileConfig() (FileConfig, error) {
	path, err := ResolveRuntimeConfigPathForLoad()
	if err != nil {
		return FileConfig{}, err
	}
	if path == "" {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	return LoadFileConfig(path)
}

func LoadFileConfig(path string) (FileConfig, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
		}
		return FileConfig{}, fmt.Errorf("read runtime config file %q: %w", path, err)
	}
	if len(strings.TrimSpace(string(content))) == 0 {
		return FileConfig{SchemaVersion: DefaultSchemaVersion}, nil
	}
	var parsed FileConfig
	if err := json.Unmarshal(content, &parsed); err != nil {
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: %w", path, err)
	}
	if err := ValidateFileConfig(parsed); err != nil {
		return FileConfig{}, fmt.Errorf("validate runtime config file %q: %w", path, err)
	}
	return parsed, nil
}

func ValidateFileConfig(fileCfg FileConfig) error {
	if fileCfg.SchemaVersion != DefaultSchemaVersion {
		return fmt.Errorf("schemaVersion must be %d", DefaultSchemaVersion)
	}
	for providerName, providerCfg := range fileCfg.Providers {
		if isLegacyProviderName(providerName) {
			return fmt.Errorf("provider %q is forbidden", providerName)
		}
		if strings.TrimSpace(providerCfg.APIKey) != "" {
			return fmt.Errorf("provider %q apiKey is forbidden; use apiKeyEnv", providerName)
		}
		if strings.TrimSpace(providerCfg.APIKeyEnv) == "" {
			return fmt.Errorf("provider %q apiKeyEnv is required", providerName)
		}
	}
	return nil
}

func MarshalFileConfig(fileCfg FileConfig) ([]byte, error) {
	if err := ValidateFileConfig(fileCfg); err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(fileCfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func WriteFileConfig(path string, fileCfg FileConfig) error {
	content, err := MarshalFileConfig(fileCfg)
	if err != nil {
		return err
	}
	return writeBytesAtomic(path, content, 0o600)
}

func expandUserPath(raw string) string {
	path := strings.TrimSpace(raw)
	if path == "" {
		return ""
	}
	if path == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			return home
		}
		return path
	}
	if !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~/"))
}

type providerEnvBinding struct {
	baseURLKey string
	apiKeyKey  string
}

func applyProviderEnvDefaults(fileCfg FileConfig) {
	for providerName, providerCfg := range fileCfg.Providers {
		binding, ok := resolveProviderBinding(providerName)
		if !ok {
			continue
		}

		apiKeyValue := resolveProviderAPIKey(providerCfg)
		if strings.TrimSpace(os.Getenv(binding.apiKeyKey)) == "" && apiKeyValue != "" {
			_ = os.Setenv(binding.apiKeyKey, apiKeyValue)
		}

		baseURLValue := strings.TrimSpace(providerCfg.BaseURL)
		if baseURLValue == "" && normalizeProviderName(providerName) == "gemini" && (apiKeyValue != "" || strings.TrimSpace(os.Getenv(binding.apiKeyKey)) != "") {
			baseURLValue = defaultCloudGeminiBaseURL
		}
		if strings.TrimSpace(os.Getenv(binding.baseURLKey)) == "" && baseURLValue != "" {
			_ = os.Setenv(binding.baseURLKey, baseURLValue)
		}
	}
}

func applyImplicitProviderDefaults() {
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")) == "" {
		if fallback := strings.TrimSpace(os.Getenv("GEMINI_API_KEY")); fallback != "" {
			_ = os.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY", fallback)
		}
	}
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL")) == "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY")) != "" {
		_ = os.Setenv("NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL", defaultCloudGeminiBaseURL)
	}
}

func resolveProviderAPIKey(target RuntimeFileTarget) string {
	if envRef := strings.TrimSpace(target.APIKeyEnv); envRef != "" {
		if value := strings.TrimSpace(os.Getenv(envRef)); value != "" {
			return value
		}
	}
	value := strings.TrimSpace(target.APIKey)
	if strings.HasPrefix(value, "${") && strings.HasSuffix(value, "}") {
		envRef := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}"))
		if envRef != "" {
			return strings.TrimSpace(os.Getenv(envRef))
		}
	}
	return value
}

func resolveProviderBinding(raw string) (providerEnvBinding, bool) {
	switch normalizeProviderName(raw) {
	case "local":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_AI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_AI_API_KEY",
		}, true
	case "localnexa", "nexa":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		}, true
	case "nimillm", "cloudnimillm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		}, true
	case "alibaba", "aliyun", "cloudalibaba":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_ALIBABA_API_KEY",
		}, true
	case "bytedance", "byte", "cloudbytedance":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY",
		}, true
	case "bytedanceopenspeech", "openspeech", "cloudbytedanceopenspeech":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_API_KEY",
		}, true
	case "gemini", "cloudgemini":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY",
		}, true
	case "minimax", "cloudminimax":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY",
		}, true
	case "kimi", "moonshot", "cloudkimi":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY",
		}, true
	case "glm", "zhipu", "bigmodel", "cloudglm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ADAPTER_GLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ADAPTER_GLM_API_KEY",
		}, true
	default:
		return providerEnvBinding{}, false
	}
}

func normalizeProviderName(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return ""
	}
	var builder strings.Builder
	builder.Grow(len(trimmed))
	for _, char := range trimmed {
		if char >= 'a' && char <= 'z' {
			builder.WriteRune(char)
			continue
		}
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func isLegacyProviderName(raw string) bool {
	switch normalizeProviderName(raw) {
	case "litellm", "cloudlitellm", "cloudai":
		return true
	default:
		return false
	}
}
