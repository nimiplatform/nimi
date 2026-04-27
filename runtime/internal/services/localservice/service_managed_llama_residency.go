package localservice

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func managedLocalModelColdDetail() string {
	return "managed local model available (cold)"
}

func (s *Service) currentManagedLlamaLoadedLocalAssetID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.managedLlamaLoadedLocalAssetID)
}

func (s *Service) setCurrentManagedLlamaLoadedLocalAssetID(localAssetID string) {
	s.mu.Lock()
	s.managedLlamaLoadedLocalAssetID = strings.TrimSpace(localAssetID)
	s.mu.Unlock()
}

func (s *Service) ensureManagedSupervisedLlamaLeaseReady(ctx context.Context, model *runtimev1.LocalAssetRecord, reason string) (*runtimev1.LocalAssetRecord, error) {
	if model == nil || !isManagedSupervisedLlamaModel(model, s.modelRuntimeMode(model.GetLocalAssetId())) {
		return model, nil
	}
	startedAt := time.Now()

	s.managedLlamaLoadMu.Lock()
	defer s.managedLlamaLoadMu.Unlock()

	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return nil, fmt.Errorf("managed llama local asset id missing")
	}
	current := s.modelByID(localAssetID)
	if current == nil {
		return nil, fmt.Errorf("managed llama local asset missing")
	}
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(localAssetID); err != nil {
		return nil, fmt.Errorf("%s", managedLocalAssetRecordFailureDetail(err))
	} else if healedModel != nil {
		current = healedModel
	}
	if err := validateManagedLocalAssetRecord(current, s.modelRuntimeMode(localAssetID)); err != nil {
		return nil, fmt.Errorf("%s", managedLocalAssetRecordFailureDetail(err))
	}
	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, current); err != nil {
		return nil, fmt.Errorf("%s", managedLocalModelBundleFailureDetail(err))
	}
	if refreshed := s.modelByID(localAssetID); refreshed != nil {
		current = refreshed
	}
	registration := s.managedLlamaRegistrationForModel(current)
	if detail := strings.TrimSpace(registration.Problem); detail != "" {
		return nil, errors.New(managedLocalModelRegistrationFailureDetail(detail))
	}

	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return nil, fmt.Errorf("managed llama engine manager unavailable")
	}

	currentLoaded := s.currentManagedLlamaLoadedLocalAssetID()
	if currentLoaded != "" && currentLoaded != localAssetID {
		s.mu.RLock()
		blockingState := s.assetResidency[currentLoaded]
		s.mu.RUnlock()
		if blockingState.HoldCount > 0 {
			return nil, fmt.Errorf(
				"managed llama worker busy; loaded_local_asset_id=%s target_local_asset_id=%s reason=%s",
				currentLoaded,
				localAssetID,
				strings.TrimSpace(reason),
			)
		}
	}
	engineInfo, hasEngine := managedLlamaEngineInfo(mgr)
	if currentLoaded == "" && hasEngine {
		if matched, err := s.tryAdoptManagedLlamaResident(ctx, current, registration, engineInfo.Endpoint); err != nil {
			return nil, err
		} else if matched != nil {
			if s.logger != nil {
				s.logger.Info(
					"managed llama lease adopted resident worker",
					"local_asset_id", localAssetID,
					"requested_reason", strings.TrimSpace(reason),
					"endpoint", strings.TrimSpace(engineInfo.Endpoint),
					"duration_ms", time.Since(startedAt).Milliseconds(),
				)
			}
			return matched, nil
		}
	}

	mustStart := currentLoaded != localAssetID || !hasEngine
	if mustStart {
		s.observeCounter("runtime_ai_managed_llama_restart_total", 1,
			"local_asset_id", localAssetID,
			"loaded_local_asset_id", currentLoaded,
			"requested_reason", strings.TrimSpace(reason),
			"engine_healthy", hasEngine,
		)
	} else {
		s.observeCounter("runtime_ai_managed_llama_adopt_resident_total", 1,
			"local_asset_id", localAssetID,
			"loaded_local_asset_id", currentLoaded,
			"requested_reason", strings.TrimSpace(reason),
			"engine_healthy", hasEngine,
		)
	}
	if s.logger != nil {
		s.logger.Info(
			"managed llama lease evaluated",
			"local_asset_id", localAssetID,
			"loaded_local_asset_id", currentLoaded,
			"requested_reason", strings.TrimSpace(reason),
			"restart_required", mustStart,
			"engine_healthy", hasEngine,
		)
	}
	if mustStart {
		s.releaseIdleManagedMediaImagesForText(ctx, "text_lease_reclaim")
		if _, err := s.updateModelWarmState(localAssetID, runtimev1.LocalWarmState_LOCAL_WARM_STATE_WARMING, "managed local model loading"); err != nil {
			return nil, err
		}
		if currentLoaded != "" && currentLoaded != localAssetID {
			if _, err := s.updateModelAvailabilityAndWarmState(
				currentLoaded,
				runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD,
				managedLocalModelColdDetail(),
				true,
			); err != nil {
				return nil, err
			}
		}
		s.setCurrentManagedLlamaLoadedLocalAssetID("")
		if s.logger != nil {
			s.logger.Info(
				"managed llama lease restarting worker",
				"from_local_asset_id", currentLoaded,
				"to_local_asset_id", localAssetID,
				"requested_reason", strings.TrimSpace(reason),
			)
		}
		if err := stopManagedLlamaEngineIfRunning(mgr); err != nil {
			return nil, err
		}
		if err := mgr.StartEngineWithConfig(ctx, s.managedLlamaStartConfig(registration, engineInfo)); err != nil {
			return nil, err
		}
		engineInfo, _ = managedLlamaEngineInfo(mgr)
	}

	endpoint := defaultString(strings.TrimSpace(engineInfo.Endpoint), s.effectiveLocalModelEndpoint(current))
	probe := s.waitForWarmProbe(ctx, current, registration, endpoint)
	s.observeLatency("runtime.ai.local.lease_probe_ms", startedAt,
		"local_asset_id", localAssetID,
		"requested_reason", strings.TrimSpace(reason),
		"restart_required", mustStart,
		"engine_healthy", hasEngine,
	)
	if !modelProbeSucceeded(current, probe, registration) {
		detail := managedLlamaModelProbeFailureDetail(probe, registration)
		if _, err := s.updateModelAvailabilityAndWarmState(
			localAssetID,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
			detail,
			true,
		); err != nil {
			return nil, err
		}
		return nil, errors.New(detail)
	}

	readyModel, err := s.updateModelAvailabilityAndWarmState(
		localAssetID,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		managedLocalModelReadyDetail(),
		true,
	)
	if err != nil {
		return nil, err
	}
	s.setCurrentManagedLlamaLoadedLocalAssetID(localAssetID)
	if s.logger != nil {
		s.logger.Info(
			"managed llama lease ready",
			"local_asset_id", localAssetID,
			"requested_reason", strings.TrimSpace(reason),
			"endpoint", strings.TrimSpace(endpoint),
			"duration_ms", time.Since(startedAt).Milliseconds(),
		)
	}
	s.observeLatency("runtime.ai.local.lease_restart_ms", startedAt,
		"local_asset_id", localAssetID,
		"requested_reason", strings.TrimSpace(reason),
		"restart_required", mustStart,
		"engine_healthy", hasEngine,
	)
	return readyModel, nil
}

func (s *Service) tryAdoptManagedLlamaResident(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	registration managedLlamaRegistration,
	endpoint string,
) (*runtimev1.LocalAssetRecord, error) {
	if model == nil || strings.TrimSpace(endpoint) == "" {
		return nil, nil
	}
	probe := s.waitForWarmProbe(ctx, model, registration, endpoint)
	if !modelProbeSucceeded(model, probe, registration) {
		return nil, nil
	}
	readyModel, err := s.updateModelAvailabilityAndWarmState(
		model.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		managedLocalModelReadyDetail(),
		true,
	)
	if err != nil {
		return nil, err
	}
	s.setCurrentManagedLlamaLoadedLocalAssetID(model.GetLocalAssetId())
	return readyModel, nil
}

func managedLlamaEngineInfo(mgr EngineManager) (EngineInfo, bool) {
	if mgr == nil {
		return EngineInfo{}, false
	}
	info, err := mgr.EngineStatus("llama")
	if err != nil {
		return EngineInfo{}, false
	}
	if !strings.EqualFold(strings.TrimSpace(info.Status), "healthy") {
		return info, false
	}
	return info, true
}

func stopManagedLlamaEngineIfRunning(mgr EngineManager) error {
	if mgr == nil {
		return nil
	}
	if err := mgr.StopEngine("llama"); err != nil {
		lower := strings.ToLower(strings.TrimSpace(err.Error()))
		if strings.Contains(lower, "not found") {
			return nil
		}
		return err
	}
	return nil
}

func (s *Service) managedLlamaStartConfig(registration managedLlamaRegistration, info EngineInfo) engine.EngineConfig {
	cfg := engine.DefaultLlamaConfig()
	if info.Port > 0 {
		cfg.Port = info.Port
	}
	if version := strings.TrimSpace(info.Version); version != "" {
		cfg.Version = version
	}
	cfg.ModelsPath = s.resolvedLocalModelsPath()
	target := &engine.ManagedLlamaTarget{
		ModelPath:  strings.TrimSpace(registration.RelativeModelPath),
		ModelAlias: strings.TrimSpace(registration.ExposedModelName),
	}
	if registration.LlamaEngineConfig != nil {
		target.EngineConfig = *registration.LlamaEngineConfig
	}
	cfg.ManagedLlamaTarget = target
	return cfg
}
