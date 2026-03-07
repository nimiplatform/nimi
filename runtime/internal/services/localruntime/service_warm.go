package localruntime

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

const (
	defaultWarmLocalModelTimeout  = 60 * time.Second
	maxWarmLocalModelTimeout      = 5 * time.Minute
	warmManagedProbeRetryInterval = 200 * time.Millisecond
)

func (s *Service) WarmLocalModel(ctx context.Context, req *runtimev1.WarmLocalModelRequest) (*runtimev1.WarmLocalModelResponse, error) {
	if req == nil || strings.TrimSpace(req.GetLocalModelId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := s.modelByID(req.GetLocalModelId())
	if model == nil || model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if !modelSupportsWarmup(model) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}

	timeout := warmLocalModelTimeout(req.GetTimeoutMs())
	startedAt := time.Now()
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	endpoint := modelProbeEndpoint(model)
	if err := s.bootstrapEngineIfManaged(requestCtx, model.GetEngine(), endpoint); err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    strings.TrimSpace(err.Error()),
			ActionHint: "check_local_runtime_engine",
		})
	}

	registration := s.localAIRegistrationForModel(model)
	probe := s.waitForWarmProbe(requestCtx, model, registration, endpoint)
	if !modelProbeSucceeded(model, probe, registration) {
		detail := modelProbeFailureDetail(model, probe, registration)
		if requestCtx.Err() != nil {
			detail = appendWarmWaitDetail(detail, requestCtx.Err())
		}
		if err := s.recordWarmProbeFailure(model, detail); err != nil {
			return nil, err
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
		})
	}

	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		activeModel, err := s.updateModelStatus(model.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active")
		if err != nil {
			return nil, err
		}
		model = activeModel
	}

	traceID := ulid.Make().String()
	modelResolved := normalizeWarmResolvedModelID(model.GetModelId())
	warmKey := warmCacheKey(model, endpoint, modelResolved)
	if s.isWarmKeyCached(warmKey) {
		return s.newWarmLocalModelResponse(model, modelResolved, endpoint, true, startedAt, traceID), nil
	}

	backend := nimillm.NewBackend("local-runtime-warmup", endpoint, "", timeout)
	if backend == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local runtime endpoint is not configured",
			ActionHint: "check_local_runtime_endpoint",
		})
	}
	if _, _, _, err := backend.GenerateText(
		requestCtx,
		modelResolved,
		[]*runtimev1.ChatMessage{{Role: "user", Content: "Respond with the single word ready."}},
		"",
		0,
		0,
		1,
	); err != nil {
		return nil, err
	}

	s.recordWarmKey(warmKey)
	s.appendWarmLocalModelAudit(model, modelResolved, endpoint, traceID, startedAt)
	return s.newWarmLocalModelResponse(model, modelResolved, endpoint, false, startedAt, traceID), nil
}

func modelSupportsWarmup(model *runtimev1.LocalModelRecord) bool {
	if model == nil {
		return false
	}
	for _, capability := range model.GetCapabilities() {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized == "chat" || normalized == "text.generate" {
			return true
		}
	}
	return false
}

func normalizeWarmResolvedModelID(modelID string) string {
	normalized := strings.TrimSpace(modelID)
	lower := strings.ToLower(normalized)
	switch {
	case strings.HasPrefix(lower, "localai/"):
		return strings.TrimSpace(normalized[len("localai/"):])
	case strings.HasPrefix(lower, "nexa/"):
		return strings.TrimSpace(normalized[len("nexa/"):])
	case strings.HasPrefix(lower, "local/"):
		return strings.TrimSpace(normalized[len("local/"):])
	default:
		return normalized
	}
}

func warmLocalModelTimeout(timeoutMS int32) time.Duration {
	if timeoutMS <= 0 {
		return defaultWarmLocalModelTimeout
	}
	requested := time.Duration(timeoutMS) * time.Millisecond
	if requested > maxWarmLocalModelTimeout {
		return maxWarmLocalModelTimeout
	}
	return requested
}

func shouldRetryWarmProbe(engine string, endpoint string) bool {
	_, shouldManage, err := parseManagedEndpointPort(engine, endpoint)
	return err == nil && shouldManage
}

func (s *Service) waitForWarmProbe(
	ctx context.Context,
	model *runtimev1.LocalModelRecord,
	registration localAIRegistration,
	endpoint string,
) endpointProbeResult {
	probe := s.probeEndpoint(ctx, endpoint)
	if modelProbeSucceeded(model, probe, registration) || probe.healthy || !shouldRetryWarmProbe(model.GetEngine(), endpoint) {
		return probe
	}

	timer := time.NewTimer(warmManagedProbeRetryInterval)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return probe
		case <-timer.C:
		}

		probe = s.probeEndpoint(ctx, endpoint)
		if modelProbeSucceeded(model, probe, registration) || probe.healthy {
			return probe
		}
		timer.Reset(warmManagedProbeRetryInterval)
	}
}

func (s *Service) recordWarmProbeFailure(model *runtimev1.LocalModelRecord, detail string) error {
	if model == nil {
		return nil
	}
	switch model.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		if _, err := s.updateModelStatus(model.GetLocalModelId(), runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail); err != nil {
			return err
		}
	default:
		s.setModelHealthDetail(model.GetLocalModelId(), detail)
	}
	return nil
}

func appendWarmWaitDetail(detail string, err error) string {
	base := strings.TrimSpace(detail)
	if err == nil {
		return base
	}
	waitDetail := "warm_wait_error=" + strings.TrimSpace(err.Error())
	if base == "" {
		return waitDetail
	}
	return base + "; " + waitDetail
}

func warmCacheKey(model *runtimev1.LocalModelRecord, endpoint string, modelResolved string) string {
	if model == nil {
		return ""
	}
	return strings.Join([]string{
		strings.TrimSpace(model.GetLocalModelId()),
		strings.TrimSpace(endpoint),
		strings.TrimSpace(model.GetUpdatedAt()),
		strings.TrimSpace(modelResolved),
	}, "|")
}

func (s *Service) isWarmKeyCached(key string) bool {
	if s == nil || strings.TrimSpace(key) == "" {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.warmedModelKeys[key]
	return ok
}

func (s *Service) recordWarmKey(key string) {
	if s == nil || strings.TrimSpace(key) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.warmedModelKeys[key] = struct{}{}
}

func (s *Service) appendWarmLocalModelAudit(
	model *runtimev1.LocalModelRecord,
	modelResolved string,
	endpoint string,
	traceID string,
	startedAt time.Time,
) {
	if s == nil || model == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.appendRuntimeAuditLocked(&runtimev1.LocalAuditEvent{
		Id:            "audit_" + ulid.Make().String(),
		EventType:     "runtime_model_warmed",
		OccurredAt:    nowISO(),
		Source:        "local-runtime",
		ModelId:       model.GetModelId(),
		LocalModelId:  model.GetLocalModelId(),
		TraceId:       traceID,
		Operation:     "warm_local_model",
		Detail:        "local model warm-up completed",
		SubjectUserId: "",
		Payload: toStruct(map[string]any{
			"endpoint":      strings.TrimSpace(endpoint),
			"engine":        strings.TrimSpace(model.GetEngine()),
			"latency_ms":    time.Since(startedAt).Milliseconds(),
			"modelResolved": strings.TrimSpace(modelResolved),
		}),
	})
}

func (s *Service) newWarmLocalModelResponse(
	model *runtimev1.LocalModelRecord,
	modelResolved string,
	endpoint string,
	alreadyWarm bool,
	startedAt time.Time,
	traceID string,
) *runtimev1.WarmLocalModelResponse {
	return &runtimev1.WarmLocalModelResponse{
		LocalModelId:  strings.TrimSpace(model.GetLocalModelId()),
		ModelId:       strings.TrimSpace(model.GetModelId()),
		ModelResolved: strings.TrimSpace(modelResolved),
		Endpoint:      strings.TrimSpace(endpoint),
		Engine:        strings.TrimSpace(model.GetEngine()),
		AlreadyWarm:   alreadyWarm,
		LatencyMs:     maxInt64(time.Since(startedAt).Milliseconds(), 0),
		TraceId:       strings.TrimSpace(traceID),
	}
}

func maxInt64(a int64, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
