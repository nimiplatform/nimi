package engine

import "time"

// EngineKind identifies a supported local AI engine.
type EngineKind string

const (
	EngineLocalAI EngineKind = "localai"
	EngineNexa    EngineKind = "nexa"
)

// EngineStatus represents the lifecycle state of a supervised engine.
type EngineStatus string

const (
	StatusStopped   EngineStatus = "stopped"
	StatusStarting  EngineStatus = "starting"
	StatusHealthy   EngineStatus = "healthy"
	StatusUnhealthy EngineStatus = "unhealthy"
)

// EngineConfig holds the configuration for a single engine instance.
type EngineConfig struct {
	Kind    EngineKind
	Port    int
	Version string

	// BinaryPath overrides automatic binary resolution.
	// For Nexa this is the system-installed path found via LookPath.
	BinaryPath string

	// ModelsPath is the directory for model files (LocalAI --models-path).
	ModelsPath string

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
		HealthPath:       "/readyz",
		StartupTimeout:   120 * time.Second,
		HealthInterval:   5 * time.Second,
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
		HealthPath:       "/",
		HealthResponse:   "Nexa SDK is running",
		StartupTimeout:   30 * time.Second,
		HealthInterval:   5 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// Endpoint returns the HTTP base URL for the engine.
func (c EngineConfig) Endpoint() string {
	return "http://127.0.0.1:" + itoa(c.Port)
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
