package engine

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const engineImageExecutionHost EngineKind = "image-execution-host"

// ImageExecutionHostConfig contains Host-owned substrate facts. None of these
// values participate in capability selection or Driver interpretation.
type ImageExecutionHostConfig struct {
	PackageSource    string
	BackendDirectory string
	ExecutablePath   string
	LibraryPath      string
	WorkRoot         string
	Environment      map[string]string
	StartupTimeout   time.Duration
	ShutdownTimeout  time.Duration
}

type imageInvocationSubstrate interface {
	Ensure(
		context.Context,
		*capabilitydriver.ImageInvocationPlan,
		func() error,
		localexecution.ImageProgressFunc,
	) (bool, error)
	GenerateImage(context.Context, *capabilitydriver.ImageInvocationPlan, int32, localexecution.ImageProgressFunc) (localexecution.ImageArtifact, error)
	Healthy() bool
	Stop() error
}

type imageExecutionRequest struct {
	ctx        context.Context
	plan       *capabilitydriver.ImageInvocationPlan
	onStart    localexecution.ImageExecutionStartFunc
	onArtifact localexecution.ImageArtifactFunc
	progress   localexecution.ImageProgressFunc
	done       chan imageExecutionOutcome
}

type imageExecutionOutcome struct {
	result localexecution.ImageResult
	err    error
}

// ImageExecutionHost owns one FIFO worker and therefore one serial execution
// lease for its image engine instance. Queue state is intentionally private;
// callers observe queued jobs through their scenario Job state until the
// factual Host start callback.
type ImageExecutionHost struct {
	logger    *slog.Logger
	substrate imageInvocationSubstrate

	mu             sync.Mutex
	queue          []*imageExecutionRequest
	active         *imageExecutionRequest
	stopping       bool
	wake           chan struct{}
	stop           chan struct{}
	stopped        chan struct{}
	lifetime       context.Context
	cancelLifetime context.CancelFunc
	stopOnce       sync.Once
}

func NewImageExecutionHost(manager *Manager, logger *slog.Logger, config ImageExecutionHostConfig) *ImageExecutionHost {
	return newImageExecutionHostWithSubstrate(newManagerImageInvocationSubstrate(manager, logger, config), logger)
}

func newImageExecutionHostWithSubstrate(substrate imageInvocationSubstrate, logger *slog.Logger) *ImageExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	lifetime, cancelLifetime := context.WithCancel(context.Background())
	host := &ImageExecutionHost{
		logger:         logger,
		substrate:      substrate,
		wake:           make(chan struct{}, 1),
		stop:           make(chan struct{}),
		stopped:        make(chan struct{}),
		lifetime:       lifetime,
		cancelLifetime: cancelLifetime,
	}
	go host.run()
	return host
}

func (h *ImageExecutionHost) ExecuteImage(
	ctx context.Context,
	plan *capabilitydriver.ImageInvocationPlan,
	onStart localexecution.ImageExecutionStartFunc,
	onArtifact localexecution.ImageArtifactFunc,
	progress localexecution.ImageProgressFunc,
) (localexecution.ImageResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if h == nil || h.substrate == nil {
		return localexecution.ImageResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("image execution host is unavailable"))
	}
	if err := validateImageInvocationPlan(plan); err != nil {
		return localexecution.ImageResult{}, executionFailure(localexecution.FailureInference, err)
	}
	request := &imageExecutionRequest{
		ctx:        ctx,
		plan:       plan,
		onStart:    onStart,
		onArtifact: onArtifact,
		progress:   progress,
		done:       make(chan imageExecutionOutcome, 1),
	}
	if !h.enqueue(request) {
		return localexecution.ImageResult{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("image execution host is stopping"))
	}

	for {
		select {
		case outcome := <-request.done:
			return cloneImageResult(outcome.result), outcome.err
		case <-ctx.Done():
			if h.removeQueued(request) {
				return localexecution.ImageResult{}, executionFailure(localexecution.FailureCanceled, ctx.Err())
			}
			// A running request returns only after the Host worker has observed
			// cancellation and released the private execution lease.
			outcome := <-request.done
			return cloneImageResult(outcome.result), outcome.err
		case <-h.stop:
			outcome := <-request.done
			return cloneImageResult(outcome.result), outcome.err
		}
	}
}

func (h *ImageExecutionHost) Stop() error {
	if h == nil {
		return nil
	}
	var stopErr error
	h.stopOnce.Do(func() {
		h.mu.Lock()
		h.stopping = true
		queued := append([]*imageExecutionRequest(nil), h.queue...)
		h.queue = nil
		close(h.stop)
		if h.cancelLifetime != nil {
			h.cancelLifetime()
		}
		h.mu.Unlock()
		for _, request := range queued {
			h.deliver(request, imageExecutionOutcome{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("image execution host stopped"))})
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

func (h *ImageExecutionHost) enqueue(request *imageExecutionRequest) bool {
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

func (h *ImageExecutionHost) removeQueued(request *imageExecutionRequest) bool {
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

func (h *ImageExecutionHost) dequeue() *imageExecutionRequest {
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

func (h *ImageExecutionHost) clearActive(request *imageExecutionRequest) {
	h.mu.Lock()
	if h.active == request {
		h.active = nil
	}
	h.mu.Unlock()
}

func (h *ImageExecutionHost) run() {
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
		select {
		case <-h.stop:
			h.deliver(request, imageExecutionOutcome{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("image execution host stopped"))})
			return
		default:
		}
		if request.ctx.Err() != nil {
			h.clearActive(request)
			h.deliver(request, imageExecutionOutcome{err: executionFailure(localexecution.FailureCanceled, request.ctx.Err())})
			continue
		}
		executionCtx, cancelExecution := context.WithCancel(request.ctx)
		stopLink := context.AfterFunc(h.lifetime, cancelExecution)
		executionRequest := *request
		executionRequest.ctx = executionCtx
		if err := beginImageExecution(executionCtx, executionRequest.onStart); err != nil {
			stopLink()
			cancelExecution()
			h.clearActive(request)
			h.deliver(request, imageExecutionOutcome{err: err})
			continue
		}
		result, err := h.execute(&executionRequest)
		stopLink()
		cancelExecution()
		h.clearActive(request)
		h.deliver(request, imageExecutionOutcome{result: result, err: err})
	}
}

func beginImageExecution(ctx context.Context, onStart localexecution.ImageExecutionStartFunc) error {
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

func (h *ImageExecutionHost) execute(request *imageExecutionRequest) (localexecution.ImageResult, error) {
	startedAt := time.Now()
	_, err := h.substrate.Ensure(request.ctx, request.plan, func() error {
		return validateImageInvocationModelContentContext(request.ctx, request.plan.ModelFiles())
	}, request.progress)
	if err != nil {
		if request.ctx.Err() != nil {
			_ = h.substrate.Stop()
			return localexecution.ImageResult{}, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
		}
		if kind := localexecution.FailureKindOf(err); kind != "" {
			return localexecution.ImageResult{}, err
		}
		return localexecution.ImageResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("load image invocation substrate: %w", err))
	}

	count := int32(request.plan.ImageCount())
	result := localexecution.ImageResult{Artifacts: make([]localexecution.ImageArtifact, 0, count)}
	for index := int32(1); index <= count; index++ {
		if request.ctx.Err() != nil {
			_ = h.substrate.Stop()
			result.ComputeMS = time.Since(startedAt).Milliseconds()
			return result, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
		}
		if request.progress != nil {
			request.progress(localexecution.ImageExecutionProgress{
				Stage:         localexecution.ImageExecutionStageGenerating,
				ArtifactIndex: index,
				ArtifactCount: count,
			})
		}
		artifact, generateErr := h.substrate.GenerateImage(request.ctx, request.plan, index, request.progress)
		if generateErr != nil {
			result.ComputeMS = time.Since(startedAt).Milliseconds()
			if request.ctx.Err() != nil {
				_ = h.substrate.Stop()
				return result, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
			}
			if !h.substrate.Healthy() {
				return result, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("image substrate process exited: %w", generateErr))
			}
			return result, executionFailure(localexecution.FailureInference, fmt.Errorf("generate image artifact %d: %w", index, generateErr))
		}
		if artifact.Index == 0 {
			artifact.Index = index
		}
		if artifact.Index != index || len(artifact.Bytes) == 0 || strings.TrimSpace(artifact.MediaType) == "" {
			result.ComputeMS = time.Since(startedAt).Milliseconds()
			return result, executionFailure(localexecution.FailureInference, fmt.Errorf("image substrate returned an invalid artifact %d", index))
		}
		artifact.Bytes = append([]byte(nil), artifact.Bytes...)
		result.Artifacts = append(result.Artifacts, artifact)
		if request.onArtifact != nil {
			if callbackErr := request.onArtifact(cloneImageArtifact(artifact)); callbackErr != nil {
				result.ComputeMS = time.Since(startedAt).Milliseconds()
				if request.ctx.Err() != nil {
					_ = h.substrate.Stop()
					return result, executionFailure(localexecution.FailureCanceled, request.ctx.Err())
				}
				return result, executionFailure(localexecution.FailureInference, fmt.Errorf("commit image artifact %d: %w", index, callbackErr))
			}
		}
		if request.progress != nil {
			request.progress(localexecution.ImageExecutionProgress{
				Stage:         localexecution.ImageExecutionStageProduced,
				ArtifactIndex: index,
				ArtifactCount: count,
			})
		}
	}
	result.ComputeMS = time.Since(startedAt).Milliseconds()
	return result, nil
}

func (h *ImageExecutionHost) deliver(request *imageExecutionRequest, outcome imageExecutionOutcome) {
	if request == nil {
		return
	}
	outcome.result = cloneImageResult(outcome.result)
	select {
	case request.done <- outcome:
	default:
	}
}

func validateImageInvocationPlan(plan *capabilitydriver.ImageInvocationPlan) error {
	if plan == nil {
		return fmt.Errorf("image invocation plan is required")
	}
	return plan.Validate()
}

func cloneImageArtifact(input localexecution.ImageArtifact) localexecution.ImageArtifact {
	input.Bytes = append([]byte(nil), input.Bytes...)
	return input
}

func cloneImageResult(input localexecution.ImageResult) localexecution.ImageResult {
	output := localexecution.ImageResult{ComputeMS: input.ComputeMS}
	if len(input.Artifacts) == 0 {
		return output
	}
	output.Artifacts = make([]localexecution.ImageArtifact, 0, len(input.Artifacts))
	for _, artifact := range input.Artifacts {
		output.Artifacts = append(output.Artifacts, cloneImageArtifact(artifact))
	}
	return output
}
