package ai

import (
	"context"
	"fmt"
	"reflect"
	"runtime"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

type localResolvedAssemblyFaceSwapPlan struct {
	PlatformTuple      string `json:"platform_tuple"`
	ProfileRoot        string `json:"profile_root"`
	ProfileDigest      string `json:"profile_digest"`
	DriverBundleDigest string `json:"driver_bundle_digest"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-image-job
func validateImageFaceSwapSpec(spec *runtimev1.ImageFaceSwapScenarioSpec) error {
	if spec == nil || len(spec.ProtoReflect().GetUnknown()) != 0 || !localAppBoundedIdentifier(spec.ReferenceImageArtifactId) || !localAppBoundedIdentifier(spec.TargetImageArtifactId) {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "Image face replacement requires owned reference and target image artifacts"})
	}
	return nil
}

func (s *Service) captureLocalFaceSwapInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.ImageFaceSwapScenarioSpec) (*localResolvedAssembly, *runtimev1.LoadoutEffectiveInputIdentity, string, error) {
	if err := validateImageFaceSwapSpec(spec); err != nil {
		return nil, nil, "", err
	}
	if _, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); !ok {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.ImageFaceSwapContract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, nil, "", err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.ImageFaceSwapContract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	resolved, reason := s.capabilityDrivers.Resolve(capabilitydriver.ImageFaceSwapContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := resolved.(capabilitydriver.InsightFaceImageDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	reference, err := s.resolveLocalImageArtifactInput(ctx, head, spec.ReferenceImageArtifactId, capabilitydriver.ImageResolvedInputRoleSource)
	if err != nil {
		return nil, nil, "", err
	}
	target, err := s.resolveLocalImageArtifactInput(ctx, head, spec.TargetImageArtifactId, capabilitydriver.ImageResolvedInputRoleSource)
	if err != nil {
		return nil, nil, "", err
	}
	for _, data := range [][]byte{reference.ImageBytes, target.ImageBytes} {
		if _, _, err := localexecution.FaceSwapImageSize(data); err != nil {
			return nil, nil, "", grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
		}
	}
	platform := runtime.GOOS + "/" + runtime.GOARCH
	plan, err := driver.PlanImageFaceSwapInvocation(platform, selected.RecipeID, reference.ImageBytes, target.ImageBytes, projectInvocationExactBindings(selected.ExactBindings), invocationExactDependencySources(selected.ExactDependencySources))
	if err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	if s.localFaceSwapHost == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	if err := s.localFaceSwapHost.AdmitImageFaceSwap(plan); err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	payload, err := protojson.Marshal(spec)
	if err != nil {
		return nil, nil, "", err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.ImageFaceSwapContract, payload)
	if err != nil {
		return nil, nil, "", err
	}
	assembly.Request.BinaryInput = append([]byte(nil), plan.TargetImage...)
	assembly.Request.ReferenceInput = append([]byte(nil), plan.ReferenceImage...)
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "image-face-swap", FaceSwap: faceSwapResolvedLoadPlan(plan, platform)}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, nil, "", err
	}
	return assembly, identity, selected.DisplayName, nil
}

func faceSwapResolvedLoadPlan(plan *capabilitydriver.ImageFaceSwapInvocationPlan, platform string) *localResolvedAssemblyFaceSwapPlan {
	return &localResolvedAssemblyFaceSwapPlan{PlatformTuple: platform, ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest}
}

func faceSwapPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.ImageFaceSwapInvocationPlan, error) {
	if assembly == nil || assembly.LoadPlan.Kind != "image-face-swap" || assembly.LoadPlan.FaceSwap == nil || assembly.CapabilityContract != capabilitydriver.ImageFaceSwapContract || assembly.Request.Kind != capabilitydriver.ImageFaceSwapContract ||
		assembly.DriverIdentity.ImplementationID != capabilitydriver.InsightFaceImplementationID || assembly.DriverIdentity.DriverID != capabilitydriver.InsightFaceDriverID || assembly.DriverIdentity.DriverDialect != capabilitydriver.InsightFaceDriverDialect || len(assembly.RecipeCustody) != 0 {
		return nil, fmt.Errorf("captured face replacement assembly is incomplete")
	}
	spec := &runtimev1.ImageFaceSwapScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, spec); err != nil {
		return nil, err
	}
	if err := validateImageFaceSwapSpec(spec); err != nil {
		return nil, err
	}
	for _, data := range [][]byte{assembly.Request.BinaryInput, assembly.Request.ReferenceInput} {
		if _, _, err := localexecution.FaceSwapImageSize(data); err != nil {
			return nil, err
		}
	}
	load := assembly.LoadPlan.FaceSwap
	plan, err := (capabilitydriver.InsightFaceImageDriver{}).PlanImageFaceSwapInvocation(load.PlatformTuple, assembly.RecipeID, assembly.Request.ReferenceInput, assembly.Request.BinaryInput, resolvedAssemblyExactBindings(assembly), resolvedAssemblyExactDependencySources(assembly))
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(load, faceSwapResolvedLoadPlan(plan, load.PlatformTuple)) {
		return nil, fmt.Errorf("captured face replacement load plan changed")
	}
	return plan, nil
}
