package capabilitydriver

import (
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func testMiniMaxMusic3Files() []ModelAssetFileFact {
	files := make([]ModelAssetFileFact, 0, len(miniMaxMusic3Files))
	for name, size := range miniMaxMusic3Files {
		probe := []byte(nil)
		if filepath.Ext(name) == ".gguf" {
			probe = []byte("GGUF")
		}
		files = append(files, ModelAssetFileFact{RelativePath: name, SizeBytes: size, FormatProbe: probe})
	}
	return files
}

func testMiniMaxMusic3Binding(root string) InvocationExactBinding {
	files := make([]string, 0, len(miniMaxMusic3Files))
	for name := range miniMaxMusic3Files {
		files = append(files, name)
	}
	return InvocationExactBinding{
		RequirementID:     MiniMaxMusic3RequirementID,
		ModelAssetID:      "model-asset-music3",
		AbsolutePath:      filepath.Join(root, "language_model_q4_0.gguf"),
		BundleDir:         root,
		DeclaredFiles:     files,
		VerifiedContentID: MiniMaxMusic3VerifiedContentID,
		EntrySHA256:       "sha256:6f621dd636320403c03e9f755b3e2047f5754d055e0fcc6c0c444ae52ffbfa90",
	}
}

func testMiniMaxMusic3Invocation(t *testing.T, request *runtimev1.MusicGenerateScenarioSpec) MusicInvocationInput {
	t.Helper()
	root := t.TempDir()
	return MusicInvocationInput{
		LoadoutID:     "loadout-music3",
		RecipeID:      MiniMaxMusic3RecipeID,
		ExactBindings: []InvocationExactBinding{testMiniMaxMusic3Binding(root)},
		Package: MusicRuntimePackageInput{
			AudioCppPackageID:              MiniMaxMusic3AudioCppPackageID,
			AudioCppSelectedSourceRecordID: "selected-audio-cpp",
			AudioCppRoot:                   filepath.Join(root, "audio-cpp"),
			AudioCppExecutablePath:         filepath.Join(root, "audio-cpp", "audiocpp_cli.exe"),
			CUDA13DependencyID:             MiniMaxMusic3CUDA13DependencyID,
			CUDA13SelectedSourceRecordID:   "selected-cuda13",
			CUDA13Root:                     filepath.Join(root, "cuda13"),
		},
		Request:        request,
		StagingWAVPath: filepath.Join(root, "staging", "job.wav"),
	}
}

func TestMiniMaxMusic3DriverRegistryModelContractAndPlan(t *testing.T) {
	driverValue, reason := NewProductionRegistry().Resolve(MiniMaxMusic3CapabilityContract, Identity{ImplementationID: MiniMaxMusic3ImplementationID, DriverID: MiniMaxMusic3DriverID, DriverDialect: MiniMaxMusic3DriverDialect})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("resolve driver reason = %s", reason)
	}
	driver := driverValue.(MiniMaxMusic3AudioCppDriver)
	requirements, reason := driver.ProjectRecipe(MiniMaxMusic3RecipeID, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("project recipe = %+v reason=%s", requirements, reason)
	}
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: MiniMaxMusic3RequirementID, ModelAssetId: "model-asset-music3", VerifiedContentId: MiniMaxMusic3VerifiedContentID, EntrySha256: "sha256:6f621dd636320403c03e9f755b3e2047f5754d055e0fcc6c0c444ae52ffbfa90"}
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{RecipeID: MiniMaxMusic3RecipeID, Requirement: requirements[0], Binding: binding, Entry: ModelAssetFileFact{RelativePath: "language_model_q4_0.gguf", SizeBytes: miniMaxMusic3Files["language_model_q4_0.gguf"], FormatProbe: []byte("GGUF")}, Files: testMiniMaxMusic3Files()})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.Descriptor.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC {
		t.Fatalf("project binding = %+v reason=%s", projection, reason)
	}

	request := &runtimev1.MusicGenerateScenarioSpec{Prompt: "Bright synth-pop", Lyrics: "[Verse]\nCity lights are waking.\n[Chorus]\nWe rise together."}
	input := testMiniMaxMusic3Invocation(t, request)
	plan, err := driver.PlanMusicInvocation(input)
	if err != nil {
		t.Fatalf("PlanMusicInvocation: %v", err)
	}
	if plan.DurationBudgetSeconds() != 20 || plan.NumInferenceSteps() != 30 || plan.GuidanceScale() != 1.7 || plan.ARGuidanceScale() != 1.5 || plan.TopK() != 50 || plan.Seed() != 0 || !plan.MemorySaver() {
		t.Fatalf("fixed options = %+v", plan)
	}
	if plan.AudioCppSelectedSourceRecordID() != "selected-audio-cpp" || plan.CUDA13SelectedSourceRecordID() != "selected-cuda13" || plan.ProcessKey() == "" {
		t.Fatalf("captured package identity = %+v", plan)
	}
	input.ExactBindings[0].DeclaredFiles[0] = "mutated"
	if plan.ModelBinding().DeclaredFiles[0] == "mutated" {
		t.Fatal("MusicInvocationPlan retained mutable caller binding storage")
	}
}

func TestMiniMaxMusic3DriverFailsUnsupportedCanonicalFieldsClosed(t *testing.T) {
	driver := MiniMaxMusic3AudioCppDriver{}
	base := func() *runtimev1.MusicGenerateScenarioSpec {
		return &runtimev1.MusicGenerateScenarioSpec{Prompt: "Bright synth-pop", Lyrics: "[Verse]\nCity lights are waking."}
	}
	tests := []struct {
		name       string
		mutate     func(*runtimev1.MusicGenerateScenarioSpec)
		extensions []*runtimev1.ScenarioExtension
	}{
		{name: "empty prompt", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Prompt = "" }},
		{name: "empty lyrics", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Lyrics = "" }},
		{name: "negative prompt", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.NegativePrompt = "noise" }},
		{name: "style", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Style = "pop" }},
		{name: "title", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Title = "Song" }},
		{name: "instrumental", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Instrumental = true }},
		{name: "duration", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.DurationSeconds = 20 }},
		{name: "extension", mutate: func(*runtimev1.MusicGenerateScenarioSpec) {}, extensions: []*runtimev1.ScenarioExtension{{}}},
		{name: "upstream single-line tag defect", mutate: func(v *runtimev1.MusicGenerateScenarioSpec) { v.Lyrics = "[Verse] City lights are waking." }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := base()
			test.mutate(request)
			input := testMiniMaxMusic3Invocation(t, request)
			input.Extensions = test.extensions
			if _, err := driver.PlanMusicInvocation(input); err == nil {
				t.Fatal("expected fail-closed Music3 request")
			}
		})
	}
}
