package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r112
// @nimi-authority: rule.nimi.runtime.local-compute.r106
const (
	VoxCPMFamily             = "voxcpm"
	VoxCPMImplementationID   = "local.audio.synthesize.voxcpm"
	VoxCPMDriverID           = "nimi.runtime.driver.voxcpm"
	VoxCPMDriverDialect      = "voxcpm/audio-synthesize/v1"
	VoxCPMModelRequirementID = "tts.model"
	VoxCPMModelArtifactRole  = "tts_model"
	VoxCPMRecipeID           = "voxcpm2"
	VoxCPMBackendStandard    = "standard"
	VoxCPMBackendMLX         = "mlx"
)

// VoxCPMDriver owns the one public VoxCPM synthesis dialect. Runtime-private
// Host composition selects the standard or MLX backend after this exact plan
// has fixed the capability, Driver identity, model binding, and request.
type VoxCPMDriver struct{}

func (VoxCPMDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if strings.TrimSpace(recipeID) != VoxCPMRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (VoxCPMDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string { return nil }

func (VoxCPMDriver) SpeechStreamMode() SpeechStreamMode { return SpeechStreamSimulated }

func (VoxCPMDriver) ListPresetVoices(bindings []InvocationExactBinding) ([]SpeechPresetVoice, error) {
	if _, err := exactQwen3SpeechBinding(bindings, VoxCPMModelRequirementID); err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	return []SpeechPresetVoice{{VoiceID: "default", Name: "Default"}}, nil
}

func (driver VoxCPMDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.interpretForBackend(input, VoxCPMBackendStandard)
}

func (VoxCPMDriver) interpretForBackend(input InterpretInput, backend string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	values := map[string]any{
		"engine":         "speech",
		"family":         VoxCPMFamily,
		"format":         "safetensors",
		"architecture":   "voxcpm2",
		"artifact_role":  VoxCPMModelArtifactRole,
		"driver_backend": backend,
		"required_files": []any{"config.json", "tokenizer.json", "tokenizer_config.json"},
	}
	switch backend {
	case VoxCPMBackendStandard:
		values["tensor_contract"] = "voxcpm2-main-v1"
		values["audio_vae_files"] = []any{"audiovae.safetensors", "audiovae.pth"}
	case VoxCPMBackendMLX:
		values["tensor_contract"] = "voxcpm2-mlx-bundle-v1"
		values["forbidden_files"] = []any{"audiovae.safetensors", "audiovae.pth", "tokenization_voxcpm2.py"}
	default:
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	constraints, _ := structpb.NewStruct(values)
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId:            VoxCPMModelRequirementID,
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:             "tts",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		DisplayLabel:             "VoxCPM synthesis model",
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver VoxCPMDriver) ProjectRecipe(recipeID string, options *structpb.Struct, supportedFeatures []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.projectRecipeForBackend(recipeID, options, supportedFeatures, VoxCPMBackendStandard)
}

func (driver VoxCPMDriver) ProjectRecipeForHost(recipeID string, options *structpb.Struct, supportedFeatures []string, platformTuple string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	backend, ok := voxCPMBackendForPlatform(platformTuple)
	if !ok {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return driver.projectRecipeForBackend(recipeID, options, supportedFeatures, backend)
}

func (driver VoxCPMDriver) projectRecipeForBackend(recipeID string, options *structpb.Struct, supportedFeatures []string, backend string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != VoxCPMRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.interpretForBackend(InterpretInput{PortableConfig: options, SupportedFeatures: supportedFeatures}, backend)
}

func voxCPMBackendForPlatform(platformTuple string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(platformTuple)) {
	case "windows/amd64":
		return VoxCPMBackendStandard, true
	case "darwin/arm64":
		return VoxCPMBackendMLX, true
	default:
		return "", false
	}
}

func (driver VoxCPMDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement == nil || input.Requirement.GetRequirementId() != VoxCPMModelRequirementID || input.Requirement.GetCompatibilityConstraints() == nil ||
		filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".safetensors" {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	tensors, ok := safetensorsTensorFacts(input.Entry.FormatProbe)
	if !ok {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	constraints := input.Requirement.GetCompatibilityConstraints().GetFields()
	required, ok := modelAssetRequirementStrings(input.Requirement, "required_files")
	if !ok || constraints["architecture"].GetStringValue() != "voxcpm2" {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	for _, relativePath := range required {
		if _, exists := modelAssetFileFact(input, relativePath); !exists {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	}
	config, exists := modelAssetFileFact(input, "config.json")
	if !exists || !voxcpm2ConfigProbeValid(config.FormatProbe) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	switch constraints["driver_backend"].GetStringValue() {
	case VoxCPMBackendStandard:
		audioVAEFiles, valid := modelAssetRequirementStrings(input.Requirement, "audio_vae_files")
		if !valid || constraints["tensor_contract"].GetStringValue() != "voxcpm2-main-v1" || !modelAssetDeclaresAnyFileFact(input, audioVAEFiles) || !voxcpm2MainTensorFacts(tensors) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	case VoxCPMBackendMLX:
		forbidden, valid := modelAssetRequirementStrings(input.Requirement, "forbidden_files")
		if !valid || constraints["tensor_contract"].GetStringValue() != "voxcpm2-mlx-bundle-v1" || modelAssetDeclaresAnyFileFact(input, forbidden) {
			return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
		}
	default:
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, Engine: "speech", Family: VoxCPMFamily,
		ArtifactRoles: []string{VoxCPMModelArtifactRole}, FormatProbe: input.Entry.FormatProbe,
	}, 0, driver.ValidateBinding)
}

func modelAssetRequirementStrings(requirement *runtimev1.LocalCapabilityRequirement, key string) ([]string, bool) {
	if requirement == nil || requirement.GetCompatibilityConstraints() == nil {
		return nil, false
	}
	value := requirement.GetCompatibilityConstraints().GetFields()[key]
	if value == nil || value.GetListValue() == nil || len(value.GetListValue().GetValues()) == 0 {
		return nil, false
	}
	result := make([]string, 0, len(value.GetListValue().GetValues()))
	for _, item := range value.GetListValue().GetValues() {
		text := item.GetStringValue()
		if strings.TrimSpace(text) == "" || text != strings.TrimSpace(text) {
			return nil, false
		}
		result = append(result, text)
	}
	return result, true
}

func modelAssetDeclaresAnyFileFact(input ModelAssetBindingInput, relativePaths []string) bool {
	for _, relativePath := range relativePaths {
		if _, exists := modelAssetFileFact(input, relativePath); exists {
			return true
		}
	}
	return false
}

func voxcpm2ConfigProbeValid(probe []byte) bool {
	var config struct {
		Architecture string `json:"architecture"`
	}
	return json.Unmarshal(probe, &config) == nil && config.Architecture == "voxcpm2"
}

func voxcpm2MainTensorFacts(tensors map[string]safetensorsTensorFact) bool {
	want := map[string][]int64{
		"base_lm.embed_tokens.weight": {73448, 2048},
		"feat_encoder.in_proj.weight": {1024, 64},
		"fsq_layer.in_proj.weight":    {512, 2048},
		"stop_head.weight":            {2, 2048},
	}
	for name, shape := range want {
		tensor, ok := tensors[name]
		if !ok || !int64SlicesEqual(tensor.Shape, shape) {
			return false
		}
	}
	return true
}

func (VoxCPMDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != VoxCPMModelRequirementID || binding.GetRequirementId() != VoxCPMModelRequirementID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || asset.ModelAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetModelAssetId() != asset.ModelAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || asset.Engine != "speech" || asset.Family != VoxCPMFamily || !contains(asset.ArtifactRoles, VoxCPMModelArtifactRole) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver VoxCPMDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (VoxCPMDriver) PlanSpeechSynthesizeInvocation(input SpeechSynthesizeInvocationInput) (*SpeechSynthesizeInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("voxcpm portable config must be empty"))
	}
	binding, err := exactQwen3SpeechBinding(input.ExactBindings, VoxCPMModelRequirementID)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	request, err := validateVoxCPMSynthesizeRequest(input.Request)
	if err != nil {
		return nil, err
	}
	return &SpeechSynthesizeInvocationPlan{
		driverID:     VoxCPMDriverID,
		modelAssetID: binding.ModelAssetID,
		modelFiles:   []InvocationExactBinding{binding},
		request:      request,
	}, nil
}

func validateVoxCPMSynthesizeRequest(value *runtimev1.SpeechSynthesizeScenarioSpec) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	request, _ := proto.Clone(value).(*runtimev1.SpeechSynthesizeScenarioSpec)
	if request == nil || strings.TrimSpace(request.GetText()) == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("voxcpm text is required"))
	}
	format := strings.ToLower(strings.TrimSpace(request.GetAudioFormat()))
	if format != "" && format != "wav" && format != "wave" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("voxcpm supports only wav output"))
	}
	if strings.TrimSpace(request.GetLanguage()) != "" || strings.TrimSpace(request.GetEmotion()) != "" ||
		request.SampleRateHz != nil || request.Speed != nil || request.Pitch != nil || request.Volume != nil ||
		(request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_UNSPECIFIED && request.GetTimingMode() != runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE) ||
		request.GetVoiceRenderHints() != nil {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("voxcpm request contains unsupported synthesis options"))
	}
	if reference := request.GetVoiceRef(); reference != nil {
		switch reference.GetKind() {
		case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED:
		case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
			if strings.TrimSpace(reference.GetPresetVoiceId()) != "default" {
				return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("voxcpm first release supports only the default synthesis voice"))
			}
		default:
			return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("voxcpm voice reference kind is unsupported"))
		}
	}
	return request, nil
}
