package localservice

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const generatedManagedLlamaModelsConfigRelPath = ".nimi/runtime/llama-models.yaml"

const (
	managedMediaDiffusersBackendServiceID    = "svc_managed_image_backend"
	managedMediaDiffusersBackendServiceTitle = "Managed Image Backend"
)

type managedLlamaRegistration struct {
	LocalModelID      string
	ModelID           string
	ExposedModelName  string
	Backend           string
	RelativeModelPath string
	ManifestPath      string
	Managed           bool
	DynamicProfile    bool
	Problem           string
}

type managedLlamaConfigEntry struct {
	Name       string                       `yaml:"name"`
	Backend    string                       `yaml:"backend"`
	Parameters managedLlamaConfigParameters `yaml:"parameters"`
}

type managedLlamaConfigParameters struct {
	Model string `yaml:"model"`
}

func resolveLocalModelsPath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("NIMI_RUNTIME_LOCAL_MODELS_PATH")); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, ".nimi", "data", "models")
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

}

// ManagedLlamaEndpoint returns the currently exposed managed llama loopback
// endpoint, if any.
func (s *Service) ManagedLlamaEndpoint() string {
	return s.managedLlamaEndpoint()
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

}

// SetManagedMediaDiffusersBackendConfig records whether the managed diffusers image
// backend is configured for daemon-supervised local media workflows.
func (s *Service) SetManagedMediaDiffusersBackendConfig(enabled bool, address string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.managedMediaBackendConfigured = enabled
	s.managedMediaBackendHealthy = false
	s.managedMediaBackendAddress = strings.TrimSpace(address)
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

// SetManagedMediaDiffusersBackendHealth records the current managed diffusers image
// backend health reported by the engine supervisor.
func (s *Service) SetManagedMediaDiffusersBackendHealth(healthy bool, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.managedMediaBackendConfigured {
		return
	}
	s.managedMediaBackendHealthy = healthy
	s.managedMediaBackendUpdatedAt = nowISO()
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
	if err := mgr.StartEngine(ctx, "llama", info.Port, info.Version); err != nil {
		return fmt.Errorf("restart managed llama start: %w", err)
	}
	return nil
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

	entries := make([]managedLlamaConfigEntry, 0, len(registrations))
	for _, registration := range registrations {
		if !registration.Managed || strings.TrimSpace(registration.Problem) != "" {
			continue
		}
		if registration.DynamicProfile {
			continue
		}
		entries = append(entries, managedLlamaConfigEntry{
			Name:    registration.ExposedModelName,
			Backend: registration.Backend,
			Parameters: managedLlamaConfigParameters{
				Model: registration.RelativeModelPath,
			},
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Name != entries[j].Name {
			return entries[i].Name < entries[j].Name
		}
		if entries[i].Backend != entries[j].Backend {
			return entries[i].Backend < entries[j].Backend
		}
		return entries[i].Parameters.Model < entries[j].Parameters.Model
	})

	if len(entries) == 0 {
		return registrations, nil, nil
	}

	rendered, err := yaml.Marshal(entries)
	if err != nil {
		return nil, nil, fmt.Errorf("marshal llama models config: %w", err)
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
	registration.RelativeModelPath = filepath.ToSlash(relativeModelPath)
	return registration
}

func defaultCapabilitiesForRegistration(runtimeCaps []string, manifestCaps []string) []string {
	if len(runtimeCaps) > 0 {
		return normalizeStringSlice(runtimeCaps)
	}
	return normalizeStringSlice(manifestCaps)
}

func managedLlamaBackendForCapabilities(capabilities []string) (string, error) {
	backends := make(map[string]bool, len(capabilities))
	for _, capability := range capabilities {
		normalized := strings.ToLower(strings.TrimSpace(capability))
		if normalized == "" {
			continue
		}
		switch normalized {
		case "stt", "transcription":
			backends["whisper-ggml"] = true
		case "chat", "embedding", "embed":
			backends["llama-cpp"] = true
		default:
			backends["llama-cpp"] = true
		}
	}
	if len(backends) == 0 {
		return "llama-cpp", nil
	}
	if len(backends) > 1 {
		keys := make([]string, 0, len(backends))
		for key := range backends {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		return "", fmt.Errorf("llama backend conflict for capabilities=%s", strings.Join(keys, ","))
	}
	for key := range backends {
		return key, nil
	}
	return "llama-cpp", nil
}

func normalizeManagedModelRegistrationModelID(modelID string) string {
	raw := strings.TrimSpace(modelID)
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "llama/"):
		raw = strings.TrimSpace(raw[len("llama/"):])
	case strings.HasPrefix(lower, "media/"):
		raw = strings.TrimSpace(raw[len("media/"):])
	case strings.HasPrefix(lower, "local/"):
		raw = strings.TrimSpace(raw[len("local/"):])
	}
	if raw == "" {
		return "local-model"
	}
	return raw
}

func slugifyLocalModelID(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))
	for _, ch := range input {
		switch {
		case ch >= 'A' && ch <= 'Z':
			builder.WriteRune(ch + ('a' - 'A'))
		case ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9':
			builder.WriteRune(ch)
		case ch == '-', ch == '_', ch == '/', ch == ':', ch == '.', ch == ' ', ch == '\t', ch == '\n', ch == '\r':
			builder.WriteByte('-')
		}
	}
	parts := strings.FieldsFunc(builder.String(), func(r rune) bool { return r == '-' })
	if len(parts) == 0 {
		return "local-model"
	}
	return strings.Join(parts, "-")
}

func writeGeneratedLlamaConfigIfChanged(path string, rendered []byte) (bool, error) {
	if len(bytes.TrimSpace(rendered)) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("remove llama config %s: %w", path, err)
		}
		return true, nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, fmt.Errorf("create llama config directory: %w", err)
	}

	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, rendered) {
		return false, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("read llama config %s: %w", path, err)
	}
	if err := os.WriteFile(path, rendered, 0o600); err != nil {
		return false, fmt.Errorf("write llama config %s: %w", path, err)
	}
	return true, nil
}

func (s *Service) managedLlamaRegistrationForModel(model *runtimev1.LocalAssetRecord) managedLlamaRegistration {
	if model == nil {
		return managedLlamaRegistration{}
	}
	if healedModel, _, err := s.healManagedSupervisedLlamaRuntimeMode(model.GetLocalAssetId()); err != nil {
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

func modelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult, registration managedLlamaRegistration) bool {
	if isManagedSupervisedLlamaModel(model, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED) {
		return managedLlamaModelProbeSucceeded(probe, registration)
	}
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeSucceeded(probe, registration)
	case "media":
		return mediaModelProbeSucceeded(model, probe)
	}
	return probe.healthy
}

func modelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult, registration managedLlamaRegistration) string {
	if isManagedSupervisedLlamaModel(model, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED) {
		return managedLlamaModelProbeFailureDetail(probe, registration)
	}
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeFailureDetail(probe, registration)
	case "media":
		return mediaModelProbeFailureDetail(model, probe)
	}
	return defaultString(probe.detail, "model probe failed")
}

func mediaModelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" || len(probe.models) == 0 {
		return false
	}
	_, ok := findComparableProbeModel(probe.models, expectedModelName)
	return ok
}

func mediaModelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	if !probe.healthy {
		return defaultString(probe.detail, "media model probe failed")
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" {
		return "media probe requires a model id"
	}
	available := compactProbeModelIDs(probe.models)
	if len(available) == 0 {
		return fmt.Sprintf("media probe missing expected model %q", expectedModelName)
	}
	return fmt.Sprintf("media probe missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
}

func managedLlamaModelProbeSucceeded(probe endpointProbeResult, registration managedLlamaRegistration) bool {
	if strings.TrimSpace(registration.Problem) != "" {
		return false
	}
	if registration.DynamicProfile {
		return probe.responded
	}
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(registration.ExposedModelName)
	if expectedModelName == "" || len(probe.models) == 0 {
		return true
	}
	for _, modelID := range probe.models {
		if strings.EqualFold(strings.TrimSpace(modelID), expectedModelName) {
			return true
		}
	}
	return false
}

func managedLlamaModelProbeFailureDetail(probe endpointProbeResult, registration managedLlamaRegistration) string {
	if detail := strings.TrimSpace(registration.Problem); detail != "" {
		return detail
	}
	if registration.DynamicProfile {
		if probe.responded {
			return "local media workflow ready"
		}
		return defaultString(probe.detail, "local media workflow unavailable")
	}
	if !probe.healthy {
		return defaultString(probe.detail, "model probe failed")
	}
	expectedModelName := strings.TrimSpace(registration.ExposedModelName)
	if expectedModelName == "" || len(probe.models) == 0 {
		return defaultString(probe.detail, "model probe failed")
	}
	available := make([]string, 0, len(probe.models))
	for _, modelID := range probe.models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed != "" {
			available = append(available, trimmed)
		}
	}
	sort.Strings(available)
	if len(available) == 0 {
		return fmt.Sprintf("probe response missing expected model %q", expectedModelName)
	}
	return fmt.Sprintf("probe response missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
}

func compactProbeModelIDs(models []string) []string {
	available := make([]string, 0, len(models))
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed != "" {
			available = append(available, trimmed)
		}
	}
	sort.Strings(available)
	return available
}

func findComparableProbeModel(models []string, expected string) (string, bool) {
	expectedComparable := normalizeComparableModelID(expected)
	expectedBase := probeModelIDBase(expected)
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed == "" {
			continue
		}
		if normalizeComparableModelID(trimmed) == expectedComparable {
			return trimmed, true
		}
		if probeModelIDBase(trimmed) == expectedBase {
			return trimmed, true
		}
	}
	return "", false
}

func normalizeComparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	comparable = strings.TrimPrefix(comparable, "models/")
	comparable = strings.TrimPrefix(comparable, "model/")
	comparable = strings.TrimPrefix(comparable, "local/")
	comparable = strings.TrimPrefix(comparable, "llama/")
	comparable = strings.TrimPrefix(comparable, "media/")
	comparable = strings.TrimPrefix(comparable, "speech/")
	return comparable
}

func probeModelIDBase(value string) string {
	trimmed := normalizeComparableModelID(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.TrimSpace(trimmed[:idx])
	}
	return trimmed
}
