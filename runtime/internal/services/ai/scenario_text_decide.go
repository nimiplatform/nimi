package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// textDecisionExecution is the validated terminal outcome of one captured
// text.decide immediate Job.
type textDecisionExecution struct {
	result        *runtimev1.TextDecisionResult
	usage         *runtimev1.UsageStats
	job           *runtimev1.ScenarioJob
	route         runtimev1.RoutePolicy
	modelResolved string
}

func executeTextDecideScenario(ctx context.Context, s *Service, req *runtimev1.ExecuteScenarioRequest, ignored []*runtimev1.IgnoredScenarioExtension) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	spec := req.GetSpec().GetTextDecide()
	if err := validateTextDecideSpec(spec); err != nil {
		return nil, err
	}
	intent, err := scenarioExecutionIntentFromContext(ctx, aicapabilities.TextDecide)
	if err != nil {
		return nil, err
	}
	var execution textDecisionExecution
	if intent.IsLocal() {
		execution, err = s.executeLocalTextDecision(ctx, req.GetHead(), spec, ignored)
	} else {
		execution, err = s.executeCloudTextDecision(ctx, req.GetHead(), spec, ignored)
	}
	if err != nil {
		return nil, err
	}
	if err := validateTextDecisionResult(spec, execution.result); err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextDecision{
			TextDecision: execution.result,
		}},
		FinishReason:      runtimev1.FinishReason_FINISH_REASON_STOP,
		Usage:             execution.usage,
		RouteDecision:     execution.route,
		ModelResolved:     execution.modelResolved,
		TraceId:           execution.job.GetTraceId(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}, nil
}
