package localservice

import (
	"context"
	"errors"
	"strings"

	runtimeengine "github.com/nimiplatform/nimi/runtime/internal/engine"
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
		if privateEngineLifecycleHost(e.Engine) {
			continue
		}
		descriptors = append(descriptors, engineInfoToProto(e))
	}
	return &runtimev1.ListEnginesResponse{Engines: descriptors}, nil
}

func (s *Service) EnsureEngine(ctx context.Context, req *runtimev1.EnsureEngineRequest) (*runtimev1.EnsureEngineResponse, error) {
	_ = ctx
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    "engine package materialization is owned by local environment dependency jobs",
		ActionHint: "resolve_local_environment_plan_and_start_dependency_job",
		Metadata: map[string]string{
			"engine": engine,
			"detail": "EnsureEngine no longer performs materialization; use StartLocalEnvironmentDependencyJob for native engine packages",
		},
	})
}

func (s *Service) StartEngine(ctx context.Context, req *runtimev1.StartEngineRequest) (*runtimev1.StartEngineResponse, error) {
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if privateEngineLifecycleHost(engine) {
		return nil, privateExecutionHostEngineError()
	}
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	port := int(req.GetPort())
	version := strings.TrimSpace(req.GetVersion())
	if err := mgr.StartEngine(ctx, engine, port, version); err != nil {
		return nil, mapEngineManagerError(engine, "start", err)
	}
	info, _ := mgr.EngineStatus(engine)
	return &runtimev1.StartEngineResponse{Engine: engineInfoToProto(info)}, nil
}

func (s *Service) StopEngine(_ context.Context, req *runtimev1.StopEngineRequest) (*runtimev1.StopEngineResponse, error) {
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if privateEngineLifecycleHost(engine) {
		return nil, privateExecutionHostEngineError()
	}
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	// Get info before stopping for response.
	info, _ := mgr.EngineStatus(engine)
	if err := mgr.StopEngine(engine); err != nil {
		return nil, mapEngineManagerError(engine, "stop", err)
	}
	info.Status = "stopped"
	return &runtimev1.StopEngineResponse{Engine: engineInfoToProto(info)}, nil
}

func (s *Service) GetEngineStatus(_ context.Context, req *runtimev1.GetEngineStatusRequest) (*runtimev1.GetEngineStatusResponse, error) {
	engine := strings.TrimSpace(req.GetEngine())
	if engine == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if privateEngineLifecycleHost(engine) {
		return nil, privateExecutionHostEngineError()
	}
	mgr, err := s.getEngineManager()
	if err != nil {
		return nil, err
	}
	info, err := mgr.EngineStatus(engine)
	if err != nil {
		return nil, mapEngineManagerError(engine, "status", err)
	}
	return &runtimev1.GetEngineStatusResponse{Engine: engineInfoToProto(info)}, nil
}

func privateExecutionHostEngine(engine string) bool {
	return strings.EqualFold(strings.TrimSpace(engine), string(runtimeengine.EngineLlama))
}

func privateEngineLifecycleHost(engine string) bool {
	return privateExecutionHostEngine(engine) || strings.EqualFold(strings.TrimSpace(engine), string(runtimeengine.EngineSpeech))
}

func privateManagedSpeechExecutionHost(engine string, mode runtimev1.LocalEngineRuntimeMode) bool {
	return strings.EqualFold(strings.TrimSpace(engine), string(runtimeengine.EngineSpeech)) &&
		normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
}

func privateExecutionHostEngineError() error {
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, grpcerr.ReasonOptions{
		Message: "engine process lifecycle is private to the exact capability ExecutionHost",
	})
}

func mapEngineManagerError(engine string, operation string, err error) error {
	if err == nil {
		return nil
	}
	raw := strings.TrimSpace(err.Error())
	lower := strings.ToLower(raw)
	speechEngine := strings.EqualFold(strings.TrimSpace(engine), "speech")

	if strings.Contains(lower, "unknown engine") || strings.Contains(lower, "engine kind") {
		return wrapEngineManagerError(
			err,
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			"invalid engine for "+operation,
			"use_one_of_llama_media_speech_or_sidecar",
		)
	}

	if strings.Contains(lower, "already running") {
		return wrapEngineManagerError(
			err,
			codes.AlreadyExists,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			"engine already running",
			"query_engine_status_before_start",
		)
	}

	if errors.Is(err, runtimeengine.ErrEngineBinaryDependencyNotReady) ||
		strings.Contains(lower, "local environment dependency") ||
		strings.Contains(lower, "llama.cpp.package") {
		return wrapEngineManagerError(
			err,
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			"engine package is not ready",
			"resolve_local_environment_plan_and_start_dependency_job",
		)
	}

	if strings.Contains(lower, "not started") || strings.Contains(lower, "not found") {
		return wrapEngineManagerError(
			err,
			codes.NotFound,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			"engine not found",
			"start_or_ensure_engine_first",
		)
	}

	if strings.Contains(lower, "configure an attached endpoint instead") ||
		strings.Contains(lower, "requires windows x64") ||
		strings.Contains(lower, "requires an nvidia gpu") ||
		strings.Contains(lower, "requires a cuda-ready nvidia runtime") {
		if speechEngine {
			return wrapEngineManagerError(
				err,
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED,
				"local speech preflight blocked on this host",
				"configure_attached_endpoint_or_use_supported_host",
			)
		}
		return wrapEngineManagerError(
			err,
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			"engine supervised mode is unavailable on this host",
			"configure_attached_endpoint_or_use_supported_host",
		)
	}

	if speechEngine &&
		(strings.Contains(lower, "download") ||
			strings.Contains(lower, "ensure uv for speech") ||
			strings.Contains(lower, "ensure managed python for speech") ||
			strings.Contains(lower, "write speech server script") ||
			strings.Contains(lower, "install speech dependencies") ||
			strings.Contains(lower, "write speech dependency stamp")) {
		return wrapEngineManagerError(
			err,
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_SPEECH_ENV_INIT_FAILED,
			"local speech environment initialization failed",
			"retry_or_repair_local_speech_environment",
		)
	}

	if strings.Contains(lower, "hash mismatch") || strings.Contains(lower, "checksum") {
		return wrapEngineManagerError(
			err,
			codes.DataLoss,
			runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH,
			"engine binary checksum mismatch",
			"verify_llama_release_checksum",
		)
	}

	if strings.Contains(lower, "download") {
		return wrapEngineManagerError(
			err,
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_FAILED,
			"engine binary download failed",
			"retry_download_or_check_network",
		)
	}

	if strings.Contains(lower, "timed out") ||
		strings.Contains(lower, "health") ||
		strings.Contains(lower, "probe") ||
		strings.Contains(lower, "port") ||
		strings.Contains(lower, "connect") {
		if speechEngine {
			return wrapEngineManagerError(
				err,
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED,
				"local speech host unavailable during "+operation,
				"retry_or_check_local_speech_host",
			)
		}
		return wrapEngineManagerError(
			err,
			codes.Unavailable,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			"engine unavailable during "+operation,
			"retry_or_check_engine_runtime",
		)
	}

	return wrapEngineManagerError(
		err,
		codes.Internal,
		runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
		"engine operation failed",
		"retry_or_check_runtime_logs",
	)
}

func wrapEngineManagerError(
	err error,
	code codes.Code,
	reason runtimev1.ReasonCode,
	message string,
	actionHint string,
) error {
	return grpcerr.WrapWithReasonCode(
		code,
		reason,
		err,
		grpcerr.ReasonOptions{
			Message:    message,
			ActionHint: actionHint,
		},
	)
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
