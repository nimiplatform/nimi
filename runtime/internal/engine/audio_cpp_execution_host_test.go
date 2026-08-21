package engine

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

var audioCppTestDeclaredFiles = []string{
	"LICENSE", "README.md", "config.json", "config/condition_encoder.json", "config/language_model.json",
	"config/rvq_depth_decoder.json", "config/transformer.json", "config/vocoder.json", "tokenizer/tokenizer.json",
	"tokenizer/tokenizer_config.json", "condition_encoder.gguf", "language_model_q4_0.gguf",
	"rvq_depth_decoder_q8_0.gguf", "transformer_q4_0.gguf", "vocoder.gguf",
}

func audioCppTestPlan(t *testing.T, name string) *capabilitydriver.MusicInvocationPlan {
	t.Helper()
	root := t.TempDir()
	plan, err := (capabilitydriver.MiniMaxMusic3AudioCppDriver{}).PlanMusicInvocation(capabilitydriver.MusicInvocationInput{
		LoadoutID: "loadout-" + name,
		RecipeID:  capabilitydriver.MiniMaxMusic3RecipeID,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{
			RequirementID: capabilitydriver.MiniMaxMusic3RequirementID, ModelAssetID: "asset", AbsolutePath: filepath.Join(root, "model", "language_model_q4_0.gguf"), BundleDir: filepath.Join(root, "model"), DeclaredFiles: append([]string(nil), audioCppTestDeclaredFiles...), VerifiedContentID: capabilitydriver.MiniMaxMusic3VerifiedContentID,
		}},
		Package: capabilitydriver.MusicRuntimePackageInput{
			AudioCppPackageID: capabilitydriver.MiniMaxMusic3AudioCppPackageID, AudioCppSelectedSourceRecordID: "audio-selected", AudioCppRoot: filepath.Join(root, "audio-cpp"), AudioCppExecutablePath: filepath.Join(root, "audio-cpp", "audiocpp_cli.exe"),
			CUDA13DependencyID: capabilitydriver.MiniMaxMusic3CUDA13DependencyID, CUDA13SelectedSourceRecordID: "cuda-selected", CUDA13Root: filepath.Join(root, "cuda13"),
		},
		Request:        &runtimev1.MusicGenerateScenarioSpec{Prompt: "Bright pop", Lyrics: "[Verse]\nCity lights."},
		StagingWAVPath: filepath.Join(root, "staging", name+".wav"),
	})
	if err != nil {
		t.Fatalf("PlanMusicInvocation: %v", err)
	}
	return plan
}

func TestAudioCppCLIArgsAreExactAndDriverOwned(t *testing.T) {
	plan := audioCppTestPlan(t, "args")
	args, err := audioCppCLIArgs(plan)
	if err != nil {
		t.Fatalf("audioCppCLIArgs: %v", err)
	}
	want := []string{"--task", "gen", "--family", "minimax_music3", "--backend", "cuda", "--request-option", "duration_sec=20", "--request-option", "num_inference_steps=30", "--request-option", "guidance_scale=1.7", "--request-option", "ar_guidance_scale=1.5", "--request-option", "top_k=50", "--request-option", "seed=0"}
	for index := 0; index < len(want); index += 2 {
		if !adjacentAudioCppArgs(args, want[index], want[index+1]) {
			t.Fatalf("argv missing %q %q: %v", want[index], want[index+1], args)
		}
	}
	if !containsAudioCppArg(args, "--metrics") {
		t.Fatalf("argv missing --metrics: %v", args)
	}
}

func adjacentAudioCppArgs(args []string, left, right string) bool {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == left && args[index+1] == right {
			return true
		}
	}
	return false
}

func containsAudioCppArg(args []string, value string) bool {
	for _, arg := range args {
		if arg == value {
			return true
		}
	}
	return false
}

func TestAudioCppExecutionHostFIFOAndQueuedCancel(t *testing.T) {
	firstRelease := make(chan struct{})
	started := make(chan string, 3)
	var mu sync.Mutex
	runs := make([]string, 0, 3)
	runner := func(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error) {
		name := plan.LoadoutID()
		mu.Lock()
		runs = append(runs, name)
		mu.Unlock()
		started <- name
		if name == "loadout-first" {
			select {
			case <-firstRelease:
			case <-ctx.Done():
				return localexecution.MusicResult{}, musicContextFailure(ctx.Err())
			}
		}
		return localexecution.MusicResult{StagingWAVPath: plan.StagingWAVPath()}, nil
	}
	host := newAudioCppExecutionHostWithRunner(testLogger(), runner)
	defer func() { _ = host.Stop() }()

	type outcome struct {
		result localexecution.MusicResult
		err    error
	}
	firstDone := make(chan outcome, 1)
	go func() {
		result, err := host.ExecuteMusic(context.Background(), audioCppTestPlan(t, "first"), nil)
		firstDone <- outcome{result, err}
	}()
	if got := <-started; got != "loadout-first" {
		t.Fatalf("first start = %q", got)
	}
	queuedCtx, cancelQueued := context.WithCancel(context.Background())
	queuedDone := make(chan outcome, 1)
	go func() {
		result, err := host.ExecuteMusic(queuedCtx, audioCppTestPlan(t, "middle"), nil)
		queuedDone <- outcome{result, err}
	}()
	thirdDone := make(chan outcome, 1)
	go func() {
		result, err := host.ExecuteMusic(context.Background(), audioCppTestPlan(t, "third"), nil)
		thirdDone <- outcome{result, err}
	}()
	time.Sleep(20 * time.Millisecond)
	cancelQueued()
	if got := <-queuedDone; localexecution.FailureKindOf(got.err) != localexecution.FailureCanceled {
		t.Fatalf("queued cancel = %v", got.err)
	}
	close(firstRelease)
	if got := <-firstDone; got.err != nil {
		t.Fatalf("first = %v", got.err)
	}
	if got := <-started; got != "loadout-third" {
		t.Fatalf("next start = %q", got)
	}
	if got := <-thirdDone; got.err != nil {
		t.Fatalf("third = %v", got.err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(runs) != 2 || runs[0] != "loadout-first" || runs[1] != "loadout-third" {
		t.Fatalf("runs = %v", runs)
	}
}

func TestAudioCppExecutionHostRunningCancelAndTimeout(t *testing.T) {
	runner := func(ctx context.Context, _ *capabilitydriver.MusicInvocationPlan) (localexecution.MusicResult, error) {
		<-ctx.Done()
		return localexecution.MusicResult{}, musicContextFailure(ctx.Err())
	}
	host := newAudioCppExecutionHostWithRunner(testLogger(), runner)
	defer func() { _ = host.Stop() }()

	cancelCtx, cancel := context.WithCancel(context.Background())
	cancelDone := make(chan error, 1)
	go func() { _, err := host.ExecuteMusic(cancelCtx, audioCppTestPlan(t, "cancel"), nil); cancelDone <- err }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-cancelDone; localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("running cancel = %v", err)
	}

	timeoutCtx, timeoutCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer timeoutCancel()
	_, err := host.ExecuteMusic(timeoutCtx, audioCppTestPlan(t, "timeout"), nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureTimeout {
		t.Fatalf("timeout = %v", err)
	}
}

func TestAudioCppOutOfMemoryClassificationIsDistinct(t *testing.T) {
	for _, message := range []string{
		"CUDA_ERROR_OUT_OF_MEMORY",
		"failed to allocate tensor: out of memory",
	} {
		if !audioCppOutOfMemory(message) {
			t.Fatalf("OOM message was not classified: %q", message)
		}
	}
	if audioCppOutOfMemory("native inference failed") {
		t.Fatal("ordinary inference failure was classified as OOM")
	}
}

func TestBoundedAudioCppOutputDetectsOOMAfterDiagnosticLimit(t *testing.T) {
	output := &boundedAudioCppOutput{limit: 8}
	if _, err := output.Write([]byte("ordinary diagnostic output beyond the retained prefix CUDA_ERROR_OUT_")); err != nil {
		t.Fatal(err)
	}
	if _, err := output.Write([]byte("OF_MEMORY")); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "ordinary" {
		t.Fatalf("bounded output = %q", got)
	}
	if !output.OutOfMemory() {
		t.Fatal("OOM marker beyond the retained diagnostic prefix was not classified")
	}
}

func TestAudioCppProcessExitWaitIsBounded(t *testing.T) {
	done := make(chan error, 1)
	marker := errors.New("process exited")
	done <- marker
	waitErr, err := waitAudioCppProcessExit(done, time.Second)
	if err != nil || !errors.Is(waitErr, marker) {
		t.Fatalf("completed wait = %v, %v", waitErr, err)
	}

	started := time.Now()
	if _, err := waitAudioCppProcessExit(make(chan error), 20*time.Millisecond); err == nil {
		t.Fatal("missing process exit did not time out")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("bounded wait took %s", elapsed)
	}
}
