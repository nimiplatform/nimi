//go:build windows

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
	windowsRuntimeServiceStopTimeout        = 25 * time.Second
	windowsRuntimeServiceStopCheckpointTick = 2 * time.Second
	windowsRuntimeServiceStopTimeoutCode    = 0xA5F0
)

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
	windowsRuntimeStartupInstalledListener
	windowsRuntimeStartupFixtureCustody
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
	statuses <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runtimeDaemon, desktopListener, installedListener, err := service.open(ctx)
	if err != nil {
		return true, windowsStartupExitCode(err)
	}

	done := make(chan error, 1)
	go func() { done <- runtimeDaemon.RunProtectedWithInstalled(ctx, desktopListener, installedListener) }()
	statuses <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Interrogate:
				statuses <- request.CurrentStatus
			case svc.Stop, svc.Shutdown:
				statuses <- windowsRuntimeStopPendingStatus(1, windowsRuntimeServiceStopTimeout)
				initiateWindowsRuntimeServiceStop(cancel, runtimeDaemon, installedListener, desktopListener)
				return waitForWindowsRuntimeServiceStop(done, statuses, windowsRuntimeServiceStopTimeout, windowsRuntimeServiceStopCheckpointTick)
			}
		case err := <-done:
			if err != nil {
				return false, 1
			}
			return false, 0
		}
	}
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

func (service *windowsRuntimeService) open(ctx context.Context) (*daemon.Daemon, net.Listener, net.Listener, error) {
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
	installedListener, err := protectedlocal.OpenWindowsVerifiedInstalledListener(ctx, securityState, verifier)
	if err != nil {
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupInstalledListener, err)
	}
	if err := prepareWindowsRuntimeFixture(ctx, securityState); err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupFixtureCustody, err)
	}
	cfg, err := loadWindowsProtectedRuntimeConfig(root.Path())
	if err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupConfiguration, err)
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	runtimeDaemon, err := daemon.NewProtectedFromWindowsSecurityState(cfg, logger, service.version, securityState)
	if err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		return nil, nil, nil, windowsStartupFailure(windowsRuntimeStartupDaemon, err)
	}
	return runtimeDaemon, desktopListener, installedListener, nil
}
