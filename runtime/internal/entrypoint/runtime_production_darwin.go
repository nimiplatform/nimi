//go:build darwin && cgo

package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runProductionDaemon(version string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signalCh := make(chan os.Signal, 2)
	signal.Notify(signalCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signalCh)
	go func() {
		select {
		case <-signalCh:
			cancel()
		case <-ctx.Done():
		}
	}()

	state, err := protectedlocal.OpenMacOSRuntimeSecurityState(ctx)
	if err != nil {
		return fmt.Errorf("open verified macOS Runtime security state: %w", err)
	}
	stateOwnedByDaemon := false
	defer func() {
		if !stateOwnedByDaemon {
			_ = state.Close()
		}
	}()
	desktopListener, err := protectedlocal.OpenMacOSVerifiedDesktopListener(ctx, state)
	if err != nil {
		return fmt.Errorf("open verified macOS Desktop transport: %w", err)
	}
	defer func() { _ = desktopListener.Close() }()
	localAppListener, err := protectedlocal.OpenMacOSVerifiedLocalAppListener(ctx, state)
	if err != nil {
		return fmt.Errorf("open verified macOS local-app transport: %w", err)
	}
	defer func() { _ = localAppListener.Close() }()
	cfg, err := loadMacOSProtectedRuntimeConfig(state.ServiceStatePath())
	if err != nil {
		return fmt.Errorf("load protected macOS Runtime configuration: %w", err)
	}

	// The daemon must derive its one interactive user/audit-session partition
	// from an already verified Desktop connection. No console-user lookup or
	// caller-supplied account identifier enters protected service construction.
	if err := desktopListener.Prime(ctx); err != nil {
		return fmt.Errorf("verify initial macOS Desktop connection: %w", err)
	}
	var restartRequested atomic.Bool
	requestRestart := func() bool {
		if !restartRequested.CompareAndSwap(false, true) {
			return false
		}
		cancel()
		return true
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	runtimeDaemon, err := daemon.NewProtectedFromMacOSSecurityState(cfg, logger, version, state, requestRestart)
	if err != nil {
		return fmt.Errorf("construct protected macOS Runtime: %w", err)
	}
	stateOwnedByDaemon = true
	err = runtimeDaemon.RunProtectedWithLocalApp(ctx, desktopListener, localAppListener)
	if restartRequested.Load() {
		if err != nil && !errors.Is(err, context.Canceled) {
			return fmt.Errorf("macOS Runtime restart requested after shutdown failure: %w", err)
		}
		// launchd's SuccessfulExit=false recovery policy replaces the process;
		// Desktop never receives direct service-control authority.
		return fmt.Errorf("macOS Runtime restart requested")
	}
	return err
}
