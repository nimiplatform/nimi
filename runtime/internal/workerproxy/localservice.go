package workerproxy

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const localServiceWorkerRole = "local"

// LocalServiceProxy forwards RuntimeLocalService requests to the local worker process.
type LocalServiceProxy struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer
	pool *ConnPool
}

func NewLocalServiceProxy(pool *ConnPool) *LocalServiceProxy {
	return &LocalServiceProxy{pool: pool}
}

func (s *LocalServiceProxy) ListLocalModels(ctx context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListLocalModels(ctx, req)
}

func (s *LocalServiceProxy) ListLocalArtifacts(ctx context.Context, req *runtimev1.ListLocalArtifactsRequest) (*runtimev1.ListLocalArtifactsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListLocalArtifacts(ctx, req)
}

func (s *LocalServiceProxy) ListVerifiedModels(ctx context.Context, req *runtimev1.ListVerifiedModelsRequest) (*runtimev1.ListVerifiedModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListVerifiedModels(ctx, req)
}

func (s *LocalServiceProxy) ListVerifiedArtifacts(ctx context.Context, req *runtimev1.ListVerifiedArtifactsRequest) (*runtimev1.ListVerifiedArtifactsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListVerifiedArtifacts(ctx, req)
}

func (s *LocalServiceProxy) SearchCatalogModels(ctx context.Context, req *runtimev1.SearchCatalogModelsRequest) (*runtimev1.SearchCatalogModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.SearchCatalogModels(ctx, req)
}

func (s *LocalServiceProxy) ResolveModelInstallPlan(ctx context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ResolveModelInstallPlan(ctx, req)
}

func (s *LocalServiceProxy) InstallLocalModel(ctx context.Context, req *runtimev1.InstallLocalModelRequest) (*runtimev1.InstallLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.InstallLocalModel(ctx, req)
}

func (s *LocalServiceProxy) InstallVerifiedModel(ctx context.Context, req *runtimev1.InstallVerifiedModelRequest) (*runtimev1.InstallVerifiedModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.InstallVerifiedModel(ctx, req)
}

func (s *LocalServiceProxy) InstallVerifiedArtifact(ctx context.Context, req *runtimev1.InstallVerifiedArtifactRequest) (*runtimev1.InstallVerifiedArtifactResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.InstallVerifiedArtifact(ctx, req)
}

func (s *LocalServiceProxy) ImportLocalModel(ctx context.Context, req *runtimev1.ImportLocalModelRequest) (*runtimev1.ImportLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ImportLocalModel(ctx, req)
}

func (s *LocalServiceProxy) ImportLocalArtifact(ctx context.Context, req *runtimev1.ImportLocalArtifactRequest) (*runtimev1.ImportLocalArtifactResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ImportLocalArtifact(ctx, req)
}

func (s *LocalServiceProxy) RemoveLocalModel(ctx context.Context, req *runtimev1.RemoveLocalModelRequest) (*runtimev1.RemoveLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.RemoveLocalModel(ctx, req)
}

func (s *LocalServiceProxy) RemoveLocalArtifact(ctx context.Context, req *runtimev1.RemoveLocalArtifactRequest) (*runtimev1.RemoveLocalArtifactResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.RemoveLocalArtifact(ctx, req)
}

func (s *LocalServiceProxy) StartLocalModel(ctx context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StartLocalModel(ctx, req)
}

func (s *LocalServiceProxy) StopLocalModel(ctx context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StopLocalModel(ctx, req)
}

func (s *LocalServiceProxy) CheckLocalModelHealth(ctx context.Context, req *runtimev1.CheckLocalModelHealthRequest) (*runtimev1.CheckLocalModelHealthResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.CheckLocalModelHealth(ctx, req)
}

func (s *LocalServiceProxy) WarmLocalModel(ctx context.Context, req *runtimev1.WarmLocalModelRequest) (*runtimev1.WarmLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.WarmLocalModel(ctx, req)
}

func (s *LocalServiceProxy) CollectDeviceProfile(ctx context.Context, req *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.CollectDeviceProfile(ctx, req)
}

func (s *LocalServiceProxy) ResolveDependencies(ctx context.Context, req *runtimev1.ResolveDependenciesRequest) (*runtimev1.ResolveDependenciesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ResolveDependencies(ctx, req)
}

func (s *LocalServiceProxy) ApplyDependencies(ctx context.Context, req *runtimev1.ApplyDependenciesRequest) (*runtimev1.ApplyDependenciesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ApplyDependencies(ctx, req)
}

func (s *LocalServiceProxy) ListLocalServices(ctx context.Context, req *runtimev1.ListLocalServicesRequest) (*runtimev1.ListLocalServicesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListLocalServices(ctx, req)
}

func (s *LocalServiceProxy) InstallLocalService(ctx context.Context, req *runtimev1.InstallLocalServiceRequest) (*runtimev1.InstallLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.InstallLocalService(ctx, req)
}

func (s *LocalServiceProxy) StartLocalService(ctx context.Context, req *runtimev1.StartLocalServiceRequest) (*runtimev1.StartLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StartLocalService(ctx, req)
}

func (s *LocalServiceProxy) StopLocalService(ctx context.Context, req *runtimev1.StopLocalServiceRequest) (*runtimev1.StopLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StopLocalService(ctx, req)
}

func (s *LocalServiceProxy) CheckLocalServiceHealth(ctx context.Context, req *runtimev1.CheckLocalServiceHealthRequest) (*runtimev1.CheckLocalServiceHealthResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.CheckLocalServiceHealth(ctx, req)
}

func (s *LocalServiceProxy) RemoveLocalService(ctx context.Context, req *runtimev1.RemoveLocalServiceRequest) (*runtimev1.RemoveLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.RemoveLocalService(ctx, req)
}

func (s *LocalServiceProxy) ListNodeCatalog(ctx context.Context, req *runtimev1.ListNodeCatalogRequest) (*runtimev1.ListNodeCatalogResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListNodeCatalog(ctx, req)
}

func (s *LocalServiceProxy) ListLocalAudits(ctx context.Context, req *runtimev1.ListLocalAuditsRequest) (*runtimev1.ListLocalAuditsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListLocalAudits(ctx, req)
}

func (s *LocalServiceProxy) AppendInferenceAudit(ctx context.Context, req *runtimev1.AppendInferenceAuditRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.AppendInferenceAudit(ctx, req)
}

func (s *LocalServiceProxy) AppendRuntimeAudit(ctx context.Context, req *runtimev1.AppendRuntimeAuditRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.AppendRuntimeAudit(ctx, req)
}

func (s *LocalServiceProxy) ListEngines(ctx context.Context, req *runtimev1.ListEnginesRequest) (*runtimev1.ListEnginesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.ListEngines(ctx, req)
}

func (s *LocalServiceProxy) EnsureEngine(ctx context.Context, req *runtimev1.EnsureEngineRequest) (*runtimev1.EnsureEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.EnsureEngine(ctx, req)
}

func (s *LocalServiceProxy) StartEngine(ctx context.Context, req *runtimev1.StartEngineRequest) (*runtimev1.StartEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StartEngine(ctx, req)
}

func (s *LocalServiceProxy) StopEngine(ctx context.Context, req *runtimev1.StopEngineRequest) (*runtimev1.StopEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.StopEngine(ctx, req)
}

func (s *LocalServiceProxy) GetEngineStatus(ctx context.Context, req *runtimev1.GetEngineStatusRequest) (*runtimev1.GetEngineStatusResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localServiceWorkerRole, err)
	}
	return client.GetEngineStatus(ctx, req)
}

func (s *LocalServiceProxy) client() (runtimev1.RuntimeLocalServiceClient, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "worker_local_unavailable")
	}
	conn, err := s.pool.Conn(localServiceWorkerRole)
	if err != nil {
		return nil, err
	}
	return runtimev1.NewRuntimeLocalServiceClient(conn), nil
}
