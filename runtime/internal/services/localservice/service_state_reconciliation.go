package localservice

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const localStateReconciliationNotRequired = "not_required"

func (s *Service) ResolveLocalStateReconciliation(_ context.Context, _ *runtimev1.ResolveLocalStateReconciliationRequest) (*runtimev1.ResolveLocalStateReconciliationResponse, error) {
	return &runtimev1.ResolveLocalStateReconciliationResponse{
		Plan: &runtimev1.LocalStateReconciliationPlan{
			State:      localStateReconciliationNotRequired,
			ReasonCode: "LOCAL_STATE_CUTOVER_REMOVED",
			Message:    "Runtime local state cutover has been removed; copy local-state.json into the active runtime state path and restart Runtime.",
		},
	}, nil
}

func (s *Service) ExecuteLocalStateCutover(_ context.Context, _ *runtimev1.ExecuteLocalStateCutoverRequest) (*runtimev1.ExecuteLocalStateCutoverResponse, error) {
	return nil, grpcerr.WithReasonCodeOptions(codes.Unimplemented, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    "Runtime local state cutover has been removed; copy local-state.json into the active runtime state path and restart Runtime.",
		ActionHint: "copy_local_state_and_restart_runtime",
	})
}
