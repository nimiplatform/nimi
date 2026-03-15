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

	localAIModelsPath       string
	localAIModelsConfigPath string
	localAIBackendsPath     string
	localAIImageBackend     *LocalAIImageBackendConfig

	mu          sync.RWMutex
	supervisors map[EngineKind]*Supervisor
}

// NewManager creates a new engine manager.
// baseDir is the root engines directory (typically ~/.nimi/engines/).
func NewManager(logger *slog.Logger, baseDir string, onState StateChangeFunc) (*Manager, error) {
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

	modelsPath, modelsConfigPath, err := defaultLocalAIPaths()
	if err != nil {
		return nil, err
	}
	backendsPath, err := defaultLocalAIBackendsPath()
	if err != nil {
		return nil, err
	}

	return &Manager{
		logger:                  logger,
		baseDir:                 baseDir,
		registry:                registry,
		onState:                 onState,
		localAIModelsPath:       modelsPath,
		localAIModelsConfigPath: modelsConfigPath,
		localAIBackendsPath:     backendsPath,
		supervisors:             make(map[EngineKind]*Supervisor),
	}, nil
}

func defaultLocalAIPaths() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".nimi", "models"), filepath.Join(home, ".nimi", "runtime", "localai-models.yaml"), nil
}

func defaultLocalAIBackendsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".nimi", "runtime", "localai-backends"), nil
}

// SetLocalAIPaths overrides the default LocalAI model directory and generated
// config path used when callers do not explicitly populate EngineConfig.
func (m *Manager) SetLocalAIPaths(modelsPath string, modelsConfigPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.localAIModelsPath = strings.TrimSpace(modelsPath)
	m.localAIModelsConfigPath = strings.TrimSpace(modelsConfigPath)
}

// SetLocalAIImageBackend configures the daemon-managed LocalAI image backend
// process that should be registered via --external-grpc-backends.
func (m *Manager) SetLocalAIImageBackend(cfg *LocalAIImageBackendConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.localAIImageBackend = normalizeLocalAIImageBackendConfig(cfg)
}

func (m *Manager) applyLocalAIPaths(cfg EngineConfig) EngineConfig {
	if cfg.Kind != EngineLocalAI {
		return cfg
	}
	m.mu.RLock()
	modelsPath := strings.TrimSpace(m.localAIModelsPath)
	modelsConfigPath := strings.TrimSpace(m.localAIModelsConfigPath)
	backendsPath := strings.TrimSpace(m.localAIBackendsPath)
	imageBackend := cloneLocalAIImageBackendConfig(m.localAIImageBackend)
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
		cfg.ExternalBackends = detectLocalAIExternalBackends(cfg.ModelsConfigPath)
	} else {
		cfg.ExternalBackends = normalizeLocalAIExternalBackends(cfg.ExternalBackends)
	}
	if cfg.LocalAIImageBackend == nil {
		cfg.LocalAIImageBackend = normalizeLocalAIImageBackendConfig(imageBackend)
	} else {
		cfg.LocalAIImageBackend = normalizeLocalAIImageBackendConfig(cfg.LocalAIImageBackend)
	}
	return cfg
}

// EnsureEngine ensures the engine binary is available.
// For LocalAI: downloads if not in registry.
// For Nexa: verifies system installation via LookPath.
func (m *Manager) EnsureEngine(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	cfg = m.applyLocalAIPaths(cfg)
	switch cfg.Kind {
	case EngineLocalAI:
		return m.ensureLocalAI(ctx, cfg)
	case EngineNexa:
		return m.ensureNexa(ctx, cfg)
	case EngineNimiMedia:
		return ensureNimiMedia(ctx, m.baseDir, cfg)
	default:
		return cfg, fmt.Errorf("unknown engine kind: %s", cfg.Kind)
	}
}

func (m *Manager) ensureLocalAI(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	// Check registry first.
	entry := m.registry.Get(EngineLocalAI, cfg.Version)
	if entry != nil {
		if _, err := os.Stat(entry.BinaryPath); err == nil {
			cfg.BinaryPath = entry.BinaryPath
			m.logger.Info("localai binary found in registry",
				"version", cfg.Version,
				"path", entry.BinaryPath,
			)
			return cfg, nil
		}
		// Binary missing from disk — re-download.
		_ = m.registry.Remove(EngineLocalAI, cfg.Version)
	}

	m.logger.Info("downloading localai binary",
		"version", cfg.Version,
	)

	binaryPath, sha256hex, err := DownloadBinary(m.baseDir, EngineLocalAI, cfg.Version)
	if err != nil {
		return cfg, fmt.Errorf("download localai: %w", err)
	}

	if err := m.registry.Put(&RegistryEntry{
		Engine:      EngineLocalAI,
		Version:     cfg.Version,
		BinaryPath:  binaryPath,
		SHA256:      sha256hex,
		Platform:    PlatformString(),
		InstalledAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		m.logger.Warn("persist registry entry failed", "error", err)
	}

	cfg.BinaryPath = binaryPath
	resolvedImageBackend, err := ensureOfficialLocalAIImageBackend(ctx, cfg.BinaryPath, cfg.BackendsPath, cfg.LocalAIImageBackend)
	if err != nil {
		return cfg, fmt.Errorf("prepare localai image backend: %w", err)
	}
	cfg.LocalAIImageBackend = resolvedImageBackend
	return cfg, nil
}

func (m *Manager) ensureNexa(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	if currentGOOS() == "windows" {
		return ensureManagedNexa(ctx, m.baseDir, cfg)
	}
	path, err := nexaLookPath()
	if err != nil {
		return cfg, err
	}
	cfg.BinaryPath = path
	m.logger.Info("nexa found in system PATH", "path", path)
	return cfg, nil
}

// StartEngine starts the engine with the given configuration.
func (m *Manager) StartEngine(ctx context.Context, cfg EngineConfig) error {
	cfg = m.applyLocalAIPaths(cfg)
	if cfg.Kind == EngineLocalAI && strings.TrimSpace(cfg.BackendsPath) != "" {
		if err := os.MkdirAll(cfg.BackendsPath, 0o755); err != nil {
			return fmt.Errorf("create localai backends directory: %w", err)
		}
	}
	if cfg.Kind == EngineLocalAI {
		var err error
		cfg, err = m.prepareLocalAIStart(ctx, cfg)
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

	return sup.Start(ctx)
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
	if kind == EngineLocalAI {
		if err := m.stopLocalAIImageBackend(); err != nil {
			return err
		}
	}
	return nil
}

// StopAll stops all running engines.
func (m *Manager) StopAll() {
	m.mu.RLock()
	sups := make([]*Supervisor, 0, len(m.supervisors))
	for _, s := range m.supervisors {
		sups = append(sups, s)
	}
	m.mu.RUnlock()

	for _, s := range sups {
		if err := s.Stop(); err != nil {
			m.logger.Warn("stop engine failed",
				"engine", s.cfg.Kind,
				"error", err,
			)
		}
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
		if kind == engineLocalAIImageBackend {
			continue
		}
		running[kind] = s.Info()
	}
	m.mu.RUnlock()

	knownKinds := []EngineKind{EngineLocalAI, EngineNexa, EngineNimiMedia}
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
	case EngineLocalAI:
		cfg = DefaultLocalAIConfig()
	case EngineNexa:
		cfg = DefaultNexaConfig()
	case EngineNimiMedia:
		cfg = DefaultNimiMediaConfig()
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
	case EngineLocalAI:
		if latest := m.latestRegistryEntry(EngineLocalAI); latest != nil {
			if version := strings.TrimSpace(latest.Version); version != "" {
				info.Version = version
			}
			info.BinaryPath = strings.TrimSpace(latest.BinaryPath)
			if fi, err := os.Stat(info.BinaryPath); err == nil {
				info.BinarySizeBytes = fi.Size()
			}
		}
	case EngineNexa:
		if currentGOOS() == "windows" {
			path := managedNexaBinary(engineVersionDir(m.baseDir, EngineNexa, cfg.Version))
			if fi, statErr := os.Stat(path); statErr == nil {
				info.BinaryPath = strings.TrimSpace(path)
				info.BinarySizeBytes = fi.Size()
			}
			return info
		}
		if path, err := nexaLookPath(); err == nil {
			info.BinaryPath = strings.TrimSpace(path)
			if fi, statErr := os.Stat(info.BinaryPath); statErr == nil {
				info.BinarySizeBytes = fi.Size()
			}
		}
	case EngineNimiMedia:
		path := managedPythonPath(engineVersionDir(m.baseDir, EngineNimiMedia, cfg.Version))
		if fi, statErr := os.Stat(path); statErr == nil {
			info.BinaryPath = strings.TrimSpace(path)
			info.BinarySizeBytes = fi.Size()
		}
	}

	return info
}

func (m *Manager) prepareLocalAIStart(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	if cfg.LocalAIImageBackend == nil || !cfg.LocalAIImageBackend.Enabled() {
		return cfg, nil
	}
	resolvedImageBackend, err := ensureOfficialLocalAIImageBackend(ctx, cfg.BinaryPath, cfg.BackendsPath, cfg.LocalAIImageBackend)
	if err != nil {
		return cfg, fmt.Errorf("prepare localai image backend: %w", err)
	}
	cfg.LocalAIImageBackend = resolvedImageBackend
	auxCfg, err := localAIImageBackendEngineConfig(resolvedImageBackend)
	if err != nil {
		return cfg, err
	}
	if err := m.startLocalAIImageBackend(ctx, auxCfg); err != nil {
		return cfg, err
	}
	entry := strings.TrimSpace(resolvedImageBackend.BackendName) + ":" + strings.TrimSpace(resolvedImageBackend.Address)
	cfg.ExternalGRPCBackends = normalizeLocalAIExternalGRPCBackends(append(cfg.ExternalGRPCBackends, entry))
	return cfg, nil
}

func (m *Manager) startLocalAIImageBackend(ctx context.Context, cfg EngineConfig) error {
	m.mu.Lock()
	existing, ok := m.supervisors[engineLocalAIImageBackend]
	if ok && (existing.Status() == StatusHealthy || existing.Status() == StatusStarting) {
		m.mu.Unlock()
		return nil
	}
	if ok {
		delete(m.supervisors, engineLocalAIImageBackend)
	}
	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.supervisors[engineLocalAIImageBackend] = sup
	m.mu.Unlock()
	if ok {
		_ = existing.Stop()
	}
	return sup.Start(ctx)
}

func (m *Manager) stopLocalAIImageBackend() error {
	m.mu.RLock()
	sup, ok := m.supervisors[engineLocalAIImageBackend]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	return sup.Stop()
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
