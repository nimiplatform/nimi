package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

	// AuthJWTIssuer is the expected JWT issuer (iss claim). If empty, issuer
	// validation is skipped. (K-AUTHN-003, K-DAEMON-009)
	AuthJWTIssuer string

	// AuthJWTAudience is the expected JWT audience (aud claim). If empty,
	// audience validation is skipped. (K-AUTHN-003, K-DAEMON-009)
	AuthJWTAudience string

	// AuthJWTPublicKeyPath is the file path to a PEM-encoded public key used
	// for JWT signature verification. Supports RSA and EC keys.
	// If empty, JWT verification is disabled (all tokens rejected). (K-AUTHN-004, K-DAEMON-009)
	AuthJWTPublicKeyPath string

	// Providers holds the parsed config.json providers section for cloud connector
	// auto-registration at startup.
	Providers map[string]RuntimeFileTarget

	// EngineLocalAIEnabled enables the supervised LocalAI engine.
	// Default: false. (K-LENG-004)
	EngineLocalAIEnabled bool

	// EngineLocalAIVersion is the LocalAI release version to download/use.
	// Default: "3.12.1". (K-LENG-004)
	EngineLocalAIVersion string

	// EngineLocalAIPort is the port for the supervised LocalAI instance.
	// Default: 1234. (K-LENG-004)
	EngineLocalAIPort int

	// EngineNexaEnabled enables the supervised Nexa engine.
	// Default: false. (K-LENG-004)
	EngineNexaEnabled bool

	// EngineNexaVersion is the expected Nexa version (informational).
	// Default: "". (K-LENG-004)
	EngineNexaVersion string

	// EngineNexaPort is the port for the supervised Nexa instance.
	// Default: 8000. (K-LENG-004)
	EngineNexaPort int
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

	Auth      *FileConfigAuth              `json:"auth,omitempty"`
	Providers map[string]RuntimeFileTarget `json:"providers,omitempty"`
	Engines   *FileConfigEngines           `json:"engines,omitempty"`
}

// FileConfigEngines holds supervised engine configuration in the config file.
type FileConfigEngines struct {
	LocalAI *FileConfigEngine `json:"localai,omitempty"`
	Nexa    *FileConfigEngine `json:"nexa,omitempty"`
}

// FileConfigEngine holds configuration for a single supervised engine.
type FileConfigEngine struct {
	Enabled *bool  `json:"enabled,omitempty"`
	Version string `json:"version,omitempty"`
	Port    *int   `json:"port,omitempty"`
}

// FileConfigAuth holds JWT authentication configuration in the config file.
type FileConfigAuth struct {
	JWT *FileConfigJWT `json:"jwt,omitempty"`
}

// FileConfigJWT holds JWT-specific authentication configuration.
type FileConfigJWT struct {
	Issuer        string `json:"issuer,omitempty"`
	Audience      string `json:"audience,omitempty"`
	PublicKeyPath string `json:"publicKeyPath,omitempty"`
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
		AuthJWTIssuer:                 readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_ISSUER", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Issuer }), ""),
		AuthJWTAudience:               readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_AUDIENCE", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.Audience }), ""),
		AuthJWTPublicKeyPath:          expandUserPath(readStringWithFileConfigFallback("NIMI_RUNTIME_AUTH_JWT_PUBLIC_KEY_PATH", fileConfigJWTField(fileCfg, func(j *FileConfigJWT) string { return j.PublicKeyPath }), "")),
		Providers:                     fileCfg.Providers,
		EngineLocalAIEnabled:          readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED", fileConfigEngineBool(fileCfg, "localai"), false),
		EngineLocalAIVersion:          readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_VERSION", fileConfigEngineString(fileCfg, "localai", "version"), "3.12.1"),
		EngineLocalAIPort:             readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_LOCALAI_PORT", fileConfigEngineInt(fileCfg, "localai", "port"), 1234),
		EngineNexaEnabled:             readBoolWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_ENABLED", fileConfigEngineBool(fileCfg, "nexa"), false),
		EngineNexaVersion:             readStringWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_VERSION", fileConfigEngineString(fileCfg, "nexa", "version"), ""),
		EngineNexaPort:                readIntWithFileConfigFallback("NIMI_RUNTIME_ENGINE_NEXA_PORT", fileConfigEngineInt(fileCfg, "nexa", "port"), 8000),
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

func RuntimeConfigPath() string {
	return runtimeConfigPath()
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
	path := runtimeConfigPath()
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
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&parsed); err != nil {
		return FileConfig{}, fmt.Errorf("parse runtime config file %q: %w", path, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
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
		if !isCanonicalProviderName(providerName) {
			return fmt.Errorf("provider %q is forbidden; use canonical provider name", providerName)
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

		apiKeyValue := ResolveProviderAPIKey(providerCfg)
		if strings.TrimSpace(os.Getenv(binding.apiKeyKey)) == "" && apiKeyValue != "" {
			_ = os.Setenv(binding.apiKeyKey, apiKeyValue)
		}

		baseURLValue := strings.TrimSpace(providerCfg.BaseURL)
		if baseURLValue == "" && canonicalProviderKey(providerName) == "gemini" && (apiKeyValue != "" || strings.TrimSpace(os.Getenv(binding.apiKeyKey)) != "") {
			baseURLValue = defaultCloudGeminiBaseURL
		}
		if strings.TrimSpace(os.Getenv(binding.baseURLKey)) == "" && baseURLValue != "" {
			_ = os.Setenv(binding.baseURLKey, baseURLValue)
		}
	}
}

func applyImplicitProviderDefaults() {
	if strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL")) == "" && strings.TrimSpace(os.Getenv("NIMI_RUNTIME_CLOUD_GEMINI_API_KEY")) != "" {
		_ = os.Setenv("NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL", defaultCloudGeminiBaseURL)
	}
}

// ResolveProviderAPIKey resolves the API key from a RuntimeFileTarget (env var or literal).
func ResolveProviderAPIKey(target RuntimeFileTarget) string {
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
	switch canonicalProviderKey(raw) {
	case "local":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_AI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_AI_API_KEY",
		}, true
	case "nexa":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_LOCAL_NEXA_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_LOCAL_NEXA_API_KEY",
		}, true
	case "nimillm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY",
		}, true
	case "openai":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENAI_API_KEY",
		}, true
	case "anthropic":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_ANTHROPIC_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_ANTHROPIC_API_KEY",
		}, true
	case "dashscope":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
		}, true
	case "volcengine":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY",
		}, true
	case "volcengine_openspeech":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY",
		}, true
	case "gemini":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_GEMINI_API_KEY",
		}, true
	case "minimax":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY",
		}, true
	case "kimi":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_KIMI_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_KIMI_API_KEY",
		}, true
	case "glm":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_GLM_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_GLM_API_KEY",
		}, true
	case "deepseek":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY",
		}, true
	case "openrouter":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY",
		}, true
	case "openai_compatible":
		return providerEnvBinding{
			baseURLKey: "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_BASE_URL",
			apiKeyKey:  "NIMI_RUNTIME_CLOUD_OPENAI_COMPATIBLE_API_KEY",
		}, true
	default:
		return providerEnvBinding{}, false
	}
}

// NormalizeProviderName strips non-alphanumeric characters and lowercases.
func NormalizeProviderName(raw string) string {
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

// ResolveCanonicalProviderID maps a config.json provider key to its canonical provider ID.
// Returns ("", false) for local providers or unknown names.
func ResolveCanonicalProviderID(raw string) (string, bool) {
	switch canonicalProviderKey(raw) {
	case "local", "nexa":
		return "", false
	case "nimillm":
		return "nimillm", true
	case "openai":
		return "openai", true
	case "anthropic":
		return "anthropic", true
	case "dashscope":
		return "dashscope", true
	case "volcengine":
		return "volcengine", true
	case "volcengine_openspeech":
		return "volcengine_openspeech", true
	case "gemini":
		return "gemini", true
	case "minimax":
		return "minimax", true
	case "kimi":
		return "kimi", true
	case "glm":
		return "glm", true
	case "deepseek":
		return "deepseek", true
	case "openrouter":
		return "openrouter", true
	case "openai_compatible":
		return "openai_compatible", true
	default:
		return "", false
	}
}

// fileConfigJWTField extracts a string field from the optional FileConfig Auth JWT section.
func fileConfigJWTField(fileCfg FileConfig, getter func(*FileConfigJWT) string) string {
	if fileCfg.Auth != nil && fileCfg.Auth.JWT != nil {
		return getter(fileCfg.Auth.JWT)
	}
	return ""
}

func isCanonicalProviderName(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}
	if canonicalProviderKey(trimmed) != trimmed {
		return false
	}
	switch trimmed {
	case "local", "nexa", "nimillm", "openai", "anthropic", "dashscope", "volcengine", "volcengine_openspeech", "gemini", "minimax", "kimi", "glm", "deepseek", "openrouter", "openai_compatible":
		return true
	default:
		return false
	}
}

func canonicalProviderKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// fileConfigEngineBool extracts the Enabled *bool for the named engine from FileConfig.
func fileConfigEngineBool(fileCfg FileConfig, engine string) *bool {
	if fileCfg.Engines == nil {
		return nil
	}
	switch engine {
	case "localai":
		if fileCfg.Engines.LocalAI != nil {
			return fileCfg.Engines.LocalAI.Enabled
		}
	case "nexa":
		if fileCfg.Engines.Nexa != nil {
			return fileCfg.Engines.Nexa.Enabled
		}
	}
	return nil
}

// fileConfigEngineString extracts a string field for the named engine from FileConfig.
func fileConfigEngineString(fileCfg FileConfig, engine string, field string) string {
	if fileCfg.Engines == nil {
		return ""
	}
	var cfg *FileConfigEngine
	switch engine {
	case "localai":
		cfg = fileCfg.Engines.LocalAI
	case "nexa":
		cfg = fileCfg.Engines.Nexa
	}
	if cfg == nil {
		return ""
	}
	switch field {
	case "version":
		return cfg.Version
	}
	return ""
}

// fileConfigEngineInt extracts a *int field for the named engine from FileConfig.
func fileConfigEngineInt(fileCfg FileConfig, engine string, field string) *int {
	if fileCfg.Engines == nil {
		return nil
	}
	var cfg *FileConfigEngine
	switch engine {
	case "localai":
		cfg = fileCfg.Engines.LocalAI
	case "nexa":
		cfg = fileCfg.Engines.Nexa
	}
	if cfg == nil {
		return nil
	}
	switch field {
	case "port":
		return cfg.Port
	}
	return nil
}
