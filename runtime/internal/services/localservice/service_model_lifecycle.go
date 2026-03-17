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

	profile := collectDeviceProfile()
	warnings := startupCompatibilityWarnings(current.GetEngine(), profile)

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

	endpoint := s.effectiveLocalModelEndpoint(current)
	bootstrapErr := s.bootstrapEngineIfManaged(ctx, current.GetEngine(), s.modelRuntimeMode(localModelID), endpoint)
	probe := s.probeEndpoint(ctx, current.GetEngine(), endpoint)
	registration := s.managedLlamaRegistrationForModel(current)
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
				unhealthy, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
				if err != nil {
					return nil, err
				}
				return &runtimev1.StartLocalModelResponse{Model: unhealthy}, nil
			}
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
	if bootstrapErr != nil {
		detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
	}
	if strings.TrimSpace(probe.probeURL) != "" {
		detail += "; probe_url=" + probe.probeURL
	}
	detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
	unhealthy, err := s.updateModelStatus(localModelID, runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNHEALTHY, detail)
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
			if bootstrapErr != nil {
				detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
			}
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
			if bootstrapErr != nil {
				detail += "; bootstrap_error=" + strings.TrimSpace(bootstrapErr.Error())
			}
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
