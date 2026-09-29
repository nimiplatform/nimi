package daemon

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcserver"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

// maintenanceStopBudget bounds how long in-flight maintenance calls may hold
// shutdown after a restart request or signal.
const maintenanceStopBudget = 10 * time.Second

func newMaintenanceDaemon(cfg config.Config, logger *slog.Logger, maintenance *grpcserver.MaintenanceServer, closeProtectedState func() error) *Daemon {
	if logger == nil {
		logger = slog.Default()
	}
	return &Daemon{
		cfg:                 cfg,
		logger:              logger,
		state:               health.NewState(),
		maintenance:         maintenance,
		protected:           true,
		protectedStateClose: closeProtectedState,
		readyCh:             make(chan struct{}),
	}
}

// Maintenance reports whether this daemon serves only the maintenance surface
// because an owner refused the stored data in the selected root.
func (d *Daemon) Maintenance() bool {
	return d != nil && d.maintenance != nil
}

// @nimi-authority: rule.nimi.runtime.service-operations.r092
// runMaintenance serves only the bounded maintenance surface on the verified
// Desktop transport. No owner, engine, sampler, or local-app transport runs;
// the service host still sees a serving process so it does not restart-loop.
func (d *Daemon) runMaintenance(ctx context.Context, desktopListener net.Listener, localAppListener net.Listener) error {
	if ctx == nil {
		return fmt.Errorf("Runtime context is required")
	}
	if localAppListener != nil {
		_ = localAppListener.Close()
	}
	refusal := d.maintenance.Refusal()
	d.state.SetStatus(health.StatusStopped, "maintenance: refused stored data")
	d.logger.Warn("runtime serving maintenance only: an owner refused the stored data in the selected data root",
		"owner", refusal.Owner(),
		"offline_handling", string(refusal.Handling()),
		"reason_code", "RUNTIME_STORED_DATA_UNSUPPORTED",
		"detail", refusal.Error(),
	)
	errCh := make(chan error, 1)
	go func() { errCh <- d.maintenance.ServeVerifiedNativeDesktop(desktopListener) }()
	// Service hosts report the process as serving; the typed mode, not this
	// signal, tells Desktop it is maintenance only.
	d.readyOnce.Do(func() { close(d.readyCh) })
	var serveErr error
	select {
	case <-ctx.Done():
		d.logger.Info("runtime maintenance shutdown requested")
	case serveErr = <-errCh:
		if serveErr != nil {
			d.logger.Error("runtime maintenance server exited with error", "error", serveErr)
		}
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), maintenanceStopBudget)
	defer cancel()
	d.maintenance.Stop(stopCtx)
	_ = desktopListener.Close()
	closeErr := d.closeProtectedState()
	d.state.SetStatus(health.StatusStopped, "stopped")
	if serveErr != nil && !errors.Is(serveErr, net.ErrClosed) {
		return errors.Join(serveErr, closeErr)
	}
	return closeErr
}
