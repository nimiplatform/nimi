package catalog

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultRefreshInterval  = 15 * time.Minute
	defaultHTTPTimeout      = 10 * time.Second
	defaultMaxRemotePayload = int64(2 * 1024 * 1024) // 2 MiB
)

type indexedSnapshot struct {
	catalogVersion string
	models         map[string]map[string]ModelEntry
	voicesBySet    map[string][]VoiceEntry
}

type Resolver struct {
	mu sync.RWMutex

	logger *slog.Logger

	snapshot         *indexedSnapshot
	source           CatalogSource
	builtInProviders map[string]ProviderDocument
	customProviders  map[string]ProviderDocument
	remoteProviders  map[string]ProviderDocument
	effective        map[string]ProviderDocument
	sourcesByProvider map[string]ProviderSource

	customDir string

	remoteETag  string
	cachePath   string
	remoteURL   string
	httpClient  *http.Client
	maxBodySize int64

	refreshInterval time.Duration
	remoteEnabled   bool
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

	refreshInterval := cfg.RefreshInterval
	if refreshInterval <= 0 {
		refreshInterval = defaultRefreshInterval
	}
	httpTimeout := cfg.HTTPTimeout
	if httpTimeout <= 0 {
		httpTimeout = defaultHTTPTimeout
	}
	maxBodySize := cfg.MaxRemotePayloadLen
	if maxBodySize <= 0 {
		maxBodySize = defaultMaxRemotePayload
	}

	resolver := &Resolver{
		logger:            logger,
		builtInProviders:  builtInProviders,
		customProviders:   map[string]ProviderDocument{},
		remoteProviders:   map[string]ProviderDocument{},
		effective:         map[string]ProviderDocument{},
		sourcesByProvider: map[string]ProviderSource{},
		customDir:         strings.TrimSpace(cfg.CustomDir),
		cachePath:         strings.TrimSpace(cfg.CachePath),
		remoteURL:         strings.TrimSpace(cfg.RemoteURL),
		httpClient:        &http.Client{Timeout: httpTimeout},
		maxBodySize:       maxBodySize,
		refreshInterval:   refreshInterval,
		remoteEnabled:     cfg.RemoteEnabled,
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

	if resolver.remoteEnabled {
		if resolver.cachePath != "" {
			if cacheRaw, readErr := os.ReadFile(resolver.cachePath); readErr == nil {
				if remoteProviders, parseErr := parseRemoteBundleYAML(cacheRaw); parseErr == nil {
					resolver.remoteProviders = remoteProviders
					if recomputeErr := resolver.recomputeSnapshotLocked(); recomputeErr != nil {
						resolver.logger.Warn("catalog remote cache ignored", "path", resolver.cachePath, "error", recomputeErr)
						resolver.remoteProviders = map[string]ProviderDocument{}
						_ = resolver.recomputeSnapshotLocked()
					}
				} else {
					resolver.logger.Warn("catalog remote cache parse failed", "path", resolver.cachePath, "error", parseErr)
				}
			} else if !os.IsNotExist(readErr) {
				resolver.logger.Warn("catalog remote cache load failed", "path", resolver.cachePath, "error", readErr)
			}
			resolver.remoteETag = strings.TrimSpace(loadCachedETag(resolver.cachePath))
		}
		if resolver.remoteURL == "" {
			resolver.logger.Warn("catalog remote enabled but url is empty")
		} else {
			go resolver.runRemoteRefreshLoop()
		}
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

	providerModels := snapshot.models[provider]
	if len(providerModels) == 0 {
		return ResolveVoicesResult{}, ErrModelNotFound
	}

	modelEntry, ok := providerModels[normalizedModel]
	if !ok {
		base := modelIDBase(normalizedModel)
		modelEntry, ok = providerModels[base]
	}
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
	if !isSupportedProvider(candidate.Provider) {
		return CatalogProviderRecord{}, fmt.Errorf("%w: %s", ErrProviderUnsupported, candidate.Provider)
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
	if !isSupportedProvider(normalized) {
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
	merged := mergeProviderDocuments(r.builtInProviders, r.customProviders, r.remoteProviders)
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
	for provider := range r.remoteProviders {
		sources[provider] = ProviderSourceRemote
	}

	r.snapshot = indexed
	r.effective = merged
	r.sourcesByProvider = sources
	switch {
	case len(r.remoteProviders) > 0:
		r.source = SourceRemoteCache
	case len(r.customProviders) > 0:
		r.source = SourceCustomDir
	default:
		r.source = SourceBuiltinSnapshot
	}
	return nil
}

func buildIndexedSnapshot(snapshot Snapshot) (*indexedSnapshot, error) {
	if err := validateSnapshot(snapshot); err != nil {
		return nil, err
	}
	indexed := &indexedSnapshot{
		catalogVersion: strings.TrimSpace(snapshot.CatalogVersion),
		models:         make(map[string]map[string]ModelEntry),
		voicesBySet:    make(map[string][]VoiceEntry),
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
	switch {
	case strings.HasPrefix(normalized, "dashscope/"):
		return "dashscope"
	case strings.Contains(normalized, "qwen3-tts"), strings.Contains(normalized, "qwen-tts"):
		return "dashscope"
	case strings.HasPrefix(normalized, "openai/"):
		return "openai"
	case strings.Contains(normalized, "gpt-audio"), strings.HasPrefix(normalized, "tts-1"):
		return "openai"
	case strings.HasPrefix(normalized, "volcengine/"):
		return "volcengine"
	case strings.Contains(normalized, "doubao-tts"), strings.Contains(normalized, "bv001_streaming"), strings.Contains(normalized, "bv002_streaming"):
		return "volcengine"
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

func (r *Resolver) runRemoteRefreshLoop() {
	if err := r.refreshRemote(context.Background()); err != nil {
		r.logger.Warn("catalog remote refresh failed", "error", err)
	}

	ticker := time.NewTicker(r.refreshInterval)
	defer ticker.Stop()
	for range ticker.C {
		if err := r.refreshRemote(context.Background()); err != nil {
			r.logger.Warn("catalog remote refresh failed", "error", err)
		}
	}
}

func (r *Resolver) refreshRemote(ctx context.Context) error {
	parsedURL, err := url.Parse(r.remoteURL)
	if err != nil {
		return fmt.Errorf("parse remote url: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(parsedURL.Scheme), "https") {
		return fmt.Errorf("remote catalog url must use https")
	}
	if strings.TrimSpace(parsedURL.Host) == "" {
		return fmt.Errorf("remote catalog url must include host")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
	if err != nil {
		return fmt.Errorf("build remote request: %w", err)
	}

	r.mu.RLock()
	etag := strings.TrimSpace(r.remoteETag)
	r.mu.RUnlock()
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("remote request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("remote request returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, r.maxBodySize+1))
	if err != nil {
		return fmt.Errorf("read remote body: %w", err)
	}
	if int64(len(body)) > r.maxBodySize {
		return fmt.Errorf("remote payload exceeds limit %d bytes", r.maxBodySize)
	}

	remoteProviders, err := parseRemoteBundleYAML(body)
	if err != nil {
		return fmt.Errorf("parse remote catalog: %w", err)
	}

	r.mu.Lock()
	r.remoteProviders = remoteProviders
	if err := r.recomputeSnapshotLocked(); err != nil {
		r.mu.Unlock()
		return fmt.Errorf("apply remote catalog: %w", err)
	}
	newETag := strings.TrimSpace(resp.Header.Get("ETag"))
	r.remoteETag = newETag
	r.mu.Unlock()

	if r.cachePath != "" {
		if writeErr := writeCacheFile(r.cachePath, body); writeErr != nil {
			r.logger.Warn("catalog cache write failed", "path", r.cachePath, "error", writeErr)
		}
		if newETag != "" {
			if writeErr := writeCachedETag(r.cachePath, newETag); writeErr != nil {
				r.logger.Warn("catalog etag cache write failed", "path", r.cachePath, "error", writeErr)
			}
		}
	}

	return nil
}

func writeCacheFile(path string, body []byte) error {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}

func etagCachePath(cachePath string) string {
	return cachePath + ".etag"
}

func writeCachedETag(cachePath string, etag string) error {
	if strings.TrimSpace(cachePath) == "" {
		return nil
	}
	return os.WriteFile(etagCachePath(cachePath), []byte(strings.TrimSpace(etag)), 0o600)
}

func loadCachedETag(cachePath string) string {
	if strings.TrimSpace(cachePath) == "" {
		return ""
	}
	content, err := os.ReadFile(etagCachePath(cachePath))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(content))
}
