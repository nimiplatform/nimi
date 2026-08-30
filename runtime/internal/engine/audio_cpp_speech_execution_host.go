// @nimi-authority: rule.nimi.runtime.local-compute.r074

package engine

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const audioCppMaxTranscriptBytes = 16 << 20

type audioCppSpeechProcessResult struct {
	synthesis     localexecution.SpeechSynthesisResult
	transcription localexecution.SpeechTranscriptionResult
	err           error
}

type audioCppSpeechRunner func(context.Context, *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (localexecution.SpeechSynthesisResult, error)
type audioCppSynthesisRunner func(context.Context, capabilitydriver.SpeechSynthesizePlan) (localexecution.SpeechSynthesisResult, error)
type audioCppTranscriptionRunner func(context.Context, capabilitydriver.SpeechTranscribePlan) (localexecution.SpeechTranscriptionResult, error)

type audioCppSpeechRequest struct {
	ctx            context.Context
	synthesisPlan  capabilitydriver.SpeechSynthesizePlan
	transcribePlan capabilitydriver.SpeechTranscribePlan
	onStart        localexecution.SpeechExecutionStartFunc
	done           chan audioCppSpeechProcessResult
}

// AudioCppSpeechExecutionHost serializes exact audio.cpp speech plans. Family,
// task, models, and options are already frozen by the resolved Driver; the Host
// owns only physical CLI execution and bounded staging.
type AudioCppSpeechExecutionHost struct {
	logger           *slog.Logger
	runSynthesis     audioCppSynthesisRunner
	runTranscription audioCppTranscriptionRunner

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
	return newAudioCppSpeechExecutionHostWithRunners(logger, runAudioCppSpeechSynthesisCLIProcess, runAudioCppSpeechTranscriptionCLIProcess)
}

// newAudioCppSpeechExecutionHostWithRunner preserves the focused Qwen runner
// seam used by existing tests while production uses both generic runners.
func newAudioCppSpeechExecutionHostWithRunner(logger *slog.Logger, runner audioCppSpeechRunner) *AudioCppSpeechExecutionHost {
	return newAudioCppSpeechExecutionHostWithRunners(logger, func(ctx context.Context, plan capabilitydriver.SpeechSynthesizePlan) (localexecution.SpeechSynthesisResult, error) {
		exact, ok := plan.(*capabilitydriver.Qwen3TTSAudioCppInvocationPlan)
		if !ok {
			return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("Qwen3-TTS audio.cpp execution plan is unavailable"))
		}
		return runner(ctx, exact)
	}, func(context.Context, capabilitydriver.SpeechTranscribePlan) (localexecution.SpeechTranscriptionResult, error) {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp transcription runner is unavailable"))
	})
}

func newAudioCppSpeechExecutionHostWithRunners(logger *slog.Logger, synthesis audioCppSynthesisRunner, transcription audioCppTranscriptionRunner) *AudioCppSpeechExecutionHost {
	if logger == nil {
		logger = slog.Default()
	}
	host := &AudioCppSpeechExecutionHost{logger: logger, runSynthesis: synthesis, runTranscription: transcription, wake: make(chan struct{}, 1), stop: make(chan struct{}), stopped: make(chan struct{})}
	go host.run()
	return host
}

func (host *AudioCppSpeechExecutionHost) ExecuteSpeechSynthesis(ctx context.Context, plan capabilitydriver.SpeechSynthesizePlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if host == nil || host.runSynthesis == nil {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech synthesis host is unavailable"))
	}
	switch exact := plan.(type) {
	case *capabilitydriver.Qwen3TTSAudioCppInvocationPlan:
		if err := validateQwen3TTSAudioCppPlan(exact); err != nil {
			return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
		}
	case *capabilitydriver.AudioCppTTSSynthesizePlan:
		if err := validateAudioCppTTSSynthesizePlan(exact); err != nil {
			return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
		}
	default:
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech synthesis plan is unavailable"))
	}
	request := &audioCppSpeechRequest{ctx: ctx, synthesisPlan: plan, onStart: onStart, done: make(chan audioCppSpeechProcessResult, 1)}
	if !host.enqueue(request) {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("audio.cpp speech execution host is stopping"))
	}
	outcome := host.await(ctx, request)
	return outcome.synthesis, outcome.err
}

func (host *AudioCppSpeechExecutionHost) ExecuteSpeechTranscription(ctx context.Context, plan capabilitydriver.SpeechTranscribePlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	exact, ok := plan.(*capabilitydriver.AudioCppASRTranscribePlan)
	if host == nil || host.runTranscription == nil || !ok {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech transcription plan is unavailable"))
	}
	if err := validateAudioCppASRTranscribePlan(exact); err != nil {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	request := &audioCppSpeechRequest{ctx: ctx, transcribePlan: exact, onStart: onStart, done: make(chan audioCppSpeechProcessResult, 1)}
	if !host.enqueue(request) {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureCanceled, fmt.Errorf("audio.cpp speech execution host is stopping"))
	}
	outcome := host.await(ctx, request)
	return outcome.transcription, outcome.err
}

func (*AudioCppSpeechExecutionHost) ExecuteVoiceCreate(context.Context, *capabilitydriver.VoiceCreateInvocationPlan, localexecution.SpeechExecutionStartFunc) (localexecution.VoiceCreateResult, error) {
	return localexecution.VoiceCreateResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech host does not admit voice.create through this plan type"))
}

func (host *AudioCppSpeechExecutionHost) await(ctx context.Context, request *audioCppSpeechRequest) audioCppSpeechProcessResult {
	select {
	case outcome := <-request.done:
		return outcome
	case <-ctx.Done():
		if host.removeQueued(request) {
			return audioCppSpeechProcessResult{err: audioCppContextFailure(ctx.Err())}
		}
		return <-request.done
	case <-host.stop:
		return <-request.done
	}
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
			host.deliver(request, audioCppSpeechProcessResult{err: executionFailure(localexecution.FailureCanceled, fmt.Errorf("audio.cpp speech execution host stopped"))})
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
		outcome := audioCppSpeechProcessResult{}
		if request.synthesisPlan != nil {
			outcome.synthesis, outcome.err = host.runSynthesis(executionCtx, request.synthesisPlan)
		} else {
			outcome.transcription, outcome.err = host.runTranscription(executionCtx, request.transcribePlan)
		}
		cancelExecution()
		host.clearActive(request)
		host.deliver(request, outcome)
	}
}

func runAudioCppSpeechSynthesisCLIProcess(ctx context.Context, plan capabilitydriver.SpeechSynthesizePlan) (localexecution.SpeechSynthesisResult, error) {
	switch exact := plan.(type) {
	case *capabilitydriver.Qwen3TTSAudioCppInvocationPlan:
		return runQwen3TTSAudioCppCLIProcess(ctx, exact)
	case *capabilitydriver.AudioCppTTSSynthesizePlan:
		if err := validateAudioCppTTSSynthesizePlan(exact); err != nil {
			return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
		}
		if referencePath := exact.ReferenceWAVPath(); referencePath != "" {
			file, err := os.OpenFile(referencePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("create audio.cpp TTS reference staging: %w", err))
			}
			written, writeErr := exact.WriteReferenceWAVTo(file)
			closeErr := file.Close()
			if writeErr != nil || written != exact.ReferenceWAVSizeBytes() || closeErr != nil {
				cleanupAudioCppStaging(referencePath, referencePath+".tmp")
				return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("write audio.cpp TTS reference staging"))
			}
			defer cleanupAudioCppStaging(referencePath, referencePath+".tmp")
		}
		outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: exact.AudioCppExecutablePath(), workingDir: exact.AudioCppRoot(), cuda13Root: exact.CUDA13Root(), args: exact.CLIArgs(), stagingOutputPath: exact.StagingWAVPath(), modelBindings: exact.ModelFiles()})
		if err != nil {
			return localexecution.SpeechSynthesisResult{}, err
		}
		return localexecution.SpeechSynthesisResult{StagingWAVPath: exact.StagingWAVPath(), SizeBytes: outcome.sizeBytes, MIMEType: "audio/wav", ComputeMS: outcome.computeMS}, nil
	default:
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech synthesis plan is unavailable"))
	}
}

func runAudioCppSpeechTranscriptionCLIProcess(ctx context.Context, plan capabilitydriver.SpeechTranscribePlan) (localexecution.SpeechTranscriptionResult, error) {
	exact, ok := plan.(*capabilitydriver.AudioCppASRTranscribePlan)
	if !ok {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp speech transcription plan is unavailable"))
	}
	if err := validateAudioCppASRTranscribePlan(exact); err != nil {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	audioPath, textPath := exact.StagingAudioPath(), exact.StagingTextOutPath()
	file, err := os.OpenFile(audioPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("create audio.cpp ASR staging input: %w", err))
	}
	written, writeErr := exact.WriteAudioTo(file)
	closeErr := file.Close()
	if writeErr != nil || written != exact.AudioSizeBytes() || closeErr != nil {
		cleanupAudioCppStaging(audioPath, audioPath+".tmp")
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("write audio.cpp ASR staging input"))
	}
	defer cleanupAudioCppStaging(audioPath, audioPath+".tmp")
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: exact.AudioCppExecutablePath(), workingDir: exact.AudioCppRoot(), cuda13Root: exact.CUDA13Root(), args: exact.CLIArgs(), stagingOutputPath: textPath, modelBindings: exact.ModelFiles()})
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, err
	}
	defer cleanupAudioCppStaging(textPath, textPath+".tmp")
	if outcome.sizeBytes <= 0 || outcome.sizeBytes > audioCppMaxTranscriptBytes {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("audio.cpp ASR transcript size is invalid"))
	}
	content, err := os.ReadFile(textPath)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("read audio.cpp ASR transcript: %w", err))
	}
	text := strings.TrimSpace(string(content))
	if text == "" || !utf8.Valid(content) {
		return localexecution.SpeechTranscriptionResult{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("audio.cpp ASR transcript is empty or invalid UTF-8"))
	}
	return localexecution.SpeechTranscriptionResult{Text: text, Usage: &runtimev1.UsageStats{ComputeMs: outcome.computeMS}}, nil
}

func runQwen3TTSAudioCppCLIProcess(ctx context.Context, plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (localexecution.SpeechSynthesisResult, error) {
	if err := validateQwen3TTSAudioCppPlan(plan); err != nil {
		return localexecution.SpeechSynthesisResult{}, executionFailure(localexecution.FailureContentMismatch, err)
	}
	args := qwen3TTSAudioCppCLIArgs(plan)
	outcome, err := runAudioCppProcess(ctx, audioCppProcessSpec{executablePath: plan.AudioCppExecutablePath(), workingDir: plan.AudioCppRoot(), cuda13Root: plan.CUDA13Root(), args: args, stagingOutputPath: plan.StagingWAVPath(), modelBindings: plan.ModelFiles()})
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, err
	}
	return localexecution.SpeechSynthesisResult{StagingWAVPath: plan.StagingWAVPath(), SizeBytes: outcome.sizeBytes, MIMEType: "audio/wav", ComputeMS: outcome.computeMS}, nil
}

func qwen3TTSAudioCppCLIArgs(plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) []string {
	doSample, temperature, topK, topP, repetition := plan.Sampling()
	args := []string{"--task", "tts", "--family", "qwen3_tts", "--model", plan.ModelPath(), "--backend", "cuda", "--session-option", "qwen3_tts.mem_saver=" + strconv.FormatBool(plan.MemorySaver()), "--text", plan.Text(), "--speaker", plan.Speaker()}
	if plan.CLILanguage() != "" {
		args = append(args, "--language", plan.CLILanguage())
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

func validateAudioCppTTSSynthesizePlan(plan *capabilitydriver.AudioCppTTSSynthesizePlan) error {
	if plan == nil || plan.ProcessKey() == "" || plan.DriverID() == "" || plan.Family() == "" || plan.ModelAssetID() == "" || len(plan.ModelFiles()) == 0 || plan.AudioCppPackageID() != capabilitydriver.AudioCppWindowsCUDA13PackageID || plan.CUDA13DependencyID() != capabilitydriver.AudioCppCUDA13RuntimeDependencyID || plan.AudioCppSelectedSourceRecordID() == "" || plan.CUDA13SelectedSourceRecordID() == "" || !filepath.IsAbs(plan.AudioCppExecutablePath()) || !filepath.IsAbs(plan.CUDA13Root()) || !filepath.IsAbs(plan.StagingWAVPath()) || len(plan.CLIArgs()) == 0 || !audioCppArgsContainPair(plan.CLIArgs(), "--out", plan.StagingWAVPath()) {
		return fmt.Errorf("audio.cpp TTS invocation plan is incomplete")
	}
	if (plan.ReferenceWAVPath() == "") != (plan.ReferenceWAVSizeBytes() == 0) || plan.ReferenceWAVPath() != "" && (!filepath.IsAbs(plan.ReferenceWAVPath()) || !strings.EqualFold(filepath.Ext(plan.ReferenceWAVPath()), ".wav")) {
		return fmt.Errorf("audio.cpp TTS reference plan is incomplete")
	}
	return nil
}

func validateAudioCppASRTranscribePlan(plan *capabilitydriver.AudioCppASRTranscribePlan) error {
	if plan == nil || plan.ProcessKey() == "" || plan.DriverID() == "" || plan.Family() == "" || plan.ModelAssetID() == "" || len(plan.ModelFiles()) == 0 || plan.AudioSizeBytes() == 0 || plan.AudioCppPackageID() != capabilitydriver.AudioCppWindowsCUDA13PackageID || plan.CUDA13DependencyID() != capabilitydriver.AudioCppCUDA13RuntimeDependencyID || plan.AudioCppSelectedSourceRecordID() == "" || plan.CUDA13SelectedSourceRecordID() == "" || !filepath.IsAbs(plan.AudioCppExecutablePath()) || !filepath.IsAbs(plan.CUDA13Root()) || !filepath.IsAbs(plan.StagingAudioPath()) || !filepath.IsAbs(plan.StagingTextOutPath()) || len(plan.CLIArgs()) == 0 || !audioCppArgsContainPair(plan.CLIArgs(), "--audio", plan.StagingAudioPath()) || !audioCppArgsContainPair(plan.CLIArgs(), "--text-out", plan.StagingTextOutPath()) {
		return fmt.Errorf("audio.cpp ASR invocation plan is incomplete")
	}
	return nil
}

func audioCppArgsContainPair(args []string, key, value string) bool {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == key && args[index+1] == value {
			return true
		}
	}
	return false
}
