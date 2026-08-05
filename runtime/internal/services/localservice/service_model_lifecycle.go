package localservice

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) StartLocalAsset(ctx context.Context, req *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalAssetId())
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
	if current.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_INVALID_TRANSITION)
	}
	if isLlamaLocalAsset(current) {
		return nil, privateExecutionHostEngineError()
	}
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(localModelID); err != nil {
		detail := managedLocalAssetRecordFailureDetail(err)
		if current.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			s.setModelHealthDetail(localModelID, detail)
			return &runtimev1.StartLocalAssetResponse{Asset: s.modelByID(localModelID)}, nil
		}
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalAssetResponse{Asset: unhealthy}, nil
	} else if healedModel != nil {
		current = healedModel
	}
	if err := validateManagedLocalAssetRecord(current, s.modelRuntimeMode(localModelID)); err != nil {
		detail := managedLocalAssetRecordFailureDetail(err)
		if current.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			s.setModelHealthDetail(localModelID, detail)
			return &runtimev1.StartLocalAssetResponse{Asset: s.modelByID(localModelID)}, nil
		}
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalAssetResponse{Asset: unhealthy}, nil
	}
	if isManagedSupervisedImageModel(current, s.modelRuntimeMode(localModelID)) {
		if _, err := s.checkManagedSupervisedImageHealthWithReason(ctx, current, "start_local_asset"); err != nil {
			return nil, err
		}
		s.markLocalAssetUsed(localModelID, "start_local_asset")
		return &runtimev1.StartLocalAssetResponse{Asset: s.modelByID(localModelID)}, nil
	}
	if isManagedSupervisedSpeechModel(current, s.modelRuntimeMode(localModelID)) {
		if _, err := s.checkManagedSupervisedSpeechHealthWithReason(ctx, current, "start_local_asset"); err != nil {
			return nil, err
		}
		latest := s.modelByID(localModelID)
		if latest == nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "install_or_select_existing_local_model",
			})
		}
		if latest.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			s.markLocalAssetUsed(localModelID, "start_local_asset")
		}
		return &runtimev1.StartLocalAssetResponse{Asset: latest}, nil
	}

	profile := collectDeviceProfile()
	warnings := startupCompatibilityWarningsForAsset(
		current.GetEngine(),
		current.GetCapabilities(),
		current.GetKind(),
		profile,
	)
	if configDetail := attachedLoopbackConfigErrorDetail(current.GetEngine(), s.modelRuntimeMode(localModelID), s.effectiveLocalModelEndpoint(current), profile); configDetail != "" {
		unhealthy, err := s.transitionModelToUnhealthy(localModelID, appendWarnings(configDetail, warnings))
		if err != nil {
			return nil, err
		}
		return &runtimev1.StartLocalAssetResponse{Asset: unhealthy}, nil
	}

	s.mu.Lock()
	s.mu.Unlock()

	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, current); err != nil {
		failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
		detail := appendWarnings(managedLocalModelBundleFailureDetail(err), warnings)
		detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
		unhealthy, updateErr := s.transitionModelToUnhealthy(localModelID, detail)
		if updateErr != nil {
			return nil, updateErr
		}
		return &runtimev1.StartLocalAssetResponse{Asset: unhealthy}, nil
	}
	if refreshed := s.modelByID(localModelID); refreshed != nil {
		current = refreshed
	}
	endpoint := s.effectiveLocalModelEndpoint(current)
	bootstrapErr := s.bootstrapLocalModelIfManaged(ctx, current)
	probe := s.probeLocalModelEndpoint(ctx, current, endpoint)
	if modelProbeSucceeded(current, probe) {
		if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			activated, err := s.updateModelStatus(
				localModelID,
				runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				appendWarnings("model process started; execution health remains Runtime-private", warnings),
			)
			if err != nil {
				return nil, err
			}
			current = activated
		}
		s.markLocalAssetUsed(localModelID, "start_local_asset")
		s.resetModelRecovery(localModelID)
		latest := s.modelByID(localModelID)
		if latest == nil {
			return nil, grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
				ActionHint: "install_or_select_existing_local_model",
			})
		}
		return &runtimev1.StartLocalAssetResponse{Asset: latest}, nil
	}

	failures, _ := s.modelRecoveryFailure(localModelID, time.Now().UTC())
	detail := appendWarnings(modelProbeFailureDetail(current, probe), warnings)
	detail = sanitizedModelProbeDetail(detail, s.modelRuntimeMode(localModelID), bootstrapErr)
	detail = fmt.Sprintf("%s; consecutive_failures=%d", detail, failures)
	unhealthy, err := s.transitionModelToUnhealthy(localModelID, detail)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StartLocalAssetResponse{Asset: unhealthy}, nil
}

func (s *Service) StopLocalAsset(_ context.Context, req *runtimev1.StopLocalAssetRequest) (*runtimev1.StopLocalAssetResponse, error) {
	localModelID := strings.TrimSpace(req.GetLocalAssetId())
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
	detail := "model stopped"
	if isManagedSupervisedImageModel(current, s.modelRuntimeMode(localModelID)) {
		_ = s.freeManagedMediaImageOnIdle(context.Background(), localModelID, "stop_local_asset")
		s.clearManagedMediaImageLoadCache(localModelID)
		detail = managedLocalImagePendingValidationDetail("model stopped")
	}
	model, err := s.updateModelStatus(
		localModelID,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		detail,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.StopLocalAssetResponse{Asset: model}, nil
}

func (s *Service) checkManagedSupervisedLlamaHealth(ctx context.Context, model *runtimev1.LocalAssetRecord) (*localAssetHealth, error) {
	return s.checkManagedSupervisedLlamaHealthWithReason(ctx, model, "explicit_health_check")
}

func (s *Service) checkManagedSupervisedLlamaHealthWithReason(
	_ context.Context,
	model *runtimev1.LocalAssetRecord,
	_ string,
) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	// LocalAsset health proves only stored asset availability. It never probes
	// or mutates resident/load/readiness state; those are exact Host job outcomes.
	health := modelHealth(model)
	health.Endpoint = ""
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		health.Detail = "local asset is available; execution health is private to exact local capability jobs"
	}
	return health, nil
}

func (s *Service) checkManagedSupervisedSpeechHealth(ctx context.Context, model *runtimev1.LocalAssetRecord) (*localAssetHealth, error) {
	return s.checkManagedSupervisedSpeechHealthWithReason(ctx, model, "explicit_health_check")
}

func (s *Service) checkManagedSupervisedSpeechHealthWithReason(ctx context.Context, model *runtimev1.LocalAssetRecord, reason string) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localModelID := strings.TrimSpace(model.GetLocalAssetId())
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(localModelID); err != nil {
		return s.setManagedSupervisedSpeechUnhealthy(model, managedLocalAssetRecordFailureDetail(err))
	} else if healedModel != nil {
		model = healedModel
	}
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(localModelID)); err != nil {
		return s.setManagedSupervisedSpeechUnhealthy(model, managedLocalAssetRecordFailureDetail(err))
	}
	if managedSupervisedSpeechColdRecovery(reason) && !s.managedSpeechEngineAlreadyRunning(model) {
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			updated, err := s.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "managed speech process is not resident")
			if err != nil {
				return nil, err
			}
			return modelHealth(updated), nil
		}
		return modelHealth(model), nil
	}
	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, model); err != nil {
		return s.setManagedSupervisedSpeechUnhealthy(model, managedLocalModelBundleFailureDetail(err))
	}
	if refreshed := s.modelByID(localModelID); refreshed != nil {
		model = refreshed
	}

	endpoint := s.effectiveLocalModelEndpoint(model)
	bootstrapErr := s.bootstrapLocalModelIfManaged(ctx, model)
	probe := s.probeLocalModelEndpoint(ctx, model, endpoint)
	if modelProbeSucceeded(model, probe) {
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY &&
			!managedSupervisedSpeechImmediateRecovery(reason) {
			successes := s.modelRecoverySuccess(localModelID, time.Now().UTC())
			if successes < localRecoverySuccessThreshold {
				health := modelHealth(model)
				health.Detail = sanitizedModelProbeDetail(
					fmt.Sprintf("recovery probe succeeded (%d/%d)", successes, localRecoverySuccessThreshold),
					s.modelRuntimeMode(localModelID),
					nil,
				)
				return health, nil
			}
		}
		s.resetModelRecovery(localModelID)
		updated, err := s.updateModelStatus(
			localModelID,
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			"managed speech process responded; execution health remains Runtime-private",
		)
		if err != nil {
			return nil, err
		}
		return modelHealth(updated), nil
	}

	failures, interval := s.modelRecoveryFailure(localModelID, time.Now().UTC())
	detail := modelProbeFailureDetail(model, probe)
	detail = sanitizedModelProbeDetail(detail, s.modelRuntimeMode(localModelID), bootstrapErr)
	detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		updated, err := s.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, detail)
		if err != nil {
			return nil, err
		}
		return modelHealth(updated), nil
	}
	return s.setManagedSupervisedSpeechUnhealthy(model, detail)
}

func managedSupervisedSpeechImmediateRecovery(reason string) bool {
	switch strings.TrimSpace(reason) {
	case "start_local_asset", "first_run_speech_activation":
		return true
	default:
		return false
	}
}

func (s *Service) setManagedSupervisedLlamaUnhealthy(model *runtimev1.LocalAssetRecord, detail string) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localModelID := strings.TrimSpace(model.GetLocalAssetId())
	transitioned, err := s.updateModelStatus(
		localModelID,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		detail,
	)
	if err != nil {
		return nil, err
	}
	return modelHealth(transitioned), nil
}

func (s *Service) setManagedSupervisedSpeechUnhealthy(model *runtimev1.LocalAssetRecord, detail string) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localModelID := strings.TrimSpace(model.GetLocalAssetId())
	transitioned, err := s.updateModelStatus(
		localModelID,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		detail,
	)
	if err != nil {
		return nil, err
	}
	return modelHealth(transitioned), nil
}

func (s *Service) transitionModelToUnhealthy(localModelID string, detail string) (*runtimev1.LocalAssetRecord, error) {
	return s.transitionModelToUnhealthyWithReason(
		localModelID,
		detail,
		runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	)
}

func (s *Service) transitionModelToUnhealthyWithReason(
	localModelID string,
	detail string,
	reason runtimev1.ReasonCode,
) (*runtimev1.LocalAssetRecord, error) {
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return s.updateModelStatusWithReason(
		localModelID,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		detail,
		reason,
	)
}

func (s *Service) ensureModelInstalled(localModelID string, detail string) (*runtimev1.LocalAssetRecord, error) {
	current := s.modelByID(localModelID)
	if current == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	switch current.GetStatus() {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return s.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED, detail)
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
