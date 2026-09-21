package engine

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// Runs existing real model custody through exact production Drivers and both
// private Hosts. The isolated package is extracted with the production whitelist.
// It neither selects machine resources nor asserts protected App acceptance.
func TestAudioCpp081RetainedDriversIntegration(t *testing.T) {
	root, output := os.Getenv("NIMI_YUE2_TEST_ROOT"), os.Getenv("NIMI_AUDIO_RETAINED_TEST_OUTPUT")
	musicRoot, speechRoot := os.Getenv("NIMI_MUSIC3_TEST_MODEL"), os.Getenv("NIMI_QWEN_TTS_TEST_MODEL")
	if root == "" || output == "" || musicRoot == "" || speechRoot == "" {
		t.Skip("explicit real resources were not supplied")
	}
	if err := os.Mkdir(output, 0700); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(root, "engine", AudioCppPackageAssetName)
	hash, err := sha256File(archive)
	if err != nil || hash != AudioCppPackageArchiveSHA256 {
		t.Fatalf("fixed archive: %s %v", hash, err)
	}
	packageRoot := filepath.Join(output, "package")
	if err := os.Mkdir(packageRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := extractAudioCppAdmittedPackageFiles(archive, packageRoot); err != nil {
		t.Fatal(err)
	}
	packageInput := capabilitydriver.AudioCppRuntimePackageInput{AudioCppVersion: AudioCppPackageVersion,
		AudioCppPackageID: capabilitydriver.AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "isolated-fixed-081",
		AudioCppRoot: packageRoot, AudioCppExecutablePath: filepath.Join(packageRoot, AudioCppCLIExecutableName),
		CUDA13DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "isolated-fixed-133",
		CUDA13Root: filepath.Join(root, "engine", "audio-v0.8.1-cudart-windows-x64-cuda13.3")}
	binding := func(directory, requirement, entry string) capabilitydriver.InvocationExactBinding {
		t.Helper()
		directory = filepath.Clean(directory)
		raw, err := os.ReadFile(filepath.Join(directory, "asset.manifest.json"))
		if err != nil {
			t.Fatal(err)
		}
		var manifest struct {
			ID      string `json:"model_asset_id"`
			Content string `json:"content_id"`
			Files   []struct {
				Path string `json:"relative_path"`
				SHA  string `json:"sha256"`
			} `json:"files"`
		}
		if err := json.Unmarshal(raw, &manifest); err != nil {
			t.Fatal(err)
		}
		result := capabilitydriver.InvocationExactBinding{RequirementID: requirement, ModelAssetID: manifest.ID, BundleDir: directory, AbsolutePath: filepath.Join(directory, entry), VerifiedContentID: manifest.Content}
		for _, file := range manifest.Files {
			result.DeclaredFiles = append(result.DeclaredFiles, file.Path)
			if file.Path == entry {
				result.EntrySHA256 = file.SHA
			}
		}
		if result.EntrySHA256 == "" {
			t.Fatal("model entry is not declared")
		}
		return result
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	musicHost := NewAudioCppExecutionHost(nil)
	defer musicHost.Stop()
	musicPlan, err := (capabilitydriver.MiniMaxMusic3AudioCppDriver{}).PlanMusicInvocation(capabilitydriver.MusicInvocationInput{
		LoadoutID: "isolated-music3", RecipeID: capabilitydriver.MiniMaxMusic3RecipeID, Package: packageInput,
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding(musicRoot, capabilitydriver.MiniMaxMusic3RequirementID, "language_model_q4_0.gguf")},
		Request:       &runtimev1.MusicGenerateScenarioSpec{Prompt: "Acoustic folk, gentle vocals with guitar", Lyrics: "[Verse]\nI keep a light beside the window\nAnd watch the silver river flow", DurationSeconds: 20}, StagingWAVPath: filepath.Join(output, "music3.wav")})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	music, err := musicHost.ExecuteMusic(ctx, musicPlan, nil)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := audiomedia.InspectCanonical(ctx, music.StagingWAVPath)
	if err != nil || facts.SampleRateHz != 44100 || facts.Channels != 2 || facts.FrameCount == 0 {
		t.Fatalf("music canonical output: %+v %v", facts, err)
	}
	t.Logf("music3 wall=%s compute_ms=%d frames=%d bytes=%d", time.Since(started), music.ComputeMS, facts.FrameCount, music.SizeBytes)
	speechHost := NewAudioCppSpeechExecutionHost(nil)
	defer speechHost.Stop()
	speechPlan, err := (capabilitydriver.Qwen3TTSAudioCppDriver{}).PlanQwen3TTSAudioCppInvocation(capabilitydriver.Qwen3TTSAudioCppInvocationInput{
		LoadoutID: "isolated-qwen", RecipeID: capabilitydriver.Qwen3TTSAudioCppRecipeID, Package: packageInput,
		ExactBindings: []capabilitydriver.InvocationExactBinding{binding(speechRoot, capabilitydriver.Qwen3TTSAudioCppModelRequirementID, capabilitydriver.Qwen3TTSAudioCppModelRelativePath)},
		Request:       &runtimev1.SpeechSynthesizeScenarioSpec{Text: "The music workspace is ready for your next recording.", Language: "en", AudioFormat: "wav", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: capabilitydriver.Qwen3TTSAudioCppPresetVoiceVivian}}}, StagingWAVPath: filepath.Join(output, "qwen.wav")})
	if err != nil {
		t.Fatal(err)
	}
	started = time.Now()
	speech, err := speechHost.ExecuteSpeechSynthesis(ctx, speechPlan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if speech.SizeBytes <= 44 || speech.MIMEType != "audio/wav" {
		t.Fatalf("speech result: %+v", speech)
	}
	t.Logf("qwen3-tts wall=%s compute_ms=%d bytes=%d", time.Since(started), speech.ComputeMS, speech.SizeBytes)
}
