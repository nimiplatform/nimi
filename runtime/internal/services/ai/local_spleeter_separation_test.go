package ai

import (
	"encoding/binary"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"path/filepath"
	"strings"
	"testing"
)

func TestSpleeterCapturedPythonIdentityRehydratesAndRejectsDrift(t *testing.T) {
	svc := newTestService(nil)
	svc.localSpeechStagingRoot = t.TempDir()
	root := t.TempDir()
	model := filepath.Join(root, "model")
	profile := filepath.Join(root, "profile")
	facts, _ := capabilitydriver.SpleeterFacts(2)
	req, reason := (capabilitydriver.SpleeterDriver{}).ProjectRecipe(capabilitydriver.SpleeterRecipe2, nil, nil)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal(reason)
	}
	selected := &localexecution.SelectedLocalExecution{Configured: true, LoadoutID: "spleeter-loadout", CapabilityContract: capabilitydriver.AudioSeparateContract, RecipeID: capabilitydriver.SpleeterRecipe2, RecipeRevision: "1", DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.SpleeterImplementationID, DriverID: capabilitydriver.SpleeterDriverID, DriverDialect: capabilitydriver.SpleeterDriverDialect}).Proto(), Requirements: req,
		ExactBindings:          []localexecution.ExactBinding{{RequirementID: capabilitydriver.DemucsModelRequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "spleeter-model", AbsolutePath: filepath.Join(model, "model.meta"), BundleDir: model, DeclaredFiles: []string{"checkpoint", "model.data-00000-of-00001", "model.index", "model.meta"}, VerifiedContentID: facts.ContentID, EntrySHA256: facts.MetaSHA}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "python.package-set", DependencyID: "spleeter-cpu", ConsumerScope: capabilitydriver.SpleeterConsumerID, SelectedSourceRecordID: "captured-profile", CanonicalRoot: profile, Version: "digest", Hashes: map[string]string{"profile_digest": "digest", "driver_bundle_sha256": strings.Repeat("a", 64)}}}}
	resolver := &mutableLocalExecutionResolver{projection: selected}
	svc.SetLocalExecutionResolver(resolver)
	payload := canonicalUploadFixture(t)
	binary.LittleEndian.PutUint32(payload[24:28], 44100)
	binary.LittleEndian.PutUint32(payload[28:32], 44100*8)
	if e := svc.runtimeArtifacts.Put("source", runtimeartifact.ArtifactRecord{Bytes: payload, MimeType: "audio/wav", SizeBytes: int64(len(payload)), Owner: &runtimeartifact.ArtifactOwner{AppID: "app.local", SubjectUserID: "anonymous"}, CanonicalAudio: &runtimeartifact.CanonicalAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 2, DataOffset: 56}}); e != nil {
		t.Fatal(e)
	}
	ctx := executionintent.WithIntent(scenarioJobUserContext("app.local", "anonymous"), executionintent.Intent{CapabilityContract: capabilitydriver.AudioSeparateContract, LocalLoadoutRef: "spleeter-loadout", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	head := &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}
	effective, e := svc.captureLocalSpeechEffectiveInputs(ctx, head, &runtimev1.SubmitScenarioJobRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioSeparate{AudioSeparate: &runtimev1.AudioSeparateScenarioSpec{SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source", Range: &runtimev1.AudioFrameRange{StartFrame: 1, EndFrame: 2}}}}}})
	if e != nil {
		t.Fatal(e)
	}
	defer cleanupLocalSpeechStagingPaths(effective.stagingPaths)
	captured, e := cloneLocalResolvedAssembly(effective.resolvedAssembly)
	if e != nil {
		t.Fatal(e)
	}
	if captured.LoadPlan.Speech.SeparationSource.Python == nil || captured.LoadPlan.Speech.SeparationSource.AudioCppPackageID != "" {
		t.Fatal("Python capture lost or forged audio.cpp")
	}
	resolver.projection = nil
	restored, e := svc.localSpeechEffectiveInputsFromResolvedAssembly(captured)
	if e != nil {
		t.Fatal(e)
	}
	if restored.separatePlan.PythonExecution().SelectedSourceRecordID != "captured-profile" || restored.separatePlan.SourceInfo().GetFrameCount() != 1 {
		t.Fatal("captured identity/range lost")
	}
	changed, e := cloneLocalResolvedAssembly(captured)
	if e != nil {
		t.Fatal(e)
	}
	changed.LoadPlan.Speech.SeparationSource.Python.ProfileDigest = "new-profile"
	if _, e := svc.localSpeechEffectiveInputsFromResolvedAssembly(changed); e == nil {
		t.Fatal("profile drift accepted")
	}
}
