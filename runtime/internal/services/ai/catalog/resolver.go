package catalog

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

type indexedSnapshot struct {
	catalogVersion   string
	models           map[string]map[string]ModelEntry
	voicesBySet      map[string][]VoiceEntry
	workflowModels   map[string]map[string]VoiceWorkflowModel
	workflowBindings map[string]map[string]ModelWorkflowBinding
}

type Resolver struct {
	mu sync.RWMutex

	logger *slog.Logger

	snapshot          *indexedSnapshot
	source            CatalogSource
	builtInProviders  map[string]ProviderDocument
	customProviders   map[string]ProviderDocument
	effective         map[string]ProviderDocument
	sourcesByProvider map[string]ProviderSource

	customDir string
}

func NewResolver(cfg ResolverConfig) (*Resolver, error) {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	builtInProviders, err := loadBuiltInProviderDocuments()
	if err != nil {
		return nil, err
	}

	resolver := &Resolver{
		logger:            logger,
		builtInProviders:  builtInProviders,
		customProviders:   map[string]ProviderDocument{},
		effective:         map[string]ProviderDocument{},
		sourcesByProvider: map[string]ProviderSource{},
		customDir:         strings.TrimSpace(cfg.CustomDir),
	}

	if resolver.customDir != "" {
		customProviders, loadErr := loadProviderDocumentsFromDir(resolver.customDir)
		if loadErr != nil {
			resolver.logger.Warn("catalog custom dir ignored", "dir", resolver.customDir, "error", loadErr)
		} else {
			resolver.customProviders = customProviders
		}
	}

	if err := resolver.recomputeSnapshotLocked(); err != nil {
		return nil, err
	}

	return resolver, nil
}

func (r *Resolver) ResolveVoices(providerType string, modelID string) (ResolveVoicesResult, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	r.mu.RLock()
	snapshot := r.snapshot
	source := r.source
	r.mu.RUnlock()
	if snapshot == nil {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	modelEntry, ok := resolveModelEntry(snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	voiceSetKey := provider + ":" + normalizeID(modelEntry.VoiceSetID)
	voiceEntries := snapshot.voicesBySet[voiceSetKey]
	if len(voiceEntries) == 0 {
		return ResolveVoicesResult{}, ErrVoiceSetEmpty
	}

	voices := make([]VoiceDescriptor, 0, len(voiceEntries))
	for _, entry := range voiceEntries {
		if !voiceMatchesModel(entry, modelEntry.ModelID) {
			continue
		}
		supportedLangs := normalizeStringSlice(entry.Langs)
		lang := ""
		if len(supportedLangs) > 0 {
			lang = supportedLangs[0]
		}
		voices = append(voices, VoiceDescriptor{
			VoiceID:        strings.TrimSpace(entry.VoiceID),
			Name:           strings.TrimSpace(entry.Name),
			Lang:           lang,
			SupportedLangs: supportedLangs,
		})
	}
	if len(voices) == 0 {
		return ResolveVoicesResult{}, ErrVoiceSetEmpty
	}

	return ResolveVoicesResult{
		Provider:       provider,
		ModelID:        strings.TrimSpace(modelEntry.ModelID),
		CatalogVersion: snapshot.catalogVersion,
		Source:         source,
		Voices:         voices,
	}, nil
}

// ResolveModelEntry resolves a model entry from the active catalog snapshot.
func (r *Resolver) ResolveModelEntry(providerType string, modelID string) (ModelEntry, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return ModelEntry{}, ErrModelNotFound
	}

	r.mu.RLock()
	snapshot := r.snapshot
	r.mu.RUnlock()
	if snapshot == nil {
		return ModelEntry{}, ErrModelNotFound
	}
	modelEntry, ok := resolveModelEntry(snapshot, provider, normalizedModel)
	if !ok {
		return ModelEntry{}, ErrModelNotFound
	}
	return modelEntry, nil
}

// ListModelsForProvider returns the active catalog models for one canonical provider.
func (r *Resolver) ListModelsForProvider(providerType string) ([]ModelEntry, CatalogSource, error) {
	provider := normalizeProvider(providerType)
	if provider == "" {
		return nil, SourceBuiltinSnapshot, ErrProviderUnsupported
	}

	r.mu.RLock()
	doc, ok := r.effective[provider]
	source := r.source
	r.mu.RUnlock()
	if !ok {
		return nil, source, ErrProviderUnsupported
	}

	models := append([]ModelEntry(nil), doc.Models...)
	sort.Slice(models, func(i, j int) bool {
		if models[i].ModelID == models[j].ModelID {
			return models[i].UpdatedAt > models[j].UpdatedAt
		}
		return models[i].ModelID < models[j].ModelID
	})
	return models, source, nil
}

// ResolveVoiceWorkflow resolves the workflow model bound to a provider/model/workflow_type tuple.
func (r *Resolver) ResolveVoiceWorkflow(providerType string, modelID string, workflowType string) (ResolveVoiceWorkflowResult, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return ResolveVoiceWorkflowResult{}, ErrModelNotFound
	}
	normalizedWorkflowType := normalizeWorkflowType(workflowType)
	if normalizedWorkflowType == "" {
		return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
	}

	r.mu.RLock()
	snapshot := r.snapshot
	source := r.source
	r.mu.RUnlock()
	if snapshot == nil {
		return ResolveVoiceWorkflowResult{}, ErrModelNotFound
	}

	modelEntry, ok := resolveModelEntry(snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoiceWorkflowResult{}, ErrModelNotFound
	}
	binding, ok := resolveModelWorkflowBinding(snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
	}
	if !bindingSupportsWorkflowType(binding, normalizedWorkflowType) {
		return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
	}
	for _, workflowModelRef := range binding.WorkflowModelRefs {
		workflowModel, workflowModelOK := resolveWorkflowModel(snapshot, provider, workflowModelRef)
		if !workflowModelOK {
			continue
		}
		if normalizeWorkflowType(workflowModel.WorkflowType) != normalizedWorkflowType {
			continue
		}
		return ResolveVoiceWorkflowResult{
			Provider:          provider,
			ModelID:           strings.TrimSpace(modelEntry.ModelID),
			WorkflowType:      normalizedWorkflowType,
			WorkflowModelID:   strings.TrimSpace(workflowModel.WorkflowModelID),
			OutputPersistence: strings.TrimSpace(workflowModel.OutputPersistence),
			CatalogVersion:    snapshot.catalogVersion,
			Source:            source,
		}, nil
	}
	return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
}

// SupportsScenario reports whether a provider/model pair declares the capability
// needed by scenarioType in catalog metadata.
func (r *Resolver) SupportsScenario(providerType string, modelID string, scenarioType runtimev1.ScenarioType) (bool, error) {
	model, err := r.ResolveModelEntry(providerType, modelID)
	if err != nil {
		return false, err
	}
	capabilities := make(map[string]struct{}, len(model.Capabilities))
	for _, capability := range model.Capabilities {
		normalized := aicapabilities.NormalizeCatalogCapability(capability)
		if normalized == "" {
			continue
		}
		capabilities[normalized] = struct{}{}
	}
	hasAny := func(values ...string) bool {
		for _, value := range values {
			if _, ok := capabilities[value]; ok {
				return true
			}
		}
		return false
	}

	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return hasAny(aicapabilities.TextGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		return hasAny(aicapabilities.TextEmbed), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		return hasAny(aicapabilities.ImageGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		return hasAny(aicapabilities.VideoGenerate), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return hasAny(aicapabilities.AudioSynthesize), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		return hasAny(aicapabilities.AudioTranscribe), nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		_, workflowErr := r.ResolveVoiceWorkflow(providerType, modelID, "tts_v2v")
		if workflowErr == nil {
			return true, nil
		}
		if workflowErr == ErrVoiceWorkflowUnsupported {
			return false, nil
		}
		return false, workflowErr
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		_, workflowErr := r.ResolveVoiceWorkflow(providerType, modelID, "tts_t2v")
		if workflowErr == nil {
			return true, nil
		}
		if workflowErr == ErrVoiceWorkflowUnsupported {
			return false, nil
		}
		return false, workflowErr
	default:
		return false, nil
	}
}

func resolveModelEntry(snapshot *indexedSnapshot, provider string, normalizedModel string) (ModelEntry, bool) {
	providerModels := snapshot.models[provider]
	if len(providerModels) == 0 {
		return ModelEntry{}, false
	}
	modelEntry, ok := providerModels[normalizedModel]
	if ok {
		return modelEntry, true
	}
	base := modelIDBase(normalizedModel)
	modelEntry, ok = providerModels[base]
	return modelEntry, ok
}

func resolveModelWorkflowBinding(snapshot *indexedSnapshot, provider string, normalizedModel string) (ModelWorkflowBinding, bool) {
	providerBindings := snapshot.workflowBindings[provider]
	if len(providerBindings) == 0 {
		return ModelWorkflowBinding{}, false
	}
	binding, ok := providerBindings[normalizedModel]
	if ok {
		return binding, true
	}
	base := modelIDBase(normalizedModel)
	binding, ok = providerBindings[base]
	return binding, ok
}

func resolveWorkflowModel(snapshot *indexedSnapshot, provider string, workflowModelID string) (VoiceWorkflowModel, bool) {
	providerModels := snapshot.workflowModels[provider]
	if len(providerModels) == 0 {
		return VoiceWorkflowModel{}, false
	}
	normalizedWorkflowModelID := normalizeID(workflowModelID)
	workflowModel, ok := providerModels[normalizedWorkflowModelID]
	return workflowModel, ok
}

func bindingSupportsWorkflowType(binding ModelWorkflowBinding, workflowType string) bool {
	normalizedWorkflowType := normalizeWorkflowType(workflowType)
	if normalizedWorkflowType == "" {
		return false
	}
	for _, item := range binding.WorkflowTypes {
		if normalizeWorkflowType(item) == normalizedWorkflowType {
			return true
		}
	}
	return false
}

func (r *Resolver) SupportsVoice(providerType string, modelID string, voiceID string) (ResolveVoicesResult, bool, error) {
	result, err := r.ResolveVoices(providerType, modelID)
	if err != nil {
		return ResolveVoicesResult{}, false, err
	}
	requested := strings.TrimSpace(voiceID)
	if requested == "" {
		return result, true, nil
	}
	requestedLower := strings.ToLower(requested)
	for _, voice := range result.Voices {
		id := strings.TrimSpace(voice.VoiceID)
		if id == "" {
			continue
		}
		if id == requested || strings.ToLower(id) == requestedLower {
			return result, true, nil
		}
	}
	return result, false, nil
}

func (r *Resolver) ListProviders() []CatalogProviderRecord {
	r.mu.RLock()
	providers := make([]string, 0, len(r.effective))
	for provider := range r.effective {
		providers = append(providers, provider)
	}
	sort.Strings(providers)
	records := make([]CatalogProviderRecord, 0, len(providers))
	for _, provider := range providers {
		doc := r.effective[provider]
		yamlText, err := marshalProviderDocumentYAML(doc)
		if err != nil {
			yamlText = ""
		}
		records = append(records, CatalogProviderRecord{
			Provider:       provider,
			Version:        doc.Version,
			CatalogVersion: strings.TrimSpace(doc.CatalogVersion),
			Source:         r.sourcesByProvider[provider],
			ModelCount:     len(doc.Models),
			VoiceCount:     len(doc.Voices),
			YAML:           yamlText,
		})
	}
	r.mu.RUnlock()
	return records
}

func (r *Resolver) UpsertCustomProvider(provider string, rawYAML []byte) (CatalogProviderRecord, error) {
	if strings.TrimSpace(r.customDir) == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	candidate, err := parseProviderDocumentYAML(rawYAML, provider+providerFileExt)
	if err != nil {
		return CatalogProviderRecord{}, err
	}
	requestedProvider := normalizeProvider(provider)
	if requestedProvider != "" && requestedProvider != candidate.Provider {
		return CatalogProviderRecord{}, fmt.Errorf("provider mismatch: request=%s yaml=%s", requestedProvider, candidate.Provider)
	}
	yamlText, err := marshalProviderDocumentYAML(candidate)
	if err != nil {
		return CatalogProviderRecord{}, err
	}
	candidate.RawYAML = yamlText

	writePath := customProviderFilePath(r.customDir, candidate.Provider)
	if writePath == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	if err := os.MkdirAll(filepath.Dir(writePath), 0o755); err != nil {
		return CatalogProviderRecord{}, err
	}
	if err := os.WriteFile(writePath, []byte(yamlText), 0o600); err != nil {
		return CatalogProviderRecord{}, err
	}

	r.mu.Lock()
	r.customProviders[candidate.Provider] = candidate
	recomputeErr := r.recomputeSnapshotLocked()
	record := r.recordForProviderLocked(candidate.Provider)
	r.mu.Unlock()
	if recomputeErr != nil {
		return CatalogProviderRecord{}, recomputeErr
	}
	return record, nil
}

func (r *Resolver) DeleteCustomProvider(provider string) error {
	if strings.TrimSpace(r.customDir) == "" {
		return ErrCatalogMutationDisabled
	}
	normalized := normalizeProvider(provider)
	if normalized == "" {
		return fmt.Errorf("%w: %s", ErrProviderUnsupported, normalized)
	}
	path := customProviderFilePath(r.customDir, normalized)
	if path != "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}

	r.mu.Lock()
	delete(r.customProviders, normalized)
	err := r.recomputeSnapshotLocked()
	r.mu.Unlock()
	return err
}

func (r *Resolver) recordForProviderLocked(provider string) CatalogProviderRecord {
	doc := r.effective[provider]
	yamlText, err := marshalProviderDocumentYAML(doc)
	if err != nil {
		yamlText = ""
	}
	return CatalogProviderRecord{
		Provider:       provider,
		Version:        doc.Version,
		CatalogVersion: strings.TrimSpace(doc.CatalogVersion),
		Source:         r.sourcesByProvider[provider],
		ModelCount:     len(doc.Models),
		VoiceCount:     len(doc.Voices),
		YAML:           yamlText,
	}
}

func (r *Resolver) recomputeSnapshotLocked() error {
	merged := mergeProviderDocuments(r.builtInProviders, r.customProviders)
	snapshot, err := buildSnapshotFromProviderDocuments(merged)
	if err != nil {
		return err
	}
	indexed, err := buildIndexedSnapshot(snapshot)
	if err != nil {
		return err
	}
	sources := make(map[string]ProviderSource, len(merged))
	for provider := range merged {
		sources[provider] = ProviderSourceBuiltin
	}
	for provider := range r.customProviders {
		sources[provider] = ProviderSourceCustom
	}

	r.snapshot = indexed
	r.effective = merged
	r.sourcesByProvider = sources
	if len(r.customProviders) > 0 {
		r.source = SourceCustomDir
	} else {
		r.source = SourceBuiltinSnapshot
	}
	return nil
}

func buildIndexedSnapshot(snapshot Snapshot) (*indexedSnapshot, error) {
	if err := validateSnapshot(snapshot); err != nil {
		return nil, err
	}
	indexed := &indexedSnapshot{
		catalogVersion:   strings.TrimSpace(snapshot.CatalogVersion),
		models:           make(map[string]map[string]ModelEntry),
		voicesBySet:      make(map[string][]VoiceEntry),
		workflowModels:   make(map[string]map[string]VoiceWorkflowModel),
		workflowBindings: make(map[string]map[string]ModelWorkflowBinding),
	}
	if indexed.catalogVersion == "" {
		indexed.catalogVersion = "unknown"
	}

	for _, model := range snapshot.Models {
		provider := normalizeProvider(model.Provider)
		if provider == "" {
			continue
		}
		if indexed.models[provider] == nil {
			indexed.models[provider] = make(map[string]ModelEntry)
		}
		key := normalizeLookupModelID(model.ModelID, provider)
		indexed.models[provider][key] = model
		indexed.models[provider][modelIDBase(key)] = model
	}

	for _, voice := range snapshot.Voices {
		provider := normalizeProvider(voice.Provider)
		voiceSetID := normalizeID(voice.VoiceSetID)
		if provider == "" || voiceSetID == "" {
			continue
		}
		setKey := provider + ":" + voiceSetID
		indexed.voicesBySet[setKey] = append(indexed.voicesBySet[setKey], voice)
	}

	for _, workflowModel := range snapshot.VoiceWorkflowModels {
		provider := inferProviderFromWorkflowModelID(workflowModel.WorkflowModelID, workflowModel.TargetModelRefs, map[string]ModelEntry{})
		if provider == "" {
			for _, targetModelRaw := range workflowModel.TargetModelRefs {
				targetModelID := normalizeLookupModelID(targetModelRaw, "")
				for candidateProvider, modelMap := range indexed.models {
					if _, ok := modelMap[targetModelID]; ok {
						provider = candidateProvider
						break
					}
					if _, ok := modelMap[modelIDBase(targetModelID)]; ok {
						provider = candidateProvider
						break
					}
				}
				if provider != "" {
					break
				}
			}
		}
		provider = normalizeProvider(provider)
		if provider == "" {
			continue
		}
		if indexed.workflowModels[provider] == nil {
			indexed.workflowModels[provider] = make(map[string]VoiceWorkflowModel)
		}
		indexed.workflowModels[provider][normalizeID(workflowModel.WorkflowModelID)] = workflowModel
	}

	for _, binding := range snapshot.ModelWorkflowBindings {
		modelID := normalizeLookupModelID(binding.ModelID, "")
		if modelID == "" {
			continue
		}
		for provider, modelMap := range indexed.models {
			if _, ok := modelMap[modelID]; !ok {
				if _, baseOK := modelMap[modelIDBase(modelID)]; !baseOK {
					continue
				}
			}
			if indexed.workflowBindings[provider] == nil {
				indexed.workflowBindings[provider] = make(map[string]ModelWorkflowBinding)
			}
			indexed.workflowBindings[provider][modelID] = binding
			indexed.workflowBindings[provider][modelIDBase(modelID)] = binding
			break
		}
	}
	return indexed, nil
}

func normalizeLookupModelID(raw string, provider string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	value = strings.TrimPrefix(value, "cloud/")
	value = strings.TrimPrefix(value, "token/")
	value = strings.TrimPrefix(value, "local/")
	provider = normalizeProvider(provider)
	if provider != "" {
		prefix := provider + "/"
		value = strings.TrimPrefix(value, prefix)
	}
	return strings.TrimSpace(value)
}

func modelIDBase(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return ""
	}
	segments := strings.Split(normalized, "/")
	return strings.TrimSpace(segments[len(segments)-1])
}

func inferProviderFromModel(modelID string) string {
	normalized := strings.TrimSpace(strings.ToLower(modelID))
	if idx := strings.Index(normalized, "/"); idx > 0 {
		prefix := strings.TrimSpace(normalized[:idx])
		if providerregistry.Contains(prefix) {
			return prefix
		}
	}
	switch {
	case strings.HasPrefix(normalized, "local/"):
		return "local"
	case normalized == "qwen3-tts-local", normalized == "qwen3-tts", strings.Contains(normalized, "qwen/qwen3-tts-8b"):
		return "local"
	case strings.Contains(normalized, "qwen3-tts"), strings.Contains(normalized, "qwen-tts"):
		return "dashscope"
	case strings.Contains(normalized, "gpt-audio"), strings.HasPrefix(normalized, "tts-1"):
		return "openai"
	case strings.Contains(normalized, "doubao-tts"), strings.Contains(normalized, "bv001_streaming"), strings.Contains(normalized, "bv002_streaming"):
		return "volcengine"
	case strings.HasPrefix(normalized, "eleven_"), strings.HasPrefix(normalized, "eleven-"):
		return "elevenlabs"
	default:
		return ""
	}
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func voiceMatchesModel(entry VoiceEntry, modelID string) bool {
	target := normalizeLookupModelID(modelID, "")
	if target == "" {
		return true
	}
	if len(entry.ModelIDs) == 0 {
		return true
	}
	targetBase := modelIDBase(target)
	for _, model := range entry.ModelIDs {
		candidate := normalizeLookupModelID(model, "")
		if candidate == "" {
			continue
		}
		if candidate == target || modelIDBase(candidate) == targetBase {
			return true
		}
	}
	return false
}
