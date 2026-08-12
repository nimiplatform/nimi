package localservice

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const (
	managedMediaImageProfileConsumerBase = "media.diffusers"
	managedMediaVideoProfileConsumerBase = "media.video-python"
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
		if selectionUsesDirectManagedImageBackend(selection) {
			return nil
		}
		endpoint := s.effectiveLocalModelEndpoint(model)
		port, err := parseManagedEndpointPort(engineName, endpoint)
		if err != nil {
			return err
		}
		mediaMode, err := engine.MediaModeFromSelection(selection)
		if err != nil {
			return err
		}
		cfg, err := s.configuredManagedMediaEngineConfig(port, mediaMode, &selection, managedMediaImageProfileConsumerBase)
		if err != nil {
			return err
		}
		return s.materializeManagedMediaExecutionHost(ctx, mgr, cfg)
	}
	if privateExecutionHostEngine(engineName) {
		return fmt.Errorf("llama process lifecycle is private to the capability ExecutionHost")
	}
	if strings.EqualFold(strings.TrimSpace(engineName), "speech") {
		return fmt.Errorf("speech process lifecycle is private to the exact capability ExecutionHost")
	}
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
	if strings.EqualFold(engineName, "media") {
		consumerBase, err := managedMediaProfileConsumerBaseForModel(model)
		if err != nil {
			return err
		}
		cfg, err := s.configuredManagedMediaEngineConfig(port, engine.MediaModePipelineSupervised, nil, consumerBase)
		if err != nil {
			return err
		}
		return s.materializeManagedMediaExecutionHost(ctx, mgr, cfg)
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
		if selectionUsesDirectManagedImageBackend(selection) {
			return nil
		}
		executionEngine := executionRuntimeEngineForSelection(selection)
		if executionEngine != "media" {
			return nil
		}
		return s.bootstrapSelectionAwareManagedMediaEngine(ctx, model, selection)
	}
	supervisorEngine := managedRuntimeEngineForModel(model)
	executionEngine := executionRuntimeEngineForModel(model)
	if normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED &&
		strings.EqualFold(supervisorEngine, "media") && strings.EqualFold(executionEngine, "media") {
		return s.bootstrapAssetExecutionEngineIfManaged(ctx, model, mode)
	}
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
	if selectionUsesDirectManagedImageBackend(selection) {
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
	cfg, err := s.configuredManagedMediaEngineConfig(port, mediaMode, &selection, managedMediaImageProfileConsumerBase)
	if err != nil {
		return err
	}
	return s.materializeManagedMediaExecutionHost(ctx, mgr, cfg)
}

func (s *Service) configuredManagedMediaEngineConfig(
	port int,
	mediaMode engine.MediaMode,
	selection *engine.ImageSupervisedMatrixSelection,
	consumerBase string,
) (engine.EngineConfig, error) {
	record, consumer, acceleratorPlane, ok, detail := s.selectedMediaPackageSetSourceForCurrentHost(consumerBase)
	if !ok {
		return engine.EngineConfig{}, fmt.Errorf("%s python.package-set selected source missing: %s", consumer, detail)
	}
	cfg := engine.DefaultMediaConfig()
	if port > 0 {
		cfg.Port = port
	}
	cfg.MediaMode = mediaMode
	cfg.ImageSupervisedSelection = selection
	cfg.MediaHostPackageSetRoot = strings.TrimSpace(record.CanonicalRoot)
	cfg.MediaHostAcceleratorPlane = acceleratorPlane
	cfg.ExecutionHostIdentity = mediaExecutionHostIdentity(cfg)
	if cfg.ExecutionHostIdentity == "" {
		return engine.EngineConfig{}, fmt.Errorf("media ExecutionHost dependency profile identity is incomplete")
	}
	return cfg, nil
}

func (s *Service) materializeManagedMediaExecutionHost(ctx context.Context, mgr EngineManager, cfg engine.EngineConfig) error {
	if mgr == nil {
		return fmt.Errorf("runtime engine manager unavailable")
	}
	if strings.TrimSpace(cfg.ExecutionHostIdentity) == "" {
		return fmt.Errorf("media ExecutionHost dependency profile identity is required")
	}

	s.managedMediaMu.Lock()
	defer s.managedMediaMu.Unlock()

	info, statusErr := mgr.EngineStatus("media")
	if statusErr == nil && managedEngineInfoAlreadyBound(info, cfg.Port) && info.ExecutionHostIdentity == cfg.ExecutionHostIdentity {
		return nil
	}
	if statusErr == nil && info.PID > 0 {
		if err := mgr.StopEngine("media"); err != nil {
			return fmt.Errorf("stop previous media ExecutionHost: %w", err)
		}
	}
	if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
		return err
	}
	return nil
}

func (s *Service) selectedMediaPackageSetSourceForCurrentHost(consumerBase string) (localEnvironmentSelectedSourceRecordState, string, string, bool, string) {
	consumerBase = strings.TrimSpace(consumerBase)
	switch consumerBase {
	case managedMediaImageProfileConsumerBase, managedMediaVideoProfileConsumerBase:
	default:
		return localEnvironmentSelectedSourceRecordState{}, consumerBase, "", false, "unsupported media dependency profile consumer"
	}
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	acceleratorPlane := "cpu"
	if localEnvironmentHostSupportsCUDA(hostState) {
		acceleratorPlane = "cuda"
	}
	consumer := consumerBase + "." + acceleratorPlane
	identity, err := engine.ResolvePythonDependencyProfileIdentity(
		consumer,
		localEnvironmentPlatformTuple(hostState),
		acceleratorPlane,
	)
	if err != nil {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "resolve current dependency profile: " + err.Error()
	}
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	environmentKey := localEnvironmentPythonProfileKey(
		localEnvironmentFamilyPythonPackageSet,
		identity.DependencyID,
		runtimeDataRoot,
	)
	record, ok := s.localEnvironmentSelectedSourceRecordForDependency(
		environmentKey,
		localEnvironmentFamilyPythonPackageSet,
		identity.DependencyID,
		consumer,
	)
	if !ok {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "no selected source consumption projection for current dependency profile"
	}
	if strings.TrimSpace(record.SourceKind) != localEnvironmentSourceManaged {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "current dependency profile is not Runtime-managed"
	}
	if isLocalEnvironmentRepairActive(record.RepairState) {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection is under repair"
	}
	if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection fails verification: " + err.Error()
	}
	if strings.TrimSpace(record.Version) != identity.ProfileDigest {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection has stale profile identity"
	}
	for key, expected := range pythonDependencyProfileHashes(identity) {
		if strings.TrimSpace(record.Hashes[key]) != expected {
			return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection has stale " + key
		}
	}
	expectedRoot := filepath.Join(runtimeDataRoot, "environments", "python-profiles", identity.ProfileDigest)
	if !sameLocalEnvironmentPath(record.CanonicalRoot, expectedRoot) {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection has non-canonical profile root"
	}
	mediaDriver := filepath.Join(expectedRoot, "media_server.py")
	if !localEnvironmentArtifactPathsContain(record.VerifiedArtifacts, mediaDriver) {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection is missing verified media Driver"
	}
	interpreterVerified := false
	for _, interpreter := range []string{
		filepath.Join(expectedRoot, "Scripts", "python.exe"),
		filepath.Join(expectedRoot, "bin", "python"),
	} {
		if localEnvironmentArtifactPathsContain(record.VerifiedArtifacts, interpreter) {
			interpreterVerified = true
			break
		}
	}
	if !interpreterVerified {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection is missing verified profile interpreter"
	}
	if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection fails local artifact verification: " + err.Error()
	}
	if err := engine.VerifyPythonDependencyProfileStaticContent(expectedRoot, consumer, identity); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, consumer, acceleratorPlane, false, "selected source consumption projection has static content drift: " + err.Error()
	}
	return record, consumer, acceleratorPlane, true, ""
}

func managedMediaProfileConsumerBaseForModel(model *runtimev1.LocalAssetRecord) (string, error) {
	if model == nil || !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "media") {
		return "", fmt.Errorf("managed media dependency profile consumer is unavailable")
	}
	if model.GetKind() == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO ||
		localAssetHasCapability(model.GetCapabilities(), "video.generate") {
		return managedMediaVideoProfileConsumerBase, nil
	}
	if isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		return managedMediaImageProfileConsumerBase, nil
	}
	return "", fmt.Errorf("managed media dependency profile consumer is unavailable for this asset")
}

func localEnvironmentArtifactPathsContain(values []string, expected string) bool {
	for _, value := range values {
		if sameLocalEnvironmentPath(value, expected) {
			return true
		}
	}
	return false
}

func selectionUsesDirectManagedImageBackend(selection engine.ImageSupervisedMatrixSelection) bool {
	return selection.ControlPlane == engine.ImageControlPlaneRuntime &&
		selection.ExecutionPlane == engine.EngineMedia &&
		selection.BackendClass == engine.ImageBackendClassNativeBinary
}

func managedEngineAlreadyBound(mgr EngineManager, engineName string, port int) bool {
	if mgr == nil || strings.TrimSpace(engineName) == "" || port <= 0 {
		return false
	}
	info, err := mgr.EngineStatus(engineName)
	if err != nil {
		return false
	}
	return managedEngineInfoAlreadyBound(info, port)
}

func managedEngineInfoAlreadyBound(info EngineInfo, port int) bool {
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
