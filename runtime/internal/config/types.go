package config

import "time"

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
