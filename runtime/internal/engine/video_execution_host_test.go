package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestVideoExecutionEngineConfigFromDirectoryUsesExplicitWrapperSeam(t *testing.T) {
	root := t.TempDir()
	backend := filepath.Join(root, "sd.exe")
	wrapper := filepath.Join(t.TempDir(), "nimi-wrapper.exe")
	for _, path := range []string{backend, wrapper} {
		if err := os.WriteFile(path, []byte("test executable"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	config, err := videoExecutionEngineConfigFromDirectory(root, "127.0.0.1:54321", VideoExecutionHostConfig{
		ExecutablePath: wrapper,
	})
	if err != nil {
		t.Fatalf("videoExecutionEngineConfigFromDirectory: %v", err)
	}
	if config.BinaryPath != wrapper {
		t.Fatalf("wrapper binary = %q, want %q", config.BinaryPath, wrapper)
	}
	if got := managedImageBackendLaunchArgValue(config.CommandArgs, "--backend-executable"); got != backend {
		t.Fatalf("backend executable = %q, want %q", got, backend)
	}
	if len(config.CommandArgs) < 2 || config.CommandArgs[0] != "managed-image-backend" || config.CommandArgs[1] != "serve" {
		t.Fatalf("wrapper args = %#v", config.CommandArgs)
	}
}

type fakeVideoInvocationSubstrate struct {
	mu            sync.Mutex
	healthy       bool
	ensureCalls   int
	generateOrder []string
	active        int
	maxActive     int
	stopCalls     int
	cancelCalls   int
	ensureFn      func(context.Context, *capabilitydriver.VideoInvocationPlan, func() error, localexecution.VideoProgressFunc) (bool, error)
	generateFn    func(context.Context, *capabilitydriver.VideoInvocationPlan) (localexecution.RawAVCandidate, error)
	cancelFn      func(context.Context) error
	stopFn        func() error
}

func (f *fakeVideoInvocationSubstrate) Ensure(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, validate func() error, progress localexecution.VideoProgressFunc) (bool, error) {
	f.mu.Lock()
	f.ensureCalls++
	f.mu.Unlock()
	if f.ensureFn != nil {
		return f.ensureFn(ctx, plan, validate, progress)
	}
	if err := validate(); err != nil {
		return false, err
	}
	f.mu.Lock()
	f.healthy = true
	f.mu.Unlock()
	return false, nil
}

func (f *fakeVideoInvocationSubstrate) GenerateVideo(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, _ localexecution.VideoProgressFunc) (localexecution.RawAVCandidate, error) {
	f.mu.Lock()
	f.generateOrder = append(f.generateOrder, plan.Prompt())
	f.active++
	if f.active > f.maxActive {
		f.maxActive = f.active
	}
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		f.active--
		f.mu.Unlock()
	}()
	if f.generateFn != nil {
		return f.generateFn(ctx, plan)
	}
	return rawCandidateForHostTest(plan), nil
}

func (f *fakeVideoInvocationSubstrate) Cancel(ctx context.Context) error {
	f.mu.Lock()
	f.cancelCalls++
	f.mu.Unlock()
	if f.cancelFn != nil {
		return f.cancelFn(ctx)
	}
	return nil
}

func (f *fakeVideoInvocationSubstrate) Healthy() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.healthy
}

func (f *fakeVideoInvocationSubstrate) Stop() error {
	f.mu.Lock()
	f.stopCalls++
	f.healthy = false
	f.mu.Unlock()
	if f.stopFn != nil {
		return f.stopFn()
	}
	return nil
}

func TestVideoExecutionHostFIFOAndQueuedCancellation(t *testing.T) {
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var once sync.Once
	substrate := &fakeVideoInvocationSubstrate{healthy: true}
	substrate.generateFn = func(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan) (localexecution.RawAVCandidate, error) {
		if plan.Prompt() == "first" {
			once.Do(func() { close(firstStarted) })
			select {
			case <-releaseFirst:
			case <-ctx.Done():
				return localexecution.RawAVCandidate{}, ctx.Err()
			}
		}
		return rawCandidateForHostTest(plan), nil
	}
	host := newVideoExecutionHostWithSubstrate(substrate, nil, 20*time.Millisecond)
	defer func() { _ = host.Stop() }()
	firstDone := executeVideoForTest(host, context.Background(), videoPlanForHostTest(t, "first"))
	select {
	case <-firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not acquire video lease")
	}
	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondDone := executeVideoForTest(host, secondCtx, videoPlanForHostTest(t, "second"))
	waitForVideoHostQueueLength(t, host, 1)
	thirdDone := executeVideoForTest(host, context.Background(), videoPlanForHostTest(t, "third"))
	waitForVideoHostQueueLength(t, host, 2)
	cancelSecond()
	if err := <-secondDone; localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("queued cancellation error = %v", err)
	}
	close(releaseFirst)
	if err := <-firstDone; err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := <-thirdDone; err != nil {
		t.Fatalf("third: %v", err)
	}
	substrate.mu.Lock()
	order := append([]string(nil), substrate.generateOrder...)
	maxActive := substrate.maxActive
	substrate.mu.Unlock()
	if !reflect.DeepEqual(order, []string{"first", "third"}) || maxActive != 1 {
		t.Fatalf("order=%v maxActive=%d", order, maxActive)
	}
}

func TestVideoExecutionHostRunningCancelStopsOwnedWorkerBeforeReturn(t *testing.T) {
	started := make(chan struct{})
	stopped := make(chan struct{})
	release := make(chan struct{})
	var startOnce, stopOnce sync.Once
	substrate := &fakeVideoInvocationSubstrate{healthy: true}
	substrate.generateFn = func(context.Context, *capabilitydriver.VideoInvocationPlan) (localexecution.RawAVCandidate, error) {
		startOnce.Do(func() { close(started) })
		<-release
		return localexecution.RawAVCandidate{}, errors.New("worker stopped")
	}
	substrate.cancelFn = func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}
	substrate.stopFn = func() error {
		stopOnce.Do(func() {
			close(release)
			close(stopped)
		})
		return nil
	}
	host := newVideoExecutionHostWithSubstrate(substrate, nil, 20*time.Millisecond)
	defer func() { _ = host.Stop() }()
	ctx, cancel := context.WithCancel(context.Background())
	done := executeVideoForTest(host, ctx, videoPlanForHostTest(t, "cancel"))
	<-started
	cancel()
	if err := <-done; localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("running cancellation error = %v", err)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("ExecuteVideo returned before the owned worker stop was observed")
	}
	substrate.mu.Lock()
	cancels, stops := substrate.cancelCalls, substrate.stopCalls
	substrate.mu.Unlock()
	if cancels == 0 || stops == 0 {
		t.Fatalf("cancel calls=%d stop calls=%d", cancels, stops)
	}
}

func TestVideoExecutionHostPropagatesSubstrateFailure(t *testing.T) {
	substrate := &fakeVideoInvocationSubstrate{healthy: true, ensureFn: func(context.Context, *capabilitydriver.VideoInvocationPlan, func() error, localexecution.VideoProgressFunc) (bool, error) {
		return false, errors.New("load failed")
	}}
	host := newVideoExecutionHostWithSubstrate(substrate, nil, time.Second)
	defer func() { _ = host.Stop() }()
	_, err := host.ExecuteVideo(context.Background(), videoPlanForHostTest(t, "failure"), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureLoad {
		t.Fatalf("substrate failure = %v", err)
	}
}

func TestVideoExecutionHostCrashRecoversOnNextJob(t *testing.T) {
	crashed := false
	substrate := &fakeVideoInvocationSubstrate{healthy: true}
	substrate.generateFn = func(_ context.Context, plan *capabilitydriver.VideoInvocationPlan) (localexecution.RawAVCandidate, error) {
		if !crashed {
			crashed = true
			substrate.mu.Lock()
			substrate.healthy = false
			substrate.mu.Unlock()
			return localexecution.RawAVCandidate{}, errors.New("process exited")
		}
		return rawCandidateForHostTest(plan), nil
	}
	host := newVideoExecutionHostWithSubstrate(substrate, nil, time.Second)
	defer func() { _ = host.Stop() }()
	if _, err := host.ExecuteVideo(context.Background(), videoPlanForHostTest(t, "crash"), nil); localexecution.FailureKindOf(err) != localexecution.FailureProcessCrash {
		t.Fatalf("crash error = %v", err)
	}
	candidate, err := host.ExecuteVideo(context.Background(), videoPlanForHostTest(t, "recover"), nil)
	if err != nil || len(candidate.Frames) != 5 {
		t.Fatalf("next-job recovery candidate=%+v err=%v", candidate, err)
	}
	substrate.mu.Lock()
	ensureCalls := substrate.ensureCalls
	substrate.mu.Unlock()
	if ensureCalls != 2 {
		t.Fatalf("ensure calls after recovery = %d", ensureCalls)
	}
}

func executeVideoForTest(host *VideoExecutionHost, ctx context.Context, plan *capabilitydriver.VideoInvocationPlan) <-chan error {
	done := make(chan error, 1)
	go func() {
		_, err := host.ExecuteVideo(ctx, plan, nil)
		done <- err
	}()
	return done
}

func videoPlanForHostTest(t *testing.T, prompt string) *capabilitydriver.VideoInvocationPlan {
	t.Helper()
	root := t.TempDir()
	requirements := []string{
		capabilitydriver.StableDiffusionVideoFL2VARequirementID,
		capabilitydriver.StableDiffusionVideoRef2VARequirementID,
		capabilitydriver.StableDiffusionVideoEncoderRequirementID,
		capabilitydriver.StableDiffusionVideoVAERequirementID,
		capabilitydriver.StableDiffusionAudioVAERequirementID,
	}
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(requirements))
	for index, requirement := range requirements {
		payload := []byte("video-model-" + requirement)
		path := filepath.Join(root, fmt.Sprintf("model-%d.bin", index))
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
		digestBytes := sha256.Sum256(payload)
		digest := hex.EncodeToString(digestBytes[:])
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{RequirementID: requirement, LocalAssetID: fmt.Sprintf("asset-%d", index), AbsolutePath: path, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest})
	}
	plan, err := (capabilitydriver.StableDiffusionVideoDriver{}).PlanVideoInvocation(capabilitydriver.VideoInvocationInput{
		ConfigurationID: "video-config", ExactBindings: bindings,
		Request: capabilitydriver.VideoInvocationRequest{Prompt: prompt, Width: 32, Height: 32, FrameCount: 5, FPS: 24, Seed: 7, GenerateAudio: true},
	})
	if err != nil {
		t.Fatalf("PlanVideoInvocation: %v", err)
	}
	return plan
}

func rawCandidateForHostTest(plan *capabilitydriver.VideoInvocationPlan) localexecution.RawAVCandidate {
	width, height := plan.Size()
	candidate := localexecution.RawAVCandidate{FrameCount: plan.FrameCount(), FPS: plan.FPS(), Audio: localexecution.RawAudio{PCMSamples: []float32{0.1, -0.1}, Channels: 2, SampleRate: 32000}}
	for index := 0; index < plan.FrameCount(); index++ {
		candidate.Frames = append(candidate.Frames, localexecution.RawVideoFrame{RGBBytes: make([]byte, width*height*3), Width: width, Height: height})
	}
	return candidate
}

func waitForVideoHostQueueLength(t *testing.T, host *VideoExecutionHost, wanted int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		length := len(host.queue)
		host.mu.Unlock()
		if length == wanted {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("video host queue did not reach %d", wanted)
}
