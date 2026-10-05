package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func seedVCInvocationFixture(t *testing.T) VoiceConvertInvocationInput {
	t.Helper()
	root := t.TempDir()
	return VoiceConvertInvocationInput{RecipeID: SeedVCRecipeID, Package: nativeAudioCppPackageForTest(root),
		ExactBindings: []InvocationExactBinding{{RequirementID: SeedVCRequirementID, ModelAssetID: "seed", VerifiedContentID: SeedVCVerifiedContentID, EntrySHA256: SeedVCEntrySHA, BundleDir: root, AbsolutePath: filepath.Join(root, "astral", "bsq2048.safetensors"), DeclaredFiles: append([]string(nil), seedVCDeclaredFiles()...)}},
		Request:       &runtimev1.AudioVoiceConvertScenarioSpec{SourceKind: runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING, SourceVocal: &runtimev1.MusicAudioInput{ArtifactId: "source"}, TargetVoice: &runtimev1.VoiceConvertTargetVoice{Target: &runtimev1.VoiceConvertTargetVoice_ReferenceAudio{ReferenceAudio: &runtimev1.MusicAudioInput{ArtifactId: "reference"}}}},
		SourceInfo:    &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 1, FrameCount: 418950}, TargetInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 1, FrameCount: 352800}, StagingDir: root, SourcePath: filepath.Join(root, "source.wav"), TargetPath: filepath.Join(root, "target.wav")}
}

func TestSeedVCSingingPlanPreservesKeyAndMapsExplicitShift(t *testing.T) {
	for _, shift := range []*int32{nil, proto.Int32(0), proto.Int32(4)} {
		input := seedVCInvocationFixture(t)
		input.Request.SemitoneShift = shift
		plan, err := (SeedVCAudioCppDriver{}).PlanVoiceConvertInvocation(input)
		if err != nil {
			t.Fatal(err)
		}
		args := plan.CLIArgs()
		options := map[string]bool{}
		for i := 0; i+1 < len(args); i++ {
			if args[i] == "--request-option" {
				options[args[i+1]] = true
			}
		}
		wantShift := "semitone_shift=0"
		if shift != nil && *shift == 4 {
			wantShift = "semitone_shift=4"
		}
		for _, option := range []string{"f0_condition=true", "auto_f0_adjust=false", "length_adjust=1", wantShift} {
			if !options[option] {
				t.Fatalf("missing %s: %v", option, args)
			}
		}
		if route, _ := argValue(args, "--task-route"); route != "v1_svc" {
			t.Fatal(args)
		}
		if model, _ := argValue(args, "--model"); model != input.ExactBindings[0].BundleDir {
			t.Fatal("native loading escaped the complete captured bundle")
		}
		if plan.expectedSampleRate != 44100 || plan.expectedChannels != 1 || plan.expectedBitsPerSample != 32 {
			t.Fatal("wrong native output format")
		}
		input.Request.SourceVocal.ArtifactId = "changed"
		if plan.VoiceConvertRequest().GetSourceVocal().GetArtifactId() != "source" {
			t.Fatal("captured source changed")
		}
	}
}

func TestSeedVCRejectsMissingOtherRouteWeightsAndOversizedReference(t *testing.T) {
	input := seedVCInvocationFixture(t)
	input.ExactBindings[0].DeclaredFiles = input.ExactBindings[0].DeclaredFiles[1:]
	if _, err := (SeedVCAudioCppDriver{}).PlanVoiceConvertInvocation(input); err == nil {
		t.Fatal("incomplete native dependencies admitted")
	}
	input = seedVCInvocationFixture(t)
	input.ExactBindings[0].VerifiedContentID = "sha256:" + strings.Repeat("a", 64)
	if _, err := (SeedVCAudioCppDriver{}).PlanVoiceConvertInvocation(input); err == nil {
		t.Fatal("different bundle admitted")
	}
	input = seedVCInvocationFixture(t)
	input.TargetInfo.FrameCount = 25*44100 + 1
	if _, err := (SeedVCAudioCppDriver{}).PlanVoiceConvertInvocation(input); err == nil {
		t.Fatal("silently truncated reference admitted")
	}
	input = seedVCInvocationFixture(t)
	input.Request.SemitoneShift = proto.Int32(13)
	if _, err := (SeedVCAudioCppDriver{}).PlanVoiceConvertInvocation(input); err == nil {
		t.Fatal("unsupported shift admitted")
	}
}

func TestSeedVCActualImportedCompleteBundle(t *testing.T) {
	root := os.Getenv("NIMI_SEED_VC_PAYLOAD_INPUT")
	if root == "" {
		t.Skip("explicit real complete bundle required; this is not App acceptance")
	}
	d := SeedVCAudioCppDriver{}
	r, reason := d.ProjectRecipe(SeedVCRecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	facts := make([]ModelAssetFileFact, 0, len(seedVCDeclaredFiles()))
	var entry ModelAssetFileFact
	for _, name := range seedVCDeclaredFiles() {
		f, err := os.Open(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil {
			t.Fatal(err)
		}
		s, err := f.Stat()
		if err != nil {
			_ = f.Close()
			t.Fatal(err)
		}
		p, err := d.ProbeModelAsset(ModelAssetFormatProbeInput{RecipeID: SeedVCRecipeID, RequirementID: SeedVCRequirementID, RelativePath: name, Entry: name == "astral/bsq2048.safetensors"}, f, s.Size())
		closeErr := f.Close()
		if err != nil || closeErr != nil {
			t.Fatal(name, err, closeErr)
		}
		fact := ModelAssetFileFact{RelativePath: name, SizeBytes: s.Size(), FormatProbe: p}
		facts = append(facts, fact)
		if name == "astral/bsq2048.safetensors" {
			entry = fact
		}
	}
	input := ModelAssetBindingInput{RecipeID: SeedVCRecipeID, Requirement: r[0], Binding: &runtimev1.ModelAssetExactBinding{RequirementId: SeedVCRequirementID, ModelAssetId: "seed", VerifiedContentId: SeedVCVerifiedContentID, EntrySha256: SeedVCEntrySHA}, Entry: entry, Files: facts}
	if _, reason := d.ProjectModelAssetBinding(input); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("actual complete bundle rejected", reason)
	}
	for i := range input.Files {
		if input.Files[i].RelativePath == "v1/svc.json" {
			input.Files[i].FormatProbe = []byte("{}")
		}
	}
	if _, reason := d.ProjectModelAssetBinding(input); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("wrong v1_svc architecture admitted")
	}
}
