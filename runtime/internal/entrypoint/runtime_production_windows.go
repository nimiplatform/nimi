//go:build windows && !nimi_windows_source_local_development

package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
)

func runProductionDaemon(version string) error {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return fmt.Errorf("inspect Windows service host: %w", err)
	}
	if !isService {
		return fmt.Errorf(
			"%s: protected Runtime must be launched by its fixed Windows service",
			protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired,
		)
	}
	return svc.Run(protectedlocal.WindowsRuntimeServiceName(), &windowsRuntimeService{version: version})
}

type windowsRuntimeService struct {
	version string
}

type windowsRuntimeEmergencyStopper interface {
	EmergencyStopSupervisedEngines()
}

type windowsRuntimeServiceCloser interface {
	Close() error
}

const (
	windowsRuntimeServiceStartWaitHint       = 30 * time.Second
	windowsRuntimeServiceStartCheckpointTick = 2 * time.Second
	windowsRuntimeServiceStopTimeout         = 25 * time.Second
	windowsRuntimeServiceStopCheckpointTick  = 2 * time.Second
	windowsRuntimeServiceStopTimeoutCode     = 0xA5F0
	windowsRuntimeServiceRestartExitCode     = 0xA5F1
)

type windowsRuntimeOpenResult struct {
	runtimeDaemon    *daemon.Daemon
	desktopListener  net.Listener
	localAppListener net.Listener
	err              error
}

type windowsRuntimeStartupStage uint32

const (
	windowsRuntimeStartupUnknown windowsRuntimeStartupStage = 0xA500 + iota
	windowsRuntimeStartupPrincipal
	windowsRuntimeStartupSignerPolicy
	windowsRuntimeStartupProcessTrust
	windowsRuntimeStartupProgramData
	windowsRuntimeStartupStateRoot
	windowsRuntimeStartupSecurityState
	windowsRuntimeStartupDesktopListener
	windowsRuntimeStartupLocalAppListener
	windowsRuntimeStartupConfiguration
	windowsRuntimeStartupDaemon
)

type windowsRuntimeStartupError struct {
	stage windowsRuntimeStartupStage
	err   error
}

func (failure *windowsRuntimeStartupError) Error() string { return failure.err.Error() }
func (failure *windowsRuntimeStartupError) Unwrap() error { return failure.err }

func windowsStartupFailure(stage windowsRuntimeStartupStage, err error) error {
	if err == nil {
		err = errors.New("Windows Runtime startup failed")
	}
	return &windowsRuntimeStartupError{stage: stage, err: err}
}

func windowsStartupExitCode(err error) uint32 {
	if code, ok := protectedlocal.WindowsPrincipalStartupExitCode(err); ok {
		return code
	}
	if code, ok := protectedlocal.WindowsProcessTrustStartupExitCode(err); ok {
		return code
	}
	if code, ok := protectedlocal.WindowsCustodyStartupExitCode(err); ok {
		return code
	}
	if code, ok := protectedlocal.WindowsPipeStartupExitCode(err); ok {
		return code
	}
	if code, ok := protectedlocal.WindowsSecurityStateStartupExitCode(err); ok {
		return code
	}
	var startup *windowsRuntimeStartupError
	if errors.As(err, &startup) && startup.stage > windowsRuntimeStartupUnknown && startup.stage <= windowsRuntimeStartupDaemon {
		return uint32(startup.stage)
	}
	return uint32(windowsRuntimeStartupUnknown)
}

func (service *windowsRuntimeService) Execute(_ []string, requests <-chan svc.ChangeRequest, statuses chan<- svc.Status) (bool, uint32) {
	startCheckpoint := uint32(1)
	statuses <- windowsRuntimeStartPendingStatus(startCheckpoint, windowsRuntimeServiceStartWaitHint)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	restartRequested := make(chan struct{}, 1)
	requestRestart := func() bool {
		select {
		case restartRequested <- struct{}{}:
			return true
		default:
			return false
		}
	}

	openResultCh := make(chan windowsRuntimeOpenResult, 1)
	go func() {
		runtimeDaemon, desktopListener, localAppListener, err := service.open(ctx, requestRestart)
		openResultCh <- windowsRuntimeOpenResult{
			runtimeDaemon:    runtimeDaemon,
			desktopListener:  desktopListener,
			localAppListener: localAppListener,
			err:              err,
		}
	}()
	startTicker := time.NewTicker(windowsRuntimeServiceStartCheckpointTick)
	defer startTicker.Stop()
	var openResult windowsRuntimeOpenResult
	openComplete := false
	for !openComplete {
		select {
		case openResult = <-openResultCh:
			openComplete = true
		case <-startTicker.C:
			startCheckpoint++
			statuses <- windowsRuntimeStartPendingStatus(startCheckpoint, windowsRuntimeServiceStartWaitHint)
		}
	}
	if openResult.err != nil {
		writeWindowsRuntimeFailure(openResult.err)
		return true, windowsStartupExitCode(openResult.err)
	}
	runtimeDaemon := openResult.runtimeDaemon
	desktopListener := openResult.desktopListener
	localAppListener := openResult.localAppListener

	done := make(chan error, 1)
	go func() { done <- runtimeDaemon.RunProtectedWithLocalApp(ctx, desktopListener, localAppListener) }()
	ready := make(chan error, 1)
	go func() { ready <- runtimeDaemon.WaitReady(ctx) }()
	readyReached := false
	for !readyReached {
		select {
		case err := <-ready:
			if err != nil {
				writeWindowsRuntimeFailure(err)
				initiateWindowsRuntimeServiceStop(cancel, runtimeDaemon, localAppListener, desktopListener)
				_, _ = waitForWindowsRuntimeServiceStop(done, statuses, windowsRuntimeServiceStopTimeout, windowsRuntimeServiceStopCheckpointTick)
				return true, uint32(windowsRuntimeStartupDaemon)
			}
			readyReached = true
		case err := <-done:
			if err != nil {
				writeWindowsRuntimeFailure(err)
				return true, uint32(windowsRuntimeStartupDaemon)
			}
			return false, 0
		case <-startTicker.C:
			startCheckpoint++
			statuses <- windowsRuntimeStartPendingStatus(startCheckpoint, windowsRuntimeServiceStartWaitHint)
		}
	}
	startTicker.Stop()
	select {
	case err := <-done:
		if err != nil {
			writeWindowsRuntimeFailure(err)
			return true, uint32(windowsRuntimeStartupDaemon)
		}
		return false, 0
	default:
	}
	statuses <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				statuses <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				statuses <- windowsRuntimeStopPendingStatus(1, windowsRuntimeServiceStopTimeout)
				initiateWindowsRuntimeServiceStop(cancel, runtimeDaemon, localAppListener, desktopListener)
				serviceSpecific, code := waitForWindowsRuntimeServiceStop(done, statuses, windowsRuntimeServiceStopTimeout, windowsRuntimeServiceStopCheckpointTick)
				if code != 0 {
					writeWindowsRuntimeFailure(fmt.Errorf("Runtime stop completed with serviceSpecific=%t code=%d", serviceSpecific, code))
				}
				// An explicit SCM Stop or Shutdown must remain stopped even when
				// cleanup reports an error. Returning a failure here would feed
				// the same request back into the service recovery policy.
				return false, 0
			}
		case <-restartRequested:
			statuses <- windowsRuntimeStopPendingStatus(1, windowsRuntimeServiceStopTimeout)
			initiateWindowsRuntimeServiceStop(cancel, runtimeDaemon, localAppListener, desktopListener)
			_, _ = waitForWindowsRuntimeServiceStop(done, statuses, windowsRuntimeServiceStopTimeout, windowsRuntimeServiceStopCheckpointTick)
			// A non-zero service-specific exit delegates replacement to the
			// installer's fixed SCM recovery policy. Desktop never performs a
			// direct stop/start sequence.
			return true, windowsRuntimeServiceRestartExitCode
		case err := <-done:
			if err != nil {
				writeWindowsRuntimeFailure(err)
				return false, 1
			}
			return false, 0
		}
	}
}

func writeWindowsRuntimeFailure(err error) {
	if err == nil {
		return
	}
	message := err.Error()
	if len(message) > 2048 {
		message = message[:2048]
	}
	log, openErr := eventlog.Open(protectedlocal.WindowsRuntimeServiceName())
	if openErr != nil {
		return
	}
	defer func() { _ = log.Close() }()
	_ = log.Error(1, message)
}

func windowsRuntimeStartPendingStatus(checkpoint uint32, waitHint time.Duration) svc.Status {
	waitHintMillis := waitHint.Milliseconds()
	if waitHintMillis <= 0 || waitHintMillis > int64(^uint32(0)) {
		waitHintMillis = int64(^uint32(0))
	}
	return svc.Status{State: svc.StartPending, CheckPoint: checkpoint, WaitHint: uint32(waitHintMillis)}
}

func initiateWindowsRuntimeServiceStop(cancel context.CancelFunc, runtime windowsRuntimeEmergencyStopper, closers ...windowsRuntimeServiceCloser) {
	if cancel != nil {
		cancel()
	}
	if runtime != nil {
		runtime.EmergencyStopSupervisedEngines()
	}
	for _, closer := range closers {
		if closer != nil {
			_ = closer.Close()
		}
	}
}

func waitForWindowsRuntimeServiceStop(done <-chan error, statuses chan<- svc.Status, timeout, checkpointTick time.Duration) (bool, uint32) {
	if timeout <= 0 || checkpointTick <= 0 || checkpointTick >= timeout {
		return true, windowsRuntimeServiceStopTimeoutCode
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(checkpointTick)
	defer ticker.Stop()
	checkpoint := uint32(1)
	for {
		select {
		case err := <-done:
			if err != nil {
				return false, 1
			}
			return false, 0
		case <-ticker.C:
			checkpoint++
			statuses <- windowsRuntimeStopPendingStatus(checkpoint, timeout)
		case <-timer.C:
			return true, windowsRuntimeServiceStopTimeoutCode
		}
	}
}

func windowsRuntimeStopPendingStatus(checkpoint uint32, timeout time.Duration) svc.Status {
	waitHint := timeout.Milliseconds()
	if waitHint <= 0 || waitHint > int64(^uint32(0)) {
		waitHint = int64(^uint32(0))
	}
	return svc.Status{State: svc.StopPending, CheckPoint: checkpoint, WaitHint: uint32(waitHint)}
}

func (service *windowsRuntimeService) open(ctx context.Context, requestRestart func() bool) (*daemon.Daemon, net.Listener, net.Listener, error) {
	principal, err := protectedlocal.ValidateWindowsProductionPrincipal(ctx)
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupPrincipal, err)
	}
	verifier, err := protectedlocal.NewWindowsNativeExecutableTrustVerifier()
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupSignerPolicy, err)
	}
	process, err := protectedlocal.VerifyWindowsProductionRuntimeProcess(ctx, principal, verifier)
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupProcessTrust, err)
	}
	programData, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupProgramData, fmt.Errorf("resolve fixed Windows ProgramData root: %w", err))
	}
	root, err := protectedlocal.ValidateWindowsProtectedStateRoot(ctx, filepath.Join(programData, protectedlocal.WindowsRuntimeStateRelativePath()), principal)
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupStateRoot, err)
	}
	securityState, err := protectedlocal.OpenWindowsRuntimeSecurityState(ctx, principal, process, root)
	if err != nil {
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupSecurityState, err)
	}
	desktopListener, err := protectedlocal.OpenWindowsVerifiedDesktopListener(ctx, securityState, verifier)
	if err != nil {
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupDesktopListener, err)
	}
	localAppListener, err := protectedlocal.OpenWindowsVerifiedLocalAppListener(ctx, securityState)
	if err != nil {
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupLocalAppListener, err)
	}
	cfg, err := loadWindowsProtectedRuntimeConfig(root.Path())
	if err != nil {
		_ = localAppListener.Close()
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupConfiguration, err)
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	runtimeDaemon, err := daemon.NewProtectedFromWindowsSecurityState(cfg, logger, service.version, securityState, requestRestart)
	if err != nil {
		_ = localAppListener.Close()
		_ = desktopListener.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupDaemon, err)
	}
	return runtimeDaemon, desktopListener, localAppListener, nil
}
