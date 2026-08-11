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
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localEmbedEffectiveInputs struct {
	configurationID string
	displayName     string
	driverIdentity  *runtimev1.CapabilityImplementationIdentity
	portableConfig  *structpb.Struct
	exactBindings   []capabilitydriver.InvocationExactBinding
	request         *runtimev1.TextEmbedScenarioSpec
	plan            *capabilitydriver.EmbedInvocationPlan
}

func (input *localEmbedEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.configurationID
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
	return s.captureSelectedLocalEmbedEffectiveInputs(spec, intent.RequiredFeatures, "")
}

func (s *Service) captureSelectedLocalEmbedEffectiveInputs(
	spec *runtimev1.TextEmbedScenarioSpec,
	requiredFeatures []string,
	expectedLocalAssetID string,
) (*localEmbedEffectiveInputs, error) {
	if s == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.TextEmbedCapabilityContract)
	if err != nil {
		return nil, err
	}
	if !validSelectedEmbedExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(requiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}
	expectedLocalAssetID = strings.TrimSpace(expectedLocalAssetID)
	if expectedLocalAssetID != "" && (len(selected.ExactBindings) != 1 ||
		selected.ExactBindings[0].LocalAssetID != expectedLocalAssetID) {
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

	exactBindings := make([]capabilitydriver.InvocationExactBinding, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		exactBindings = append(exactBindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     binding.RequirementID,
			LocalAssetID:      binding.LocalAssetID,
			AbsolutePath:      binding.AbsolutePath,
			VerifiedContentID: binding.VerifiedContentID,
			EntrySHA256:       binding.EntrySHA256,
		})
	}
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
	implementation, _ := proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	return &localEmbedEffectiveInputs{
		configurationID: strings.TrimSpace(selected.ConfigurationID),
		displayName:     strings.TrimSpace(selected.DisplayName),
		driverIdentity:  implementation,
		portableConfig:  portable,
		exactBindings:   exactBindings,
		request:         request,
		plan:            plan,
	}, nil
}

func validSelectedEmbedExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured &&
		strings.TrimSpace(selected.ConfigurationID) != "" &&
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
	release, acquireResult, err := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if err != nil {
		return nil, schedulerAcquireError(err)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	requestCtx, cancel, err := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultEmbedTimeout)
	if err != nil {
		return nil, err
	}
	defer cancel()

	result, err := s.executeCapturedLocalEmbed(requestCtx, effective)
	if err != nil {
		return nil, err
	}
	usage := (*runtimev1.UsageStats)(nil)
	if result.InputTokens != 0 || result.ComputeMS != 0 {
		usage = &runtimev1.UsageStats{InputTokens: result.InputTokens, ComputeMs: result.ComputeMS}
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextEmbed{
			TextEmbed: &runtimev1.TextEmbedOutput{Vectors: result.Vectors},
		}},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}, nil
}
