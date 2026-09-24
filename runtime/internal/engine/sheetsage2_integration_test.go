package engine

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
)

// Real pinned model/Driver/Host execution. It does not register a Loadout,
// invoke a protected App operation or establish transcription accuracy.
func TestSheetSage2NativeExecutionIntegration(t *testing.T) {
	root, output, source := os.Getenv("NIMI_SHEETSAGE_TEST_ROOT"), os.Getenv("NIMI_SHEETSAGE_TEST_OUTPUT"), os.Getenv("NIMI_SHEETSAGE_TEST_SOURCE")
	if root == "" || output == "" || source == "" {
		t.Skip("explicit fixed resources were not supplied")
	}
	root, output = filepath.Clean(root), filepath.Clean(output)
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	inputFile, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = inputFile.Close() }()
	stagedSource := filepath.Join(output, "source.wav")
	copyFile, err := os.OpenFile(stagedSource, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(copyFile, inputFile)
	closeErr := copyFile.Close()
	if copyErr != nil {
		t.Fatal(copyErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	facts, err := audiomedia.InspectCanonical(ctx, stagedSource)
	if err != nil {
		t.Fatal(err)
	}
	// The verifier admits only declared payloads, not the HF downloader cache.
	// A same-volume hard link gives this experiment a clean immutable bundle
	// without another multi-gigabyte download or changing the downloaded source.
	modelRoot := filepath.Join(output, "model")
	if err := os.Mkdir(modelRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(root, "models", "SheetSage2-GGUF", "sheetsage2-orig.gguf"), filepath.Join(modelRoot, "sheetsage2-orig.gguf")); err != nil {
		t.Fatal(err)
	}
	engineRoot := filepath.Join(root, "engine", "audio-v0.8.1-bin-windows-x64-cuda13.3")
	input := capabilitydriver.MusicTranscriptionInvocationInput{LoadoutID: "isolated-sheetsage2-verification", RecipeID: capabilitydriver.SheetSage2RecipeID,
		SourcePath: stagedSource, StagingDir: output, SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: facts.SampleRateHz, Channels: uint32(facts.Channels), FrameCount: facts.FrameCount, DurationMs: int64(facts.DurationMilliseconds())},
		Request: &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "isolated-source"},
			RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC, runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE},
			RequestedParts:   []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET}},
		ExactBindings: []capabilitydriver.InvocationExactBinding{{RequirementID: capabilitydriver.SheetSage2RequirementID, ModelAssetID: "fixed-sheetsage2-original",
			BundleDir: modelRoot, AbsolutePath: filepath.Join(modelRoot, "sheetsage2-orig.gguf"), DeclaredFiles: []string{"sheetsage2-orig.gguf"},
			VerifiedContentID: capabilitydriver.SheetSage2VerifiedContentID, EntrySHA256: strings.TrimPrefix(capabilitydriver.SheetSage2VerifiedContentID, "sha256:")}},
		Package: capabilitydriver.AudioCppRuntimePackageInput{AudioCppVersion: "0.8.1", AudioCppPackageID: capabilitydriver.AudioCppWindowsCUDA13PackageID,
			AudioCppSelectedSourceRecordID: "isolated-v0.8.1-f2b4937", AudioCppRoot: engineRoot, AudioCppExecutablePath: filepath.Join(engineRoot, "audiocpp_cli.exe"),
			CUDA13DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "isolated-v0.8.1-cuda13.3",
			CUDA13Root: filepath.Join(root, "engine", "audio-v0.8.1-cudart-windows-x64-cuda13.3")}}
	plan, err := (capabilitydriver.SheetSage2AudioCppDriver{}).PlanMusicTranscriptionInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	host := NewAudioCppExecutionHost(nil)
	defer func() { _ = host.Stop() }()
	started := time.Now()
	result, err := host.ExecuteMusic(ctx, plan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Transcription == nil || len(result.Transcription.Scores) != 1 || result.StagingWAVPath != "" {
		t.Fatal("native transcription produced the wrong result kind")
	}
	timeline, err := musicscore.ParseTimeline(result.Transcription.TimelineJSON)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.AudioInfo.FrameCount != facts.FrameCount || len(timeline.Events) == 0 {
		t.Fatal("source facts or symbolic events were lost")
	}
	if err := os.WriteFile(filepath.Join(output, "timeline.json"), result.Transcription.TimelineJSON, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("wall=%s compute_ms=%d source_frames=%d score_bytes=%d timeline_bytes=%d events=%d completeness=%s", time.Since(started), result.ComputeMS,
		facts.FrameCount, len(result.Transcription.Scores[0].Bytes), len(result.Transcription.TimelineJSON), len(timeline.Events), result.Transcription.Completeness)
	if _, err := host.ExecuteMusic(ctx, plan, nil); err == nil {
		t.Fatal("repeated dispatch accepted existing transcription outputs")
	}
}
