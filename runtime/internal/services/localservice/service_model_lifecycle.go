package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) StartLocalModel(ctx context.Context, req *runtimev1.StartLocalModelRequest) (*runtimev1.StartLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "set_local_model_id",
		})
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "install_or_select_existing_local_model",
		})
	}
	if current.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	if healedModel, _, err := s.healManagedSupervisedLlamaRuntimeMode(localModelID); err != nil {
		detail := managedLocalModelRecordFailureDetail(err)
		if current.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
			s.setModelHealthDetail(localModelID, detail)
			return &runtimev1.StartLocalModelResponse{Model: s.modelByID(localModelID)}, nil
		}
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
	} else if healedModel != nil {
		current = healedModel
	}
	if healedModel, _, err := s.healLegacyManagedLocalImportRecord(localModelID); err != nil {
		detail := managedLocalModelRecordFailureDetail(err)
		if current.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
			s.setModelHealthDetail(localModelID, detail)
			return &runtimev1.StartLocalModelResponse{Model: s.modelByID(localModelID)}, nil
		}
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
	} else if healedModel != nil {
		current = healedModel
	}

	profile := collectDeviceProfile()
	warnings := startupCompatibilityWarnings(current.GetEngine(), profile)

	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, current); err != nil {
		failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
		detail := appendWarnings(managedLocalModelBundleFailureDetail(err), warnings)
		detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
	}
	if refreshed := s.modelByID(localModelID); refreshed != nil {
		current = refreshed
	}
	registration := s.managedLlamaRegistrationForModel(current)
	if strings.TrimSpace(registration.Problem) != "" {
		detail := appendWarnings(managedLocalModelRegistrationFailureDetail(registration.Problem), warnings)
		unhealthy, err := s.transitionModelToUnhealthy(localModelID, detail)
		if err != nil {
			return nil, err
		}
		return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
	}
	endpoint := s.effectiveLocalModelEndpoint(current)
	bootstrapErr := s.bootstrapEngineIfManaged(ctx, current.GetEngine(), s.modelRuntimeMode(localModelID), endpoint)
	probe := s.probeEndpoint(ctx, current.GetEngine(), endpoint)
	if modelProbeSucceeded(current, probe, registration) {
		if s.shouldWarmLocalModelOnStart(current, endpoint, probe) {
			warmTimeout := warmLocalModelTimeout(0)
			warmCtx, cancel := context.WithTimeout(ctx, warmTimeout)
			_, warmErr := s.performWarmLocalModelExecution(warmCtx, current, endpoint, warmTimeout)
			cancel()
			if warmErr != nil {
				failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
				detail := appendWarnings(warmExecutionFailureDetail(warmErr), warnings)
				detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
				unhealthy, err := s.transitionModelToUnhealthy(localModelID, detail)
				if err != nil {
					return nil, err
				}
				return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
			}
		}
		if current.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
			activated, err := s.updateModelStatus(
				localModelID,
				runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
				appendWarnings("model active", warnings),
			)
			if err != nil {
				return nil, err
			}
			current = activated
		}
		s.resetModelRecovery(localModelID)
		latest := s.modelByID(localModelID)
		if latest == nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "install_or_select_existing_local_model",
			})
		}
		return &runtimev1.StartLocalModelResponse{Model: latest}, nil
	}

	failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
	detail := appendWarnings(modelProbeFailureDetail(current, probe, registration), warnings)
	detail = appendSanitizedBootstrapFailureDetail(detail, bootstrapErr)
	if strings.TrimSpace(probe.probeURL) != "" {
		detail += "; probe_url=" + probe.probeURL
	}
	detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
	unhealthy, err := s.transitionModelToUnhealthy(localModelID, detail)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
}

func (s *Service) StopLocalModel(_ context.Context, req *runtimev1.StopLocalModelRequest) (*runtimev1.StopLocalModelResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalModelId())
	if localModelID == "" {
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "set_local_model_id",
		})
	}
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "install_or_select_existing_local_model",
		})
	}
	model, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, "model stopped")
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalModelResponse{Model: model}, nil
}

func (s *Service) CheckLocalModelHealth(ctx context.Context, req *runtimev1.CheckLocalModelHealthRequest) (*runtimev1.CheckLocalModelHealthResponse, error) {
	target := strings.TrimSpace(req.GetLocalModelId())
	s.mu.RLock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if target != "" && model.GetLocalModelId() != target {
			continue
		}
		models = append(models, cloneLocalModel(model))
	}
	s.mu.RUnlock()
	if target != "" && len(models) == 0 {
		return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "install_or_select_existing_local_model",
		})
	}

	result := make([]*runtimev1.LocalModelHealth, 0, len(models))
	for _, model := range models {
		if model == nil {
			continue
		}
		localModelID := strings.TrimSpace(model.GetLocalModelId())
		if healedModel, _, err := s.healLegacyManagedLocalImportRecord(localModelID); err == nil && healedModel != nil {
			model = healedModel
		}
		if isManagedSupervisedLlamaModel(model, s.modelRuntimeMode(localModelID)) {
			health, err := s.checkManagedSupervisedLlamaHealth(ctx, model)
			if err != nil {
				return nil, err
			}
			result = append(result, health)
			continue
		}
		switch model.GetStatus() {
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
			endpoint := s.effectiveLocalModelEndpoint(model)
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, model.GetEngine(), s.modelRuntimeMode(localModelID), endpoint)
			probe := s.probeEndpoint(ctx, model.GetEngine(), endpoint)
			registration := s.managedLlamaRegistrationForModel(model)
			if modelProbeSucceeded(model, probe, registration) {
				s.resetModelRecovery(localModelID)
				result = append(result, modelHealth(model))
				continue
			}
			failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
			detail := modelProbeFailureDetail(model, probe, registration)
			detail = appendSanitizedBootstrapFailureDetail(detail, bootstrapErr)
			if strings.TrimSpace(probe.probeURL) != "" {
				detail += "; probe_url=" + probe.probeURL
			}
			detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			transitioned, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
			if err != nil {
				return nil, err
			}
			result = append(result, modelHealth(transitioned))
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY:
			endpoint := s.effectiveLocalModelEndpoint(model)
			bootstrapErr := s.bootstrapEngineIfManaged(ctx, model.GetEngine(), s.modelRuntimeMode(localModelID), endpoint)
			probe := s.probeEndpoint(ctx, model.GetEngine(), endpoint)
			registration := s.managedLlamaRegistrationForModel(model)
			if modelProbeSucceeded(model, probe, registration) {
				successes := s.modelRecoverySuccess(localModelID, time.Now().UTC())
				if successes >= localRecoverySuccessThreshold {
					recovered, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE, "model active")
					if err != nil {
						return nil, err
					}
					s.resetModelRecovery(localModelID)
					result = append(result, modelHealth(recovered))
				} else {
					health := modelHealth(model)
					detail := fmt.Sprintf("recovery probe succeeded (%d/%d)", successes, localRecoverySuccessThreshold)
					if strings.TrimSpace(probe.probeURL) != "" {
						detail += "; probe_url=" + probe.probeURL
					}
					health.Detail = detail
					result = append(result, health)
				}
				continue
			}
			failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
			health := modelHealth(model)
			detail := modelProbeFailureDetail(model, probe, registration)
			detail = appendSanitizedBootstrapFailureDetail(detail, bootstrapErr)
			if strings.TrimSpace(probe.probeURL) != "" {
				detail += "; probe_url=" + probe.probeURL
			}
			health.Detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
			result = append(result, health)
		default:
			s.resetModelRecovery(localModelID)
			result = append(result, modelHealth(model))
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetLocalModelId() < result[j].GetLocalModelId()
	})
	return &runtimev1.CheckLocalModelHealthResponse{Models: result}, nil
}

func (s *Service) normalizeManagedSupervisedLlamaStatuses(ctx context.Context) {
	s.mu.RLock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if model == nil {
			continue
		}
		if !isManagedSupervisedLlamaModel(model, s.modelRuntimeModes[model.GetLocalModelId()]) {
			continue
		}
		models = append(models, cloneLocalModel(model))
	}
	s.mu.RUnlock()

	for _, model := range models {
		if model == nil {
			continue
		}
		switch model.GetStatus() {
		case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED,
			runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
			runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
			if _, err := s.checkManagedSupervisedLlamaHealth(ctx, model); err != nil {
				s.logger.Debug("normalize managed llama status failed", "local_model_id", model.GetLocalModelId(), "error", err)
			}
		}
	}
}

func (s *Service) checkManagedSupervisedLlamaHealth(ctx context.Context, model *runtimev1.LocalModelRecord) (*runtimev1.LocalModelHealth, error) {
	if model == nil {
		return nil, nil
	}
	localModelID := strings.TrimSpace(model.GetLocalModelId())
	if healedModel, _, err := s.healManagedSupervisedLlamaRuntimeMode(localModelID); err != nil {
		return s.setManagedSupervisedLlamaUnhealthy(model, managedLocalModelRecordFailureDetail(err))
	} else if healedModel != nil {
		model = healedModel
	}
	if healedModel, _, err := s.healLegacyManagedLocalImportRecord(localModelID); err != nil {
		return s.setManagedSupervisedLlamaUnhealthy(model, managedLocalModelRecordFailureDetail(err))
	} else if healedModel != nil {
		model = healedModel
	}
	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, model); err != nil {
		return s.setManagedSupervisedLlamaUnhealthy(model, managedLocalModelBundleFailureDetail(err))
	}
	if refreshed := s.modelByID(localModelID); refreshed != nil {
		model = refreshed
	}
	registration := s.managedLlamaRegistrationForModel(model)
	if strings.TrimSpace(registration.Problem) != "" {
		return s.setManagedSupervisedLlamaUnhealthy(model, managedLocalModelRegistrationFailureDetail(registration.Problem))
	}

	endpoint := s.effectiveLocalModelEndpoint(model)
	probe := s.probeEndpoint(ctx, model.GetEngine(), endpoint)
	readyDetail := managedLocalModelReadyDetail()
	notStartedDetail := managedLocalModelReadyNotStartedDetail()
	if modelProbeSucceeded(model, probe, registration) {
		s.resetModelRecovery(localModelID)
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
			if strings.TrimSpace(model.GetHealthDetail()) != readyDetail {
				s.setModelHealthDetail(localModelID, readyDetail)
				model = s.modelByID(localModelID)
			}
			return modelHealth(model), nil
		}
		installed, err := s.ensureModelInstalled(localModelID, notStartedDetail)
		if err != nil {
			return nil, err
		}
		return modelHealth(installed), nil
	}

	if !probe.responded {
		s.resetModelRecovery(localModelID)
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
			if strings.TrimSpace(model.GetHealthDetail()) != notStartedDetail {
				s.setModelHealthDetail(localModelID, notStartedDetail)
				model = s.modelByID(localModelID)
			}
			return modelHealth(model), nil
		}
		installed, err := s.ensureModelInstalled(localModelID, notStartedDetail)
		if err != nil {
			return nil, err
		}
		return modelHealth(installed), nil
	}

	if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
		detail := modelProbeFailureDetail(model, probe, registration)
		if strings.TrimSpace(probe.probeURL) != "" {
			detail += "; probe_url=" + probe.probeURL
		}
		detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		transitioned, err := s.transitionModelToUnhealthy(localModelID, detail)
		if err != nil {
			return nil, err
		}
		return modelHealth(transitioned), nil
	}

	detail := modelProbeFailureDetail(model, probe, registration)
	if strings.TrimSpace(probe.probeURL) != "" {
		detail += "; probe_url=" + probe.probeURL
	}
	return s.setManagedSupervisedLlamaUnhealthy(model, detail)
}

func (s *Service) setManagedSupervisedLlamaUnhealthy(model *runtimev1.LocalModelRecord, detail string) (*runtimev1.LocalModelHealth, error) {
	if model == nil {
		return nil, nil
	}
	localModelID := strings.TrimSpace(model.GetLocalModelId())
	if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		s.setModelHealthDetail(localModelID, detail)
		return modelHealth(s.modelByID(localModelID)), nil
	}
	transitioned, err := s.transitionModelToUnhealthy(localModelID, detail)
	if err != nil {
		return nil, err
	}
	return modelHealth(transitioned), nil
}

func (s *Service) transitionModelToUnhealthy(localModelID string, detail string) (*runtimev1.LocalModelRecord, error) {
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	if current.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY {
		s.setModelHealthDetail(localModelID, detail)
		return s.modelByID(localModelID), nil
	}
	return s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
}

func (s *Service) ensureModelInstalled(localModelID string, detail string) (*runtimev1.LocalModelRecord, error) {
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	switch current.GetStatus() {
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED:
		s.setModelHealthDetail(localModelID, detail)
		return s.modelByID(localModelID), nil
	case runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY,
		runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE:
		installed, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED, detail)
		if err != nil {
			return nil, err
		}
		return installed, nil
	default:
		return current, nil
	}
}

func appendSanitizedBootstrapFailureDetail(detail string, err error) string {
	if err == nil {
		return detail
	}
	if strings.TrimSpace(detail) == "" {
		return "bootstrap_error=managed_engine_bootstrap_failed"
	}
	return detail + "; bootstrap_error=managed_engine_bootstrap_failed"
}

func (s *Service) shouldWarmLocalModelOnStart(
	model *runtimev1.LocalModelRecord,
	endpoint string,
	probe endpointProbeResult,
) bool {
	if model == nil || !modelSupportsWarmup(model) {
		return false
	}
	if !probe.responded {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
		return false
	}
	if s.engineManagerOrNil() == nil {
		return false
	}
	if s.modelRuntimeMode(model.GetLocalModelId()) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return false
	}
	return shouldRetryWarmProbe(model.GetEngine(), endpoint)
}

func warmExecutionFailureDetail(err error) string {
	if err == nil {
		return "warm execution failed"
	}
	if st, ok := status.FromError(err); ok {
		if message := strings.TrimSpace(st.Message()); message != "" {
			return "warm execution failed: " + message
		}
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "warm execution failed"
	}
	return "warm execution failed: " + message
}
