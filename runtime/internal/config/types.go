package config

import "time"

const (
	DefaultSchemaVersion             = 1
	defaultGRPCAddr                  = "127.0.0.1:46371"
	defaultHTTPAddr                  = "127.0.0.1:46372"
	defaultLocalStateRelPath         = ".nimi/runtime/local-state.json"
	defaultModelCatalogCustomRelPath = ".nimi/runtime/model-catalog/providers"
	defaultRuntimeConfigRelPath      = ".nimi/runtime/config.json"
	defaultCloudGeminiBaseURL        = "https://generativelanguage.googleapis.com/v1beta/openai"

	// LocalServiceModeDesktopLocal is the only admitted localService.mode value
	// for the on-device Phase 1 product. (K-CFG-018)
	LocalServiceModeDesktopLocal = "desktop-local"
)

// Config defines daemon boot configuration. (K-DAEMON-009)
type Config struct {
	GRPCAddr        string
	HTTPAddr        string
	ShutdownTimeout time.Duration
	LocalStatePath  string
	LocalModelsPath string

	// RuntimeID is the stable local Runtime daemon identity, generated once at
	// config init and immutable thereafter. (K-CFG-018)
	RuntimeID string

	DataRootRef  string
	ManagedRoots ManagedRootsConfig

	// LocalService declares the Runtime local service posture. (K-CFG-018)
	LocalService LocalServiceConfig

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

	// AuthDeveloperRegistrationEnabled is the K-AUTHSVC-014 developer
	// registration gate. When true, RegisterApp may admit a not-yet-admitted
	// governed app_id that explicitly declares developer_registration, for local
	// developer testing. Default: false (production admission stays fail-closed).
	AuthDeveloperRegistrationEnabled bool

	// AccountRealmBaseURL is the Realm API origin used by RuntimeAccountService
	// to derive OAuth authorize/token endpoints. It is distinct from JWT issuer
	// because deployments may use an issuer value that is not the API base URL.
	AccountRealmBaseURL string

	// AccountAuthorizationURL is an explicit RuntimeAccountService OAuth
	// authorize endpoint override for staging/test environments.
	AccountAuthorizationURL string

	// AccountTokenURL is an explicit RuntimeAccountService OAuth token endpoint
	// override for staging/test environments.
	AccountTokenURL string

	// Providers holds the parsed config.json providers section for cloud connector
	// auto-registration at startup.
	Providers map[string]RuntimeFileTarget

	// ModelCatalogCustomDir points to an optional writable directory that
	// stores provider-level custom catalog YAML files.
	// Default: ~/.nimi/runtime/model-catalog/providers
	ModelCatalogCustomDir string

	// AppRegistryPath points to an explicit non-production projection of the
	// Platform Nimi App registry. Protected production startup ignores this
	// portable config/env field and accepts only its native service binding.
	// Empty means Platform-governed Nimi App registrations fail closed.
	AppRegistryPath string

	// AppBundledArtifactsRoot is the explicit non-production bundled-app fixture
	// root. Protected production startup ignores this portable config/env field
	// and accepts only the fixed native service resource binding. Empty disables
	// the bundled install path.
	AppBundledArtifactsRoot string

	// EngineLlamaEnabled enables the supervised llama engine.
	// Default: false. (K-LENG-004)
	EngineLlamaEnabled bool

	// EngineLlamaAutoManaged reports whether llama supervised mode was
	// inferred from a loopback llama endpoint.
	EngineLlamaAutoManaged bool

	// EngineLlamaVersion is the managed llama engine version.
	// Default: "b8645". (K-LENG-004)
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

	// EngineManagedImageBackendSource is a runtime-private selector for the
	// managed image backend package source. Empty means canonical source.
	EngineManagedImageBackendSource string

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

	// SchedulingDiskDenialThresholdBytes is the disk free threshold for scheduling
	// denial. Default: 500 MB. (K-SCHED-004)
	SchedulingDiskDenialThresholdBytes int64

	// SchedulingSlowdownRAMThresholdBytes is the available RAM threshold for
	// slowdown_risk. Default: 2 GB. (K-SCHED-005)
	SchedulingSlowdownRAMThresholdBytes int64

	// SchedulingSlowdownVRAMThresholdBytes is the available VRAM threshold for
	// slowdown_risk. Default: 1 GB. (K-SCHED-005)
	SchedulingSlowdownVRAMThresholdBytes int64

	// SchedulingSlowdownDiskThresholdBytes is the disk free threshold for
	// slowdown_risk (above denial but low). Default: 2 GB. (K-SCHED-005)
	SchedulingSlowdownDiskThresholdBytes int64

	// SchedulingPreemptionOccupancyPercent is the global slot occupancy percentage
	// above which preemption_risk is returned. Default: 75. (K-SCHED-005)
	SchedulingPreemptionOccupancyPercent int
}

// FileConfig is the on-disk JSON schema for runtime configuration.
// All fields are flat top-level keys per K-DAEMON-009. Cloud provider
// credentials may be referenced by apiKeyEnv or stored inline in the canonical
// config file; inline secrets remain mutually exclusive with env references.
// Pointer types distinguish "not set" from zero value for three-level fallback.
type FileConfig struct {
	SchemaVersion          int                     `json:"schemaVersion"`
	RuntimeID              string                  `json:"runtimeId,omitempty"`
	GRPCAddr               string                  `json:"grpcAddr,omitempty"`
	HTTPAddr               string                  `json:"httpAddr,omitempty"`
	ShutdownTimeoutSeconds *int                    `json:"shutdownTimeoutSeconds,omitempty"`
	LocalStatePath         string                  `json:"localStatePath,omitempty"`
	DataRootRef            string                  `json:"dataRootRef,omitempty"`
	ManagedRoots           *FileConfigManagedRoots `json:"managedRoots,omitempty"`
	LocalService           *FileConfigLocalService `json:"localService,omitempty"`
	DefaultLocalTextModel  string                  `json:"defaultLocalTextModel,omitempty"`
	DefaultCloudProvider   string                  `json:"defaultCloudProvider,omitempty"`

	AIHealthIntervalSeconds *int                         `json:"aiHealthIntervalSeconds,omitempty"`
	AIHTTPTimeoutSeconds    *int                         `json:"aiHttpTimeoutSeconds,omitempty"`
	GlobalConcurrencyLimit  *int                         `json:"globalConcurrencyLimit,omitempty"`
	PerAppConcurrencyLimit  *int                         `json:"perAppConcurrencyLimit,omitempty"`
	IdempotencyCapacity     *int                         `json:"idempotencyCapacity,omitempty"`
	MaxDelegationDepth      *int                         `json:"maxDelegationDepth,omitempty"`
	AuditRingBufferSize     *int                         `json:"auditRingBufferSize,omitempty"`
	UsageStatsBufferSize    *int                         `json:"usageStatsBufferSize,omitempty"`
	LocalAuditCapacity      *int                         `json:"localAuditCapacity,omitempty"`
	SessionTTLMinSeconds    *int                         `json:"sessionTtlMinSeconds,omitempty"`
	SessionTTLMaxSeconds    *int                         `json:"sessionTtlMaxSeconds,omitempty"`
	ModelCatalogCustomDir   string                       `json:"modelCatalogCustomDir,omitempty"`
	AppRegistryPath         string                       `json:"appRegistryPath,omitempty"`
	AppBundledArtifactsRoot string                       `json:"appBundledArtifactsRoot,omitempty"`
	LogLevel                string                       `json:"logLevel,omitempty"`
	Auth                    *FileConfigAuth              `json:"auth,omitempty"`
	Providers               map[string]RuntimeFileTarget `json:"providers,omitempty"`
	Engines                 *FileConfigEngines           `json:"engines,omitempty"`
	Scheduling              *FileConfigScheduling        `json:"scheduling,omitempty"`
}

type ManagedRootsConfig struct {
	Models       string
	Dependencies string
	Environments string
	Logs         string
	Audit        string
}

type FileConfigManagedRoots struct {
	Models       string `json:"models,omitempty"`
	Dependencies string `json:"dependencies,omitempty"`
	Environments string `json:"environments,omitempty"`
	Logs         string `json:"logs,omitempty"`
	Audit        string `json:"audit,omitempty"`
}

// LocalServiceConfig is the resolved Runtime local service posture. (K-CFG-018)
type LocalServiceConfig struct {
	Enabled bool
	Mode    string
}

// FileConfigLocalService is the on-disk Runtime local service posture section.
// Both fields are required when the localService object is present. (K-CFG-018)
type FileConfigLocalService struct {
	Enabled *bool  `json:"enabled,omitempty"`
	Mode    string `json:"mode,omitempty"`
}

// FileConfigScheduling holds scheduling risk threshold configuration.
type FileConfigScheduling struct {
	DiskDenialThresholdBytes   *int `json:"diskDenialThresholdBytes,omitempty"`
	SlowdownRamThresholdBytes  *int `json:"slowdownRamThresholdBytes,omitempty"`
	SlowdownVramThresholdBytes *int `json:"slowdownVramThresholdBytes,omitempty"`
	SlowdownDiskThresholdBytes *int `json:"slowdownDiskThresholdBytes,omitempty"`
	PreemptionOccupancyPercent *int `json:"preemptionOccupancyPercent,omitempty"`
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
	JWT                   *FileConfigJWT                   `json:"jwt,omitempty"`
	Account               *FileConfigAccount               `json:"account,omitempty"`
	DeveloperRegistration *FileConfigDeveloperRegistration `json:"developerRegistration,omitempty"`
}

// FileConfigDeveloperRegistration holds the K-AUTHSVC-014 developer
// registration gate (auth.developerRegistration.enabled).
type FileConfigDeveloperRegistration struct {
	Enabled *bool `json:"enabled,omitempty"`
}

// FileConfigJWT holds JWT-specific authentication configuration.
type FileConfigJWT struct {
	Issuer        string `json:"issuer,omitempty"`
	Audience      string `json:"audience,omitempty"`
	JWKSURL       string `json:"jwksUrl,omitempty"`
	RevocationURL string `json:"revocationUrl,omitempty"`
}

// FileConfigAccount holds RuntimeAccountService OAuth authority configuration.
type FileConfigAccount struct {
	RealmBaseURL     string `json:"realmBaseUrl,omitempty"`
	AuthorizationURL string `json:"authorizationUrl,omitempty"`
	TokenURL         string `json:"tokenUrl,omitempty"`
}

type RuntimeFileTarget struct {
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	APIKeyEnv    string `json:"apiKeyEnv"`
	DefaultModel string `json:"defaultModel,omitempty"`
}
