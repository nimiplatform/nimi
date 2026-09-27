package ai

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDemucsOwnedCanonicalInputCapturesRangeWithoutCUDAAndRehydrates(t *testing.T) {
	svc := newTestService(nil)
	svc.localSpeechStagingRoot = t.TempDir()
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSeparateContract, "demucs-cpu")})
	payload := canonicalUploadFixture(t)
	binary.LittleEndian.PutUint32(payload[24:28], 44100)
	binary.LittleEndian.PutUint32(payload[28:32], 44100*8)
	if err := svc.runtimeArtifacts.Put("source", runtimeartifact.ArtifactRecord{
		Bytes: payload, MimeType: "audio/wav", SizeBytes: int64(len(payload)),
		Owner:          &runtimeartifact.ArtifactOwner{AppID: "app.local", SubjectUserID: "anonymous"},
		CanonicalAudio: &runtimeartifact.CanonicalAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 2, DataOffset: 56},
	}); err != nil {
		t.Fatal(err)
	}
	ctx := executionintent.WithIntent(scenarioJobUserContext("app.local", "anonymous"), executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSeparateContract, LocalLoadoutRef: "test-loadout:audio.separate", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	head := &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"}
	effective, err := svc.captureLocalSpeechEffectiveInputs(ctx, head, &runtimev1.SubmitScenarioJobRequest{
		Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SEPARATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioSeparate{AudioSeparate: &runtimev1.AudioSeparateScenarioSpec{
			MimeType: "audio/wav", SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source", Range: &runtimev1.AudioFrameRange{StartFrame: 1, EndFrame: 2}},
		}}},
	})
	if err != nil {
		t.Fatalf("capture managed Python separation: %v", err)
	}
	defer cleanupLocalSpeechStagingPaths(effective.stagingPaths)
	persisted, err := cloneLocalResolvedAssembly(effective.resolvedAssembly)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := svc.localSpeechEffectiveInputsFromResolvedAssembly(persisted)
	if err != nil {
		t.Fatalf("rehydrate managed Python separation: %v", err)
	}
	plan := restored.separatePlan
	if plan.IsNative() || plan.SourceInfo().GetFrameCount() != 1 || len(plan.AudioBytes()) != 0 || len(persisted.Request.BinaryInput) != 0 {
		t.Fatal("owned Python source was replaced with native execution or inline bytes")
	}
	captured, err := os.ReadFile(plan.SourcePath())
	if err != nil || len(captured) < 8 || !bytes.Equal(captured[len(captured)-8:], payload[len(payload)-8:]) {
		t.Fatalf("captured frame range changed samples: %v", err)
	}
}

func htdemucsSelectedExecutionForTest(root string) *localexecution.SelectedLocalExecution {
	audioRoot, cudaRoot := filepath.Join(root, "audio-cpp"), filepath.Join(root, "cuda13")
	return &localexecution.SelectedLocalExecution{LoadoutID: "loadout-htdemucs", CapabilityContract: capabilitydriver.AudioSeparateContract, DisplayName: "HTDemucs",
		RecipeID: capabilitydriver.HTDemucsRecipeID, RecipeRevision: "1", PortableConfig: &structpb.Struct{},
		DriverIdentity: (&capabilitydriver.Identity{ImplementationID: capabilitydriver.HTDemucsImplementationID, DriverID: capabilitydriver.HTDemucsDriverID, DriverDialect: capabilitydriver.HTDemucsDriverDialect}).Proto(),
		Requirements: []*runtimev1.LocalCapabilityRequirement{{RequirementId: capabilitydriver.HTDemucsModelRequirementID, Role: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			Presence: runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED}},
		ExactBindings: []localexecution.ExactBinding{{RequirementID: capabilitydriver.HTDemucsModelRequirementID, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
			ModelAssetID: "asset-htdemucs", AbsolutePath: filepath.Join(root, "model", "htdemucs-q8_0.gguf"), BundleDir: filepath.Join(root, "model"), DeclaredFiles: []string{"htdemucs-q8_0.gguf"},
			VerifiedContentID: capabilitydriver.HTDemucsVerifiedContentID, EntrySHA256: capabilitydriver.HTDemucsVerifiedContentID}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "native-engine-package.audio-cpp", DependencyID: "audio.cpp.package", ConsumerScope: "audio.cpp.cuda",
			SelectedSourceRecordID: "selected-audio", CanonicalRoot: audioRoot, Version: "release-" + engine.AudioCppPackageVersion + "@" + engine.AudioCppPackageCommit,
			VerifiedArtifacts: []string{filepath.Join(audioRoot, "audiocpp_cli.exe")}},
			{DependencyFamily: "accelerator.cuda.runtime", DependencyID: capabilitydriver.AudioCppCUDA13RuntimeDependencyID, ConsumerScope: "audio.cpp.cuda",
				SelectedSourceRecordID: "selected-cuda13", CanonicalRoot: cudaRoot, Version: "cuda_major=13"}},
		Configured: true}
}

// The execution goroutine re-plans from the persisted ResolvedAssembly; the
// native owned-source plan must survive that round trip exactly.
func TestNativeSeparationResolvedAssemblyRehydratesCapturedSource(t *testing.T) {
	root := t.TempDir()
	stagingRoot := filepath.Join(root, "speech-staging")
	stagingDir := filepath.Join(stagingRoot, "sep-capture")
	if err := os.MkdirAll(stagingDir, 0o700); err != nil {
		t.Fatal(err)
	}
	selected := htdemucsSelectedExecutionForTest(root)
	packageInput, err := audioCppRuntimePackageInput(selected)
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.AudioSeparateScenarioSpec{MimeType: "audio/wav", IncludeInstrumentParts: true,
		SourceAudio: &runtimev1.MusicAudioInput{ArtifactId: "source-artifact", Range: &runtimev1.AudioFrameRange{StartFrame: 220500, EndFrame: 882000}}}
	info := &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 661500, DurationMs: 15000}
	plan, err := (capabilitydriver.HTDemucsAudioCppDriver{}).PlanAudioSeparateInvocation(capabilitydriver.AudioSeparateInvocationInput{PortableConfig: &structpb.Struct{},
		ExactBindings: projectInvocationExactBindings(selected.ExactBindings), Request: request, Package: packageInput,
		SourcePath: filepath.Join(stagingDir, "source.wav"), SourceInfo: info, StagingDir: stagingDir})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := localResolvedAssemblyForSpeech(selected, nil, nil, plan)
	if err != nil {
		t.Fatal(err)
	}
	if assembly.ProcessIdentity.DriverID != capabilitydriver.HTDemucsDriverID || assembly.ProcessIdentity.ProcessKey == "" || len(assembly.ProcessIdentity.ProcessArgs) == 0 {
		t.Fatalf("native separation process identity = %+v", assembly.ProcessIdentity)
	}
	persisted, err := cloneLocalResolvedAssembly(assembly)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{capabilityDrivers: capabilitydriver.NewProductionRegistry(), localSpeechStagingRoot: stagingRoot}
	effective, err := service.localSpeechEffectiveInputsFromResolvedAssembly(persisted)
	if err != nil {
		t.Fatalf("rehydrate native separation: %v", err)
	}
	rehydrated := effective.separatePlan
	if !rehydrated.IsNative() || rehydrated.SourcePath() != filepath.Join(stagingDir, "source.wav") || rehydrated.SourceInfo().GetFrameCount() != 661500 || !rehydrated.IncludeInstrumentParts() {
		t.Fatalf("rehydrated plan lost the captured native source: native=%v source=%s", rehydrated.IsNative(), rehydrated.SourcePath())
	}
	if got := strings.Join(effective.stagingPaths, "|"); got != strings.Join([]string{filepath.Join(stagingDir, "source.wav"), filepath.Join(stagingDir, "stems"), stagingDir}, "|") {
		t.Fatalf("rehydrated staging cleanup = %s", got)
	}
	escaped, err := cloneLocalResolvedAssembly(persisted)
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "sep-outside")
	escaped.LoadPlan.Speech.SeparationSource.StagingDirectory = outside
	escaped.LoadPlan.Speech.SeparationSource.SourcePath = filepath.Join(outside, "source.wav")
	if _, err := service.localSpeechEffectiveInputsFromResolvedAssembly(escaped); err == nil {
		t.Fatal("captured native separation staging outside the Runtime root was admitted")
	}
}

type separationStemHostForTest struct{ sampleCount int64 }

func (separationStemHostForTest) ExecuteSpeechSynthesis(context.Context, capabilitydriver.SpeechSynthesizePlan, localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	return localexecution.SpeechSynthesisResult{}, nil
}
func (separationStemHostForTest) ExecuteSpeechTranscription(context.Context, capabilitydriver.SpeechTranscribePlan, localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	return localexecution.SpeechTranscriptionResult{}, nil
}
func (separationStemHostForTest) ExecuteVoiceCreate(context.Context, *capabilitydriver.VoiceCreateInvocationPlan, localexecution.SpeechExecutionStartFunc) (localexecution.VoiceCreateResult, error) {
	return localexecution.VoiceCreateResult{}, nil
}
func (h separationStemHostForTest) ExecuteAudioSeparation(context.Context, *capabilitydriver.AudioSeparateInvocationPlan, localexecution.SpeechExecutionStartFunc) (localexecution.AudioSeparationResult, error) {
	body := func() io.ReadCloser { return io.NopCloser(strings.NewReader("stem")) }
	return localexecution.AudioSeparationResult{Vocals: body(), Background: body(), SampleRateHz: 44100, Channels: 2, SampleCount: h.sampleCount,
		Instrument: []localexecution.AudioInstrumentPartBody{{Kind: runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_DRUMS, Body: body()}}}, nil
}

// Stems publish their exact frame count; the floored millisecond duration is
// not a frame coordinate a consumer can reconstruct.
func TestSeparationArtifactsCarryExactStemFrames(t *testing.T) {
	service := &Service{localSpeechHost: separationStemHostForTest{sampleCount: 8451125}}
	artifacts, bodies, _, err := service.executeCapturedAudioSeparation(context.Background(), &localSpeechEffectiveInputs{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer capabilitydriver.CloseArtifactBodies(bodies)
	if len(artifacts) != 3 {
		t.Fatalf("artifacts = %d", len(artifacts))
	}
	for _, artifact := range artifacts {
		if artifact.GetFrameCount() != 8451125 || artifact.GetDurationMs() != 191635 || artifact.GetSampleRateHz() != 44100 || artifact.GetChannels() != 2 {
			t.Fatalf("stem facts are not exact: %+v", artifact)
		}
	}
}
