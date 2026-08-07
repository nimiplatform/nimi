//go:build windows && nimi_windows_source_local_development

package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"

	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runProductionDaemon(version string) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt)
	defer signal.Stop(signals)
	go func() {
		select {
		case <-signals:
			cancel()
		case <-ctx.Done():
		}
	}()

	state, err := protectedlocal.OpenWindowsSourceLocalDevelopmentRuntimeSecurityState(ctx)
	if err != nil {
		return fmt.Errorf("open current-user Windows Runtime security state: %w", err)
	}
	state.StartOwnerMonitor(ctx, cancel)
	stateOwnedByDaemon := false
	defer func() {
		if !stateOwnedByDaemon {
			_ = state.Close()
		}
	}()
	desktopListener, err := protectedlocal.OpenWindowsVerifiedDesktopListener(ctx, state, nil)
	if err != nil {
		return fmt.Errorf("open current-user Windows Desktop transport: %w", err)
	}
	defer func() { _ = desktopListener.Close() }()
	localAppListener, err := protectedlocal.OpenWindowsVerifiedLocalAppListener(ctx, state)
	if err != nil {
		return fmt.Errorf("open current-user Windows local-app transport: %w", err)
	}
	defer func() { _ = localAppListener.Close() }()
	cfg, err := loadWindowsSourceLocalDevelopmentRuntimeConfig(state.ServiceStatePath())
	if err != nil {
		return fmt.Errorf("load current-user Windows Runtime configuration: %w", err)
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
	runtimeDaemon, err := daemon.NewProtectedFromWindowsSecurityState(cfg, logger, version, state, requestRestart)
	if err != nil {
		return fmt.Errorf("construct current-user Windows Runtime: %w", err)
	}
	stateOwnedByDaemon = true
	err = runtimeDaemon.RunProtectedWithLocalApp(ctx, desktopListener, localAppListener)
	if restartRequested.Load() {
		if err != nil && !errors.Is(err, context.Canceled) {
			return fmt.Errorf("current-user Windows Runtime restart shutdown failed: %w", err)
		}
		return fmt.Errorf("current-user Windows Runtime restart requested")
	}
	return err
}
