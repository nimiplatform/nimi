package localservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

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
		localModelID := strings.TrimSpace(model.GetLocalModelId())
		if localModelID == "" || !s.shouldProbeModelNow(localModelID, now) {
			continue
		}
		endpoint := s.effectiveLocalModelEndpoint(model)
		bootstrapErr := s.bootstrapEngineIfManaged(ctx, model.GetEngine(), endpoint)
		probe := s.probeEndpoint(ctx, endpoint)
		registration := s.localAIRegistrationForModel(model)
		if modelProbeSucceeded(model, probe, registration) {
			successes := s.modelRecoverySuccess(localModelID, now)
			if successes >= localRecoverySuccessThreshold {
				if _, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active"); err != nil {
					s.logger.Debug("local model recovery transition failed", "local_model_id", localModelID, "error", err)
				}
				s.resetModelRecovery(localModelID)
			}
			continue
		}
		failures, interval := s.modelRecoveryFailure(localModelID, now)
		detail := modelProbeFailureDetail(model, probe, registration)
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
		serviceID := strings.TrimSpace(service.GetServiceId())
		if serviceID == "" || !s.shouldProbeServiceNow(serviceID, now) {
			continue
		}
		bootstrapErr := s.bootstrapEngineIfManaged(ctx, service.GetEngine(), serviceProbeEndpoint(service))
		probe := s.probeEndpoint(ctx, serviceProbeEndpoint(service))
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

func (s *Service) collectUnhealthyRecoveryTargets() ([]*runtimev1.LocalModelRecord, []*runtimev1.LocalServiceDescriptor) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if model == nil {
			continue
		}
		if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
			continue
		}
		models = append(models, cloneLocalModel(model))
	}
	services := make([]*runtimev1.LocalServiceDescriptor, 0, len(s.services))
	for _, service := range s.services {
		if service == nil {
			continue
		}
		if service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY {
			continue
		}
		services = append(services, cloneServiceDescriptor(service))
	}
	return models, services
}

func (s *Service) shouldProbeModelNow(localModelID string, now time.Time) bool {
	s.mu.RLock()
	state := s.modelProbeState[localModelID]
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
	record := s.models[id]
	if record == nil {
		return
	}
	record.HealthDetail = strings.TrimSpace(detail)
	record.UpdatedAt = nowISO()
	s.models[id] = cloneLocalModel(record)
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
	record.Detail = strings.TrimSpace(detail)
	record.UpdatedAt = nowISO()
	s.services[id] = cloneServiceDescriptor(record)
	s.persistStateLocked()
}
