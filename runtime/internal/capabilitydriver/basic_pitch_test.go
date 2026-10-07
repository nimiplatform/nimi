package capabilitydriver

import (
	"math"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
)

func TestBasicPitchNotesUseOneRangeOffsetAndTheSameMIDISequence(t *testing.T) {
	request := &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source", Range: &runtimev1.AudioFrameRange{StartFrame: 64000, EndFrame: 192000}}, RequestedParts: []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS}, RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI, runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE}}
	info := &runtimev1.LocalAppAudioInfo{SampleRateHz: 32000, Channels: 1, FrameCount: 256000, DurationMs: 8000}
	output, err := normalizeBasicPitchNotes(request, info, []byte(`{"version":1,"notes":[{"start":0.1204,"end":0.5608,"pitch":60},{"start":0.4,"end":0.9,"pitch":64}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if output.Completeness != runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN || len(output.Scores) != 1 {
		t.Fatal("unsupported completeness or missing score")
	}
	timeline, err := musicscore.ParseTimeline(output.TimelineJSON)
	if err != nil {
		t.Fatal(err)
	}
	notes, err := musicscore.ParseNoteMIDI(output.Scores[0].Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if len(timeline.Events) != 2 || len(notes) != 2 || timeline.Events[0].StartFrame != 67853 {
		t.Fatal("original source offset was not applied once", timeline.Events)
	}
	for _, note := range notes {
		matched := false
		for _, event := range timeline.Events {
			if *event.MIDIPitch != note.Pitch {
				continue
			}
			start := float64(event.StartFrame-request.SourceAudio.Range.StartFrame) / 32000
			end := float64(*event.EndFrame-request.SourceAudio.Range.StartFrame) / 32000
			if math.Abs(start-float64(note.StartTick)/1000) <= 0.001 && math.Abs(end-float64(note.EndTick)/1000) <= 0.001 {
				matched = true
				break
			}
		}
		if !matched {
			t.Fatal("MIDI and timeline note sequence differs")
		}
	}
	for _, bad := range []string{`{"version":1,"notes":[{"end":1,"pitch":60}]}`, `{"version":1,"notes":[{"start":0,"end":5,"pitch":60}]}`, `{"version":1,"notes":[{"start":0,"end":1,"pitch":60,"confidence":1}]}`} {
		if _, err := normalizeBasicPitchNotes(request, info, []byte(bad)); err == nil {
			t.Fatal("missing/out-of-range/invented note facts accepted")
		}
	}
	if _, err := normalizeBasicPitchNotes(request, info, []byte(`{"version":1,"notes":[]}`)); err != nil {
		t.Fatal("real empty prediction cannot be represented", err)
	}
}

func TestBasicPitchInvocationCapturesNativeInterpreterAndExactProfile(t *testing.T) {
	root := t.TempDir()
	profileRoot := filepath.Join(root, "profile")
	input := MusicTranscriptionInvocationInput{
		LoadoutID: "basic-pitch-test", RecipeID: BasicPitchRecipeID,
		ExactBindings: []InvocationExactBinding{{RequirementID: BasicPitchRequirementID, VerifiedContentID: BasicPitchVerifiedContentID, EntrySHA256: BasicPitchModelSHA256,
			BundleDir: root, AbsolutePath: filepath.Join(root, filepath.FromSlash(BasicPitchEntry)), DeclaredFiles: []string{"LICENSE", "NOTICE", BasicPitchEntry}}},
		DependencySources: []InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: BasicPitchConsumerID, CanonicalRoot: profileRoot, SelectedSourceRecordID: "exact-source", Version: "exact-profile",
			Hashes: map[string]string{"profile_digest": "exact-profile", "driver_bundle_sha256": strings.Repeat("a", 64)}}},
		Request: &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "owned-source"},
			RequestedParts:   []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS},
			RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI, runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE}},
		SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 22050, Channels: 1, FrameCount: 220500}, StagingDir: root, SourcePath: filepath.Join(root, "source.wav"),
	}
	plan, err := (BasicPitchDriver{}).PlanMusicTranscriptionInvocation(input)
	platform := runtime.GOOS + "/" + runtime.GOARCH
	if platform != "windows/amd64" && platform != "darwin/arm64" {
		if err == nil {
			t.Fatal("unadmitted execution host accepted")
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	bin, err := basicPitchInterpreterPath(profileRoot, platform)
	if err != nil || plan.PythonTranscription().InterpreterPath != bin || plan.CLIArgs()[0] != filepath.Join(profileRoot, "basic_pitch_driver.py") {
		t.Fatal("native interpreter/Driver capture is incorrect", plan.PythonTranscription(), err)
	}
	if plan.AudioCppPackageID() != "" || plan.CUDA13DependencyID() != "" || plan.TranscriptionRequest().GetSourceAudio().GetRange().GetEndFrame() != input.SourceInfo.FrameCount {
		t.Fatal("CPU transcription substrate or source capture changed")
	}
	input.DependencySources[0].Version = "other-profile"
	input.DependencySources[0].Hashes["profile_digest"] = "other-profile"
	changed, err := (BasicPitchDriver{}).PlanMusicTranscriptionInvocation(input)
	if err != nil || changed.ProcessKey() == plan.ProcessKey() || plan.PythonTranscription().ProfileDigest != "exact-profile" {
		t.Fatal("profile identity was not captured immutably", err)
	}
}

func TestBasicPitchInterpreterPathsArePlatformBound(t *testing.T) {
	root := t.TempDir()
	for platform, suffix := range map[string]string{"windows/amd64": filepath.Join("Scripts", "python.exe"), "darwin/arm64": filepath.Join("bin", "python")} {
		path, err := basicPitchInterpreterPath(root, platform)
		if err != nil || path != filepath.Join(root, suffix) {
			t.Fatalf("%s interpreter: %q %v", platform, path, err)
		}
	}
	if _, err := basicPitchInterpreterPath(root, "darwin/amd64"); err == nil {
		t.Fatal("Intel Mac interpreter admitted")
	}
}

func TestBasicPitchProfileHasOnlyImplementedOutputAndHostCombinations(t *testing.T) {
	d := BasicPitchDriver{}
	for _, path := range []string{"LICENSE", "NOTICE"} {
		if d.ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput{RelativePath: path}) < 4 {
			t.Fatal("rights file violates the shared positive probe budget")
		}
	}
	for _, platform := range []string{"windows/amd64", "darwin/arm64"} {
		requirements, reason := d.ProjectRecipeForHost(BasicPitchRecipeID, nil, nil, platform)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 || requirements[0].GetRequirementId() != BasicPitchRequirementID {
			t.Fatalf("supported host %s lost its exact model requirement: %v", platform, reason)
		}
	}
	for _, platform := range []string{"darwin/amd64", "windows/arm64", "linux/arm64", "linux/amd64"} {
		if _, reason := d.ProjectRecipeForHost(BasicPitchRecipeID, nil, nil, platform); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED {
			t.Fatalf("unsupported host %s admitted", platform)
		}
	}
	p := d.MusicInputCapabilities().GetTranscription()[0]
	if len(p.GetParts()) != 1 || p.GetParts()[0] != "note-events" || len(p.GetFormats()) != 2 {
		t.Fatal("unimplemented parts/formats advertised")
	}
	for _, part := range []runtimev1.MusicTranscriptionPart{runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET, runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_FULL_ARRANGEMENT} {
		root := t.TempDir()
		_, err := d.PlanMusicTranscriptionInvocation(MusicTranscriptionInvocationInput{RecipeID: BasicPitchRecipeID,
			ExactBindings: []InvocationExactBinding{{RequirementID: BasicPitchRequirementID, VerifiedContentID: BasicPitchVerifiedContentID, EntrySHA256: BasicPitchModelSHA256, BundleDir: root, AbsolutePath: filepath.Join(root, filepath.FromSlash(BasicPitchEntry)), DeclaredFiles: []string{"LICENSE", "NOTICE", BasicPitchEntry}}},
			Request:       &runtimev1.MusicTranscribeScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source"}, RequestedFormats: []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI}, RequestedParts: []runtimev1.MusicTranscriptionPart{part}}})
		if err == nil || !strings.Contains(err.Error(), "only note-events MIDI and timeline") {
			t.Fatal("unsupported part did not receive the exact unsupported-composition failure")
		}
	}
}
