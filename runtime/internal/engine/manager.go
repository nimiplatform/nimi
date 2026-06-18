package engine

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrManagedImageBackendMaterializationRequired = errors.New("managed image backend package materialization requires local environment dependency confirmation")

// ErrEngineBinaryDependencyNotReady is returned when a managed engine package
// has not been admitted by the local environment dependency state machine. It
// is intentionally not repaired here: first network/heavy materialization must
// run through Runtime local environment job control.
var ErrEngineBinaryDependencyNotReady = errors.New("engine binary dependency is not ready: local environment dependency confirmation required")

// ErrManagedRootUnresolved is returned when the engine manager is constructed
// without a usable K-CFG-018 data-plane root. Managed engine/dependency
// materialization fails closed rather than falling back to a home-directory
// install root. (K-CFG-018, K-LENG-004)
var ErrManagedRootUnresolved = errors.New("managed engine install root unresolved: product setup must record a nimi_data data root")

// ManagedRoots carries the K-CFG-018 data-plane install roots the engine
// manager materializes under. Both roots are resolved from the Runtime config
// dataRootRef / managedRoots and injected at construction; there is no
// home-directory fallback. (K-CFG-018, K-LENG-028)
type ManagedRoots struct {
	// Environments is the data-plane `environments` root: native engine
	// packages, the managed Python interpreter, venvs, package sets, Torch
	// wheels, and the engine binary registry.
	Environments string
	// Dependencies is the data-plane `dependencies` root: standalone
	// downloaded dependency payloads — the `uv` tool and the shared
	// accelerator/CUDA runtime.
	Dependencies string
}

// Manager is the facade for engine lifecycle management.
type Manager struct {
	logger   *slog.Logger
	baseDir  string
	depsDir  string
	registry *Registry
	onState  StateChangeFunc

	llamaModelsPath                   string
	llamaModelsConfigPath             string
	llamaBackendsPath                 string
	speechModelsPath                  string
	speechQwen3TTSPackageSetRoot      string
	speechQwen3ASRPackageSetRoot      string
	managedImageBackendsPath          string
	sharedAcceleratorDependenciesPath string
	managedImageBackend               *ManagedImageBackendConfig

	mu          sync.RWMutex
	supervisors map[EngineKind]*Supervisor
	starting    map[EngineKind]bool
}

// NewManager creates a new engine manager.
//
// roots carries the K-CFG-018 data-plane install roots. roots.Environments is
// the engine/runtime-environment install root (formerly the hardcoded
// ~/.nimi/engines tree); roots.Dependencies is the downloaded-payload root for
// the uv tool and the shared accelerator runtime. Both must be absolute paths
// resolved from the Runtime config data root; an empty Environments root fails
// closed with ErrManagedRootUnresolved rather than guessing a home-directory
// path. (K-CFG-018, K-LENG-004, K-LENG-028)
func NewManager(logger *slog.Logger, roots ManagedRoots, onState StateChangeFunc) (*Manager, error) {
	if logger == nil {
		logger = slog.Default()
	}
	baseDir := strings.TrimSpace(roots.Environments)
	if baseDir == "" {
		return nil, fmt.Errorf("create engine manager: %w", ErrManagedRootUnresolved)
	}
	if !filepath.IsAbs(baseDir) {
		return nil, fmt.Errorf("create engine manager: environments root %q is not an absolute path: %w", baseDir, ErrManagedRootUnresolved)
	}
	depsDir := strings.TrimSpace(roots.Dependencies)
	if depsDir == "" {
		return nil, fmt.Errorf("create engine manager: %w", ErrManagedRootUnresolved)
	}
	if !filepath.IsAbs(depsDir) {
		return nil, fmt.Errorf("create engine manager: dependencies root %q is not an absolute path: %w", depsDir, ErrManagedRootUnresolved)
	}

	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return nil, fmt.Errorf("create environments root directory: %w", err)
	}
	if err := os.MkdirAll(depsDir, 0o755); err != nil {
		return nil, fmt.Errorf("create dependencies root directory: %w", err)
	}

	registry, err := NewRegistry(baseDir)
	if err != nil {
		return nil, fmt.Errorf("load engine registry: %w", err)
	}

	modelsConfigPath, err := defaultLlamaModelsConfigPath()
	if err != nil {
		return nil, err
	}

	return &Manager{
		logger:                            logger,
		baseDir:                           baseDir,
		depsDir:                           depsDir,
		registry:                          registry,
		onState:                           onState,
		llamaModelsPath:                   "",
		llamaModelsConfigPath:             modelsConfigPath,
		llamaBackendsPath:                 filepath.Join(baseDir, "llama-backends"),
		managedImageBackendsPath:          filepath.Join(baseDir, "managed-image-backends"),
		sharedAcceleratorDependenciesPath: filepath.Join(depsDir, "accelerator-dependencies"),
		supervisors:                       make(map[EngineKind]*Supervisor),
		starting:                          make(map[EngineKind]bool),
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

// defaultLlamaModelsConfigPath resolves the runtime-private generated managed
// llama router config path. This is a generated daemon-identity-scoped config
// file (not a downloadable dependency payload), so it remains under the
// runtime-private `~/.nimi/runtime/` directory. The daemon overrides it via
// SetLlamaPaths with resolveManagedLlamaModelsConfigPath, which uses the same
// runtime-private path; this default is the engine-package fallback only.
func defaultLlamaModelsConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, ".nimi", "runtime", "llama-models.yaml"), nil
}

// SetLlamaPaths overrides the default llama model directory and generated
// config path used when callers do not explicitly populate EngineConfig.
func (m *Manager) SetLlamaPaths(modelsPath string, modelsConfigPath string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.llamaModelsPath = strings.TrimSpace(modelsPath)
	m.llamaModelsConfigPath = strings.TrimSpace(modelsConfigPath)
}

// SetSpeechPaths injects Runtime-verified speech materialization records into
// the supervised speech host. The roots come from selected python.package-set
// records; startup must fail closed when they are absent.
func (m *Manager) SetSpeechPaths(modelsPath string, qwen3TTSPackageSetRoot string, qwen3ASRPackageSetRoot string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.speechModelsPath = strings.TrimSpace(modelsPath)
	m.speechQwen3TTSPackageSetRoot = strings.TrimSpace(qwen3TTSPackageSetRoot)
	m.speechQwen3ASRPackageSetRoot = strings.TrimSpace(qwen3ASRPackageSetRoot)
}

func (m *Manager) applyLlamaPaths(cfg EngineConfig) EngineConfig {
	if cfg.Kind != EngineLlama {
		return cfg
	}
	m.mu.RLock()
	modelsPath := strings.TrimSpace(m.llamaModelsPath)
	modelsConfigPath := strings.TrimSpace(m.llamaModelsConfigPath)
	backendsPath := strings.TrimSpace(m.llamaBackendsPath)
	m.mu.RUnlock()
	if cfg.ModelsPath == "" {
		cfg.ModelsPath = modelsPath
	}
	if cfg.ManagedLlamaTarget == nil && cfg.ModelsConfigPath == "" {
		cfg.ModelsConfigPath = modelsConfigPath
	}
	if cfg.BackendsPath == "" {
		cfg.BackendsPath = backendsPath
	}
	if cfg.ManagedLlamaTarget != nil {
		cfg.ModelsConfigPath = ""
		cfg.ExternalBackends = normalizeLlamaExternalBackends(cfg.ExternalBackends)
	} else if len(cfg.ExternalBackends) == 0 {
		cfg.ExternalBackends = detectLlamaExternalBackends(cfg.ModelsConfigPath)
	} else {
		cfg.ExternalBackends = normalizeLlamaExternalBackends(cfg.ExternalBackends)
	}
	return cfg
}

func (m *Manager) applySpeechPaths(cfg EngineConfig) EngineConfig {
	if cfg.Kind != EngineSpeech {
		return cfg
	}
	m.mu.RLock()
	modelsPath := strings.TrimSpace(m.speechModelsPath)
	ttsPackageSetRoot := strings.TrimSpace(m.speechQwen3TTSPackageSetRoot)
	asrPackageSetRoot := strings.TrimSpace(m.speechQwen3ASRPackageSetRoot)
	m.mu.RUnlock()
	if cfg.ModelsPath == "" {
		cfg.ModelsPath = modelsPath
	}
	if cfg.SpeechQwen3TTSPackageSetRoot == "" {
		cfg.SpeechQwen3TTSPackageSetRoot = ttsPackageSetRoot
	}
	if cfg.SpeechQwen3ASRPackageSetRoot == "" {
		cfg.SpeechQwen3ASRPackageSetRoot = asrPackageSetRoot
	}
	return cfg
}

// EnsureEngine verifies the engine binary/environment is available.
// Llama is read-only here: first materialization is owned by
// EnsureEngineBinaryDependency, which is called by local environment jobs.
func (m *Manager) EnsureEngine(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	cfg = m.applyLlamaPaths(cfg)
	cfg = m.applySpeechPaths(cfg)
	switch cfg.Kind {
	case EngineLlama:
		return m.requireLlamaBinaryDependency(cfg)
	case EngineMedia:
		return ensureMedia(ctx, m.baseDir, cfg)
	case EngineSpeech:
		return ensureSpeech(ctx, m.baseDir, cfg)
	default:
		return cfg, fmt.Errorf("unknown engine kind: %s", cfg.Kind)
	}
}

// RequireEngineBinaryDependency verifies that a native engine package has
// already been materialized and recorded. It never downloads or repairs.
func (m *Manager) RequireEngineBinaryDependency(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	_ = ctx
	cfg = m.applyLlamaPaths(cfg)
	switch cfg.Kind {
	case EngineLlama:
		return m.requireLlamaBinaryDependency(cfg)
	default:
		return cfg, fmt.Errorf("engine binary dependency readiness is not admitted for %s", cfg.Kind)
	}
}

func (m *Manager) EnsureEngineBinaryDependency(ctx context.Context, cfg EngineConfig) (EngineBinaryDependencyStatus, error) {
	cfg = m.applyLlamaPaths(cfg)
	switch cfg.Kind {
	case EngineLlama:
		ensured, err := m.ensureLlama(ctx, cfg)
		if err != nil {
			return EngineBinaryDependencyStatus{}, err
		}
		entry := m.registry.Get(EngineLlama, ensured.Version)
		if entry == nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("llama registry entry missing after materialization")
		}
		if strings.TrimSpace(entry.BinaryPath) == "" {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("llama registry entry missing binary path after materialization")
		}
		fi, err := os.Stat(entry.BinaryPath)
		if err != nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("verify llama binary path %s: %w", entry.BinaryPath, err)
		}
		return EngineBinaryDependencyStatus{
			Engine:           string(EngineLlama),
			Version:          strings.TrimSpace(entry.Version),
			BinaryPath:       strings.TrimSpace(entry.BinaryPath),
			BinarySizeBytes:  fi.Size(),
			SHA256:           strings.TrimSpace(entry.SHA256),
			Platform:         strings.TrimSpace(entry.Platform),
			AssetName:        strings.TrimSpace(entry.AssetName),
			AcceleratorPlane: strings.TrimSpace(entry.AcceleratorPlane),
			Detail:           "llama engine package verified from Runtime registry",
		}, nil
	default:
		return EngineBinaryDependencyStatus{}, fmt.Errorf("engine binary dependency is not admitted for %s", cfg.Kind)
	}
}

func (m *Manager) ensureLlama(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	preferredAssetName, preferredAssetErr := preferredLlamaAssetNameForCurrentHost(cfg.Version)
	// Check registry first.
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if entry != nil {
		if _, err := os.Stat(entry.BinaryPath); err == nil {
			if preferredAssetErr == nil && llamaRegistryEntryRequiresReplacement(entry, preferredAssetName) {
				m.logger.Info("llama binary registry entry does not match preferred accelerator package",
					"version", cfg.Version,
					"registered_asset", entry.AssetName,
					"preferred_asset", preferredAssetName,
				)
				_ = m.registry.Remove(EngineLlama, cfg.Version)
			} else {
				cfg.BinaryPath = entry.BinaryPath
				m.logger.Info("llama binary found in registry",
					"version", cfg.Version,
					"path", entry.BinaryPath,
				)
				return cfg, nil
			}
		}
		// Binary missing from disk — re-download.
		_ = m.registry.Remove(EngineLlama, cfg.Version)
	}

	m.logger.Info("downloading llama binary",
		"version", cfg.Version,
	)

	binaryPath, sha256hex, assetName, err := DownloadBinaryWithContext(ctx, m.baseDir, EngineLlama, cfg.Version)
	if err != nil {
		return cfg, fmt.Errorf("download llama: %w", err)
	}

	if err := m.registry.Put(&RegistryEntry{
		Engine:           EngineLlama,
		Version:          cfg.Version,
		BinaryPath:       binaryPath,
		SHA256:           sha256hex,
		Platform:         PlatformString(),
		AssetName:        assetName,
		AcceleratorPlane: llamaAcceleratorPlaneForAsset(assetName),
		InstalledAt:      time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return cfg, fmt.Errorf("persist llama registry entry version %s at %s: %w", cfg.Version, binaryPath, err)
	}

	cfg.BinaryPath = binaryPath
	return cfg, nil
}

func (m *Manager) requireLlamaBinaryDependency(cfg EngineConfig) (EngineConfig, error) {
	if strings.TrimSpace(cfg.Version) == "" {
		cfg.Version = DefaultLlamaConfig().Version
	}
	preferredAssetName, preferredAssetErr := preferredLlamaAssetNameForCurrentHost(cfg.Version)
	if m.registry == nil {
		return cfg, fmt.Errorf("%w: llama.cpp.package registry unavailable", ErrEngineBinaryDependencyNotReady)
	}
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if entry == nil {
		detail := "state=needs_confirmation; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; first_network_materialization_requires_confirmation=true"
		if preferredAssetErr != nil {
			detail = detail + "; preferred_asset_error=" + preferredAssetErr.Error()
		} else {
			detail = detail + "; preferred_asset=" + preferredAssetName
		}
		return cfg, fmt.Errorf("%w: %s", ErrEngineBinaryDependencyNotReady, detail)
	}
	if preferredAssetErr == nil && llamaRegistryEntryRequiresReplacement(entry, preferredAssetName) {
		return cfg, fmt.Errorf("%w: state=needs_confirmation; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; registered_asset=%s; preferred_asset=%s", ErrEngineBinaryDependencyNotReady, strings.TrimSpace(entry.AssetName), preferredAssetName)
	}
	binaryPath := strings.TrimSpace(entry.BinaryPath)
	if binaryPath == "" {
		return cfg, fmt.Errorf("%w: state=repair_required; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; registry entry missing binary path", ErrEngineBinaryDependencyNotReady)
	}
	if _, err := os.Stat(binaryPath); err != nil {
		return cfg, fmt.Errorf("%w: state=repair_required; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; binary_path=%s; stat_error=%v", ErrEngineBinaryDependencyNotReady, binaryPath, err)
	}
	cfg.BinaryPath = binaryPath
	return cfg, nil
}

// StartEngine starts the engine with the given configuration.
func (m *Manager) StartEngine(ctx context.Context, cfg EngineConfig) error {
	cfg = m.applyLlamaPaths(cfg)
	cfg = m.applySpeechPaths(cfg)
	cfg.SupervisedRoot = m.baseDir
	if cfg.Kind == EngineLlama {
		var err error
		cfg, err = m.requireLlamaBinaryDependency(cfg)
		if err != nil {
			return err
		}
	}
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
	existing, hasExisting := m.supervisors[cfg.Kind]
	if hasExisting {
		if existing.Status() == StatusHealthy || existing.Status() == StatusStarting {
			m.mu.Unlock()
			return fmt.Errorf("engine %s already running", cfg.Kind)
		}
		// A non-healthy supervisor for this engine is still present: its
		// monitor goroutine and crash/restart loop are alive and may keep
		// spawning processes. Drop it from the map and stop it before
		// installing a replacement so two supervision cycles never spawn the
		// same engine concurrently (the port-8330 double-spawn).
		delete(m.supervisors, cfg.Kind)
	}
	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.supervisors[cfg.Kind] = sup
	m.mu.Unlock()

	if hasExisting && existing != nil {
		if err := existing.Stop(); err != nil {
			m.logger.Warn("stop superseded engine supervisor failed",
				"engine", cfg.Kind,
				"error", err,
			)
		}
	}

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
		if kind == engineManagedImageBackend {
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

func (m *Manager) prepareLlamaStart(_ context.Context, cfg EngineConfig) (EngineConfig, error) {
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if !llamaRegistryEntryUsesCUDA(entry) {
		return cfg, nil
	}
	status := m.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, "llama.cpp.cuda")
	if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged {
		return cfg, fmt.Errorf("llama.cpp CUDA package requires shared accelerator dependency %s to be ready before activation: state=%s detail=%s", status.DependencyID, status.State, status.Detail)
	}
	env, err := m.SharedAcceleratorDependencyProcessEnv(NVIDIACUDAUserSpaceRuntimeDependencyID)
	if err != nil {
		return cfg, err
	}
	if len(env) > 0 {
		if cfg.CommandEnv == nil {
			cfg.CommandEnv = make(map[string]string, len(env))
		}
		for key, value := range env {
			cfg.CommandEnv[key] = value
		}
	}
	return cfg, nil
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
