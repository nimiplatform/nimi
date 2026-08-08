package localservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type modelRecoveryTarget struct {
	record *runtimev1.LocalAssetRecord
	mode   runtimev1.LocalEngineRuntimeMode
}

type serviceRecoveryTarget struct {
	record *runtimev1.LocalServiceDescriptor
	mode   runtimev1.LocalEngineRuntimeMode
}

func (s *Service) startRecoveryLoop() {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	s.mu.Lock()
	if s.recoveryCancel != nil {
		s.mu.Unlock()
		cancel()
		close(done)
		return
	}
	s.recoveryCancel = cancel
	s.recoveryDone = done
	s.mu.Unlock()

	go func() {
		defer close(done)
		ticker := time.NewTicker(localRecoveryDefaultProbeInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runRecoverySweep(ctx)
			}
		}
	}()
}

func (s *Service) runRecoverySweep(ctx context.Context) {
	s.runResidencySweep(ctx)
	models, services := s.collectUnhealthyRecoveryTargets()
	now := time.Now().UTC()

	for _, model := range models {
		localModel := model.record
		localModelID := strings.TrimSpace(localModel.GetLocalAssetId())
		if localModelID == "" || !s.shouldProbeModelNow(localModelID, now) {
			continue
		}
		if isLlamaLocalAsset(localModel) {
			continue
		}
		if isManagedSupervisedSpeechModel(localModel, model.mode) {
			if _, err := s.checkManagedSupervisedSpeechHealthWithReason(ctx, localModel, "recovery_sweep"); err != nil {
				s.logger.Debug("managed speech recovery health failed", "local_model_id", localModelID, "error", err)
			}
			continue
		}
		if isManagedSupervisedImageModel(localModel, model.mode) {
			continue
		}
		endpoint := s.effectiveLocalModelEndpoint(localModel)
		bootstrapErr := s.bootstrapLocalModelIfManaged(ctx, localModel)
		probe := s.probeLocalModelEndpoint(ctx, localModel, endpoint)
		if modelProbeSucceeded(localModel, probe) {
			successes := s.modelRecoverySuccess(localModelID, now)
			if successes >= localRecoverySuccessThreshold {
				if _, err := s.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
					s.logger.Debug("local model recovery transition failed", "local_model_id", localModelID, "error", err)
				}
				s.resetModelRecovery(localModelID)
			}
			continue
		}
		failures, interval := s.modelRecoveryFailure(localModelID, now)
		detail := modelProbeFailureDetail(localModel, probe)
		detail = sanitizedModelProbeDetail(detail, model.mode, bootstrapErr)
		detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		s.setModelHealthDetail(localModelID, detail)
	}

	for _, service := range services {
		serviceRecord := service.record
		serviceID := strings.TrimSpace(serviceRecord.GetServiceId())
		if serviceID == "" || privateExecutionHostEngine(serviceRecord.GetEngine()) || !s.shouldProbeServiceNow(serviceID, now) {
			continue
		}
		probeEndpoint := s.serviceProbeEndpoint(serviceRecord)
		bootstrapErr := s.bootstrapEngineIfManaged(ctx, serviceRecord.GetEngine(), service.mode, probeEndpoint)
		probe := s.probeEndpoint(ctx, serviceRecord.GetEngine(), probeEndpoint)
		if probe.healthy {
			successes := s.serviceRecoverySuccess(serviceID, now)
			if successes >= localRecoverySuccessThreshold {
				if _, err := s.updateServiceStatus(serviceID, runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
					s.logger.Debug("local service recovery transition failed", "service_id", serviceID, "error", err)
				}
				s.resetServiceRecovery(serviceID)
			}
			continue
		}
		failures, interval := s.serviceRecoveryFailure(serviceID, now)
		detail := sanitizedServiceProbeDetail(defaultString(probe.detail, "service probe failed"), service.mode, bootstrapErr)
		detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		s.setServiceHealthDetail(serviceID, detail)
	}
}

func (s *Service) collectUnhealthyRecoveryTargets() ([]modelRecoveryTarget, []serviceRecoveryTarget) {
	manager := s.engineManagerOrNil()
	speechEngineActive := managedRecoveryEngineActive(manager, "speech")
	profile := collectDeviceProfile()

	s.mu.RLock()
	defer s.mu.RUnlock()
	models := make([]modelRecoveryTarget, 0, len(s.assets))
	for _, model := range s.assets {
		if model == nil {
			continue
		}
		mode := runtimeModeForAsset(model, profile)
		if isLlamaLocalAsset(model) {
			continue
		}
		if shouldCollectModelRecoveryTarget(model, mode) {
			if shouldSkipQuiescentManagedRecoveryTarget(model, mode, speechEngineActive) {
				continue
			}
			models = append(models, modelRecoveryTarget{
				record: cloneLocalAsset(model),
				mode:   mode,
			})
		}
	}
	services := make([]serviceRecoveryTarget, 0, len(s.services))
	for _, service := range s.services {
		if service == nil {
			continue
		}
		if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
			continue
		}
		services = append(services, serviceRecoveryTarget{
			record: cloneServiceDescriptor(service),
			mode:   s.serviceRuntimeModes[service.GetServiceId()],
		})
	}
	return models, services
}

func managedRecoveryEngineActive(manager EngineManager, engineName string) bool {
	if manager == nil {
		return false
	}
	info, err := manager.EngineStatus(engineName)
	if err != nil || info.PID <= 0 {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(info.Status)) {
	case "", "stopped":
		return false
	default:
		return true
	}
}

func shouldSkipQuiescentManagedRecoveryTarget(
	model *runtimev1.LocalAssetRecord,
	mode runtimev1.LocalEngineRuntimeMode,
	speechEngineActive bool,
) bool {
	if model == nil {
		return false
	}
	if isManagedSupervisedImageModel(model, mode) {
		// Managed image availability is driven by an explicit load/lease. The
		// recovery loop deliberately performs no image action, so cloning its
		// potentially large bundle inventory every interval is pure overhead.
		return true
	}
	if !isManagedSupervisedSpeechModel(model, mode) {
		return false
	}
	if speechEngineActive {
		return false
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		// Without an engine, the managed health paths intentionally leave
		// installed and unhealthy assets untouched until an explicit load.
		return true
	}
	return true
}

func shouldCollectModelRecoveryTarget(model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) bool {
	if model == nil {
		return false
	}
	switch model.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return true
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return isManagedSupervisedSpeechModel(model, mode)
	default:
		return false
	}
}

func (s *Service) shouldProbeModelNow(localModelID string, now time.Time) bool {
	s.mu.RLock()
	state := s.assetProbeState[localModelID]
	s.mu.RUnlock()
	if state == nil || state.lastProbeAt.IsZero() {
		return true
	}
	return now.Sub(state.lastProbeAt) >= recoveryProbeInterval(now, state)
}

func (s *Service) shouldProbeServiceNow(serviceID string, now time.Time) bool {
	s.mu.RLock()
	state := s.serviceProbeState[serviceID]
	s.mu.RUnlock()
	if state == nil || state.lastProbeAt.IsZero() {
		return true
	}
	return now.Sub(state.lastProbeAt) >= recoveryProbeInterval(now, state)
}

func (s *Service) setModelHealthDetail(localModelID string, detail string) {
	s.setModelHealthDetailWithReason(localModelID, detail, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
}

func (s *Service) setModelHealthDetailWithReason(localModelID string, detail string, reason runtimev1.ReasonCode) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.assets[id]
	if record == nil {
		return
	}
	cloned := cloneLocalAsset(record)
	cloned.HealthDetail = strings.TrimSpace(detail)
	if reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = projectionReasonCodeForEngine(cloned.GetEngine(), detail)
	}
	cloned.ReasonCode = reason
	cloned.UpdatedAt = nowISO()
	s.assets[id] = cloned
	s.persistStateLocked()
}

func (s *Service) setServiceHealthDetail(serviceID string, detail string) {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.services[id]
	if record == nil {
		return
	}
	cloned := cloneServiceDescriptor(record)
	cloned.Detail = strings.TrimSpace(detail)
	cloned.UpdatedAt = nowISO()
	s.services[id] = cloned
	s.persistStateLocked()
}
