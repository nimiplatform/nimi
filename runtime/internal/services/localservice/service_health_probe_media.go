package localservice

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) bootstrapAssetExecutionEngineIfManaged(ctx context.Context, model *runtimev1.LocalAssetRecord, mode runtimev1.LocalEngineRuntimeMode) error {
	mgr := s.engineManagerOrNil()
	if mgr == nil || model == nil {
		return nil
	}
	if normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return nil
	}
	engineName := executionRuntimeEngineForModel(model)
	endpoint := s.effectiveLocalModelEndpoint(model)
	port, err := parseManagedEndpointPort(engineName, endpoint)
	if err != nil {
		return err
	}
	profile := collectDeviceProfile()
	if classification, detail := classifyManagedEngineSupportForAsset(
		model.GetEngine(),
		model.GetCapabilities(),
		model.GetKind(),
		profile,
	); classification != localEngineSupportSupportedSupervised {
		if strings.TrimSpace(detail) != "" {
			return fmt.Errorf("%s", detail)
		}
		return fmt.Errorf("%s managed mode is unavailable on this host", strings.TrimSpace(engineName))
	}
	if strings.EqualFold(engineName, "media") &&
		isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		selection := canonicalSupervisedImageSelectionForLocalAsset(model, collectDeviceProfile())
		if !selection.Matched || selection.Conflict || selection.Entry == nil {
			detail := strings.TrimSpace(selection.CompatibilityDetail)
			if detail == "" {
				detail = "canonical image selection unavailable for managed media bootstrap"
			}
			return fmt.Errorf("%s", detail)
		}
		if selection.ProductState != engine.ImageProductStateSupported {
			detail := strings.TrimSpace(selection.CompatibilityDetail)
			if detail == "" {
				detail = fmt.Sprintf("image topology %s is not supported for managed media bootstrap", selection.EntryID)
			}
			return fmt.Errorf("%s", detail)
		}
		mediaMode, err := engine.MediaModeFromSelection(selection)
		if err != nil {
			return err
		}
		cfg := engine.DefaultMediaConfig()
		cfg.Port = port
		cfg.MediaMode = mediaMode
		cfg.ImageSupervisedSelection = &selection
		if managedEngineAlreadyBound(mgr, "media", port) {
			return nil
		}
		if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
			lower := strings.ToLower(strings.TrimSpace(err.Error()))
			if strings.Contains(lower, "already running") {
				return nil
			}
			return err
		}
		return nil
	}
	if managedEngineAlreadyBound(mgr, strings.ToLower(strings.TrimSpace(engineName)), port) {
		return nil
	}
	if err := mgr.StartEngine(ctx, strings.ToLower(strings.TrimSpace(engineName)), port, ""); err != nil {
		lower := strings.ToLower(strings.TrimSpace(err.Error()))
		if strings.Contains(lower, "already running") {
			return nil
		}
		return err
	}
	return nil
}

func (s *Service) bootstrapLocalModelIfManaged(ctx context.Context, model *runtimev1.LocalAssetRecord) error {
	if model == nil {
		return nil
	}
	mode := s.modelRuntimeMode(model.GetLocalAssetId())
	if normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED &&
		isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		selection := canonicalSupervisedImageSelectionForLocalAsset(model, collectDeviceProfile())
		executionEngine := executionRuntimeEngineForSelection(selection)
		if executionEngine != "media" {
			return nil
		}
		return s.bootstrapSelectionAwareManagedMediaEngine(ctx, model, selection)
	}
	supervisorEngine := managedRuntimeEngineForModel(model)
	executionEngine := executionRuntimeEngineForModel(model)
	if err := s.bootstrapEngineIfManaged(
		ctx,
		supervisorEngine,
		mode,
		s.managedEndpointForEngine(supervisorEngine),
	); err != nil {
		return err
	}
	if executionEngine == supervisorEngine {
		return nil
	}
	return s.bootstrapAssetExecutionEngineIfManaged(ctx, model, mode)
}

func (s *Service) bootstrapSelectionAwareManagedMediaEngine(
	ctx context.Context,
	model *runtimev1.LocalAssetRecord,
	selection engine.ImageSupervisedMatrixSelection,
) error {
	mgr := s.engineManagerOrNil()
	if mgr == nil || model == nil {
		return nil
	}
	endpoint := s.effectiveLocalModelEndpoint(model)
	port, err := parseManagedEndpointPort("media", endpoint)
	if err != nil {
		return err
	}
	mediaMode, err := engine.MediaModeFromSelection(selection)
	if err != nil {
		return err
	}
	cfg := engine.DefaultMediaConfig()
	cfg.Port = port
	cfg.MediaMode = mediaMode
	cfg.ImageSupervisedSelection = &selection
	if managedEngineAlreadyBound(mgr, "media", port) {
		return nil
	}
	if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
		lower := strings.ToLower(strings.TrimSpace(err.Error()))
		if strings.Contains(lower, "already running") {
			return nil
		}
		return err
	}
	return nil
}

func managedEngineAlreadyBound(mgr EngineManager, engineName string, port int) bool {
	if mgr == nil || strings.TrimSpace(engineName) == "" || port <= 0 {
		return false
	}
	info, err := mgr.EngineStatus(engineName)
	if err != nil {
		return false
	}
	if info.PID <= 0 || info.Port != port {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(info.Status)) {
	case "", "stopped":
		return false
	default:
		return true
	}
}
