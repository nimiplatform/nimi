package engine

import (
	"errors"
	"sync"
	"time"
)

// residentLlamaIdleRelease is how long the llama worker stays loaded after its
// last request. A conversation with ordinary pauses keeps the model resident;
// once local use stops, its memory (tens of GiB for a large model) returns to
// the system, and the next request loads it again.
const residentLlamaIdleRelease = 10 * time.Minute

type residentIdleRelease struct {
	mu    sync.Mutex
	after time.Duration
	epoch uint64
	timer *time.Timer
}

// armIdleRelease restarts the idle clock once a request released the lease.
func (h *ExecutionHost) armIdleRelease() {
	h.idle.mu.Lock()
	defer h.idle.mu.Unlock()
	h.idle.epoch++
	epoch := h.idle.epoch
	after := h.idle.after
	if after <= 0 {
		after = residentLlamaIdleRelease
	}
	if h.idle.timer != nil {
		h.idle.timer.Stop()
	}
	h.idle.timer = time.AfterFunc(after, func() { h.releaseIfIdle(epoch) })
}

// releaseIfIdle stops the resident worker when no request used it since epoch.
// It takes the ordinary execution lease without waiting, so it never
// interrupts or races a request, and it waits for output still streaming; a
// request queued behind it simply loads a fresh worker.
func (h *ExecutionHost) releaseIfIdle(epoch uint64) {
	select {
	case <-h.lease:
	default:
		return
	}
	defer func() { h.lease <- struct{}{} }()
	h.idle.mu.Lock()
	unused := h.idle.epoch == epoch
	h.idle.mu.Unlock()
	if !unused {
		return
	}
	stopper, ok := h.substrate.(interface{ Stop() error })
	if !ok {
		return
	}
	h.residentModelAssets.mu.Lock()
	defer h.residentModelAssets.mu.Unlock()
	if h.residentModelAssets.outputs > 0 {
		return
	}
	if err := stopper.Stop(); err != nil && !errors.Is(err, ErrEngineNotRunning) {
		h.logger.Warn("release idle llama worker failed", "error", err)
		return
	}
	h.residentModelAssets.ids = nil
	h.logger.Info("released idle llama worker", "idle_after", h.idleReleaseAfter().String())
}

func (h *ExecutionHost) idleReleaseAfter() time.Duration {
	h.idle.mu.Lock()
	defer h.idle.mu.Unlock()
	if h.idle.after <= 0 {
		return residentLlamaIdleRelease
	}
	return h.idle.after
}
