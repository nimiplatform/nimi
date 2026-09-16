package capabilitydriver

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.qwen3-reference-voice-library
const (
	Qwen3VoiceLibraryImplementationID    = "local.voice.create.qwen3-tts-library"
	Qwen3VoiceLibraryDriverDialect       = "qwen3-tts/voice-library/v1"
	Qwen3VoiceLibraryRecipeID            = "qwen3-local-voice-library"
	Qwen3VoiceLibraryBaseRequirementID   = "voice.base"
	Qwen3VoiceLibraryDesignRequirementID = "voice.design"
)

type Qwen3VoiceLibraryDriver struct{ Qwen3VoiceCreateDriver }

func (Qwen3VoiceLibraryDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != Qwen3VoiceLibraryRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return []string{"input.audio", "input.text"}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func voiceLibraryFeatures(features []string) bool {
	return len(features) == 2 && contains(features, "input.audio") && contains(features, "input.text")
}

func (Qwen3VoiceLibraryDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if !voiceLibraryFeatures(input.SupportedFeatures) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	plain := InterpretInput{PortableConfig: input.PortableConfig}
	base, reason := interpretQwen3Speech(plain, Qwen3VoiceLibraryBaseRequirementID, "tts", Qwen3VoiceCloneArtifactRole, "Reference synthesis model")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	design, reason := interpretQwen3Speech(plain, Qwen3VoiceLibraryDesignRequirementID, "tts", Qwen3VoiceDesignArtifactRole, "Voice design model")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	design[0].Role = runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
	return append(base, design...), reason
}

func (driver Qwen3VoiceLibraryDriver) ProjectRecipe(id string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if id != Qwen3VoiceLibraryRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.Interpret(InterpretInput{PortableConfig: options, SupportedFeatures: features})
}

func voiceLibraryRole(id string) string {
	switch id {
	case Qwen3VoiceLibraryBaseRequirementID:
		return Qwen3VoiceCloneArtifactRole
	case Qwen3VoiceLibraryDesignRequirementID:
		return Qwen3VoiceDesignArtifactRole
	default:
		return ""
	}
}

func (driver Qwen3VoiceLibraryDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	id := input.Requirement.GetRequirementId()
	return projectQwen3SpeechModelAsset(input, id, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, voiceLibraryRole(id), driver.ValidateBinding)
}

func (Qwen3VoiceLibraryDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	id := requirement.GetRequirementId()
	if voiceLibraryRole(id) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return validateQwen3SpeechBinding(requirement, binding, asset, id, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_TTS, voiceLibraryRole(id))
}

func (driver Qwen3VoiceLibraryDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 2 || len(bindings) != 2 || len(assets) != 2 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	seen := map[string]bool{}
	for _, requirement := range requirements {
		id := requirement.GetRequirementId()
		if seen[id] || voiceLibraryRole(id) == "" {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[id] = true
		var binding *runtimev1.ModelAssetExactBinding
		for _, candidate := range bindings {
			if candidate.GetRequirementId() == id {
				if binding != nil {
					return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
				}
				binding = candidate
			}
		}
		if binding == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
		}
		var asset *ModelAssetDescriptor
		for i := range assets {
			if assets[i].ModelAssetID == binding.GetModelAssetId() {
				if asset != nil {
					return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
				}
				asset = &assets[i]
			}
		}
		if asset == nil {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
		}
		if reason := driver.ValidateBinding(requirement, binding, *asset); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (Qwen3VoiceLibraryDriver) PlanVoiceCreateInvocation(input VoiceCreateInvocationInput) (*VoiceCreateInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) || !voiceLibraryFeatures(input.SupportedFeatures) || len(input.ExactBindings) != 2 {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("voice library requires both captured models and source features"))
	}
	ordered := make([]InvocationExactBinding, 0, 2)
	for _, id := range []string{Qwen3VoiceLibraryBaseRequirementID, Qwen3VoiceLibraryDesignRequirementID} {
		var matches []InvocationExactBinding
		for _, binding := range input.ExactBindings {
			if binding.RequirementID == id {
				matches = append(matches, binding)
			}
		}
		binding, err := exactQwen3SpeechBinding(matches, id)
		if err != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, err)
		}
		ordered = append(ordered, binding)
	}
	request, feature, err := validateQwen3VoiceCreateRequest(input.Request)
	if err != nil {
		return nil, err
	}
	if feature == "input.text" && strings.TrimSpace(request.GetTextDescription().GetPreviewText()) == "" {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("voice library design requires preview text to create its reference"))
	}
	return &VoiceCreateInvocationPlan{driverID: Qwen3TTSDriverID, modelAssetID: ordered[0].ModelAssetID, modelFiles: ordered, request: request, sourceFeature: feature, workflowModelID: Qwen3VoiceLibraryRecipeID}, nil
}
