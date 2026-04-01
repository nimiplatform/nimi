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
	models, services := s.collectUnhealthyRecoveryTargets()
	now := time.Now().UTC()

	for _, model := range models {
		localModel := model.record
		localModelID := strings.TrimSpace(localModel.GetLocalAssetId())
		if localModelID == "" || !s.shouldProbeModelNow(localModelID, now) {
			continue
		}
		if isManagedSupervisedLlamaModel(localModel, model.mode) {
			if _, err := s.checkManagedSupervisedLlamaHealth(ctx, localModel); err != nil {
				s.logger.Debug("managed llama recovery health failed", "local_model_id", localModelID, "error", err)
			}
			continue
		}
		endpoint := s.effectiveLocalModelEndpoint(localModel)
		bootstrapErr := s.bootstrapEngineIfManaged(ctx, localModel.GetEngine(), model.mode, endpoint)
		probe := s.probeEndpoint(ctx, localModel.GetEngine(), endpoint)
		registration := s.managedLlamaRegistrationForModel(localModel)
		if modelProbeSucceeded(localModel, probe, registration) {
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
		detail := modelProbeFailureDetail(localModel, probe, registration)
		if bootstrapErr != nil {
			detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
		}
		if strings.TrimSpace(probe.probeURL) != "" {
			detail += "; probe_url=" + probe.probeURL
		}
		detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		s.setModelHealthDetail(localModelID, detail)
	}

	for _, service := range services {
		serviceRecord := service.record
		serviceID := strings.TrimSpace(serviceRecord.GetServiceId())
		if serviceID == "" || !s.shouldProbeServiceNow(serviceID, now) {
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
		detail := defaultString(probe.detail, "service probe failed")
		if bootstrapErr != nil {
			detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
		}
		if strings.TrimSpace(probe.probeURL) != "" {
			detail += "; probe_url=" + probe.probeURL
		}
		detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		s.setServiceHealthDetail(serviceID, detail)
	}
}

func (s *Service) collectUnhealthyRecoveryTargets() ([]modelRecoveryTarget, []serviceRecoveryTarget) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	models := make([]modelRecoveryTarget, 0, len(s.assets))
	for _, model := range s.assets {
		if model == nil {
			continue
		}
		if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			continue
		}
		models = append(models, modelRecoveryTarget{
			record: cloneLocalAsset(model),
			mode:   s.assetRuntimeModes[model.GetLocalAssetId()],
		})
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
