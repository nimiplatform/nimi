package capabilitydriver

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.demucs-local-separation
const (
	AudioSeparateContract    = "audio.separate"
	DemucsImplementationID   = "local.audio.separate.demucs"
	DemucsDriverID           = "nimi.runtime.driver.demucs"
	DemucsDriverDialect      = "demucs/audio-separate/v1"
	DemucsRecipeID           = "demucs-vocals-background"
	DemucsModelRequirementID = "separation.model"
	DemucsArtifactRole       = "audio_separation_model"
)

type AudioSeparateInvocationInput struct {
	PortableConfig *structpb.Struct
	ExactBindings  []InvocationExactBinding
	Request        *runtimev1.AudioSeparateScenarioSpec
	AudioBytes     []byte
	MIMEType       string
}

type AudioSeparateInvocationPlan struct {
	modelFiles []InvocationExactBinding
	request    *runtimev1.AudioSeparateScenarioSpec
	audioBytes []byte
	mimeType   string
}

func (p *AudioSeparateInvocationPlan) DriverID() string { return DemucsDriverID }
func (p *AudioSeparateInvocationPlan) ModelAssetID() string {
	if p == nil || len(p.modelFiles) != 1 {
		return ""
	}
	return p.modelFiles[0].ModelAssetID
}
func (p *AudioSeparateInvocationPlan) ModelFiles() []InvocationExactBinding {
	if p == nil {
		return nil
	}
	return cloneSpeechInvocationBindings(p.modelFiles)
}
func (p *AudioSeparateInvocationPlan) Request() *runtimev1.AudioSeparateScenarioSpec {
	if p == nil {
		return nil
	}
	cloned, _ := proto.Clone(p.request).(*runtimev1.AudioSeparateScenarioSpec)
	return cloned
}
func (p *AudioSeparateInvocationPlan) AudioBytes() []byte {
	if p == nil {
		return nil
	}
	return append([]byte(nil), p.audioBytes...)
}
func (p *AudioSeparateInvocationPlan) MIMEType() string {
	if p == nil {
		return ""
	}
	return p.mimeType
}

type AudioSeparateInvocationDriver interface {
	RecipeDriver
	PlanAudioSeparateInvocation(AudioSeparateInvocationInput) (*AudioSeparateInvocationPlan, error)
}

type DemucsDriver struct{}

func (DemucsDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string { return nil }

func (DemucsDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != DemucsRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (DemucsDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if len(input.SupportedFeatures) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	constraints, _ := structpb.NewStruct(map[string]any{"engine": "speech", "format": "pytorch", "artifact_role": DemucsArtifactRole})
	return []*runtimev1.LocalCapabilityRequirement{{
		RequirementId:            DemucsModelRequirementID,
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		ResourceKind:             "music",
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints,
		DisplayLabel:             "Source separation model",
	}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver DemucsDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != DemucsRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	return driver.Interpret(InterpretInput{PortableConfig: options, SupportedFeatures: features})
}

func (driver DemucsDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.Requirement.GetRequirementId() != DemucsModelRequirementID ||
		filepath.Ext(strings.ToLower(input.Entry.RelativePath)) != ".th" || !bytes.HasPrefix(input.Entry.FormatProbe, []byte{'P', 'K', 3, 4}) {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{
		Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, Engine: "speech", ArtifactRoles: []string{DemucsArtifactRole}, FormatProbe: input.Entry.FormatProbe,
	}, 0, driver.ValidateBinding)
}

func (DemucsDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechBinding(requirement, binding, asset, DemucsModelRequirementID, runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_MUSIC, DemucsArtifactRole)
}

func (driver DemucsDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	return validateQwen3SpeechCombination(requirements, bindings, assets, driver.ValidateBinding)
}

func (DemucsDriver) PlanAudioSeparateInvocation(input AudioSeparateInvocationInput) (*AudioSeparateInvocationPlan, error) {
	if !emptySpeechPortableConfig(input.PortableConfig) {
		return nil, invocationError(InvocationFailureInvalidConfig, fmt.Errorf("Demucs separation does not admit portable options"))
	}
	binding, err := exactQwen3SpeechBinding(input.ExactBindings, DemucsModelRequirementID)
	if err != nil {
		return nil, invocationError(InvocationFailureInvalidBinding, err)
	}
	if input.Request == nil || len(input.AudioBytes) == 0 || len(input.AudioBytes) > 32<<20 {
		return nil, invocationError(InvocationFailureInvalidRequest, fmt.Errorf("audio separation requires bounded source audio"))
	}
	request, _ := proto.Clone(input.Request).(*runtimev1.AudioSeparateScenarioSpec)
	request.AudioSource = nil
	return &AudioSeparateInvocationPlan{modelFiles: []InvocationExactBinding{binding}, request: request, audioBytes: append([]byte(nil), input.AudioBytes...), mimeType: strings.TrimSpace(input.MIMEType)}, nil
}
