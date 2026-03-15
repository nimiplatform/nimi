package engine

import "time"

// EngineKind identifies a supported local AI engine.
type EngineKind string

const (
	EngineLocalAI EngineKind = "localai"
	EngineNexa    EngineKind = "nexa"
	EngineNimiMedia EngineKind = "nimi_media"

	engineLocalAIImageBackend EngineKind = "localai-image-backend"
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

// LocalAIImageBackendMode selects how the LocalAI image backend is supplied.
type LocalAIImageBackendMode string

const (
	LocalAIImageBackendDisabled LocalAIImageBackendMode = "disabled"
	LocalAIImageBackendOfficial LocalAIImageBackendMode = "official"
	LocalAIImageBackendCustom   LocalAIImageBackendMode = "custom"
)

// LocalAIImageBackendConfig holds the daemon-managed LocalAI image backend
// process configuration used by managed LocalAI image workflows.
type LocalAIImageBackendConfig struct {
	Mode        LocalAIImageBackendMode
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

func (c LocalAIImageBackendConfig) Enabled() bool {
	return c.Mode != "" && c.Mode != LocalAIImageBackendDisabled
}

func cloneLocalAIImageBackendConfig(input *LocalAIImageBackendConfig) *LocalAIImageBackendConfig {
	if input == nil {
		return nil
	}
	cloned := &LocalAIImageBackendConfig{
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
	// For Nexa this is the system-installed path found via LookPath.
	BinaryPath string

	// CommandArgs are used by generic supervised processes that do not have a
	// dedicated command builder.
	CommandArgs []string

	// CommandEnv extends the child process environment.
	CommandEnv map[string]string

	// WorkingDir overrides the child process working directory.
	WorkingDir string

	// ModelsPath is the directory for model files (LocalAI --models-path).
	ModelsPath string

	// ModelsConfigPath is the LocalAI YAML config file passed via
	// --models-config-file.
	ModelsConfigPath string

	// BackendsPath is the LocalAI backend install directory passed via
	// --backends-path.
	BackendsPath string

	// ExternalBackends is the set of LocalAI backends to auto-load on boot via
	// --external-backends.
	ExternalBackends []string

	// ExternalGRPCBackends is the set of LocalAI gRPC backends to register on
	// boot via --external-grpc-backends in name:uri form.
	ExternalGRPCBackends []string

	// LocalAIImageBackend configures the daemon-managed LocalAI image backend.
	LocalAIImageBackend *LocalAIImageBackendConfig

	// HealthPath is the HTTP path used for health probing.
	HealthPath string

	// HealthResponse is the expected body substring for health check (Nexa only).
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

// DefaultLocalAIConfig returns the default configuration for LocalAI engine.
func DefaultLocalAIConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineLocalAI,
		Port:             1234,
		Version:          "3.12.1",
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/readyz",
		StartupTimeout:   120 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// DefaultNexaConfig returns the default configuration for Nexa engine.
func DefaultNexaConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineNexa,
		Port:             8000,
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/",
		HealthResponse:   "Nexa SDK is running",
		StartupTimeout:   30 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// DefaultNimiMediaConfig returns the default configuration for the managed
// diffusers-backed image/video engine.
func DefaultNimiMediaConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineNimiMedia,
		Port:             8321,
		Version:          "0.1.0",
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/readyz",
		HealthResponse:   "\"status\": \"ok\"",
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
