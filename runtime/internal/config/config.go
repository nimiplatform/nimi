package config

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultSchemaVersion             = 1
	defaultGRPCAddr                  = "127.0.0.1:46371"
	defaultHTTPAddr                  = "127.0.0.1:46372"
	defaultLocalRuntimeStateRelPath  = ".nimi/runtime/local-runtime-state.json"
	defaultLocalModelsRelPath        = ".nimi/models"
	defaultModelCatalogCustomRelPath = ".nimi/runtime/model-catalog/providers"
	defaultRuntimeConfigRelPath      = ".nimi/config.json"
	defaultCloudGeminiBaseURL        = "https://generativelanguage.googleapis.com/v1beta/openai"
)

// Config defines daemon boot configuration. (K-DAEMON-009)
type Config struct {
	GRPCAddr              string
	HTTPAddr              string
	ShutdownTimeout       time.Duration
	LocalRuntimeStatePath string
	LocalModelsPath       string

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

	// AuthJWTJWKSURL is the JWKS endpoint URL used for JWT signature
	// verification. If empty, JWT verification is disabled (all tokens
	// rejected). (K-AUTHN-004, K-DAEMON-009)
	AuthJWTJWKSURL string

	// Providers holds the parsed config.json providers section for cloud connector
	// auto-registration at startup.
	Providers map[string]RuntimeFileTarget

	// ModelCatalogCustomDir points to an optional writable directory that
	// stores provider-level custom catalog YAML files.
	// Default: ~/.nimi/runtime/model-catalog/providers
	ModelCatalogCustomDir string

	// EngineLocalAIEnabled enables the supervised LocalAI engine.
	// Default: false. (K-LENG-004)
	EngineLocalAIEnabled bool

	// EngineLocalAIAutoManaged reports whether LocalAI supervised mode was
	// inferred from a loopback providers.local endpoint.
	EngineLocalAIAutoManaged bool

	// EngineLocalAIVersion is the LocalAI release version to download/use.
	// Default: "3.12.1". (K-LENG-004)
	EngineLocalAIVersion string

	// EngineLocalAIPort is the port for the supervised LocalAI instance.
	// Default: 1234. (K-LENG-004)
	EngineLocalAIPort int

	// EngineLocalAIImageBackendMode controls the daemon-managed LocalAI image
	// backend supply path. Supported values: disabled, official, custom.
	EngineLocalAIImageBackendMode string

	// EngineLocalAIImageBackendName is the LocalAI backend registry name exposed
	// to LocalAI via --external-grpc-backends.
	EngineLocalAIImageBackendName string

	// EngineLocalAIImageBackendAddress is the loopback host:port where the image
	// backend listens for LocalAI gRPC connections.
	EngineLocalAIImageBackendAddress string

	// EngineLocalAIImageBackendCommand is the custom backend command path used
	// when EngineLocalAIImageBackendMode=custom.
	EngineLocalAIImageBackendCommand string

	// EngineLocalAIImageBackendArgs are forwarded to the custom backend command.
	EngineLocalAIImageBackendArgs []string

	// EngineLocalAIImageBackendEnv extends the custom backend environment.
	EngineLocalAIImageBackendEnv map[string]string

	// EngineLocalAIImageBackendWorkingDir overrides the custom backend working
	// directory.
	EngineLocalAIImageBackendWorkingDir string

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
	SchemaVersion          int    `json:"schemaVersion"`
	GRPCAddr               string `json:"grpcAddr,omitempty"`
	HTTPAddr               string `json:"httpAddr,omitempty"`
	ShutdownTimeoutSeconds *int   `json:"shutdownTimeoutSeconds,omitempty"`
	LocalRuntimeStatePath  string `json:"localRuntimeStatePath,omitempty"`
	LocalModelsPath        string `json:"localModelsPath,omitempty"`

	WorkerMode              *bool  `json:"workerMode,omitempty"`
	AIHealthIntervalSeconds *int   `json:"aiHealthIntervalSeconds,omitempty"`
	AIHTTPTimeoutSeconds    *int   `json:"aiHttpTimeoutSeconds,omitempty"`
	GlobalConcurrencyLimit  *int   `json:"globalConcurrencyLimit,omitempty"`
	PerAppConcurrencyLimit  *int   `json:"perAppConcurrencyLimit,omitempty"`
	IdempotencyCapacity     *int   `json:"idempotencyCapacity,omitempty"`
	MaxDelegationDepth      *int   `json:"maxDelegationDepth,omitempty"`
	AuditRingBufferSize     *int   `json:"auditRingBufferSize,omitempty"`
	UsageStatsBufferSize    *int   `json:"usageStatsBufferSize,omitempty"`
	LocalAuditCapacity      *int   `json:"localAuditCapacity,omitempty"`
	SessionTTLMinSeconds    *int   `json:"sessionTtlMinSeconds,omitempty"`
	SessionTTLMaxSeconds    *int   `json:"sessionTtlMaxSeconds,omitempty"`
	ModelCatalogCustomDir   string `json:"modelCatalogCustomDir,omitempty"`
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
	Enabled      *bool                          `json:"enabled,omitempty"`
	Version      string                         `json:"version,omitempty"`
	Port         *int                           `json:"port,omitempty"`
	ImageBackend *FileConfigLocalAIImageBackend `json:"imageBackend,omitempty"`
}

type FileConfigLocalAIImageBackend struct {
	Mode        string            `json:"mode,omitempty"`
	BackendName string            `json:"backendName,omitempty"`
	Address     string            `json:"address,omitempty"`
	Command     string            `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	WorkingDir  string            `json:"workingDir,omitempty"`
}

// FileConfigAuth holds JWT authentication configuration in the config file.
type FileConfigAuth struct {
	JWT *FileConfigJWT `json:"jwt,omitempty"`
}

// FileConfigJWT holds JWT-specific authentication configuration.
type FileConfigJWT struct {
	Issuer   string `json:"issuer,omitempty"`
	Audience string `json:"audience,omitempty"`
	JWKSURL  string `json:"jwksUrl,omitempty"`
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
		LocalModelsPath:         "~/" + defaultLocalModelsRelPath,
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
		ModelCatalogCustomDir:   "~/" + defaultModelCatalogCustomRelPath,
		Providers:               map[string]RuntimeFileTarget{},
	}
}

func defaultLocalAIImageBackendMode() string {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return "official"
	}
	return "disabled"
}

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
		GRPCAddr:                      readString("NIMI_RUNTIME_GRPC_ADDR", firstNonEmptyString(fileCfg.GRPCAddr, defaultGRPCAddr)),
		HTTPAddr:                      readString("NIMI_RUNTIME_HTTP_ADDR", firstNonEmptyString(fileCfg.HTTPAddr, defaultHTTPAddr)),
		ShutdownTimeout:               10 * time.Second,
		LocalRuntimeStatePath:         resolveLocalRuntimeStatePath(fileCfg),
		LocalModelsPath:               resolveLocalModelsPath(fileCfg),
		AllowLoopbackProviderEndpoint: readBoolWithFileConfigFallback("NIMI_RUNTIME_ALLOW_LOOPBACK_PROVIDER_ENDPOINT", nil, false),
		SessionTTLMinSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MIN_SECONDS", fileCfg.SessionTTLMinSeconds, 60),
		SessionTTLMaxSeconds:          readIntWithFileConfigFallback("NIMI_RUNTIME_SESSION_TTL_MAX_SECONDS", fileCfg.SessionTTLMaxSeconds, 86400),
		WorkerMode:                    readBoolWithFileConfigFallback("NIMI_RUNTIME_WORKER_MODE", fileCfg.WorkerMode, false),
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

	if inferredPort, autoManaged := inferLoopbackLocalAIPort(localBaseURL); autoManaged {
		if !localAIEnabledExplicit {
			cfg.EngineLocalAIEnabled = true
			cfg.EngineLocalAIAutoManaged = true
		}
		if cfg.EngineLocalAIEnabled && !localAIPortExplicit {
			cfg.EngineLocalAIPort = inferredPort
		}
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
	if err := validateLocalAIImageBackendConfig(c); err != nil {
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

func validateLocalAIImageBackendConfig(cfg Config) error {
	mode := strings.ToLower(strings.TrimSpace(cfg.EngineLocalAIImageBackendMode))
	switch mode {
	case "", "disabled", "official", "custom":
	default:
		return fmt.Errorf("invalid localai image backend mode %q", cfg.EngineLocalAIImageBackendMode)
	}
	if mode == "" || mode == "disabled" {
		return nil
	}
	if err := validateLoopbackHostPort(cfg.EngineLocalAIImageBackendAddress, "engines.localai.imageBackend.address"); err != nil {
		return err
	}
	if strings.TrimSpace(cfg.EngineLocalAIImageBackendName) == "" {
		return fmt.Errorf("engines.localai.imageBackend.backendName must not be empty")
	}
	if mode == "custom" && strings.TrimSpace(cfg.EngineLocalAIImageBackendCommand) == "" {
		return fmt.Errorf("engines.localai.imageBackend.command must not be empty when mode=custom")
	}
	return nil
}

func validateLoopbackHostPort(raw string, field string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return fmt.Errorf("%s must be host:port: %w", field, err)
	}
	if strings.TrimSpace(port) == "" {
		return fmt.Errorf("%s must include a port", field)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf("%s must use a loopback host", field)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(host))
	if trimmed == "" {
		return false
	}
	if trimmed == "localhost" {
		return true
	}
	ip := net.ParseIP(trimmed)
	return ip != nil && ip.IsLoopback()
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		result[trimmedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
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

func resolveLocalModelsPath(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.LocalModelsPath); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultLocalModelsRelPath)
}

func resolveModelCatalogCustomDir(fileCfg FileConfig) string {
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_MODEL_CATALOG_CUSTOM_DIR")); value != "" {
		return expandUserPath(value)
	}
	if value := strings.TrimSpace(fileCfg.ModelCatalogCustomDir); value != "" {
		return expandUserPath(value)
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, defaultModelCatalogCustomRelPath)
}
