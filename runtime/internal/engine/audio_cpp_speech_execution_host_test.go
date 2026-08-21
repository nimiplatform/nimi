package engine

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func TestQwen3TTSAudioCppCLIArgsAreExactAndMusicFree(t *testing.T) {
	plan := qwen3TTSAudioCppPlanForHostTest(t, "Hello from Nimi.", filepath.Join(t.TempDir(), "out.wav"))
	args := qwen3TTSAudioCppCLIArgs(plan)
	wantPrefix := []string{"--task", "tts", "--family", "qwen3_tts", "--model", plan.ModelPath(), "--backend", "cuda", "--session-option", "qwen3_tts.mem_saver=true", "--text", "Hello from Nimi.", "--speaker", capabilitydriver.Qwen3TTSAudioCppPresetVoiceVivian, "--language", "en"}
	if len(args) < len(wantPrefix) || !reflect.DeepEqual(args[:len(wantPrefix)], wantPrefix) {
		t.Fatalf("Qwen audio.cpp argv prefix=%q", args)
	}
	for _, value := range args {
		if value == "minimax_music3" || value == "lyrics" || value == "duration_sec" {
			t.Fatalf("Music option leaked into Qwen argv: %q", args)
		}
	}
}

func TestAudioCppSpeechExecutionHostRemovesQueuedCancelBeforeRunner(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	host := newAudioCppSpeechExecutionHostWithRunner(slog.New(slog.NewTextHandler(io.Discard, nil)), func(ctx context.Context, plan *capabilitydriver.Qwen3TTSAudioCppInvocationPlan) (localexecution.SpeechSynthesisResult, error) {
		if calls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return localexecution.SpeechSynthesisResult{}, ctx.Err()
			}
		}
		return localexecution.SpeechSynthesisResult{StagingWAVPath: plan.StagingWAVPath()}, nil
	})
	t.Cleanup(func() { _ = host.Stop() })
	first := qwen3TTSAudioCppPlanForHostTest(t, "first", filepath.Join(t.TempDir(), "first.wav"))
	second := qwen3TTSAudioCppPlanForHostTest(t, "second", filepath.Join(t.TempDir(), "second.wav"))
	firstDone := make(chan error, 1)
	go func() { _, err := host.ExecuteSpeechSynthesis(context.Background(), first, nil); firstDone <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first Qwen speech request did not enter runner")
	}
	queuedCtx, cancelQueued := context.WithCancel(context.Background())
	secondDone := make(chan error, 1)
	go func() { _, err := host.ExecuteSpeechSynthesis(queuedCtx, second, nil); secondDone <- err }()
	waitAudioCppSpeechQueueLength(t, host, 1)
	cancelQueued()
	if err := <-secondDone; localexecution.FailureKindOf(err) != localexecution.FailureCanceled {
		t.Fatalf("queued cancel err=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
	close(release)
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("runner calls=%d, want 1", calls.Load())
	}
}

func qwen3TTSAudioCppPlanForHostTest(t *testing.T, text string, staging string) *capabilitydriver.Qwen3TTSAudioCppInvocationPlan {
	t.Helper()
	root := t.TempDir()
	plan, err := (capabilitydriver.Qwen3TTSAudioCppDriver{}).PlanQwen3TTSAudioCppInvocation(capabilitydriver.Qwen3TTSAudioCppInvocationInput{LoadoutID: "loadout", RecipeID: capabilitydriver.Qwen3TTSAudioCppRecipeID, ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.Qwen3TTSAudioCppModelRequirementID, ModelAssetID: "model", AbsolutePath: filepath.Join(root, capabilitydriver.Qwen3TTSAudioCppModelRelativePath), BundleDir: root, DeclaredFiles: []string{capabilitydriver.Qwen3TTSAudioCppModelRelativePath}, VerifiedContentID: capabilitydriver.Qwen3TTSAudioCppVerifiedContentID, EntrySHA256: capabilitydriver.Qwen3TTSAudioCppVerifiedContentID}}, Package: capabilitydriver.AudioCppRuntimePackageInput{AudioCppPackageID: capabilitydriver.AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "package-source", AudioCppRoot: filepath.Join(root, "package"), AudioCppExecutablePath: filepath.Join(root, "package", "audiocpp_cli.exe"), CUDA13DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "cuda-source", CUDA13Root: filepath.Join(root, "cuda")}, Request: &runtimev1.SpeechSynthesizeScenarioSpec{Text: text, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: capabilitydriver.Qwen3TTSAudioCppPresetVoiceVivian}}, Language: "en", AudioFormat: "wav"}, StagingWAVPath: staging})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func waitAudioCppSpeechQueueLength(t *testing.T, host *AudioCppSpeechExecutionHost, wanted int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		host.mu.Lock()
		length := len(host.queue)
		host.mu.Unlock()
		if length == wanted {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("speech queue did not reach %d", wanted)
}

func TestSpeechExecutionHostNeverFallsBackFromExactAudioCppDriver(t *testing.T) {
	plan := qwen3TTSAudioCppPlanForHostTest(t, "hello", filepath.Join(t.TempDir(), "out.wav"))
	host := &SpeechExecutionHost{}
	_, err := host.ExecuteSpeechSynthesis(context.Background(), plan, nil)
	if localexecution.FailureKindOf(err) != localexecution.FailureLoad || errors.Is(err, context.Canceled) {
		t.Fatalf("missing exact audio.cpp Host err=%v kind=%q", err, localexecution.FailureKindOf(err))
	}
}
