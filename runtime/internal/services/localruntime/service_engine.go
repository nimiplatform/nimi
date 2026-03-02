package localruntime

import (
	"context"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// SetEngineManager injects the engine manager for supervised engine operations.
// This is optional — if nil, engine RPCs return FAILED_PRECONDITION.
func (s *Service) SetEngineManager(mgr EngineManager) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.engineMgr = mgr
}

func (s *Service) getEngineManager() (EngineManager, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.engineMgr == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "engine manager not available")
	}
	return s.engineMgr, nil
}

func (s *Service) ListEngines(_ context.Context, _ *runtimev1.ListEnginesRequest) (*runtimev1.ListEnginesResponse, error) {
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	engines := mgr.ListEngines()
	descriptors := make([]*runtimev1.LocalEngineDescriptor, 0, len(engines))
	for _, e := range engines {
		descriptors = append(descriptors, engineInfoToProto(e))
	}
	return &runtimev1.ListEnginesResponse{Engines: descriptors}, nil
}

func (s *Service) EnsureEngine(ctx context.Context, req *runtimev1.EnsureEngineRequest) (*runtimev1.EnsureEngineResponse, error) {
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, status.Errorf(codes.InvalidArgument, "engine is required")
	}
	version := strings.TrimSpace(req.GetVersion())
	if err := mgr.EnsureEngine(ctx, engine, version); err != nil {
		return nil, status.Errorf(codes.Internal, "ensure engine: %v", err)
	}
	info, _ := mgr.EngineStatus(engine)
	return &runtimev1.EnsureEngineResponse{Engine: engineInfoToProto(info)}, nil
}

func (s *Service) StartEngine(ctx context.Context, req *runtimev1.StartEngineRequest) (*runtimev1.StartEngineResponse, error) {
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, status.Errorf(codes.InvalidArgument, "engine is required")
	}
	port := int(req.GetPort())
	version := strings.TrimSpace(req.GetVersion())
	if err := mgr.StartEngine(ctx, engine, port, version); err != nil {
		return nil, status.Errorf(codes.Internal, "start engine: %v", err)
	}
	info, _ := mgr.EngineStatus(engine)
	return &runtimev1.StartEngineResponse{Engine: engineInfoToProto(info)}, nil
}

func (s *Service) StopEngine(_ context.Context, req *runtimev1.StopEngineRequest) (*runtimev1.StopEngineResponse, error) {
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, status.Errorf(codes.InvalidArgument, "engine is required")
	}
	// Get info before stopping for response.
	info, _ := mgr.EngineStatus(engine)
	if err := mgr.StopEngine(engine); err != nil {
		return nil, status.Errorf(codes.Internal, "stop engine: %v", err)
	}
	info.Status = "stopped"
	return &runtimev1.StopEngineResponse{Engine: engineInfoToProto(info)}, nil
}

func (s *Service) GetEngineStatus(_ context.Context, req *runtimev1.GetEngineStatusRequest) (*runtimev1.GetEngineStatusResponse, error) {
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, status.Errorf(codes.InvalidArgument, "engine is required")
	}
	info, err := mgr.EngineStatus(engine)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "engine status: %v", err)
	}
	return &runtimev1.GetEngineStatusResponse{Engine: engineInfoToProto(info)}, nil
}

func engineInfoToProto(info EngineInfo) *runtimev1.LocalEngineDescriptor {
	return &runtimev1.LocalEngineDescriptor{
		Engine:              info.Engine,
		Version:             info.Version,
		Endpoint:            info.Endpoint,
		Port:                int32(info.Port),
		Status:              engineStatusToProto(info.Status),
		Pid:                 int32(info.PID),
		Platform:            info.Platform,
		BinaryPath:          info.BinaryPath,
		BinarySizeBytes:     info.BinarySizeBytes,
		StartedAt:           info.StartedAt,
		LastHealthyAt:       info.LastHealthyAt,
		ConsecutiveFailures: int32(info.ConsecutiveFailures),
	}
}

func engineStatusToProto(status string) runtimev1.LocalEngineStatus {
	switch status {
	case "stopped":
		return runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED
	case "starting":
		return runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STARTING
	case "healthy":
		return runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY
	case "unhealthy":
		return runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNHEALTHY
	default:
		return runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED
	}
}
