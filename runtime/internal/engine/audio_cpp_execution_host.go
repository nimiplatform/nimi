package engine

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strconv"
	"strings"
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
	args, err := audioCppCLIArgs(plan)
	if err != nil {
		return localexecution.MusicResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: plan.AudioCppExecutablePath(), workingDir: plan.AudioCppRoot(), cuda13Root: plan.CUDA13Root(), args: args, stagingOutputPath: plan.StagingWAVPath(), modelBindings: []capabilitydriver.InvocationExactBinding{plan.ModelBinding()}})
	if err != nil {
		return localexecution.MusicResult{}, err
	}
	return localexecution.MusicResult{StagingWAVPath: plan.StagingWAVPath(), SizeBytes: outcome.sizeBytes, ComputeMS: outcome.computeMS}, nil
}

func audioCppCLIArgs(plan *capabilitydriver.MusicInvocationPlan) ([]string, error) {
	rel := func(path string) (string, error) {
		value, err := filepath.Rel(plan.ModelRoot(), path)
		if err != nil || value == "." || value == ".." || strings.HasPrefix(value, ".."+string(filepath.Separator)) {
			return "", fmt.Errorf("audio.cpp component path escapes captured model root")
		}
		return filepath.ToSlash(value), nil
	}
	language, err := rel(plan.LanguageModelPath())
	if err != nil {
		return nil, err
	}
	rvq, err := rel(plan.RVQDepthDecoderPath())
	if err != nil {
		return nil, err
	}
	transformer, err := rel(plan.FlowTransformerPath())
	if err != nil {
		return nil, err
	}
	return []string{"--task", "gen", "--family", "minimax_music3", "--model", plan.ModelRoot(), "--backend", "cuda", "--session-option", "minimax_music3.language_model_gguf=" + language, "--session-option", "minimax_music3.rvq_depth_decoder_gguf=" + rvq, "--session-option", "minimax_music3.flow_transformer_gguf=" + transformer, "--session-option", "minimax_music3.mem_saver=" + strconv.FormatBool(plan.MemorySaver()), "--text", plan.Prompt(), "--request-option", "lyrics=" + plan.Lyrics(), "--request-option", "duration_sec=" + strconv.Itoa(plan.DurationBudgetSeconds()), "--request-option", "num_inference_steps=" + strconv.Itoa(plan.NumInferenceSteps()), "--request-option", "guidance_scale=" + strconv.FormatFloat(plan.GuidanceScale(), 'g', -1, 64), "--request-option", "ar_guidance_scale=" + strconv.FormatFloat(plan.ARGuidanceScale(), 'g', -1, 64), "--request-option", "top_k=" + strconv.Itoa(plan.TopK()), "--request-option", "seed=" + strconv.FormatUint(plan.Seed(), 10), "--out", plan.StagingWAVPath(), "--metrics"}, nil
}

func validateAudioCppMusicPlan(plan *capabilitydriver.MusicInvocationPlan) error {
	if plan == nil || plan.ProcessKey() == "" || plan.AudioCppPackageID() != capabilitydriver.MiniMaxMusic3AudioCppPackageID || plan.CUDA13DependencyID() != capabilitydriver.MiniMaxMusic3CUDA13DependencyID || plan.AudioCppSelectedSourceRecordID() == "" || plan.CUDA13SelectedSourceRecordID() == "" || !filepath.IsAbs(plan.AudioCppExecutablePath()) || !filepath.IsAbs(plan.CUDA13Root()) || !filepath.IsAbs(plan.ModelRoot()) || !filepath.IsAbs(plan.StagingWAVPath()) {
		return fmt.Errorf("audio.cpp Music invocation plan is incomplete")
	}
	return nil
}

func musicContextFailure(err error) error { return audioCppContextFailure(err) }
