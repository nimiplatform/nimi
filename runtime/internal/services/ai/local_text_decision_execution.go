package ai

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// localResolvedAssemblyDecisionPlan is the private captured load plan of one
// Local Laya decision Job: the exact managed profile and checkpoint directory.
type localResolvedAssemblyDecisionPlan struct {
	ProfileRoot        string `json:"profile_root"`
	ProfileDigest      string `json:"profile_digest"`
	DriverBundleDigest string `json:"driver_bundle_digest"`
	DriverProtocol     string `json:"driver_protocol"`
	ModelDir           string `json:"model_dir"`
}

// SetLocalTextDecisionExecutionHost wires the private resident Decision Worker
// Host. The Host never participates in route, selection or device decisions.
func (s *Service) SetLocalTextDecisionExecutionHost(host localexecution.TextDecisionExecutionHost) {
	if s != nil {
		s.localDecisionHost = host
	}
}

type localDecisionEffectiveInputs struct {
	assembly      *localResolvedAssembly
	identity      *runtimev1.LoadoutEffectiveInputIdentity
	modelResolved string
}

// executeLocalTextDecision captures and runs one Local text.decide immediate Job.
// @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision
func (s *Service) executeLocalTextDecision(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextDecideScenarioSpec,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (textDecisionExecution, error) {
	effective, err := s.captureLocalDecisionEffectiveInputs(ctx, head, spec)
	if err != nil {
		return textDecisionExecution{}, err
	}
	job, jobCtx, err := s.captureImmediateLocalScenarioJob(
		ctx, head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_DECIDE,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved, ignored,
		effective.identity, effective.assembly,
	)
	if err != nil {
		return textDecisionExecution{}, err
	}
	result, usage, err := s.runCapturedLocalDecisionJob(jobCtx, job)
	if err != nil {
		return textDecisionExecution{}, err
	}
	return textDecisionExecution{
		result: result, usage: usage, job: job,
		route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, modelResolved: effective.modelResolved,
	}, nil
}

func (s *Service) captureLocalDecisionEffectiveInputs(ctx context.Context, head *runtimev1.ScenarioRequestHead, spec *runtimev1.TextDecideScenarioSpec) (*localDecisionEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, ok := executionintent.FromContext(ctx)
	if !ok {
		var err error
		_, intent, err = s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.TextDecideContract)
		if err != nil {
			return nil, err
		}
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.TextDecideContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured || selected.CapabilityContract != capabilitydriver.TextDecideContract || len(selected.ExactBindings) != 1 {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.TextDecideContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	layaDriver, ok := driver.(capabilitydriver.LayaDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	request, _ := proto.Clone(spec).(*runtimev1.TextDecideScenarioSpec)
	plan, err := layaDriver.PlanTextDecisionInvocation(capabilitydriver.TextDecisionInvocationInput{
		RecipeID: selected.RecipeID, Request: request,
		Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources),
	})
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, grpcerr.ReasonOptions{})
	}
	if s.localDecisionHost == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	assembly, err := localResolvedAssemblyForDecision(selected, plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local decision ResolvedAssembly capture failed"})
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local decision ResolvedAssembly attribution failed"})
	}
	modelResolved := strings.TrimSpace(selected.DisplayName)
	if modelResolved == "" {
		modelResolved = strings.TrimSpace(selected.LoadoutID)
	}
	return &localDecisionEffectiveInputs{assembly: assembly, identity: identity, modelResolved: modelResolved}, nil
}

func localResolvedAssemblyForDecision(selected *localexecution.SelectedLocalExecution, plan *capabilitydriver.TextDecisionInvocationPlan) (*localResolvedAssembly, error) {
	if plan == nil || plan.Request == nil {
		return nil, fmt.Errorf("text.decide ResolvedAssembly plan is required")
	}
	raw, err := protojson.Marshal(plan.Request)
	if err != nil {
		return nil, err
	}
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.TextDecideContract, raw)
	if err != nil {
		return nil, err
	}
	assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "decide", Decision: decisionResolvedLoadPlan(plan)}
	assembly.ProcessIdentity.ModelAssetID = plan.Binding.ModelAssetID
	return assembly, nil
}

func decisionResolvedLoadPlan(plan *capabilitydriver.TextDecisionInvocationPlan) *localResolvedAssemblyDecisionPlan {
	return &localResolvedAssemblyDecisionPlan{
		ProfileRoot: plan.ProfileRoot, ProfileDigest: plan.ProfileDigest, DriverBundleDigest: plan.DriverBundleDigest,
		DriverProtocol: plan.DriverProtocol, ModelDir: plan.ModelDir,
	}
}

// decisionPlanFromResolvedAssembly re-plans the exact captured invocation from
// the private assembly alone and requires the captured load plan to be equal.
func decisionPlanFromResolvedAssembly(assembly *localResolvedAssembly) (*capabilitydriver.TextDecisionInvocationPlan, error) {
	if assembly == nil || assembly.LoadPlan.Kind != "decide" || assembly.LoadPlan.Decision == nil || assembly.CapabilityContract != capabilitydriver.TextDecideContract ||
		assembly.Request.Kind != capabilitydriver.TextDecideContract || assembly.DriverIdentity.DriverID != capabilitydriver.LayaDriverID ||
		assembly.DriverIdentity.ImplementationID != capabilitydriver.LayaImplementationID || assembly.DriverIdentity.DriverDialect != capabilitydriver.LayaDriverDialect ||
		len(assembly.RecipeCustody) != 0 || len(assembly.Request.BinaryInput) != 0 || len(assembly.Request.ReferenceInput) != 0 || len(assembly.AdmittedFeatures) != 0 {
		return nil, fmt.Errorf("captured decision assembly is incomplete")
	}
	request := &runtimev1.TextDecideScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, fmt.Errorf("decode captured decision request: %w", err)
	}
	// Admission enforced the public limits before capture. Every durable persist
	// re-checks all stored records, so a stored request is checked structurally.
	if request.GetState() == nil || len(request.GetQuestions()) == 0 {
		return nil, fmt.Errorf("captured decision request is incomplete")
	}
	plan, err := (capabilitydriver.LayaDriver{}).PlanTextDecisionInvocation(capabilitydriver.TextDecisionInvocationInput{
		RecipeID: assembly.RecipeID, Request: request,
		Bindings: resolvedAssemblyExactBindings(assembly), DependencySources: resolvedAssemblyExactDependencySources(assembly),
	})
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(assembly.LoadPlan.Decision, decisionResolvedLoadPlan(plan)) || assembly.ProcessIdentity.ModelAssetID != plan.Binding.ModelAssetID {
		return nil, fmt.Errorf("captured decision load plan changed")
	}
	return plan, nil
}

func (s *Service) runCapturedLocalDecisionJob(jobCtx context.Context, job *runtimev1.ScenarioJob) (*runtimev1.TextDecisionResult, *runtimev1.UsageStats, error) {
	head := job.GetHead()
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return nil, nil, err
	}
	release, acquireResult, err := s.scheduler.Acquire(jobCtx, head.GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, executionErr)
		return nil, nil, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return nil, nil, err
	}
	requestCtx, cancel, err := withTimeout(jobCtx, head.GetTimeoutMs(), defaultDecideTimeout)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return nil, nil, err
	}
	defer cancel()
	fail := func(err error) (*runtimev1.TextDecisionResult, *runtimev1.UsageStats, error) {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return nil, nil, err
	}
	captured, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		return fail(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	plan, err := decisionPlanFromResolvedAssembly(captured)
	if err != nil {
		return fail(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured decision ResolvedAssembly is invalid"}))
	}
	if s.localDecisionHost == nil {
		return fail(localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: fmt.Errorf("local decision execution host is unavailable")}))
	}
	result, err := s.localDecisionHost.ExecuteTextDecision(requestCtx, plan)
	if err != nil {
		return fail(localTextDecisionError(err))
	}
	// A result that completed after cancellation or the deadline is never published.
	if ctxErr := requestCtx.Err(); ctxErr != nil {
		kind := localexecution.FailureCanceled
		if scenarioDeadlineElapsed(requestCtx) {
			kind = localexecution.FailureTimeout
		}
		return fail(localExecutionError(&localexecution.ExecutionError{Kind: kind, Err: ctxErr}))
	}
	if err := validateTextDecisionResult(plan.Request, result.Result); err != nil {
		return fail(err)
	}
	var usage *runtimev1.UsageStats
	if result.InputTokens != 0 || result.ComputeMS != 0 {
		usage = &runtimev1.UsageStats{InputTokens: result.InputTokens, ComputeMs: result.ComputeMS}
	}
	if err := s.completeImmediateScenarioJob(jobID, nil, usage); err != nil {
		return fail(err)
	}
	return result.Result, usage, nil
}

// localTextDecisionError maps private Host phases to the existing local
// reasons and preserves typed input rejections such as AI_INPUT_LIMIT_EXCEEDED.
func localTextDecisionError(err error) error {
	var executionErr *localexecution.ExecutionError
	if errors.As(err, &executionErr) {
		return localExecutionError(err)
	}
	if _, ok := grpcerr.ExtractReasonCode(err); ok {
		return err
	}
	return localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureInference, Err: err})
}
