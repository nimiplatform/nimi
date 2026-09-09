package ai

import (
	"context"
	"fmt"
	"reflect"
	"runtime"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type localResolvedAssemblyVisionPlan struct {
	PlatformTuple      string `json:"platform_tuple"`
	Backend            string `json:"backend"`
	ProfileRoot        string `json:"profile_root"`
	ProfileDigest      string `json:"profile_digest"`
	DriverBundleDigest string `json:"driver_bundle_digest"`
	DriverProtocol     string `json:"driver_protocol"`
	Width              uint32 `json:"width"`
	Height             uint32 `json:"height"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r126
func validateVisionLocateSpec(spec *runtimev1.VisionLocateScenarioSpec) error {
	if spec == nil || len(spec.ProtoReflect().GetUnknown()) != 0 || spec.ImageArtifactId == "" || len(spec.ImageArtifactId) > 128 || strings.TrimSpace(spec.ImageArtifactId) != spec.ImageArtifactId ||
		!utf8.ValidString(spec.Query) || strings.TrimSpace(spec.Query) == "" || len(spec.Query) > localexecution.MaxVisionLocateQueryBytes {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "Locate requires an owned image artifact and a query of at most 8 KiB"})
	}
	if spec.Geometry != runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_BOX && spec.Geometry != runtimev1.VisionLocateGeometry_VISION_LOCATE_GEOMETRY_POINT {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "Locate geometry must be BOX or POINT"})
	}
	return nil
}

type localVisionEffectiveInputs struct {
	assembly    *localResolvedAssembly
	identity    *runtimev1.LoadoutEffectiveInputIdentity
	displayName string
}

func (s *Service) captureLocalVisionEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.VisionLocateScenarioSpec) (*localVisionEffectiveInputs, error) {
	if err := validateVisionLocateSpec(spec); err != nil {
		return nil, err
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok {
		var err error
		_, intent, err = s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.VisionLocateContract)
		if err != nil {
			return nil, err
		}
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.VisionLocateContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.VisionLocateContract || len(selected.ExactBindings) != 1 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.VisionLocateContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	visionDriver, ok := driver.(capabilitydriver.LocateAnythingDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	input, err := s.resolveLocalImageArtifactInput(ctx, head, spec.ImageArtifactId, capabilitydriver.ImageResolvedInputRoleSource)
	if err != nil {
		return nil, err
	}
	width, height, err := localexecution.VisionLocateImageSize(input.ImageBytes)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	platform := runtime.GOOS + "/" + runtime.GOARCH
	plan, err := visionDriver.PlanVisionLocateInvocation(capabilitydriver.VisionLocateInvocationInput{
		RecipeID: selected.RecipeID, PlatformTuple: platform, Request: spec, ImageBytes: input.ImageBytes, Width: width, Height: height,
		Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources),
	})
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	if s.localVisionHost == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	assembly, err := localResolvedAssemblyForVision(selected, plan, platform)
	if err != nil {
		return nil, err
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	return &localVisionEffectiveInputs{assembly: assembly, identity: identity, displayName: selected.DisplayName}, nil
}

func localResolvedAssemblyForVision(selected *localexecution.SelectedLocalExecution, plan *capabilitydriver.VisionLocateInvocationPlan, platform string) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(plan.Request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.VisionLocateContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.Request.BinaryInput = append([]byte(nil), plan.ImageBytes...)
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "vision", Vision: visionResolvedLoadPlan(plan, platform)}
	assembly.ProcessIdentity.ModelAssetID = plan.Binding.ModelAssetID
	return assembly, nil
}

func visionResolvedLoadPlan(plan *capabilitydriver.VisionLocateInvocationPlan, platform string) *localResolvedAssemblyVisionPlan {
	return &localResolvedAssemblyVisionPlan{PlatformTuple: platform, Backend: plan.Backend, ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest, DriverProtocol: plan.DriverProtocol, Width: plan.Width, Height: plan.Height}
}

func visionPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.VisionLocateInvocationPlan, error) {
	if assembly == nil || assembly.LoadPlan.Kind != "vision" || assembly.LoadPlan.Vision == nil || assembly.CapabilityContract != capabilitydriver.VisionLocateContract ||
		assembly.Request.Kind != capabilitydriver.VisionLocateContract || assembly.DriverIdentity.DriverID != capabilitydriver.LocateAnythingDriverID ||
		assembly.DriverIdentity.ImplementationID != capabilitydriver.LocateAnythingImplementationID || assembly.DriverIdentity.DriverDialect != capabilitydriver.LocateAnythingDriverDialect ||
		len(assembly.RecipeCustody) != 0 || len(assembly.Request.BinaryInput) == 0 || len(assembly.Request.BinaryInput) > localexecution.MaxVisionLocateImageBytes {
		return nil, fmt.Errorf("captured Locate assembly is incomplete")
	}
	request := &runtimev1.VisionLocateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, err
	}
	if err := validateVisionLocateSpec(request); err != nil {
		return nil, err
	}
	load := assembly.LoadPlan.Vision
	plan, err := (capabilitydriver.LocateAnythingDriver{}).PlanVisionLocateInvocation(capabilitydriver.VisionLocateInvocationInput{
		RecipeID: assembly.RecipeID, PlatformTuple: load.PlatformTuple, Request: request, ImageBytes: assembly.Request.BinaryInput,
		Width: load.Width, Height: load.Height, Bindings: resolvedAssemblyExactBindings(assembly), DependencySources: resolvedAssemblyExactDependencySources(assembly),
	})
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(load, visionResolvedLoadPlan(plan, load.PlatformTuple)) || assembly.ProcessIdentity.ModelAssetID != plan.Binding.ModelAssetID {
		return nil, fmt.Errorf("captured Locate load plan changed")
	}
	return plan, nil
}

func cloneVisionLocateSpec(spec *runtimev1.VisionLocateScenarioSpec) *runtimev1.VisionLocateScenarioSpec {
	if spec == nil {
		return nil
	}
	return proto.Clone(spec).(*runtimev1.VisionLocateScenarioSpec)
}
