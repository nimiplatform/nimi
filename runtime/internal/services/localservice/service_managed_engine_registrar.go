package localservice

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const generatedManagedLlamaModelsConfigRelPath = ".nimi/runtime/llama-models.yaml"

const (
	managedImageBackendServiceID    = "svc_managed_image_backend"
	managedImageBackendServiceTitle = "Managed Image Backend"
)

type managedLlamaRegistration struct {
	LocalModelID      string
	ModelID           string
	ExposedModelName  string
	Capabilities      []string
	Backend           string
	AbsoluteModelPath string
	RelativeModelPath string
	ManifestPath      string
	Managed           bool
	DynamicProfile    bool
	Problem           string
	LlamaEngineConfig *engine.ManagedLlamaEngineConfig
}

func resolveLocalModelsPath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	return ""
}

func resolveLocalEnvironmentRuntimeDataRoot(configuredDataRoot string, configuredModelsPath string) string {
	if value := strings.TrimSpace(configuredDataRoot); value != "" {
		return value
	}
	modelsRoot := strings.TrimSpace(resolveLocalModelsPath(configuredModelsPath))
	if modelsRoot == "" {
		return ""
	}
	cleanRoot := filepath.Clean(modelsRoot)
	if filepath.Base(cleanRoot) != "models" {
		return cleanRoot
	}
	parent := filepath.Dir(cleanRoot)
	if parent == "." || parent == cleanRoot {
		return cleanRoot
	}
	return parent
}

func (s *Service) localEnvironmentRuntimeDataRoot() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	runtimeDataRoot := s.runtimeDataRoot
	localModelsPath := s.localModelsPath
	s.mu.RUnlock()
	return resolveLocalEnvironmentRuntimeDataRoot(runtimeDataRoot, localModelsPath)
}

func resolveGeneratedLlamaModelsConfigPath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, generatedManagedLlamaModelsConfigRelPath)
}

// SetManagedLlamaRegistrationConfig updates the managed llama registration
// settings used for runtime-generated llama config output.
func (s *Service) SetManagedLlamaRegistrationConfig(modelsPath string, modelsConfigPath string, managed bool) {
	s.mu.Lock()
	s.localModelsPath = resolveLocalModelsPath(modelsPath)
	s.managedLlamaModelsConfigPath = resolveGeneratedLlamaModelsConfigPath(modelsConfigPath)
	s.managedLlamaEnabled = managed
	configured := strings.TrimSpace(s.managedLlamaModelsConfigPath)
	s.mu.Unlock()
	if managed && configured != "" {
		if err := s.SyncManagedLlamaAssets(context.Background()); err != nil {
			s.logger.Warn("sync managed llama assets after config update failed", "error", err)
		}
	}
}

// SetManagedLlamaEndpoint records the managed llama endpoint exposed by the
// daemon and rewrites supervised llama model endpoints to that endpoint.
func (s *Service) SetManagedLlamaEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.managedLlamaEndpointValue = strings.TrimSpace(endpoint)
	if s.managedLlamaEndpointValue == "" {
		return
	}
	s.syncManagedEndpointProjectionLocked("llama", s.managedLlamaEndpointValue)
}

// ManagedLlamaEndpoint returns the currently exposed managed llama loopback
// endpoint, if any.
func (s *Service) ManagedLlamaEndpoint() string {
	return s.managedLlamaEndpoint()
}

// ManagedLlamaRouterReady reports whether the shared managed llama router has
// a generated preset with at least one valid Runtime-owned llama registration.
// The daemon uses this to avoid starting llama-server with an absent/empty
// --models-preset before onboarding materialization has admitted a text model.
func (s *Service) ManagedLlamaRouterReady() bool {
	if s == nil {
		return false
	}
	s.mu.RLock()
	managed := s.managedLlamaEnabled
	configPath := strings.TrimSpace(s.managedLlamaModelsConfigPath)
	readyRegistration := false
	for _, registration := range s.managedLlamaRegistrations {
		if registration.Managed && !registration.DynamicProfile && strings.TrimSpace(registration.Problem) == "" {
			readyRegistration = true
			break
		}
	}
	s.mu.RUnlock()
	if !managed || configPath == "" || !readyRegistration {
		return false
	}
	raw, err := os.ReadFile(configPath)
	return err == nil && len(bytes.TrimSpace(raw)) > 0
}

// SetManagedMediaEndpoint records the managed media endpoint exposed
// by the daemon and rewrites supervised media model endpoints to that value.
func (s *Service) SetManagedMediaEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.managedMediaEndpointValue = strings.TrimSpace(endpoint)
	if s.managedMediaEndpointValue == "" {
		return
	}
	s.syncManagedEndpointProjectionLocked("media", s.managedMediaEndpointValue)
}

// ManagedMediaEndpoint returns the currently exposed managed media loopback
// endpoint, if any.
func (s *Service) ManagedMediaEndpoint() string {
	return s.managedMediaEndpoint()
}

// ResolveManagedMediaBackendTarget returns the local models root and the
// daemon-managed image backend address used by the supervised gguf image path.
func (s *Service) ResolveManagedMediaBackendTarget(_ context.Context) (string, string, error) {
	s.mu.RLock()
	modelsRoot := resolveLocalModelsPath(s.localModelsPath)
	address := strings.TrimSpace(s.managedMediaBackendAddress)
	s.mu.RUnlock()
	return modelsRoot, address, nil
}

// SetManagedSpeechEndpoint records the managed speech endpoint exposed
// by the daemon and rewrites supervised speech model endpoints to that value.
func (s *Service) SetManagedSpeechEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.managedSpeechEndpointValue = strings.TrimSpace(endpoint)
	if s.managedSpeechEndpointValue == "" {
		return
	}
	s.syncManagedEndpointProjectionLocked("speech", s.managedSpeechEndpointValue)
}

func (s *Service) syncManagedEndpointProjectionLocked(engineName string, endpoint string) {
	normalizedEngine := strings.ToLower(strings.TrimSpace(engineName))
	normalizedEndpoint := strings.TrimSpace(endpoint)
	if normalizedEngine == "" || normalizedEndpoint == "" {
		return
	}
	changed := false
	now := nowISO()

	for id, record := range s.assets {
		if record == nil {
			continue
		}
		if normalizeRuntimeMode(s.assetRuntimeModes[id]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if managedRuntimeEngineForModel(record) != normalizedEngine {
			continue
		}
		if strings.TrimSpace(record.GetEndpoint()) == normalizedEndpoint {
			continue
		}
		cloned := cloneLocalAsset(record)
		cloned.Endpoint = normalizedEndpoint
		cloned.UpdatedAt = now
		s.assets[id] = cloned
		changed = true
	}

	for id, record := range s.services {
		if record == nil {
			continue
		}
		if normalizeRuntimeMode(s.serviceRuntimeModes[id]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if strings.ToLower(strings.TrimSpace(record.GetEngine())) != normalizedEngine {
			continue
		}
		if strings.TrimSpace(record.GetEndpoint()) == normalizedEndpoint {
			continue
		}
		cloned := cloneServiceDescriptor(record)
		cloned.Endpoint = normalizedEndpoint
		cloned.UpdatedAt = now
		s.services[id] = cloned
		changed = true
	}

	if changed {
		s.persistStateLocked()
	}
}

// SetManagedImageBackendConfig records whether the managed image
// backend is configured for daemon-supervised local media workflows.
func (s *Service) SetManagedImageBackendConfig(enabled bool, address string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.managedMediaBackendConfigured = enabled
	s.managedMediaBackendHealthy = false
	s.managedMediaBackendAddress = strings.TrimSpace(address)
	s.managedMediaBackendEpoch++
	s.resetManagedMediaImageLoadCacheLocked()
	now := nowISO()
	if enabled {
		if strings.TrimSpace(s.managedMediaBackendInstalledAt) == "" {
			s.managedMediaBackendInstalledAt = now
		}
		s.managedMediaBackendUpdatedAt = now
		s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
		s.managedMediaBackendDetail = "daemon-managed image backend configured"
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
	s.managedMediaBackendDetail = "daemon-managed image backend disabled"
	s.managedMediaBackendInstalledAt = ""
	s.managedMediaBackendUpdatedAt = now
}

// SetManagedImageBackendHealth records the current managed image
// backend health reported by the engine supervisor.
func (s *Service) SetManagedImageBackendHealth(healthy bool, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.managedMediaBackendConfigured {
		return
	}
	s.managedMediaBackendHealthy = healthy
	s.managedMediaBackendUpdatedAt = nowISO()
	s.managedMediaBackendEpoch++
	s.resetManagedMediaImageLoadCacheLocked()
	trimmed := strings.TrimSpace(detail)
	if healthy {
		s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE
		s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed image backend active")
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY
	s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed image backend unhealthy")
}

// SyncManagedLlamaAssets rebuilds the runtime-managed llama config from the
// current local model state and restarts the managed engine when the generated
// config changes while llama is already running.
func (s *Service) SyncManagedLlamaAssets(ctx context.Context) error {
	registrations, rendered, err := s.buildManagedLlamaRegistrations()
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.managedLlamaRegistrations = registrations
	managed := s.managedLlamaEnabled
	configPath := strings.TrimSpace(s.managedLlamaModelsConfigPath)
	s.mu.Unlock()

	if !managed || configPath == "" {
		return nil
	}
	hasManagedRegistration := false
	for _, registration := range registrations {
		if registration.Managed {
			hasManagedRegistration = true
			break
		}
	}
	if !hasManagedRegistration {
		if _, statErr := os.Stat(configPath); errors.Is(statErr, os.ErrNotExist) {
			return nil
		}
	}

	changed, err := writeGeneratedLlamaConfigIfChanged(configPath, rendered)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}

	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return nil
	}
	info, err := mgr.EngineStatus("llama")
	if err != nil {
		return nil
	}
	if err := mgr.StopEngine("llama"); err != nil {
		return fmt.Errorf("restart managed llama stop: %w", err)
	}
	if err := waitForManagedEnginePortReleaseWithProbe(ctx, info.Port, 5*time.Second, s.managedPortAvailable); err != nil {
		return fmt.Errorf("restart managed llama wait for port %d: %w", info.Port, err)
	}
	if err := mgr.StartEngine(ctx, "llama", info.Port, info.Version); err != nil {
		return fmt.Errorf("restart managed llama start: %w", err)
	}
	return nil
}

func waitForManagedEnginePortRelease(ctx context.Context, port int, timeout time.Duration) error {
	return waitForManagedEnginePortReleaseWithProbe(ctx, port, timeout, loopbackPortAvailable)
}

func waitForManagedEnginePortReleaseWithProbe(ctx context.Context, port int, timeout time.Duration, probe func(int) bool) error {
	if port <= 0 || port > 65535 {
		return fmt.Errorf("invalid managed engine port %d", port)
	}
	if probe == nil {
		probe = loopbackPortAvailable
	}

	deadline := time.Now().Add(timeout)
	for {
		if probe(port) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("configured port %d remained unavailable after %s", port, timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func loopbackPortAvailable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func (s *Service) buildManagedLlamaRegistrations() (map[string]managedLlamaRegistration, []byte, error) {
	s.mu.RLock()
	models := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, model := range s.assets {
		models = append(models, cloneLocalAsset(model))
	}
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.managedLlamaEnabled
	imageBackendUp := s.managedMediaBackendConfigured && s.managedMediaBackendHealthy
	primaryName := s.primaryManagedLlamaModelName
	s.mu.RUnlock()
	deviceProfile := collectDeviceProfile()

	sort.Slice(models, func(i, j int) bool {
		return models[i].GetLocalAssetId() < models[j].GetLocalAssetId()
	})

	registrations := make(map[string]managedLlamaRegistration, len(models))
	candidateIndexes := make(map[string][]string)
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(
			managedRuntimeEngineForModel(model),
			"llama",
		) {
			continue
		}
		if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(model.GetLocalAssetId())); err != nil {
			registration := inspectManagedLlamaModelRegistration(model, s.modelRuntimeMode(model.GetLocalAssetId()), modelsPath, managed, imageBackendUp, deviceProfile)
			registration.Problem = managedLocalAssetRecordFailureDetail(err)
			registrations[model.GetLocalAssetId()] = registration
			continue
		}

		registration := inspectManagedLlamaModelRegistration(model, s.modelRuntimeMode(model.GetLocalAssetId()), modelsPath, managed, imageBackendUp, deviceProfile)
		registrations[model.GetLocalAssetId()] = registration
		if registration.Managed && strings.TrimSpace(registration.Problem) == "" {
			candidateIndexes[registration.ExposedModelName] = append(candidateIndexes[registration.ExposedModelName], model.GetLocalAssetId())
		}
	}

	for modelName, localModelIDs := range candidateIndexes {
		if len(localModelIDs) <= 1 {
			continue
		}
		sort.Strings(localModelIDs)
		for _, localModelID := range localModelIDs {
			registration := registrations[localModelID]
			registration.Problem = fmt.Sprintf("llama registration name conflict for %q", modelName)
			registrations[localModelID] = registration
		}
	}

	presetRegistrations := make([]managedLlamaRegistration, 0, len(registrations))
	for _, registration := range registrations {
		if !registration.Managed || strings.TrimSpace(registration.Problem) != "" || registration.DynamicProfile {
			continue
		}
		presetRegistrations = append(presetRegistrations, registration)
	}
	sort.Slice(presetRegistrations, func(i, j int) bool {
		if primaryName != "" {
			iPrimary := strings.EqualFold(presetRegistrations[i].ExposedModelName, primaryName)
			jPrimary := strings.EqualFold(presetRegistrations[j].ExposedModelName, primaryName)
			if iPrimary != jPrimary {
				return iPrimary
			}
		}
		if presetRegistrations[i].ExposedModelName != presetRegistrations[j].ExposedModelName {
			return presetRegistrations[i].ExposedModelName < presetRegistrations[j].ExposedModelName
		}
		return presetRegistrations[i].AbsoluteModelPath < presetRegistrations[j].AbsoluteModelPath
	})

	if len(presetRegistrations) == 0 {
		return registrations, nil, nil
	}

	rendered, err := renderManagedLlamaPreset(modelsPath, presetRegistrations, primaryName)
	if err != nil {
		return nil, nil, fmt.Errorf("render llama models preset: %w", err)
	}
	return registrations, rendered, nil
}

func inspectManagedLlamaModelRegistration(
	model *runtimev1.LocalAssetRecord,
	mode runtimev1.LocalEngineRuntimeMode,
	modelsPath string,
	managed bool,
	imageBackendUp bool,
	deviceProfile *runtimev1.LocalDeviceProfile,
) managedLlamaRegistration {
	registration := managedLlamaRegistration{
		LocalModelID:     strings.TrimSpace(model.GetLocalAssetId()),
		ModelID:          strings.TrimSpace(model.GetAssetId()),
		ExposedModelName: normalizeManagedModelRegistrationModelID(model.GetAssetId()),
		Capabilities:     normalizeAssetCapabilities(model.GetCapabilities()),
		Managed:          managed && normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
	}
	if !registration.Managed {
		return registration
	}

	if isCanonicalSupervisedImageAsset(model.GetEngine(), model.GetCapabilities(), model.GetKind()) {
		registration.Managed = false
		registration.Backend = ""
		registration.DynamicProfile = false
		registration.Problem = ""
		return registration
	}

	backend, err := managedLlamaBackendForCapabilities(defaultCapabilitiesForRegistration(model.GetCapabilities(), nil))
	if err != nil {
		registration.Problem = err.Error()
		return registration
	}
	registration.Backend = backend

	absoluteModelPath, resolveErr := resolveManagedModelEntryAbsolutePath(modelsPath, model)
	if resolveErr != nil {
		registration.Problem = resolveErr.Error()
		return registration
	}
	relativeModelPath, relErr := filepath.Rel(modelsPath, absoluteModelPath)
	if relErr != nil {
		registration.Problem = relErr.Error()
		return registration
	}
	registration.AbsoluteModelPath = absoluteModelPath
	registration.RelativeModelPath = filepath.ToSlash(relativeModelPath)

	// Extract and validate engine_config.llama.* parameters (K-LENG-018).
	llamaCfg, extractErr := engine.ExtractManagedLlamaEngineConfig(model.GetEngineConfig())
	if extractErr != nil {
		registration.Problem = extractErr.Error()
		return registration
	}
	bundleRoot, bundleRootErr := resolveManagedBundleRootAbsolutePath(modelsPath, model)
	if bundleRootErr != nil {
		registration.Problem = bundleRootErr.Error()
		return registration
	}

	// mmproj auto-detect: if engine_config.llama.mmproj is not set,
	// scan the model's file list for mmproj*.gguf candidates.
	if llamaCfg.Mmproj == "" {
		candidates := findMmprojCandidates(model.GetFiles())
		switch len(candidates) {
		case 0:
			// No mmproj found — fine for text-only models.
		case 1:
			resolved, err := resolveManagedBundleFileToModelsRelativePath(modelsPath, bundleRoot, candidates[0])
			if err != nil {
				registration.Problem = err.Error()
				return registration
			}
			llamaCfg.Mmproj = resolved
		default:
			registration.Problem = fmt.Sprintf(
				"multiple mmproj candidates (%s); set engine_config.llama.mmproj explicitly",
				strings.Join(candidates, ", "),
			)
			return registration
		}
	}
	if llamaCfg.Mmproj != "" {
		if err := validateManagedLlamaMMProjPath(modelsPath, bundleRoot, bundleRoot, llamaCfg.Mmproj); err != nil {
			registration.Problem = err.Error()
			return registration
		}
	}

	// Companion enforcement (K-LOCAL-033): if model declares vision
	// capability but no mmproj is available, fail-close at registration.
	for _, cap := range model.GetCapabilities() {
		if strings.EqualFold(strings.TrimSpace(cap), "text.generate.vision") {
			if llamaCfg.Mmproj == "" {
				registration.Problem = "model declares text.generate.vision but no mmproj artifact available"
				return registration
			}
			break
		}
	}

	registration.LlamaEngineConfig = &llamaCfg
	return registration
}

func (s *Service) managedLlamaRegistrationForModel(model *runtimev1.LocalAssetRecord) managedLlamaRegistration {
	if model == nil {
		return managedLlamaRegistration{}
	}
	if healedModel, _, err := s.healManagedSupervisedRuntimeMode(model.GetLocalAssetId()); err != nil {
		return managedLlamaRegistration{
			LocalModelID: strings.TrimSpace(model.GetLocalAssetId()),
			ModelID:      strings.TrimSpace(model.GetAssetId()),
			Managed:      true,
			Problem:      managedLocalAssetRecordFailureDetail(err),
		}
	} else if healedModel != nil {
		model = healedModel
	}
	if err := validateManagedLocalAssetRecord(model, s.modelRuntimeMode(model.GetLocalAssetId())); err != nil {
		return managedLlamaRegistration{
			LocalModelID: strings.TrimSpace(model.GetLocalAssetId()),
			ModelID:      strings.TrimSpace(model.GetAssetId()),
			Managed:      normalizeRuntimeMode(s.modelRuntimeMode(model.GetLocalAssetId())) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
			Problem:      managedLocalAssetRecordFailureDetail(err),
		}
	}

	localModelID := strings.TrimSpace(model.GetLocalAssetId())
	s.mu.RLock()
	registration, ok := s.managedLlamaRegistrations[localModelID]
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.managedLlamaEnabled
	imageBackendUp := s.managedMediaBackendConfigured && s.managedMediaBackendHealthy
	mode := s.assetRuntimeModes[localModelID]
	s.mu.RUnlock()
	deviceProfile := collectDeviceProfile()
	if ok && !registration.DynamicProfile {
		return registration
	}
	return inspectManagedLlamaModelRegistration(model, mode, modelsPath, managed, imageBackendUp, deviceProfile)
}
