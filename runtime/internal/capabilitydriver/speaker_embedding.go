package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strconv"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.speaker-representation.sherpa-speaker-encoder
const (
	SpeakerEmbedContract               = "audio.speaker.embed"
	SherpaSpeakerEmbedImplementationID = "local.audio.speaker.embed.sherpa-onnx"
	SherpaSpeakerEmbedDriverID         = "nimi.runtime.driver.sherpa-speaker-encoder"
	SherpaSpeakerEmbedDriverDialect    = "sherpa-onnx/speaker-embed/v1"
	SherpaSpeakerEmbedRecipeID         = "sherpa-speaker-encoder.v1"
	SpeakerEncoderSlot                 = "speaker.encoder"
	SpeakerEncoderConsumerID           = "speech.speaker-encoder.python"
	SpeakerEncoderProtocol             = "nimi-speaker-embed/1"
)

type SherpaSpeakerEmbedDriver struct{}

func (SherpaSpeakerEmbedDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (driver SherpaSpeakerEmbedDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}
func (SherpaSpeakerEmbedDriver) ImplementationSupportedFeatures(recipeID string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipeID != SherpaSpeakerEmbedRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (SherpaSpeakerEmbedDriver) ProjectRecipe(recipeID string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipeID != SherpaSpeakerEmbedRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	constraints, _ := structpb.NewStruct(map[string]any{"format": "onnx", "artifact_role": "speaker_representation_encoder"})
	return []*runtimev1.LocalCapabilityRequirement{{RequirementId: SpeakerEncoderSlot, DisplayLabel: "Speaker representation encoder", ResourceKind: "auxiliary",
		Role:                     runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN,
		Presence:                 runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
		Policy:                   runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE,
		CompatibilityConstraints: constraints}}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (SherpaSpeakerEmbedDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry || input.RequirementID != SpeakerEncoderSlot {
		return nil, fmt.Errorf("speaker encoder requires its exact ONNX entry")
	}
	return probeONNXModel(source, size)
}

func speakerEncoderDimension(probe []byte) (int, bool) {
	var model onnxModel
	if json.Unmarshal(probe, &model) != nil || model.IRVersion == 0 || len(model.Inputs) != 1 || len(model.Outputs) != 1 {
		return 0, false
	}
	metadata := model.Metadata
	if metadata["framework"] != "3d-speaker" || metadata["sample_rate"] != "16000" || metadata["normalize_samples"] != "1" || metadata["feature_normalize_type"] != "global-mean" {
		return 0, false
	}
	dimension, err := strconv.Atoi(metadata["output_dim"])
	if err != nil || dimension < 1 || dimension > 4096 {
		return 0, false
	}
	input, output := model.Inputs[0], model.Outputs[0]
	if input.Type != 1 || output.Type != 1 || len(input.Shape) != 3 || len(output.Shape) != 2 || input.Shape[2] != 80 || output.Shape[1] != int64(dimension) {
		return 0, false
	}
	if (input.Shape[0] != -1 && input.Shape[0] != 1) || (output.Shape[0] != -1 && output.Shape[0] != 1) || input.Shape[1] != -1 {
		return 0, false
	}
	for _, domain := range model.NodeDomains {
		if domain != "" {
			return 0, false
		}
	}
	if len(model.Opsets) != 1 || model.Opsets[""] == 0 {
		return 0, false
	}
	return dimension, true
}

func (driver SherpaSpeakerEmbedDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	dimension, valid := speakerEncoderDimension(input.Entry.FormatProbe)
	if !valid || input.RecipeID != SherpaSpeakerEmbedRecipeID || input.Requirement.GetRequirementId() != SpeakerEncoderSlot {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	projection, reason := validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY, Engine: "speech", Family: "sherpa_speaker_encoder", ArtifactRoles: []string{"speaker_representation_encoder"}, FormatProbe: input.Entry.FormatProbe}, 0, driver.ValidateBinding)
	projection.EmbeddingDimension = dimension
	return projection, reason
}
func (SherpaSpeakerEmbedDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != SpeakerEncoderSlot || binding.GetRequirementId() != SpeakerEncoderSlot {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	if _, valid := speakerEncoderDimension(asset.FormatProbe); !valid || asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY || asset.Engine != "speech" || !contains(asset.ArtifactRoles, "speaker_representation_encoder") {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (driver SherpaSpeakerEmbedDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 1 || len(bindings) != 1 || len(assets) != 1 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	return driver.ValidateBinding(requirements[0], bindings[0], assets[0])
}

type SpeakerEmbeddingInvocationInput struct {
	RecipeID          string
	Request           *runtimev1.AudioSpeakerEmbedScenarioSpec
	Bindings          []InvocationExactBinding
	DependencySources []InvocationExactDependencySource
	AudioBytes        []byte
	MIMEType          string
	Dimension         int
}
type SpeakerEmbeddingInvocationPlan struct {
	Request            *runtimev1.AudioSpeakerEmbedScenarioSpec
	Binding            InvocationExactBinding
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	AudioBytes         []byte
	MIMEType           string
	Dimension          int
}

func (SherpaSpeakerEmbedDriver) PlanSpeakerEmbeddingInvocation(input SpeakerEmbeddingInvocationInput) (*SpeakerEmbeddingInvocationPlan, error) {
	if input.RecipeID != SherpaSpeakerEmbedRecipeID || input.Request == nil || len(input.Bindings) != 1 || input.Bindings[0].RequirementID != SpeakerEncoderSlot || len(input.AudioBytes) == 0 || input.Dimension < 1 || input.Dimension > 4096 {
		return nil, fmt.Errorf("speaker encoding requires its captured model, audio and verified output dimension")
	}
	binding := input.Bindings[0]
	if !filepath.IsAbs(binding.AbsolutePath) || binding.ModelAssetID == "" || binding.VerifiedContentID == "" || binding.EntrySHA256 == "" {
		return nil, fmt.Errorf("speaker encoder binding was not captured")
	}
	var profile *InvocationExactDependencySource
	for index := range input.DependencySources {
		source := &input.DependencySources[index]
		if source.DependencyFamily == "python.package-set" && source.ConsumerScope == SpeakerEncoderConsumerID {
			if profile != nil {
				return nil, fmt.Errorf("speaker encoder dependency capture is ambiguous")
			}
			profile = source
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" || profile.Hashes["profile_digest"] == "" || profile.Hashes["driver_bundle_sha256"] == "" || profile.Version != profile.Hashes["profile_digest"] {
		return nil, fmt.Errorf("speaker encoding requires an exact managed CPU profile")
	}
	return &SpeakerEmbeddingInvocationPlan{Request: proto.Clone(input.Request).(*runtimev1.AudioSpeakerEmbedScenarioSpec), Binding: cloneInvocationExactBindings(input.Bindings)[0], ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], AudioBytes: append([]byte(nil), input.AudioBytes...), MIMEType: input.MIMEType, Dimension: input.Dimension}, nil
}
