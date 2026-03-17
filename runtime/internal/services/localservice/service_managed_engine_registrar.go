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
	managedMediaDiffusersBackendServiceID    = "svc_llama_image_backend"
	managedMediaDiffusersBackendServiceTitle = "Llama Image Backend"
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
	return filepath.Join(home, ".nimi", "models")
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
	defer s.mu.Unlock()
	s.localModelsPath = resolveLocalModelsPath(modelsPath)
	s.managedLlamaModelsConfigPath = resolveGeneratedLlamaModelsConfigPath(modelsConfigPath)
	s.managedLlamaEnabled = managed
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

	updatedAt := nowISO()
	changed := false
	for localModelID, model := range s.models {
		if model == nil || model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
			continue
		}
		if normalizeRuntimeMode(s.modelRuntimeModes[localModelID]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if strings.TrimSpace(model.GetEndpoint()) == s.managedLlamaEndpointValue {
			continue
		}
		cloned := cloneLocalModel(model)
		cloned.Endpoint = s.managedLlamaEndpointValue
		cloned.UpdatedAt = updatedAt
		s.models[localModelID] = cloned
		changed = true
	}
	if changed {
		s.persistStateLocked()
	}
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

	updatedAt := nowISO()
	changed := false
	for localModelID, model := range s.models {
		if model == nil || model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "media") {
			continue
		}
		if normalizeRuntimeMode(s.modelRuntimeModes[localModelID]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if strings.TrimSpace(model.GetEndpoint()) == s.managedMediaEndpointValue {
			continue
		}
		cloned := cloneLocalModel(model)
		cloned.Endpoint = s.managedMediaEndpointValue
		cloned.UpdatedAt = updatedAt
		s.models[localModelID] = cloned
		changed = true
	}
	if changed {
		s.persistStateLocked()
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
		s.managedMediaBackendDetail = "daemon-managed diffusers backend configured"
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
	s.managedMediaBackendDetail = "daemon-managed diffusers backend disabled"
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
		s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed diffusers backend active")
		return
	}
	s.managedMediaBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY
	s.managedMediaBackendDetail = defaultString(trimmed, "daemon-managed diffusers backend unhealthy")
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
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		models = append(models, cloneLocalModel(model))
	}
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.managedLlamaEnabled
	imageBackendUp := s.managedMediaBackendConfigured && s.managedMediaBackendHealthy
	s.mu.RUnlock()

	sort.Slice(models, func(i, j int) bool {
		return models[i].GetLocalModelId() < models[j].GetLocalModelId()
	})

	registrations := make(map[string]managedLlamaRegistration, len(models))
	candidateIndexes := make(map[string][]string)
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "llama") {
			continue
		}

		registration := inspectManagedLlamaModelRegistration(model, s.modelRuntimeMode(model.GetLocalModelId()), modelsPath, managed, imageBackendUp)
		registrations[model.GetLocalModelId()] = registration
		if registration.Managed && strings.TrimSpace(registration.Problem) == "" {
			candidateIndexes[registration.ExposedModelName] = append(candidateIndexes[registration.ExposedModelName], model.GetLocalModelId())
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
	model *runtimev1.LocalModelRecord,
	mode runtimev1.LocalEngineRuntimeMode,
	modelsPath string,
	managed bool,
	imageBackendUp bool,
) managedLlamaRegistration {
	registration := managedLlamaRegistration{
		LocalModelID:     strings.TrimSpace(model.GetLocalModelId()),
		ModelID:          strings.TrimSpace(model.GetModelId()),
		ExposedModelName: normalizeManagedModelRegistrationModelID(model.GetModelId()),
		Managed:          managed && normalizeRuntimeMode(mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
	}
	if !registration.Managed {
		return registration
	}

	backend, err := managedLlamaBackendForCapabilities(defaultCapabilitiesForRegistration(model.GetCapabilities(), nil))
	if err != nil {
		registration.Problem = err.Error()
		return registration
	}
	registration.Backend = backend

	if strings.EqualFold(backend, "stablediffusion-ggml") {
		registration.DynamicProfile = true
		if registration.Managed && !imageBackendUp {
			registration.Problem = "managed diffusers backend unavailable"
			return registration
		}
		if len(structToMap(model.GetEngineConfig())) == 0 {
			registration.Problem = "local media model missing engine_config"
			return registration
		}
		relativeModelPath, resolveErr := resolveManagedEntryRelativePath(modelsPath, model.GetModelId(), model.GetSource().GetRepo(), model.GetEntry())
		if resolveErr == nil {
			registration.RelativeModelPath = relativeModelPath
		}
		return registration
	}

	relativeModelPath, resolveErr := resolveManagedEntryRelativePath(modelsPath, model.GetModelId(), model.GetSource().GetRepo(), model.GetEntry())
	if resolveErr != nil {
		registration.Problem = resolveErr.Error()
		return registration
	}
	registration.RelativeModelPath = relativeModelPath
	return registration
}

func resolveManifestEntryPath(modelDir string, modelSlug string, entry string) (string, string, error) {
	trimmedEntry := strings.TrimSpace(entry)
	if trimmedEntry == "" {
		return "", "", fmt.Errorf("entry is required")
	}
	if filepath.IsAbs(trimmedEntry) {
		return "", "", fmt.Errorf("entry must be relative")
	}

	cleanEntry := filepath.Clean(trimmedEntry)
	if cleanEntry == "." || cleanEntry == string(filepath.Separator) {
		return "", "", fmt.Errorf("entry is required")
	}
	if strings.HasPrefix(cleanEntry, ".."+string(filepath.Separator)) || cleanEntry == ".." {
		return "", "", fmt.Errorf("entry must stay inside model directory")
	}

	absEntryPath := filepath.Join(modelDir, cleanEntry)
	relativeModelPath := filepath.ToSlash(filepath.Join(modelSlug, cleanEntry))
	return absEntryPath, relativeModelPath, nil
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
		case "image":
			backends["stablediffusion-ggml"] = true
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
	case strings.HasPrefix(lower, "media.diffusers/"):
		raw = strings.TrimSpace(raw[len("media.diffusers/"):])
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

func (s *Service) managedLlamaRegistrationForModel(model *runtimev1.LocalModelRecord) managedLlamaRegistration {
	if model == nil {
		return managedLlamaRegistration{}
	}

	localModelID := strings.TrimSpace(model.GetLocalModelId())
	s.mu.RLock()
	registration, ok := s.managedLlamaRegistrations[localModelID]
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.managedLlamaEnabled
	imageBackendUp := s.managedMediaBackendConfigured && s.managedMediaBackendHealthy
	mode := s.modelRuntimeModes[localModelID]
	s.mu.RUnlock()
	if ok && !registration.DynamicProfile {
		return registration
	}
	return inspectManagedLlamaModelRegistration(model, mode, modelsPath, managed, imageBackendUp)
}

func modelProbeSucceeded(model *runtimev1.LocalModelRecord, probe endpointProbeResult, registration managedLlamaRegistration) bool {
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeSucceeded(probe, registration)
	case "media", "media.diffusers":
		return mediaModelProbeSucceeded(model, probe)
	}
	return probe.healthy
}

func modelProbeFailureDetail(model *runtimev1.LocalModelRecord, probe endpointProbeResult, registration managedLlamaRegistration) string {
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeFailureDetail(probe, registration)
	case "media", "media.diffusers":
		return mediaModelProbeFailureDetail(model, probe)
	}
	return defaultString(probe.detail, "model probe failed")
}

func mediaModelProbeSucceeded(model *runtimev1.LocalModelRecord, probe endpointProbeResult) bool {
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(model.GetModelId())
	if expectedModelName == "" || len(probe.models) == 0 {
		return false
	}
	_, ok := findComparableProbeModel(probe.models, expectedModelName)
	return ok
}

func mediaModelProbeFailureDetail(model *runtimev1.LocalModelRecord, probe endpointProbeResult) string {
	if !probe.healthy {
		return defaultString(probe.detail, "media model probe failed")
	}
	expectedModelName := strings.TrimSpace(model.GetModelId())
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
	comparable = strings.TrimPrefix(comparable, "media.diffusers/")
	return comparable
}

func probeModelIDBase(value string) string {
	trimmed := normalizeComparableModelID(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.TrimSpace(trimmed[:idx])
	}
	return trimmed
}
