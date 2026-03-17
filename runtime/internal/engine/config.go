package engine

import "time"

// EngineKind identifies a supported local AI engine.
type EngineKind string

const (
	EngineLlama EngineKind = "llama"
	EngineMedia EngineKind = "media"

	engineMediaDiffusersBackend EngineKind = "media-diffusers-backend"
)

// EngineStatus represents the lifecycle state of a supervised engine.
type EngineStatus string

const (
	StatusStopped   EngineStatus = "stopped"
	StatusStarting  EngineStatus = "starting"
	StatusHealthy   EngineStatus = "healthy"
	StatusUnhealthy EngineStatus = "unhealthy"
)

// EngineHealthMode controls how a supervised process is probed.
type EngineHealthMode string

const (
	HealthModeHTTP EngineHealthMode = "http"
	HealthModeTCP  EngineHealthMode = "tcp"
)

// LlamaImageBackendMode selects how the llama image backend is supplied.
type LlamaImageBackendMode string

const (
	LlamaImageBackendDisabled LlamaImageBackendMode = "disabled"
	LlamaImageBackendOfficial LlamaImageBackendMode = "official"
	LlamaImageBackendCustom   LlamaImageBackendMode = "custom"
)

// LlamaImageBackendConfig holds the daemon-managed llama image backend process
// configuration used by managed llama image workflows.
type LlamaImageBackendConfig struct {
	Mode        LlamaImageBackendMode
	BackendName string
	Address     string
	Command     string
	Args        []string
	Env         map[string]string
	WorkingDir  string

	StartupTimeout  time.Duration
	HealthInterval  time.Duration
	ShutdownTimeout time.Duration
}

func (c LlamaImageBackendConfig) Enabled() bool {
	return c.Mode != "" && c.Mode != LlamaImageBackendDisabled
}

func cloneLlamaImageBackendConfig(input *LlamaImageBackendConfig) *LlamaImageBackendConfig {
	if input == nil {
		return nil
	}
	cloned := &LlamaImageBackendConfig{
		Mode:            input.Mode,
		BackendName:     input.BackendName,
		Address:         input.Address,
		Command:         input.Command,
		Args:            append([]string(nil), input.Args...),
		WorkingDir:      input.WorkingDir,
		StartupTimeout:  input.StartupTimeout,
		HealthInterval:  input.HealthInterval,
		ShutdownTimeout: input.ShutdownTimeout,
	}
	if len(input.Env) > 0 {
		cloned.Env = make(map[string]string, len(input.Env))
		for key, value := range input.Env {
			cloned.Env[key] = value
		}
	}
	return cloned
}

// EngineConfig holds the configuration for a single engine instance.
type EngineConfig struct {
	Kind    EngineKind
	Port    int
	Version string

	// Address overrides the default 127.0.0.1:<port> endpoint. It is primarily
	// used for daemon-managed auxiliary services that expose a raw TCP socket.
	Address string

	// HealthMode selects the health probe type. Defaults to HTTP.
	HealthMode EngineHealthMode

	// BinaryPath overrides automatic binary resolution.
	BinaryPath string

	// CommandArgs are used by generic supervised processes that do not have a
	// dedicated command builder.
	CommandArgs []string

	// CommandEnv extends the child process environment.
	CommandEnv map[string]string

	// WorkingDir overrides the child process working directory.
	WorkingDir string

	// ModelsPath is the directory for model files (llama --models-path).
	ModelsPath string

	// ModelsConfigPath is the llama YAML config file passed via
	// --models-config-file.
	ModelsConfigPath string

	// BackendsPath is the llama backend install directory passed via
	// --backends-path.
	BackendsPath string

	// ExternalBackends is the set of llama backends to auto-load on boot via
	// --external-backends.
	ExternalBackends []string

	// ExternalGRPCBackends is the set of llama gRPC backends to register on
	// boot via --external-grpc-backends in name:uri form.
	ExternalGRPCBackends []string

	// LlamaImageBackend configures the daemon-managed llama image backend.
	LlamaImageBackend *LlamaImageBackendConfig

	// HealthPath is the HTTP path used for health probing.
	HealthPath string

	// HealthResponse is the optional expected body substring for HTTP health checks.
	HealthResponse string

	// StartupTimeout is the maximum time to wait for the engine to become healthy.
	StartupTimeout time.Duration

	// HealthInterval is the interval between health probes once running.
	HealthInterval time.Duration

	// MaxRestarts is the maximum number of consecutive restart attempts before
	// marking the engine as permanently unhealthy.
	MaxRestarts int

	// RestartBaseDelay is the base delay between restart attempts (with jitter).
	RestartBaseDelay time.Duration

	// ShutdownTimeout is the maximum time to wait for graceful SIGTERM shutdown
	// before sending SIGKILL.
	ShutdownTimeout time.Duration
}

// DefaultLlamaConfig returns the default configuration for the llama engine.
func DefaultLlamaConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineLlama,
		Port:             1234,
		Version:          "3.12.1",
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/v1/models",
		StartupTimeout:   120 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// DefaultMediaConfig returns the default configuration for the managed
// image/video engine.
func DefaultMediaConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineMedia,
		Port:             8321,
		Version:          "0.1.0",
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/healthz",
		HealthResponse:   "\"ready\": true",
		StartupTimeout:   180 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// Endpoint returns the HTTP base URL for the engine.
func (c EngineConfig) Endpoint() string {
	if trimmed := c.Address; trimmed != "" {
		if c.HealthMode == HealthModeTCP {
			return trimmed
		}
		if len(trimmed) > 0 && trimmed != "" {
			if containsScheme(trimmed) {
				return trimmed
			}
			return "http://" + trimmed
		}
	}
	return "http://127.0.0.1:" + itoa(c.Port)
}

func containsScheme(value string) bool {
	for i := 0; i+2 < len(value); i++ {
		if value[i] == ':' && value[i+1] == '/' && value[i+2] == '/' {
			return true
		}
	}
	return false
}

// itoa converts an int to string without importing strconv in this file.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
