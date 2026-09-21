package engine

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// Runs the real content verifier, queue, process lifecycle, native model and
// Driver output parser. Not a protected App or catalog acceptance test.
func TestYuE2NativeExecutionIntegration(t *testing.T) {
	root := os.Getenv("NIMI_YUE2_TEST_ROOT")
	output := os.Getenv("NIMI_YUE2_TEST_OUTPUT")
	if root == "" || output == "" {
		t.Skip("set explicit fixed-package and output paths for real GPU execution")
	}
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	model := filepath.Join(root, "models", "Yue2-3B-GGUF")
	engineRoot := filepath.Join(root, "engine", "audio-v0.8.1-bin-windows-x64-cuda13.3")
	cuda := filepath.Join(root, "engine", "audio-v0.8.1-cudart-windows-x64-cuda13.3")
	files := []string{"yue2-3b-q8_0.gguf", "yue2-vae-f16.gguf", "sidecars/yue2-generation-config.json", "sidecars/yue2-model-config.json", "sidecars/yue2-qwen.tiktoken", "sidecars/yue2-vae-config.json"}
	sort.Strings(files)
	input := capabilitydriver.MusicInvocationInput{LoadoutID: "isolated-yue2-verification", RecipeID: capabilitydriver.YuE2RecipeID,
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.YuE2RequirementID, ModelAssetID: "fixed-yue2-q8-f16", BundleDir: model, AbsolutePath: filepath.Join(model, "yue2-3b-q8_0.gguf"), DeclaredFiles: files, VerifiedContentID: capabilitydriver.YuE2VerifiedContentID, EntrySHA256: "f3a9e3b197bfd05aa4ae6ab2d4b93f6d57c8cc0ea39a4af7d151f58697c7cfb6"}},
		Package:       capabilitydriver.MusicRuntimePackageInput{AudioCppVersion: "0.8.1", AudioCppPackageID: capabilitydriver.AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "isolated-v0.8.1-f2b4937", AudioCppRoot: engineRoot, AudioCppExecutablePath: filepath.Join(engineRoot, "audiocpp_cli.exe"), CUDA13DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "isolated-v0.8.1-cuda13.3", CUDA13Root: cuda},
		Request:       &runtimev1.MusicGenerateScenarioSpec{Prompt: "English acoustic folk, warm restrained lead vocal, guitar and soft drums", Lyrics: "[Verse]\nI keep a light beside the window\nAnd watch the silver river flow\n[Chorus]\nCarry the song across the water\nWe have another mile to go", DurationSeconds: 20}, StagingWAVPath: filepath.Join(output, "music.wav")}
	plan, err := (capabilitydriver.YuE2AudioCppDriver{}).PlanMusicInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	host := NewAudioCppExecutionHost(nil)
	defer host.Stop()
	started := time.Now()
	admitted := false
	result, err := host.ExecuteMusic(ctx, plan, func() error { admitted = true; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !admitted || result.SizeBytes <= 44 || result.InferenceFacts.SemanticTokens != 500 || result.InferenceFacts.Termination != capabilitydriver.MusicTerminationBudgetLimit {
		t.Fatalf("invalid native result: %+v", result)
	}
	body, err := os.ReadFile(result.StagingWAVPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) < 44 || string(body[:4]) != "RIFF" || string(body[8:12]) != "WAVE" || binary.LittleEndian.Uint16(body[20:22]) != 1 || binary.LittleEndian.Uint16(body[22:24]) != 2 || binary.LittleEndian.Uint32(body[24:28]) != 48000 || binary.LittleEndian.Uint16(body[34:36]) != 16 {
		t.Fatal("native WAV format mismatch")
	}
	frames := int(binary.LittleEndian.Uint32(body[40:44])) / 4
	if frames < 950000 || frames > 960000 {
		t.Fatalf("unexpected 20-second budget frame count: %d", frames)
	}
	score, err := os.ReadFile(result.StagingScorePath)
	if err != nil || !strings.Contains(string(score), "K:") || len(score) > 1<<20 {
		t.Fatalf("native score missing or invalid: %v", err)
	}
	t.Logf("wall=%s compute_ms=%d frames=%d sample_rate=48000 channels=2 bytes=%d score_bytes=%d termination=%s abc_truncated=%v", time.Since(started), result.ComputeMS, frames, result.SizeBytes, len(score), result.InferenceFacts.Termination, result.InferenceFacts.GeneratedScoreTruncated)
	if _, err := host.ExecuteMusic(ctx, plan, nil); err == nil {
		t.Fatal("repeated dispatch accepted existing outputs")
	}
	retained, err := os.ReadFile(result.StagingScorePath)
	if err != nil || !bytes.Equal(retained, score) {
		t.Fatal("rejected repeated dispatch damaged the earlier score")
	}
}
