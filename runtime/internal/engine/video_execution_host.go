package engine

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const defaultVideoCancelGrace = 2 * time.Second

// VideoExecutionHostConfig contains only Host-owned package/process facts.
type VideoExecutionHostConfig struct {
	PackageSource    string
	BackendDirectory string
	// ExecutablePath overrides the Runtime wrapper executable that exposes the
	// `managed-image-backend serve` subcommand. The backend executable itself is
	// discovered only inside BackendDirectory.
	ExecutablePath  string
	Environment     map[string]string
	StartupTimeout  time.Duration
	ShutdownTimeout time.Duration
	CancelGrace     time.Duration
}

type videoInvocationSubstrate interface {
	Ensure(context.Context, *capabilitydriver.VideoInvocationPlan, func() error, localexecution.VideoProgressFunc) (bool, error)
	GenerateVideo(context.Context, *capabilitydriver.VideoInvocationPlan, localexecution.VideoProgressFunc) (localexecution.RawAVCandidate, error)
	Cancel(context.Context) error
	Healthy() bool
	Stop() error
}

type videoExecutionRequest struct {
	ctx      context.Context
	plan     *capabilitydriver.VideoInvocationPlan
	onStart  localexecution.VideoExecutionStartFunc
	progress localexecution.VideoProgressFunc
	done     chan videoExecutionOutcome
}

type videoExecutionOutcome struct {
	candidate localexecution.RawAVCandidate
	err       error
}

type videoGenerateOutcome struct {
	candidate localexecution.RawAVCandidate
	err       error
}

// VideoExecutionHost owns one private FIFO and one video execution lease.
type VideoExecutionHost struct {
	logger      *slog.Logger
	substrate   videoInvocationSubstrate
	cancelGrace time.Duration
	admit       func(*capabilitydriver.VideoInvocationPlan) error

	mu             sync.Mutex
	queue          []*videoExecutionRequest
	active         *videoExecutionRequest
	stopping       bool
	wake           chan struct{}
	stop           chan struct{}
	stopped        chan struct{}
	lifetime       context.Context
	cancelLifetime context.CancelFunc
	stopOnce       sync.Once
}

func NewVideoExecutionHost(manager *Manager, logger *slog.Logger, config VideoExecutionHostConfig) *VideoExecutionHost {
	host := newVideoExecutionHostWithSubstrate(newManagerVideoInvocationSubstrate(manager, logger, config), logger, config.CancelGrace)
	host.admit = func(plan *capabilitydriver.VideoInvocationPlan) error {
		if err := validateVideoInvocationPlan(plan); err != nil {
			return err
		}
		if plan.RecipeID() != capabilitydriver.StableDiffusionVideoRecipeID {
			return fmt.Errorf("video invocation recipe %q has no managed package family", plan.RecipeID())
		}
		return admitManagedImageRecipeForCurrentHost(capabilitydriver.StableDiffusionVideoRecipeID, config.PackageSource)
	}
	return host
}

func newVideoExecutionHostWithSubstrate(substrate videoInvocationSubstrate, logger *slog.Logger, cancelGrace time.Duration) *VideoExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	if cancelGrace <= 0 {
		cancelGrace = defaultVideoCancelGrace
	}
	lifetime, cancelLifetime := context.WithCancel(context.Background())
	host := &VideoExecutionHost{
		logger: logger, substrate: substrate, cancelGrace: cancelGrace,
		admit: validateVideoInvocationPlan,
		wake:  make(chan struct{}, 1), stop: make(chan struct{}), stopped: make(chan struct{}),
		lifetime: lifetime, cancelLifetime: cancelLifetime,
	}
	go host.run()
	return host
}

// AdmitVideo validates the exact Driver plan against the current canonical
// host/package-family tuple before a Runtime Job is published.
func (h *VideoExecutionHost) AdmitVideo(plan *capabilitydriver.VideoInvocationPlan) error {
	if h == nil || h.substrate == nil || h.admit == nil {
		return fmt.Errorf("video execution host admission is unavailable")
	}
	return h.admit(plan)
}

func (h *VideoExecutionHost) ExecuteVideo(
	ctx context.Context,
	plan *capabilitydriver.VideoInvocationPlan,
	onStart localexecution.VideoExecutionStartFunc,
	progress localexecution.VideoProgressFunc,
) (localexecution.RawAVCandidate, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.substrate == nil {
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("video execution host is unavailable"))
	}
	if err := h.AdmitVideo(plan); err != nil {
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureInference, err)
	}
	request := &videoExecutionRequest{ctx: ctx, plan: plan, onStart: onStart, progress: progress, done: make(chan videoExecutionOutcome, 1)}
	if !h.enqueue(request) {
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("video execution host is stopping"))
	}
	for {
		select {
		case outcome := <-request.done:
			return cloneRawAVCandidate(outcome.candidate), outcome.err
		case <-ctx.Done():
			if h.removeQueued(request) {
				return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
			}
			// A running request returns only through the worker after cooperative
			// cancel or the owned Supervisor kill fallback has been observed.
			outcome := <-request.done
			return cloneRawAVCandidate(outcome.candidate), outcome.err
		case <-h.stop:
			outcome := <-request.done
			return cloneRawAVCandidate(outcome.candidate), outcome.err
		}
	}
}

func (h *VideoExecutionHost) Stop() error {
	if h == nil {
		return nil
	}
	var stopErr error
	h.stopOnce.Do(func() {
		h.mu.Lock()
		h.stopping = true
		queued := append([]*videoExecutionRequest(nil), h.queue...)
		h.queue = nil
		close(h.stop)
		h.cancelLifetime()
		h.mu.Unlock()
		for _, request := range queued {
			h.deliver(request, videoExecutionOutcome{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("video execution host stopped"))})
		}
		if h.substrate != nil {
			stopErr = h.substrate.Stop()
		}
		select {
		case h.wake <- struct{}{}:
		default:
		}
	})
	<-h.stopped
	return stopErr
}

func (h *VideoExecutionHost) enqueue(request *videoExecutionRequest) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.stopping {
		return false
	}
	h.queue = append(h.queue, request)
	select {
	case h.wake <- struct{}{}:
	default:
	}
	return true
}

func (h *VideoExecutionHost) removeQueued(request *videoExecutionRequest) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, queued := range h.queue {
		if queued != request {
			continue
		}
		copy(h.queue[index:], h.queue[index+1:])
		h.queue[len(h.queue)-1] = nil
		h.queue = h.queue[:len(h.queue)-1]
		return true
	}
	return false
}

func (h *VideoExecutionHost) dequeue() *videoExecutionRequest {
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

func (h *VideoExecutionHost) clearActive(request *videoExecutionRequest) {
	h.mu.Lock()
	if h.active == request {
		h.active = nil
	}
	h.mu.Unlock()
}

func (h *VideoExecutionHost) run() {
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
			h.deliver(request, videoExecutionOutcome{err: executionFailure(localexecution.FailureCanceled, request.ctx.Err())})
			continue
		}
		executionCtx, cancel := context.WithCancel(request.ctx)
		stopLink := context.AfterFunc(h.lifetime, cancel)
		copyRequest := *request
		copyRequest.ctx = executionCtx
		if err := beginVideoExecution(executionCtx, copyRequest.onStart); err != nil {
			stopLink()
			cancel()
			h.clearActive(request)
			h.deliver(request, videoExecutionOutcome{err: err})
			continue
		}
		candidate, err := h.execute(&copyRequest)
		stopLink()
		cancel()
		h.clearActive(request)
		h.deliver(request, videoExecutionOutcome{candidate: candidate, err: err})
		select {
		case <-h.stop:
			return
		default:
		}
	}
}

func beginVideoExecution(ctx context.Context, onStart localexecution.VideoExecutionStartFunc) error {
	if ctx != nil && ctx.Err() != nil {
		return executionFailure(localexecution.FailureCanceled, ctx.Err())
	}
	if onStart == nil {
		return nil
	}
	if err := onStart(); err != nil {
		return err
	}
	return nil
}

func (h *VideoExecutionHost) execute(request *videoExecutionRequest) (localexecution.RawAVCandidate, error) {
	startedAt := time.Now()
	_, err := h.substrate.Ensure(request.ctx, request.plan, func() error {
		if err := validateInvocationDependencySources(h.substrate, request.plan.DependencySources()); err != nil {
			return err
		}
		return validateInvocationModelContentContext(request.ctx, request.plan.ExactBindings())
	}, request.progress)
	if err != nil {
		if request.ctx.Err() != nil {
			_ = h.stopCanceledSubstrate()
			return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
		}
		if localexecution.FailureKindOf(err) != "" {
			return localexecution.RawAVCandidate{}, err
		}
		return localexecution.RawAVCandidate{}, classifiedExecutionFailure(localexecution.FailureLoad, fmt.Errorf("load video invocation substrate: %w", err), executionFailureDiagnostic(h.substrate))
	}
	if request.progress != nil {
		request.progress(localexecution.VideoExecutionProgress{Stage: localexecution.VideoExecutionStageGenerating, FrameCount: int32(request.plan.FrameCount())})
	}
	resultCh := make(chan videoGenerateOutcome, 1)
	go func() {
		candidate, generateErr := h.substrate.GenerateVideo(request.ctx, request.plan, request.progress)
		resultCh <- videoGenerateOutcome{candidate: candidate, err: generateErr}
	}()
	var generated videoGenerateOutcome
	select {
	case generated = <-resultCh:
		if request.ctx.Err() != nil {
			_ = h.cancelAndObserve(nil)
			return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
		}
	case <-request.ctx.Done():
		_ = h.cancelAndObserve(resultCh)
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
	}
	if generated.err != nil {
		if executionOutOfMemory(generated.err, executionFailureDiagnostic(h.substrate)) {
			return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureOutOfMemory, generated.err)
		}
		if !h.substrate.Healthy() {
			return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("video substrate process exited: %w", generated.err))
		}
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureInference, fmt.Errorf("generate raw AV candidate: %w", generated.err))
	}
	if err := validateRawAVCandidate(request.plan, generated.candidate); err != nil {
		return localexecution.RawAVCandidate{}, executionFailure(localexecution.FailureInference, err)
	}
	generated.candidate.ComputeMS = time.Since(startedAt).Milliseconds()
	if request.progress != nil {
		request.progress(localexecution.VideoExecutionProgress{Stage: localexecution.VideoExecutionStageProduced, FrameIndex: int32(request.plan.FrameCount()), FrameCount: int32(request.plan.FrameCount())})
	}
	return cloneRawAVCandidate(generated.candidate), nil
}

func (h *VideoExecutionHost) cancelAndObserve(resultCh <-chan videoGenerateOutcome) error {
	cancelCtx, cancel := context.WithTimeout(context.Background(), h.cancelGrace)
	cancelErr := h.substrate.Cancel(cancelCtx)
	cancel()
	if cancelErr == nil {
		if resultCh == nil {
			return nil
		}
		observationGrace := 100 * time.Millisecond
		if h.cancelGrace < observationGrace {
			observationGrace = h.cancelGrace
		}
		timer := time.NewTimer(observationGrace)
		defer timer.Stop()
		select {
		case <-resultCh:
			return nil
		case <-timer.C:
		}
	}
	return h.substrate.Stop()
}

func (h *VideoExecutionHost) stopCanceledSubstrate() error {
	cancelCtx, cancel := context.WithTimeout(context.Background(), h.cancelGrace)
	_ = h.substrate.Cancel(cancelCtx)
	cancel()
	return h.substrate.Stop()
}

func (h *VideoExecutionHost) deliver(request *videoExecutionRequest, outcome videoExecutionOutcome) {
	outcome.candidate = cloneRawAVCandidate(outcome.candidate)
	select {
	case request.done <- outcome:
	default:
	}
}

func validateVideoInvocationPlan(plan *capabilitydriver.VideoInvocationPlan) error {
	if plan == nil || strings.TrimSpace(plan.ProcessKey()) == "" || strings.TrimSpace(plan.Prompt()) == "" || plan.FrameCount() < 1 || plan.FPS() != 24 || !plan.AudioRequired() {
		return fmt.Errorf("video invocation plan is incomplete")
	}
	width, height := plan.Size()
	if width <= 0 || height <= 0 {
		return fmt.Errorf("video invocation plan has invalid dimensions")
	}
	for _, path := range []string{plan.DiffusionModelPath(), plan.EncoderPath(), plan.VideoVAEPath(), plan.AudioVAEPath()} {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return fmt.Errorf("video invocation plan has a non-absolute model path")
		}
	}
	if len(plan.ModelFiles()) != 4 {
		return fmt.Errorf("video invocation plan has incomplete exact model content")
	}
	return nil
}

func validateRawAVCandidate(plan *capabilitydriver.VideoInvocationPlan, candidate localexecution.RawAVCandidate) error {
	width, height := plan.Size()
	expectedBytes64 := int64(width) * int64(height) * 3
	if expectedBytes64 <= 0 || int64(int(expectedBytes64)) != expectedBytes64 || candidate.FrameCount != plan.FrameCount() || len(candidate.Frames) != plan.FrameCount() || candidate.FPS != 24 {
		return fmt.Errorf("video substrate returned an invalid frame set")
	}
	for index, frame := range candidate.Frames {
		if frame.Width != width || frame.Height != height || len(frame.RGBBytes) != int(expectedBytes64) {
			return fmt.Errorf("video substrate returned invalid frame %d", index)
		}
	}
	if len(candidate.Audio.PCMSamples) == 0 || len(candidate.Audio.PCMSamples)%2 != 0 || candidate.Audio.Channels != 2 || candidate.Audio.SampleRate != 32000 {
		return fmt.Errorf("video substrate returned invalid required audio")
	}
	return nil
}

func cloneRawAVCandidate(input localexecution.RawAVCandidate) localexecution.RawAVCandidate {
	output := localexecution.RawAVCandidate{FrameCount: input.FrameCount, FPS: input.FPS, ComputeMS: input.ComputeMS}
	output.Frames = make([]localexecution.RawVideoFrame, 0, len(input.Frames))
	for _, frame := range input.Frames {
		output.Frames = append(output.Frames, localexecution.RawVideoFrame{RGBBytes: append([]byte(nil), frame.RGBBytes...), Width: frame.Width, Height: frame.Height})
	}
	output.Audio = localexecution.RawAudio{PCMSamples: append([]float32(nil), input.Audio.PCMSamples...), Channels: input.Audio.Channels, SampleRate: input.Audio.SampleRate}
	return output
}
