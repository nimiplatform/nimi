package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-input
// @nimi-authority: rule.nimi.runtime.local-compute.face-swap-driver
const (
	ImageFaceSwapContract       = "image.face_swap"
	InsightFaceImplementationID = "local.image.face-swap.insightface"
	InsightFaceDriverID         = "nimi.runtime.driver.insightface"
	InsightFaceDriverDialect    = "insightface/image-face-swap/v1"
	InsightFaceRecipeID         = "insightface.image-face-swap.v1"
	InsightFaceConsumerID       = "media.face-swap.insightface.python"
	InsightFaceProtocol         = "nimi-image-face-swap/1"
	FaceDetectorSlot            = "detector.onnx"
	FaceRecognizerSlot          = "recognizer.onnx"
	FaceSwapperSlot             = "swapper.onnx"
)

type InsightFaceImageDriver struct{}

func (InsightFaceImageDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}

func (InsightFaceImageDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != InsightFaceRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver InsightFaceImageDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (InsightFaceImageDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != InsightFaceRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return insightFaceModelRequirements(InsightFaceDriverDialect), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func insightFaceModelRequirements(dialect string) []*runtimev1.LocalCapabilityRequirement {
	var requirements []*runtimev1.LocalCapabilityRequirement
	for _, slot := range []struct{ id, label string }{{FaceDetectorSlot, "Face detector"}, {FaceRecognizerSlot, "Face identity encoder"}, {FaceSwapperSlot, "Face replacement model"}} {
		constraints, _ := structpb.NewStruct(map[string]any{"format": "onnx", "model_contract": slot.id, "driver_dialect": dialect})
		role := runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION
		if slot.id == FaceSwapperSlot {
			role = runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN
		}
		requirements = append(requirements, &runtimev1.LocalCapabilityRequirement{RequirementId: slot.id, Role: role,
			Presence:     runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED,
			ResourceKind: "vision", DisplayLabel: slot.label, Policy: runtimev1.LocalCapabilityRequirementPolicy_LOCAL_CAPABILITY_REQUIREMENT_POLICY_SUBSTITUTABLE, CompatibilityConstraints: constraints})
	}
	return requirements
}

func (InsightFaceImageDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if input.RecipeID != InsightFaceRecipeID || filepath.Ext(input.RelativePath) != ".onnx" {
		return nil, fmt.Errorf("face replacement requires an ONNX model entry")
	}
	return probeONNXModel(source, size)
}

func (driver InsightFaceImageDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if input.RecipeID != InsightFaceRecipeID || filepath.Ext(input.Entry.RelativePath) != ".onnx" {
		return ModelAssetBindingProjection{}, invalid
	}
	var model onnxModel
	if json.Unmarshal(input.Entry.FormatProbe, &model) != nil || !faceModelInterface(input.Requirement.GetRequirementId(), model) {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(input, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: "insightface", ArtifactRoles: []string{input.Requirement.GetRequirementId()}, FormatProbe: input.Entry.FormatProbe}, 0, driver.ValidateBinding)
}

func faceTensorShape(tensor onnxTensor, shape ...int64) bool {
	if tensor.Type != 1 || len(tensor.Shape) != len(shape) {
		return false
	}
	for index, dimension := range shape {
		if dimension != -1 && tensor.Shape[index] != dimension {
			return false
		}
	}
	return true
}

func faceModelInterface(slot string, model onnxModel) bool {
	if model.IRVersion != 6 {
		return false
	}
	switch slot {
	case FaceDetectorSlot:
		if len(model.Inputs) != 1 || !faceTensorShape(model.Inputs[0], 1, 3, -1, -1) || len(model.Outputs) != 9 {
			return false
		}
		for index, output := range model.Outputs {
			width := []int64{1, 4, 10}[index/3]
			if !faceTensorShape(output, -1, width) {
				return false
			}
		}
		return true
	case FaceRecognizerSlot:
		return len(model.Inputs) == 1 && faceTensorShape(model.Inputs[0], -1, 3, 112, 112) && (model.Inputs[0].Shape[0] == 1 || model.Inputs[0].Shape[0] == -1) && len(model.Outputs) == 1 && faceTensorShape(model.Outputs[0], 1, 512)
	case FaceSwapperSlot:
		return len(model.Inputs) == 2 && model.Inputs[0].Name == "target" && model.Inputs[1].Name == "source" &&
			faceTensorShape(model.Inputs[0], 1, 3, 128, 128) && faceTensorShape(model.Inputs[1], 1, 512) && len(model.Outputs) == 1 && faceTensorShape(model.Outputs[0], 1, 3, 128, 128)
	}
	return false
}

func (InsightFaceImageDriver) ValidateBinding(requirement *runtimev1.LocalCapabilityRequirement, binding *runtimev1.ModelAssetExactBinding, asset ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if requirement.GetRequirementId() != binding.GetRequirementId() {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	if binding.GetModelAssetId() == "" || binding.GetModelAssetId() != asset.ModelAssetID {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND
	}
	if binding.GetVerifiedContentId() == "" || binding.GetEntrySha256() == "" || binding.GetVerifiedContentId() != asset.VerifiedContentID || binding.GetEntrySha256() != asset.EntrySHA256 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH
	}
	var model onnxModel
	if asset.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION || asset.Family != "insightface" || !contains(asset.ArtifactRoles, requirement.GetRequirementId()) || json.Unmarshal(asset.FormatProbe, &model) != nil || !faceModelInterface(requirement.GetRequirementId(), model) {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (driver InsightFaceImageDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(requirements) != 3 || len(bindings) != 3 || len(assets) != 3 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	seen := map[string]bool{}
	for index, requirement := range requirements {
		if seen[requirement.GetRequirementId()] {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[requirement.GetRequirementId()] = true
		if reason := driver.ValidateBinding(requirement, bindings[index], assets[index]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

type ImageFaceSwapInvocationPlan struct {
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	Bindings           []InvocationExactBinding
	ReferenceImage     []byte
	TargetImage        []byte
}

type FaceSwapModelPlan struct {
	ProfileRoot        string
	ProfileDigest      string
	DriverBundleDigest string
	Bindings           []InvocationExactBinding
}

func (plan *ImageFaceSwapInvocationPlan) Models() FaceSwapModelPlan {
	return FaceSwapModelPlan{ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest, Bindings: plan.Bindings}
}

func (InsightFaceImageDriver) PlanImageFaceSwapInvocation(platform, recipe string, reference, target []byte, bindings []InvocationExactBinding, dependencies []InvocationExactDependencySource) (*ImageFaceSwapInvocationPlan, error) {
	if platform != "windows/amd64" || recipe != InsightFaceRecipeID || len(bindings) != 3 || len(reference) == 0 || len(target) == 0 {
		return nil, fmt.Errorf("image face replacement has an unsupported host or incomplete captured inputs")
	}
	models, err := planFaceSwapModels(bindings, dependencies)
	if err != nil {
		return nil, err
	}
	return &ImageFaceSwapInvocationPlan{ProfileRoot: models.ProfileRoot, ProfileDigest: models.ProfileDigest, DriverBundleDigest: models.DriverBundleDigest, Bindings: models.Bindings, ReferenceImage: append([]byte(nil), reference...), TargetImage: append([]byte(nil), target...)}, nil
}

func planFaceSwapModels(bindings []InvocationExactBinding, dependencies []InvocationExactDependencySource) (FaceSwapModelPlan, error) {
	if len(bindings) != 3 {
		return FaceSwapModelPlan{}, fmt.Errorf("face replacement requires three model bindings")
	}
	seen := map[string]bool{}
	for _, binding := range bindings {
		if (binding.RequirementID != FaceDetectorSlot && binding.RequirementID != FaceRecognizerSlot && binding.RequirementID != FaceSwapperSlot) || seen[binding.RequirementID] || !filepath.IsAbs(binding.AbsolutePath) || binding.VerifiedContentID == "" {
			return FaceSwapModelPlan{}, fmt.Errorf("face replacement has invalid captured model bindings")
		}
		seen[binding.RequirementID] = true
	}
	var profile *InvocationExactDependencySource
	for index := range dependencies {
		candidate := &dependencies[index]
		if candidate.DependencyFamily == "python.package-set" && candidate.ConsumerScope == InsightFaceConsumerID {
			if profile != nil {
				return FaceSwapModelPlan{}, fmt.Errorf("ambiguous face replacement dependency profile")
			}
			profile = candidate
		}
	}
	if profile == nil || !filepath.IsAbs(profile.CanonicalRoot) || profile.SelectedSourceRecordID == "" || profile.Version == "" || profile.Hashes["profile_digest"] != profile.Version || profile.Hashes["driver_bundle_sha256"] == "" {
		return FaceSwapModelPlan{}, fmt.Errorf("face replacement has no exact managed dependency profile")
	}
	return FaceSwapModelPlan{ProfileRoot: profile.CanonicalRoot, ProfileDigest: profile.Version, DriverBundleDigest: profile.Hashes["driver_bundle_sha256"], Bindings: cloneInvocationExactBindings(bindings)}, nil
}
