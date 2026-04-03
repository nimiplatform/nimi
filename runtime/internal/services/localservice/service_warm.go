package localservice

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

type warmLocalModelExecutionState struct {
	startedAt     time.Time
	traceID       string
	modelResolved string
	alreadyWarm   bool
}

func (s *Service) WarmLocalAsset(ctx context.Context, req *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetLocalAssetId()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := s.modelByID(req.GetLocalAssetId())
	if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if healedModel, _, err := s.healManagedSupervisedLlamaRuntimeMode(model.GetLocalAssetId()); err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    managedLocalAssetRecordFailureDetail(err),
			ActionHint: "inspect_local_runtime_model_health",
		})
	} else if healedModel != nil {
		model = healedModel
	}
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(model.GetLocalAssetId())); err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    managedLocalAssetRecordFailureDetail(err),
			ActionHint: "inspect_local_runtime_model_health",
		})
	}
	if !modelSupportsWarmup(model) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}

	timeout := warmLocalModelTimeout(req.GetTimeoutMs())
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	if _, _, err := s.ensureManagedLocalModelBundleReady(requestCtx, model); err != nil {
		detail := managedLocalModelBundleFailureDetail(err)
		if recordErr := s.recordWarmFailure(model, detail, false); recordErr != nil {
			return nil, recordErr
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
		})
	}
	if refreshed := s.modelByID(model.GetLocalAssetId()); refreshed != nil {
		model = refreshed
	}
	registration := s.managedLlamaRegistrationForModel(model)
	if strings.TrimSpace(registration.Problem) != "" {
		detail := managedLocalModelRegistrationFailureDetail(registration.Problem)
		if recordErr := s.recordWarmFailure(model, detail, false); recordErr != nil {
			return nil, recordErr
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
		})
	}

	endpoint := s.effectiveLocalModelEndpoint(model)
	if err := s.bootstrapLocalModelIfManaged(requestCtx, model); err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    strings.TrimSpace(err.Error()),
			ActionHint: "check_local_runtime_engine",
		})
	}

	probe := s.waitForWarmProbe(requestCtx, model, registration, endpoint)
	if !modelProbeSucceeded(model, probe, registration) {
		detail := modelProbeFailureDetail(model, probe, registration)
		if requestCtx.Err() != nil {
			detail = appendWarmWaitDetail(detail, requestCtx.Err())
		}
		if err := s.recordWarmFailure(model, detail, false); err != nil {
			return nil, err
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
		})
	}

	result, err := s.performWarmLocalModelExecution(requestCtx, model, endpoint, timeout)
	if err != nil {
		detail := warmExecutionFailureDetail(err)
		if recordErr := s.recordWarmFailure(model, detail, true); recordErr != nil {
			return nil, recordErr
		}
		return nil, err
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		activeModel, err := s.updateModelStatus(model.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active")
		if err != nil {
			return nil, err
		}
		model = activeModel
	}
	return s.newWarmLocalAssetResponse(
		model,
		result.modelResolved,
		endpoint,
		result.alreadyWarm,
		result.startedAt,
		result.traceID,
	), nil
}

func modelSupportsWarmup(model *runtimev1.LocalAssetRecord) bool {
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
	case strings.HasPrefix(lower, "llama/"):
		return strings.TrimSpace(normalized[len("llama/"):])
	case strings.HasPrefix(lower, "media/"):
		return strings.TrimSpace(normalized[len("media/"):])
	case strings.HasPrefix(lower, "sidecar/"):
		return strings.TrimSpace(normalized[len("sidecar/"):])
	case strings.HasPrefix(lower, "local/"):
		return strings.TrimSpace(normalized[len("local/"):])
	default:
		return normalized
	}
}

func (s *Service) performWarmLocalModelExecution(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	endpoint string,
	timeout time.Duration,
) (warmLocalModelExecutionState, error) {
	result := warmLocalModelExecutionState{
		startedAt:     time.Now(),
		traceID:       ulid.Make().String(),
		modelResolved: normalizeWarmResolvedModelID(model.GetAssetId()),
	}

	warmKey := warmCacheKey(model, endpoint, result.modelResolved)
	if s.isWarmKeyCached(warmKey) {
		result.alreadyWarm = true
		return result, nil
	}

	backend := nimillm.NewBackend("local-warmup", endpoint, "", timeout)
	if backend == nil {
		return result, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    "local runtime endpoint is not configured",
			ActionHint: "check_local_runtime_endpoint",
		})
	}
	if _, _, _, err := backend.GenerateText(
		ctx,
		result.modelResolved,
		[]*runtimev1.ChatMessage{{Role: "user", Content: "Respond with the single word ready."}},
		"",
		0,
		0,
		1,
	); err != nil {
		return result, err
	}

	s.recordWarmKey(warmKey)
	s.markLocalAssetUsed(model.GetLocalAssetId(), "warm_local_asset")
	s.appendWarmLocalModelAudit(model, result.modelResolved, endpoint, result.traceID, result.startedAt)
	return result, nil
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
	_, err := parseManagedEndpointPort(engine, endpoint)
	return err == nil
}

func (s *Service) waitForWarmProbe(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	registration managedLlamaRegistration,
	endpoint string,
) endpointProbeResult {
	probe := s.probeEndpoint(ctx, model.GetEngine(), endpoint)
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

		probe = s.probeEndpoint(ctx, model.GetEngine(), endpoint)
		if modelProbeSucceeded(model, probe, registration) || probe.healthy {
			return probe
		}
		timer.Reset(warmManagedProbeRetryInterval)
	}
}

func (s *Service) recordWarmFailure(model *runtimev1.LocalAssetRecord, detail string, transitionUnhealthy bool) error {
	if model == nil {
		return nil
	}
	if transitionUnhealthy || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		if _, err := s.transitionModelToUnhealthy(model.GetLocalAssetId(), detail); err != nil {
			return err
		}
		return nil
	}
	s.setModelHealthDetail(model.GetLocalAssetId(), detail)
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

func warmCacheKey(model *runtimev1.LocalAssetRecord, endpoint string, modelResolved string) string {
	if model == nil {
		return ""
	}
	return strings.Join([]string{
		strings.TrimSpace(model.GetLocalAssetId()),
		strings.TrimSpace(endpoint),
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
	if _, exists := s.warmedModelKeys[key]; exists {
		s.moveWarmKeyToTailLocked(key)
		return
	}
	if len(s.warmedModelKeys) >= 512 && len(s.warmedModelOrder) > 0 {
		staleKey := s.warmedModelOrder[0]
		delete(s.warmedModelKeys, staleKey)
		s.warmedModelOrder = s.warmedModelOrder[1:]
	}
	s.warmedModelOrder = append(s.warmedModelOrder, key)
	s.warmedModelKeys[key] = struct{}{}
}

func (s *Service) moveWarmKeyToTailLocked(key string) {
	for i, existing := range s.warmedModelOrder {
		if existing != key {
			continue
		}
		copy(s.warmedModelOrder[i:], s.warmedModelOrder[i+1:])
		s.warmedModelOrder[len(s.warmedModelOrder)-1] = key
		return
	}
	s.warmedModelOrder = append(s.warmedModelOrder, key)
}

func (s *Service) appendWarmLocalModelAudit(
	model *runtimev1.LocalAssetRecord,
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
		Source:        "local",
		ModelId:       model.GetAssetId(),
		LocalModelId:  model.GetLocalAssetId(),
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

func (s *Service) newWarmLocalAssetResponse(
	model *runtimev1.LocalAssetRecord,
	modelResolved string,
	endpoint string,
	alreadyWarm bool,
	startedAt time.Time,
	traceID string,
) *runtimev1.WarmLocalAssetResponse {
	return &runtimev1.WarmLocalAssetResponse{
		LocalAssetId:  strings.TrimSpace(model.GetLocalAssetId()),
		AssetId:       strings.TrimSpace(model.GetAssetId()),
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
