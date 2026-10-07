package capabilitydriver

import (
	"encoding/json"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"io"
	"path/filepath"
)

// @nimi-authority: rule.nimi.runtime.local-compute.hyperswap-1a-driver
const (
	HyperSwapDriverID              = "nimi.runtime.driver.hyperswap"
	HyperSwapImageImplementationID = "local.image.face-swap.hyperswap-1a"
	HyperSwapVideoImplementationID = "local.video.face-swap.hyperswap-1a"
	HyperSwapImageDialect          = "hyperswap/image-face-swap/v1"
	HyperSwapVideoDialect          = "hyperswap/video-face-swap/v1"
	HyperSwapImageRecipeID         = "hyperswap-1a.image-face-swap.v1"
	HyperSwapVideoRecipeID         = "hyperswap-1a.video-face-swap.v1"
	HyperSwapSwapperSHA            = "c0e98a8a03a238f461ed3d2570e426b49f46745ee400854a60dceeb70c246add" // pragma: allowlist secret -- public official model digest
	HyperSwapRecognizerSHA         = "f1f79dc3b0b79a69f94799af1fffebff09fbd78fd96a275fd8f0cbbea23270d1" // pragma: allowlist secret -- public paired encoder digest
	HyperSwapDetectorSHA           = "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91" // pragma: allowlist secret -- current verified SCRFD digest
	FaceSwapBackendInsightFace     = "inswapper"
	FaceSwapBackendHyperSwap       = "hyperswap-1a"
)

type HyperSwapImageDriver struct{}

func (d HyperSwapImageDriver) ProjectRecipeForHost(recipe string, opts *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" && platform != "darwin/arm64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, opts, features)
}

func (HyperSwapImageDriver) EffectiveRequestDefaults(string, *structpb.Struct) map[string]string {
	return nil
}
func (HyperSwapImageDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != HyperSwapImageRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HyperSwapImageDriver) Interpret(i InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(i.RecipeID, i.PortableConfig, i.SupportedFeatures)
}
func (HyperSwapImageDriver) ProjectRecipe(recipe string, opts *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != HyperSwapImageRecipeID || len(opts.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return insightFaceModelRequirements(HyperSwapImageDialect), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (HyperSwapImageDriver) ProbeModelAsset(i ModelAssetFormatProbeInput, r io.ReaderAt, n int64) ([]byte, error) {
	if !i.Entry {
		return nil, nil
	}
	if i.RecipeID != HyperSwapImageRecipeID || filepath.Ext(i.RelativePath) != ".onnx" {
		return nil, fmt.Errorf("HyperSwap requires an exact ONNX entry")
	}
	return probeONNXModel(r, n)
}
func hyperSwapInterface(slot string, m onnxModel) bool {
	expectedOpset := uint64(15)
	if slot == FaceDetectorSlot {
		expectedOpset = 11
	}
	if len(m.Opsets) != 1 || m.Opsets[""] != expectedOpset {
		return false
	}
	for _, d := range m.NodeDomains {
		if d != "" {
			return false
		}
	}
	if slot != FaceSwapperSlot {
		return faceModelInterface(slot, m)
	}
	return m.IRVersion == 8 && len(m.Inputs) == 2 && m.Inputs[0].Name == "source" && faceTensorShape(m.Inputs[0], 1, 512) && m.Inputs[1].Name == "target" && faceTensorShape(m.Inputs[1], 1, 3, 256, 256) && len(m.Outputs) == 2 && m.Outputs[0].Name == "output" && faceTensorShape(m.Outputs[0], 1, 3, 256, 256) && m.Outputs[1].Name == "mask" && faceTensorShape(m.Outputs[1], 1, 1, 256, 256)
}
func hyperSwapDigest(slot string) string {
	switch slot {
	case FaceDetectorSlot:
		return HyperSwapDetectorSHA
	case FaceRecognizerSlot:
		return HyperSwapRecognizerSHA
	case FaceSwapperSlot:
		return HyperSwapSwapperSHA
	}
	return ""
}
func (d HyperSwapImageDriver) ProjectModelAssetBinding(i ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if i.RecipeID != HyperSwapImageRecipeID || filepath.Ext(i.Entry.RelativePath) != ".onnx" {
		return ModelAssetBindingProjection{}, invalid
	}
	var m onnxModel
	if json.Unmarshal(i.Entry.FormatProbe, &m) != nil || !hyperSwapInterface(i.Requirement.GetRequirementId(), m) {
		return ModelAssetBindingProjection{}, invalid
	}
	return validatedModelAssetBindingProjection(i, ModelAssetDescriptor{Kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION, Family: "hyperswap-1a", ArtifactRoles: []string{i.Requirement.GetRequirementId()}, FormatProbe: i.Entry.FormatProbe}, 0, d.ValidateBinding)
}
func (HyperSwapImageDriver) ValidateBinding(req *runtimev1.LocalCapabilityRequirement, b *runtimev1.ModelAssetExactBinding, a ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	invalid := runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	if req.GetRequirementId() != b.GetRequirementId() || b.GetModelAssetId() == "" || b.GetModelAssetId() != a.ModelAssetID || b.GetVerifiedContentId() == "" || b.GetVerifiedContentId() != a.VerifiedContentID || b.GetEntrySha256() != a.EntrySHA256 || a.EntrySHA256 != hyperSwapDigest(req.GetRequirementId()) || a.Kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VISION || a.Family != "hyperswap-1a" || !contains(a.ArtifactRoles, req.GetRequirementId()) {
		return invalid
	}
	var m onnxModel
	if json.Unmarshal(a.FormatProbe, &m) != nil || !hyperSwapInterface(req.GetRequirementId(), m) {
		return invalid
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HyperSwapImageDriver) ValidateCombination(r []*runtimev1.LocalCapabilityRequirement, b []*runtimev1.ModelAssetExactBinding, a []ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	if len(r) != 3 || len(b) != 3 || len(a) != 3 {
		return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
	}
	seen := map[string]bool{}
	for i, q := range r {
		if seen[q.GetRequirementId()] {
			return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_BINDING_AMBIGUOUS
		}
		seen[q.GetRequirementId()] = true
		if reason := d.ValidateBinding(q, b[i], a[i]); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return reason
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (HyperSwapImageDriver) PlanImageFaceSwapInvocation(platform, recipe string, ref, target []byte, b []InvocationExactBinding, deps []InvocationExactDependencySource) (*ImageFaceSwapInvocationPlan, error) {
	if (platform != "windows/amd64" && platform != "darwin/arm64") || recipe != HyperSwapImageRecipeID || len(ref) == 0 || len(target) == 0 {
		return nil, fmt.Errorf("HyperSwap image capture is unsupported or incomplete")
	}
	models, err := planHyperSwapModels(b, deps)
	if err != nil {
		return nil, err
	}
	return &ImageFaceSwapInvocationPlan{Backend: FaceSwapBackendHyperSwap, ProfileRoot: models.ProfileRoot, ProfileDigest: models.ProfileDigest, DriverBundleDigest: models.DriverBundleDigest, Bindings: models.Bindings, ReferenceImage: append([]byte(nil), ref...), TargetImage: append([]byte(nil), target...)}, nil
}
func planHyperSwapModels(b []InvocationExactBinding, deps []InvocationExactDependencySource) (FaceSwapModelPlan, error) {
	models, err := planFaceSwapModels(b, deps)
	if err != nil {
		return FaceSwapModelPlan{}, err
	}
	for _, x := range b {
		if x.EntrySHA256 != hyperSwapDigest(x.RequirementID) {
			return FaceSwapModelPlan{}, fmt.Errorf("HyperSwap captured model content is not the exact admitted group")
		}
	}
	models.Backend = FaceSwapBackendHyperSwap
	return models, nil
}

type HyperSwapVideoDriver struct{ HyperSwapImageDriver }

func (d HyperSwapVideoDriver) ProjectRecipeForHost(recipe string, opts *structpb.Struct, features []string, platform string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if platform != "windows/amd64" && platform != "darwin/arm64" {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return d.ProjectRecipe(recipe, opts, features)
}

func (d HyperSwapVideoDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != HyperSwapVideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}
func (d HyperSwapVideoDriver) Interpret(i InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return d.ProjectRecipe(i.RecipeID, i.PortableConfig, i.SupportedFeatures)
}
func (d HyperSwapVideoDriver) ProjectRecipe(recipe string, o *structpb.Struct, f []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != HyperSwapVideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	r, reason := d.HyperSwapImageDriver.ProjectRecipe(HyperSwapImageRecipeID, o, f)
	for _, q := range r {
		q.CompatibilityConstraints.Fields["driver_dialect"] = structpb.NewStringValue(HyperSwapVideoDialect)
	}
	return r, reason
}
func (d HyperSwapVideoDriver) ProbeModelAsset(i ModelAssetFormatProbeInput, r io.ReaderAt, n int64) ([]byte, error) {
	if i.RecipeID != HyperSwapVideoRecipeID {
		return nil, fmt.Errorf("unsupported HyperSwap video recipe")
	}
	i.RecipeID = HyperSwapImageRecipeID
	return d.HyperSwapImageDriver.ProbeModelAsset(i, r, n)
}
func (d HyperSwapVideoDriver) ProjectModelAssetBinding(i ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if i.RecipeID != HyperSwapVideoRecipeID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	i.RecipeID = HyperSwapImageRecipeID
	return d.HyperSwapImageDriver.ProjectModelAssetBinding(i)
}
func (HyperSwapVideoDriver) PlanVideoFaceSwapSession(platform, recipe string, ref []byte, b []InvocationExactBinding, deps []InvocationExactDependencySource) (FaceSwapModelPlan, error) {
	if (platform != "windows/amd64" && platform != "darwin/arm64") || recipe != HyperSwapVideoRecipeID || len(ref) == 0 {
		return FaceSwapModelPlan{}, fmt.Errorf("unsupported HyperSwap Session capture")
	}
	return planHyperSwapModels(b, deps)
}
func (HyperSwapVideoDriver) PlanVideoFaceSwapInvocation(platform, recipe string, ref, target []byte, policy string, b []InvocationExactBinding, deps []InvocationExactDependencySource) (*VideoFaceSwapInvocationPlan, error) {
	if len(target) == 0 || (policy != "fail" && policy != "preserve_frame") {
		return nil, fmt.Errorf("unsupported HyperSwap video inputs")
	}
	m, e := (HyperSwapVideoDriver{}).PlanVideoFaceSwapSession(platform, recipe, ref, b, deps)
	if e != nil {
		return nil, e
	}
	return &VideoFaceSwapInvocationPlan{Models: m, ReferenceImage: append([]byte(nil), ref...), TargetVideo: append([]byte(nil), target...), NoFacePolicy: policy}, nil
}
