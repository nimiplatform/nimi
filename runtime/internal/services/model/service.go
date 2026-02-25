package model

import (
	"context"
	"log/slog"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/oklog/ulid/v2"
)

// Service implements RuntimeModelService with an in-memory registry.
type Service struct {
	runtimev1.UnimplementedRuntimeModelServiceServer
	logger *slog.Logger

	registry        *modelregistry.Registry
	persistencePath string
}

func New(logger *slog.Logger, registry ...*modelregistry.Registry) *Service {
	models := modelregistry.New()
	if len(registry) > 0 && registry[0] != nil {
		models = registry[0]
	}
	return &Service{
		logger:   logger,
		registry: models,
	}
}

func (s *Service) SetPersistencePath(path string) {
	s.persistencePath = strings.TrimSpace(path)
}

func (s *Service) ListModels(context.Context, *runtimev1.ListModelsRequest) (*runtimev1.ListModelsResponse, error) {
	return &runtimev1.ListModelsResponse{Models: s.registry.ListDescriptors()}, nil
}

func (s *Service) PullModel(_ context.Context, req *runtimev1.PullModelRequest) (*runtimev1.PullModelResponse, error) {
	modelID, version := parseModelRef(req.GetModelRef())
	if modelID == "" {
		return &runtimev1.PullModelResponse{
			TaskId:     "",
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}

	taskID := ulid.Make().String()
	now := time.Now().UTC()

	s.registry.Upsert(modelregistry.Entry{
		ModelID:      modelID,
		Version:      version,
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: inferCapabilities(modelID),
		LastHealthAt: now,
		Source:       strings.TrimSpace(req.GetSource()),
	})
	s.persistRegistry()

	s.logger.Info("model pulled", "task_id", taskID, "model_id", modelID, "version", version, "app_id", req.GetAppId())

	return &runtimev1.PullModelResponse{
		TaskId:     taskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) RemoveModel(_ context.Context, req *runtimev1.RemoveModelRequest) (*runtimev1.Ack, error) {
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return &runtimev1.Ack{
			Ok:         false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set model_id",
		}, nil
	}

	exists := s.registry.Remove(modelID)

	if !exists {
		return &runtimev1.Ack{
			Ok:         false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			ActionHint: "pull model first",
		}, nil
	}
	s.persistRegistry()

	s.logger.Info("model removed", "model_id", modelID, "app_id", req.GetAppId())
	return &runtimev1.Ack{
		Ok:         true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) CheckModelHealth(_ context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set model_id",
		}, nil
	}

	item, exists := s.registry.Get(modelID)

	if !exists {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			ActionHint: "pull model first",
		}, nil
	}

	if item.Status != runtimev1.ModelStatus_MODEL_STATUS_INSTALLED {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_READY,
			ActionHint: "wait for install",
		}, nil
	}

	return &runtimev1.CheckModelHealthResponse{
		Healthy:    true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) persistRegistry() {
	if s.persistencePath == "" {
		return
	}
	if err := s.registry.SaveToFile(s.persistencePath); err != nil {
		s.logger.Error("persist model registry failed", "path", s.persistencePath, "error", err)
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

func inferCapabilities(modelID string) []string {
	caps := []string{"text.generate"}
	lower := strings.ToLower(modelID)

	if strings.Contains(lower, "embed") {
		caps = append(caps, "text.embed")
	}
	if strings.Contains(lower, "stt") || strings.Contains(lower, "whisper") {
		caps = append(caps, "audio.transcribe")
	}
	if strings.Contains(lower, "tts") {
		caps = append(caps, "audio.synthesize")
	}
	if strings.Contains(lower, "vision") || strings.Contains(lower, "vl") {
		caps = append(caps, "image.understand")
	}
	return caps
}
