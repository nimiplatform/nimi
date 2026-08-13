package localservice

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/grpc/codes"
)

var errManagedImageValidationPending = errors.New("managed local image backend validation pending")

func (s *Service) checkManagedSupervisedImageHealth(ctx context.Context, model *runtimev1.LocalAssetRecord) (*localAssetHealth, error) {
	return s.checkManagedSupervisedImageHealthWithReason(ctx, model, "explicit_health_check")
}

func (s *Service) checkManagedSupervisedImageHealthWithReason(ctx context.Context, model *runtimev1.LocalAssetRecord, loadReason string) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	selection := canonicalSupervisedImageSelectionForLocalAsset(model, collectDeviceProfile())
	if !selection.Matched || selection.Conflict || selection.Entry == nil || selection.ProductState != engine.ImageProductStateSupported {
		detail := strings.TrimSpace(selection.CompatibilityDetail)
		if detail == "" {
			detail = "canonical image selection unavailable for managed media bootstrap"
		}
		if _, err := s.setManagedSupervisedImageUnhealthy(model, detail); err != nil {
			return nil, err
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
			Message:    detail,
			ActionHint: "inspect_local_runtime_model_health",
		})
	}
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(localAssetID)); err != nil {
		return s.setManagedSupervisedImageUnhealthy(model, managedLocalAssetRecordFailureDetail(err))
	}
	if selectionRequiresCUDAUserSpaceRuntime(selection) {
		gate := s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
			ConsumerID:   stableDiffusionCUDAConsumerID,
			PackID:       "local-gpu-support",
			AssetID:      model.GetAssetId(),
			LocalAssetID: localAssetID,
		})
		if gate.State != localEnvironmentActivationStateReady {
			return s.setManagedSupervisedImageUnhealthy(model, gate.Detail)
		}
	}
	if gate, ok := s.resolveManagedImageProfileActivationGate(model, selection); ok && gate.State != localEnvironmentActivationStateReady {
		return s.setManagedSupervisedImageUnhealthy(model, gate.Detail)
	}
	if _, _, err := s.ensureManagedLocalModelBundleReady(ctx, model); err != nil {
		return s.setManagedSupervisedImageUnhealthy(model, managedLocalModelBundleFailureDetail(err))
	}
	if refreshed := s.modelByID(localAssetID); refreshed != nil {
		model = refreshed
	}
	if err := s.bootstrapLocalModelIfManaged(ctx, model); err != nil {
		return s.setManagedSupervisedImageUnhealthy(model, appendSanitizedBootstrapFailureDetail(managedLocalImageExecutionFailureDetail(err.Error()), err))
	}

	result, err := s.preflightManagedSupervisedImage(ctx, model, loadReason)
	if err != nil {
		detail, reason := managedImageHealthFailureProjection(err)
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			failures, interval := s.modelRecoveryFailure(localAssetID, time.Now().UTC())
			detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		}
		return s.setManagedSupervisedImageUnhealthyWithReason(model, detail, reason)
	}
	if result.pending {
		installed, err := s.ensureModelInstalled(localAssetID, result.detail)
		if err != nil {
			return nil, err
		}
		return modelHealth(installed), nil
	}
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		if strings.TrimSpace(model.GetHealthDetail()) != result.detail {
			s.setModelHealthDetail(localAssetID, result.detail)
			model = s.modelByID(localAssetID)
		}
		s.resetModelRecovery(localAssetID)
		return modelHealth(model), nil
	}
	activated, err := s.updateModelStatus(localAssetID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, result.detail)
	if err != nil {
		return nil, err
	}
	s.resetModelRecovery(localAssetID)
	return modelHealth(activated), nil
}

func (s *Service) resolveManagedImageProfileActivationGate(model *runtimev1.LocalAssetRecord, selection engine.ImageSupervisedMatrixSelection) (localEnvironmentConsumerActivationGate, bool) {
	if model == nil || !selection.Matched || selection.Conflict || selection.Entry == nil {
		return localEnvironmentConsumerActivationGate{}, false
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if localAssetID == "" {
		return localEnvironmentConsumerActivationGate{}, false
	}
	cached, ok := s.cachedManagedMediaImageProfile(localAssetID)
	if !ok || !cached.MaterializationResolved {
		return localEnvironmentConsumerActivationGate{}, false
	}
	consumerID, ok := managedImageConsumerIDForMatrixEntry(selection.Entry)
	if !ok {
		return localEnvironmentConsumerActivationGate{
			ConsumerID: strings.TrimSpace(selection.Entry.EntryID),
			State:      localEnvironmentActivationStateUnsupported,
			ReasonCode: localEnvironmentActivationReasonConsumerUnsupported,
			Detail:     "managed image selection has no admitted local environment consumer: " + strings.TrimSpace(selection.Entry.EntryID),
		}, true
	}
	return s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID:   consumerID,
		AssetID:      model.GetAssetId(),
		LocalAssetID: localAssetID,
	}), true
}

func managedImageConsumerIDForMatrixEntry(entry *engine.ImageSupervisedMatrixEntry) (string, bool) {
	if entry == nil {
		return "", false
	}
	switch strings.ToLower(strings.TrimSpace(entry.GPUVendor)) {
	case "apple":
		if strings.EqualFold(strings.TrimSpace(entry.OS), "darwin") && strings.EqualFold(strings.TrimSpace(entry.Arch), "arm64") {
			return "stable-diffusion.cpp.metal", true
		}
	case "nvidia":
		return stableDiffusionCUDAConsumerID, true
	}
	return "stable-diffusion.cpp.cpu", true
}

type managedImagePreflightResult struct {
	pending bool
	detail  string
}

func (s *Service) preflightManagedSupervisedImage(ctx context.Context, model *runtimev1.LocalAssetRecord, loadReason string) (managedImagePreflightResult, error) {
	if model == nil {
		return managedImagePreflightResult{}, fmt.Errorf("managed local image is unavailable")
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	cached, ok := s.cachedManagedMediaImageProfile(localAssetID)
	if !ok || len(cached.Profile) == 0 {
		return managedImagePreflightResult{
			pending: true,
			detail:  managedLocalImagePendingValidationDetail("runtime profile bindings not cached yet"),
		}, nil
	}
	_, err := s.ensureManagedSupervisedImageLoaded(ctx, model, cached.Alias, cached.Profile, nil, loadReason)
	if errors.Is(err, errManagedImageValidationPending) {
		return managedImagePreflightResult{
			pending: true,
			detail:  managedLocalImagePendingValidationDetail("runtime profile bindings not cached yet"),
		}, nil
	}
	if err != nil {
		return managedImagePreflightResult{}, err
	}
	if releaseErr := s.releaseManagedSupervisedImage(ctx, model, cached.Alias, cached.Profile, nil, loadReason+"_cleanup"); releaseErr != nil {
		s.logger.Warn("managed image explicit validation cleanup failed",
			"local_asset_id", strings.TrimSpace(model.GetLocalAssetId()),
			"load_reason", defaultString(strings.TrimSpace(loadReason), "unspecified"),
			"error", releaseErr,
		)
	}
	s.markLocalAssetUsed(localAssetID, loadReason)
	return managedImagePreflightResult{
		detail: managedLocalImageReadyDetail(),
	}, nil
}

func managedImageLoadRequest(modelsRoot string, backendAddress string, profile map[string]any, scenarioExtensions map[string]any) (managedimagebackend.LoadModelRequest, error) {
	_ = scenarioExtensions
	if strings.TrimSpace(modelsRoot) == "" || strings.TrimSpace(backendAddress) == "" {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("managed image backend target is unavailable")
	}
	modelPath := strings.TrimSpace(valueAsString(valueAsObject(profile["parameters"])["model"]))
	if modelPath == "" {
		return managedimagebackend.LoadModelRequest{}, fmt.Errorf("managed image profile is missing parameters.model")
	}
	if !filepath.IsAbs(modelPath) {
		modelPath = filepath.Join(strings.TrimSpace(modelsRoot), filepath.FromSlash(modelPath))
	}
	components, err := managedImageBackendComponentBindings(profile[managedMediaWorkflowMaterializationBindingsKey])
	if err != nil {
		return managedimagebackend.LoadModelRequest{}, err
	}
	return managedimagebackend.LoadModelRequest{
		BackendAddress: strings.TrimSpace(backendAddress),
		Protocol:       managedimagebackend.ProtocolManagedWrapper,
		ModelsRoot:     strings.TrimSpace(modelsRoot),
		ModelPath:      modelPath,
		Components:     components,
	}, nil
}

func managedImageBackendComponentBindings(raw any) ([]managedimagebackend.ComponentBinding, error) {
	values, ok := raw.([]map[string]any)
	if !ok || len(values) == 0 {
		return nil, nil
	}
	components := make([]managedimagebackend.ComponentBinding, 0, len(values))
	for _, value := range values {
		occurrenceID := strings.TrimSpace(valueAsString(value["occurrence_id"]))
		engineSlot := strings.TrimSpace(valueAsString(value["engine_slot"]))
		path := strings.TrimSpace(valueAsString(value["path"]))
		if occurrenceID == "" || engineSlot == "" || path == "" {
			return nil, fmt.Errorf("runtime image materialization component binding is incomplete")
		}
		if strings.TrimSpace(valueAsString(value["weight"])) != "" {
			return nil, fmt.Errorf("runtime image materialization component weight is not admitted by stable-diffusion.cpp")
		}
		if options, exists := value["options"]; exists && options != nil {
			object, ok := options.(map[string]any)
			if !ok || len(object) != 0 {
				return nil, fmt.Errorf("runtime image materialization component options are not admitted by stable-diffusion.cpp")
			}
		}
		order := int32(0)
		switch typed := value["order"].(type) {
		case int:
			order = int32(typed)
		case int32:
			order = typed
		case int64:
			order = int32(typed)
		case float64:
			order = int32(typed)
		}
		required, _ := value["required"].(bool)
		components = append(components, managedimagebackend.ComponentBinding{
			OccurrenceID:  occurrenceID,
			Order:         order,
			Role:          strings.TrimSpace(valueAsString(value["role"])),
			ComponentKind: strings.TrimSpace(valueAsString(value["component_kind"])),
			EngineSlot:    engineSlot,
			Path:          path,
			Required:      required,
		})
	}
	return components, nil
}

func (s *Service) setManagedSupervisedImageUnhealthy(model *runtimev1.LocalAssetRecord, detail string) (*localAssetHealth, error) {
	return s.setManagedSupervisedImageUnhealthyWithReason(
		model,
		detail,
		runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
	)
}

func (s *Service) setManagedSupervisedImageUnhealthyWithReason(
	model *runtimev1.LocalAssetRecord,
	detail string,
	reason runtimev1.ReasonCode,
) (*localAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	_ = s.freeManagedMediaImageOnIdle(context.Background(), localAssetID, "unhealthy_cleanup")
	s.clearManagedMediaImageLoadCache(localAssetID)
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		s.setModelHealthDetailWithReason(localAssetID, detail, reason)
		return modelHealth(s.modelByID(localAssetID)), nil
	}
	transitioned, err := s.transitionModelToUnhealthyWithReason(localAssetID, detail, reason)
	if err != nil {
		return nil, err
	}
	return modelHealth(transitioned), nil
}

func managedImageHealthFailureProjection(err error) (string, runtimev1.ReasonCode) {
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return managedImageFailurePublicDetail(reason), reason
	}
	detail := managedLocalImageExecutionFailureDetail(err.Error())
	return detail, projectionReasonCodeForEngine("media", detail)
}
