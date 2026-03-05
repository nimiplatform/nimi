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
	"gopkg.in/yaml.v3"
)

const providerFileExt = ".yaml"

var supportedProviderSet = map[string]struct{}{
	"dashscope": {},
	"openai":    {},
	"volcengine": {},
}

var supportedProvidersOrdered = []string{"dashscope", "openai", "volcengine"}

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
		Version:        parsed.Version,
		Provider:       provider,
		CatalogVersion: strings.TrimSpace(parsed.CatalogVersion),
		Models:         append([]ModelEntry(nil), parsed.Models...),
		Voices:         append([]VoiceEntry(nil), parsed.Voices...),
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
	for i := range doc.Voices {
		entryProvider := normalizeProvider(doc.Voices[i].Provider)
		if entryProvider != "" && entryProvider != provider {
			return ProviderDocument{}, fmt.Errorf("voice %q provider mismatch: expected %q", doc.Voices[i].VoiceID, provider)
		}
		doc.Voices[i].Provider = provider
	}

	snapshot := Snapshot{
		CatalogVersion: doc.CatalogVersion,
		Models:         append([]ModelEntry(nil), doc.Models...),
		Voices:         append([]VoiceEntry(nil), doc.Voices...),
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

func parseRemoteBundleYAML(raw []byte) (map[string]ProviderDocument, error) {
	var bundle RemoteBundle
	if err := yaml.Unmarshal(raw, &bundle); err != nil {
		return nil, err
	}
	if len(bundle.Providers) == 0 {
		return nil, errors.New("remote catalog providers must not be empty")
	}
	providers := make(map[string]ProviderDocument, len(bundle.Providers))
	for _, candidate := range bundle.Providers {
		doc, err := normalizeProviderDocument(candidate, candidate.Provider+providerFileExt)
		if err != nil {
			return nil, err
		}
		rawDoc, err := yaml.Marshal(doc)
		if err != nil {
			return nil, err
		}
		doc.RawYAML = normalizeYAMLString(string(rawDoc))
		providers[doc.Provider] = doc
	}
	return providers, nil
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
	versionTokens := make([]string, 0, len(providers))
	for _, provider := range providers {
		doc := providerDocs[provider]
		models = append(models, doc.Models...)
		voices = append(voices, doc.Voices...)
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
		CatalogVersion: catalogVersion,
		Models:         models,
		Voices:         voices,
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
	if len(snapshot.Voices) == 0 {
		return errors.New("voices must not be empty")
	}

	allowedUnits := map[string]struct{}{
		"token":   {},
		"char":    {},
		"second":  {},
		"request": {},
	}

	modelSet := make(map[string]ModelEntry, len(snapshot.Models))
	voiceSetRefs := make(map[string]struct{}, len(snapshot.Models))
	for _, model := range snapshot.Models {
		provider := normalizeProvider(model.Provider)
		modelID := normalizeID(model.ModelID)
		if provider == "" || modelID == "" {
			return fmt.Errorf("model entry missing provider/model_id")
		}
		if !isSupportedProvider(provider) {
			return fmt.Errorf("unsupported provider %q in model entry", provider)
		}
		if strings.TrimSpace(model.ModelType) == "" {
			return fmt.Errorf("model %s:%s missing model_type", provider, modelID)
		}
		if strings.TrimSpace(model.VoiceSetID) == "" {
			return fmt.Errorf("model %s:%s missing voice_set_id", provider, modelID)
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
		voiceSetRefs[provider+":"+normalizeID(model.VoiceSetID)] = struct{}{}
	}

	seenVoice := make(map[string]struct{}, len(snapshot.Voices))
	for _, voice := range snapshot.Voices {
		provider := normalizeProvider(voice.Provider)
		voiceSetID := normalizeID(voice.VoiceSetID)
		voiceID := strings.TrimSpace(voice.VoiceID)
		if provider == "" || voiceSetID == "" || voiceID == "" {
			return fmt.Errorf("voice entry missing provider/voice_set_id/voice_id")
		}
		if !isSupportedProvider(provider) {
			return fmt.Errorf("unsupported provider %q in voice entry", provider)
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
			if _, ok := modelSet[provider+":"+modelID]; !ok {
				return fmt.Errorf("voice %s:%s references unknown model %s", provider, voiceID, modelID)
			}
		}
		voiceKey := provider + ":" + voiceSetID + ":" + strings.ToLower(voiceID)
		if _, exists := seenVoice[voiceKey]; exists {
			return fmt.Errorf("duplicate voice entry %s", voiceKey)
		}
		seenVoice[voiceKey] = struct{}{}
	}

	return nil
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
