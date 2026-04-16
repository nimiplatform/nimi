package catalog

import (
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

type indexedSnapshot struct {
	catalogVersion   string
	models           map[string]map[string]ModelEntry
	voicesBySet      map[string][]VoiceEntry
	workflowModels   map[string]map[string]VoiceWorkflowModel
	workflowBindings map[string]map[string]ModelWorkflowBinding
	workflowPolicies map[string][]VoiceHandlePolicy
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
			return nil, fmt.Errorf("load catalog custom dir %s: %w", resolver.customDir, loadErr)
		}
		resolver.sharedOverlays = sharedOverlays
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
		policy, _ := resolveVoiceHandlePolicy(state.snapshot, provider, normalizedWorkflowType)
		return ResolveVoiceWorkflowResult{
			Provider:                       provider,
			ModelID:                        strings.TrimSpace(modelEntry.ModelID),
			WorkflowType:                   normalizedWorkflowType,
			WorkflowModelID:                strings.TrimSpace(workflowModel.WorkflowModelID),
			WorkflowFamily:                 inferWorkflowFamily(workflowModel.WorkflowModelID, modelEntry.ModelID),
			InputContractRef:               strings.TrimSpace(workflowModel.InputContractRef),
			OutputPersistence:              strings.TrimSpace(workflowModel.OutputPersistence),
			HandlePolicyID:                 strings.TrimSpace(policy.PolicyID),
			HandlePolicyPersistence:        strings.TrimSpace(policy.Persistence),
			HandlePolicyScope:              strings.TrimSpace(policy.Scope),
			HandlePolicyDefaultTTL:         strings.TrimSpace(policy.DefaultTTL),
			HandlePolicyDeleteSemantics:    strings.TrimSpace(policy.DeleteSemantics),
			RuntimeReconciliationRequired:  policy.RuntimeReconciliationRequired,
			RequestOptions:                 workflowModel.RequestOptions,
			RequiresTargetSynthesisBinding: len(binding.WorkflowModelRefs) > 0,
			CatalogVersion:                 state.snapshot.catalogVersion,
			Source:                         state.source,
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
		normalized, err := aicapabilities.NormalizeCatalogCapability(capability)
		if err != nil {
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

// ResolveAPIModelID returns the canonical API model ID for a provider model.
// If the catalog entry has an explicit ApiModelID, that value is returned;
// otherwise modelID is returned unchanged.
func (r *Resolver) ResolveAPIModelID(providerType string, modelID string) string {
	return r.ResolveAPIModelIDForSubject("", providerType, modelID)
}

func (r *Resolver) ResolveAPIModelIDForSubject(subjectUserID string, providerType string, modelID string) string {
	entry, err := r.ResolveModelEntryForSubject(subjectUserID, providerType, modelID)
	if err != nil {
		return modelID
	}
	if api := strings.TrimSpace(entry.ApiModelID); api != "" {
		return api
	}
	return modelID
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
