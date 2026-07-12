//go:build windows

package entrypoint

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"

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

func (service *windowsRuntimeService) Execute(_ []string, requests <-chan svc.ChangeRequest, statuses chan<- svc.Status) (bool, uint32) {
	statuses <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	runtimeDaemon, desktopListener, installedListener, err := service.open(ctx)
	if err != nil {
		return false, 1
	}
	defer desktopListener.Close()
	defer installedListener.Close()

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
				statuses <- svc.Status{State: svc.StopPending}
				cancel()
				if err := <-done; err != nil {
					return false, 1
				}
				return false, 0
			}
		case err := <-done:
			if err != nil {
				return false, 1
			}
			return false, 0
		}
	}
}

func (service *windowsRuntimeService) open(ctx context.Context) (*daemon.Daemon, net.Listener, net.Listener, error) {
	principal, err := protectedlocal.ValidateWindowsProductionPrincipal(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	verifier, err := protectedlocal.NewWindowsNativeExecutableTrustVerifier()
	if err != nil {
		return nil, nil, nil, err
	}
	process, err := protectedlocal.VerifyWindowsProductionRuntimeProcess(ctx, principal, verifier)
	if err != nil {
		return nil, nil, nil, err
	}
	programData, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("resolve fixed Windows ProgramData root: %w", err)
	}
	root, err := protectedlocal.ValidateWindowsProtectedStateRoot(ctx, filepath.Join(programData, protectedlocal.WindowsRuntimeStateRelativePath()), principal)
	if err != nil {
		return nil, nil, nil, err
	}
	securityState, err := protectedlocal.OpenWindowsRuntimeSecurityState(ctx, principal, process, root)
	if err != nil {
		return nil, nil, nil, err
	}
	desktopListener, err := protectedlocal.OpenWindowsVerifiedDesktopListener(ctx, securityState, verifier)
	if err != nil {
		_ = securityState.Close()
		return nil, nil, nil, err
	}
	installedListener, err := protectedlocal.OpenWindowsVerifiedInstalledListener(ctx, securityState, verifier)
	if err != nil {
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, err
	}
	if err := prepareWindowsRuntimeFixture(ctx, securityState); err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, err
	}
	cfg, err := loadWindowsProtectedRuntimeConfig(root.Path())
	if err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		_ = securityState.Close()
		return nil, nil, nil, err
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	runtimeDaemon, err := daemon.NewProtectedFromWindowsSecurityState(cfg, logger, service.version, securityState)
	if err != nil {
		_ = installedListener.Close()
		_ = desktopListener.Close()
		return nil, nil, nil, err
	}
	return runtimeDaemon, desktopListener, installedListener, nil
}
