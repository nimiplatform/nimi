package daemon

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/httpserver"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Daemon wires runtime servers and health state lifecycle.
type Daemon struct {
	cfg                       config.Config
	logger                    *slog.Logger
	state                     *health.State
	grpc                      *grpcserver.Server
	http                      *httpserver.Server
	protected                 bool
	protectedStateClose       func() error
	protectedStateCloseOnce   sync.Once
	protectedStateCloseErr    error
	aiHealth                  *providerhealth.Tracker
	auditStore                *auditlog.Store
	engineMgr                 *engine.Manager
	newEngineManager          func(logger *slog.Logger, roots engine.ManagedRoots, onState engine.StateChangeFunc) (*engine.Manager, error)
	startEngineFn             func(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error
	probeAIProviderFn         func(ctx context.Context, client *http.Client, target aiProviderTarget) error
	detectMediaHostSupportFn  func() (engine.MediaHostSupport, string)
	imageBootstrapSelectionFn func() (engine.ImageSupervisedMatrixSelection, bool)
	listEmbeddingAssetsFn     func(context.Context) ([]*runtimev1.LocalAssetRecord, error)
	providerFailureHintMu     sync.RWMutex
	providerFailureHints      map[string]string
	startupStatusMu           sync.Mutex
	startupDegradedReason     string
	stopSupervisedOnce        sync.Once
	stopSupervisedFn          func()
	// resolvedImageMatrix caches the v2 image supervised matrix selection
	// from startup. Used for health attribution detail enrichment per K-PROV-002.
	resolvedImageMatrix *engine.ImageSupervisedMatrixSelection
}

const (
	engineManagedImageBackend = engine.EngineKind("managed-image-backend")
	engineSidecar             = engine.EngineKind("sidecar")
	maxShutdownDrainWait      = 250 * time.Millisecond
)

// New wires the explicit non-production daemon surface. Production service
// startup must use NewProtected with OS-verified bindings.
func New(cfg config.Config, logger *slog.Logger, version string) (*Daemon, error) {
	if value := strings.TrimSpace(cfg.LocalStatePath); value != "" {
		if err := runtimeSetenv("NIMI_RUNTIME_LOCAL_STATE_PATH", value); err != nil {
			return nil, fmt.Errorf("set NIMI_RUNTIME_LOCAL_STATE_PATH: %w", err)
		}
	}
	return newDaemon(cfg, logger, version, grpcserver.NewNonProduction)
}

// NewProtected wires a production daemon only from OS-verified service
// bindings. Unlike New, it never publishes the protected state root through
// process environment state.
func NewProtected(cfg config.Config, logger *slog.Logger, version string, bindings grpcserver.ProtectedServiceBindings) (*Daemon, error) {
	cfg.LocalStatePath = filepath.Join(filepath.Clean(strings.TrimSpace(bindings.ServiceStateRoot)), "runtime", "local-state.json")
	d, err := newDaemon(cfg, logger, version, func(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*grpcserver.Server, error) {
		return grpcserver.NewProtectedService(cfg, state, logger, version, bindings)
	})
	if err != nil {
		return nil, err
	}
	d.protected = true
	return d, nil
}

// ProtectedRuntimeResources carries the already-verified security state that
// owns the protected-local ledger and native transport. The daemon takes over
// its closure only after the protected gRPC server has been constructed.
type ProtectedRuntimeResources struct {
	Bindings grpcserver.ProtectedServiceBindings
	Close    func() error
}

// NewProtectedWithResources gives a protected Runtime ownership of its
// already-verified OS security state. If protected server construction fails,
// the state is closed before the failure is returned; after construction,
// shutdown closes it exactly once after all Runtime services stop using it.
func NewProtectedWithResources(cfg config.Config, logger *slog.Logger, version string, resources ProtectedRuntimeResources) (*Daemon, error) {
	if resources.Close == nil {
		return nil, fmt.Errorf("protected Runtime security-state closer is required")
	}
	d, err := NewProtected(cfg, logger, version, resources.Bindings)
	if err != nil {
		if closeErr := resources.Close(); closeErr != nil {
			return nil, errors.Join(err, fmt.Errorf("close protected Runtime security state after construction failure: %w", closeErr))
		}
		return nil, err
	}
	d.protectedStateClose = resources.Close
	return d, nil
}

// NewProtectedFromWindowsSecurityState converts the opaque, verified Windows
// service capability into the only custody/session bindings accepted by the
// protected Runtime. It never accepts a state root, account partition, secret
// store, or session authority from configuration or a caller-provided path.
func NewProtectedFromWindowsSecurityState(cfg config.Config, logger *slog.Logger, version string, state *protectedlocal.WindowsRuntimeSecurityState) (*Daemon, error) {
	if state == nil {
		return nil, fmt.Errorf("verified Windows Runtime security state is required")
	}
	fail := func(err error) (*Daemon, error) {
		if closeErr := state.Close(); closeErr != nil {
			return nil, errors.Join(err, fmt.Errorf("close Windows Runtime security state after binding failure: %w", closeErr))
		}
		return nil, err
	}
	stateRoot := strings.TrimSpace(state.ServiceStatePath())
	secrets := state.BinarySecrets()
	sessions := state.DesktopSessions()
	intents := state.LifecycleIntents()
	if stateRoot == "" || state.Ledger() == nil || secrets == nil || sessions == nil || intents == nil {
		return fail(fmt.Errorf("complete verified Windows Runtime security state is required"))
	}
	accountPartition := strings.TrimSpace(state.DesktopIdentity().AccountPartition())
	if accountPartition == "" {
		return fail(fmt.Errorf("verified Windows Desktop account partition is required"))
	}
	accountCustody, err := accountservice.NewProtectedBinaryCustody(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows protected account custody: %w", err))
	}
	connectorSecrets, err := connectorservice.NewProtectedBinarySecretStore(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows protected connector custody: %w", err))
	}
	installedProcessVerifier, err := installedProcessVerifierForWindowsState(state)
	if err != nil {
		return fail(fmt.Errorf("construct Windows installed process verifier: %w", err))
	}
	return NewProtectedWithResources(cfg, logger, version, ProtectedRuntimeResources{
		Bindings: grpcserver.ProtectedServiceBindings{
			ServiceStateRoot:         stateRoot,
			AccountCustody:           accountCustody,
			AccountPartition:         accountPartition,
			ConnectorSecrets:         connectorSecrets,
			DesktopSessions:          sessions,
			LifecycleIntents:         intents,
			InstalledProcessVerifier: installedProcessVerifier,
		},
		Close: state.Close,
	})
}

type grpcServerConstructor func(config.Config, *health.State, *slog.Logger, string) (*grpcserver.Server, error)

func newDaemon(cfg config.Config, logger *slog.Logger, version string, newGRPCServer grpcServerConstructor) (*Daemon, error) {
	state := health.NewState()
	grpcServer, err := newGRPCServer(cfg, state, logger, version)
	if err != nil {
		return nil, err
	}
	listEmbeddingAssets := func(ctx context.Context) ([]*runtimev1.LocalAssetRecord, error) {
		localSvc := grpcServer.LocalService()
		if localSvc == nil {
			return nil, nil
		}
		resp, err := localSvc.ListLocalAssets(ctx, &runtimev1.ListLocalAssetsRequest{
			StatusFilter: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			KindFilter:   runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
		})
		if err != nil {
			return nil, err
		}
		return resp.GetAssets(), nil
	}
	d := &Daemon{
		cfg:                      cfg,
		logger:                   logger,
		state:                    state,
		grpc:                     grpcServer,
		aiHealth:                 nil,
		auditStore:               nil,
		newEngineManager:         engine.NewManager,
		probeAIProviderFn:        probeAIProvider,
		detectMediaHostSupportFn: engine.DetectMediaHostSupport,
		listEmbeddingAssetsFn:    listEmbeddingAssets,
		providerFailureHints:     map[string]string{},
	}
	d.http = httpserver.New(
		cfg.HTTPAddr,
		state,
		logger,
		grpcServer.AIHealthTracker(),
	)
	return d, nil
}

type daemonServerStarter func(chan<- error)
type daemonServerStopper func()

// Run starts the explicit non-production daemon surface. Production Runtime
// instances must use RunProtected with a verified native Desktop carrier.
func (d *Daemon) Run(ctx context.Context) error {
	if d == nil {
		return fmt.Errorf("Runtime daemon is required")
	}
	if d.protected {
		return fmt.Errorf("%s: protected Runtime requires a verified native Desktop listener", protectedlocal.ReasonProtectedLocalTransportUnsupported)
	}
	return d.run(ctx, 2, func(errCh chan<- error) {
		go func() { errCh <- d.grpc.Serve() }()
		go func() { errCh <- d.http.Serve() }()
	}, nil, "ordinary-local")
}

// RunProtected starts a production Runtime only through the native listener
// that has already verified the Desktop process. It never opens ordinary TCP
// gRPC or HTTP listeners.
func (d *Daemon) RunProtected(ctx context.Context, listener net.Listener) error {
	if d == nil {
		return fmt.Errorf("Runtime daemon is required")
	}
	if !d.protected {
		return fmt.Errorf("%s: verified native Desktop transport requires a protected Runtime", protectedlocal.ReasonProtectedLocalTransportUnsupported)
	}
	if listener == nil {
		return fmt.Errorf("%s: protected Runtime requires a verified native Desktop listener", protectedlocal.ReasonProtectedLocalTransportUnsupported)
	}
	return d.run(ctx, 1, func(errCh chan<- error) {
		go func() { errCh <- d.grpc.ServeVerifiedNativeDesktop(listener) }()
	}, func() { _ = listener.Close() }, "verified-native-desktop")
}

func (d *Daemon) run(ctx context.Context, serverCount int, startServers daemonServerStarter, stopServers daemonServerStopper, transport string) error {
	if ctx == nil {
		return fmt.Errorf("Runtime context is required")
	}
	if serverCount <= 0 || startServers == nil {
		return fmt.Errorf("Runtime server starter is required")
	}
	var stopOnce sync.Once
	stop := func() {
		if stopServers != nil {
			stopOnce.Do(stopServers)
		}
	}
	defer stop()
	d.aiHealth = d.grpc.AIHealthTracker()
	d.auditStore = d.grpc.AuditStore()
	d.state.SetStatus(health.StatusStarting, "booting")
	d.grpc.SyncServingState()
	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()
	var backgroundWG sync.WaitGroup
	backgroundWG.Add(1)
	go func() {
		defer backgroundWG.Done()
		d.sampleRuntimeResource(backgroundCtx)
	}()
	errCh := make(chan error, serverCount)
	startServers(errCh)
	// Supervised engines may download or repair native dependencies. Keep that
	// work outside the runtime readiness path and project failures through
	// degraded health/provider detail instead of holding the daemon in STARTING.
	backgroundWG.Add(1)
	go func() {
		defer backgroundWG.Done()
		d.startSupervisedEngines(backgroundCtx)
	}()
	if err := d.refreshManagedEmbeddingProfile(backgroundCtx); err != nil {
		stop()
		cancelBackground()
		backgroundWG.Wait()
		if shutdownErr := d.shutdown(); shutdownErr != nil {
			return fmt.Errorf("refresh managed embedding profile: %w (shutdown: %v)", err, shutdownErr)
		}
		return fmt.Errorf("refresh managed embedding profile: %w", err)
	}
	if memorySvc := d.grpc.MemoryService(); memorySvc != nil && memorySvc.PersistenceBackend() != nil {
		if _, err := memorySvc.PersistenceBackend().BackupNow(backgroundCtx); err != nil {
			stop()
			cancelBackground()
			backgroundWG.Wait()
			if shutdownErr := d.shutdown(); shutdownErr != nil {
				return fmt.Errorf("startup sqlite backup: %w (shutdown: %v)", err, shutdownErr)
			}
			return fmt.Errorf("startup sqlite backup: %w", err)
		}
	}
	startupDegradedReason := d.consumeStartupDegradedReason()
	d.state.SetStatus(health.StatusReady, "ready")
	d.grpc.SyncServingState()
	if agentSvc := d.grpc.AgentService(); agentSvc != nil {
		if err := agentSvc.StartLifeTrackLoop(backgroundCtx); err != nil {
			cancelBackground()
			backgroundWG.Wait()
			if shutdownErr := d.shutdown(); shutdownErr != nil {
				return fmt.Errorf("start runtime-agent life-track loop: %w (shutdown: %v)", err, shutdownErr)
			}
			return fmt.Errorf("start runtime-agent life-track loop: %w", err)
		}
	}
	if transport == "verified-native-desktop" {
		d.logger.Info("runtime ready", "transport", transport)
	} else {
		d.logger.Info("runtime ready", "grpc_addr", d.cfg.GRPCAddr, "http_addr", d.cfg.HTTPAddr)
	}
	if startupDegradedReason != "" {
		d.transitionToDegraded(startupDegradedReason)
		d.logger.Warn("runtime started in degraded state", "reason", startupDegradedReason)
	}
	backgroundWG.Add(2)
	go func() {
		defer backgroundWG.Done()
		d.sampleAIProviderHealth(backgroundCtx)
	}()
	go func() {
		defer backgroundWG.Done()
		if aiSvc := d.grpc.AIService(); aiSvc != nil {
			aiSvc.RunVoiceAssetDeleteReconciliationLoop(backgroundCtx)
		}
	}()
	var serveErr error
	remainingServers := serverCount
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
	stop()
	cancelBackground()
	backgroundWG.Wait()
	if agentSvc := d.grpc.AgentService(); agentSvc != nil {
		agentSvc.StopLifeTrackLoop()
	}
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
	ctx, cancel := context.WithTimeout(context.Background(), d.cfg.ShutdownTimeout)
	defer cancel()
	activeAtStart := d.grpc.BeginShutdown()
	if len(activeAtStart) > 0 {
		d.logger.Warn("canceling active runtime RPCs for shutdown", "count", len(activeAtStart))
	}
	waitForShutdownDrain(ctx, d.cfg.ShutdownTimeout)
	d.stopSupervisedEngines("stopping supervised engines")
	var backupErr error
	if memorySvc := d.grpc.MemoryService(); memorySvc != nil && memorySvc.PersistenceBackend() != nil {
		_, backupErr = memorySvc.PersistenceBackend().BackupNow(ctx)
	}
	httpErr := d.http.Shutdown(ctx)
	grpcResult := d.grpc.Stop(ctx)
	appendShutdownAudit(d.auditStore, grpcResult.Shutdown)
	logShutdownSummary(d.logger, grpcResult.Shutdown)
	var closeErr error
	if memorySvc := d.grpc.MemoryService(); memorySvc != nil {
		closeErr = memorySvc.Close()
	}
	var cognitionCloseErr error
	if cognitionSvc := d.grpc.CognitionService(); cognitionSvc != nil {
		cognitionCloseErr = cognitionSvc.Close()
	}
	protectedStateErr := d.closeProtectedState()
	d.state.SetStatus(health.StatusStopped, "stopped")
	if joined := errors.Join(backupErr, httpErr, closeErr, cognitionCloseErr, protectedStateErr); joined != nil {
		return fmt.Errorf("shutdown runtime: %w", joined)
	}
	return nil
}

func (d *Daemon) closeProtectedState() error {
	if d == nil {
		return nil
	}
	d.protectedStateCloseOnce.Do(func() {
		if d.protectedStateClose != nil {
			d.protectedStateCloseErr = d.protectedStateClose()
		}
	})
	return d.protectedStateCloseErr
}
func (d *Daemon) EmergencyStopSupervisedEngines() {
	d.stopSupervisedEngines("forcing supervised engines to stop after repeated shutdown signal")
}
func (d *Daemon) stopSupervisedEngines(reason string) {
	d.stopSupervisedOnce.Do(func() {
		d.logger.Info(reason)
		if stopFn := d.stopSupervisedFn; stopFn != nil {
			stopFn()
		}
		if d.engineMgr != nil {
			d.engineMgr.StopAll()
		}
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
func (d *Daemon) refreshManagedEmbeddingProfile(ctx context.Context) error {
	memorySvc := d.grpc.MemoryService()
	if memorySvc == nil {
		return nil
	}
	if d.listEmbeddingAssetsFn == nil {
		memorySvc.SetManagedEmbeddingProfile(nil)
		return nil
	}
	assets, err := d.listEmbeddingAssetsFn(ctx)
	if err != nil {
		return err
	}
	memorySvc.SetManagedEmbeddingProfile(selectManagedEmbeddingProfile(assets))
	return nil
}
func waitForShutdownDrain(ctx context.Context, timeout time.Duration) {
	wait := timeout / 10
	if wait > maxShutdownDrainWait {
		wait = maxShutdownDrainWait
	}
	if wait <= 0 {
		return
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
	case <-timer.C:
	}
}
func logShutdownSummary(logger *slog.Logger, summary grpcserver.ShutdownSummary) {
	if logger == nil {
		return
	}
	if summary.StartedAt.IsZero() {
		return
	}
	if summary.Forced {
		logger.Warn("runtime shutdown required gRPC force stop",
			"duration", summary.Duration,
			"active_methods", summary.ActiveByMethod,
			"cancelled_methods", summary.CancelledByMethod,
			"remaining_methods", summary.RemainingByMethod,
		)
		return
	}
	logger.Info("runtime shutdown completed",
		"duration", summary.Duration,
		"active_methods", summary.ActiveByMethod,
		"cancelled_methods", summary.CancelledByMethod,
	)
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
	managedLlamaAssetsPresent := svc != nil && svc.HasManagedSupervisedLlamaModels()
	managedLlamaRegistrationEnabled := d.cfg.EngineLlamaEnabled || managedLlamaAssetsPresent
	bootstrapManagedLlama := d.cfg.EngineLlamaEnabled
	managedImageAssetsPresent := svc != nil && svc.HasManagedSupervisedImageModels()
	onState := func(kind engine.EngineKind, status engine.EngineStatus, detail string) {
		d.onEngineStateChange(string(kind), string(status), detail)
	}
	managerFactory := d.newEngineManager
	if managerFactory == nil {
		managerFactory = engine.NewManager
	}
	// The engine manager installs native engine packages, the managed Python
	// environment, the uv tool, and venvs strictly under the K-CFG-018
	// data-plane roots resolved from the user-selected data root. When the
	// config carries no resolved data root the managed install fails closed
	// rather than falling back to a home-directory tree. (K-CFG-018, K-LENG-004)
	engineRoots := engine.ManagedRoots{
		Environments: strings.TrimSpace(d.cfg.ManagedRoots.Environments),
		Dependencies: strings.TrimSpace(d.cfg.ManagedRoots.Dependencies),
	}
	engineWorkRequested := managedLlamaRegistrationEnabled || managedImageAssetsPresent ||
		d.cfg.EngineMediaEnabled || d.cfg.EngineSpeechEnabled || d.cfg.EngineSidecarEnabled
	mgr, err := managerFactory(d.logger, engineRoots, onState)
	if err != nil {
		// Runtime core readiness is independent from local environment
		// materializers (K-LENG-028). When no engine work is requested, a
		// missing data root must not degrade the daemon; engine RPCs fail
		// closed individually until product setup records a data root.
		if !engineWorkRequested {
			d.logger.Warn("engine manager unavailable; deferring engine setup", "error", err)
			return
		}
		d.logger.Error("create engine manager failed", "error", err)
		reason := fmt.Sprintf("engine manager init failed (%v)", err)
		d.setDegradedStatus(reason)
		appendStartupFailureAudit(d.auditStore, reason)
		return
	}
	d.engineMgr = mgr
	managedLlamaConfigPath := resolveManagedLlamaModelsConfigPath()
	mgr.SetLlamaPaths(d.cfg.LocalModelsPath, managedLlamaConfigPath)
	if svc != nil {
		svc.SetManagedLlamaRegistrationConfig(d.cfg.LocalModelsPath, managedLlamaConfigPath, managedLlamaRegistrationEnabled)
		svc.SetEngineManager(engine.NewServiceAdapter(mgr))
	}
	if !engineWorkRequested {
		return
	}
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
		if managedImageSelection.EntryID == "windows-x64-nvidia-gguf" {
			dependencyStatus := mgr.ResolveSharedAcceleratorDependency(engine.NVIDIACUDAUserSpaceRuntimeDependencyID, "stable-diffusion.cpp.cuda")
			if runtime.GOOS == "windows" &&
				dependencyStatus.State != engine.SharedAcceleratorDependencyReadySystem &&
				dependencyStatus.State != engine.SharedAcceleratorDependencyReadyManaged {
				detail := strings.TrimSpace(dependencyStatus.Detail)
				if detail == "" {
					detail = fmt.Sprintf("cuda_user_space_runtime state=%s", dependencyStatus.State)
				}
				d.setDegradedStatus(detail)
				if svc != nil {
					svc.SetManagedImageBackendHealth(false, detail)
				}
			} else if svc != nil {
				managedImageBackendConfigured = true
			}
		} else {
			if svc != nil {
				managedImageBackendConfigured = true
			}
		}
	}
	managedMediaLoopback := d.cfg.EngineMediaEnabled && mediaHostSupport == engine.MediaHostSupportSupportedSupervised
	if svc != nil {
		if bootstrapManagedLlama {
			if err := svc.SyncManagedLlamaAssets(ctx); err != nil {
				d.recordManagedLlamaBootstrapFailure(fmt.Sprintf("sync managed llama assets: %v", err))
				skipLlamaBootstrap = true
			} else if !svc.ManagedLlamaRouterReady() {
				d.logger.Info("managed llama bootstrap deferred; no runtime-verified llama model preset is ready")
				skipLlamaBootstrap = true
			}
		}
		if bootstrapManagedLlama && !skipLlamaBootstrap {
			cfg := engine.DefaultLlamaConfig()
			if strings.TrimSpace(d.cfg.EngineLlamaVersion) != "" {
				cfg.Version = d.cfg.EngineLlamaVersion
			}
			if _, err := mgr.RequireEngineBinaryDependency(ctx, cfg); err != nil {
				if errors.Is(err, engine.ErrEngineBinaryDependencyNotReady) {
					d.logger.Info("managed llama bootstrap deferred; local environment dependency is not ready",
						"detail", err.Error(),
					)
					skipLlamaBootstrap = true
				} else {
					d.recordManagedLlamaBootstrapFailure(fmt.Sprintf("verify managed llama engine package: %v", err))
					skipLlamaBootstrap = true
				}
			}
		}
		if bootstrapManagedLlama && !skipLlamaBootstrap {
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
			svc.SetManagedImageBackendConfigWithSource(true, "127.0.0.1:50052", strings.TrimSpace(d.cfg.EngineManagedImageBackendSource))
		} else {
			svc.SetManagedImageBackendConfig(false, "")
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
	if bootstrapManagedLlama && !skipLlamaBootstrap {
		bootstrap(engine.EngineLlama, d.cfg.EngineLlamaVersion, d.cfg.EngineLlamaPort,
			"NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL")
	}
	if managedMediaLoopback {
		bootstrap(engine.EngineMedia, d.cfg.EngineMediaVersion, d.cfg.EngineMediaPort,
			"NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL")
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
		cfg.ModelsPath = d.cfg.LocalModelsPath
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
	resolved := trimmed + "/v1"
	if err := runtimeSetenv(envKey, resolved); err != nil {
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
			aiSvc.SetLocalProviderEndpoint(providerID, resolved, runtimeGetenv(apiKeyEnv))
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
