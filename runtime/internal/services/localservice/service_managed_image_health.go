package localservice

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
)

func (s *Service) checkManagedSupervisedImageHealth(ctx context.Context, model *runtimev1.LocalAssetRecord) (*runtimev1.LocalAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(localAssetID)); err != nil {
		return s.setManagedSupervisedImageUnhealthy(model, managedLocalAssetRecordFailureDetail(err))
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

	result, err := s.preflightManagedSupervisedImage(ctx, model)
	if err != nil {
		detail := managedLocalImageExecutionFailureDetail(err.Error())
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			failures, interval := s.modelRecoveryFailure(localAssetID, time.Now().UTC())
			detail = fmt.Sprintf("%s; consecutive_failures=%d; next_probe_in=%s", detail, failures, interval.String())
		}
		return s.setManagedSupervisedImageUnhealthy(model, detail)
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

type managedImagePreflightResult struct {
	pending bool
	detail  string
}

func (s *Service) preflightManagedSupervisedImage(ctx context.Context, model *runtimev1.LocalAssetRecord) (managedImagePreflightResult, error) {
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
	modelsRoot, backendAddress, err := s.ResolveManagedMediaBackendTarget(ctx)
	if err != nil {
		return managedImagePreflightResult{}, err
	}
	loadReq, err := managedImageLoadRequest(modelsRoot, backendAddress, cached.Profile)
	if err != nil {
		return managedImagePreflightResult{}, err
	}
	if err := managedimagebackend.LoadModel(ctx, loadReq); err != nil {
		return managedImagePreflightResult{}, err
	}
	return managedImagePreflightResult{
		detail: managedLocalImageReadyDetail(),
	}, nil
}

func managedImageLoadRequest(modelsRoot string, backendAddress string, profile map[string]any) (managedimagebackend.LoadModelRequest, error) {
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
	return managedimagebackend.LoadModelRequest{
		BackendAddress: strings.TrimSpace(backendAddress),
		ModelsRoot:     strings.TrimSpace(modelsRoot),
		ModelPath:      modelPath,
		Options:        valueAsStringSlice(profile["options"]),
		CFGScale:       managedImageCFGScale(profile),
	}, nil
}

func managedImageCFGScale(profile map[string]any) float32 {
	for _, value := range []any{
		profile["cfg_scale"],
		profile["cfgScale"],
		valueAsObject(profile["parameters"])["cfg_scale"],
		valueAsObject(profile["parameters"])["cfgScale"],
	} {
		switch typed := value.(type) {
		case float32:
			if typed > 0 {
				return typed
			}
		case float64:
			if typed > 0 {
				return float32(typed)
			}
		case int:
			if typed > 0 {
				return float32(typed)
			}
		case int32:
			if typed > 0 {
				return float32(typed)
			}
		case int64:
			if typed > 0 {
				return float32(typed)
			}
		}
	}
	return 0
}

func (s *Service) setManagedSupervisedImageUnhealthy(model *runtimev1.LocalAssetRecord, detail string) (*runtimev1.LocalAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		s.setModelHealthDetail(localAssetID, detail)
		return modelHealth(s.modelByID(localAssetID)), nil
	}
	transitioned, err := s.transitionModelToUnhealthy(localAssetID, detail)
	if err != nil {
		return nil, err
	}
	return modelHealth(transitioned), nil
}
