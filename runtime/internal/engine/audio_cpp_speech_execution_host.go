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

type audioCppSpeechProcessResult struct {
	result localexecution.SpeechSynthesisResult
	err    error
}

type audioCppSpeechRunner func(context.Context, *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (localexecution.SpeechSynthesisResult, error)

type audioCppSpeechRequest struct {
	ctx     context.Context
	plan    *capabilitydriver.Qwen3TTSAudioCppInvocationPlan
	onStart localexecution.SpeechExecutionStartFunc
	done    chan audioCppSpeechProcessResult
}

// AudioCppSpeechExecutionHost is the concrete per-Job CLI implementation of
// the capability-shaped SpeechExecutionHost waist for the exact Qwen3-TTS
// audio.cpp Driver. It is not a generic audio Host and has no fallback.
type AudioCppSpeechExecutionHost struct {
	logger *slog.Logger
	runCLI audioCppSpeechRunner

	mu           sync.Mutex
	queue        []*audioCppSpeechRequest
	active       *audioCppSpeechRequest
	cancelActive context.CancelFunc
	stopping     bool
	wake         chan struct{}
	stop         chan struct{}
	stopped      chan struct{}
	stopOnce     sync.Once
}

var _ localexecution.SpeechExecutionHost = (*AudioCppSpeechExecutionHost)(nil)

func NewAudioCppSpeechExecutionHost(logger *slog.Logger) *AudioCppSpeechExecutionHost {
	return newAudioCppSpeechExecutionHostWithRunner(logger, runQwen3TTSAudioCppCLIProcess)
}

func newAudioCppSpeechExecutionHostWithRunner(logger *slog.Logger, runner audioCppSpeechRunner) *AudioCppSpeechExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	host := &AudioCppSpeechExecutionHost{logger: logger, runCLI: runner, wake: make(chan struct{}, 1), stop: make(chan struct{}), stopped: make(chan struct{})}
	go host.run()
	return host
}

func (host *AudioCppSpeechExecutionHost) ExecuteSpeechSynthesis(ctx context.Context, plan capabilitydriver.SpeechSynthesizePlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	exact, ok := plan.(*capabilitydriver.Qwen3TTSAudioCppInvocationPlan)
	if host == nil || host.runCLI == nil || !ok {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("Qwen3-TTS audio.cpp execution plan is unavailable"))
	}
	if err := validateQwen3TTSAudioCppPlan(exact); err != nil {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	request := &audioCppSpeechRequest{ctx: ctx, plan: exact, onStart: onStart, done: make(chan audioCppSpeechProcessResult, 1)}
	if !host.enqueue(request) {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("Qwen3-TTS audio.cpp execution host is stopping"))
	}
	select {
	case outcome := <-request.done:
		return outcome.result, outcome.err
	case <-ctx.Done():
		if host.removeQueued(request) {
			return localexecution.SpeechSynthesisResult{}, audioCppContextFailure(ctx.Err())
		}
		outcome := <-request.done
		return outcome.result, outcome.err
	case <-host.stop:
		outcome := <-request.done
		return outcome.result, outcome.err
	}
}

func (*AudioCppSpeechExecutionHost) ExecuteSpeechTranscription(context.Context, *capabilitydriver.SpeechTranscribeInvocationPlan, localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp Qwen3-TTS host does not admit transcription"))
}

func (*AudioCppSpeechExecutionHost) ExecuteVoiceCreate(context.Context, *capabilitydriver.VoiceCreateInvocationPlan, localexecution.SpeechExecutionStartFunc) (localexecution.VoiceCreateResult, error) {
	return localexecution.VoiceCreateResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp Qwen3-TTS host does not admit voice.create"))
}

func (host *AudioCppSpeechExecutionHost) Stop() error {
	if host == nil {
		return nil
	}
	host.stopOnce.Do(func() {
		host.mu.Lock()
		host.stopping = true
		queued := append([]*audioCppSpeechRequest(nil), host.queue...)
		host.queue = nil
		close(host.stop)
		cancelActive := host.cancelActive
		host.mu.Unlock()
		for _, request := range queued {
			host.deliver(request, audioCppSpeechProcessResult{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("Qwen3-TTS audio.cpp execution host stopped"))})
		}
		if cancelActive != nil {
			cancelActive()
		}
		select {
		case host.wake <- struct{}{}:
		default:
		}
	})
	<-host.stopped
	return nil
}

func (host *AudioCppSpeechExecutionHost) enqueue(request *audioCppSpeechRequest) bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	if host.stopping {
		return false
	}
	host.queue = append(host.queue, request)
	select {
	case host.wake <- struct{}{}:
	default:
	}
	return true
}

func (host *AudioCppSpeechExecutionHost) removeQueued(request *audioCppSpeechRequest) bool {
	host.mu.Lock()
	defer host.mu.Unlock()
	for index, queued := range host.queue {
		if queued == request {
			copy(host.queue[index:], host.queue[index+1:])
			host.queue[len(host.queue)-1] = nil
			host.queue = host.queue[:len(host.queue)-1]
			return true
		}
	}
	return false
}

func (host *AudioCppSpeechExecutionHost) dequeue() *audioCppSpeechRequest {
	host.mu.Lock()
	defer host.mu.Unlock()
	if len(host.queue) == 0 {
		return nil
	}
	request := host.queue[0]
	copy(host.queue, host.queue[1:])
	host.queue[len(host.queue)-1] = nil
	host.queue = host.queue[:len(host.queue)-1]
	host.active = request
	return request
}

func (host *AudioCppSpeechExecutionHost) clearActive(request *audioCppSpeechRequest) {
	host.mu.Lock()
	if host.active == request {
		host.active = nil
		host.cancelActive = nil
	}
	host.mu.Unlock()
}

func (host *AudioCppSpeechExecutionHost) deliver(request *audioCppSpeechRequest, outcome audioCppSpeechProcessResult) {
	select {
	case request.done <- outcome:
	default:
	}
}

func (host *AudioCppSpeechExecutionHost) run() {
	defer close(host.stopped)
	for {
		request := host.dequeue()
		if request == nil {
			select {
			case <-host.stop:
				return
			case <-host.wake:
				continue
			}
		}
		if request.ctx.Err() != nil {
			host.clearActive(request)
			host.deliver(request, audioCppSpeechProcessResult{err: audioCppContextFailure(request.ctx.Err())})
			continue
		}
		executionCtx, cancelExecution := context.WithCancel(request.ctx)
		host.mu.Lock()
		host.cancelActive = cancelExecution
		host.mu.Unlock()
		if request.onStart != nil {
			if err := request.onStart(); err != nil {
				cancelExecution()
				host.clearActive(request)
				host.deliver(request, audioCppSpeechProcessResult{err: err})
				continue
			}
		}
		result, err := host.runCLI(executionCtx, request.plan)
		cancelExecution()
		host.clearActive(request)
		host.deliver(request, audioCppSpeechProcessResult{result: result, err: err})
	}
}

func runQwen3TTSAudioCppCLIProcess(ctx context.Context, plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (localexecution.SpeechSynthesisResult, error) {
	if err := validateQwen3TTSAudioCppPlan(plan); err != nil {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	args := qwen3TTSAudioCppCLIArgs(plan)
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: plan.AudioCppExecutablePath(), workingDir: plan.AudioCppRoot(), cuda13Root: plan.CUDA13Root(), args: args, stagingWAVPath: plan.StagingWAVPath()})
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, err
	}
	return localexecution.SpeechSynthesisResult{StagingWAVPath: plan.StagingWAVPath(), SizeBytes: outcome.sizeBytes, MIMEType: "audio/wav", ComputeMS: outcome.computeMS}, nil
}

func qwen3TTSAudioCppCLIArgs(plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) []string {
	doSample, temperature, topK, topP, repetition := plan.Sampling()
	args := []string{"--task", "tts", "--family", "qwen3_tts", "--model", plan.ModelPath(), "--backend", "cuda", "--session-option", "qwen3_tts.mem_saver=" + strconv.FormatBool(plan.MemorySaver()), "--text", plan.Text(), "--speaker", plan.Speaker()}
	if plan.Language() != "" {
		args = append(args, "--language", plan.Language())
	}
	args = append(args, "--do-sample", strconv.FormatBool(doSample), "--temperature", strconv.FormatFloat(temperature, 'g', -1, 64), "--top-k", strconv.Itoa(topK), "--top-p", strconv.FormatFloat(topP, 'g', -1, 64), "--repetition-penalty", strconv.FormatFloat(repetition, 'g', -1, 64), "--max-tokens", strconv.Itoa(plan.MaxTokens()), "--text-chunk-size", strconv.Itoa(plan.TextChunkSize()), "--seed", strconv.FormatUint(plan.Seed(), 10), "--out", plan.StagingWAVPath(), "--metrics")
	return args
}

func validateQwen3TTSAudioCppPlan(plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) error {
	if plan == nil || plan.ProcessKey() == "" || plan.DriverID() != capabilitydriver.Qwen3TTSAudioCppDriverID || plan.AudioCppPackageID() != capabilitydriver.AudioCppWindowsCUDA13PackageID || plan.CUDA13DependencyID() != capabilitydriver.AudioCppCUDA13RuntimeDependencyID || plan.AudioCppSelectedSourceRecordID() == "" || plan.CUDA13SelectedSourceRecordID() == "" || !filepath.IsAbs(plan.AudioCppExecutablePath()) || !filepath.IsAbs(plan.CUDA13Root()) || !filepath.IsAbs(plan.ModelPath()) || !filepath.IsAbs(plan.StagingWAVPath()) || strings.TrimSpace(plan.Text()) == "" || plan.Speaker() != capabilitydriver.Qwen3TTSAudioCppPresetVoiceVivian {
		return fmt.Errorf("Qwen3-TTS audio.cpp invocation plan is incomplete")
	}
	return nil
}
