package capabilitydriver

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r112
const (
	VoxCPMFamily             = "voxcpm"
	VoxCPMImplementationID   = "local.audio.synthesize.voxcpm"
	VoxCPMDriverID           = "nimi.runtime.driver.voxcpm"
	VoxCPMDriverDialect      = "voxcpm/audio-synthesize/v1"
	VoxCPMModelRequirementID = "tts.model"
	VoxCPMModelArtifactRole  = "tts_model"
)

// VoxCPMDriver owns the one public VoxCPM synthesis dialect. Runtime-private
// Host composition selects the standard or MLX backend after this exact plan
// has fixed the capability, Driver identity, model binding, and request.
type VoxCPMDriver struct{}

func (VoxCPMDriver) EffectiveRequestDefaults(*structpb.Struct) map[string]string { return nil }

func (VoxCPMDriver) SpeechStreamMode() SpeechStreamMode { return SpeechStreamSimulated }

func (VoxCPMDriver) ListPresetVoices(bindings []InvocationExactBinding) ([]SpeechPresetVoice, error) {
	if _, err := exactQwen3SpeechBinding(bindings, VoxCPMModelRequirementID); err != nil {
		return nil, invocationError(InvocationFailureInvalidConfig, err)
	}
	return []SpeechPresetVoice{{VoiceID: "default", Name: "Default"}}, nil
}

func (VoxCPMDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	constraints, _ := structpb.NewStruct(map[string]any{
		"engine":        "speech",
		"family":        VoxCPMFamily,
		"artifact_role": VoxCPMModelArtifactRole,
	})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId:            VoxCPMModelRequirementID,
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		ResourceKind:             "tts",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		DisplayLabel:             "VoxCPM synthesis model",
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (VoxCPMDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.LocalAssetExactBinding, asset AssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement == nil || binding == nil || requirement.GetRequirementId() != VoxCPMModelRequirementID || binding.GetRequirementId() != VoxCPMModelRequirementID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetLocalAssetId() == "" || asset.LocalAssetID == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || asset.VerifiedContentID == "" || asset.EntrySHA256 == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED
	}
	if binding.GetLocalAssetId() != asset.LocalAssetID || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS || asset.Engine != "speech" || asset.Family != VoxCPMFamily || !contains(asset.ArtifactRoles, VoxCPMModelArtifactRole) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver VoxCPMDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding, assets []AssetDescriptor) runtimev1.LocalCapabilityReason {
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
		modelAssetID: binding.AssetID,
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
