package capabilitydriver

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
)

func sheetFixture(t *testing.T) ([]byte, []byte) {
	t.Helper()
	score, err := os.ReadFile("testdata/sheetsage2/score.abc")
	if err != nil {
		t.Fatal(err)
	}
	events, err := os.ReadFile("testdata/sheetsage2/events.json")
	if err != nil {
		t.Fatal(err)
	}
	return score, events
}
func sheetRequest() (*runtimev1.MusicTranscribeScenarioSpec, *runtimev1.LocalAppAudioInfo) {
	// Real 191.6355-second native output is positioned once into a larger source.
	return &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source-owned", Range: &runtimev1.AudioFrameRange{StartFrame: 960000, EndFrame: 10158504}},
			RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC, runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE}, RequestedParts: []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET}},
		&runtimev1.LocalAppAudioInfo{SampleRateHz: 48000, Channels: 2, FrameCount: 10158504, DurationMs: 211635}
}

func TestSheetSage2NormalizesActualNativeOutput(t *testing.T) {
	// Real pinned audio.cpp output; this tests structural conversion, not the
	// accuracy of the model's transcription of the authorized source recording.
	score, events := sheetFixture(t)
	request, info := sheetRequest()
	result, err := normalizeSheetSage2Output(request, info, score, events)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Scores) != 1 || !bytes.Equal(result.Scores[0].Bytes, score) || result.Completeness != runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN {
		t.Fatal("score or completeness was fabricated")
	}
	timeline, err := musicscore.ParseTimeline(result.TimelineJSON)
	if err != nil {
		t.Fatal(err)
	}
	if timeline.Events[0].StartFrame != 960480 || len(timeline.Events) < 501 {
		t.Fatal("source-frame translation or events were lost")
	}
	foundNote, foundKey, foundChord := false, false, false
	for _, e := range timeline.Events {
		if e.Kind == "note" && !foundNote {
			foundNote = true
			if e.StartFrame != 1158240 || *e.EndFrame != 1191360 || *e.MIDIPitch != 69 {
				t.Fatalf("first native note was not preserved: %+v", e)
			}
		}
		if e.Kind == "key" && e.Label == "G:minor" {
			foundKey = true
		}
		if e.Kind == "chord" && e.Label == "D:maj" {
			foundChord = true
		}
	}
	if !foundNote || !foundKey || !foundChord || strings.Contains(string(result.TimelineJSON), "tokens_by_field") {
		t.Fatal("native vocabulary was not normalized")
	}
}

func TestSheetSage2RejectsNativeVocabularyDriftAndInvalidSpans(t *testing.T) {
	score, events := sheetFixture(t)
	request, info := sheetRequest()
	for _, mutate := range []func(map[string]any){
		func(event map[string]any) { event["tokens_by_field"].(map[string]any)["key"] = []any{99999} },
		func(event map[string]any) {
			event["notes"] = []any{map[string]any{"pitch": 60, "track": 1, "duration_bin": 1, "duration_steps": 2, "end_time": 0.001}}
		},
	} {
		var envelope map[string]any
		if err := json.Unmarshal(events, &envelope); err != nil {
			t.Fatal(err)
		}
		payload, _ := hex.DecodeString(envelope["payload_hex"].(string))
		var native map[string]any
		_ = json.Unmarshal(payload, &native)
		mutate(native["events"].([]any)[0].(map[string]any))
		payload, _ = json.Marshal(native)
		envelope["bytes"] = len(payload)
		envelope["payload_hex"] = hex.EncodeToString(payload)
		changed, _ := json.Marshal(envelope)
		if _, err := normalizeSheetSage2Output(request, info, score, changed); err == nil {
			t.Fatal("invalid native output was accepted")
		}
	}
}

func TestSheetSage2PlanRejectsMIDIAndOwnsOnlyTranscriptionArgs(t *testing.T) {
	root := t.TempDir()
	request, info := sheetRequest()
	input := MusicTranscriptionInvocationInput{RecipeID: SheetSage2RecipeID, LoadoutID: "loadout", Request: request, SourceInfo: info,
		SourcePath: filepath.Join(root, "source.wav"), StagingDir: root,
		ExactBindings: []InvocationExactBinding{{RequirementID: SheetSage2RequirementID, VerifiedContentID: SheetSage2VerifiedContentID, AbsolutePath: filepath.Join(root, "model.gguf"), DeclaredFiles: []string{"model.gguf"}}},
		Package: AudioCppRuntimePackageInput{AudioCppVersion: "0.8.1", AudioCppPackageID: AudioCppWindowsCUDA13PackageID, AudioCppSelectedSourceRecordID: "package-source", AudioCppRoot: root,
			AudioCppExecutablePath: filepath.Join(root, "audiocpp_cli.exe"), CUDA13DependencyID: AudioCppCUDA13RuntimeDependencyID, CUDA13SelectedSourceRecordID: "cuda-source", CUDA13Root: root}}
	plan, err := (SheetSage2AudioCppDriver{}).PlanMusicTranscriptionInvocation(input)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.IsTranscription() || plan.StagingWAVPath() != "" || plan.PrimaryStagingOutputPath() != filepath.Join(root, "score.abc") {
		t.Fatal("transcription acquired a fake audio output")
	}
	if strings.Contains(strings.Join(plan.CLIArgs(), " "), "--lyrics") {
		t.Fatal("transcription used generation input")
	}
	request.RequestedFormats[0] = runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI
	if plan.TranscriptionRequest().RequestedFormats[0] != runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC {
		t.Fatal("plan request is mutable")
	}
	if _, err := (SheetSage2AudioCppDriver{}).PlanMusicTranscriptionInvocation(input); err == nil {
		t.Fatal("native task name midi was mistaken for a MIDI output")
	}
}
