package grpcserver

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aiservice "github.com/nimiplatform/nimi/runtime/internal/services/ai"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
)

// firstRunLocalExecutorAdapter bridges the runtime `ai` service first-run local
// execution capability to the `localservice.FirstRunLocalExecution` interface
// consumed by the executionEvidenceRef minter (K-AIEXEC-007). Both services are
// runtime-internal; the adapter only reshapes the result types and carries no
// state, so it satisfies the no-global-state and constructor-injection rules.
type firstRunLocalExecutorAdapter struct {
	ai *aiservice.Service
}

// newFirstRunLocalExecutorAdapter wires the ai service behind the localservice
// FirstRunLocalExecution interface.
func newFirstRunLocalExecutorAdapter(ai *aiservice.Service) localservice.FirstRunLocalExecution {
	return &firstRunLocalExecutorAdapter{ai: ai}
}

// ExecuteFirstRunLocalBaseline delegates to the ai service local-only first-run
// baseline execution path.
func (a *firstRunLocalExecutorAdapter) ExecuteFirstRunLocalBaseline(
	ctx context.Context,
	scenarioType runtimev1.ScenarioType,
	modelID string,
) (localservice.FirstRunLocalExecutionTarget, error) {
	result, err := a.ai.ExecuteFirstRunLocalBaseline(ctx, aiservice.FirstRunLocalExecutionRequest{
		ScenarioType: scenarioType,
		ModelID:      modelID,
	})
	if err != nil {
		return localservice.FirstRunLocalExecutionTarget{}, err
	}
	return localservice.FirstRunLocalExecutionTarget{
		RoutePolicy:      result.RoutePolicy,
		LocalRouteTarget: result.LocalRouteTarget,
		ModelResolved:    result.ModelResolved,
		TraceID:          result.TraceID,
	}, nil
}

// PeekFirstRunLocalBaseline delegates to the ai service submit-specific
// scheduling Peek for a single first-run baseline capability target.
func (a *firstRunLocalExecutorAdapter) PeekFirstRunLocalBaseline(
	ctx context.Context,
	capability string,
) (localservice.FirstRunLocalSchedulingJudgement, error) {
	judgement, err := a.ai.PeekFirstRunLocalBaseline(ctx, capability)
	if err != nil {
		return localservice.FirstRunLocalSchedulingJudgement{}, err
	}
	return localservice.FirstRunLocalSchedulingJudgement{
		Capability:      judgement.Capability,
		SchedulingState: judgement.SchedulingState,
		Detail:          judgement.Detail,
	}, nil
}
