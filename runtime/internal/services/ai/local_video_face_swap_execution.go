package ai

import (
	"context"
	"fmt"
	"io"
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

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-video-job
func validateVideoFaceSwapSpec(spec *runtimev1.VideoFaceSwapScenarioSpec) error {
	if spec == nil || len(spec.ProtoReflect().GetUnknown()) != 0 || !localAppBoundedIdentifier(spec.ReferenceImageArtifactId) || !localAppBoundedIdentifier(spec.TargetVideoArtifactId) || videoFaceSwapNoFacePolicy(spec.NoFacePolicy) == "" {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "Video face replacement requires owned reference and target artifacts and an explicit no-face policy"})
	}
	return nil
}

func videoFaceSwapNoFacePolicy(value runtimev1.FaceSwapNoFacePolicy) string {
	switch value {
	case runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_FAIL:
		return "fail"
	case runtimev1.FaceSwapNoFacePolicy_FACE_SWAP_NO_FACE_POLICY_PRESERVE_FRAME:
		return "preserve_frame"
	default:
		return ""
	}
}

func (s *Service) captureLocalVideoFaceSwapInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.VideoFaceSwapScenarioSpec) (*localResolvedAssembly, *runtimev1.LoadoutEffectiveInputIdentity, string, error) {
	if err := validateVideoFaceSwapSpec(spec); err != nil {
		return nil, nil, "", err
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.VideoFaceSwapContract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, nil, "", err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.VideoFaceSwapContract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	resolved, reason := s.capabilityDrivers.Resolve(capabilitydriver.VideoFaceSwapContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := resolved.(capabilitydriver.InsightFaceVideoDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	reference, err := s.resolveLocalImageArtifactInput(ctx, head, spec.ReferenceImageArtifactId, capabilitydriver.ImageResolvedInputRoleSource)
	if err != nil {
		return nil, nil, "", err
	}
	if _, _, err := localexecution.FaceSwapImageSize(reference.ImageBytes); err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	source, err := s.openAuthorizedLocalAppArtifact(ctx, decision, spec.TargetVideoArtifactId, localAppArtifactOperationInput)
	if err != nil {
		return nil, nil, "", err
	}
	defer func() { _ = source.Body.Close() }()
	if source.Record.MimeType != "video/mp4" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_MIME_MISMATCH)
	}
	if source.Record.SizeBytes <= 0 || source.Record.SizeBytes > localexecution.MaxFaceSwapVideoBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	target, err := io.ReadAll(io.LimitReader(source.Body, localexecution.MaxFaceSwapVideoBytes+1))
	if err != nil || int64(len(target)) != source.Record.SizeBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	platform := runtime.GOOS + "/" + runtime.GOARCH
	plan, err := driver.PlanVideoFaceSwapInvocation(platform, selected.RecipeID, reference.ImageBytes, target, videoFaceSwapNoFacePolicy(spec.NoFacePolicy), projectInvocationExactBindings(selected.ExactBindings), invocationExactDependencySources(selected.ExactDependencySources))
	if err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	if s.localFaceSwapHost == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	if err := s.localFaceSwapHost.AdmitVideoFaceSwap(plan); err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	payload, err := protojson.Marshal(spec)
	if err != nil {
		return nil, nil, "", err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.VideoFaceSwapContract, payload)
	if err != nil {
		return nil, nil, "", err
	}
	assembly.Request.BinaryInput = plan.TargetVideo
	assembly.Request.ReferenceInput = plan.ReferenceImage
	assembly.Request.MIMEType = "video/mp4"
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "video-face-swap", FaceSwap: videoFaceSwapResolvedLoadPlan(plan, platform)}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "Captured video face replacement assembly is invalid"})
	}
	return assembly, identity, selected.DisplayName, nil
}

func videoFaceSwapResolvedLoadPlan(plan *capabilitydriver.VideoFaceSwapInvocationPlan, platform string) *localResolvedAssemblyFaceSwapPlan {
	return &localResolvedAssemblyFaceSwapPlan{PlatformTuple: platform, ProfileRoot: plan.Models.ProfileRoot, ProfileDigest: plan.Models.ProfileDigest, DriverBundleDigest: plan.Models.DriverBundleDigest}
}

func videoFaceSwapPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.VideoFaceSwapInvocationPlan, error) {
	if assembly == nil || assembly.LoadPlan.Kind != "video-face-swap" || assembly.LoadPlan.FaceSwap == nil || assembly.CapabilityContract != capabilitydriver.VideoFaceSwapContract || assembly.Request.Kind != capabilitydriver.VideoFaceSwapContract || assembly.Request.MIMEType != "video/mp4" || assembly.DriverIdentity.ImplementationID != capabilitydriver.InsightFaceVideoImplementationID || assembly.DriverIdentity.DriverID != capabilitydriver.InsightFaceDriverID || assembly.DriverIdentity.DriverDialect != capabilitydriver.InsightFaceVideoDriverDialect || len(assembly.RecipeCustody) != 0 {
		return nil, fmt.Errorf("captured video replacement assembly is incomplete")
	}
	spec := &runtimev1.VideoFaceSwapScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, spec); err != nil {
		return nil, err
	}
	if err := validateVideoFaceSwapSpec(spec); err != nil {
		return nil, err
	}
	load := assembly.LoadPlan.FaceSwap
	plan, err := (capabilitydriver.InsightFaceVideoDriver{}).PlanVideoFaceSwapInvocation(load.PlatformTuple, assembly.RecipeID, assembly.Request.ReferenceInput, assembly.Request.BinaryInput, videoFaceSwapNoFacePolicy(spec.NoFacePolicy), resolvedAssemblyExactBindings(assembly), resolvedAssemblyExactDependencySources(assembly))
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(load, videoFaceSwapResolvedLoadPlan(plan, load.PlatformTuple)) {
		return nil, fmt.Errorf("captured video replacement load plan changed")
	}
	return plan, nil
}
