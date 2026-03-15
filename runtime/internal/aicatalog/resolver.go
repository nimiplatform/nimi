package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

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

type providerState struct {
	record           CatalogProviderRecord
	document         ProviderDocument
	modelSources     map[string]ModelSource
	userScopedModels map[string]bool
}

type catalogState struct {
	snapshot  *indexedSnapshot
	providers map[string]providerState
	source    CatalogSource
}

type Resolver struct {
	mu sync.RWMutex

	logger *slog.Logger

	builtInProviders map[string]ProviderDocument
	sharedOverlays   map[string]overlayDocument
	subjectOverlays  map[string]map[string]overlayDocument
	subjectLoaded    map[string]bool

	globalState   *catalogState
	subjectStates map[string]*catalogState
	customDir     string
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
		logger:           logger,
		builtInProviders: builtInProviders,
		sharedOverlays:   map[string]overlayDocument{},
		subjectOverlays:  map[string]map[string]overlayDocument{},
		subjectLoaded:    map[string]bool{},
		subjectStates:    map[string]*catalogState{},
		customDir:        strings.TrimSpace(cfg.CustomDir),
	}

	if resolver.customDir != "" {
		sharedOverlays, loadErr := loadOverlayProviderDocumentsFromDir(resolver.customDir)
		if loadErr != nil {
			resolver.logger.Warn("catalog custom dir ignored", "dir", resolver.customDir, "error", loadErr)
		} else {
			resolver.sharedOverlays = sharedOverlays
		}
	}

	if err := resolver.recomputeGlobalStateLocked(); err != nil {
		return nil, err
	}

	return resolver, nil
}

func (r *Resolver) ResolveVoices(providerType string, modelID string) (ResolveVoicesResult, error) {
	return r.ResolveVoicesForSubject("", providerType, modelID)
}

func (r *Resolver) ResolveVoicesForSubject(subjectUserID string, providerType string, modelID string) (ResolveVoicesResult, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	state, err := r.stateForSubject(subjectUserID)
	if err != nil {
		return ResolveVoicesResult{}, err
	}
	if state == nil || state.snapshot == nil {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	modelEntry, ok := resolveModelEntry(state.snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	voiceSetKey := provider + ":" + normalizeID(modelEntry.VoiceSetID)
	voiceEntries := state.snapshot.voicesBySet[voiceSetKey]
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
		CatalogVersion: state.snapshot.catalogVersion,
		Source:         state.source,
		Voices:         voices,
	}, nil
}

func (r *Resolver) ResolveModelEntry(providerType string, modelID string) (ModelEntry, error) {
	return r.ResolveModelEntryForSubject("", providerType, modelID)
}

func (r *Resolver) ResolveModelEntryForSubject(subjectUserID string, providerType string, modelID string) (ModelEntry, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return ModelEntry{}, ErrModelNotFound
	}

	state, err := r.stateForSubject(subjectUserID)
	if err != nil {
		return ModelEntry{}, err
	}
	if state == nil || state.snapshot == nil {
		return ModelEntry{}, ErrModelNotFound
	}
	modelEntry, ok := resolveModelEntry(state.snapshot, provider, normalizedModel)
	if !ok {
		return ModelEntry{}, ErrModelNotFound
	}
	return modelEntry, nil
}

func (r *Resolver) ListModelsForProvider(providerType string) ([]ModelEntry, CatalogSource, error) {
	models, source, err := r.ListModelsForProviderForSubject("", providerType)
	if err != nil {
		return nil, source, err
	}
	out := make([]ModelEntry, 0, len(models))
	for _, model := range models {
		out = append(out, model.Model)
	}
	return out, source, nil
}

func (r *Resolver) ListModelsForProviderForSubject(subjectUserID string, providerType string) ([]CatalogModelRecord, CatalogSource, error) {
	provider := normalizeProvider(providerType)
	if provider == "" {
		return nil, SourceBuiltinSnapshot, ErrProviderUnsupported
	}

	state, err := r.stateForSubject(subjectUserID)
	if err != nil {
		return nil, SourceBuiltinSnapshot, err
	}
	if state == nil {
		return nil, SourceBuiltinSnapshot, ErrProviderUnsupported
	}

	providerState, ok := state.providers[provider]
	if !ok {
		return nil, state.source, ErrProviderUnsupported
	}

	models := make([]CatalogModelRecord, 0, len(providerState.document.Models))
	for _, model := range providerState.document.Models {
		key := normalizeID(model.ModelID)
		source := providerState.modelSources[key]
		if source == "" {
			source = ModelSourceBuiltin
		}
		models = append(models, CatalogModelRecord{
			Model:      model,
			Source:     source,
			UserScoped: providerState.userScopedModels[key],
			Warnings:   warningsForModelSource(source, providerState.userScopedModels[key]),
		})
	}
	sort.Slice(models, func(i, j int) bool {
		leftID := strings.ToLower(strings.TrimSpace(models[i].Model.ModelID))
		rightID := strings.ToLower(strings.TrimSpace(models[j].Model.ModelID))
		if leftID == rightID {
			return strings.TrimSpace(models[i].Model.UpdatedAt) > strings.TrimSpace(models[j].Model.UpdatedAt)
		}
		return leftID < rightID
	})
	return models, state.source, nil
}

func (r *Resolver) GetModelDetailForSubject(subjectUserID string, providerType string, modelID string) (CatalogModelDetailRecord, CatalogProviderRecord, CatalogSource, error) {
	provider := normalizeProvider(providerType)
	normalizedModel := normalizeLookupModelID(modelID, provider)
	if provider == "" {
		provider = inferProviderFromModel(normalizedModel)
	}
	if provider == "" || normalizedModel == "" {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, SourceBuiltinSnapshot, ErrModelNotFound
	}

	state, err := r.stateForSubject(subjectUserID)
	if err != nil {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, SourceBuiltinSnapshot, err
	}
	return r.getModelDetailFromState(state, provider, modelID)
}

func (r *Resolver) ResolveVoiceWorkflow(providerType string, modelID string, workflowType string) (ResolveVoiceWorkflowResult, error) {
	return r.ResolveVoiceWorkflowForSubject("", providerType, modelID, workflowType)
}

func (r *Resolver) ResolveVoiceWorkflowForSubject(subjectUserID string, providerType string, modelID string, workflowType string) (ResolveVoiceWorkflowResult, error) {
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

	state, err := r.stateForSubject(subjectUserID)
	if err != nil {
		return ResolveVoiceWorkflowResult{}, err
	}
	if state == nil || state.snapshot == nil {
		return ResolveVoiceWorkflowResult{}, ErrModelNotFound
	}

	modelEntry, ok := resolveModelEntry(state.snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoiceWorkflowResult{}, ErrModelNotFound
	}
	binding, ok := resolveModelWorkflowBinding(state.snapshot, provider, normalizedModel)
	if !ok {
		return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
	}
	if !bindingSupportsWorkflowType(binding, normalizedWorkflowType) {
		return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
	}
	for _, workflowModelRef := range binding.WorkflowModelRefs {
		workflowModel, workflowModelOK := resolveWorkflowModel(state.snapshot, provider, workflowModelRef)
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
			CatalogVersion:    state.snapshot.catalogVersion,
			Source:            state.source,
		}, nil
	}
	return ResolveVoiceWorkflowResult{}, ErrVoiceWorkflowUnsupported
}

func (r *Resolver) SupportsScenario(providerType string, modelID string, scenarioType runtimev1.ScenarioType) (bool, error) {
	return r.SupportsScenarioForSubject("", providerType, modelID, scenarioType)
}

func (r *Resolver) SupportsScenarioForSubject(subjectUserID string, providerType string, modelID string, scenarioType runtimev1.ScenarioType) (bool, error) {
	model, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
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
		_, workflowErr := r.ResolveVoiceWorkflowForSubject(subjectUserID, providerType, modelID, "tts_v2v")
		if workflowErr == nil {
			return true, nil
		}
		if workflowErr == ErrVoiceWorkflowUnsupported {
			return false, nil
		}
		return false, workflowErr
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		_, workflowErr := r.ResolveVoiceWorkflowForSubject(subjectUserID, providerType, modelID, "tts_t2v")
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

func (r *Resolver) SupportsCapability(providerType string, modelID string, capability string) (bool, error) {
	return r.SupportsCapabilityForSubject("", providerType, modelID, capability)
}

func (r *Resolver) SupportsCapabilityForSubject(subjectUserID string, providerType string, modelID string, capability string) (bool, error) {
	model, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return false, err
	}
	return aicapabilities.HasCatalogCapability(model.Capabilities, capability), nil
}

func (r *Resolver) SupportsVoice(providerType string, modelID string, voiceID string) (ResolveVoicesResult, bool, error) {
	return r.SupportsVoiceForSubject("", providerType, modelID, voiceID)
}

func (r *Resolver) SupportsVoiceForSubject(subjectUserID string, providerType string, modelID string, voiceID string) (ResolveVoicesResult, bool, error) {
	result, err := r.ResolveVoicesForSubject(subjectUserID, providerType, modelID)
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
	return r.ListProvidersForSubject("")
}

func (r *Resolver) ListProvidersForSubject(subjectUserID string) []CatalogProviderRecord {
	state, err := r.stateForSubject(subjectUserID)
	if err != nil || state == nil {
		return nil
	}
	providers := make([]string, 0, len(state.providers))
	for provider := range state.providers {
		providers = append(providers, provider)
	}
	sort.Strings(providers)
	records := make([]CatalogProviderRecord, 0, len(providers))
	for _, provider := range providers {
		records = append(records, state.providers[provider].record)
	}
	return records
}

func (r *Resolver) UpsertCustomProvider(provider string, rawYAML []byte) (CatalogProviderRecord, error) {
	return r.UpsertCustomProviderForSubject("", provider, rawYAML)
}

func (r *Resolver) UpsertCustomProviderForSubject(subjectUserID string, provider string, rawYAML []byte) (CatalogProviderRecord, error) {
	if strings.TrimSpace(r.customDir) == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	candidate, err := parseOverlayProviderDocumentYAML(rawYAML, provider+providerFileExt)
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
	return r.persistSubjectOverlay(subjectUserID, overlayDocument{
		doc:        candidate,
		updatedAt:  time.Now().UTC().Format(time.RFC3339),
		userScoped: strings.TrimSpace(subjectUserID) != "",
	})
}

func (r *Resolver) DeleteCustomProvider(provider string) error {
	return r.DeleteCustomProviderForSubject("", provider)
}

func (r *Resolver) DeleteCustomProviderForSubject(subjectUserID string, provider string) error {
	if strings.TrimSpace(r.customDir) == "" {
		return ErrCatalogMutationDisabled
	}
	normalized := normalizeProvider(provider)
	if normalized == "" {
		return fmt.Errorf("%w: %s", ErrProviderUnsupported, normalized)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if strings.TrimSpace(subjectUserID) == "" {
		delete(r.sharedOverlays, normalized)
		if err := r.recomputeGlobalStateLocked(); err != nil {
			return err
		}
		for subject := range r.subjectOverlays {
			if err := r.recomputeSubjectStateLocked(subject); err != nil {
				return err
			}
		}
		path := customProviderFilePath(r.customDir, normalized)
		if path != "" {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	}

	subjectKey := strings.TrimSpace(subjectUserID)
	if err := r.ensureSubjectLoadedLocked(subjectKey); err != nil {
		return err
	}
	delete(r.subjectOverlays[subjectKey], normalized)
	if err := r.recomputeSubjectStateLocked(subjectKey); err != nil {
		return err
	}
	path := customProviderFilePath(subjectCatalogDir(r.customDir, subjectKey), normalized)
	if path != "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (r *Resolver) UpsertModelOverlayForSubject(
	subjectUserID string,
	provider string,
	model ModelEntry,
	voices []VoiceEntry,
	voiceWorkflowModels []VoiceWorkflowModel,
	modelWorkflowBinding *ModelWorkflowBinding,
) (CatalogModelDetailRecord, CatalogProviderRecord, error) {
	if strings.TrimSpace(subjectUserID) == "" {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	normalizedProvider := normalizeProvider(provider)
	if normalizedProvider == "" || !isSupportedProvider(normalizedProvider) {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, ErrProviderUnsupported
	}
	model.Provider = normalizedProvider
	if normalizeID(model.ModelID) == "" {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, fmt.Errorf("model_id is required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.ensureSubjectLoadedLocked(subjectUserID); err != nil {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, err
	}
	current := cloneProviderDocument(r.subjectOverlayDocumentLocked(subjectUserID, normalizedProvider))
	if current.Provider == "" {
		current = ProviderDocument{
			Version:        1,
			Provider:       normalizedProvider,
			CatalogVersion: "user-overlay",
		}
	}
	current.Provider = normalizedProvider
	current.Version = max(1, current.Version)
	if strings.TrimSpace(current.CatalogVersion) == "" {
		current.CatalogVersion = "user-overlay"
	}

	current.Models = upsertOverlayModels(current.Models, model)
	current.Voices = replaceOverlayVoices(current.Voices, normalizedProvider, model.VoiceSetID, voices)
	current.VoiceWorkflowModels, current.ModelWorkflowBindings = replaceOverlayWorkflowState(
		current.VoiceWorkflowModels,
		current.ModelWorkflowBindings,
		model.ModelID,
		voiceWorkflowModels,
		modelWorkflowBinding,
	)

	current.RawYAML = ""
	yamlText, err := marshalProviderDocumentYAML(current)
	if err != nil {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, err
	}
	current.RawYAML = yamlText

	record, err := r.persistSubjectOverlayLocked(subjectUserID, overlayDocument{
		doc:        current,
		updatedAt:  time.Now().UTC().Format(time.RFC3339),
		userScoped: true,
	})
	if err != nil {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, err
	}

	state := r.subjectStates[strings.TrimSpace(subjectUserID)]
	if state == nil {
		return CatalogModelDetailRecord{}, record, fmt.Errorf("catalog subject state unavailable")
	}
	detail, _, _, detailErr := r.getModelDetailFromState(state, normalizedProvider, model.ModelID)
	if detailErr != nil {
		return CatalogModelDetailRecord{}, record, detailErr
	}
	return detail, record, nil
}

func (r *Resolver) DeleteModelOverlayForSubject(subjectUserID string, provider string, modelID string) (CatalogProviderRecord, error) {
	if strings.TrimSpace(subjectUserID) == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	if strings.TrimSpace(r.customDir) == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	normalizedProvider := normalizeProvider(provider)
	normalizedModelID := normalizeID(modelID)
	if normalizedProvider == "" || normalizedModelID == "" {
		return CatalogProviderRecord{}, ErrProviderUnsupported
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.ensureSubjectLoadedLocked(subjectUserID); err != nil {
		return CatalogProviderRecord{}, err
	}
	current := cloneProviderDocument(r.subjectOverlayDocumentLocked(subjectUserID, normalizedProvider))
	if current.Provider == "" {
		if state := r.subjectStates[strings.TrimSpace(subjectUserID)]; state != nil {
			if providerState, ok := state.providers[normalizedProvider]; ok {
				return providerState.record, nil
			}
		}
		if r.globalState != nil {
			if providerState, ok := r.globalState.providers[normalizedProvider]; ok {
				return providerState.record, nil
			}
		}
		return CatalogProviderRecord{}, nil
	}

	var removedModel *ModelEntry
	filteredModels := make([]ModelEntry, 0, len(current.Models))
	for _, item := range current.Models {
		if normalizeID(item.ModelID) == normalizedModelID {
			copyModel := item
			removedModel = &copyModel
			continue
		}
		filteredModels = append(filteredModels, item)
	}
	current.Models = filteredModels
	current.VoiceWorkflowModels, current.ModelWorkflowBindings = removeOverlayWorkflowState(
		current.VoiceWorkflowModels,
		current.ModelWorkflowBindings,
		modelID,
	)
	if removedModel != nil {
		removeVoiceSet := normalizeID(removedModel.VoiceSetID)
		if removeVoiceSet != "" && !overlayUsesVoiceSet(current.Models, removeVoiceSet) {
			filteredVoices := make([]VoiceEntry, 0, len(current.Voices))
			for _, voice := range current.Voices {
				if normalizeID(voice.VoiceSetID) == removeVoiceSet {
					continue
				}
				filteredVoices = append(filteredVoices, voice)
			}
			current.Voices = filteredVoices
		}
	}

	if providerDocumentIsEmptyOverlay(current) {
		delete(r.subjectOverlays[strings.TrimSpace(subjectUserID)], normalizedProvider)
		if err := r.recomputeSubjectStateLocked(subjectUserID); err != nil {
			return CatalogProviderRecord{}, err
		}
		path := customProviderFilePath(subjectCatalogDir(r.customDir, subjectUserID), normalizedProvider)
		if path != "" {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return CatalogProviderRecord{}, err
			}
		}
		if state := r.subjectStates[strings.TrimSpace(subjectUserID)]; state != nil {
			if providerState, ok := state.providers[normalizedProvider]; ok {
				return providerState.record, nil
			}
		}
		if r.globalState != nil {
			if providerState, ok := r.globalState.providers[normalizedProvider]; ok {
				return providerState.record, nil
			}
		}
		return CatalogProviderRecord{}, nil
	}

	current.RawYAML = ""
	yamlText, err := marshalProviderDocumentYAML(current)
	if err != nil {
		return CatalogProviderRecord{}, err
	}
	current.RawYAML = yamlText
	return r.persistSubjectOverlayLocked(subjectUserID, overlayDocument{
		doc:        current,
		updatedAt:  time.Now().UTC().Format(time.RFC3339),
		userScoped: true,
	})
}

func (r *Resolver) subjectOverlayDocumentLocked(subjectUserID string, provider string) ProviderDocument {
	subjectKey := strings.TrimSpace(subjectUserID)
	if subjectKey == "" {
		if overlay, ok := r.sharedOverlays[provider]; ok {
			return overlay.doc
		}
		return ProviderDocument{}
	}
	overlays := r.subjectOverlays[subjectKey]
	if overlay, ok := overlays[provider]; ok {
		return overlay.doc
	}
	return ProviderDocument{}
}

func (r *Resolver) persistSubjectOverlay(subjectUserID string, overlay overlayDocument) (CatalogProviderRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.persistSubjectOverlayLocked(subjectUserID, overlay)
}

func (r *Resolver) persistSubjectOverlayLocked(subjectUserID string, overlay overlayDocument) (CatalogProviderRecord, error) {
	if strings.TrimSpace(r.customDir) == "" {
		return CatalogProviderRecord{}, ErrCatalogMutationDisabled
	}
	provider := normalizeProvider(overlay.doc.Provider)
	if provider == "" {
		return CatalogProviderRecord{}, ErrProviderUnsupported
	}

	if strings.TrimSpace(subjectUserID) == "" {
		r.sharedOverlays[provider] = overlay
		if err := r.recomputeGlobalStateLocked(); err != nil {
			delete(r.sharedOverlays, provider)
			_ = r.recomputeGlobalStateLocked()
			return CatalogProviderRecord{}, err
		}
		for subject := range r.subjectOverlays {
			if err := r.recomputeSubjectStateLocked(subject); err != nil {
				return CatalogProviderRecord{}, err
			}
		}
		path := customProviderFilePath(r.customDir, provider)
		if err := writeOverlayDocument(path, overlay.doc); err != nil {
			return CatalogProviderRecord{}, err
		}
		return r.globalState.providers[provider].record, nil
	}

	subjectKey := strings.TrimSpace(subjectUserID)
	if err := r.ensureSubjectLoadedLocked(subjectKey); err != nil {
		return CatalogProviderRecord{}, err
	}
	if r.subjectOverlays[subjectKey] == nil {
		r.subjectOverlays[subjectKey] = map[string]overlayDocument{}
	}
	r.subjectOverlays[subjectKey][provider] = overlay
	if err := r.recomputeSubjectStateLocked(subjectKey); err != nil {
		delete(r.subjectOverlays[subjectKey], provider)
		_ = r.recomputeSubjectStateLocked(subjectKey)
		return CatalogProviderRecord{}, err
	}
	path := customProviderFilePath(subjectCatalogDir(r.customDir, subjectKey), provider)
	if err := writeOverlayDocument(path, overlay.doc); err != nil {
		return CatalogProviderRecord{}, err
	}
	return r.subjectStates[subjectKey].providers[provider].record, nil
}

func (r *Resolver) stateForSubject(subjectUserID string) (*catalogState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stateForSubjectLocked(subjectUserID)
}

func (r *Resolver) stateForSubjectLocked(subjectUserID string) (*catalogState, error) {
	subjectKey := strings.TrimSpace(subjectUserID)
	if subjectKey == "" {
		return r.globalState, nil
	}
	if err := r.ensureSubjectLoadedLocked(subjectKey); err != nil {
		return nil, err
	}
	if state := r.subjectStates[subjectKey]; state != nil {
		return state, nil
	}
	return r.globalState, nil
}

func (r *Resolver) ensureSubjectLoadedLocked(subjectUserID string) error {
	subjectKey := strings.TrimSpace(subjectUserID)
	if subjectKey == "" {
		return nil
	}
	if r.subjectLoaded[subjectKey] {
		return nil
	}
	overlayDir := subjectCatalogDir(r.customDir, subjectKey)
	overlays, err := loadOverlayProviderDocumentsFromDir(overlayDir)
	if err != nil {
		r.logger.Warn("catalog subject overlay dir ignored", "dir", overlayDir, "error", err)
		overlays = map[string]overlayDocument{}
	}
	for provider, overlay := range overlays {
		overlay.userScoped = true
		overlays[provider] = overlay
	}
	r.subjectOverlays[subjectKey] = overlays
	r.subjectLoaded[subjectKey] = true
	return r.recomputeSubjectStateLocked(subjectKey)
}

func (r *Resolver) recomputeGlobalStateLocked() error {
	state, err := buildCatalogState(r.builtInProviders, r.sharedOverlays, nil)
	if err != nil {
		return err
	}
	r.globalState = state
	return nil
}

func (r *Resolver) recomputeSubjectStateLocked(subjectUserID string) error {
	subjectKey := strings.TrimSpace(subjectUserID)
	if subjectKey == "" {
		return nil
	}
	state, err := buildCatalogState(r.builtInProviders, r.sharedOverlays, r.subjectOverlays[subjectKey])
	if err != nil {
		return err
	}
	r.subjectStates[subjectKey] = state
	return nil
}

func buildCatalogState(
	builtIn map[string]ProviderDocument,
	shared map[string]overlayDocument,
	user map[string]overlayDocument,
) (*catalogState, error) {
	merged, err := mergeEffectiveProviderDocuments(builtIn, shared, user)
	if err != nil {
		return nil, err
	}
	snapshot, err := buildSnapshotFromProviderDocuments(merged)
	if err != nil {
		return nil, err
	}
	indexed, err := buildIndexedSnapshot(snapshot)
	if err != nil {
		return nil, err
	}

	providers := make(map[string]providerState, len(merged))
	stateSource := SourceBuiltinSnapshot
	for provider, item := range merged {
		if item.hasOverlay {
			stateSource = SourceCustomDir
		}
		record := CatalogProviderRecord{
			Provider:             provider,
			Version:              item.document.Version,
			CatalogVersion:       strings.TrimSpace(item.document.CatalogVersion),
			DefaultTextModel:     strings.TrimSpace(item.document.DefaultTextModel),
			Source:               item.source,
			ModelCount:           len(item.document.Models),
			VoiceCount:           len(item.document.Voices),
			CustomModelCount:     item.customModelCount,
			OverriddenModelCount: item.overriddenModelCount,
			Capabilities:         collectProviderCapabilities(item.document.Models),
			HasOverlay:           item.hasOverlay,
			OverlayUpdatedAt:     strings.TrimSpace(item.overlayUpdatedAt),
			YAML:                 item.overlayYAML,
			EffectiveYAML:        item.effectiveYAML,
		}
		providers[provider] = providerState{
			record:           record,
			document:         item.document,
			modelSources:     item.modelSources,
			userScopedModels: item.userScopedModels,
		}
	}

	return &catalogState{
		snapshot:  indexed,
		providers: providers,
		source:    stateSource,
	}, nil
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

func collectProviderCapabilities(models []ModelEntry) []string {
	seen := map[string]struct{}{}
	for _, model := range models {
		for _, capability := range model.Capabilities {
			normalized := aicapabilities.NormalizeCatalogCapability(capability)
			if normalized == "" {
				continue
			}
			seen[normalized] = struct{}{}
		}
	}
	out := make([]string, 0, len(seen))
	for capability := range seen {
		out = append(out, capability)
	}
	sort.Strings(out)
	return out
}

func warningsForModelSource(source ModelSource, userScoped bool) []CatalogOverlayWarning {
	switch source {
	case ModelSourceCustom:
		if userScoped {
			return []CatalogOverlayWarning{{
				Code:    "user_custom_model",
				Message: "This model is visible only to the current user.",
			}}
		}
		return []CatalogOverlayWarning{{
			Code:    "custom_model",
			Message: "This model comes from a custom catalog overlay.",
		}}
	case ModelSourceOverridden:
		if userScoped {
			return []CatalogOverlayWarning{{
				Code:    "user_overrides_builtin_model",
				Message: "This override is visible only to the current user and supersedes the built-in model entry.",
			}}
		}
		return []CatalogOverlayWarning{{
			Code:    "overrides_builtin_model",
			Message: "A custom catalog overlay supersedes the built-in model entry.",
		}}
	default:
		return nil
	}
}

func subjectCatalogDir(customDir string, subjectUserID string) string {
	base := strings.TrimSpace(customDir)
	subject := strings.TrimSpace(subjectUserID)
	if base == "" || subject == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(subject))
	return filepath.Join(base, "users", hex.EncodeToString(sum[:]))
}

func writeOverlayDocument(path string, doc ProviderDocument) error {
	if strings.TrimSpace(path) == "" {
		return ErrCatalogMutationDisabled
	}
	yamlText, err := marshalProviderDocumentYAML(doc)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(yamlText), 0o600)
}

func upsertOverlayModels(models []ModelEntry, model ModelEntry) []ModelEntry {
	key := normalizeID(model.ModelID)
	out := make([]ModelEntry, 0, len(models)+1)
	replaced := false
	for _, item := range models {
		if normalizeID(item.ModelID) == key {
			if !replaced {
				out = append(out, model)
				replaced = true
			}
			continue
		}
		out = append(out, item)
	}
	if !replaced {
		out = append(out, model)
	}
	return out
}

func replaceOverlayVoices(existing []VoiceEntry, provider string, voiceSetID string, voices []VoiceEntry) []VoiceEntry {
	targetSet := normalizeID(voiceSetID)
	if targetSet == "" {
		return existing
	}
	out := make([]VoiceEntry, 0, len(existing)+len(voices))
	for _, voice := range existing {
		if normalizeID(voice.VoiceSetID) == targetSet {
			continue
		}
		out = append(out, voice)
	}
	for _, voice := range voices {
		voice.Provider = provider
		out = append(out, voice)
	}
	return out
}

func replaceOverlayWorkflowState(
	workflows []VoiceWorkflowModel,
	bindings []ModelWorkflowBinding,
	modelID string,
	replacements []VoiceWorkflowModel,
	binding *ModelWorkflowBinding,
) ([]VoiceWorkflowModel, []ModelWorkflowBinding) {
	normalizedModelID := normalizeID(modelID)
	removeRefs := map[string]struct{}{}
	filteredBindings := make([]ModelWorkflowBinding, 0, len(bindings)+1)
	for _, item := range bindings {
		if normalizeID(item.ModelID) == normalizedModelID {
			for _, ref := range item.WorkflowModelRefs {
				removeRefs[normalizeID(ref)] = struct{}{}
			}
			continue
		}
		filteredBindings = append(filteredBindings, item)
	}
	filteredWorkflows := make([]VoiceWorkflowModel, 0, len(workflows)+len(replacements))
	for _, item := range workflows {
		if _, ok := removeRefs[normalizeID(item.WorkflowModelID)]; ok {
			continue
		}
		if workflowTargetsModel(item, normalizedModelID) {
			continue
		}
		filteredWorkflows = append(filteredWorkflows, item)
	}
	filteredWorkflows = append(filteredWorkflows, replacements...)
	if binding != nil && normalizeID(binding.ModelID) == "" {
		binding.ModelID = modelID
	}
	if binding != nil {
		filteredBindings = append(filteredBindings, *binding)
	}
	return filteredWorkflows, filteredBindings
}

func removeOverlayWorkflowState(
	workflows []VoiceWorkflowModel,
	bindings []ModelWorkflowBinding,
	modelID string,
) ([]VoiceWorkflowModel, []ModelWorkflowBinding) {
	return replaceOverlayWorkflowState(workflows, bindings, modelID, nil, nil)
}

func workflowTargetsModel(workflow VoiceWorkflowModel, modelID string) bool {
	normalized := normalizeID(modelID)
	if normalized == "" {
		return false
	}
	for _, ref := range workflow.TargetModelRefs {
		if normalizeID(ref) == normalized {
			return true
		}
	}
	return false
}

func overlayUsesVoiceSet(models []ModelEntry, voiceSetID string) bool {
	normalized := normalizeID(voiceSetID)
	for _, model := range models {
		if normalizeID(model.VoiceSetID) == normalized {
			return true
		}
	}
	return false
}

func providerDocumentIsEmptyOverlay(doc ProviderDocument) bool {
	return len(doc.Models) == 0 &&
		len(doc.Voices) == 0 &&
		len(doc.VoiceWorkflowModels) == 0 &&
		len(doc.ModelWorkflowBindings) == 0 &&
		strings.TrimSpace(doc.DefaultTextModel) == ""
}

func (r *Resolver) getModelDetailFromState(state *catalogState, provider string, modelID string) (CatalogModelDetailRecord, CatalogProviderRecord, CatalogSource, error) {
	if state == nil || state.snapshot == nil {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, SourceBuiltinSnapshot, ErrModelNotFound
	}
	providerState, ok := state.providers[provider]
	if !ok {
		return CatalogModelDetailRecord{}, CatalogProviderRecord{}, state.source, ErrProviderUnsupported
	}
	model, ok := resolveModelEntry(state.snapshot, provider, normalizeLookupModelID(modelID, provider))
	if !ok {
		return CatalogModelDetailRecord{}, providerState.record, state.source, ErrModelNotFound
	}
	modelKey := normalizeID(model.ModelID)
	source := providerState.modelSources[modelKey]
	if source == "" {
		source = ModelSourceBuiltin
	}
	detail := CatalogModelDetailRecord{
		Model:      model,
		Source:     source,
		UserScoped: providerState.userScopedModels[modelKey],
		Warnings:   warningsForModelSource(source, providerState.userScopedModels[modelKey]),
	}
	if strings.TrimSpace(model.VoiceSetID) != "" {
		detail.Voices = append([]VoiceEntry(nil), state.snapshot.voicesBySet[provider+":"+normalizeID(model.VoiceSetID)]...)
	}
	if binding, ok := resolveModelWorkflowBinding(state.snapshot, provider, normalizeLookupModelID(modelID, provider)); ok {
		copyBinding := binding
		detail.ModelWorkflowBinding = &copyBinding
		for _, workflowRef := range binding.WorkflowModelRefs {
			if workflow, workflowOK := resolveWorkflowModel(state.snapshot, provider, workflowRef); workflowOK {
				detail.VoiceWorkflowModels = append(detail.VoiceWorkflowModels, workflow)
			}
		}
	}
	return detail, providerState.record, state.source, nil
}

func max(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
