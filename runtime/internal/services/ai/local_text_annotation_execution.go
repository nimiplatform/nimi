package ai

import (
	"context"
	"fmt"
	"reflect"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type localResolvedAssemblyAnnotationPlan struct {
	ProfileRoot        string `json:"profile_root"`
	ProfileDigest      string `json:"profile_digest"`
	DriverBundleDigest string `json:"driver_bundle_digest"`
	DriverProtocol     string `json:"driver_protocol"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.text-annotation
func validateTextAnnotationSpec(spec *runtimev1.TextAnnotateScenarioSpec) error {
	if err := localexecution.ValidateTextAnnotationSpec(spec); err != nil {
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	return nil
}

type localAnnotationEffectiveInputs struct {
	assembly    *localResolvedAssembly
	identity    *runtimev1.LoadoutEffectiveInputIdentity
	displayName string
}

func (s *Service) captureLocalAnnotationEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.TextAnnotateScenarioSpec) (*localAnnotationEffectiveInputs, error) {
	if err := validateTextAnnotationSpec(spec); err != nil {
		return nil, err
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok {
		var err error
		_, intent, err = s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.TextAnnotateContract)
		if err != nil {
			return nil, err
		}
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.TextAnnotateContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.TextAnnotateContract || len(selected.ExactBindings) != 1 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.TextAnnotateContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	annotationDriver, ok := driver.(capabilitydriver.SpacyDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	plan, err := annotationDriver.PlanTextAnnotationInvocation(capabilitydriver.TextAnnotationInvocationInput{
		RecipeID: selected.RecipeID, Request: spec,
		Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources),
	})
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	if s.localAnnotationHost == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	assembly, err := localResolvedAssemblyForAnnotation(selected, plan)
	if err != nil {
		return nil, err
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, err
	}
	return &localAnnotationEffectiveInputs{assembly: assembly, identity: identity, displayName: selected.DisplayName}, nil
}

func localResolvedAssemblyForAnnotation(selected *localexecution.SelectedLocalExecution, plan *capabilitydriver.TextAnnotationInvocationPlan) (*localResolvedAssembly, error) {
	raw, err := protojson.Marshal(plan.Request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.TextAnnotateContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "annotation", Annotation: annotationResolvedLoadPlan(plan)}
	assembly.ProcessIdentity.ModelAssetID = plan.Binding.ModelAssetID
	return assembly, nil
}

func annotationResolvedLoadPlan(plan *capabilitydriver.TextAnnotationInvocationPlan) *localResolvedAssemblyAnnotationPlan {
	return &localResolvedAssemblyAnnotationPlan{ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest, DriverProtocol: plan.DriverProtocol}
}

func annotationPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.TextAnnotationInvocationPlan, error) {
	if assembly == nil || assembly.LoadPlan.Kind != "annotation" || assembly.LoadPlan.Annotation == nil || assembly.CapabilityContract != capabilitydriver.TextAnnotateContract ||
		assembly.Request.Kind != capabilitydriver.TextAnnotateContract || assembly.DriverIdentity.DriverID != capabilitydriver.SpacyDriverID ||
		assembly.DriverIdentity.ImplementationID != capabilitydriver.SpacyImplementationID || assembly.DriverIdentity.DriverDialect != capabilitydriver.SpacyDriverDialect ||
		len(assembly.RecipeCustody) != 0 || len(assembly.Request.BinaryInput) != 0 {
		return nil, fmt.Errorf("captured annotation assembly is incomplete")
	}
	request := &runtimev1.TextAnnotateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, err
	}
	if err := validateTextAnnotationSpec(request); err != nil {
		return nil, err
	}
	load := assembly.LoadPlan.Annotation
	plan, err := (capabilitydriver.SpacyDriver{}).PlanTextAnnotationInvocation(capabilitydriver.TextAnnotationInvocationInput{
		RecipeID: assembly.RecipeID, Request: request, Bindings: resolvedAssemblyExactBindings(assembly), DependencySources: resolvedAssemblyExactDependencySources(assembly),
	})
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(load, annotationResolvedLoadPlan(plan)) || assembly.ProcessIdentity.ModelAssetID != plan.Binding.ModelAssetID {
		return nil, fmt.Errorf("captured annotation load plan changed")
	}
	return plan, nil
}

func cloneTextAnnotationSpec(spec *runtimev1.TextAnnotateScenarioSpec) *runtimev1.TextAnnotateScenarioSpec {
	if spec == nil {
		return nil
	}
	return proto.Clone(spec).(*runtimev1.TextAnnotateScenarioSpec)
}
