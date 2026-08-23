package ai

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localEmbedEffectiveInputs struct {
	loadoutID              string
	displayName            string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	driverIdentity         *runtimev1.CapabilityImplementationIdentity
	portableConfig         *structpb.Struct
	exactBindings          []capabilitydriver.InvocationExactBinding
	request                *runtimev1.TextEmbedScenarioSpec
	plan                   *capabilitydriver.EmbedInvocationPlan
	resolvedAssembly       *localResolvedAssembly
}

func (input *localEmbedEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.loadoutID
}

func (s *Service) captureLocalEmbedEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextEmbedScenarioSpec,
) (*localEmbedEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveLocalEmbedConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.TextEmbedCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	return s.captureSelectedLocalEmbedEffectiveInputs(spec, selected, intent.RequiredFeatures, "")
}

func (s *Service) captureSelectedLocalEmbedEffectiveInputs(
	spec *runtimev1.TextEmbedScenarioSpec,
	selected *localexecution.SelectedLocalExecution,
	requiredFeatures []string,
	expectedModelAssetID string,
) (*localEmbedEffectiveInputs, error) {
	if s == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if !validSelectedEmbedExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(requiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}
	expectedModelAssetID = strings.TrimSpace(expectedModelAssetID)
	if expectedModelAssetID != "" && (len(selected.ExactBindings) != 1 ||
		selected.ExactBindings[0].ModelAssetID != expectedModelAssetID) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	driver, reason := s.capabilityDrivers.Resolve(
		capabilitydriver.TextEmbedCapabilityContract,
		capabilitydriver.IdentityFromProto(selected.DriverIdentity),
	)
	embedDriver, ok := driver.(capabilitydriver.EmbedInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}

	exactBindings := projectInvocationExactBindings(selected.ExactBindings)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	request, _ := proto.Clone(spec).(*runtimev1.TextEmbedScenarioSpec)
	plan, err := embedDriver.PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: selected.ModelContextWindowTokens,
		ExactBindings:            append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		Request:                  request,
	})
	if err != nil {
		return nil, localTextInvocationError(err)
	}
	if plan == nil || plan.ProcessKey() == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	resolvedAssembly, err := localResolvedAssemblyForEmbed(selected, request, plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local embed ResolvedAssembly capture failed"})
	}
	effectiveInputIdentity, err := projectResolvedAssemblyEffectiveInputIdentity(resolvedAssembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local embed ResolvedAssembly attribution failed"})
	}
	implementation, _ := proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	return &localEmbedEffectiveInputs{
		loadoutID:              strings.TrimSpace(selected.LoadoutID),
		displayName:            strings.TrimSpace(selected.DisplayName),
		effectiveInputIdentity: effectiveInputIdentity,
		driverIdentity:         implementation,
		portableConfig:         portable,
		exactBindings:          exactBindings,
		request:                request,
		plan:                   plan,
		resolvedAssembly:       resolvedAssembly,
	}, nil
}

func (s *Service) localEmbedEffectiveInputsFromResolvedAssembly(assembly *localResolvedAssembly) (*localEmbedEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.TextEmbedCapabilityContract || assembly.Request.Kind != "text.embed" ||
		assembly.LoadPlan.Kind != "embed" || assembly.LoadPlan.Embed == nil {
		return nil, fmt.Errorf("local embed ResolvedAssembly contract is mismatched")
	}
	request := &runtimev1.TextEmbedScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, fmt.Errorf("decode local embed ResolvedAssembly request: %w", err)
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	if s == nil || s.capabilityDrivers == nil {
		return nil, fmt.Errorf("local embed Driver registry is unavailable")
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.TextEmbedCapabilityContract, capabilitydriver.Identity{
		ImplementationID: assembly.DriverIdentity.ImplementationID,
		DriverID:         assembly.DriverIdentity.DriverID,
		DriverDialect:    assembly.DriverIdentity.DriverDialect,
	})
	embedDriver, ok := driver.(capabilitydriver.EmbedInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured local embed Driver is unavailable")
	}
	plan, err := embedDriver.PlanEmbedInvocation(capabilitydriver.EmbedInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: assembly.LoadPlan.Embed.ContextWindowTokens,
		ExactBindings:            resolvedAssemblyExactBindings(assembly),
		Request:                  request,
	})
	if err != nil {
		return nil, err
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	selected.ModelContextWindowTokens = assembly.LoadPlan.Embed.ContextWindowTokens
	reprojected, err := localResolvedAssemblyForEmbed(selected, request, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localEmbedEffectiveInputs{loadoutID: assembly.LoadoutID, request: request, plan: plan}, nil
}

func validSelectedEmbedExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured &&
		strings.TrimSpace(selected.LoadoutID) != "" &&
		selected.CapabilityContract == capabilitydriver.TextEmbedCapabilityContract &&
		selected.DriverIdentity != nil &&
		len(selected.Requirements) > 0 && len(selected.Requirements) == len(selected.ExactBindings)
}

func (s *Service) resolveLocalEmbedConsumerIntent(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.TextEmbedCapabilityContract)
	return intent, err
}

func (s *Service) executeCapturedLocalEmbed(
	ctx context.Context,
	effective *localEmbedEffectiveInputs,
) (localexecution.EmbedResult, error) {
	if s == nil || effective == nil {
		return localexecution.EmbedResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	host, ok := s.localTextHost.(localexecution.EmbedExecutionHost)
	if !ok || host == nil {
		return localexecution.EmbedResult{}, localExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad,
			Err:  fmt.Errorf("local embedding execution host is unavailable"),
		})
	}
	result, err := host.ExecuteEmbed(ctx, effective.plan, nil)
	if err != nil {
		return localexecution.EmbedResult{}, localExecutionError(err)
	}
	if len(result.Vectors) != len(effective.request.GetInputs()) {
		return localexecution.EmbedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	dimension := 0
	for _, vector := range result.Vectors {
		if vector == nil || len(vector.GetValues()) == 0 {
			return localexecution.EmbedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if dimension == 0 {
			dimension = len(vector.GetValues())
		} else if len(vector.GetValues()) != dimension {
			return localexecution.EmbedResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	return result, nil
}

func (s *Service) executeCapturedLocalEmbedJob(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	effective *localEmbedEffectiveInputs,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (localexecution.EmbedResult, *runtimev1.UsageStats, *runtimev1.ScenarioJob, error) {
	if s == nil || head == nil || effective == nil {
		return localexecution.EmbedResult{}, nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	job, jobCtx, err := s.captureImmediateLocalScenarioJob(
		ctx, head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), ignored,
		effective.effectiveInputIdentity, effective.resolvedAssembly,
	)
	if err != nil {
		return localexecution.EmbedResult{}, nil, nil, err
	}
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return localexecution.EmbedResult{}, nil, job, err
	}
	release, acquireResult, err := s.scheduler.Acquire(jobCtx, head.GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, executionErr)
		return localexecution.EmbedResult{}, nil, job, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return localexecution.EmbedResult{}, nil, job, err
	}
	requestCtx, cancel, err := withTimeout(jobCtx, head.GetTimeoutMs(), defaultEmbedTimeout)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return localexecution.EmbedResult{}, nil, job, err
	}
	defer cancel()
	captured, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return localexecution.EmbedResult{}, nil, job, err
	}
	rehydrated, err := s.localEmbedEffectiveInputsFromResolvedAssembly(captured)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return localexecution.EmbedResult{}, nil, job, err
	}
	result, err := s.executeCapturedLocalEmbed(requestCtx, rehydrated)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return localexecution.EmbedResult{}, nil, job, err
	}
	var usage *runtimev1.UsageStats
	if result.InputTokens != 0 || result.ComputeMS != 0 {
		usage = &runtimev1.UsageStats{InputTokens: result.InputTokens, ComputeMs: result.ComputeMS}
	}
	if err := s.completeImmediateScenarioJob(jobID, nil, usage); err != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return localexecution.EmbedResult{}, nil, job, err
	}
	return result, usage, job, nil
}

func executeLocalTextEmbedScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.ExecuteScenarioResponse, error) {
	effective, err := s.captureLocalEmbedEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetTextEmbed())
	if err != nil {
		return nil, err
	}
	result, usage, job, err := s.executeCapturedLocalEmbedJob(ctx, req.GetHead(), effective, ignored)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextEmbed{
			TextEmbed: &runtimev1.TextEmbedOutput{Vectors: result.Vectors},
		}},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		TraceId:           job.GetTraceId(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}, nil
}
