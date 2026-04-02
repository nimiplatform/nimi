package engine

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Manager is the facade for engine lifecycle management.
type Manager struct {
	logger   *slog.Logger
	baseDir  string
	registry *Registry
	onState  StateChangeFunc

	llamaModelsPath       string
	llamaModelsConfigPath string
	llamaBackendsPath     string
	llamaImageBackend     *LlamaImageBackendConfig

	mu          sync.RWMutex
	supervisors map[EngineKind]*Supervisor
	starting    map[EngineKind]bool
}

// NewManager creates a new engine manager.
// baseDir is the root engines directory (typically ~/.nimi/engines/).
func NewManager(logger *slog.Logger, baseDir string, onState StateChangeFunc) (*Manager, error) {
	if logger == nil {
		logger = slog.Default()
	}
	if baseDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve home directory: %w", err)
		}
		baseDir = filepath.Join(home, ".nimi", "engines")
	}

	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create engines directory: %w", err)
	}

	registry, err := NewRegistry(baseDir)
	if err != nil {
		return nil, fmt.Errorf("load engine registry: %w", err)
	}

	modelsPath, modelsConfigPath, err := defaultLlamaPaths()
	if err != nil {
		return nil, err
	}
	backendsPath, err := defaultLlamaBackendsPath()
	if err != nil {
		return nil, err
	}

	return &Manager{
		logger:                logger,
		baseDir:               baseDir,
		registry:              registry,
		onState:               onState,
		llamaModelsPath:       modelsPath,
		llamaModelsConfigPath: modelsConfigPath,
		llamaBackendsPath:     backendsPath,
		supervisors:           make(map[EngineKind]*Supervisor),
		starting:              make(map[EngineKind]bool),
	}, nil
}

// SetSupervisorForTesting allows higher-level package tests to seed a managed
// supervisor without mutating unexported fields via reflection.
func (m *Manager) SetSupervisorForTesting(kind EngineKind, supervisor *Supervisor) {
	m.mu.Lock()
	if supervisor == nil {
		delete(m.supervisors, kind)
	} else {
		m.supervisors[kind] = supervisor
	}
	m.mu.Unlock()
}

func defaultLlamaPaths() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("resolve home directory: %w", err)
	}
	modelsRoot := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH"))
	if modelsRoot == "" {
		modelsRoot = filepath.Join(home, ".nimi", "data", "models")
	}
	return modelsRoot, filepath.Join(home, ".nimi", "runtime", "llama-models.yaml"), nil
}

func defaultLlamaBackendsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".nimi", "runtime", "llama-backends"), nil
}

// SetLlamaPaths overrides the default llama model directory and generated
// config path used when callers do not explicitly populate EngineConfig.
func (m *Manager) SetLlamaPaths(modelsPath string, modelsConfigPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.llamaModelsPath = strings.TrimSpace(modelsPath)
	m.llamaModelsConfigPath = strings.TrimSpace(modelsConfigPath)
}

// SetLlamaImageBackend configures the daemon-managed llama image backend
// process that should be registered via --external-grpc-backends.
func (m *Manager) SetLlamaImageBackend(cfg *LlamaImageBackendConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.llamaImageBackend = normalizeLlamaImageBackendConfig(cfg)
}

// EnsureManagedImageBackend starts the runtime-owned managed image gRPC backend
// without registering it as a llama external backend.
func (m *Manager) EnsureManagedImageBackend(ctx context.Context, cfg *LlamaImageBackendConfig) error {
	normalized := normalizeLlamaImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return nil
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.llamaBackendsPath)
	m.mu.RUnlock()
	llamaBinaryPath := ""
	if latest := m.latestRegistryEntry(EngineLlama); latest != nil {
		llamaBinaryPath = strings.TrimSpace(latest.BinaryPath)
	}
	resolved, err := ensureOfficialLlamaImageBackend(ctx, llamaBinaryPath, backendsPath, normalized)
	if err != nil {
		return err
	}
	auxCfg, err := llamaImageBackendEngineConfig(resolved)
	if err != nil {
		return err
	}
	return m.startLlamaImageBackend(ctx, auxCfg)
}

func (m *Manager) applyLlamaPaths(cfg EngineConfig) EngineConfig {
	if cfg.Kind != EngineLlama {
		return cfg
	}
	m.mu.RLock()
	modelsPath := strings.TrimSpace(m.llamaModelsPath)
	modelsConfigPath := strings.TrimSpace(m.llamaModelsConfigPath)
	backendsPath := strings.TrimSpace(m.llamaBackendsPath)
	imageBackend := cloneLlamaImageBackendConfig(m.llamaImageBackend)
	m.mu.RUnlock()
	if cfg.ModelsPath == "" {
		cfg.ModelsPath = modelsPath
	}
	if cfg.ModelsConfigPath == "" {
		cfg.ModelsConfigPath = modelsConfigPath
	}
	if cfg.BackendsPath == "" {
		cfg.BackendsPath = backendsPath
	}
	if len(cfg.ExternalBackends) == 0 {
		cfg.ExternalBackends = detectLlamaExternalBackends(cfg.ModelsConfigPath)
	} else {
		cfg.ExternalBackends = normalizeLlamaExternalBackends(cfg.ExternalBackends)
	}
	if cfg.LlamaImageBackend == nil {
		cfg.LlamaImageBackend = normalizeLlamaImageBackendConfig(imageBackend)
	} else {
		cfg.LlamaImageBackend = normalizeLlamaImageBackendConfig(cfg.LlamaImageBackend)
	}
	return cfg
}

// EnsureEngine ensures the engine binary is available.
// Llama downloads if not in registry.
// Media provisions its managed Python environment on demand.
func (m *Manager) EnsureEngine(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	cfg = m.applyLlamaPaths(cfg)
	switch cfg.Kind {
	case EngineLlama:
		return m.ensureLlama(ctx, cfg)
	case EngineMedia:
		return ensureMedia(ctx, m.baseDir, cfg)
	case EngineSpeech:
		return ensureSpeech(ctx, m.baseDir, cfg)
	default:
		return cfg, fmt.Errorf("unknown engine kind: %s", cfg.Kind)
	}
}

func (m *Manager) ensureLlama(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	// Check registry first.
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if entry != nil {
		if _, err := os.Stat(entry.BinaryPath); err == nil {
			cfg.BinaryPath = entry.BinaryPath
			m.logger.Info("llama binary found in registry",
				"version", cfg.Version,
				"path", entry.BinaryPath,
			)
			return cfg, nil
		}
		// Binary missing from disk — re-download.
		_ = m.registry.Remove(EngineLlama, cfg.Version)
	}

	m.logger.Info("downloading llama binary",
		"version", cfg.Version,
	)

	binaryPath, sha256hex, err := DownloadBinary(m.baseDir, EngineLlama, cfg.Version)
	if err != nil {
		return cfg, fmt.Errorf("download llama: %w", err)
	}

	if err := m.registry.Put(&RegistryEntry{
		Engine:      EngineLlama,
		Version:     cfg.Version,
		BinaryPath:  binaryPath,
		SHA256:      sha256hex,
		Platform:    PlatformString(),
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return cfg, fmt.Errorf("persist llama registry entry version %s at %s: %w", cfg.Version, binaryPath, err)
	}

	cfg.BinaryPath = binaryPath
	resolvedImageBackend, err := ensureOfficialLlamaImageBackend(ctx, cfg.BinaryPath, cfg.BackendsPath, cfg.LlamaImageBackend)
	if err != nil {
		return cfg, fmt.Errorf("prepare llama image backend: %w", err)
	}
	cfg.LlamaImageBackend = resolvedImageBackend
	return cfg, nil
}

// StartEngine starts the engine with the given configuration.
func (m *Manager) StartEngine(ctx context.Context, cfg EngineConfig) error {
	cfg = m.applyLlamaPaths(cfg)
	if err := m.beginEngineStart(cfg.Kind); err != nil {
		return err
	}
	defer m.finishEngineStart(cfg.Kind)
	if cfg.Kind == EngineLlama && strings.TrimSpace(cfg.BackendsPath) != "" {
		if err := os.MkdirAll(cfg.BackendsPath, 0o755); err != nil {
			return fmt.Errorf("create llama backends directory: %w", err)
		}
	}
	if cfg.Kind == EngineLlama {
		var err error
		cfg, err = m.prepareLlamaStart(ctx, cfg)
		if err != nil {
			return err
		}
	}
	m.mu.Lock()
	if existing, ok := m.supervisors[cfg.Kind]; ok {
		if existing.Status() == StatusHealthy || existing.Status() == StatusStarting {
			m.mu.Unlock()
			return fmt.Errorf("engine %s already running", cfg.Kind)
		}
	}
	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.supervisors[cfg.Kind] = sup
	m.mu.Unlock()

	if err := sup.Start(ctx); err != nil {
		m.removeSupervisorIfCurrent(cfg.Kind, sup)
		return err
	}
	return nil
}

// StopEngine stops the specified engine.
func (m *Manager) StopEngine(kind EngineKind) error {
	m.mu.RLock()
	sup, ok := m.supervisors[kind]
	m.mu.RUnlock()

	if !ok {
		return fmt.Errorf("engine %s not found", kind)
	}

	if err := sup.Stop(); err != nil {
		return err
	}
	if kind == EngineLlama {
		if err := m.stopLlamaImageBackend(); err != nil {
			return err
		}
	}
	m.removeSupervisorIfCurrent(kind, sup)
	return nil
}

// StopAll stops all running engines.
func (m *Manager) StopAll() {
	type managedSupervisor struct {
		kind EngineKind
		sup  *Supervisor
	}

	m.mu.RLock()
	sups := make([]managedSupervisor, 0, len(m.supervisors))
	for kind, s := range m.supervisors {
		sups = append(sups, managedSupervisor{kind: kind, sup: s})
	}
	m.mu.RUnlock()

	for _, entry := range sups {
		if entry.sup == nil {
			m.removeSupervisorIfCurrent(entry.kind, nil)
			continue
		}
		if err := entry.sup.Stop(); err != nil {
			m.logger.Warn("stop engine failed",
				"engine", entry.sup.cfg.Kind,
				"error", err,
			)
			continue
		}
		m.removeSupervisorIfCurrent(entry.kind, entry.sup)
	}
}

// EngineEndpoint returns the HTTP endpoint for the given engine.
func (m *Manager) EngineEndpoint(kind EngineKind) (string, error) {
	m.mu.RLock()
	sup, ok := m.supervisors[kind]
	m.mu.RUnlock()

	if !ok {
		return "", fmt.Errorf("engine %s not started", kind)
	}

	info := sup.Info()
	if info.Status != StatusHealthy {
		return "", fmt.Errorf("engine %s is %s", kind, info.Status)
	}
	return info.Endpoint, nil
}

// EngineStatus returns the status info for the given engine.
func (m *Manager) EngineStatus(kind EngineKind) (SupervisorInfo, error) {
	m.mu.RLock()
	sup, ok := m.supervisors[kind]
	m.mu.RUnlock()

	if !ok {
		return SupervisorInfo{}, fmt.Errorf("engine %s not started", kind)
	}
	return sup.Info(), nil
}

// ListEngines returns status info for all managed engines.
func (m *Manager) ListEngines() []SupervisorInfo {
	m.mu.RLock()
	running := make(map[EngineKind]SupervisorInfo, len(m.supervisors))
	for kind, s := range m.supervisors {
		if kind == engineMediaDiffusersBackend {
			continue
		}
		running[kind] = s.Info()
	}
	m.mu.RUnlock()

	knownKinds := []EngineKind{EngineLlama, EngineMedia, EngineSpeech}
	result := make([]SupervisorInfo, 0, len(running)+len(knownKinds))
	seen := make(map[EngineKind]bool, len(running)+len(knownKinds))

	for _, kind := range knownKinds {
		if info, ok := running[kind]; ok {
			result = append(result, info)
		} else {
			result = append(result, m.stoppedEngineInfo(kind))
		}
		seen[kind] = true
	}

	for kind, info := range running {
		if seen[kind] {
			continue
		}
		result = append(result, info)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Kind < result[j].Kind
	})
	return result
}

// Registry returns the underlying engine binary registry.
func (m *Manager) Registry() *Registry {
	return m.registry
}

func (m *Manager) stoppedEngineInfo(kind EngineKind) SupervisorInfo {
	var cfg EngineConfig
	switch kind {
	case EngineLlama:
		cfg = DefaultLlamaConfig()
	case EngineMedia:
		cfg = DefaultMediaConfig()
	case EngineSpeech:
		cfg = DefaultSpeechConfig()
	default:
		return SupervisorInfo{Kind: kind, Status: StatusStopped}
	}

	info := SupervisorInfo{
		Kind:     kind,
		Version:  cfg.Version,
		Port:     cfg.Port,
		Status:   StatusStopped,
		Endpoint: cfg.Endpoint(),
	}

	switch kind {
	case EngineLlama:
		if latest := m.latestRegistryEntry(EngineLlama); latest != nil {
			if version := strings.TrimSpace(latest.Version); version != "" {
				info.Version = version
			}
			info.BinaryPath = strings.TrimSpace(latest.BinaryPath)
			if fi, err := os.Stat(info.BinaryPath); err == nil {
				info.BinarySizeBytes = fi.Size()
			}
		}
	case EngineMedia:
		path := managedPythonPath(engineVersionDir(m.baseDir, EngineMedia, cfg.Version))
		if fi, statErr := os.Stat(path); statErr == nil {
			info.BinaryPath = strings.TrimSpace(path)
			info.BinarySizeBytes = fi.Size()
		}
	case EngineSpeech:
		path := managedPythonPath(engineVersionDir(m.baseDir, EngineSpeech, cfg.Version))
		if fi, statErr := os.Stat(path); statErr == nil {
			info.BinaryPath = strings.TrimSpace(path)
			info.BinarySizeBytes = fi.Size()
		}
	}

	return info
}

func (m *Manager) prepareLlamaStart(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	if cfg.LlamaImageBackend == nil || !cfg.LlamaImageBackend.Enabled() {
		return cfg, nil
	}
	resolvedImageBackend, err := ensureOfficialLlamaImageBackend(ctx, cfg.BinaryPath, cfg.BackendsPath, cfg.LlamaImageBackend)
	if err != nil {
		return cfg, fmt.Errorf("prepare llama image backend: %w", err)
	}
	cfg.LlamaImageBackend = resolvedImageBackend
	auxCfg, err := llamaImageBackendEngineConfig(resolvedImageBackend)
	if err != nil {
		return cfg, err
	}
	if err := m.startLlamaImageBackend(ctx, auxCfg); err != nil {
		return cfg, err
	}
	entry := strings.TrimSpace(resolvedImageBackend.BackendName) + ":" + strings.TrimSpace(resolvedImageBackend.Address)
	cfg.ExternalGRPCBackends = normalizeLlamaExternalGRPCBackends(append(cfg.ExternalGRPCBackends, entry))
	return cfg, nil
}

func (m *Manager) startLlamaImageBackend(ctx context.Context, cfg EngineConfig) error {
	m.mu.Lock()
	existing, ok := m.supervisors[engineMediaDiffusersBackend]
	if m.starting[engineMediaDiffusersBackend] {
		m.mu.Unlock()
		return nil
	}
	if ok && (existing.Status() == StatusHealthy || existing.Status() == StatusStarting) {
		m.mu.Unlock()
		return nil
	}
	m.starting[engineMediaDiffusersBackend] = true
	if ok {
		delete(m.supervisors, engineMediaDiffusersBackend)
	}
	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.supervisors[engineMediaDiffusersBackend] = sup
	m.mu.Unlock()
	defer m.finishEngineStart(engineMediaDiffusersBackend)
	if ok {
		_ = existing.Stop()
	}
	if err := sup.Start(ctx); err != nil {
		m.removeSupervisorIfCurrent(engineMediaDiffusersBackend, sup)
		return err
	}
	return nil
}

func (m *Manager) stopLlamaImageBackend() error {
	m.mu.RLock()
	sup, ok := m.supervisors[engineMediaDiffusersBackend]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	if err := sup.Stop(); err != nil {
		return err
	}
	m.removeSupervisorIfCurrent(engineMediaDiffusersBackend, sup)
	return nil
}

func (m *Manager) removeSupervisorIfCurrent(kind EngineKind, expected *Supervisor) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, exists := m.supervisors[kind]
	if !exists {
		return
	}
	if expected != nil && current != expected {
		return
	}
	delete(m.supervisors, kind)
}

func (m *Manager) beginEngineStart(kind EngineKind) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.starting[kind] {
		return fmt.Errorf("engine %s already running", kind)
	}
	if existing, ok := m.supervisors[kind]; ok {
		if existing.Status() == StatusHealthy || existing.Status() == StatusStarting {
			return fmt.Errorf("engine %s already running", kind)
		}
	}
	m.starting[kind] = true
	return nil
}

func (m *Manager) finishEngineStart(kind EngineKind) {
	m.mu.Lock()
	delete(m.starting, kind)
	m.mu.Unlock()
}

func (m *Manager) latestRegistryEntry(kind EngineKind) *RegistryEntry {
	if m.registry == nil {
		return nil
	}
	entries := m.registry.List()
	var latest *RegistryEntry
	latestInstalledAt := ""
	latestParsed := time.Time{}
	latestHasParsed := false

	for _, entry := range entries {
		if entry == nil || entry.Engine != kind {
			continue
		}
		currentInstalledAt := strings.TrimSpace(entry.InstalledAt)
		parsed, parseErr := time.Parse(time.RFC3339, currentInstalledAt)
		if latest == nil {
			copyEntry := *entry
			latest = &copyEntry
			latestInstalledAt = currentInstalledAt
			if parseErr == nil {
				latestParsed = parsed
				latestHasParsed = true
			}
			continue
		}

		if parseErr == nil {
			if !latestHasParsed || parsed.After(latestParsed) {
				copyEntry := *entry
				latest = &copyEntry
				latestInstalledAt = currentInstalledAt
				latestParsed = parsed
				latestHasParsed = true
			}
			continue
		}

		if !latestHasParsed && currentInstalledAt > latestInstalledAt {
			copyEntry := *entry
			latest = &copyEntry
			latestInstalledAt = currentInstalledAt
		}
	}

	return latest
}
