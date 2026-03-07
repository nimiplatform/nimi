package workerproxy

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const localRuntimeWorkerRole = "localruntime"

// LocalRuntimeProxy forwards RuntimeLocalRuntimeService requests to the localruntime worker process.
type LocalRuntimeProxy struct {
	runtimev1.UnimplementedRuntimeLocalRuntimeServiceServer
	pool *ConnPool
}

func NewLocalRuntimeProxy(pool *ConnPool) *LocalRuntimeProxy {
	return &LocalRuntimeProxy{pool: pool}
}

func (s *LocalRuntimeProxy) ListLocalModels(ctx context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListLocalModels(ctx, req)
}

func (s *LocalRuntimeProxy) ListVerifiedModels(ctx context.Context, req *runtimev1.ListVerifiedModelsRequest) (*runtimev1.ListVerifiedModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListVerifiedModels(ctx, req)
}

func (s *LocalRuntimeProxy) SearchCatalogModels(ctx context.Context, req *runtimev1.SearchCatalogModelsRequest) (*runtimev1.SearchCatalogModelsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.SearchCatalogModels(ctx, req)
}

func (s *LocalRuntimeProxy) ResolveModelInstallPlan(ctx context.Context, req *runtimev1.ResolveModelInstallPlanRequest) (*runtimev1.ResolveModelInstallPlanResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ResolveModelInstallPlan(ctx, req)
}

func (s *LocalRuntimeProxy) InstallLocalModel(ctx context.Context, req *runtimev1.InstallLocalModelRequest) (*runtimev1.InstallLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.InstallLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) InstallVerifiedModel(ctx context.Context, req *runtimev1.InstallVerifiedModelRequest) (*runtimev1.InstallVerifiedModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.InstallVerifiedModel(ctx, req)
}

func (s *LocalRuntimeProxy) ImportLocalModel(ctx context.Context, req *runtimev1.ImportLocalModelRequest) (*runtimev1.ImportLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ImportLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) RemoveLocalModel(ctx context.Context, req *runtimev1.RemoveLocalModelRequest) (*runtimev1.RemoveLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.RemoveLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) StartLocalModel(ctx context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StartLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) StopLocalModel(ctx context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StopLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) CheckLocalModelHealth(ctx context.Context, req *runtimev1.CheckLocalModelHealthRequest) (*runtimev1.CheckLocalModelHealthResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.CheckLocalModelHealth(ctx, req)
}

func (s *LocalRuntimeProxy) WarmLocalModel(ctx context.Context, req *runtimev1.WarmLocalModelRequest) (*runtimev1.WarmLocalModelResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.WarmLocalModel(ctx, req)
}

func (s *LocalRuntimeProxy) CollectDeviceProfile(ctx context.Context, req *runtimev1.CollectDeviceProfileRequest) (*runtimev1.CollectDeviceProfileResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.CollectDeviceProfile(ctx, req)
}

func (s *LocalRuntimeProxy) ResolveDependencies(ctx context.Context, req *runtimev1.ResolveDependenciesRequest) (*runtimev1.ResolveDependenciesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ResolveDependencies(ctx, req)
}

func (s *LocalRuntimeProxy) ApplyDependencies(ctx context.Context, req *runtimev1.ApplyDependenciesRequest) (*runtimev1.ApplyDependenciesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ApplyDependencies(ctx, req)
}

func (s *LocalRuntimeProxy) ListLocalServices(ctx context.Context, req *runtimev1.ListLocalServicesRequest) (*runtimev1.ListLocalServicesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListLocalServices(ctx, req)
}

func (s *LocalRuntimeProxy) InstallLocalService(ctx context.Context, req *runtimev1.InstallLocalServiceRequest) (*runtimev1.InstallLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.InstallLocalService(ctx, req)
}

func (s *LocalRuntimeProxy) StartLocalService(ctx context.Context, req *runtimev1.StartLocalServiceRequest) (*runtimev1.StartLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StartLocalService(ctx, req)
}

func (s *LocalRuntimeProxy) StopLocalService(ctx context.Context, req *runtimev1.StopLocalServiceRequest) (*runtimev1.StopLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StopLocalService(ctx, req)
}

func (s *LocalRuntimeProxy) CheckLocalServiceHealth(ctx context.Context, req *runtimev1.CheckLocalServiceHealthRequest) (*runtimev1.CheckLocalServiceHealthResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.CheckLocalServiceHealth(ctx, req)
}

func (s *LocalRuntimeProxy) RemoveLocalService(ctx context.Context, req *runtimev1.RemoveLocalServiceRequest) (*runtimev1.RemoveLocalServiceResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.RemoveLocalService(ctx, req)
}

func (s *LocalRuntimeProxy) ListNodeCatalog(ctx context.Context, req *runtimev1.ListNodeCatalogRequest) (*runtimev1.ListNodeCatalogResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListNodeCatalog(ctx, req)
}

func (s *LocalRuntimeProxy) ListLocalAudits(ctx context.Context, req *runtimev1.ListLocalAuditsRequest) (*runtimev1.ListLocalAuditsResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListLocalAudits(ctx, req)
}

func (s *LocalRuntimeProxy) AppendInferenceAudit(ctx context.Context, req *runtimev1.AppendInferenceAuditRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.AppendInferenceAudit(ctx, req)
}

func (s *LocalRuntimeProxy) AppendRuntimeAudit(ctx context.Context, req *runtimev1.AppendRuntimeAuditRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.AppendRuntimeAudit(ctx, req)
}

func (s *LocalRuntimeProxy) ListEngines(ctx context.Context, req *runtimev1.ListEnginesRequest) (*runtimev1.ListEnginesResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.ListEngines(ctx, req)
}

func (s *LocalRuntimeProxy) EnsureEngine(ctx context.Context, req *runtimev1.EnsureEngineRequest) (*runtimev1.EnsureEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.EnsureEngine(ctx, req)
}

func (s *LocalRuntimeProxy) StartEngine(ctx context.Context, req *runtimev1.StartEngineRequest) (*runtimev1.StartEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StartEngine(ctx, req)
}

func (s *LocalRuntimeProxy) StopEngine(ctx context.Context, req *runtimev1.StopEngineRequest) (*runtimev1.StopEngineResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.StopEngine(ctx, req)
}

func (s *LocalRuntimeProxy) GetEngineStatus(ctx context.Context, req *runtimev1.GetEngineStatusRequest) (*runtimev1.GetEngineStatusResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(localRuntimeWorkerRole, err)
	}
	return client.GetEngineStatus(ctx, req)
}

func (s *LocalRuntimeProxy) client() (runtimev1.RuntimeLocalRuntimeServiceClient, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "worker_localruntime_unavailable")
	}
	conn, err := s.pool.Conn(localRuntimeWorkerRole)
	if err != nil {
		return nil, err
	}
	return runtimev1.NewRuntimeLocalRuntimeServiceClient(conn), nil
}
