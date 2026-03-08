package localservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const generatedLocalAIModelsConfigRelPath = ".nimi/runtime/localai-models.yaml"

const (
	localAIImageBackendServiceID    = "svc_localai_image_backend"
	localAIImageBackendServiceTitle = "LocalAI Image Backend"
)

type localAIRegistration struct {
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

type localAIManifestSource struct {
	Repo     string `json:"repo"`
	Revision string `json:"revision"`
}

type localAIManifest struct {
	ModelID      string                `json:"model_id"`
	Capabilities []string              `json:"capabilities"`
	Engine       string                `json:"engine"`
	Entry        string                `json:"entry"`
	Files        []string              `json:"files"`
	License      string                `json:"license"`
	Source       localAIManifestSource `json:"source"`
	Hashes       map[string]string     `json:"hashes"`
}

type localAIConfigEntry struct {
	Name       string                  `yaml:"name"`
	Backend    string                  `yaml:"backend"`
	Parameters localAIConfigParameters `yaml:"parameters"`
}

type localAIConfigParameters struct {
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

func resolveGeneratedLocalAIModelsConfigPath(configuredPath string) string {
	if value := strings.TrimSpace(configuredPath); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ""
	}
	return filepath.Join(home, generatedLocalAIModelsConfigRelPath)
}

// SetLocalAIRegistrationConfig updates the service-local LocalAI registration
// settings used for managed LocalAI config generation.
func (s *Service) SetLocalAIRegistrationConfig(modelsPath string, modelsConfigPath string, managed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.localModelsPath = resolveLocalModelsPath(modelsPath)
	s.localAIModelsConfigPath = resolveGeneratedLocalAIModelsConfigPath(modelsConfigPath)
	s.localAIManaged = managed
}

// SetLocalAIManagedEndpoint records the managed LocalAI endpoint exposed by the
// daemon and rewrites default LocalAI model endpoints to that managed endpoint.
func (s *Service) SetLocalAIManagedEndpoint(endpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.localAIManagedEndpoint = strings.TrimSpace(endpoint)
	if s.localAIManagedEndpoint == "" {
		return
	}

	updatedAt := nowISO()
	changed := false
	for localModelID, model := range s.models {
		if model == nil || model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
			continue
		}
		if !shouldUseManagedLocalAIEndpoint(model.GetEndpoint()) {
			continue
		}
		if strings.TrimSpace(model.GetEndpoint()) == s.localAIManagedEndpoint {
			continue
		}
		cloned := cloneLocalModel(model)
		cloned.Endpoint = s.localAIManagedEndpoint
		cloned.UpdatedAt = updatedAt
		s.models[localModelID] = cloned
		changed = true
	}
	if changed {
		s.persistStateLocked()
	}
}

// SetLocalAIImageBackendConfig records whether the managed LocalAI image
// backend is configured for daemon-supervised LocalAI image workflows.
func (s *Service) SetLocalAIImageBackendConfig(enabled bool, address string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.localAIImageBackendConfigured = enabled
	s.localAIImageBackendUp = false
	s.localAIImageBackendAddr = strings.TrimSpace(address)
	now := nowISO()
	if enabled {
		if strings.TrimSpace(s.localAIImageBackendInstalledAt) == "" {
			s.localAIImageBackendInstalledAt = now
		}
		s.localAIImageBackendUpdatedAt = now
		s.localAIImageBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_INSTALLED
		s.localAIImageBackendDetail = "daemon-managed image backend configured"
		return
	}
	s.localAIImageBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED
	s.localAIImageBackendDetail = "daemon-managed image backend disabled"
	s.localAIImageBackendInstalledAt = ""
	s.localAIImageBackendUpdatedAt = now
}

// SetLocalAIImageBackendHealth records the current managed LocalAI image
// backend health reported by the engine supervisor.
func (s *Service) SetLocalAIImageBackendHealth(healthy bool, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.localAIImageBackendConfigured {
		return
	}
	s.localAIImageBackendUp = healthy
	s.localAIImageBackendUpdatedAt = nowISO()
	trimmed := strings.TrimSpace(detail)
	if healthy {
		s.localAIImageBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE
		s.localAIImageBackendDetail = defaultString(trimmed, "daemon-managed image backend active")
		return
	}
	s.localAIImageBackendStatus = runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY
	s.localAIImageBackendDetail = defaultString(trimmed, "daemon-managed image backend unhealthy")
}

// SyncManagedLocalAIAssets rebuilds the runtime-managed LocalAI config from the
// current local model state and restarts the managed engine when the generated
// config changes while LocalAI is already running.
func (s *Service) SyncManagedLocalAIAssets(ctx context.Context) error {
	registrations, rendered, err := s.buildLocalAIRegistrations()
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.localAIRegistrations = registrations
	managed := s.localAIManaged
	configPath := strings.TrimSpace(s.localAIModelsConfigPath)
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

	changed, err := writeGeneratedLocalAIConfigIfChanged(configPath, rendered)
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
	info, err := mgr.EngineStatus("localai")
	if err != nil {
		return nil
	}
	if err := mgr.StopEngine("localai"); err != nil {
		return fmt.Errorf("restart managed localai stop: %w", err)
	}
	if err := mgr.StartEngine(ctx, "localai", info.Port, info.Version); err != nil {
		return fmt.Errorf("restart managed localai start: %w", err)
	}
	return nil
}

func (s *Service) buildLocalAIRegistrations() (map[string]localAIRegistration, []byte, error) {
	s.mu.RLock()
	models := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		models = append(models, cloneLocalModel(model))
	}
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.localAIManaged
	imageBackendUp := s.localAIImageBackendConfigured && s.localAIImageBackendUp
	s.mu.RUnlock()

	sort.Slice(models, func(i, j int) bool {
		return models[i].GetLocalModelId() < models[j].GetLocalModelId()
	})

	registrations := make(map[string]localAIRegistration, len(models))
	candidateIndexes := make(map[string][]string)
	for _, model := range models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
			continue
		}

		registration := inspectLocalAIModelRegistration(model, modelsPath, managed, imageBackendUp)
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
			registration.Problem = fmt.Sprintf("localai registration name conflict for %q", modelName)
			registrations[localModelID] = registration
		}
	}

	entries := make([]localAIConfigEntry, 0, len(registrations))
	for _, registration := range registrations {
		if !registration.Managed || strings.TrimSpace(registration.Problem) != "" {
			continue
		}
		if registration.DynamicProfile {
			continue
		}
		entries = append(entries, localAIConfigEntry{
			Name:    registration.ExposedModelName,
			Backend: registration.Backend,
			Parameters: localAIConfigParameters{
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
		return nil, nil, fmt.Errorf("marshal localai models config: %w", err)
	}
	return registrations, rendered, nil
}

func inspectLocalAIModelRegistration(model *runtimev1.LocalModelRecord, modelsPath string, managed bool, imageBackendUp bool) localAIRegistration {
	registration := localAIRegistration{
		LocalModelID:     strings.TrimSpace(model.GetLocalModelId()),
		ModelID:          strings.TrimSpace(model.GetModelId()),
		ExposedModelName: normalizeLocalAIRegistrationModelID(model.GetModelId()),
		Managed:          managed && localAIModelUsesManagedEngine(model),
	}
	if !registration.Managed {
		return registration
	}

	backend, err := localAIBackendForCapabilities(defaultCapabilitiesForRegistration(model.GetCapabilities(), nil))
	if err != nil {
		registration.Problem = err.Error()
		return registration
	}
	registration.Backend = backend

	if strings.EqualFold(backend, "stablediffusion-ggml") {
		registration.DynamicProfile = true
		if registration.Managed && !imageBackendUp {
			registration.Problem = "managed localai image backend unavailable"
			return registration
		}
		if len(structToMap(model.GetEngineConfig())) == 0 {
			registration.Problem = "localai image model missing engine_config"
			return registration
		}
		relativeModelPath, resolveErr := resolveLocalAIEntryRelativePath(modelsPath, model.GetModelId(), model.GetSource().GetRepo(), model.GetEntry())
		if resolveErr == nil {
			registration.RelativeModelPath = relativeModelPath
		}
		return registration
	}

	relativeModelPath, resolveErr := resolveLocalAIEntryRelativePath(modelsPath, model.GetModelId(), model.GetSource().GetRepo(), model.GetEntry())
	if resolveErr != nil {
		registration.Problem = resolveErr.Error()
		return registration
	}
	registration.RelativeModelPath = relativeModelPath
	return registration
}

func readLocalAIManifest(manifestPath string) (*localAIManifest, error) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("missing manifest %s", manifestPath)
		}
		return nil, fmt.Errorf("read manifest %s: %w", manifestPath, err)
	}
	var manifest localAIManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest %s: %w", manifestPath, err)
	}
	return &manifest, nil
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

func localAIBackendForCapabilities(capabilities []string) (string, error) {
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
		return "", fmt.Errorf("localai backend conflict for capabilities=%s", strings.Join(keys, ","))
	}
	for key := range backends {
		return key, nil
	}
	return "llama-cpp", nil
}

func localAIModelUsesManagedEngine(model *runtimev1.LocalModelRecord) bool {
	if model == nil {
		return false
	}
	_, shouldManage, err := parseManagedEndpointPort("localai", modelProbeEndpoint(model))
	return err == nil && shouldManage
}

func normalizeLocalAIRegistrationModelID(modelID string) string {
	raw := strings.TrimSpace(modelID)
	lower := strings.ToLower(raw)
	switch {
	case strings.HasPrefix(lower, "localai/"):
		raw = strings.TrimSpace(raw[len("localai/"):])
	case strings.HasPrefix(lower, "nexa/"):
		raw = strings.TrimSpace(raw[len("nexa/"):])
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

func writeGeneratedLocalAIConfigIfChanged(path string, rendered []byte) (bool, error) {
	if len(bytes.TrimSpace(rendered)) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return false, fmt.Errorf("remove localai config %s: %w", path, err)
		}
		return true, nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, fmt.Errorf("create localai config directory: %w", err)
	}

	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, rendered) {
		return false, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("read localai config %s: %w", path, err)
	}
	if err := os.WriteFile(path, rendered, 0o600); err != nil {
		return false, fmt.Errorf("write localai config %s: %w", path, err)
	}
	return true, nil
}

func (s *Service) localAIRegistrationForModel(model *runtimev1.LocalModelRecord) localAIRegistration {
	if model == nil {
		return localAIRegistration{}
	}

	localModelID := strings.TrimSpace(model.GetLocalModelId())
	s.mu.RLock()
	registration, ok := s.localAIRegistrations[localModelID]
	modelsPath := resolveLocalModelsPath(s.localModelsPath)
	managed := s.localAIManaged
	imageBackendUp := s.localAIImageBackendConfigured && s.localAIImageBackendUp
	s.mu.RUnlock()
	if ok && !registration.DynamicProfile {
		return registration
	}
	return inspectLocalAIModelRegistration(model, modelsPath, managed, imageBackendUp)
}

func modelProbeSucceeded(model *runtimev1.LocalModelRecord, probe endpointProbeResult, registration localAIRegistration) bool {
	if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
		return localAIModelProbeSucceeded(probe, registration)
	}
	return probe.healthy
}

func modelProbeFailureDetail(model *runtimev1.LocalModelRecord, probe endpointProbeResult, registration localAIRegistration) string {
	if strings.EqualFold(strings.TrimSpace(model.GetEngine()), "localai") {
		return localAIModelProbeFailureDetail(probe, registration)
	}
	return defaultString(probe.detail, "model probe failed")
}

func localAIModelProbeSucceeded(probe endpointProbeResult, registration localAIRegistration) bool {
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

func localAIModelProbeFailureDetail(probe endpointProbeResult, registration localAIRegistration) string {
	if detail := strings.TrimSpace(registration.Problem); detail != "" {
		return detail
	}
	if registration.DynamicProfile {
		if probe.responded {
			return "localai image workflow ready"
		}
		return defaultString(probe.detail, "localai image workflow unavailable")
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
