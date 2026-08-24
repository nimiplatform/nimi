package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const (
	audioCppMaxDiagnosticBytes     = 32 << 10
	audioCppProcessTerminationWait = 15 * time.Second
	audioCppProcessForceWait       = 3 * time.Second
)

type audioCppProcessSpec struct {
	executablePath    string
	workingDir        string
	cuda13Root        string
	args              []string
	stagingOutputPath string
}

type audioCppProcessOutcome struct {
	sizeBytes int64
	computeMS int64
}

func runAudioCppProcess(ctx context.Context, spec audioCppProcessSpec) (audioCppProcessOutcome, error) {
	if !filepath.IsAbs(spec.executablePath) || !filepath.IsAbs(spec.workingDir) || !filepath.IsAbs(spec.cuda13Root) || !filepath.IsAbs(spec.stagingOutputPath) || len(spec.args) == 0 {
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("audio.cpp process specification is incomplete"))
	}
	output := spec.stagingOutputPath
	tempOutput := output + ".tmp"
	if _, err := os.Stat(output); err == nil {
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("audio.cpp staging output already exists"))
	} else if !os.IsNotExist(err) {
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("stat audio.cpp staging output: %w", err))
	}
	if info, err := os.Stat(filepath.Dir(output)); err != nil || !info.IsDir() {
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("audio.cpp staging directory is unavailable"))
	}

	command := exec.Command(spec.executablePath, append([]string(nil), spec.args...)...)
	command.Dir = spec.workingDir
	configureManagedCommand(command)
	command.Env = append(os.Environ(), "PATH="+spec.cuda13Root+string(os.PathListSeparator)+spec.workingDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	stdout := &boundedAudioCppOutput{limit: audioCppMaxDiagnosticBytes}
	stderr := &boundedAudioCppOutput{limit: audioCppMaxDiagnosticBytes}
	command.Stdout = stdout
	command.Stderr = stderr
	started := time.Now()
	if err := command.Start(); err != nil {
		cleanupAudioCppStaging(output, tempOutput)
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("start audio.cpp CLI"))
	}
	lifecycle, err := bindSupervisorProcessLifecycle(command)
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		cleanupAudioCppStaging(output, tempOutput)
		return audioCppProcessOutcome{}, executionFailure(localexecution.FailureLoad, fmt.Errorf("bind audio.cpp process tree"))
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	var waitErr error
	select {
	case waitErr = <-done:
	case <-ctx.Done():
		if err := signalSupervisorProcessLifecycle(lifecycle, syscall.SIGKILL); err != nil {
			_ = releaseSupervisorProcessLifecycle(lifecycle)
			_ = signalSupervisorProcessDirect(command.Process.Pid, syscall.SIGKILL)
		}
		if _, err := waitAudioCppProcessExit(done, audioCppProcessTerminationWait); err != nil {
			_ = signalSupervisorProcessDirect(command.Process.Pid, syscall.SIGKILL)
			_ = releaseSupervisorProcessLifecycle(lifecycle)
			if _, forceErr := waitAudioCppProcessExit(done, audioCppProcessForceWait); forceErr != nil {
				cleanupAudioCppStaging(output, tempOutput)
				return audioCppProcessOutcome{}, executionFailure(localexecution.FailureProcessCrash, fmt.Errorf("audio.cpp CLI process tree did not exit"))
			}
		}
		_ = releaseSupervisorProcessLifecycle(lifecycle)
		cleanupAudioCppStaging(output, tempOutput)
		return audioCppProcessOutcome{}, audioCppContextFailure(ctx.Err())
	}
	_ = releaseSupervisorProcessLifecycle(lifecycle)
	if waitErr != nil {
		cleanupAudioCppStaging(output, tempOutput)
		kind := localexecution.FailureProcessCrash
		if stderr.OutOfMemory() {
			kind = localexecution.FailureOutOfMemory
		}
		return audioCppProcessOutcome{}, executionFailure(kind, fmt.Errorf("audio.cpp CLI failed"))
	}
	outcome := audioCppProcessOutcome{computeMS: time.Since(started).Milliseconds()}
	if info, statErr := os.Stat(output); statErr == nil && info.Mode().IsRegular() {
		outcome.sizeBytes = info.Size()
	}
	return outcome, nil
}

func waitAudioCppProcessExit(done <-chan error, timeout time.Duration) (error, error) {
	if timeout <= 0 {
		return nil, fmt.Errorf("audio.cpp process exit wait is not bounded")
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case waitErr := <-done:
		return waitErr, nil
	case <-timer.C:
		return nil, fmt.Errorf("timed out waiting for audio.cpp CLI process exit")
	}
}

func cleanupAudioCppStaging(paths ...string) {
	for _, path := range paths {
		if strings.TrimSpace(path) != "" {
			_ = os.Remove(path)
		}
	}
}

func audioCppContextFailure(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return executionFailure(localexecution.FailureTimeout, context.DeadlineExceeded)
	}
	return executionFailure(localexecution.FailureCanceled, context.Canceled)
}

func audioCppOutOfMemory(stderr string) bool {
	normalized := strings.ToLower(stderr)
	return strings.Contains(normalized, "out of memory") || strings.Contains(normalized, "cuda_error_out_of_memory")
}

type boundedAudioCppOutput struct {
	mu      sync.Mutex
	limit   int
	data    []byte
	oom     bool
	oomTail []byte
}

func (b *boundedAudioCppOutput) Write(value []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.oom {
		probe := make([]byte, 0, len(b.oomTail)+len(value))
		probe = append(probe, b.oomTail...)
		probe = append(probe, value...)
		b.oom = audioCppOutOfMemory(string(probe))
		const markerOverlap = len("cuda_error_out_of_memory") - 1
		if !b.oom {
			if len(probe) > markerOverlap {
				probe = probe[len(probe)-markerOverlap:]
			}
			b.oomTail = append(b.oomTail[:0], probe...)
		}
	}
	remaining := b.limit - len(b.data)
	if remaining > 0 {
		if len(value) < remaining {
			remaining = len(value)
		}
		b.data = append(b.data, value[:remaining]...)
	}
	return len(value), nil
}

func (b *boundedAudioCppOutput) OutOfMemory() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.oom
}

func (b *boundedAudioCppOutput) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(append([]byte(nil), b.data...))
}
