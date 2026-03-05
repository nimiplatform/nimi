package workflow

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
)

func aiExecuteScenario(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.ExecuteScenario(ctx, req)
}

func aiStreamScenario(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.StreamScenarioRequest) (grpc.ServerStreamingClient[runtimev1.StreamScenarioEvent], error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.StreamScenario(ctx, req)
}

func aiSubmitScenarioJob(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.SubmitScenarioJob(ctx, req)
}

func aiGetScenarioJob(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.GetScenarioJob(ctx, req)
}

func aiCancelScenarioJob(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.CancelScenarioJobRequest) (*runtimev1.CancelScenarioJobResponse, error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.CancelScenarioJob(ctx, req)
}

func aiGetScenarioArtifacts(ctx context.Context, client runtimev1.RuntimeAiServiceClient, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	if client == nil || req == nil {
		return nil, nil
	}
	return client.GetScenarioArtifacts(ctx, req)
}
