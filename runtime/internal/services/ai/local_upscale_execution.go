package ai

import (
	"context"
	"fmt"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
)

func validateMediaUpscaleSpec(spec *runtimev1.MediaUpscaleScenarioSpec) error {
	if spec == nil || len(spec.ProtoReflect().GetUnknown()) != 0 || !localAppBoundedIdentifier(spec.SourceArtifactId) ||
		(spec.Scale != 2 && spec.Scale != 4) || (spec.Seed != nil && (*spec.Seed < 0 || *spec.Seed > 2147483647)) {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "Super-resolution requires an owned source artifact, scale 2 or 4 and a nonnegative signed-int32 seed"})
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.media-upscale-contract
func (s *Service) captureLocalUpscaleInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.MediaUpscaleScenarioSpec, video bool) (*localResolvedAssembly, *runtimev1.LoadoutEffectiveInputIdentity, string, error) {
	if err := validateMediaUpscaleSpec(spec); err != nil {
		return nil, nil, "", err
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	contract, kind := capabilitydriver.ImageUpscaleContract, "image-upscale"
	if video {
		contract, kind = capabilitydriver.VideoUpscaleContract, "video-upscale"
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != contract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, nil, "", err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != contract {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	resolved, reason := s.capabilityDrivers.Resolve(contract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := resolved.(capabilitydriver.UpscaleDriver)
	if !ok || driver.Video != video || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	owned, err := s.openAuthorizedLocalAppArtifact(ctx, decision, spec.SourceArtifactId, localAppArtifactOperationInput)
	if err != nil {
		return nil, nil, "", err
	}
	defer func() { _ = owned.Body.Close() }()
	if owned.Record.SizeBytes <= 0 || owned.Record.SizeBytes > localexecution.MaxUpscaleInputBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_ARTIFACT_TOO_LARGE)
	}
	source, err := io.ReadAll(io.LimitReader(owned.Body, localexecution.MaxUpscaleInputBytes+1))
	if err != nil || int64(len(source)) != owned.Record.SizeBytes {
		return nil, nil, "", grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_ARTIFACT_FORBIDDEN)
	}
	plan, err := driver.PlanUpscale(selected.RecipeID, spec, source, owned.Record.MimeType, projectInvocationExactBindings(selected.ExactBindings), invocationExactDependencySources(selected.ExactDependencySources))
	if err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if s.localUpscaleHost == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	if err := s.localUpscaleHost.AdmitUpscale(plan); err != nil {
		return nil, nil, "", grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	payload, err := protojson.Marshal(spec)
	if err != nil {
		return nil, nil, "", err
	}
	assembly, err := newLocalResolvedAssembly(selected, contract, payload)
	if err != nil {
		return nil, nil, "", err
	}
	assembly.Request.BinaryInput = append([]byte(nil), plan.Source...)
	assembly.Request.MIMEType = plan.MIMEType
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: kind}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, nil, "", err
	}
	return assembly, identity, selected.DisplayName, nil
}

func upscalePlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.UpscaleInvocationPlan, error) {
	if assembly == nil || (assembly.LoadPlan.Kind != "image-upscale" && assembly.LoadPlan.Kind != "video-upscale") || len(assembly.RecipeCustody) != 0 || len(assembly.Request.ReferenceInput) != 0 {
		return nil, fmt.Errorf("captured super-resolution assembly is incomplete")
	}
	video := assembly.LoadPlan.Kind == "video-upscale"
	contract := capabilitydriver.ImageUpscaleContract
	if video {
		contract = capabilitydriver.VideoUpscaleContract
	}
	if assembly.CapabilityContract != contract || assembly.Request.Kind != contract {
		return nil, fmt.Errorf("captured super-resolution capability differs")
	}
	spec := &runtimev1.MediaUpscaleScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, spec); err != nil {
		return nil, err
	}
	if err := validateMediaUpscaleSpec(spec); err != nil {
		return nil, err
	}
	resolved, reason := capabilitydriver.NewProductionRegistry().Resolve(contract, capabilitydriver.Identity{ImplementationID: assembly.DriverIdentity.ImplementationID, DriverID: assembly.DriverIdentity.DriverID, DriverDialect: assembly.DriverIdentity.DriverDialect})
	driver, ok := resolved.(capabilitydriver.UpscaleDriver)
	if !ok || driver.Video != video || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, fmt.Errorf("captured super-resolution Driver is unavailable")
	}
	return driver.PlanUpscale(assembly.RecipeID, spec, assembly.Request.BinaryInput, assembly.Request.MIMEType, resolvedAssemblyExactBindings(assembly), resolvedAssemblyExactDependencySources(assembly))
}
