package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/httpserver"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

// Daemon wires runtime servers and health state lifecycle.
type Daemon struct {
	cfg        config.Config
	logger     *slog.Logger
	state      *health.State
	grpc       *grpcserver.Server
	http       *httpserver.Server
	aiHealth   *providerhealth.Tracker
	auditStore *auditlog.Store
	engineMgr  *engine.Manager

	newEngineManager          func(logger *slog.Logger, baseDir string, onState engine.StateChangeFunc) (*engine.Manager, error)
	startEngineFn             func(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error
	probeAIProviderFn         func(ctx context.Context, client *http.Client, target aiProviderTarget) error
	detectMediaHostSupportFn  func() (engine.MediaHostSupport, string)
	imageBootstrapSelectionFn func() (engine.ImageSupervisedMatrixSelection, bool)

	providerFailureHintMu sync.RWMutex
	providerFailureHints  map[string]string
	startupStatusMu       sync.Mutex
	startupDegradedReason string
	stopSupervisedOnce    sync.Once
	stopSupervisedFn      func()

	// resolvedImageMatrix caches the v2 image supervised matrix selection
	// from startup. Used for health attribution detail enrichment per K-PROV-002.
	resolvedImageMatrix *engine.ImageSupervisedMatrixSelection
}

const (
	engineManagedImageBackend = engine.EngineKind("managed-image-backend")
	engineSidecar             = engine.EngineKind("sidecar")
)

func New(cfg config.Config, logger *slog.Logger, version string) (*Daemon, error) {
	if value := strings.TrimSpace(cfg.LocalStatePath); value != "" {
		if err := runtimeSetenv("NIMI_RUNTIME_LOCAL_STATE_PATH", value); err != nil {
			return nil, fmt.Errorf("set NIMI_RUNTIME_LOCAL_STATE_PATH: %w", err)
		}
	}
	state := health.NewState()
	grpcServer, err := grpcserver.New(cfg, state, logger, version)
	if err != nil {
		return nil, err
	}
	return &Daemon{
		cfg:                      cfg,
		logger:                   logger,
		state:                    state,
		grpc:                     grpcServer,
		http:                     httpserver.New(cfg.HTTPAddr, state, logger, grpcServer.AIHealthTracker()),
		aiHealth:                 nil,
		auditStore:               nil,
		newEngineManager:         engine.NewManager,
		probeAIProviderFn:        probeAIProvider,
		detectMediaHostSupportFn: engine.DetectMediaHostSupport,
		providerFailureHints:     map[string]string{},
	}, nil
}

func (d *Daemon) Run(ctx context.Context) error {
	d.aiHealth = d.grpc.AIHealthTracker()
	d.auditStore = d.grpc.AuditStore()
	d.state.SetStatus(health.StatusStarting, "booting")
	d.grpc.SyncServingState()

	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()
	var backgroundWG sync.WaitGroup
	backgroundWG.Add(2)
	go func() {
		defer backgroundWG.Done()
		d.sampleRuntimeResource(backgroundCtx)
	}()

	errCh := make(chan error, 2)
	go func() {
		errCh <- d.grpc.Serve()
	}()
	go func() {
		errCh <- d.http.Serve()
	}()

	// Start supervised engines if configured.
	d.startSupervisedEngines(ctx)

	startupDegradedReason := d.consumeStartupDegradedReason()
	d.state.SetStatus(health.StatusReady, "ready")
	d.grpc.SyncServingState()
	d.logger.Info("runtime ready", "grpc_addr", d.cfg.GRPCAddr, "http_addr", d.cfg.HTTPAddr)
	if startupDegradedReason != "" {
		d.transitionToDegraded(startupDegradedReason)
		d.logger.Warn("runtime started in degraded state", "reason", startupDegradedReason)
	}

	go func() {
		defer backgroundWG.Done()
		d.sampleAIProviderHealth(backgroundCtx)
	}()

	var serveErr error
	remainingServers := cap(errCh)
waitForShutdown:
	for remainingServers > 0 {
		select {
		case <-ctx.Done():
			d.logger.Info("runtime shutdown requested")
			break waitForShutdown
		case err := <-errCh:
			remainingServers--
			if err == nil {
				d.logger.Warn("runtime server exited without error before shutdown")
				continue
			}
			serveErr = err
			d.logger.Error("runtime server exited with error", "error", err)
			break waitForShutdown
		}
	}

	cancelBackground()
	backgroundWG.Wait()
	shutdownErr := d.shutdown()

	if serveErr != nil {
		if shutdownErr != nil {
			return fmt.Errorf("serve error: %w (shutdown: %v)", serveErr, shutdownErr)
		}
		return serveErr
	}
	return shutdownErr
}

func (d *Daemon) shutdown() error {
	d.state.SetStatus(health.StatusStopping, "shutting down")
	d.grpc.SyncServingState()

	d.stopSupervisedEngines("stopping supervised engines")

	ctx, cancel := context.WithTimeout(context.Background(), d.cfg.ShutdownTimeout)
	defer cancel()

	httpErr := d.http.Shutdown(ctx)
	grpcErr := d.grpc.Stop(ctx)

	d.state.SetStatus(health.StatusStopped, "stopped")

	if httpErr != nil {
		return fmt.Errorf("shutdown http: %w", httpErr)
	}
	if grpcErr != nil {
		return fmt.Errorf("shutdown grpc: %w", grpcErr)
	}
	return nil
}

func (d *Daemon) EmergencyStopSupervisedEngines() {
	d.stopSupervisedEngines("forcing supervised engines to stop after repeated shutdown signal")
}

func (d *Daemon) stopSupervisedEngines(reason string) {
	d.stopSupervisedOnce.Do(func() {
		stopFn := d.stopSupervisedFn
		if stopFn == nil && d.engineMgr != nil {
			stopFn = d.engineMgr.StopAll
		}
		if stopFn == nil {
			return
		}
		d.logger.Info(reason)
		stopFn()
	})
}

func (d *Daemon) sampleRuntimeResource(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			d.state.SetResource(0, int64(ms.Alloc), 0)
		}
	}
}

func (d *Daemon) setDegradedStatus(reason string) {
	trimmedReason := strings.TrimSpace(reason)
	if trimmedReason == "" {
		trimmedReason = "degraded"
	}
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStarting {
		d.startupStatusMu.Lock()
		if d.startupDegradedReason == "" {
			d.startupDegradedReason = trimmedReason
		}
		d.startupStatusMu.Unlock()
		return
	}
	d.transitionToDegraded(trimmedReason)
}

func (d *Daemon) transitionToDegraded(reason string) {
	d.state.SetStatus(health.StatusDegraded, reason)
	d.grpc.SyncServingState()
}

func (d *Daemon) consumeStartupDegradedReason() string {
	d.startupStatusMu.Lock()
	defer d.startupStatusMu.Unlock()
	reason := strings.TrimSpace(d.startupDegradedReason)
	d.startupDegradedReason = ""
	return reason
}

func (d *Daemon) startSupervisedEngines(ctx context.Context) {
	svc := d.grpc.LocalService()
	effectiveManagedLlama := d.cfg.EngineLlamaEnabled
	if !effectiveManagedLlama && svc != nil && svc.HasManagedSupervisedLlamaModels() {
		effectiveManagedLlama = true
	}
	managedImageAssetsPresent := svc != nil && svc.HasManagedSupervisedImageModels()
	if !effectiveManagedLlama && !managedImageAssetsPresent && !d.cfg.EngineMediaEnabled && !d.cfg.EngineSpeechEnabled && !d.cfg.EngineSidecarEnabled {
		return
	}

	onState := func(kind engine.EngineKind, status engine.EngineStatus, detail string) {
		d.onEngineStateChange(string(kind), string(status), detail)
	}

	managerFactory := d.newEngineManager
	if managerFactory == nil {
		managerFactory = engine.NewManager
	}
	mgr, err := managerFactory(d.logger, "", onState)
	if err != nil {
		d.logger.Error("create engine manager failed", "error", err)
		reason := fmt.Sprintf("engine manager init failed (%v)", err)
		d.setDegradedStatus(reason)
		appendStartupFailureAudit(d.auditStore, reason)
		return
	}
	d.engineMgr = mgr
	managedLlamaConfigPath := resolveManagedLlamaModelsConfigPath()
	mgr.SetLlamaPaths(d.cfg.LocalModelsPath, managedLlamaConfigPath)

	// Inject engine manager into local service for gRPC access.
	skipLlamaBootstrap := false
	mediaHostSupport, _ := d.detectMediaHostSupport()
	d.cacheImageMatrix()
	managedImageSelection := d.resolvedImageMatrix
	managedImageLoopback := managedImageAssetsPresent &&
		managedImageSelection != nil &&
		managedImageSelection.Matched &&
		!managedImageSelection.Conflict &&
		managedImageSelection.Entry != nil &&
		managedImageSelection.ProductState == engine.ImageProductStateSupported &&
		managedImageSelection.ControlPlane == engine.ImageControlPlaneRuntime &&
		managedImageSelection.ExecutionPlane == engine.EngineMedia &&
		managedImageSelection.BackendClass == engine.ImageBackendClassNativeBinary
	if managedImageAssetsPresent && !managedImageLoopback && managedImageSelection != nil {
		detail := strings.TrimSpace(managedImageSelection.CompatibilityDetail)
		if detail == "" && managedImageSelection.Conflict {
			detail = "managed image bootstrap selection conflict"
		}
		if detail != "" {
			d.setDegradedStatus(detail)
		}
	}
	mgr.SetManagedImageBackend(nil)
	managedImageBackendConfigured := false
	if managedImageLoopback {
		if err := mgr.EnsureManagedImageBackend(ctx, &engine.ManagedImageBackendConfig{
			Mode:        engine.ManagedImageBackendOfficial,
			BackendName: "stablediffusion-ggml",
			Address:     "127.0.0.1:50052",
		}); err != nil {
			detail := fmt.Sprintf("start managed image backend: %v", err)
			d.setDegradedStatus(detail)
			appendStartupFailureAudit(d.auditStore, detail)
		} else if svc != nil {
			managedImageBackendConfigured = true
			svc.MarkManagedEngineUsed(string(engineManagedImageBackend), "engine_bootstrap")
		}
	}
	managedMediaLoopback := managedImageLoopback || (d.cfg.EngineMediaEnabled && mediaHostSupport == engine.MediaHostSupportSupportedSupervised)
	if svc != nil {
		svc.SetManagedLlamaRegistrationConfig(d.cfg.LocalModelsPath, managedLlamaConfigPath, effectiveManagedLlama)
		if effectiveManagedLlama {
			svc.SetManagedLlamaEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineLlamaPort))
		} else {
			svc.SetManagedLlamaEndpoint("")
		}
		if managedMediaLoopback {
			svc.SetManagedMediaEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineMediaPort))
		} else {
			svc.SetManagedMediaEndpoint("")
		}
		if d.cfg.EngineSpeechEnabled {
			svc.SetManagedSpeechEndpoint(fmt.Sprintf("http://127.0.0.1:%d/v1", d.cfg.EngineSpeechPort))
		} else {
			svc.SetManagedSpeechEndpoint("")
		}
		if managedImageBackendConfigured {
			svc.SetManagedImageBackendConfig(true, "127.0.0.1:50052")
		} else {
			svc.SetManagedImageBackendConfig(false, "")
		}
		svc.SetEngineManager(engine.NewServiceAdapter(mgr))
		if err := svc.SyncManagedLlamaAssets(ctx); err != nil {
			d.recordManagedLlamaBootstrapFailure(fmt.Sprintf("sync managed llama assets: %v", err))
			skipLlamaBootstrap = true
		}
	}

	var wg sync.WaitGroup
	type bootstrapFailure struct {
		kind   engine.EngineKind
		detail string
	}
	failures := make(chan bootstrapFailure, 4)
	startEngine := d.startEngineFn
	if startEngine == nil {
		startEngine = d.startEngine
	}
	bootstrap := func(kind engine.EngineKind, version string, port int, envKey string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := startEngine(ctx, kind, version, port, envKey); err != nil {
				failures <- bootstrapFailure{
					kind:   kind,
					detail: err.Error(),
				}
				return
			}
			if svc := d.grpc.LocalService(); svc != nil {
				svc.MarkManagedEngineUsed(string(kind), "engine_bootstrap")
			}
		}()
	}

	if effectiveManagedLlama && !skipLlamaBootstrap {
		bootstrap(engine.EngineLlama, d.cfg.EngineLlamaVersion, d.cfg.EngineLlamaPort,
			"NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL")
	}

	if managedMediaLoopback {
		bootstrap(engine.EngineMedia, d.cfg.EngineMediaVersion, d.cfg.EngineMediaPort,
			"NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL")
	}

	if d.cfg.EngineSpeechEnabled {
		bootstrap(engine.EngineSpeech, d.cfg.EngineSpeechVersion, d.cfg.EngineSpeechPort,
			"NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL")
	}

	if d.cfg.EngineSidecarEnabled {
		bootstrap(engineSidecar, d.cfg.EngineSidecarVersion, d.cfg.EngineSidecarPort,
			"NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL")
	}

	wg.Wait()
	close(failures)

	firstFailure := ""
	for failure := range failures {
		if firstFailure == "" {
			firstFailure = fmt.Sprintf("%s: %s", failure.kind, failure.detail)
		}
		d.logger.Error("engine bootstrap failed", "engine", failure.kind, "detail", failure.detail)
		if providerName, ok := providerTargetNameForEngine(failure.kind); ok {
			reason := fmt.Sprintf("engine bootstrap failed (%s: %s)", failure.kind, failure.detail)
			d.setProviderFailureHint(providerName, reason)
			if d.aiHealth != nil {
				previous := d.aiHealth.SnapshotOf(providerName)
				if err := d.aiHealth.Mark(providerName, false, reason); err == nil {
					appendProviderHealthAudit(d.auditStore, providerName, previous, d.aiHealth.SnapshotOf(providerName))
				}
			}
			appendEngineBootstrapFailureAudit(d.auditStore, string(failure.kind), providerName, failure.detail, d.resolvedImageMatrix)
		}
	}
	if firstFailure != "" {
		d.setDegradedStatus(fmt.Sprintf("engine bootstrap failed (%s)", firstFailure))
	}
}

func (d *Daemon) startEngine(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error {
	var cfg engine.EngineConfig
	switch kind {
	case engine.EngineLlama:
		cfg = engine.DefaultLlamaConfig()
	case engine.EngineMedia:
		cfg = engine.DefaultMediaConfig()
	case engine.EngineSpeech:
		cfg = engine.DefaultSpeechConfig()
	case engineSidecar:
		return fmt.Errorf("engine %s is not yet supported for supervised lifecycle", kind)
	default:
		return fmt.Errorf("unsupported engine kind: %s", kind)
	}
	if version != "" {
		cfg.Version = version
	}
	if port > 0 {
		cfg.Port = port
	}
	if kind == engine.EngineMedia {
		cfg.MediaMode = engine.MediaModePipelineSupervised
		if d.resolvedImageMatrix != nil {
			selection := *d.resolvedImageMatrix
			if resolvedMode, err := engine.MediaModeFromSelection(selection); err == nil {
				cfg.MediaMode = resolvedMode
				cfg.ImageSupervisedSelection = &selection
			}
		}
	}

	cfg, err := d.engineMgr.EnsureEngine(ctx, cfg)
	if err != nil {
		d.logger.Error("ensure engine failed",
			"engine", kind,
			"error", err,
		)
		return fmt.Errorf("ensure %s: %w", kind, err)
	}

	if err := d.engineMgr.StartEngine(ctx, cfg); err != nil {
		d.logger.Error("start engine failed",
			"engine", kind,
			"error", err,
		)
		return fmt.Errorf("start %s: %w", kind, err)
	}

	d.injectEngineEndpointEnv(kind, envKey, "bootstrap")
	return nil
}

func (d *Daemon) injectEngineEndpointEnv(kind engine.EngineKind, envKey string, source string) {
	if d.engineMgr == nil || strings.TrimSpace(envKey) == "" {
		return
	}
	endpoint, err := d.engineMgr.EngineEndpoint(kind)
	if err != nil {
		d.logger.Warn("resolve engine endpoint failed",
			"engine", kind,
			"source", source,
			"error", err,
		)
		return
	}
	trimmed := strings.TrimSuffix(strings.TrimSpace(endpoint), "/")
	if trimmed == "" {
		return
	}
	if err := runtimeSetenv(envKey, trimmed+"/v1"); err != nil {
		d.logger.Warn("set engine endpoint env failed",
			"engine", kind,
			"source", source,
			"env", envKey,
			"error", err,
		)
		return
	}
	if aiSvc := d.grpc.AIService(); aiSvc != nil {
		if providerID, apiKeyEnv, ok := localProviderEnvBinding(kind); ok {
			aiSvc.SetLocalProviderEndpoint(providerID, trimmed+"/v1", runtimeGetenv(apiKeyEnv))
		}
	}
	d.logger.Info("engine endpoint env injected",
		"engine", kind,
		"source", source,
		"endpoint", trimmed,
		"env", envKey,
	)
}

func (d *Daemon) onEngineStateChange(engineName string, status string, detail string) {
	snapshot := d.state.Snapshot()
	if snapshot.Status == health.StatusStopping || snapshot.Status == health.StatusStopped {
		return
	}
	if strings.EqualFold(strings.TrimSpace(engineName), string(engineManagedImageBackend)) {
		if svc := d.grpc.LocalService(); svc != nil {
			switch strings.ToLower(strings.TrimSpace(status)) {
			case "healthy":
				svc.SetManagedImageBackendHealth(true, detail)
			case "unhealthy":
				svc.SetManagedImageBackendHealth(false, detail)
			}
		}
	}

	switch status {
	case "unhealthy":
		d.setDegradedStatus(fmt.Sprintf("engine:%s unhealthy (%s)", engineName, detail))
		reasonKey := resolveInternalReasonKey(detail)
		appendEngineCrashAudit(d.auditStore, engineName, detail, d.resolvedImageMatrix, reasonKey)
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				hint := fmt.Sprintf("engine unhealthy (%s: %s)", engineName, detail)
				if attr := imageAttributionDetail(d.resolvedImageMatrix); attr != "" && isImageRelatedEngine(kind) {
					hint = fmt.Sprintf("%s [%s internal_reason_key=%s]", hint, attr, reasonKey)
				}
				d.setProviderFailureHint(providerName, hint)
			}
		}
	case "healthy":
		recoveringSameEngine := snapshot.Status == health.StatusDegraded &&
			engineUnhealthyReasonMatches(snapshot.Reason, engineName)
		if !recoveringSameEngine {
			return
		}
		if kind, ok := engineKindForName(engineName); ok {
			if isImageRelatedEngine(kind) {
				appendRepairResolvedAudit(d.auditStore, engineName, detail, d.resolvedImageMatrix)
			}
		}
		if kind, envKey, ok := engineEnvKey(engineName); ok {
			d.injectEngineEndpointEnv(kind, envKey, "recovered")
		}
		if svc := d.grpc.LocalService(); svc != nil {
			svc.MarkManagedEngineUsed(engineName, "engine_recovered")
		}
		if kind, ok := engineKindForName(engineName); ok {
			if providerName, ok := providerTargetNameForEngine(kind); ok {
				d.clearProviderFailureHint(providerName)
			}
		}
		d.state.SetStatus(health.StatusReady, "ready")
		d.grpc.SyncServingState()
	}
}
