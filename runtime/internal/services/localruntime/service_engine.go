package localruntime

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"

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
		return nil, grpcerr.WithReasonCodeOptions(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			grpcerr.ReasonOptions{
				Message:    "engine manager not available",
				ActionHint: "enable_supervised_engine_mode",
			},
		)
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	version := strings.TrimSpace(req.GetVersion())
	if err := mgr.EnsureEngine(ctx, engine, version); err != nil {
		return nil, mapEngineManagerError("ensure", err)
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	port := int(req.GetPort())
	version := strings.TrimSpace(req.GetVersion())
	if err := mgr.StartEngine(ctx, engine, port, version); err != nil {
		return nil, mapEngineManagerError("start", err)
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	// Get info before stopping for response.
	info, _ := mgr.EngineStatus(engine)
	if err := mgr.StopEngine(engine); err != nil {
		return nil, mapEngineManagerError("stop", err)
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
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	info, err := mgr.EngineStatus(engine)
	if err != nil {
		return nil, mapEngineManagerError("status", err)
	}
	return &runtimev1.GetEngineStatusResponse{Engine: engineInfoToProto(info)}, nil
}

func mapEngineManagerError(operation string, err error) error {
	if err == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	raw := strings.TrimSpace(err.Error())
	lower := strings.ToLower(raw)

	if strings.Contains(lower, "unknown engine") || strings.Contains(lower, "engine kind") {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{
			Message:    "invalid engine for " + operation,
			ActionHint: "use_one_of_localai_or_nexa",
			Metadata: map[string]string{
				"detail": raw,
			},
		})
	}

	if strings.Contains(lower, "already running") {
		return grpcerr.WithReasonCodeOptions(codes.AlreadyExists, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "engine already running",
			ActionHint: "query_engine_status_before_start",
			Metadata: map[string]string{
				"detail": raw,
			},
		})
	}

	if strings.Contains(lower, "not started") || strings.Contains(lower, "not found") {
		return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "engine not found",
			ActionHint: "start_or_ensure_engine_first",
			Metadata: map[string]string{
				"detail": raw,
			},
		})
	}

	if strings.Contains(lower, "nexa not found in path") {
		return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "nexa runtime not installed",
			ActionHint: "install_nexa_runtime",
			Metadata: map[string]string{
				"detail": raw,
			},
		})
	}

	if strings.Contains(lower, "timed out") ||
		strings.Contains(lower, "download") ||
		strings.Contains(lower, "health") ||
		strings.Contains(lower, "probe") ||
		strings.Contains(lower, "port") ||
		strings.Contains(lower, "connect") {
		return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "engine unavailable during " + operation,
			ActionHint: "retry_or_check_engine_runtime",
			Metadata: map[string]string{
				"detail": raw,
			},
		})
	}

	return grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, grpcerr.ReasonOptions{
		Message:    "engine operation failed",
		ActionHint: "retry_or_check_runtime_logs",
		Metadata: map[string]string{
			"detail": raw,
		},
	})
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
