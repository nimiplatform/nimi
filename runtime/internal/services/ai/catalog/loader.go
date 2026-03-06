package catalog

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"gopkg.in/yaml.v3"
)

const providerFileExt = ".yaml"

var supportedProvidersOrdered = append([]string(nil), providerregistry.SourceProviders...)

var supportedProviderSet = func() map[string]struct{} {
	set := make(map[string]struct{}, len(supportedProvidersOrdered))
	for _, provider := range supportedProvidersOrdered {
		set[provider] = struct{}{}
	}
	return set
}()

func SupportedProviders() []string {
	return append([]string(nil), supportedProvidersOrdered...)
}

func isSupportedProvider(provider string) bool {
	_, ok := supportedProviderSet[normalizeProvider(provider)]
	return ok
}

func loadBuiltInProviderDocuments() (map[string]ProviderDocument, error) {
	entries, err := fs.ReadDir(runtimecatalog.DefaultProvidersFS, "providers")
	if err != nil {
		return nil, fmt.Errorf("read built-in providers directory: %w", err)
	}
	providers := make(map[string]ProviderDocument, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if !strings.HasSuffix(strings.ToLower(name), providerFileExt) {
			continue
		}
		raw, readErr := fs.ReadFile(runtimecatalog.DefaultProvidersFS, filepath.Join("providers", name))
		if readErr != nil {
			return nil, fmt.Errorf("read built-in provider file %q: %w", name, readErr)
		}
		doc, parseErr := parseProviderDocumentYAML(raw, name)
		if parseErr != nil {
			if errors.Is(parseErr, ErrProviderUnsupported) {
				continue
			}
			return nil, fmt.Errorf("parse built-in provider file %q: %w", name, parseErr)
		}
		providers[doc.Provider] = doc
	}
	if len(providers) == 0 {
		return nil, errors.New("built-in provider catalog is empty")
	}
	return providers, nil
}

func loadProviderDocumentsFromDir(dir string) (map[string]ProviderDocument, error) {
	resolved := strings.TrimSpace(dir)
	if resolved == "" {
		return map[string]ProviderDocument{}, nil
	}
	st, err := os.Stat(resolved)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]ProviderDocument{}, nil
		}
		return nil, fmt.Errorf("stat provider catalog dir %q: %w", resolved, err)
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("provider catalog path %q is not a directory", resolved)
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, fmt.Errorf("read provider catalog dir %q: %w", resolved, err)
	}
	providers := make(map[string]ProviderDocument, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := strings.TrimSpace(entry.Name())
		if !strings.HasSuffix(strings.ToLower(name), providerFileExt) {
			continue
		}
		absPath := filepath.Join(resolved, name)
		raw, readErr := os.ReadFile(absPath)
		if readErr != nil {
			return nil, fmt.Errorf("read provider catalog file %q: %w", absPath, readErr)
		}
		doc, parseErr := parseProviderDocumentYAML(raw, name)
		if parseErr != nil {
			if errors.Is(parseErr, ErrProviderUnsupported) {
				continue
			}
			return nil, fmt.Errorf("parse provider catalog file %q: %w", absPath, parseErr)
		}
		providers[doc.Provider] = doc
	}
	return providers, nil
}

func parseProviderDocumentYAML(raw []byte, filename string) (ProviderDocument, error) {
	var parsed ProviderDocument
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return ProviderDocument{}, err
	}
	doc, err := normalizeProviderDocument(parsed, filename)
	if err != nil {
		return ProviderDocument{}, err
	}
	doc.RawYAML = normalizeYAMLString(string(raw))
	if doc.RawYAML == "" {
		marshaled, marshalErr := yaml.Marshal(doc)
		if marshalErr != nil {
			return ProviderDocument{}, marshalErr
		}
		doc.RawYAML = normalizeYAMLString(string(marshaled))
	}
	return doc, nil
}

func normalizeProviderDocument(parsed ProviderDocument, filename string) (ProviderDocument, error) {
	provider := normalizeProvider(parsed.Provider)
	if provider == "" {
		provider = inferProviderFromFilename(filename)
	}
	if provider == "" {
		return ProviderDocument{}, errors.New("provider is required")
	}
	if !isSupportedProvider(provider) {
		return ProviderDocument{}, fmt.Errorf("%w: %s", ErrProviderUnsupported, provider)
	}

	doc := ProviderDocument{
		Version:               parsed.Version,
		Provider:              provider,
		CatalogVersion:        strings.TrimSpace(parsed.CatalogVersion),
		Models:                append([]ModelEntry(nil), parsed.Models...),
		Voices:                append([]VoiceEntry(nil), parsed.Voices...),
		VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), parsed.VoiceWorkflowModels...),
		ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), parsed.ModelWorkflowBindings...),
	}
	if doc.Version <= 0 {
		doc.Version = 1
	}
	if doc.CatalogVersion == "" {
		doc.CatalogVersion = "unknown"
	}

	for i := range doc.Models {
		entryProvider := normalizeProvider(doc.Models[i].Provider)
		if entryProvider != "" && entryProvider != provider {
			return ProviderDocument{}, fmt.Errorf("model %q provider mismatch: expected %q", doc.Models[i].ModelID, provider)
		}
		doc.Models[i].Provider = provider
	}
	if len(doc.Models) == 0 {
		return ProviderDocument{}, fmt.Errorf("%w: %s", ErrProviderUnsupported, provider)
	}

	for i := range doc.Voices {
		entryProvider := normalizeProvider(doc.Voices[i].Provider)
		if entryProvider != "" && entryProvider != provider {
			return ProviderDocument{}, fmt.Errorf("voice %q provider mismatch: expected %q", doc.Voices[i].VoiceID, provider)
		}
		doc.Voices[i].Provider = provider
	}
	if provider == "dashscope" {
		for i := range doc.Voices {
			name := strings.TrimSpace(doc.Voices[i].Name)
			if name != "" && strings.EqualFold(name, strings.TrimSpace(doc.Voices[i].VoiceID)) {
				doc.Voices[i].VoiceID = name
			}
		}
	}

	snapshot := Snapshot{
		CatalogVersion:        doc.CatalogVersion,
		Models:                append([]ModelEntry(nil), doc.Models...),
		Voices:                append([]VoiceEntry(nil), doc.Voices...),
		VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), doc.VoiceWorkflowModels...),
		ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), doc.ModelWorkflowBindings...),
	}
	if err := validateSnapshot(snapshot); err != nil {
		return ProviderDocument{}, err
	}
	return doc, nil
}

func inferProviderFromFilename(filename string) string {
	base := strings.TrimSpace(filepath.Base(filename))
	if base == "" {
		return ""
	}
	ext := filepath.Ext(base)
	if strings.EqualFold(ext, providerFileExt) {
		base = strings.TrimSuffix(base, ext)
	}
	return normalizeProvider(base)
}

func mergeProviderDocuments(base map[string]ProviderDocument, overlays ...map[string]ProviderDocument) map[string]ProviderDocument {
	merged := make(map[string]ProviderDocument)
	for provider, doc := range base {
		merged[provider] = doc
	}
	for _, overlay := range overlays {
		for provider, doc := range overlay {
			merged[provider] = doc
		}
	}
	return merged
}

func buildSnapshotFromProviderDocuments(providerDocs map[string]ProviderDocument) (Snapshot, error) {
	if len(providerDocs) == 0 {
		return Snapshot{}, errors.New("provider catalog is empty")
	}
	providers := make([]string, 0, len(providerDocs))
	for provider := range providerDocs {
		providers = append(providers, provider)
	}
	sort.Strings(providers)

	models := make([]ModelEntry, 0, 32)
	voices := make([]VoiceEntry, 0, 64)
	voiceWorkflowModels := make([]VoiceWorkflowModel, 0, 8)
	modelWorkflowBindings := make([]ModelWorkflowBinding, 0, 8)
	versionTokens := make([]string, 0, len(providers))
	for _, provider := range providers {
		doc := providerDocs[provider]
		models = append(models, doc.Models...)
		voices = append(voices, doc.Voices...)
		voiceWorkflowModels = append(voiceWorkflowModels, doc.VoiceWorkflowModels...)
		modelWorkflowBindings = append(modelWorkflowBindings, doc.ModelWorkflowBindings...)
		versionTokens = append(versionTokens, provider+":"+firstNonEmpty(doc.CatalogVersion, "unknown"))
	}

	catalogVersion := strings.Join(versionTokens, ";")
	if len(providers) == 1 {
		catalogVersion = strings.TrimSpace(providerDocs[providers[0]].CatalogVersion)
	}
	if strings.TrimSpace(catalogVersion) == "" {
		catalogVersion = "unknown"
	}

	snapshot := Snapshot{
		CatalogVersion:        catalogVersion,
		Models:                models,
		Voices:                voices,
		VoiceWorkflowModels:   voiceWorkflowModels,
		ModelWorkflowBindings: modelWorkflowBindings,
	}
	if err := validateSnapshot(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func marshalProviderDocumentYAML(doc ProviderDocument) (string, error) {
	if strings.TrimSpace(doc.RawYAML) != "" {
		return normalizeYAMLString(doc.RawYAML), nil
	}
	raw, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return normalizeYAMLString(string(raw)), nil
}

func normalizeYAMLString(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	return trimmed + "\n"
}

func customProviderFilePath(dir string, provider string) string {
	base := strings.TrimSpace(dir)
	if base == "" {
		return ""
	}
	return filepath.Join(base, normalizeProvider(provider)+providerFileExt)
}

func validateSnapshot(snapshot Snapshot) error {
	if len(snapshot.Models) == 0 {
		return errors.New("models must not be empty")
	}

	allowedUnits := map[string]struct{}{
		"token":   {},
		"char":    {},
		"second":  {},
		"request": {},
	}

	modelSet := make(map[string]ModelEntry, len(snapshot.Models))
	voiceSetRefs := make(map[string]struct{}, len(snapshot.Models))
	ttsModelRefs := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		provider := normalizeProvider(model.Provider)
		modelID := normalizeID(model.ModelID)
		if provider == "" || modelID == "" {
			return fmt.Errorf("model entry missing provider/model_id")
		}
		if strings.TrimSpace(model.ModelType) == "" {
			return fmt.Errorf("model %s:%s missing model_type", provider, modelID)
		}
		if strings.TrimSpace(model.UpdatedAt) == "" {
			return fmt.Errorf("model %s:%s missing updated_at", provider, modelID)
		}
		if len(model.Capabilities) == 0 {
			return fmt.Errorf("model %s:%s missing capabilities", provider, modelID)
		}
		if _, ok := allowedUnits[strings.TrimSpace(model.Pricing.Unit)]; !ok {
			return fmt.Errorf("model %s:%s has invalid pricing.unit %q", provider, modelID, model.Pricing.Unit)
		}
		for _, field := range []string{model.Pricing.Input, model.Pricing.Output, model.Pricing.Currency, model.Pricing.AsOf, model.Pricing.Notes} {
			if strings.TrimSpace(field) == "" {
				return fmt.Errorf("model %s:%s has incomplete pricing", provider, modelID)
			}
		}
		if strings.TrimSpace(model.SourceRef.URL) == "" || strings.TrimSpace(model.SourceRef.RetrievedAt) == "" {
			return fmt.Errorf("model %s:%s missing source_ref", provider, modelID)
		}
		key := provider + ":" + modelID
		if _, exists := modelSet[key]; exists {
			return fmt.Errorf("duplicate model entry %s", key)
		}
		modelSet[key] = model
		if modelRequiresVoice(model) {
			if strings.TrimSpace(model.VoiceSetID) == "" {
				return fmt.Errorf("model %s:%s missing voice_set_id", provider, modelID)
			}
			voiceSetRefs[provider+":"+normalizeID(model.VoiceSetID)] = struct{}{}
			ttsModelRefs[key] = struct{}{}
		}
		if modelRequiresVideoGeneration(model) && model.VideoGeneration == nil {
			return fmt.Errorf("model %s:%s missing video_generation", provider, modelID)
		}
		if model.VideoGeneration != nil {
			if len(model.VideoGeneration.Modes) == 0 {
				return fmt.Errorf("model %s:%s video_generation.modes must not be empty", provider, modelID)
			}
			if len(model.VideoGeneration.InputRoles) == 0 {
				return fmt.Errorf("model %s:%s video_generation.input_roles must not be empty", provider, modelID)
			}
			if len(model.VideoGeneration.Limits) == 0 {
				return fmt.Errorf("model %s:%s video_generation.limits must not be empty", provider, modelID)
			}
			if len(model.VideoGeneration.Options.Supports) == 0 {
				return fmt.Errorf("model %s:%s video_generation.options.supports must not be empty", provider, modelID)
			}
			if model.VideoGeneration.Options.Constraints == nil {
				return fmt.Errorf("model %s:%s video_generation.options.constraints must not be nil", provider, modelID)
			}
			if !model.VideoGeneration.Outputs.VideoURL && !model.VideoGeneration.Outputs.LastFrameURL {
				return fmt.Errorf("model %s:%s video_generation.outputs must declare at least one artifact", provider, modelID)
			}
		}
	}
	if len(ttsModelRefs) > 0 && len(snapshot.Voices) == 0 {
		return errors.New("voices must not be empty when tts models exist")
	}

	seenVoice := make(map[string]struct{}, len(snapshot.Voices))
	ttsVoiceCoverage := make(map[string]struct{}, len(ttsModelRefs))
	for _, voice := range snapshot.Voices {
		provider := normalizeProvider(voice.Provider)
		voiceSetID := normalizeID(voice.VoiceSetID)
		voiceID := strings.TrimSpace(voice.VoiceID)
		if provider == "" || voiceSetID == "" || voiceID == "" {
			return fmt.Errorf("voice entry missing provider/voice_set_id/voice_id")
		}
		if strings.TrimSpace(voice.Name) == "" {
			return fmt.Errorf("voice %s:%s missing name", provider, voiceID)
		}
		if len(voice.Langs) == 0 {
			return fmt.Errorf("voice %s:%s missing langs", provider, voiceID)
		}
		if len(voice.ModelIDs) == 0 {
			return fmt.Errorf("voice %s:%s missing model_ids", provider, voiceID)
		}
		if strings.TrimSpace(voice.SourceRef.URL) == "" || strings.TrimSpace(voice.SourceRef.RetrievedAt) == "" {
			return fmt.Errorf("voice %s:%s missing source_ref", provider, voiceID)
		}
		if _, ok := voiceSetRefs[provider+":"+voiceSetID]; !ok {
			return fmt.Errorf("voice %s:%s references missing voice set %s", provider, voiceID, voiceSetID)
		}
		for _, modelIDRaw := range voice.ModelIDs {
			modelID := normalizeID(modelIDRaw)
			if modelID == "" {
				return fmt.Errorf("voice %s:%s has empty model_id", provider, voiceID)
			}
			modelKey := provider + ":" + modelID
			if _, ok := modelSet[modelKey]; !ok {
				return fmt.Errorf("voice %s:%s references unknown model %s", provider, voiceID, modelID)
			}
			if _, ok := ttsModelRefs[modelKey]; ok {
				ttsVoiceCoverage[modelKey] = struct{}{}
			}
		}
		voiceKey := provider + ":" + voiceSetID + ":" + strings.ToLower(voiceID)
		if _, exists := seenVoice[voiceKey]; exists {
			return fmt.Errorf("duplicate voice entry %s", voiceKey)
		}
		seenVoice[voiceKey] = struct{}{}
	}
	for modelKey := range ttsModelRefs {
		if _, ok := ttsVoiceCoverage[modelKey]; ok {
			continue
		}
		return fmt.Errorf("tts model %s has no mapped voices", modelKey)
	}

	workflowModelByKey := make(map[string]VoiceWorkflowModel, len(snapshot.VoiceWorkflowModels))
	workflowTypeByKey := make(map[string]string, len(snapshot.VoiceWorkflowModels))
	for _, workflowModel := range snapshot.VoiceWorkflowModels {
		workflowModelID := normalizeID(workflowModel.WorkflowModelID)
		workflowType := normalizeWorkflowType(workflowModel.WorkflowType)
		if workflowModelID == "" || workflowType == "" {
			return fmt.Errorf("voice workflow model missing workflow_model_id/workflow_type")
		}
		provider := normalizeProvider(inferProviderFromWorkflowModelID(workflowModelID, workflowModel.TargetModelRefs, modelSet))
		if provider == "" {
			return fmt.Errorf("voice workflow model %s cannot infer provider", workflowModelID)
		}
		if len(workflowModel.TargetModelRefs) == 0 {
			return fmt.Errorf("voice workflow model %s must include target_model_refs", workflowModelID)
		}
		for _, targetModelRaw := range workflowModel.TargetModelRefs {
			targetModelID := normalizeID(targetModelRaw)
			if targetModelID == "" {
				return fmt.Errorf("voice workflow model %s has empty target_model_ref", workflowModelID)
			}
			modelKey := provider + ":" + targetModelID
			if _, ok := modelSet[modelKey]; !ok {
				return fmt.Errorf("voice workflow model %s references unknown model %s", workflowModelID, targetModelID)
			}
		}
		key := provider + ":" + workflowModelID
		if _, exists := workflowModelByKey[key]; exists {
			return fmt.Errorf("duplicate voice workflow model %s", key)
		}
		workflowModelByKey[key] = workflowModel
		workflowTypeByKey[key] = workflowType
	}

	bindingByModel := make(map[string]ModelWorkflowBinding, len(snapshot.ModelWorkflowBindings))
	for _, binding := range snapshot.ModelWorkflowBindings {
		modelID := normalizeID(binding.ModelID)
		if modelID == "" {
			return fmt.Errorf("model workflow binding missing model_id")
		}
		refs := normalizeStringSlice(binding.WorkflowModelRefs)
		if len(refs) == 0 {
			return fmt.Errorf("model workflow binding %s missing workflow_model_refs", modelID)
		}
		workflowTypes := normalizeStringSlice(binding.WorkflowTypes)
		for i := range workflowTypes {
			workflowTypes[i] = normalizeWorkflowType(workflowTypes[i])
			if workflowTypes[i] == "" {
				return fmt.Errorf("model workflow binding %s has invalid workflow_types entry", modelID)
			}
		}

		provider := normalizeProvider(inferProviderFromBindingModelID(modelID, modelSet))
		if provider == "" {
			return fmt.Errorf("model workflow binding %s references unknown model", modelID)
		}
		modelKey := provider + ":" + modelID
		if _, exists := bindingByModel[modelKey]; exists {
			return fmt.Errorf("duplicate model workflow binding %s", modelKey)
		}
		inferredTypes := make(map[string]struct{}, len(refs))
		for _, ref := range refs {
			refKey := provider + ":" + normalizeID(ref)
			refType, ok := workflowTypeByKey[refKey]
			if !ok {
				return fmt.Errorf("model workflow binding %s references unknown workflow model %s", modelKey, ref)
			}
			inferredTypes[refType] = struct{}{}
		}
		if len(workflowTypes) == 0 {
			for workflowType := range inferredTypes {
				workflowTypes = append(workflowTypes, workflowType)
			}
		}
		for _, workflowType := range workflowTypes {
			if _, ok := inferredTypes[workflowType]; !ok {
				return fmt.Errorf("model workflow binding %s declares unsupported workflow_type %s", modelKey, workflowType)
			}
		}
		bindingByModel[modelKey] = ModelWorkflowBinding{
			ModelID:           binding.ModelID,
			WorkflowModelRefs: refs,
			WorkflowTypes:     workflowTypes,
		}
	}

	return nil
}

func normalizeWorkflowType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "tts_v2v":
		return "tts_v2v"
	case "tts_t2v":
		return "tts_t2v"
	default:
		return ""
	}
}

func inferProviderFromWorkflowModelID(workflowModelID string, targetModelRefs []string, modelSet map[string]ModelEntry) string {
	normalizedWorkflowModelID := strings.TrimSpace(strings.ToLower(workflowModelID))
	if idx := strings.Index(normalizedWorkflowModelID, ":"); idx > 0 {
		return strings.TrimSpace(normalizedWorkflowModelID[:idx])
	}
	if idx := strings.Index(normalizedWorkflowModelID, "/"); idx > 0 {
		return strings.TrimSpace(normalizedWorkflowModelID[:idx])
	}
	for _, targetModelRaw := range targetModelRefs {
		modelID := normalizeID(targetModelRaw)
		if modelID == "" {
			continue
		}
		for key := range modelSet {
			if strings.HasSuffix(key, ":"+modelID) {
				parts := strings.SplitN(key, ":", 2)
				if len(parts) == 2 {
					return parts[0]
				}
			}
		}
	}
	return ""
}

func inferProviderFromBindingModelID(modelID string, modelSet map[string]ModelEntry) string {
	for key := range modelSet {
		if strings.HasSuffix(key, ":"+normalizeID(modelID)) {
			parts := strings.SplitN(key, ":", 2)
			if len(parts) == 2 {
				return parts[0]
			}
		}
	}
	return ""
}

func normalizeProvider(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func isSpeechSynthesisModel(model ModelEntry) bool {
	if strings.EqualFold(strings.TrimSpace(model.ModelType), "tts") {
		return true
	}
	return containsCapability(model.Capabilities, aicapabilities.AudioSynthesize)
}

func modelRequiresVideoGeneration(model ModelEntry) bool {
	return containsCapability(model.Capabilities, aicapabilities.VideoGenerate)
}

func containsCapability(capabilities []string, expected string) bool {
	return aicapabilities.HasCatalogCapability(capabilities, expected)
}

func modelRequiresVoice(model ModelEntry) bool {
	if strings.TrimSpace(model.VoiceSetID) != "" {
		return true
	}
	return isSpeechSynthesisModel(model)
}
