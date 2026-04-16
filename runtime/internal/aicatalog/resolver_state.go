package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

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
		workflowPolicies: make(map[string][]VoiceHandlePolicy),
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
	for _, policy := range snapshot.VoiceHandlePolicies {
		provider := normalizeProvider(policy.Provider)
		if provider == "" {
			continue
		}
		indexed.workflowPolicies[provider] = append(indexed.workflowPolicies[provider], policy)
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

func resolveVoiceHandlePolicy(snapshot *indexedSnapshot, provider string, workflowType string) (VoiceHandlePolicy, bool) {
	policies := snapshot.workflowPolicies[provider]
	if len(policies) == 0 {
		return VoiceHandlePolicy{}, false
	}
	normalizedWorkflowType := normalizeWorkflowType(workflowType)
	if normalizedWorkflowType == "" {
		return VoiceHandlePolicy{}, false
	}
	for _, policy := range policies {
		for _, item := range policy.AppliesToWorkflowTypes {
			if normalizeWorkflowType(item) == normalizedWorkflowType {
				return policy, true
			}
		}
	}
	return VoiceHandlePolicy{}, false
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
			normalized, err := aicapabilities.NormalizeCatalogCapability(capability)
			if err != nil {
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
	return len(doc.SelectionProfiles) == 0 &&
		len(doc.Models) == 0 &&
		len(doc.Voices) == 0 &&
		len(doc.VoiceWorkflowModels) == 0 &&
		len(doc.ModelWorkflowBindings) == 0 &&
		len(doc.VoiceHandlePolicies) == 0 &&
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
		addedPolicies := map[string]struct{}{}
		for _, workflowType := range binding.WorkflowTypes {
			if policy, ok := resolveVoiceHandlePolicy(state.snapshot, provider, workflowType); ok {
				key := normalizeID(policy.PolicyID)
				if _, exists := addedPolicies[key]; exists {
					continue
				}
				addedPolicies[key] = struct{}{}
				detail.VoiceHandlePolicies = append(detail.VoiceHandlePolicies, policy)
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
