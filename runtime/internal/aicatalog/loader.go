package catalog

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimecatalog "github.com/nimiplatform/nimi/runtime/catalog"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"gopkg.in/yaml.v3"
)

const providerFileExt = ".yaml"

type overlayDocument struct {
	doc        ProviderDocument
	updatedAt  string
	userScoped bool
}

type mergedProviderDocument struct {
	document             ProviderDocument
	source               ProviderSource
	modelSources         map[string]ModelSource
	userScopedModels     map[string]bool
	customModelCount     int
	overriddenModelCount int
	hasOverlay           bool
	overlayYAML          string
	effectiveYAML        string
	overlayUpdatedAt     string
}

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
		raw, readErr := fs.ReadFile(runtimecatalog.DefaultProvidersFS, path.Join("providers", name))
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

func loadOverlayProviderDocumentsFromDir(dir string) (map[string]overlayDocument, error) {
	resolved := strings.TrimSpace(dir)
	if resolved == "" {
		return map[string]overlayDocument{}, nil
	}
	st, err := os.Stat(resolved)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]overlayDocument{}, nil
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
	providers := make(map[string]overlayDocument, len(entries))
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
		doc, parseErr := parseOverlayProviderDocumentYAML(raw, name)
		if parseErr != nil {
			if errors.Is(parseErr, ErrProviderUnsupported) {
				continue
			}
			return nil, fmt.Errorf("parse provider catalog file %q: %w", absPath, parseErr)
		}
		info, statErr := os.Stat(absPath)
		if statErr != nil {
			return nil, fmt.Errorf("stat provider catalog file %q: %w", absPath, statErr)
		}
		providers[doc.Provider] = overlayDocument{
			doc:       doc,
			updatedAt: info.ModTime().UTC().Format(time.RFC3339),
		}
	}
	return providers, nil
}

func parseProviderDocumentYAML(raw []byte, filename string) (ProviderDocument, error) {
	return parseProviderDocumentYAMLWithMode(raw, filename, false)
}

func parseOverlayProviderDocumentYAML(raw []byte, filename string) (ProviderDocument, error) {
	return parseProviderDocumentYAMLWithMode(raw, filename, true)
}

func parseProviderDocumentYAMLWithMode(raw []byte, filename string, overlay bool) (ProviderDocument, error) {
	var parsed ProviderDocument
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return ProviderDocument{}, err
	}
	doc, err := normalizeProviderDocument(parsed, filename, overlay)
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

func normalizeProviderDocument(parsed ProviderDocument, filename string, overlay bool) (ProviderDocument, error) {
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
		InventoryMode:         strings.TrimSpace(parsed.InventoryMode),
		DynamicInventory:      parsed.DynamicInventory,
		DefaultTextModel:      strings.TrimSpace(parsed.DefaultTextModel),
		SelectionProfiles:     append([]SelectionProfile(nil), parsed.SelectionProfiles...),
		Models:                append([]ModelEntry(nil), parsed.Models...),
		Voices:                append([]VoiceEntry(nil), parsed.Voices...),
		VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), parsed.VoiceWorkflowModels...),
		ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), parsed.ModelWorkflowBindings...),
		VoiceHandlePolicies:   append([]VoiceHandlePolicy(nil), parsed.VoiceHandlePolicies...),
	}
	if doc.Version <= 0 {
		doc.Version = 1
	}
	if doc.CatalogVersion == "" {
		doc.CatalogVersion = "unknown"
	}
	if strings.TrimSpace(doc.InventoryMode) == "" {
		doc.InventoryMode = "static_source"
	}
	switch doc.InventoryMode {
	case "static_source", "dynamic_endpoint":
	default:
		return ProviderDocument{}, fmt.Errorf("provider %q has invalid inventory_mode %q", provider, doc.InventoryMode)
	}
	if doc.InventoryMode == "dynamic_endpoint" {
		if doc.DynamicInventory == nil {
			return ProviderDocument{}, fmt.Errorf("provider %q dynamic_endpoint requires dynamic_inventory", provider)
		}
		if strings.TrimSpace(doc.DynamicInventory.DiscoveryTransport) != "connector_list_models" {
			return ProviderDocument{}, fmt.Errorf("provider %q dynamic_inventory.discovery_transport must be connector_list_models", provider)
		}
		if doc.DynamicInventory.CacheTTLSeconds <= 0 {
			return ProviderDocument{}, fmt.Errorf("provider %q dynamic_inventory.cache_ttl_sec must be > 0", provider)
		}
		if mode := strings.TrimSpace(doc.DynamicInventory.SelectionMode); mode != "curated_filter" && mode != "pass_through" {
			return ProviderDocument{}, fmt.Errorf("provider %q dynamic_inventory.selection_mode must be curated_filter or pass_through", provider)
		}
		if policy := strings.TrimSpace(doc.DynamicInventory.FailurePolicy); policy != "use_cache_then_fail_closed" && policy != "fail_closed" {
			return ProviderDocument{}, fmt.Errorf("provider %q dynamic_inventory.failure_policy must be use_cache_then_fail_closed or fail_closed", provider)
		}
	}

	for i := range doc.Models {
		entryProvider := normalizeProvider(doc.Models[i].Provider)
		if entryProvider != "" && entryProvider != provider {
			return ProviderDocument{}, fmt.Errorf("model %q provider mismatch: expected %q", doc.Models[i].ModelID, provider)
		}
		doc.Models[i].Provider = provider
		if normalizeID(doc.Models[i].ModelID) == "" {
			return ProviderDocument{}, errors.New("model entry missing model_id")
		}
	}

	for i := range doc.Voices {
		entryProvider := normalizeProvider(doc.Voices[i].Provider)
		if entryProvider != "" && entryProvider != provider {
			return ProviderDocument{}, fmt.Errorf("voice %q provider mismatch: expected %q", doc.Voices[i].VoiceID, provider)
		}
		doc.Voices[i].Provider = provider
		if normalizeID(doc.Voices[i].VoiceSetID) == "" || strings.TrimSpace(doc.Voices[i].VoiceID) == "" {
			return ProviderDocument{}, errors.New("voice entry missing voice_set_id/voice_id")
		}
	}

	for _, workflowModel := range doc.VoiceWorkflowModels {
		if normalizeID(workflowModel.WorkflowModelID) == "" {
			return ProviderDocument{}, errors.New("voice workflow model missing workflow_model_id")
		}
	}
	for _, binding := range doc.ModelWorkflowBindings {
		if normalizeID(binding.ModelID) == "" {
			return ProviderDocument{}, errors.New("model workflow binding missing model_id")
		}
	}
	for _, policy := range doc.VoiceHandlePolicies {
		if normalizeID(policy.PolicyID) == "" {
			return ProviderDocument{}, errors.New("voice handle policy missing policy_id")
		}
	}
	for i := range doc.VoiceHandlePolicies {
		doc.VoiceHandlePolicies[i].Provider = provider
	}

	if !overlay {
		if doc.InventoryMode == "static_source" && len(doc.Models) == 0 {
			return ProviderDocument{}, fmt.Errorf("%w: %s", ErrProviderUnsupported, provider)
		}
		if doc.InventoryMode == "static_source" {
			snapshot := Snapshot{
				CatalogVersion:        doc.CatalogVersion,
				Models:                append([]ModelEntry(nil), doc.Models...),
				Voices:                append([]VoiceEntry(nil), doc.Voices...),
				VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), doc.VoiceWorkflowModels...),
				ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), doc.ModelWorkflowBindings...),
				VoiceHandlePolicies:   append([]VoiceHandlePolicy(nil), doc.VoiceHandlePolicies...),
			}
			if err := validateSnapshot(snapshot); err != nil {
				return ProviderDocument{}, err
			}
		}
	}

	if overlay &&
		len(doc.SelectionProfiles) == 0 &&
		len(doc.Models) == 0 &&
		len(doc.Voices) == 0 &&
		len(doc.VoiceWorkflowModels) == 0 &&
		len(doc.ModelWorkflowBindings) == 0 &&
		len(doc.VoiceHandlePolicies) == 0 &&
		strings.TrimSpace(doc.DefaultTextModel) == "" &&
		doc.DynamicInventory == nil {
		return ProviderDocument{}, errors.New("overlay provider document must not be empty")
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

func mergeEffectiveProviderDocuments(
	base map[string]ProviderDocument,
	shared map[string]overlayDocument,
	user map[string]overlayDocument,
) (map[string]mergedProviderDocument, error) {
	merged := make(map[string]mergedProviderDocument, len(base))
	for provider, baseDoc := range base {
		result, err := mergeProviderDocument(baseDoc, shared[provider], user[provider])
		if err != nil {
			return nil, err
		}
		merged[provider] = result
	}
	return merged, nil
}

func mergeProviderDocument(base ProviderDocument, overlays ...overlayDocument) (mergedProviderDocument, error) {
	modelsByID := make(map[string]ModelEntry, len(base.Models))
	modelSources := make(map[string]ModelSource, len(base.Models))
	userScopedModels := make(map[string]bool)
	builtinModelIDs := make(map[string]struct{}, len(base.Models))
	for _, model := range base.Models {
		key := normalizeID(model.ModelID)
		modelsByID[key] = model
		modelSources[key] = ModelSourceBuiltin
		builtinModelIDs[key] = struct{}{}
	}

	voicesByID := make(map[string]VoiceEntry, len(base.Voices))
	for _, voice := range base.Voices {
		voicesByID[voiceEntryKey(voice)] = voice
	}

	workflowModelsByID := make(map[string]VoiceWorkflowModel, len(base.VoiceWorkflowModels))
	for _, workflow := range base.VoiceWorkflowModels {
		workflowModelsByID[normalizeID(workflow.WorkflowModelID)] = workflow
	}
	handlePoliciesByID := make(map[string]VoiceHandlePolicy, len(base.VoiceHandlePolicies))
	for _, policy := range base.VoiceHandlePolicies {
		handlePoliciesByID[normalizeID(policy.PolicyID)] = policy
	}

	bindingsByModelID := make(map[string]ModelWorkflowBinding, len(base.ModelWorkflowBindings))
	for _, binding := range base.ModelWorkflowBindings {
		bindingsByModelID[normalizeID(binding.ModelID)] = binding
	}

	mergedDoc := cloneProviderDocument(base)
	customIDs := map[string]struct{}{}
	overriddenIDs := map[string]struct{}{}
	lastOverlayYAML := ""
	lastOverlayUpdatedAt := ""
	hasOverlay := false

	for _, overlay := range overlays {
		if overlay.doc.Provider == "" {
			continue
		}
		hasOverlay = true
		if strings.TrimSpace(overlay.doc.InventoryMode) != "" {
			mergedDoc.InventoryMode = strings.TrimSpace(overlay.doc.InventoryMode)
		}
		if overlay.doc.DynamicInventory != nil {
			mergedDoc.DynamicInventory = overlay.doc.DynamicInventory
		}
		if strings.TrimSpace(overlay.doc.DefaultTextModel) != "" {
			mergedDoc.DefaultTextModel = strings.TrimSpace(overlay.doc.DefaultTextModel)
		}
		if mergedDoc.Version <= 0 {
			mergedDoc.Version = overlay.doc.Version
		}
		if strings.TrimSpace(mergedDoc.CatalogVersion) == "" {
			mergedDoc.CatalogVersion = strings.TrimSpace(overlay.doc.CatalogVersion)
		}
		if strings.TrimSpace(overlay.doc.RawYAML) != "" {
			lastOverlayYAML = normalizeYAMLString(overlay.doc.RawYAML)
		}
		if strings.TrimSpace(overlay.updatedAt) != "" {
			lastOverlayUpdatedAt = strings.TrimSpace(overlay.updatedAt)
		}
		if len(overlay.doc.SelectionProfiles) > 0 {
			mergedDoc.SelectionProfiles = append([]SelectionProfile(nil), overlay.doc.SelectionProfiles...)
		}

		for _, model := range overlay.doc.Models {
			key := normalizeID(model.ModelID)
			if key == "" {
				continue
			}
			modelsByID[key] = model
			if overlay.userScoped {
				userScopedModels[key] = true
			} else {
				delete(userScopedModels, key)
			}
			if _, ok := builtinModelIDs[key]; ok {
				modelSources[key] = ModelSourceOverridden
				overriddenIDs[key] = struct{}{}
				delete(customIDs, key)
				continue
			}
			modelSources[key] = ModelSourceCustom
			customIDs[key] = struct{}{}
		}
		for _, voice := range overlay.doc.Voices {
			voicesByID[voiceEntryKey(voice)] = voice
		}
		for _, workflow := range overlay.doc.VoiceWorkflowModels {
			workflowModelsByID[normalizeID(workflow.WorkflowModelID)] = workflow
		}
		for _, binding := range overlay.doc.ModelWorkflowBindings {
			bindingsByModelID[normalizeID(binding.ModelID)] = binding
		}
		for _, policy := range overlay.doc.VoiceHandlePolicies {
			handlePoliciesByID[normalizeID(policy.PolicyID)] = policy
		}
	}

	mergedDoc.Models = mapValuesSorted(modelsByID, func(left, right ModelEntry) bool {
		leftID := strings.ToLower(strings.TrimSpace(left.ModelID))
		rightID := strings.ToLower(strings.TrimSpace(right.ModelID))
		if leftID == rightID {
			return strings.TrimSpace(left.UpdatedAt) > strings.TrimSpace(right.UpdatedAt)
		}
		return leftID < rightID
	})

	referencedVoiceSets := make(map[string]struct{}, len(mergedDoc.Models))
	for _, model := range mergedDoc.Models {
		if !modelRequiresVoice(model) {
			continue
		}
		setKey := normalizeProvider(model.Provider) + ":" + normalizeID(model.VoiceSetID)
		if setKey == ":" {
			continue
		}
		referencedVoiceSets[setKey] = struct{}{}
	}

	voiceItems := make([]VoiceEntry, 0, len(voicesByID))
	for _, voice := range voicesByID {
		if _, ok := referencedVoiceSets[normalizeProvider(voice.Provider)+":"+normalizeID(voice.VoiceSetID)]; !ok {
			continue
		}
		voiceItems = append(voiceItems, voice)
	}
	sort.Slice(voiceItems, func(i, j int) bool {
		leftKey := voiceEntryKey(voiceItems[i])
		rightKey := voiceEntryKey(voiceItems[j])
		return leftKey < rightKey
	})
	mergedDoc.Voices = voiceItems

	mergedDoc.VoiceWorkflowModels = mapValuesSorted(workflowModelsByID, func(left, right VoiceWorkflowModel) bool {
		return normalizeID(left.WorkflowModelID) < normalizeID(right.WorkflowModelID)
	})
	mergedDoc.ModelWorkflowBindings = mapValuesSorted(bindingsByModelID, func(left, right ModelWorkflowBinding) bool {
		return normalizeID(left.ModelID) < normalizeID(right.ModelID)
	})
	mergedDoc.VoiceHandlePolicies = mapValuesSorted(handlePoliciesByID, func(left, right VoiceHandlePolicy) bool {
		return normalizeID(left.PolicyID) < normalizeID(right.PolicyID)
	})

	snapshot := Snapshot{
		CatalogVersion:        mergedDoc.CatalogVersion,
		SelectionProfiles:     append([]SelectionProfile(nil), mergedDoc.SelectionProfiles...),
		Models:                append([]ModelEntry(nil), mergedDoc.Models...),
		Voices:                append([]VoiceEntry(nil), mergedDoc.Voices...),
		VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), mergedDoc.VoiceWorkflowModels...),
		ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), mergedDoc.ModelWorkflowBindings...),
		VoiceHandlePolicies:   append([]VoiceHandlePolicy(nil), mergedDoc.VoiceHandlePolicies...),
	}
	if strings.TrimSpace(mergedDoc.InventoryMode) != "dynamic_endpoint" {
		if err := validateSnapshot(snapshot); err != nil {
			return mergedProviderDocument{}, err
		}
	}

	effectiveYAML, err := marshalProviderDocumentYAML(mergedDoc)
	if err != nil {
		return mergedProviderDocument{}, err
	}

	source := ProviderSourceBuiltin
	if len(overriddenIDs) > 0 {
		source = ProviderSourceOverridden
	} else if hasOverlay {
		source = ProviderSourceCustom
	}

	return mergedProviderDocument{
		document:             mergedDoc,
		source:               source,
		modelSources:         modelSources,
		userScopedModels:     userScopedModels,
		customModelCount:     len(customIDs),
		overriddenModelCount: len(overriddenIDs),
		hasOverlay:           hasOverlay,
		overlayYAML:          lastOverlayYAML,
		effectiveYAML:        effectiveYAML,
		overlayUpdatedAt:     lastOverlayUpdatedAt,
	}, nil
}

func buildSnapshotFromProviderDocuments(providerDocs map[string]mergedProviderDocument) (Snapshot, error) {
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
	voiceHandlePolicies := make([]VoiceHandlePolicy, 0, 8)
	selectionProfiles := make([]SelectionProfile, 0, 8)
	versionTokens := make([]string, 0, len(providers))
	for _, provider := range providers {
		doc := providerDocs[provider].document
		selectionProfiles = append(selectionProfiles, doc.SelectionProfiles...)
		models = append(models, doc.Models...)
		voices = append(voices, doc.Voices...)
		voiceWorkflowModels = append(voiceWorkflowModels, doc.VoiceWorkflowModels...)
		modelWorkflowBindings = append(modelWorkflowBindings, doc.ModelWorkflowBindings...)
		voiceHandlePolicies = append(voiceHandlePolicies, doc.VoiceHandlePolicies...)
		versionTokens = append(versionTokens, provider+":"+firstNonEmpty(doc.CatalogVersion, "unknown"))
	}

	catalogVersion := strings.Join(versionTokens, ";")
	if len(providers) == 1 {
		catalogVersion = strings.TrimSpace(providerDocs[providers[0]].document.CatalogVersion)
	}
	if strings.TrimSpace(catalogVersion) == "" {
		catalogVersion = "unknown"
	}

	snapshot := Snapshot{
		CatalogVersion:        catalogVersion,
		SelectionProfiles:     selectionProfiles,
		Models:                models,
		Voices:                voices,
		VoiceWorkflowModels:   voiceWorkflowModels,
		ModelWorkflowBindings: modelWorkflowBindings,
		VoiceHandlePolicies:   voiceHandlePolicies,
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

func cloneProviderDocument(doc ProviderDocument) ProviderDocument {
	return ProviderDocument{
		Version:               doc.Version,
		Provider:              doc.Provider,
		CatalogVersion:        doc.CatalogVersion,
		InventoryMode:         doc.InventoryMode,
		DynamicInventory:      doc.DynamicInventory,
		DefaultTextModel:      doc.DefaultTextModel,
		SelectionProfiles:     append([]SelectionProfile(nil), doc.SelectionProfiles...),
		Models:                append([]ModelEntry(nil), doc.Models...),
		Voices:                append([]VoiceEntry(nil), doc.Voices...),
		VoiceWorkflowModels:   append([]VoiceWorkflowModel(nil), doc.VoiceWorkflowModels...),
		ModelWorkflowBindings: append([]ModelWorkflowBinding(nil), doc.ModelWorkflowBindings...),
		VoiceHandlePolicies:   append([]VoiceHandlePolicy(nil), doc.VoiceHandlePolicies...),
		RawYAML:               doc.RawYAML,
	}
}

func voiceEntryKey(entry VoiceEntry) string {
	return normalizeProvider(entry.Provider) + ":" + normalizeID(entry.VoiceSetID) + ":" + strings.ToLower(strings.TrimSpace(entry.VoiceID))
}

func mapValuesSorted[T any](items map[string]T, less func(left, right T) bool) []T {
	out := make([]T, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool {
		return less(out[i], out[j])
	})
	return out
}
