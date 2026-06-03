package model

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type pullExecutor func(modelID string, complete func(runtimev1.ModelStatus))

type localModelLister interface {
	ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error)
}

const (
	defaultPullCompletionDelay   = 10 * time.Millisecond
	checkModelHealthProbeTimeout = 5 * time.Second
	localSidecarEndpointEnv      = "NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL"
)

// Service implements RuntimeModelService with an in-memory registry.
type Service struct {
	runtimev1.UnimplementedRuntimeModelServiceServer
	logger *slog.Logger

	mu              sync.Mutex
	registry        *modelregistry.Registry
	persistencePath string
	pullExecutor    pullExecutor
	localModel      localModelLister
}

func New(logger *slog.Logger, registry ...*modelregistry.Registry) *Service {
	models := modelregistry.New()
	if len(registry) > 0 && registry[0] != nil {
		models = registry[0]
	}
	svc := &Service{
		logger:       logger,
		registry:     models,
		pullExecutor: defaultPullExecutor,
	}
	return svc
}

func defaultPullExecutor(modelID string, complete func(runtimev1.ModelStatus)) {
	time.AfterFunc(defaultPullCompletionDelay, func() {
		complete(runtimev1.ModelStatus_MODEL_STATUS_INSTALLED)
	})
}

func (s *Service) SetPersistencePath(path string) {
	s.mu.Lock()
	s.persistencePath = strings.TrimSpace(path)
	s.mu.Unlock()
}

func (s *Service) SetPullExecutor(executor pullExecutor) {
	if executor != nil {
		s.mu.Lock()
		s.pullExecutor = executor
		s.mu.Unlock()
	}
}

func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.mu.Lock()
	s.localModel = localSvc
	s.mu.Unlock()
}

func (s *Service) ListModels(context.Context, *runtimev1.ListModelsRequest) (*runtimev1.ListModelsResponse, error) {
	models, err := s.registry.ListDescriptors()
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListModelsResponse{Models: models}, nil
}

func (s *Service) PullModel(_ context.Context, req *runtimev1.PullModelRequest) (*runtimev1.PullModelResponse, error) {
	if strings.TrimSpace(req.GetAppId()) == "" {
		return &runtimev1.PullModelResponse{
			TaskId:     "",
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}
	modelID, version := parseModelRef(req.GetModelRef())
	if modelID == "" {
		return &runtimev1.PullModelResponse{
			TaskId:     "",
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}

	now := time.Now().UTC()
	s.mu.Lock()
	entry, exists := s.registry.Get(modelID)
	if exists {
		if !canTransitionModel(entry.Status, runtimev1.ModelStatus_MODEL_STATUS_PULLING) {
			s.mu.Unlock()
			return nil, status.Errorf(codes.FailedPrecondition, "invalid model transition %s -> %s", entry.Status, runtimev1.ModelStatus_MODEL_STATUS_PULLING)
		}
		entry.Version = version
		entry.Status = runtimev1.ModelStatus_MODEL_STATUS_PULLING
		entry.Capabilities = modelregistry.InferCapabilities(modelID)
		entry.LastHealthAt = now
		entry.Source = strings.TrimSpace(req.GetSource())
		s.registry.Upsert(entry)
	} else {
		s.registry.Upsert(modelregistry.Entry{
			ModelID:      modelID,
			Version:      version,
			Status:       runtimev1.ModelStatus_MODEL_STATUS_PULLING,
			Capabilities: modelregistry.InferCapabilities(modelID),
			LastHealthAt: now,
			Source:       strings.TrimSpace(req.GetSource()),
		})
	}
	persistencePath := s.persistencePath
	executor := s.pullExecutor
	s.mu.Unlock()
	s.persistRegistryPath(persistencePath)

	taskID := ulid.Make().String()
	if executor != nil {
		executor(modelID, func(next runtimev1.ModelStatus) {
			if err := s.transitionModel(modelID, next); err != nil && s.logger != nil {
				s.logger.Warn("model transition failed", "model_id", modelID, "status", next, "error", err)
			}
		})
	}

	s.logger.Info("model pull accepted", "task_id", taskID, "model_id", modelID, "version", version, "app_id", req.GetAppId())
	return &runtimev1.PullModelResponse{
		TaskId:     taskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RemoveModel(_ context.Context, req *runtimev1.RemoveModelRequest) (*runtimev1.Ack, error) {
	if strings.TrimSpace(req.GetAppId()) == "" {
		return &runtimev1.Ack{
			Ok:         false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set app_id",
		}, nil
	}
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return &runtimev1.Ack{
			Ok:         false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set model_id",
		}, nil
	}

	s.mu.Lock()
	entry, exists := s.registry.Get(modelID)
	if !exists {
		s.mu.Unlock()
		return &runtimev1.Ack{
			Ok:         false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			ActionHint: "pull model first",
		}, nil
	}
	if !canTransitionModel(entry.Status, runtimev1.ModelStatus_MODEL_STATUS_REMOVED) {
		s.mu.Unlock()
		return nil, status.Errorf(codes.FailedPrecondition, "invalid model transition %s -> %s", entry.Status, runtimev1.ModelStatus_MODEL_STATUS_REMOVED)
	}

	s.registry.Remove(modelID)
	persistencePath := s.persistencePath
	s.mu.Unlock()
	s.persistRegistryPath(persistencePath)

	s.logger.Info("model removed", "model_id", modelID, "app_id", req.GetAppId())
	return &runtimev1.Ack{
		Ok:         true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) transitionModel(modelID string, next runtimev1.ModelStatus) error {
	s.mu.Lock()
	entry, exists := s.registry.Get(modelID)
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("model not found: %s", modelID)
	}
	if !canTransitionModel(entry.Status, next) {
		s.mu.Unlock()
		return fmt.Errorf("invalid model transition %s -> %s", entry.Status, next)
	}
	entry.Status = next
	entry.LastHealthAt = time.Now().UTC()
	s.registry.Upsert(entry)
	persistencePath := s.persistencePath
	s.mu.Unlock()
	s.persistRegistryPath(persistencePath)
	return nil
}

func (s *Service) persistRegistry() {
	s.mu.Lock()
	path := s.persistencePath
	s.mu.Unlock()
	s.persistRegistryPath(path)
}

func (s *Service) persistRegistryPath(path string) {
	if path == "" {
		return
	}
	if err := s.registry.SaveToFile(path); err != nil {
		s.logger.Error("persist model registry failed", "path", path, "error", err)
	}
}

func parseModelRef(raw string) (string, string) {
	ref := strings.TrimSpace(raw)
	if ref == "" {
		return "", ""
	}

	const defaultVersion = "latest"

	if idx := strings.LastIndex(ref, "@"); idx > 0 && idx < len(ref)-1 {
		modelID := strings.TrimSpace(ref[:idx])
		version := strings.TrimSpace(ref[idx+1:])
		if modelID != "" && version != "" {
			return modelID, version
		}
	}

	if strings.Count(ref, ":") == 1 && !strings.Contains(ref, "://") {
		parts := strings.SplitN(ref, ":", 2)
		modelID := strings.TrimSpace(parts[0])
		version := strings.TrimSpace(parts[1])
		if modelID != "" && version != "" {
			return modelID, version
		}
	}

	return ref, defaultVersion
}
