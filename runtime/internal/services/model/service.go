package model

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type pullExecutor func(modelID string, complete func(runtimev1.ModelStatus))

type localModelLister interface {
	ListLocalModels(context.Context, *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error)
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

func (s *Service) CheckModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	if appID == "" {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set app_id",
		}, nil
	}

	modelID := strings.TrimSpace(req.GetModelId())
	if modelID == "" {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			ActionHint: "set model_id",
		}, nil
	}

	if isLocalNativeModel(modelregistry.Entry{ModelID: modelID}) {
		if healthy, resolved, ok := s.checkLocalModelHealthViaLocalService(ctx, modelID); ok {
			if healthy {
				return &runtimev1.CheckModelHealthResponse{
					Healthy:    true,
					ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
				}, nil
			}
			return resolved, nil
		}
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

	projection, err := modelregistry.InferNativeProjection(item.ModelID, item.Capabilities, item.Files, item.Status)
	if err != nil {
		return &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_READY,
			ActionHint: "repair local model metadata",
		}, nil
	}
	if isLocalNativeModel(item) {
		probeCtx, cancel := context.WithTimeout(ctx, checkModelHealthProbeTimeout)
		defer cancel()

		if healthy, reasonCode, actionHint := checkLocalNativeModelHealth(probeCtx, item, projection); !healthy {
			return &runtimev1.CheckModelHealthResponse{
				Healthy:    false,
				ReasonCode: reasonCode,
				ActionHint: actionHint,
			}, nil
		}
	}

	return &runtimev1.CheckModelHealthResponse{
		Healthy:    true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) checkLocalModelHealthViaLocalService(ctx context.Context, modelID string) (bool, *runtimev1.CheckModelHealthResponse, bool) {
	s.mu.Lock()
	localModel := s.localModel
	s.mu.Unlock()
	if localModel == nil {
		return false, nil, false
	}

	models, err := s.listAllLocalModels(ctx, localModel)
	if err != nil {
		return false, nil, false
	}
	if len(models) == 0 {
		return false, nil, false
	}

	normalizedModelID := strings.TrimSpace(modelID)
	var selected *runtimev1.LocalModelRecord
	for _, model := range models {
		if model == nil || !strings.EqualFold(strings.TrimSpace(model.GetModelId()), normalizedModelID) {
			continue
		}
		if selected == nil || localModelStatusPriority(model.GetStatus()) < localModelStatusPriority(selected.GetStatus()) {
			selected = model
		}
	}
	if selected == nil {
		return false, nil, false
	}

	switch selected.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		return true, nil, true
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		return false, &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_READY,
			ActionHint: "warm local model",
		}, true
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		return false, &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE,
			ActionHint: "inspect_local_runtime_model_health",
		}, true
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
		return false, &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			ActionHint: "pull model first",
		}, true
	default:
		return false, nil, false
	}
}

func (s *Service) listAllLocalModels(ctx context.Context, localModel localModelLister) ([]*runtimev1.LocalModelRecord, error) {
	pageToken := ""
	collected := make([]*runtimev1.LocalModelRecord, 0, 16)
	for i := 0; i < 20; i++ {
		resp, err := localModel.ListLocalModels(ctx, &runtimev1.ListLocalModelsRequest{
			StatusFilter: runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED,
			PageSize:     100,
			PageToken:    pageToken,
		})
		if err != nil {
			return nil, err
		}
		collected = append(collected, resp.GetModels()...)
		pageToken = strings.TrimSpace(resp.GetNextPageToken())
		if pageToken == "" {
			break
		}
	}
	return collected, nil
}

func localModelStatusPriority(status runtimev1.LocalModelStatus) int {
	switch status {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		return 0
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
		return 1
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		return 2
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED:
		return 3
	default:
		return 4
	}
}

func isLocalNativeModel(item modelregistry.Entry) bool {
	if strings.EqualFold(strings.TrimSpace(item.Source), "local") {
		return true
	}
	lower := strings.ToLower(strings.TrimSpace(item.ModelID))
	for _, prefix := range []string{"local/", "llama/", "media/", "speech/", "sidecar/"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func checkLocalNativeModelHealth(
	ctx context.Context,
	item modelregistry.Entry,
	projection modelregistry.NativeProjection,
) (bool, runtimev1.ReasonCode, string) {
	if projection.BundleState != runtimev1.LocalBundleState_LOCAL_BUNDLE_STATE_READY {
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "finish local model install"
	}
	if projection.WarmState == runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model"
	}

	preferredEngine := strings.ToLower(strings.TrimSpace(projection.PreferredEngine))
	switch preferredEngine {
	case "llama":
		if projection.WarmState != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "warm local model"
		}
		if err := probeLlamaHealth(ctx); err != nil {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local llama engine"
		}
	case "media":
		if err := probeTargetCatalogHealth(ctx, resolveEngineEndpoint("NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL", engine.DefaultMediaConfig().Endpoint()), "media", projection.LogicalModelID, item.ModelID); err != nil {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local media engine"
		}
	case "speech":
		if err := probeTargetCatalogHealth(ctx, resolveEngineEndpoint("NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL", engine.DefaultSpeechConfig().Endpoint()), "speech", projection.LogicalModelID, item.ModelID); err != nil {
			return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "start local speech engine"
		}
	case "sidecar":
		if strings.TrimSpace(os.Getenv(localSidecarEndpointEnv)) == "" {
			return false, runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED, "set sidecar endpoint"
		}
		return false, runtimev1.ReasonCode_AI_MODEL_NOT_READY, "validate sidecar availability via a music request"
	}
	return true, runtimev1.ReasonCode_ACTION_EXECUTED, ""
}

func probeLlamaHealth(ctx context.Context) error {
	cfg := engine.DefaultLlamaConfig()
	return engine.ProbeHealth(ctx, resolveEngineEndpoint("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", cfg.Endpoint()), cfg.HealthPath, cfg.HealthResponse)
}

func resolveEngineEndpoint(envKey string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value
	}
	return strings.TrimSpace(fallback)
}

func probeTargetCatalogHealth(ctx context.Context, endpoint string, engineLabel string, expectedIDs ...string) error {
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if normalizedEndpoint == "" {
		return fmt.Errorf("%s endpoint missing", engineLabel)
	}
	switch engineLabel {
	case "media":
		if err := engine.ProbeMediaHealth(ctx, normalizedEndpoint); err != nil {
			return err
		}
	case "speech":
		if err := engine.ProbeSpeechHealth(ctx, normalizedEndpoint); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported engine probe: %s", engineLabel)
	}

	models, err := fetchReadyCatalogModels(ctx, normalizedEndpoint)
	if err != nil {
		return err
	}
	if len(models) == 0 {
		return fmt.Errorf("%s catalog missing ready models", engineLabel)
	}
	if hasComparableProbeModel(models, expectedIDs...) {
		return nil
	}
	return fmt.Errorf("%s catalog missing target model", engineLabel)
}

func fetchReadyCatalogModels(ctx context.Context, endpoint string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(endpoint, "/")+"/v1/catalog", nil)
	if err != nil {
		return nil, fmt.Errorf("build catalog probe: %w", err)
	}

	resp, err := (&http.Client{Timeout: checkModelHealthProbeTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("catalog probe failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("catalog probe returned status %d: %s", resp.StatusCode, string(body))
	}

	payload := struct {
		Models []struct {
			ID    string `json:"id"`
			Ready bool   `json:"ready"`
		} `json:"models"`
	}{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("catalog probe parse failed: %w", err)
	}

	readyModels := make([]string, 0, len(payload.Models))
	for _, model := range payload.Models {
		if strings.TrimSpace(model.ID) == "" || !model.Ready {
			continue
		}
		readyModels = append(readyModels, strings.TrimSpace(model.ID))
	}
	return readyModels, nil
}

func hasComparableProbeModel(models []string, expectedIDs ...string) bool {
	for _, expected := range expectedIDs {
		expectedComparable := comparableModelID(expected)
		expectedBase := comparableModelIDBase(expected)
		if expectedComparable == "" {
			continue
		}
		for _, modelID := range models {
			if comparableModelID(modelID) == expectedComparable {
				return true
			}
			if comparableModelIDBase(modelID) == expectedBase && expectedBase != "" {
				return true
			}
		}
	}
	return false
}

func comparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	for _, prefix := range []string{"models/", "model/", "local/", "llama/", "media/", "speech/", "sidecar/"} {
		comparable = strings.TrimPrefix(comparable, prefix)
	}
	return comparable
}

func comparableModelIDBase(value string) string {
	comparable := comparableModelID(value)
	if idx := strings.Index(comparable, "@"); idx > 0 {
		return strings.TrimSpace(comparable[:idx])
	}
	return comparable
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
