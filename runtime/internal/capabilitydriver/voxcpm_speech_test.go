package capabilitydriver

import (
	"fmt"
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
	constraints := requirements[0].GetCompatibilityConstraints().AsMap()
	if constraints["driver_backend"] != VoxCPMBackendStandard ||
		fmt.Sprint(constraints["required_files"]) != "[config.json tokenizer.json tokenizer_config.json]" ||
		fmt.Sprint(constraints["audio_vae_files"]) != "[audiovae.safetensors audiovae.pth]" {
		t.Fatalf("VoxCPM bundle layout contract = %#v", constraints)
	}
	mlxRequirements, reason := (VoxCPMDriver{}).ProjectRecipeForBackend(VoxCPMRecipeID, nil, nil, VoxCPMBackendMLX)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(mlxRequirements) != 1 {
		t.Fatalf("MLX projection reason=%v requirements=%+v", reason, mlxRequirements)
	}
	mlxConstraints := mlxRequirements[0].GetCompatibilityConstraints().AsMap()
	if mlxConstraints["driver_backend"] != VoxCPMBackendMLX || mlxConstraints["tensor_contract"] != "voxcpm2-mlx-bundle-v1" ||
		fmt.Sprint(mlxConstraints["forbidden_files"]) != "[audiovae.safetensors audiovae.pth tokenization_voxcpm2.py]" {
		t.Fatalf("VoxCPM MLX bundle layout contract = %#v", mlxConstraints)
	}
	digest := strings.Repeat("a", 64)
	binding := &runtimev1.ModelAssetExactBinding{RequirementId: VoxCPMModelRequirementID, ModelAssetId: "asset", VerifiedContentId: "sha256:" + digest, EntrySha256: digest}
	asset := ModelAssetDescriptor{ModelAssetID: "asset", VerifiedContentID: binding.GetVerifiedContentId(), EntrySHA256: digest, Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, Family: VoxCPMFamily, Engine: "speech", ArtifactRoles: []string{VoxCPMModelArtifactRole}}
	if reason := driver.ValidateBinding(requirements[0], binding, asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		t.Fatalf("ValidateBinding reason=%v", reason)
	}
	probe := safetensorsProbeForTest([]byte(`{
		"base_lm.embed_tokens.weight":{"dtype":"F16","shape":[73448,2048],"data_offsets":[0,2]},
		"feat_encoder.in_proj.weight":{"dtype":"F16","shape":[1024,64],"data_offsets":[2,4]},
		"fsq_layer.in_proj.weight":{"dtype":"F16","shape":[512,2048],"data_offsets":[4,6]},
		"stop_head.weight":{"dtype":"F16","shape":[2,2048],"data_offsets":[6,8]}
	}`))
	projection, reason := driver.ProjectModelAssetBinding(ModelAssetBindingInput{
		RecipeID: VoxCPMRecipeID, Requirement: requirements[0], Binding: binding,
		Entry: ModelAssetFileFact{RelativePath: "model.safetensors", SizeBytes: 8, FormatProbe: probe},
		Files: []ModelAssetFileFact{
			{RelativePath: "model.safetensors", SizeBytes: 8, FormatProbe: probe},
			{RelativePath: "config.json", SizeBytes: 30, FormatProbe: []byte(`{"architecture":"voxcpm2"}`)},
			{RelativePath: "tokenizer.json", SizeBytes: 2, FormatProbe: []byte(`{}`)},
			{RelativePath: "tokenizer_config.json", SizeBytes: 2, FormatProbe: []byte(`{}`)},
			{RelativePath: "audiovae.safetensors", SizeBytes: 1, FormatProbe: []byte{0}},
		},
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || projection.Descriptor.Family != VoxCPMFamily {
		t.Fatalf("ProjectModelAssetBinding reason=%v projection=%+v", reason, projection)
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
		ModelAssetID:      "local.tts.voxcpm2.standard.cpu",
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
	if err != nil || plan == nil || plan.DriverID() != VoxCPMDriverID || plan.ModelAssetID() != binding.ModelAssetID || plan.Request().GetText() != "hello" {
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
