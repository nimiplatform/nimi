package workerproxy

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const modelWorkerRole = "model"

// ModelProxy forwards RuntimeModelService requests to the model worker process.
type ModelProxy struct {
	runtimev1.UnimplementedRuntimeModelServiceServer
	pool *ConnPool
}

func NewModelProxy(pool *ConnPool) *ModelProxy {
	return &ModelProxy{pool: pool}
}

func (s *ModelProxy) ListModels(ctx context.Context, req *runtimev1.ListModelsRequest) (*runtimev1.ListModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(modelWorkerRole, err)
	}
	return client.ListModels(ctx, req)
}

func (s *ModelProxy) PullModel(ctx context.Context, req *runtimev1.PullModelRequest) (*runtimev1.PullModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(modelWorkerRole, err)
	}
	return client.PullModel(ctx, req)
}

func (s *ModelProxy) RemoveModel(ctx context.Context, req *runtimev1.RemoveModelRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(modelWorkerRole, err)
	}
	return client.RemoveModel(ctx, req)
}

func (s *ModelProxy) CheckModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(modelWorkerRole, err)
	}
	return client.CheckModelHealth(ctx, req)
}

func (s *ModelProxy) client() (runtimev1.RuntimeModelServiceClient, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "worker_model_unavailable")
	}
	conn, err := s.pool.Conn(modelWorkerRole)
	if err != nil {
		return nil, err
	}
	return runtimev1.NewRuntimeModelServiceClient(conn), nil
}
