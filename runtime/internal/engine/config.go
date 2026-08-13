package engine

import (
	"strconv"
	"strings"
	"time"
)

const defaultLlamaVersion = "b8645"

// EngineKind identifies a supported local AI engine.
type EngineKind string

const (
	EngineLlama  EngineKind = "llama"
	EngineMedia  EngineKind = "media"
	EngineSpeech EngineKind = "speech"

	engineManagedImageBackend EngineKind = "managed-image-backend"
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

// ManagedImageBackendMode selects how the runtime-owned managed image backend is supplied.
type ManagedImageBackendMode string

const (
	ManagedImageBackendDisabled ManagedImageBackendMode = "disabled"
	ManagedImageBackendOfficial ManagedImageBackendMode = "official"
	ManagedImageBackendCustom   ManagedImageBackendMode = "custom"
)

// ManagedImageBackendConfig holds the daemon-managed runtime-owned image
// backend process configuration used by native-binary image workflows.
type ManagedImageBackendConfig struct {
	Mode        ManagedImageBackendMode
	BackendName string
	// PackageSource is a runtime-private selector for the managed backend
	// package source. Empty means use the canonical supported source for the
	// current host tuple.
	PackageSource string
	Address       string
	Command       string
	Args          []string
	Env           map[string]string
	WorkingDir    string

	StartupTimeout  time.Duration
	HealthInterval  time.Duration
	ShutdownTimeout time.Duration

	DownloadProgress func(bytesReceived, bytesTotal int64)
}

type ManagedImageBackendDependencyStatus struct {
	BackendName            string
	PackageSource          string
	PackageFormat          string
	LaunchMode             string
	CanonicalRoot          string
	VerifiedArtifacts      []string
	SupportedModelFamilies []string
	Detail                 string
}

type EngineBinaryDependencyStatus struct {
	Engine           string
	Version          string
	BinaryPath       string
	BinarySizeBytes  int64
	SHA256           string
	Platform         string
	AssetName        string
	AcceleratorPlane string
	Detail           string
}

type UVToolDependencyStatus struct {
	Version          string
	ExecutablePath   string
	SourceRoot       string
	ArchiveURL       string
	ArchiveSHA256    string
	ArchiveAssetName string
	Platform         string
	Detail           string
}

type PythonRuntimeDependencyStatus struct {
	PythonVersion   string
	InterpreterPath string
	RuntimeRoot     string
	UVExecutable    string
	Detail          string
}

func (c ManagedImageBackendConfig) Enabled() bool {
	return c.Mode != "" && c.Mode != ManagedImageBackendDisabled
}

func cloneManagedImageBackendConfig(input *ManagedImageBackendConfig) *ManagedImageBackendConfig {
	if input == nil {
		return nil
	}
	cloned := &ManagedImageBackendConfig{
		Mode:             input.Mode,
		BackendName:      input.BackendName,
		PackageSource:    input.PackageSource,
		Address:          input.Address,
		Command:          input.Command,
		Args:             append([]string(nil), input.Args...),
		WorkingDir:       input.WorkingDir,
		StartupTimeout:   input.StartupTimeout,
		HealthInterval:   input.HealthInterval,
		ShutdownTimeout:  input.ShutdownTimeout,
		DownloadProgress: input.DownloadProgress,
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

	// ExecutionHostIdentity is a Runtime-private lifecycle equality proof for
	// capability Hosts whose resident process is bound to an immutable
	// dependency profile. It is never accepted from a product request or
	// projected through the public Runtime protocol.
	ExecutionHostIdentity string

	// SupervisedRoot is the data-plane `environments` root the engine manager
	// installs and supervises under. The Supervisor derives its pid/metadata
	// file path from this root; it is stamped by the Manager before the
	// Supervisor is constructed and must not be a home-directory fallback.
	// (K-CFG-018, K-LENG-004)
	SupervisedRoot string

	// MediaMode carries the explicit media server topology mode selected by the
	// caller. Media bootstrap must not infer this internally.
	MediaMode MediaMode

	// ImageSupervisedSelection carries the canonical image resolver output into
	// media bootstrap when daemon-managed image loopback is active.
	ImageSupervisedSelection *ImageSupervisedMatrixSelection

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

	// MediaHostPackageSetRoot is the Runtime-verified immutable dependency
	// profile root that owns the private media server and its Python runtime.
	MediaHostPackageSetRoot string
	// MediaHostAcceleratorPlane is the host-derived accelerator plane verified
	// with MediaHostPackageSetRoot. It is Runtime-internal composition input,
	// never a user-selectable accelerator override.
	MediaHostAcceleratorPlane string

	// ModelsPath is the Runtime-verified speech model directory.
	ModelsPath string

	// SpeechHostPackageSetRoot is the Runtime-verified package-set root that
	// owns the private speech server for this exact capability Host.
	SpeechHostPackageSetRoot string
	// SpeechHostAcceleratorPlane is the host-derived accelerator plane verified
	// with SpeechHostPackageSetRoot. It is Runtime-internal composition input,
	// never a user-selectable accelerator override.
	SpeechHostAcceleratorPlane string

	// SpeechQwen3TTSPackageSetRoot is the Runtime-verified qwen3_tts Python
	// package-set root used to derive the supervised speech TTS driver command.
	SpeechQwen3TTSPackageSetRoot string

	// SpeechQwen3ASRPackageSetRoot is the Runtime-verified qwen3_asr Python
	// package-set root used to derive the supervised speech ASR driver command.
	SpeechQwen3ASRPackageSetRoot string

	// SpeechQwen3ASRTransformersPackageSetRoot is the Runtime-verified
	// Transformers-native Qwen3-ASR package-set root. It is intentionally
	// separate from the package-native qwen_asr root.
	SpeechQwen3ASRTransformersPackageSetRoot string

	// SpeechVoxCPMPackageSetRoot is the Runtime-verified VoxCPM package-set
	// root. SpeechVoxCPMBackend is the host-derived private backend fixed by
	// that profile and never accepted from a product request.
	SpeechVoxCPMPackageSetRoot string
	SpeechVoxCPMBackend        string

	// SpeechDriverWorkRoot is a Runtime-owned state-plane directory used only
	// for bounded request/response exchange with supervised speech drivers.
	// It must never be derived from process TEMP/HOME or the model payload root.
	SpeechDriverWorkRoot string

	// ManagedImageBackend configures the daemon-managed runtime-owned image backend.
	ManagedImageBackend *ManagedImageBackendConfig

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
//
// Version gate (b8645):
//   - Supports: --ctx-size, --cache-type-k/v, --flash-attn (on/off/auto),
//     --mmproj, --n-gpu-layers.
//   - Includes LLM_ARCH_GEMMA4 and Gemma 4 vision projector support.
//   - Gemma 4 audio input is still gated off: upstream libmtmd init_audio()
//     does not accept the GEMMA4A projector on this version.
func DefaultLlamaConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineLlama,
		Port:             1234,
		Version:          defaultLlamaVersion,
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
		StartupTimeout:   300 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// DefaultSpeechConfig returns the default configuration for the managed
// speech/voice workflow engine.
func DefaultSpeechConfig() EngineConfig {
	return EngineConfig{
		Kind:             EngineSpeech,
		Port:             8330,
		Version:          "0.1.0",
		HealthMode:       HealthModeHTTP,
		HealthPath:       "/healthz",
		HealthResponse:   "\"ready\": true",
		StartupTimeout:   300 * time.Second,
		HealthInterval:   30 * time.Second,
		MaxRestarts:      5,
		RestartBaseDelay: 2 * time.Second,
		ShutdownTimeout:  10 * time.Second,
	}
}

// Endpoint returns the HTTP base URL for the engine.
func (c EngineConfig) Endpoint() string {
	if trimmed := strings.TrimSpace(c.Address); trimmed != "" {
		if c.HealthMode == HealthModeTCP {
			return trimmed
		}
		if containsScheme(trimmed) {
			return trimmed
		}
		return "http://" + trimmed
	}
	return "http://127.0.0.1:" + strconv.Itoa(c.Port)
}

func containsScheme(value string) bool {
	for i := 0; i+2 < len(value); i++ {
		if value[i] == ':' && value[i+1] == '/' && value[i+2] == '/' {
			return true
		}
	}
	return false
}
