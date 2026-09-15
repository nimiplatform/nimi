package capabilitydriver

import (
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.qwen3-transformers-aligned-transcription
const (
	Qwen3ASRAlignedImplementationID = "local.audio.transcribe.qwen3-asr-transformers-aligned"
	Qwen3ASRAlignedDriverID         = "nimi.runtime.driver.qwen3-asr-transformers-aligned"
	Qwen3ASRAlignedDriverDialect    = "qwen3-asr-transformers/aligned-transcribe/v1"
	Qwen3ASRAlignedRecipeID         = "qwen3-asr-transformers-aligned"
	Qwen3ASRAlignerRequirementID    = "stt.aligner"
)

type Qwen3ASRAlignedDriver struct{ Qwen3ASRTransformersDriver }

func (Qwen3ASRAlignedDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != Qwen3ASRAlignedRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (Qwen3ASRAlignedDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	main, reason := interpretQwen3Speech(input, Qwen3ASRModelRequirementID, "stt", "stt_transformers_model", "Speech recognition model")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	aligner, reason := interpretQwen3Speech(input, Qwen3ASRAlignerRequirementID, "auxiliary", "stt_transformers_aligner", "Forced alignment model")
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, reason
	}
	aligner[0].Role = runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
	return append(main, aligner...), reason
}

func (driver Qwen3ASRAlignedDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != Qwen3ASRAlignedRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.Interpret(InterpretInput{PortableConfig: options, SupportedFeatures: features})
}

func alignedASRRole(id string) string {
	switch id {
	case Qwen3ASRModelRequirementID:
		return "stt_transformers_model"
	case Qwen3ASRAlignerRequirementID:
		return "stt_transformers_aligner"
	}
	return ""
}

func alignedASRKind(id string) runtimev1.LocalAssetKind {
	if id == Qwen3ASRAlignerRequirementID {
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY
	}
	return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_STT
}

func (driver Qwen3ASRAlignedDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	id := input.Requirement.GetRequirementId()
	return projectQwen3SpeechModelAsset(input, id, alignedASRKind(id), alignedASRRole(id), driver.ValidateBinding)
}

func (Qwen3ASRAlignedDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	id := requirement.GetRequirementId()
	if alignedASRRole(id) == "" {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return validateQwen3SpeechBinding(requirement, binding, asset, id, alignedASRKind(id), alignedASRRole(id))
}

func (driver Qwen3ASRAlignedDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 2 || len(bindings) != 2 || len(assets) != 2 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
	}
	seen := map[string]bool{}
	for _, requirement := range requirements {
		id := requirement.GetRequirementId()
		if seen[id] || alignedASRRole(id) == "" {
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

func (Qwen3ASRAlignedDriver) PlanSpeechTranscribeInvocation(input SpeechTranscribeInvocationInput) (*SpeechTranscribeInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) || len(input.ExactBindings) != 2 {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("aligned transcription requires its two captured model bindings"))
	}
	ordered := make([]InvocationExactBinding, 0, 2)
	for _, id := range []string{Qwen3ASRModelRequirementID, Qwen3ASRAlignerRequirementID} {
		var selected []InvocationExactBinding
		for _, binding := range input.ExactBindings {
			if binding.RequirementID == id {
				selected = append(selected, binding)
			}
		}
		binding, err := exactQwen3SpeechBinding(selected, id)
		if err != nil {
			return nil, invocationError(InvocationFailureInvalidBinding, err)
		}
		ordered = append(ordered, binding)
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.SpeechTranscribeScenarioSpec)
	if request == nil || len(input.AudioBytes) == 0 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("aligned transcription requires audio"))
	}
	format := strings.ToLower(strings.TrimSpace(request.GetResponseFormat()))
	if (format != "" && format != "text" && format != "json") || request.GetDiarization() || request.GetSpeakerCount() != 0 || strings.TrimSpace(request.GetPrompt()) != "" {
		return nil, invocationError(InvocationFailureUnsupported, fmt.Errorf("aligned transcription options are unsupported"))
	}
	return &SpeechTranscribeInvocationPlan{driverID: Qwen3ASRAlignedDriverID, modelAssetID: ordered[0].ModelAssetID, modelFiles: ordered, request: request, audioBytes: append([]byte(nil), input.AudioBytes...), mimeType: strings.TrimSpace(input.MIMEType)}, nil
}
