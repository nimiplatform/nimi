package engine

import (
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// This is private resident-process state, not another inventory or reference
// database. Only typed captured bindings enter it. A failed stop keeps the
// bindings so file cleanup cannot mistake an unconfirmed process exit for exit.
type residentModelAssets struct {
	mu      sync.Mutex
	ids     map[string]struct{}
	onIdle  func()
	outputs int
}

func (r *residentModelAssets) capture(files []capabilitydriver.InvocationExactBinding) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ids == nil {
		r.ids = make(map[string]struct{})
	}
	for _, file := range files {
		if file.ModelAssetID != "" {
			r.ids[file.ModelAssetID] = struct{}{}
		}
	}
}

func (r *residentModelAssets) uses(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, found := r.ids[id]
	return found
}

func (r *residentModelAssets) SetModelAssetCleanupCallback(callback func()) {
	r.mu.Lock()
	r.onIdle = callback
	r.mu.Unlock()
}

func (r *residentModelAssets) notifyIdle() {
	r.mu.Lock()
	callback := r.onIdle
	r.mu.Unlock()
	if callback != nil {
		callback()
	}
}

// Caller has acquired the Host's ordinary exclusive execution lease.
func (r *residentModelAssets) retire(id string, stop func() error) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, found := r.ids[id]; !found {
		return true, nil
	}
	if r.outputs > 0 {
		return false, nil
	}
	if err := stop(); err != nil && !errors.Is(err, ErrEngineNotRunning) {
		return false, err
	}
	r.ids = nil
	return true, nil
}

// Inference capacity may be reused once headers arrive, while HTTP output
// still depends on the process. Output transfer delays retirement only.
func (r *residentModelAssets) holdOutput(body io.ReadCloser) io.ReadCloser {
	r.mu.Lock()
	r.outputs++
	r.mu.Unlock()
	return &residentOutputBody{ReadCloser: body, release: func() {
		r.mu.Lock()
		r.outputs--
		r.mu.Unlock()
		r.notifyIdle()
	}}
}

func (h *ExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !h.residentModelAssets.uses(id) {
		return true, nil
	}
	select {
	case <-h.lease:
	default:
		return false, nil
	}
	defer func() { h.lease <- struct{}{} }()
	return h.residentModelAssets.retire(id, func() error {
		stopper, ok := h.substrate.(interface{ Stop() error })
		if !ok {
			return fmt.Errorf("llama substrate has no retirement owner")
		}
		return stopper.Stop()
	})
}

func (s *managerLlamaInvocationSubstrate) Stop() error {
	s.mu.Lock()
	load := s.loading
	if load != nil && load.cancel != nil {
		load.cancel()
	}
	s.mu.Unlock()
	if load != nil {
		<-load.done
	}
	if err := s.manager.StopEngine(EngineLlama); err != nil && !errors.Is(err, ErrEngineNotRunning) {
		return err
	}
	s.mu.Lock()
	s.currentKey = ""
	s.mu.Unlock()
	return nil
}

func (h *ImageExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !h.residentModelAssets.uses(id) {
		return true, nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.active != nil || len(h.queue) > 0 {
		return false, nil
	}
	return h.residentModelAssets.retire(id, h.substrate.Stop)
}

func (h *VideoExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !h.residentModelAssets.uses(id) {
		return true, nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.active != nil || len(h.queue) > 0 {
		return false, nil
	}
	return h.residentModelAssets.retire(id, h.substrate.Stop)
}

// Reserve idle capacity without waiting behind or interrupting a captured Job.
func (lease *speechExecutionLease) tryAcquireIdle() (func(), bool) {
	lease.mu.Lock()
	if lease.active || len(lease.queue) > 0 {
		lease.mu.Unlock()
		return nil, false
	}
	lease.active = true
	lease.mu.Unlock()
	return lease.releaseGranted, true
}

func (host *VisionExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !host.residentModelAssets.uses(id) {
		return true, nil
	}
	release, ok := host.lease.tryAcquireIdle()
	if !ok {
		return false, nil
	}
	defer release()
	return host.residentModelAssets.retire(id, host.stop)
}

func (host *TextAnnotationExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !host.residentModelAssets.uses(id) {
		return true, nil
	}
	release, ok := host.lease.tryAcquireIdle()
	if !ok {
		return false, nil
	}
	defer release()
	return host.residentModelAssets.retire(id, host.stop)
}

func (host *FaceSwapExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !host.residentModelAssets.uses(id) {
		return true, nil
	}
	release, ok := host.lease.tryAcquireIdle()
	if !ok {
		return false, nil
	}
	defer release()
	return host.residentModelAssets.retire(id, host.stop)
}

func (host *SpeechExecutionHost) RetireModelAsset(id string) (bool, error) {
	if !host.residentModelAssets.uses(id) {
		return true, nil
	}
	release, ok := host.lease.tryAcquireIdle()
	if !ok {
		return false, nil
	}
	defer release()
	return host.residentModelAssets.retire(id, host.materializer.StopSpeechExecutionHost)
}
