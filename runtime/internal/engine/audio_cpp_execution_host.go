package engine

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type audioCppCLIProcessResult struct {
	result localexecution.MusicResult
	err    error
}

type audioCppCLIRunner func(context.Context, *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error)

type audioCppMusicRequest struct {
	ctx     context.Context
	plan    *capabilitydriver.MusicInvocationPlan
	onStart localexecution.MusicExecutionStartFunc
	done    chan audioCppCLIProcessResult
}

// @nimi-authority: definition.nimi.platform.core-protocol.execution-host
// AudioCppExecutionHost is the sole local Music execution implementation. It
// owns one FIFO and starts one exact official CLI process per dispatched Job.
type AudioCppExecutionHost struct {
	logger *slog.Logger
	runCLI audioCppCLIRunner

	mu           sync.Mutex
	queue        []*audioCppMusicRequest
	active       *audioCppMusicRequest
	cancelActive context.CancelFunc
	stopping     bool
	wake         chan struct{}
	stop         chan struct{}
	stopped      chan struct{}
	stopOnce     sync.Once
}

var _ localexecution.MusicExecutionHost = (*AudioCppExecutionHost)(nil)

func NewAudioCppExecutionHost(logger *slog.Logger) *AudioCppExecutionHost {
	return newAudioCppExecutionHostWithRunner(logger, runAudioCppCLIProcess)
}

func newAudioCppExecutionHostWithRunner(logger *slog.Logger, runner audioCppCLIRunner) *AudioCppExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	host := &AudioCppExecutionHost{logger: logger, runCLI: runner, wake: make(chan struct{}, 1), stop: make(chan struct{}), stopped: make(chan struct{})}
	go host.run()
	return host
}

func (h *AudioCppExecutionHost) ExecuteMusic(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan, onStart localexecution.MusicExecutionStartFunc) (localexecution.MusicResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.runCLI == nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp execution host is unavailable"))
	}
	if err := validateAudioCppMusicPlan(plan); err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	request := &audioCppMusicRequest{ctx: ctx, plan: plan, onStart: onStart, done: make(chan audioCppCLIProcessResult, 1)}
	if !h.enqueue(request) {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("audio.cpp execution host is stopping"))
	}
	select {
	case outcome := <-request.done:
		return outcome.result, outcome.err
	case <-ctx.Done():
		if h.removeQueued(request) {
			return localexecution.MusicResult{}, musicContextFailure(ctx.Err())
		}
		outcome := <-request.done
		return outcome.result, outcome.err
	case <-h.stop:
		outcome := <-request.done
		return outcome.result, outcome.err
	}
}

func (h *AudioCppExecutionHost) Stop() error {
	if h == nil {
		return nil
	}
	h.stopOnce.Do(func() {
		h.mu.Lock()
		h.stopping = true
		queued := append([]*audioCppMusicRequest(nil), h.queue...)
		h.queue = nil
		close(h.stop)
		cancelActive := h.cancelActive
		h.mu.Unlock()
		for _, request := range queued {
			h.deliver(request, audioCppCLIProcessResult{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("audio.cpp execution host stopped"))})
		}
		if cancelActive != nil {
			cancelActive()
		}
		select {
		case h.wake <- struct{}{}:
		default:
		}
	})
	<-h.stopped
	return nil
}

func (h *AudioCppExecutionHost) enqueue(request *audioCppMusicRequest) bool {
	h.mu.Lock()
	if h.stopping {
		h.mu.Unlock()
		return false
	}
	h.queue = append(h.queue, request)
	h.mu.Unlock()
	select {
	case h.wake <- struct{}{}:
	default:
	}
	return true
}
func (h *AudioCppExecutionHost) removeQueued(request *audioCppMusicRequest) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, queued := range h.queue {
		if queued == request {
			copy(h.queue[index:], h.queue[index+1:])
			h.queue[len(h.queue)-1] = nil
			h.queue = h.queue[:len(h.queue)-1]
			return true
		}
	}
	return false
}
func (h *AudioCppExecutionHost) dequeue() *audioCppMusicRequest {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.queue) == 0 {
		return nil
	}
	request := h.queue[0]
	copy(h.queue, h.queue[1:])
	h.queue[len(h.queue)-1] = nil
	h.queue = h.queue[:len(h.queue)-1]
	h.active = request
	return request
}
func (h *AudioCppExecutionHost) clearActive(request *audioCppMusicRequest) {
	h.mu.Lock()
	if h.active == request {
		h.active = nil
		h.cancelActive = nil
	}
	h.mu.Unlock()
}
func (h *AudioCppExecutionHost) deliver(request *audioCppMusicRequest, outcome audioCppCLIProcessResult) {
	select {
	case request.done <- outcome:
	default:
	}
}

func (h *AudioCppExecutionHost) run() {
	defer close(h.stopped)
	for {
		request := h.dequeue()
		if request == nil {
			select {
			case <-h.stop:
				return
			case <-h.wake:
				continue
			}
		}
		if request.ctx.Err() != nil {
			h.clearActive(request)
			h.deliver(request, audioCppCLIProcessResult{err: musicContextFailure(request.ctx.Err())})
			continue
		}
		executionCtx, cancelExecution := context.WithCancel(request.ctx)
		h.mu.Lock()
		h.cancelActive = cancelExecution
		h.mu.Unlock()
		if request.onStart != nil {
			if err := request.onStart(); err != nil {
				cancelExecution()
				h.clearActive(request)
				h.deliver(request, audioCppCLIProcessResult{err: err})
				continue
			}
		}
		result, err := h.runCLI(executionCtx, request.plan)
		cancelExecution()
		h.clearActive(request)
		h.deliver(request, audioCppCLIProcessResult{result: result, err: err})
	}
}

func runAudioCppCLIProcess(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error) {
	if err := validateAudioCppMusicPlan(plan); err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	// Reject the complete output set before cleanup can acquire any of its paths.
	// A repeated dispatch must never remove an earlier score or audio result.
	for _, path := range []string{plan.StagingWAVPath(), plan.StagingScorePath()} {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("audio.cpp music output already exists"))
		} else if !os.IsNotExist(err) {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("stat audio.cpp music output: %w", err))
		}
	}
	args, err := audioCppCLIArgs(plan)
	if err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	createdInputs := []string{}
	defer func() {
		for _, path := range createdInputs {
			_ = os.Remove(path)
		}
	}()
	requestPath, requestData := plan.RequestJSON()
	scorePath, scoreData := plan.ScoreInput()
	for _, input := range []struct {
		path string
		data []byte
	}{{requestPath, requestData}, {scorePath, scoreData}} {
		if input.path == "" && len(input.data) == 0 {
			continue
		}
		if filepath.Dir(input.path) != filepath.Dir(plan.StagingWAVPath()) || len(input.data) == 0 || len(input.data) > 1<<20 {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("music input materialization is invalid"))
		}
		if err := ctx.Err(); err != nil {
			return localexecution.MusicResult{}, musicContextFailure(err)
		}
		file, err := os.OpenFile(input.path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("create private music input: %w", err))
		}
		createdInputs = append(createdInputs, input.path)
		written, writeErr := file.Write(input.data)
		closeErr := file.Close()
		if writeErr == nil && written != len(input.data) {
			writeErr = io.ErrShortWrite
		}
		if writeErr == nil {
			writeErr = closeErr
		}
		if writeErr != nil {
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("write private music input: %w", writeErr))
		}
	}
	observer := plan.NewOutputObserver()
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: plan.AudioCppExecutablePath(), workingDir: plan.AudioCppRoot(), cuda13Root: plan.CUDA13Root(), args: args, stagingOutputPath: plan.StagingWAVPath(), modelBindings: []capabilitydriver.InvocationExactBinding{plan.ModelBinding()}, outputObserver: observer})
	if err != nil {
		cleanupAudioCppStaging(plan.StagingScorePath())
		return localexecution.MusicResult{}, err
	}
	facts := capabilitydriver.MusicInferenceFacts{Termination: capabilitydriver.MusicTerminationUnknown}
	if observer != nil {
		facts, err = observer.Facts()
		if err != nil {
			cleanupAudioCppStaging(plan.StagingWAVPath(), plan.StagingScorePath())
			return localexecution.MusicResult{}, executionFailure(localexecution.FailureInference, err)
		}
	}
	return localexecution.MusicResult{StagingWAVPath: plan.StagingWAVPath(), StagingScorePath: plan.StagingScorePath(), InferenceFacts: facts, SizeBytes: outcome.sizeBytes, ComputeMS: outcome.computeMS}, nil
}

func audioCppCLIArgs(plan *capabilitydriver.MusicInvocationPlan) ([]string, error) {
	if plan == nil || len(plan.CLIArgs()) == 0 {
		return nil, fmt.Errorf("audio.cpp Music Driver did not supply an invocation")
	}
	return plan.CLIArgs(), nil
}

func validateAudioCppMusicPlan(plan *capabilitydriver.MusicInvocationPlan) error {
	if plan == nil || plan.ProcessKey() == "" || len(plan.CLIArgs()) == 0 || plan.AudioCppPackageID() != capabilitydriver.AudioCppWindowsCUDA13PackageID || plan.CUDA13DependencyID() != capabilitydriver.AudioCppCUDA13RuntimeDependencyID || plan.AudioCppSelectedSourceRecordID() == "" || plan.CUDA13SelectedSourceRecordID() == "" || !filepath.IsAbs(plan.AudioCppExecutablePath()) || !filepath.IsAbs(plan.CUDA13Root()) || !filepath.IsAbs(plan.ModelRoot()) || !filepath.IsAbs(plan.StagingWAVPath()) {
		return fmt.Errorf("audio.cpp Music invocation plan is incomplete")
	}
	return nil
}

func musicContextFailure(err error) error { return audioCppContextFailure(err) }
