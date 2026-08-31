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

// ErrEngineNotRunning identifies an idempotent stop target that is already
// absent from the Manager. Callers that own a private execution lifecycle can
// distinguish this from a Supervisor failure to terminate a tracked process
// tree.
var ErrEngineNotRunning = errors.New("engine is not running")
var ErrEngineManagerStopped = errors.New("engine manager is stopped")
var ErrEngineManagerDataRootQuiesced = errors.New("engine manager data-root admission is closed")
var ErrEngineRegistryReconciliationRequired = errors.New("engine registry requires Check & Sync reconciliation")

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
	// packages, the managed Python interpreter, immutable dependency profiles,
	// and the engine binary registry.
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

	speechModelsPath                  string
	speechQwen3TTSPackageSetRoot      string
	speechQwen3ASRPackageSetRoot      string
	runtimeWorkRoot                   string
	managedImageBackendsPath          string
	sharedAcceleratorDependenciesPath string
	managedImageBackend               *ManagedImageBackendConfig

	mu                         sync.RWMutex
	uvToolMu                   sync.Mutex
	espeakNGMu                 sync.Mutex
	pythonRuntimeMu            sync.Mutex
	pythonProfileMu            sync.Mutex
	pythonProfileLocks         map[string]chan struct{}
	pythonProfileVerifications map[string]pythonDependencyProfileVerificationCacheEntry
	supervisors                map[EngineKind]*Supervisor
	starting                   map[EngineKind]bool
	stopped                    bool
	dataRootAdmissionClosed    bool
	startStateChanged          chan struct{}
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

	return &Manager{
		logger:                            logger,
		baseDir:                           baseDir,
		depsDir:                           depsDir,
		registry:                          registry,
		onState:                           onState,
		managedImageBackendsPath:          filepath.Join(baseDir, "managed-image-backends"),
		sharedAcceleratorDependenciesPath: filepath.Join(depsDir, "accelerator-dependencies"),
		pythonProfileLocks:                make(map[string]chan struct{}),
		pythonProfileVerifications:        make(map[string]pythonDependencyProfileVerificationCacheEntry),
		supervisors:                       make(map[EngineKind]*Supervisor),
		starting:                          make(map[EngineKind]bool),
		startStateChanged:                 make(chan struct{}),
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

// SetRuntimeWorkRoot binds transient supervised-engine work to Runtime-owned
// state. Protected callers derive this root from the verified service state
// path; it is never accepted from an engine request or inherited environment.
func (m *Manager) SetRuntimeWorkRoot(root string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimeWorkRoot = strings.TrimSpace(root)
}

func (m *Manager) applySpeechPaths(cfg EngineConfig) EngineConfig {
	if cfg.Kind != EngineSpeech {
		return cfg
	}
	m.mu.RLock()
	modelsPath := strings.TrimSpace(m.speechModelsPath)
	ttsPackageSetRoot := strings.TrimSpace(m.speechQwen3TTSPackageSetRoot)
	asrPackageSetRoot := strings.TrimSpace(m.speechQwen3ASRPackageSetRoot)
	runtimeWorkRoot := strings.TrimSpace(m.runtimeWorkRoot)
	m.mu.RUnlock()
	if cfg.ModelsPath == "" {
		cfg.ModelsPath = modelsPath
	}
	// An explicit Host root marks a capability-scoped composition. Empty
	// sibling Driver roots are intentional there and must not be repopulated
	// from the aggregate defaults as cross-capability prefetch.
	if strings.TrimSpace(cfg.SpeechHostPackageSetRoot) == "" {
		if cfg.SpeechQwen3TTSPackageSetRoot == "" {
			cfg.SpeechQwen3TTSPackageSetRoot = ttsPackageSetRoot
		}
		if cfg.SpeechQwen3ASRPackageSetRoot == "" {
			cfg.SpeechQwen3ASRPackageSetRoot = asrPackageSetRoot
		}
	}
	if cfg.SpeechDriverWorkRoot == "" && runtimeWorkRoot != "" {
		cfg.SpeechDriverWorkRoot = filepath.Join(runtimeWorkRoot, "speech-driver")
	}
	return cfg
}

// EnsureEngine verifies the engine binary/environment is available.
// Llama is read-only here: first materialization is owned by
// EnsureEngineBinaryDependency, which is called by local environment jobs.
func (m *Manager) EnsureEngine(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	cfg = m.applySpeechPaths(cfg)
	switch cfg.Kind {
	case EngineLlama:
		return m.requireLlamaBinaryDependency(cfg)
	case EngineMedia:
		m.mu.RLock()
		runtimeWorkRoot := strings.TrimSpace(m.runtimeWorkRoot)
		m.mu.RUnlock()
		return ensureMedia(ctx, runtimeWorkRoot, cfg)
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
	switch cfg.Kind {
	case EngineLlama:
		return m.requireLlamaBinaryDependency(cfg)
	case EngineAudioCPP:
		return m.requireAudioCppBinaryDependency(cfg)
	default:
		return cfg, fmt.Errorf("engine binary dependency readiness is not admitted for %s", cfg.Kind)
	}
}

func (m *Manager) EnsureEngineBinaryDependency(ctx context.Context, cfg EngineConfig) (EngineBinaryDependencyStatus, error) {
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
		preferredAssetName, err := preferredLlamaAssetNameForCurrentHost(ensured.Version)
		if err != nil {
			return EngineBinaryDependencyStatus{}, err
		}
		if err := verifyLlamaRegistryEntryForCurrentHost(entry, preferredAssetName); err != nil {
			return EngineBinaryDependencyStatus{}, fmt.Errorf("verify llama registry entry: %w", err)
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
	case EngineAudioCPP:
		return m.ensureAudioCppBinaryDependency(ctx, cfg)
	default:
		return EngineBinaryDependencyStatus{}, fmt.Errorf("engine binary dependency is not admitted for %s", cfg.Kind)
	}
}

func (m *Manager) ensureLlama(ctx context.Context, cfg EngineConfig) (EngineConfig, error) {
	if m.registry.PendingRebase(EngineLlama, cfg.Version) {
		return cfg, fmt.Errorf("%w: engine=%s version=%s", ErrEngineRegistryReconciliationRequired, EngineLlama, cfg.Version)
	}
	if reason := m.registry.ConflictReason(EngineLlama, cfg.Version); reason != "" {
		return cfg, fmt.Errorf("%w: engine=%s version=%s reason=%s", ErrEngineRegistryReconciliationRequired, EngineLlama, cfg.Version, reason)
	}
	preferredAssetName, preferredAssetErr := preferredLlamaAssetNameForCurrentHost(cfg.Version)
	if preferredAssetErr != nil {
		return cfg, fmt.Errorf("llama.cpp package is unsupported on the exact host backend: %w", preferredAssetErr)
	}
	// Check registry first.
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if entry != nil {
		if err := verifyLlamaRegistryEntryForCurrentHost(entry, preferredAssetName); err == nil {
			cfg.BinaryPath = entry.BinaryPath
			m.logger.Info("llama binary found in registry",
				"version", cfg.Version,
				"path", entry.BinaryPath,
			)
			return cfg, nil
		} else {
			m.logger.Info("llama binary registry entry requires owner re-verification",
				"version", cfg.Version,
				"detail", err.Error(),
			)
		}
		// Missing or unverifiable owner material is never reused implicitly. Keep
		// its durable record until the verified replacement can be committed so a
		// failed download cannot erase owner intent.
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
	if m.registry == nil {
		return cfg, fmt.Errorf("%w: llama.cpp.package registry unavailable", ErrEngineBinaryDependencyNotReady)
	}
	if m.registry.PendingRebase(EngineLlama, cfg.Version) {
		return cfg, fmt.Errorf("%w: state=reconciliation_required; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package", ErrEngineRegistryReconciliationRequired)
	}
	if reason := m.registry.ConflictReason(EngineLlama, cfg.Version); reason != "" {
		return cfg, fmt.Errorf("%w: state=conflict; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; reason=%s", ErrEngineRegistryReconciliationRequired, reason)
	}
	preferredAssetName, preferredAssetErr := preferredLlamaAssetNameForCurrentHost(cfg.Version)
	if preferredAssetErr != nil {
		return cfg, fmt.Errorf("%w: state=unsupported; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; detail=%v", ErrEngineBinaryDependencyNotReady, preferredAssetErr)
	}
	entry := m.registry.Get(EngineLlama, cfg.Version)
	if entry == nil {
		detail := "state=needs_confirmation; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; first_network_materialization_requires_confirmation=true"
		detail = detail + "; preferred_asset=" + preferredAssetName
		return cfg, fmt.Errorf("%w: %s", ErrEngineBinaryDependencyNotReady, detail)
	}
	if err := verifyLlamaRegistryEntryForCurrentHost(entry, preferredAssetName); err != nil {
		return cfg, fmt.Errorf("%w: state=repair_required; dependency_family=native-engine-package.llama; dependency_id=llama.cpp.package; detail=%v", ErrEngineBinaryDependencyNotReady, err)
	}
	binaryPath := strings.TrimSpace(entry.BinaryPath)
	cfg.BinaryPath = binaryPath
	return cfg, nil
}

// StartEngine starts the engine with the given configuration.
func (m *Manager) StartEngine(ctx context.Context, cfg EngineConfig) error {
	m.mu.RLock()
	stopped := m.stopped
	dataRootAdmissionClosed := m.dataRootAdmissionClosed
	m.mu.RUnlock()
	if stopped {
		return ErrEngineManagerStopped
	}
	if dataRootAdmissionClosed {
		return ErrEngineManagerDataRootQuiesced
	}
	if err := m.beginEngineStart(cfg.Kind); err != nil {
		return err
	}
	defer m.finishEngineStart(cfg.Kind)
	cfg = m.applySpeechPaths(cfg)
	cfg.SupervisedRoot = m.baseDir
	if cfg.Kind == EngineLlama {
		var err error
		cfg, err = m.requireLlamaBinaryDependency(cfg)
		if err != nil {
			return err
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
	if m.stopped {
		m.mu.Unlock()
		return ErrEngineManagerStopped
	}
	if m.dataRootAdmissionClosed {
		m.mu.Unlock()
		return ErrEngineManagerDataRootQuiesced
	}
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
	m.mu.Unlock()

	if hasExisting && existing != nil {
		if err := existing.Stop(); err != nil {
			m.mu.Lock()
			if _, occupied := m.supervisors[cfg.Kind]; !occupied {
				m.supervisors[cfg.Kind] = existing
			}
			m.mu.Unlock()
			return fmt.Errorf("stop superseded engine supervisor %s: %w", cfg.Kind, err)
		}
	}

	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.mu.Lock()
	if m.stopped || m.dataRootAdmissionClosed {
		m.mu.Unlock()
		if m.stopped {
			return ErrEngineManagerStopped
		}
		return ErrEngineManagerDataRootQuiesced
	}
	m.supervisors[cfg.Kind] = sup
	m.mu.Unlock()

	if err := sup.Start(ctx); err != nil {
		// A failed start is removable only after its tracked process tree is
		// confirmed absent. Preserve a Supervisor whose cancellation cleanup
		// failed so the private Host can retry Stop and poison only when tree
		// termination still cannot be confirmed.
		if !supervisedProcessBlocksStart(sup.currentProcess()) {
			m.removeSupervisorIfCurrent(cfg.Kind, sup)
		}
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
		return fmt.Errorf("engine %s not found: %w", kind, ErrEngineNotRunning)
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

	m.mu.Lock()
	m.stopped = true
	m.dataRootAdmissionClosed = true
	m.signalStartStateChangedLocked()
	for len(m.starting) > 0 {
		changed := m.startStateChanged
		m.mu.Unlock()
		<-changed
		m.mu.Lock()
	}
	sups := make([]managedSupervisor, 0, len(m.supervisors))
	for kind, s := range m.supervisors {
		sups = append(sups, managedSupervisor{kind: kind, sup: s})
	}
	m.mu.Unlock()

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

func (m *Manager) QuiesceDataRoot(ctx context.Context) error {
	if m == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	type managedSupervisor struct {
		kind EngineKind
		sup  *Supervisor
	}
	m.mu.Lock()
	m.dataRootAdmissionClosed = true
	m.signalStartStateChangedLocked()
	for len(m.starting) > 0 {
		changed := m.startStateChanged
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for engine starts before data-root handoff: %w", ctx.Err())
		case <-changed:
		}
		m.mu.Lock()
	}
	supervisors := make([]managedSupervisor, 0, len(m.supervisors))
	for kind, supervisor := range m.supervisors {
		supervisors = append(supervisors, managedSupervisor{kind: kind, sup: supervisor})
	}
	m.mu.Unlock()
	var errs []error
	for _, entry := range supervisors {
		if entry.sup == nil {
			m.removeSupervisorIfCurrent(entry.kind, nil)
			continue
		}
		if err := entry.sup.Stop(); err != nil {
			errs = append(errs, fmt.Errorf("stop engine %s for data-root handoff: %w", entry.kind, err))
			continue
		}
		m.removeSupervisorIfCurrent(entry.kind, entry.sup)
	}
	return errors.Join(errs...)
}

func (m *Manager) ResumeDataRootAfterAbort() {
	if m == nil {
		return
	}
	m.mu.Lock()
	if !m.stopped {
		m.dataRootAdmissionClosed = false
		m.signalStartStateChangedLocked()
	}
	m.mu.Unlock()
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

// UnhealthyEngines returns the current unhealthy state of every tracked
// Supervisor. Unlike ListEngines, it includes private execution-host kinds so
// daemon readiness can remain degraded until every affected supervised engine
// has recovered.
func (m *Manager) UnhealthyEngines() []SupervisorInfo {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	supervisors := make([]*Supervisor, 0, len(m.supervisors))
	for _, supervisor := range m.supervisors {
		if supervisor != nil {
			supervisors = append(supervisors, supervisor)
		}
	}
	m.mu.RUnlock()

	result := make([]SupervisorInfo, 0, len(supervisors))
	for _, supervisor := range supervisors {
		info := supervisor.Info()
		if info.Status == StatusUnhealthy {
			result = append(result, info)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Kind < result[j].Kind
	})
	return result
}

// ListEngines returns status info for all managed engines.
func (m *Manager) ListEngines() []SupervisorInfo {
	m.mu.RLock()
	running := make(map[EngineKind]SupervisorInfo, len(m.supervisors))
	for kind, s := range m.supervisors {
		if kind == engineManagedImageBackend || kind == engineImageExecutionHost || kind == engineVideoExecutionHost {
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
	if m.stopped {
		return ErrEngineManagerStopped
	}
	if m.dataRootAdmissionClosed {
		return ErrEngineManagerDataRootQuiesced
	}
	if m.starting[kind] {
		return fmt.Errorf("engine %s already running", kind)
	}
	if existing, ok := m.supervisors[kind]; ok {
		if existing.Status() == StatusHealthy || existing.Status() == StatusStarting {
			return fmt.Errorf("engine %s already running", kind)
		}
	}
	m.starting[kind] = true
	m.signalStartStateChangedLocked()
	return nil
}

func (m *Manager) finishEngineStart(kind EngineKind) {
	m.mu.Lock()
	delete(m.starting, kind)
	m.signalStartStateChangedLocked()
	m.mu.Unlock()
}

func (m *Manager) signalStartStateChangedLocked() {
	if m.startStateChanged != nil {
		close(m.startStateChanged)
	}
	m.startStateChanged = make(chan struct{})
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
