package config

import "time"

const (
	DefaultSchemaVersion             = 1
	defaultGRPCAddr                  = "127.0.0.1:46371"
	defaultHTTPAddr                  = "127.0.0.1:46372"
	defaultLocalStateRelPath         = ".nimi/runtime/local-state.json"
	defaultLocalModelsRelPath        = ".nimi/data/models"
	defaultModelCatalogCustomRelPath = ".nimi/runtime/model-catalog/providers"
	defaultRuntimeConfigRelPath      = ".nimi/config.json"
	defaultCloudGeminiBaseURL        = "https://generativelanguage.googleapis.com/v1beta/openai"
)

// Config defines daemon boot configuration. (K-DAEMON-009)
type Config struct {
	GRPCAddr              string
	HTTPAddr              string
	ShutdownTimeout       time.Duration
	LocalStatePath        string
	LocalModelsPath       string
	DefaultLocalTextModel string
	DefaultCloudProvider  string

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

	// AuthJWTIssuer is the expected JWT issuer (iss claim). It must be set
	// together with AuthJWTAudience and AuthJWTJWKSURL. (K-AUTHN-003, K-DAEMON-009)
	AuthJWTIssuer string

	// AuthJWTAudience is the expected JWT audience (aud claim). It must be set
	// together with AuthJWTIssuer and AuthJWTJWKSURL. (K-AUTHN-003, K-DAEMON-009)
	AuthJWTAudience string

	// AuthJWTJWKSURL is the JWKS endpoint URL used for JWT signature
	// verification. It must use HTTPS unless the host is loopback, and it must
	// be configured together with issuer and audience. If empty, JWT
	// verification is disabled (all tokens rejected). (K-AUTHN-004, K-DAEMON-009)
	AuthJWTJWKSURL string

	// AuthJWTRevocationURL is the optional session revocation / introspection
	// endpoint consulted after successful JWT validation.
	AuthJWTRevocationURL string

	// Providers holds the parsed config.json providers section for cloud connector
	// auto-registration at startup.
	Providers map[string]RuntimeFileTarget

	// ModelCatalogCustomDir points to an optional writable directory that
	// stores provider-level custom catalog YAML files.
	// Default: ~/.nimi/runtime/model-catalog/providers
	ModelCatalogCustomDir string

	// EngineLlamaEnabled enables the supervised llama engine.
	// Default: false. (K-LENG-004)
	EngineLlamaEnabled bool

	// EngineLlamaAutoManaged reports whether llama supervised mode was
	// inferred from a loopback llama endpoint.
	EngineLlamaAutoManaged bool

	// EngineLlamaVersion is the managed llama engine version.
	// Default: "b8575". (K-LENG-004)
	EngineLlamaVersion string

	// EngineLlamaPort is the port for the supervised llama instance.
	// Default: 1234. (K-LENG-004)
	EngineLlamaPort int

	// EngineMediaEnabled enables the supervised media engine.
	// Default: false. (K-LENG-004)
	EngineMediaEnabled bool

	// EngineMediaVersion is the managed media engine version.
	// Default: "0.1.0". (K-LENG-004)
	EngineMediaVersion string

	// EngineMediaPort is the port for the supervised media engine.
	// Default: 8321. (K-LENG-004)
	EngineMediaPort int

	// EngineSpeechEnabled enables the supervised speech engine.
	// Default: false. (K-LENG-004)
	EngineSpeechEnabled bool

	// EngineSpeechVersion is the managed speech engine version.
	// Default: "0.1.0". (K-LENG-004)
	EngineSpeechVersion string

	// EngineSpeechPort is the port for the supervised speech engine.
	// Default: 8330. (K-LENG-004)
	EngineSpeechPort int

	// EngineSidecarEnabled enables the supervised sidecar engine.
	// Default: false. (K-LENG-004)
	EngineSidecarEnabled bool

	// EngineSidecarVersion is the managed sidecar version.
	EngineSidecarVersion string

	// EngineSidecarPort is the port for the supervised sidecar instance.
	EngineSidecarPort int
}

// FileConfig is the on-disk JSON schema for runtime configuration.
// All fields are flat top-level keys per K-DAEMON-009. Cloud provider
// credentials may be referenced by apiKeyEnv or stored inline in the canonical
// config file; inline secrets remain mutually exclusive with env references.
// Pointer types distinguish "not set" from zero value for three-level fallback.
type FileConfig struct {
	SchemaVersion          int    `json:"schemaVersion"`
	GRPCAddr               string `json:"grpcAddr,omitempty"`
	HTTPAddr               string `json:"httpAddr,omitempty"`
	ShutdownTimeoutSeconds *int   `json:"shutdownTimeoutSeconds,omitempty"`
	LocalStatePath         string `json:"localStatePath,omitempty"`
	LocalModelsPath        string `json:"localModelsPath,omitempty"`
	DefaultLocalTextModel  string `json:"defaultLocalTextModel,omitempty"`
	DefaultCloudProvider   string `json:"defaultCloudProvider,omitempty"`

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
	Llama  *FileConfigEngine `json:"llama,omitempty"`
	Media  *FileConfigEngine `json:"media,omitempty"`
	Speech *FileConfigEngine `json:"speech,omitempty"`
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
	JWKSURL       string `json:"jwksUrl,omitempty"`
	RevocationURL string `json:"revocationUrl,omitempty"`
}

type RuntimeFileTarget struct {
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	APIKeyEnv    string `json:"apiKeyEnv"`
	DefaultModel string `json:"defaultModel,omitempty"`
}
