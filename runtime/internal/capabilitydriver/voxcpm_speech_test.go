package capabilitydriver

import (
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestVoxCPMProductionRegistryExposesOneSynthesisDriver(t *testing.T) {
	identity := Identity{ImplementationID: VoxCPMImplementationID, DriverID: VoxCPMDriverID, DriverDialect: VoxCPMDriverDialect}
	driver, reason := NewProductionRegistry().Resolve(AudioSynthesizeContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		t.Fatalf("Resolve reason=%v driver=%T", reason, driver)
	}
	if _, reason := NewProductionRegistry().Resolve(VoiceCreateContract, identity); reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatal("VoxCPM first release exposed voice.create")
	}
	if _, ok := driver.(SpeechSynthesizeInvocationDriver); !ok {
		t.Fatalf("VoxCPM production driver does not implement speech synthesis invocation: %T", driver)
	}
	requirements, reason := driver.Interpret(InterpretInput{})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 || requirements[0].GetRequirementId() != VoxCPMModelRequirementID {
		t.Fatalf("Interpret reason=%v requirements=%+v", reason, requirements)
	}
	digest := strings.Repeat("a", 64)
	binding := &runtimev1.LocalAssetExactBinding{RequirementId: VoxCPMModelRequirementID, LocalAssetId: "asset", VerifiedContentId: "sha256:" + digest, EntrySha256: digest}
	asset := AssetDescriptor{LocalAssetID: "asset", VerifiedContentID: binding.GetVerifiedContentId(), EntrySHA256: digest, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, Family: VoxCPMFamily, Engine: "speech", ArtifactRoles: []string{VoxCPMModelArtifactRole}}
	if reason := driver.ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("ValidateBinding reason=%v", reason)
	}
	asset.Family = "voxcpm-mlx"
	if reason := driver.ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE {
		t.Fatalf("backend-shaped family reason=%v", reason)
	}
}

func TestVoxCPMPlanAdmitsOnlyDefaultWAVSynthesis(t *testing.T) {
	digest := strings.Repeat("b", 64)
	binding := InvocationExactBinding{
		RequirementID:     VoxCPMModelRequirementID,
		AssetID:           "local.tts.voxcpm2.standard.cpu",
		LocalAssetID:      "voxcpm-asset",
		AbsolutePath:      filepath.Join(t.TempDir(), "model.safetensors"),
		VerifiedContentID: "sha256:" + digest,
		EntrySHA256:       digest,
	}
	plan, err := (VoxCPMDriver{}).PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput{
		ExactBindings: []InvocationExactBinding{binding},
		Request: &runtimev1.SpeechSynthesizeScenarioSpec{
			Text:        "hello",
			AudioFormat: "wav",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
				Reference: &runtimev1.VoiceReference_PresetVoiceId{
					PresetVoiceId: "default",
				},
			},
		},
	})
	if err != nil || plan == nil || plan.DriverID() != VoxCPMDriverID || plan.ModelAssetID() != binding.AssetID || plan.Request().GetText() != "hello" {
		t.Fatalf("plan=%+v error=%v", plan, err)
	}
	if mode := (VoxCPMDriver{}).SpeechStreamMode(); mode != SpeechStreamSimulated {
		t.Fatalf("VoxCPM stream mode=%q", mode)
	}
	voices, err := (VoxCPMDriver{}).ListPresetVoices([]InvocationExactBinding{binding})
	if err != nil || len(voices) != 1 || voices[0].VoiceID != "default" {
		t.Fatalf("VoxCPM preset voices=%+v error=%v", voices, err)
	}

	unsupported := []*runtimev1.SpeechSynthesizeScenarioSpec{
		{Text: "hello", AudioFormat: "mp3"},
		{Text: "hello", Language: "en"},
		{Text: "hello", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "clone"}}},
	}
	for _, request := range unsupported {
		if _, err := (VoxCPMDriver{}).PlanSpeechSynthesizeInvocation(SpeechSynthesizeInvocationInput{ExactBindings: []InvocationExactBinding{binding}, Request: request}); err == nil {
			t.Fatalf("unsupported VoxCPM request admitted: %+v", request)
		}
	}
}
