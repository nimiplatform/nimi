package capabilitydriver

import (
	"fmt"
	"io"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.local-compute.face-swap-video-driver
const (
	VideoFaceSwapContract            = "video.face_swap"
	InsightFaceVideoImplementationID = "local.video.face-swap.insightface"
	InsightFaceVideoDriverDialect    = "insightface/video-face-swap/v1"
	InsightFaceVideoRecipeID         = "insightface.video-face-swap.v1"
)

// The independent video Driver shares the exact ONNX Model Contract only.
type InsightFaceVideoDriver struct{ InsightFaceImageDriver }

func (driver InsightFaceVideoDriver) Interpret(input InterpretInput) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	return driver.ProjectRecipe(input.RecipeID, input.PortableConfig, input.SupportedFeatures)
}

func (InsightFaceVideoDriver) ProjectRecipe(recipe string, options *structpb.Struct, features []string) ([]*runtimev1.LocalCapabilityRequirement, runtimev1.LocalCapabilityReason) {
	if recipe != InsightFaceVideoRecipeID || len(options.GetFields()) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_PORTABLE_CONFIG_INVALID
	}
	if len(features) != 0 {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_FEATURE_UNSUPPORTED
	}
	return insightFaceModelRequirements(InsightFaceVideoDriverDialect), runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (InsightFaceVideoDriver) ImplementationSupportedFeatures(recipe string) ([]string, runtimev1.LocalCapabilityReason) {
	if recipe != InsightFaceVideoRecipeID {
		return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED
	}
	return nil, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED
}

func (InsightFaceVideoDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	if input.RecipeID != InsightFaceVideoRecipeID || filepath.Ext(input.RelativePath) != ".onnx" {
		return nil, fmt.Errorf("video face replacement requires an ONNX model entry")
	}
	return probeONNXModel(source, size)
}

func (driver InsightFaceVideoDriver) ProjectModelAssetBinding(input ModelAssetBindingInput) (ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	if input.RecipeID != InsightFaceVideoRecipeID {
		return ModelAssetBindingProjection{}, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE
	}
	input.RecipeID = InsightFaceRecipeID
	return driver.InsightFaceImageDriver.ProjectModelAssetBinding(input)
}

type VideoFaceSwapInvocationPlan struct {
	Models         FaceSwapModelPlan
	ReferenceImage []byte
	TargetVideo    []byte
	NoFacePolicy   string
}

func (InsightFaceVideoDriver) PlanVideoFaceSwapSession(platform, recipe string, reference []byte, bindings []InvocationExactBinding, dependencies []InvocationExactDependencySource) (FaceSwapModelPlan, error) {
	if platform != "windows/amd64" || recipe != InsightFaceVideoRecipeID || len(reference) == 0 {
		return FaceSwapModelPlan{}, fmt.Errorf("video Session requires its exact supported model and reference composition")
	}
	return planFaceSwapModels(bindings, dependencies)
}

func (InsightFaceVideoDriver) PlanVideoFaceSwapInvocation(platform, recipe string, reference, target []byte, noFacePolicy string, bindings []InvocationExactBinding, dependencies []InvocationExactDependencySource) (*VideoFaceSwapInvocationPlan, error) {
	if platform != "windows/amd64" || recipe != InsightFaceVideoRecipeID || len(reference) == 0 || len(target) == 0 || (noFacePolicy != "fail" && noFacePolicy != "preserve_frame") {
		return nil, fmt.Errorf("video face replacement has an unsupported host or incomplete captured inputs")
	}
	models, err := planFaceSwapModels(bindings, dependencies)
	if err != nil {
		return nil, err
	}
	return &VideoFaceSwapInvocationPlan{Models: models, ReferenceImage: append([]byte(nil), reference...), TargetVideo: append([]byte(nil), target...), NoFacePolicy: noFacePolicy}, nil
}
