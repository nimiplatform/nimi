package nimiappinstall

import (
	"context"
	"errors"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040d
// A successful data-root handoff leaves the old owner inert but still open so
// an aborted handoff can re-enable commands without resuming paused downloads.
func (coordinator *Coordinator) QuiesceDataRootContext(ctx context.Context) error {
	if coordinator == nil || ctx == nil {
		return ErrInvalidCoordinator
	}
	return coordinator.quiesce(ctx)
}

func (coordinator *Coordinator) quiesce(ctx context.Context) error {
	coordinator.workersMu.Lock()
	if coordinator.quiesced {
		coordinator.workersMu.Unlock()
		return nil
	}
	coordinator.quiescing = true
	for _, worker := range coordinator.workers {
		worker.requestPause("runtime-interrupted")
	}
	coordinator.workersMu.Unlock()
	// Sync API calls may have crossed their admission check before quiescing.
	// Drain those calls before taking the final durable queue snapshot.
	acquired := make(chan struct{})
	go func() {
		coordinator.operations.Lock()
		select {
		case acquired <- struct{}{}:
		case <-ctx.Done():
			coordinator.operations.Unlock()
		}
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-acquired:
	}
	defer coordinator.operations.Unlock()
	coordinator.workersMu.Lock()
	alreadyQuiesced := coordinator.quiesced
	coordinator.workersMu.Unlock()
	if alreadyQuiesced {
		return nil
	}
	finished := make(chan struct{})
	go func() { coordinator.workersWG.Wait(); close(finished) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-finished:
	}
	if coordinator.packagesRoot == nil {
		return nil
	}
	if err := coordinator.recoverLocked(ctx); err != nil {
		return errors.Join(ErrInstallRecoveryRequired, err)
	}
	coordinator.workersMu.Lock()
	coordinator.quiesced = true
	coordinator.workersMu.Unlock()
	return nil
}

func (coordinator *Coordinator) ResumeDataRootAfterAbort() {
	if coordinator == nil {
		return
	}
	coordinator.workersMu.Lock()
	defer coordinator.workersMu.Unlock()
	if !coordinator.closing {
		coordinator.quiescing, coordinator.quiesced = false, false
	}
}
