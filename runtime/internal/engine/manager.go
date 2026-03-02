package engine

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Manager is the facade for engine lifecycle management.
type Manager struct {
	logger   *slog.Logger
	baseDir  string
	registry *Registry
	onState  StateChangeFunc

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

	return &Manager{
		logger:      logger,
		baseDir:     baseDir,
		registry:    registry,
		onState:     onState,
		supervisors: make(map[EngineKind]*Supervisor),
	}, nil
}

// EnsureEngine ensures the engine binary is available.
// For LocalAI: downloads if not in registry.
// For Nexa: verifies system installation via LookPath.
func (m *Manager) EnsureEngine(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	switch cfg.Kind {
	case EngineLocalAI:
		return m.ensureLocalAI(ctx, cfg)
	case EngineNexa:
		return m.ensureNexa(cfg)
	default:
		return cfg, fmt.Errorf("unknown engine kind: %s", cfg.Kind)
	}
}

func (m *Manager) ensureLocalAI(_ context.Context, cfg EngineConfig) (EngineConfig, error) {
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
	return cfg, nil
}

func (m *Manager) ensureNexa(cfg EngineConfig) (EngineConfig, error) {
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

	return sup.Stop()
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
	defer m.mu.RUnlock()

	result := make([]SupervisorInfo, 0, len(m.supervisors))
	for _, s := range m.supervisors {
		result = append(result, s.Info())
	}
	return result
}

// Registry returns the underlying engine binary registry.
func (m *Manager) Registry() *Registry {
	return m.registry
}
