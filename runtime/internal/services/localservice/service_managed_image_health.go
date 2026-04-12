package localservice

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/managedimagebackend"
	"google.golang.org/grpc/codes"
)

var errManagedImageValidationPending = errors.New("managed local image backend validation pending")

func (s *Service) checkManagedSupervisedImageHealth(ctx context.Context, model *runtimev1.LocalAssetRecord) (*runtimev1.LocalAssetHealth, error) {
	return s.checkManagedSupervisedImageHealthWithReason(ctx, model, "explicit_health_check")
}

func (s *Service) checkManagedSupervisedImageHealthWithReason(ctx context.Context, model *runtimev1.LocalAssetRecord, loadReason string) (*runtimev1.LocalAssetHealth, error) {
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
		Options:        managedImageEffectiveOptions(profile, scenarioExtensions),
		CFGScale:       managedImageCFGScale(profile, scenarioExtensions),
	}, nil
}

func managedImageCFGScale(profile map[string]any, scenarioExtensions map[string]any) float32 {
	for _, value := range []any{
		scenarioExtensions["cfg_scale"],
		scenarioExtensions["cfgScale"],
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
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			if parsed, err := strconv.ParseFloat(trimmed, 32); err == nil && parsed > 0 {
				return float32(parsed)
			}
		}
	}
	return 0
}

func managedImageEffectiveOptions(profile map[string]any, scenarioExtensions map[string]any) []string {
	options := valueAsStringSlice(profile["options"])
	sampler := managedImageSamplerOption(profile, scenarioExtensions)
	scheduler := managedImageSchedulerOption(profile, scenarioExtensions)
	out := make([]string, 0, len(options)+2)
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		switch managedImageOptionKey(trimmed) {
		case "sampler", "scheduler":
			continue
		}
		out = append(out, trimmed)
	}
	out = append(out, "sampler:"+sampler)
	out = append(out, "scheduler:"+scheduler)
	return out
}

func managedImageSamplerOption(profile map[string]any, scenarioExtensions map[string]any) string {
	for _, value := range []any{
		scenarioExtensions["mode"],
		scenarioExtensions["method"],
		profile["mode"],
		profile["sampling_method"],
	} {
		if sampler := managedImageCanonicalSampler(valueAsString(value)); sampler != "" {
			return sampler
		}
	}
	return "euler"
}

func managedImageCanonicalSampler(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "euler_a":
		return "euler_a"
	case "euler":
		return "euler"
	case "heun":
		return "heun"
	case "dpm2":
		return "dpm2"
	case "dpmpp2s_a", "dpm++2s_a":
		return "dpmpp2s_a"
	case "dpmpp2m", "dpm++2m":
		return "dpmpp2m"
	case "dpmpp2mv2", "dpm++2mv2":
		return "dpmpp2mv2"
	case "ipndm":
		return "ipndm"
	case "ipndm_v":
		return "ipndm_v"
	case "lcm":
		return "lcm"
	default:
		return ""
	}
}

func managedImageSchedulerOption(profile map[string]any, scenarioExtensions map[string]any) string {
	for _, value := range []any{
		scenarioExtensions["scheduler"],
		profile["scheduler"],
		valueAsObject(profile["parameters"])["scheduler"],
	} {
		if scheduler := managedImageCanonicalScheduler(valueAsString(value)); scheduler != "" {
			return scheduler
		}
	}
	return "discrete"
}

func managedImageCanonicalScheduler(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "default", "discrete":
		return "discrete"
	case "karras":
		return "karras"
	case "exponential":
		return "exponential"
	case "ays":
		return "ays"
	case "gits":
		return "gits"
	case "smoothstep":
		return "smoothstep"
	case "sgm_uniform":
		return "sgm_uniform"
	case "simple":
		return "simple"
	case "kl_optimal":
		return "kl_optimal"
	case "lcm":
		return "lcm"
	case "bong_tangent":
		return "bong_tangent"
	default:
		return ""
	}
}

func managedImageOptionKey(option string) string {
	key := strings.TrimSpace(option)
	if index := strings.Index(key, ":"); index >= 0 {
		key = key[:index]
	}
	return strings.ToLower(strings.TrimSpace(key))
}

func (s *Service) setManagedSupervisedImageUnhealthy(model *runtimev1.LocalAssetRecord, detail string) (*runtimev1.LocalAssetHealth, error) {
	if model == nil {
		return nil, nil
	}
	localAssetID := strings.TrimSpace(model.GetLocalAssetId())
	_ = s.freeManagedMediaImageOnIdle(context.Background(), localAssetID, "unhealthy_cleanup")
	s.clearManagedMediaImageLoadCache(localAssetID)
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
