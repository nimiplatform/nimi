package daemon

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
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
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	connectorservice "github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/videomedia"
)

// @nimi-authority: definition.nimi.runtime.service-operations.daemon-plane
// Daemon wires runtime servers and health state lifecycle.
type Daemon struct {
	cfg                     config.Config
	logger                  *slog.Logger
	state                   *health.State
	grpc                    *grpcserver.Server
	http                    *httpserver.Server
	protected               bool
	protectedStateClose     func() error
	protectedStateCloseOnce sync.Once
	protectedStateCloseErr  error
	auditStore              *auditlog.Store
	engineMgr               *engine.Manager
	imageExecutionHost      *engine.ImageExecutionHost
	audioCppExecutionHost   *engine.AudioCppExecutionHost
	audioCppSpeechHost      *engine.AudioCppSpeechExecutionHost
	videoExecutionHost      *engine.VideoExecutionHost
	newEngineManager        func(logger *slog.Logger, roots engine.ManagedRoots, onState engine.StateChangeFunc) (*engine.Manager, error)
	startEngineFn           func(ctx context.Context, kind engine.EngineKind, version string, port int, envKey string) error
	startupStatusMu         sync.Mutex
	startupDegradedReason   string
	readyOnce               sync.Once
	readyCh                 chan struct{}
	stopSupervisedOnce      sync.Once
	stopSupervisedFn        func()
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

// NewNonProductionAtProductControlRoot preserves the ordinary non-production
// Runtime while allowing direct owner tests to bind an isolated Product
// Control directory instead of reading the interactive user's data.
func NewNonProductionAtProductControlRoot(cfg config.Config, logger *slog.Logger, version string, productControlRoot string) (*Daemon, error) {
	if value := strings.TrimSpace(cfg.LocalStatePath); value != "" {
		if err := runtimeSetenv("NIMI_RUNTIME_LOCAL_STATE_PATH", value); err != nil {
			return nil, fmt.Errorf("set NIMI_RUNTIME_LOCAL_STATE_PATH: %w", err)
		}
	}
	return newDaemon(cfg, logger, version, func(cfg config.Config, state *health.State, logger *slog.Logger, version string) (*grpcserver.Server, error) {
		return grpcserver.NewNonProductionAtProductControlRoot(cfg, state, logger, version, productControlRoot)
	})
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
func NewProtectedFromWindowsSecurityState(cfg config.Config, logger *slog.Logger, version string, state *protectedlocal.WindowsRuntimeSecurityState, requestRestart func() bool) (*Daemon, error) {
	if state == nil {
		return nil, fmt.Errorf("verified Windows Runtime security state is required")
	}
	if state.SourceLocalDevelopment() {
		return newProtectedFromWindowsSourceLocalDevelopmentState(cfg, logger, version, state, requestRestart)
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
	if stateRoot == "" || state.Ledger() == nil || secrets == nil || sessions == nil {
		return fail(fmt.Errorf("complete verified Windows Runtime security state is required"))
	}
	serviceDataRoot, err := resolveProtectedServiceDataRoot(stateRoot, cfg.LocalStatePath)
	if err != nil {
		return fail(err)
	}
	accountPartition := strings.TrimSpace(state.DesktopIdentity().AccountPartition())
	if accountPartition == "" {
		return fail(fmt.Errorf("verified Windows Desktop account partition is required"))
	}
	localOSUserIdentity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID(state.DesktopIdentity().UserSID())
	if err != nil {
		return fail(fmt.Errorf("validate Windows interactive-user identity: %w", err))
	}
	productControlRoot, err := grpcserver.ResolveProtectedProductControlRoot(localOSUserIdentity)
	if err != nil {
		return fail(fmt.Errorf("resolve fixed Windows Product Control root: %w", err))
	}
	accountCustody, err := accountservice.NewProtectedBinaryCustody(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows protected account custody: %w", err))
	}
	connectorSecrets, err := connectorservice.NewProtectedBinarySecretStore(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows protected connector custody: %w", err))
	}
	localDevelopmentVerifier, err := protectedlocal.NewWindowsLocalDevelopmentProcessVerifier(state.DesktopIdentity())
	if err != nil {
		return fail(fmt.Errorf("construct Windows local-development process verifier: %w", err))
	}
	platformBundledAppsRoot, err := protectedPlatformAppResourceBindings()
	if err != nil {
		return fail(fmt.Errorf("resolve protected Platform app resources: %w", err))
	}
	return NewProtectedWithResources(cfg, logger, version, ProtectedRuntimeResources{
		Bindings: grpcserver.ProtectedServiceBindings{
			ServiceStateRoot:                 serviceDataRoot,
			ProductControlRoot:               productControlRoot,
			LocalDevelopmentConsentStorePath: filepath.Join(stateRoot, "local-development.db"),
			PlatformBundledAppsRoot:          platformBundledAppsRoot,
			AccountCustody:                   accountCustody,
			AccountPartition:                 accountPartition,
			AccountRealmBaseURL:              cfg.AccountRealmBaseURL,
			AccountRealmRealtimeURL:          cfg.AccountRealmRealtimeURL,
			AccountAuthorizationURL:          cfg.AccountAuthorizationURL,
			AccountTokenURL:                  cfg.AccountTokenURL,
			LocalOSUserIdentity:              localOSUserIdentity,
			RuntimeServiceSID:                state.RuntimeServiceSID(),
			ConnectorSecrets:                 connectorSecrets,
			DesktopSessions:                  sessions,
			LocalAppLaunches:                 state.LocalAppLaunches(),
			LocalDevelopmentVerifier:         localDevelopmentVerifier,
			RuntimeRestartRequester:          requestRestart,
		},
		Close: state.Close,
	})
}

func newProtectedFromWindowsSourceLocalDevelopmentState(cfg config.Config, logger *slog.Logger, version string, state *protectedlocal.WindowsRuntimeSecurityState, requestRestart func() bool) (*Daemon, error) {
	fail := func(err error) (*Daemon, error) {
		if closeErr := state.Close(); closeErr != nil {
			return nil, errors.Join(err, fmt.Errorf("close Windows source Runtime security state after binding failure: %w", closeErr))
		}
		return nil, err
	}
	stateRoot := strings.TrimSpace(state.ServiceStatePath())
	secrets := state.BinarySecrets()
	sessions := state.DesktopSessions()
	directLaunches := state.DirectLocalAppLaunches()
	userSID := strings.TrimSpace(state.RuntimeUserSID())
	if stateRoot == "" || state.Ledger() == nil || secrets == nil || sessions == nil || !sessions.Direct() ||
		directLaunches == nil || userSID == "" || requestRestart == nil {
		return fail(fmt.Errorf("complete current-user Windows Runtime security state is required"))
	}
	serviceDataRoot, err := resolveProtectedServiceDataRoot(stateRoot, cfg.LocalStatePath)
	if err != nil {
		return fail(err)
	}
	accountPartition := strings.TrimSpace(state.DesktopIdentity().AccountPartition())
	if accountPartition == "" {
		return fail(fmt.Errorf("verified Windows Desktop account partition is required"))
	}
	localOSUserIdentity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID(userSID)
	if err != nil {
		return fail(fmt.Errorf("validate Windows current-user identity: %w", err))
	}
	productControlRoot := filepath.Join(stateRoot, ".nimi")
	if err := os.MkdirAll(productControlRoot, 0o700); err != nil {
		return fail(fmt.Errorf("create current-user Windows Product Control root: %w", err))
	}
	accountCustody, err := accountservice.NewProtectedBinaryCustody(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows current-user account custody: %w", err))
	}
	connectorSecrets, err := connectorservice.NewProtectedBinarySecretStore(secrets)
	if err != nil {
		return fail(fmt.Errorf("adapt Windows current-user connector custody: %w", err))
	}
	platformBundledAppsRoot, err := protectedPlatformAppResourceBindings()
	if err != nil {
		return fail(fmt.Errorf("resolve Windows source Platform app resources: %w", err))
	}
	return NewProtectedWithResources(cfg, logger, version, ProtectedRuntimeResources{
		Bindings: grpcserver.ProtectedServiceBindings{
			ServiceStateRoot: serviceDataRoot, ProductControlRoot: productControlRoot,
			LocalDevelopmentConsentStorePath: filepath.Join(serviceDataRoot, "runtime", "local-development.db"),
			PlatformBundledAppsRoot:          platformBundledAppsRoot,
			AccountCustody:                   accountCustody, AccountPartition: accountPartition,
			AccountRealmBaseURL: cfg.AccountRealmBaseURL, AccountRealmRealtimeURL: cfg.AccountRealmRealtimeURL, AccountAuthorizationURL: cfg.AccountAuthorizationURL,
			AccountTokenURL: cfg.AccountTokenURL, LocalOSUserIdentity: localOSUserIdentity,
			ConnectorSecrets: connectorSecrets, DesktopSessions: sessions,
			DirectLocalAppLaunches: directLaunches, PerUserRuntime: true,
			RuntimeRestartRequester: requestRestart,
		},
		Close: state.Close,
	})
}

func resolveProtectedServiceDataRoot(securityStateRoot, localStatePath string) (string, error) {
	securityStateRoot = filepath.Clean(strings.TrimSpace(securityStateRoot))
	localStatePath = filepath.Clean(strings.TrimSpace(localStatePath))
	if !filepath.IsAbs(securityStateRoot) || !filepath.IsAbs(localStatePath) {
		return "", fmt.Errorf("protected Runtime data paths must be absolute")
	}
	dataRoot := filepath.Dir(filepath.Dir(localStatePath))
	relative, err := filepath.Rel(securityStateRoot, dataRoot)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("protected Runtime data root escapes the verified service root")
	}
	return dataRoot, nil
}

type grpcServerConstructor func(config.Config, *health.State, *slog.Logger, string) (*grpcserver.Server, error)

func newDaemon(cfg config.Config, logger *slog.Logger, version string, newGRPCServer grpcServerConstructor) (*Daemon, error) {
	state := health.NewState()
	grpcServer, err := newGRPCServer(cfg, state, logger, version)
	if err != nil {
		return nil, err
	}
	if localSvc := grpcServer.LocalService(); localSvc != nil {
		if agentSvc := grpcServer.AgentService(); agentSvc != nil {
			agentSvc.SetMachineLocalExecutionResolver(localSvc)
		}
		if aiSvc := grpcServer.AIService(); aiSvc != nil {
			aiSvc.SetLocalExecutionResolver(localSvc)
		}
	}
	d := &Daemon{
		cfg:              cfg,
		logger:           logger,
		state:            state,
		grpc:             grpcServer,
		auditStore:       nil,
		newEngineManager: engine.NewManager,
		readyCh:          make(chan struct{}),
	}
	d.http = httpserver.New(
		cfg.HTTPAddr,
		state,
		logger,
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

// RunProtectedWithLocalApp starts both independently verified native
// transports. Production Windows entrypoints use this path; platforms without
// an admitted local-app carrier remain on RunProtected and fail local-app RPCs
// closed.
func (d *Daemon) RunProtectedWithLocalApp(ctx context.Context, desktopListener, localAppListener net.Listener) error {
	if d == nil {
		return fmt.Errorf("Runtime daemon is required")
	}
	if !d.protected || desktopListener == nil || localAppListener == nil {
		return fmt.Errorf("%s: protected Runtime requires verified Desktop and local-app listeners", protectedlocal.ReasonProtectedLocalTransportUnsupported)
	}
	return d.run(ctx, 2, func(errCh chan<- error) {
		go func() { errCh <- d.grpc.ServeVerifiedNativeDesktop(desktopListener) }()
		go func() { errCh <- d.grpc.ServeVerifiedNativeLocalApp(localAppListener) }()
	}, func() {
		_ = localAppListener.Close()
		_ = desktopListener.Close()
	}, "verified-native-desktop-and-local-app")
}

// WaitReady blocks until the daemon has completed its serving-state transition
// to READY or the caller cancels the wait.
func (d *Daemon) WaitReady(ctx context.Context) error {
	if d == nil || d.readyCh == nil {
		return fmt.Errorf("Runtime daemon readiness is unavailable")
	}
	if ctx == nil {
		return fmt.Errorf("Runtime readiness context is required")
	}
	select {
	case <-d.readyCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
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
	startupDegradedReason := d.consumeStartupDegradedReason()
	d.state.SetStatus(health.StatusReady, "ready")
	d.grpc.SyncServingState()
	d.readyOnce.Do(func() { close(d.readyCh) })
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
	backgroundWG.Add(1)
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
	httpErr := d.http.Shutdown(ctx)
	grpcResult := d.grpc.Stop(ctx)
	appendShutdownAudit(d.auditStore, grpcResult.Shutdown)
	logShutdownSummary(d.logger, grpcResult.Shutdown)
	protectedStateErr := d.closeProtectedState()
	d.state.SetStatus(health.StatusStopped, "stopped")
	if joined := errors.Join(httpErr, protectedStateErr); joined != nil {
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
		if d.imageExecutionHost != nil {
			if err := d.imageExecutionHost.Stop(); err != nil {
				d.logger.Warn("stop image execution host failed", "error", err)
			}
		}
		if d.audioCppExecutionHost != nil {
			if err := d.audioCppExecutionHost.Stop(); err != nil {
				d.logger.Warn("stop audio.cpp execution host failed", "error", err)
			}
		}
		if d.audioCppSpeechHost != nil {
			if err := d.audioCppSpeechHost.Stop(); err != nil {
				d.logger.Warn("stop audio.cpp speech execution host failed", "error", err)
			}
		}
		if d.videoExecutionHost != nil {
			if err := d.videoExecutionHost.Stop(); err != nil {
				d.logger.Warn("stop video execution host failed", "error", err)
			}
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
	// The llama flag requests only private manager setup used later by
	// ExecutionHost; it never materializes a package, bootstraps a model, or
	// creates an ambient provider route.
	engineWorkRequested := d.cfg.EngineLlamaEnabled ||
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
	if localStatePath := strings.TrimSpace(d.cfg.LocalStatePath); filepath.IsAbs(localStatePath) {
		mgr.SetRuntimeWorkRoot(filepath.Join(filepath.Dir(localStatePath), "engine-work"))
	}
	if aiSvc := d.grpc.AIService(); aiSvc != nil {
		aiSvc.SetLocalTextExecutionHost(engine.NewExecutionHost(mgr, d.logger))
		d.imageExecutionHost = engine.NewImageExecutionHost(mgr, d.logger, engine.ImageExecutionHostConfig{
			PackageSource: strings.TrimSpace(d.cfg.EngineManagedImageBackendSource),
		})
		aiSvc.SetLocalImageExecutionHost(d.imageExecutionHost)
		d.audioCppExecutionHost = engine.NewAudioCppExecutionHost(d.logger)
		aiSvc.SetLocalMusicExecutionHost(d.audioCppExecutionHost)
		d.videoExecutionHost = engine.NewVideoExecutionHost(mgr, d.logger, engine.VideoExecutionHostConfig{
			PackageSource: strings.TrimSpace(d.cfg.EngineManagedImageBackendSource),
		})
		aiSvc.SetLocalVideoExecutionHost(d.videoExecutionHost)
		if svc != nil {
			speechHost := engine.NewSpeechExecutionHost(svc, d.cfg.EngineSpeechPort, 0)
			d.audioCppSpeechHost = engine.NewAudioCppSpeechExecutionHost(d.logger)
			speechHost.SetAudioCppExecutionHost(d.audioCppSpeechHost)
			aiSvc.SetLocalSpeechExecutionHost(speechHost)
		}
		if videoMedia, err := videomedia.NewFromDependenciesRoot(engineRoots.Dependencies); err != nil {
			// Local video submits fail closed with a typed unavailable reason
			// until the pinned codec dependency is materialized.
			d.logger.Warn("pinned video codec dependency unavailable; local video media pipeline not wired", "error", err)
		} else {
			aiSvc.SetLocalVideoMediaPipeline(videoMedia)
		}
	}
	if svc != nil {
		svc.SetEngineManager(engine.NewServiceAdapter(mgr))
	}
	if !engineWorkRequested {
		return
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
		}()
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
		if auditTarget, ok := engineAuditTargetName(failure.kind); ok {
			appendEngineBootstrapFailureAudit(d.auditStore, string(failure.kind), auditTarget, failure.detail, nil)
		}
	}
	if firstFailure != "" {
		d.setDegradedStatus(fmt.Sprintf("engine bootstrap failed (%s)", firstFailure))
	}
}
