package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// SpeechExecutionHost is the private transport adapter for the supervised
// speech process. Selection and model identity are fixed in the Driver plan;
// this Host supplies only the configured loopback endpoint.
type SpeechExecutionHost struct {
	materializer SpeechExecutionHostMaterializer
	port         int
	timeout      time.Duration
	lease        speechExecutionLease
	poisoned     error
}

type speechExecutionLease struct {
	mu     sync.Mutex
	active bool
	queue  []*speechExecutionWaiter
}

type speechExecutionWaiter struct {
	ready   chan struct{}
	granted bool
}

const maxSpeechExecutionHostTimeout = 30 * time.Minute

// SpeechExecutionHostMaterializer lazily starts the private Host for exactly
// one already-selected speech capability and returns its loopback endpoint.
type SpeechExecutionHostMaterializer interface {
	MaterializeSpeechExecutionHost(context.Context, string, string, int) (string, error)
	StopSpeechExecutionHost() error
}

func NewSpeechExecutionHost(materializer SpeechExecutionHostMaterializer, port int, timeout time.Duration) *SpeechExecutionHost {
	if materializer == nil || port <= 0 {
		return nil
	}
	if timeout <= 0 || timeout > maxSpeechExecutionHostTimeout {
		timeout = maxSpeechExecutionHostTimeout
	}
	return &SpeechExecutionHost{materializer: materializer, port: port, timeout: timeout}
}

func (host *SpeechExecutionHost) ExecuteSpeechSynthesis(ctx context.Context, plan *capabilitydriver.SpeechSynthesizeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	if host == nil || host.materializer == nil || plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || len(plan.ModelFiles()) != 1 {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech synthesis host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	backend, err := host.materializeBackend(ctx, capabilitydriver.AudioSynthesizeContract, plan.DriverID())
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return localexecution.SpeechSynthesisResult{}, host.stopCanceledExecution(ctx.Err(), err)
		}
		return localexecution.SpeechSynthesisResult{}, err
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		cancelErr := err
		if ctx != nil && ctx.Err() != nil {
			cancelErr = ctx.Err()
		}
		return localexecution.SpeechSynthesisResult{}, host.stopCanceledExecution(cancelErr, err)
	}
	request := plan.Request()
	artifactBody, usage, err := backend.SynthesizeSpeechArtifactBody(ctx, plan.ModelAssetID(), request, nil)
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, host.speechHostBackendError(ctx, err)
	}
	if artifactBody == nil || artifactBody.Body == nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("local speech synthesis returned empty audio"))
	}
	return localexecution.SpeechSynthesisResult{
		AudioBody: artifactBody.Body,
		SizeBytes: artifactBody.SizeBytes,
		MIMEType:  artifactBody.MIMEType,
		Usage:     usage,
	}, nil
}

func (host *SpeechExecutionHost) ExecuteSpeechTranscription(ctx context.Context, plan *capabilitydriver.SpeechTranscribeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	if host == nil || host.materializer == nil || plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || len(plan.ModelFiles()) != 1 {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech transcription host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	backend, err := host.materializeBackend(ctx, capabilitydriver.AudioTranscribeContract, plan.DriverID())
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return localexecution.SpeechTranscriptionResult{}, host.stopCanceledExecution(ctx.Err(), err)
		}
		return localexecution.SpeechTranscriptionResult{}, err
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		cancelErr := err
		if ctx != nil && ctx.Err() != nil {
			cancelErr = ctx.Err()
		}
		return localexecution.SpeechTranscriptionResult{}, host.stopCanceledExecution(cancelErr, err)
	}
	text, usage, err := backend.Transcribe(ctx, plan.ModelAssetID(), plan.Request(), plan.AudioBytes(), plan.MIMEType(), nil)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, host.speechHostBackendError(ctx, err)
	}
	if strings.TrimSpace(text) == "" {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("local speech transcription returned empty text"))
	}
	return localexecution.SpeechTranscriptionResult{Text: text, Usage: usage}, nil
}

func (lease *speechExecutionLease) acquire(ctx context.Context) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	waiter := &speechExecutionWaiter{ready: make(chan struct{})}
	lease.mu.Lock()
	if !lease.active && len(lease.queue) == 0 {
		lease.active = true
		waiter.granted = true
		close(waiter.ready)
	} else {
		lease.queue = append(lease.queue, waiter)
	}
	lease.mu.Unlock()

	select {
	case <-waiter.ready:
		if err := ctx.Err(); err != nil {
			lease.releaseGranted()
			return nil, err
		}
	case <-ctx.Done():
		lease.mu.Lock()
		if waiter.granted {
			lease.mu.Unlock()
			lease.releaseGranted()
		} else {
			lease.removeWaiterLocked(waiter)
			lease.mu.Unlock()
		}
		return nil, ctx.Err()
	}

	var once sync.Once
	return func() {
		once.Do(lease.releaseGranted)
	}, nil
}

func (lease *speechExecutionLease) releaseGranted() {
	lease.mu.Lock()
	defer lease.mu.Unlock()
	lease.active = false
	if len(lease.queue) == 0 {
		return
	}
	next := lease.queue[0]
	copy(lease.queue, lease.queue[1:])
	lease.queue[len(lease.queue)-1] = nil
	lease.queue = lease.queue[:len(lease.queue)-1]
	lease.active = true
	next.granted = true
	close(next.ready)
}

func (lease *speechExecutionLease) removeWaiterLocked(wanted *speechExecutionWaiter) {
	for index, waiter := range lease.queue {
		if waiter != wanted {
			continue
		}
		copy(lease.queue[index:], lease.queue[index+1:])
		lease.queue[len(lease.queue)-1] = nil
		lease.queue = lease.queue[:len(lease.queue)-1]
		return
	}
}

func beginSpeechExecution(ctx context.Context, onStart localexecution.SpeechExecutionStartFunc) error {
	if ctx != nil && ctx.Err() != nil {
		return speechHostError(localexecution.FailureCanceled, ctx.Err())
	}
	if onStart == nil {
		return nil
	}
	if err := onStart(); err != nil {
		return speechHostError(localexecution.FailureCanceled, err)
	}
	return nil
}

func (host *SpeechExecutionHost) materializeBackend(ctx context.Context, capabilityContract string, driverID string) (*nimillm.Backend, error) {
	endpoint, err := host.materializer.MaterializeSpeechExecutionHost(ctx, capabilityContract, driverID, host.port)
	if err != nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("materialize local speech ExecutionHost for %s: %w", capabilityContract, err))
	}
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech ExecutionHost endpoint is unavailable"))
	}
	backend := nimillm.NewBackend("local-qwen3-speech", endpoint, "", host.timeout)
	if backend == nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech ExecutionHost endpoint is unavailable"))
	}
	return backend, nil
}

func (host *SpeechExecutionHost) speechHostBackendError(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return host.stopCanceledExecution(ctx.Err(), err)
	}
	return speechHostError(localexecution.FailureInference, err)
}

func (host *SpeechExecutionHost) stopCanceledExecution(cancelErr error, executionErr error) error {
	if err := host.stopInterruptedExecution(executionErr); err != nil {
		return err
	}
	return speechHostError(localexecution.FailureCanceled, cancelErr)
}

func (host *SpeechExecutionHost) stopInterruptedExecution(executionErr error) error {
	if stopErr := host.materializer.StopSpeechExecutionHost(); stopErr != nil {
		host.poisoned = fmt.Errorf("stop interrupted local speech ExecutionHost after execution error %v: %w", executionErr, stopErr)
		return speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	return nil
}

func speechHostError(kind localexecution.FailureKind, err error) error {
	return &localexecution.ExecutionError{Kind: kind, Err: err}
}
