package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	capability    string
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
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(model.GetLocalAssetId()); err != nil {
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

	if isManagedSupervisedLlamaModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		readyModel, err := s.ensureManagedSupervisedLlamaLeaseReady(requestCtx, model, "warm_local_asset")
		if err != nil {
			detail := strings.TrimSpace(err.Error())
			if requestCtx.Err() != nil {
				detail = appendWarmWaitDetail(detail, requestCtx.Err())
			}
			if recordErr := s.recordWarmFailure(model, detail, false); recordErr != nil {
				return nil, recordErr
			}
			return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				Message:    detail,
				ActionHint: "inspect_local_runtime_model_health",
			})
		}
		if readyModel != nil {
			model = readyModel
		}
	} else {
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
	}

	endpoint := s.effectiveLocalModelEndpoint(model)
	result, err := s.performWarmLocalModelExecution(requestCtx, model, endpoint, timeout)
	if err != nil {
		detail := warmExecutionFailureDetail(err)
		if recordErr := s.recordWarmFailure(model, detail, true); recordErr != nil {
			return nil, recordErr
		}
		return nil, err
	}
	if updated, err := s.updateModelAvailabilityAndWarmState(
		model.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		managedLocalModelReadyDetail(),
		true,
	); err != nil {
		return nil, err
	} else if updated != nil {
		model = updated
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
	return warmCapabilityForModel(model) != ""
}

func warmCapabilityForModel(model *runtimev1.LocalAssetRecord) string {
	if model == nil {
		return ""
	}
	hasCapability := func(target string) bool {
		for _, capability := range model.GetCapabilities() {
			if strings.EqualFold(strings.TrimSpace(capability), target) {
				return true
			}
		}
		return false
	}
	switch {
	case hasCapability("chat"):
		return "chat"
	case hasCapability("text.generate"):
		return "text.generate"
	case hasCapability("audio.transcribe"):
		return "audio.transcribe"
	case hasCapability("audio.synthesize"):
		return "audio.synthesize"
	default:
		return ""
	}
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
		capability:    warmCapabilityForModel(model),
	}
	if result.capability == "" {
		return result, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}

	warmKey := warmCacheKey(model, endpoint, result.modelResolved, result.capability)
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
	switch result.capability {
	case "chat", "text.generate":
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
	case "audio.synthesize":
		voiceRef, voiceErr := s.resolveWarmSpeechVoiceReference(model)
		if voiceErr != nil {
			return result, voiceErr
		}
		if _, _, err := backend.SynthesizeSpeech(
			ctx,
			strings.TrimSpace(model.GetAssetId()),
			&runtimev1.SpeechSynthesizeScenarioSpec{
				Text:     "warmup",
				VoiceRef: voiceRef,
			},
			nil,
		); err != nil {
			return result, err
		}
	case "audio.transcribe":
		if _, _, err := backend.Transcribe(
			ctx,
			strings.TrimSpace(model.GetAssetId()),
			&runtimev1.SpeechTranscribeScenarioSpec{
				MimeType:       "audio/wav",
				Language:       "en",
				ResponseFormat: "json",
				Timestamps:     true,
				Diarization:    true,
				SpeakerCount:   2,
			},
			warmLocalSpeechTranscriptionAudioBytes(),
			"audio/wav",
			nil,
		); err != nil {
			return result, err
		}
	default:
		return result, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
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
		if _, err := s.updateModelAvailabilityAndWarmState(
			model.GetLocalAssetId(),
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
			detail,
			true,
		); err != nil {
			return err
		}
		return nil
	}
	if _, err := s.updateModelWarmState(model.GetLocalAssetId(), runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED, detail); err != nil {
		return err
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

func warmCacheKey(model *runtimev1.LocalAssetRecord, endpoint string, modelResolved string, capability string) string {
	if model == nil {
		return ""
	}
	return strings.Join([]string{
		strings.TrimSpace(model.GetLocalAssetId()),
		strings.TrimSpace(endpoint),
		strings.TrimSpace(modelResolved),
		strings.TrimSpace(capability),
	}, "|")
}

func (s *Service) resolveWarmSpeechVoiceReference(model *runtimev1.LocalAssetRecord) (*runtimev1.VoiceReference, error) {
	if model == nil {
		return nil, nil
	}
	if !strings.EqualFold(warmCapabilityForModel(model), "audio.synthesize") {
		return nil, nil
	}
	if !isManagedSupervisedSpeechModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		return nil, nil
	}
	modelsRoot := strings.TrimSpace(s.resolvedLocalModelsPath())
	if modelsRoot == "" {
		return nil, nil
	}
	manifestPath, err := resolveManagedSpeechBundleManifestPath(modelsRoot, model)
	if err != nil {
		return nil, err
	}
	voicesPath := filepath.Join(filepath.Dir(manifestPath), "voices.json")
	if _, err := os.Stat(voicesPath); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("managed speech voices invalid: %w", err)
	}
	voiceID, err := firstWarmSpeechVoiceID(voicesPath)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(voiceID) == "" {
		return nil, nil
	}
	return &runtimev1.VoiceReference{
		Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
		Reference: &runtimev1.VoiceReference_PresetVoiceId{
			PresetVoiceId: strings.TrimSpace(voiceID),
		},
	}, nil
}

func firstWarmSpeechVoiceID(voicesPath string) (string, error) {
	raw, err := os.ReadFile(strings.TrimSpace(voicesPath))
	if err != nil {
		return "", fmt.Errorf("managed speech voices invalid: %w", err)
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return "", fmt.Errorf("managed speech voices invalid: no voices declared")
	}

	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", fmt.Errorf("managed speech voices invalid: decode voices.json: %w", err)
	}
	if voiceID := firstVoiceIDFromPayload(payload); strings.TrimSpace(voiceID) != "" {
		return strings.TrimSpace(voiceID), nil
	}
	return "", fmt.Errorf("managed speech voices invalid: no voices declared")
}

func firstVoiceIDFromPayload(payload any) string {
	switch typed := payload.(type) {
	case []any:
		for _, item := range typed {
			if voiceID := firstVoiceIDFromPayload(item); strings.TrimSpace(voiceID) != "" {
				return strings.TrimSpace(voiceID)
			}
		}
	case map[string]any:
		if voices, ok := typed["voices"]; ok {
			if voiceID := firstVoiceIDFromPayload(voices); strings.TrimSpace(voiceID) != "" {
				return strings.TrimSpace(voiceID)
			}
		}
		for _, key := range []string{"voice_id", "id", "name"} {
			if value, ok := typed[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	case string:
		return strings.TrimSpace(typed)
	}
	return ""
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
			"capability":    warmCapabilityForModel(model),
		}),
	})
}

func warmLocalSpeechTranscriptionAudioBytes() []byte {
	return []byte{
		'R', 'I', 'F', 'F',
		0x24, 0x00, 0x00, 0x00,
		'W', 'A', 'V', 'E',
		'f', 'm', 't', ' ',
		0x10, 0x00, 0x00, 0x00,
		0x01, 0x00,
		0x01, 0x00,
		0x40, 0x1f, 0x00, 0x00,
		0x80, 0x3e, 0x00, 0x00,
		0x02, 0x00,
		0x10, 0x00,
		'd', 'a', 't', 'a',
		0x04, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00,
	}
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
