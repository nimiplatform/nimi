package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"path/filepath"
	"testing"
)

func spleeterInput(t *testing.T, group int) AudioSeparateInvocationInput {
	t.Helper()
	facts, _ := SpleeterFacts(group)
	root := t.TempDir()
	model := filepath.Join(root, "model")
	stage := filepath.Join(root, "stage")
	profile := filepath.Join(root, "profile")
	recipe := SpleeterRecipe2
	if group == 4 {
		recipe = SpleeterRecipe4
	}
	return AudioSeparateInvocationInput{RecipeID: recipe, ExactBindings: []InvocationExactBinding{{RequirementID: DemucsModelRequirementID, ModelAssetID: "model", VerifiedContentID: facts.ContentID, EntrySHA256: facts.MetaSHA, AbsolutePath: filepath.Join(model, "model.meta"), BundleDir: model, DeclaredFiles: []string{"checkpoint", "model.data-00000-of-00001", "model.index", "model.meta"}}}, DependencySources: []InvocationExactDependencySource{{DependencyFamily: "python.package-set", ConsumerScope: SpleeterConsumerID, CanonicalRoot: profile, SelectedSourceRecordID: "profile-source", Version: "digest", Hashes: map[string]string{"profile_digest": "digest", "driver_bundle_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}, Request: &runtimev1.AudioSeparateScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "owned-source"}}, SourcePath: filepath.Join(stage, "source.wav"), SourceInfo: &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 44100}, StagingDir: stage}
}
func TestSpleeterExactGroupsAndUnsupportedRequests(t *testing.T) {
	driver := SpleeterDriver{}
	for _, group := range []int{2, 4} {
		in := spleeterInput(t, group)
		in.Request.IncludeInstrumentParts = group == 4
		plan, e := driver.PlanAudioSeparateInvocation(in)
		if e != nil {
			t.Fatal(e)
		}
		if plan.PythonExecution() == nil || plan.DriverID() != SpleeterDriverID || plan.SpleeterGroup() != group || plan.IncludeInstrumentParts() != (group == 4) {
			t.Fatal("incorrect plan")
		}
		copy := plan.PythonExecution()
		copy.ConsumerID = "changed"
		if plan.PythonExecution().ConsumerID != SpleeterConsumerID {
			t.Fatal("plan mutable")
		}
	}
	tests := map[string]func(*AudioSeparateInvocationInput){
		"two instruments": func(i *AudioSeparateInvocationInput) { i.Request.IncludeInstrumentParts = true },
		"missing profile": func(i *AudioSeparateInvocationInput) { i.DependencySources = nil },
		"wrong identity": func(i *AudioSeparateInvocationInput) {
			f, _ := SpleeterFacts(4)
			i.ExactBindings[0].VerifiedContentID = f.ContentID
		},
		"file collision": func(i *AudioSeparateInvocationInput) { i.ExactBindings[0].DeclaredFiles[0] = "model.meta" },
		"missing source": func(i *AudioSeparateInvocationInput) { i.SourceInfo = nil },
		"wrong rate":     func(i *AudioSeparateInvocationInput) { i.SourceInfo.SampleRateHz = 48000 },
		"wrong channels": func(i *AudioSeparateInvocationInput) { i.SourceInfo.Channels = 1 },
		"too long":       func(i *AudioSeparateInvocationInput) { i.SourceInfo.FrameCount = 600*44100 + 1 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			in := spleeterInput(t, 2)
			mutate(&in)
			if _, e := driver.PlanAudioSeparateInvocation(in); e == nil {
				t.Fatal("unsupported input accepted")
			}
		})
	}
	if _, reason := driver.ProjectRecipeForHost(SpleeterRecipe2, nil, nil, "darwin/arm64"); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("unsupported host accepted")
	}
}
