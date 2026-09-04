package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	modelIndexBaseURLEnv      = "NIMI_MODEL_INDEX_BASE_URL"
	defaultModelIndexBaseURL  = "https://models.nimi.ai"
	modelIndexCacheFile       = "model-index-v3-cache.json"
	modelIndexDefaultPageSize = 40
	modelIndexMaxPageSize     = 80
	modelIndexFetchTimeout    = 5 * time.Second
	modelIndexFreshWindow     = 24 * time.Hour
	modelIndexSchemaVersion   = "3.0.0"
)

var modelIndexPresentationCategories = map[string]struct{}{
	"chat":  {},
	"image": {},
	"video": {},
}

var modelIndexGenerationPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type remoteModelIndexSource struct {
	Provider string
	Formats  []string
	Strategy string
}

type remoteModelFile struct {
	Path        string
	SizeBytes   int64
	DownloadURL string
	SHA256      string
}

type remoteInstallEntry struct {
	EntryID        string
	Format         string
	Entry          string
	Files          []remoteModelFile
	TotalSizeBytes int64
	SHA256         string
	Quantization   string
	BitsPerWeight  float64
	Quality        string
}

type remoteModelEntry struct {
	Repo            string
	Author          string
	Title           string
	ModelName       string
	Description     string
	Revision        string
	License         string
	Categories      []string
	Tags            []string
	Formats         []string
	ParameterCount  float64
	Architecture    string
	ContextLength   int64
	PipelineTag     string
	Downloads       int64
	Likes           int64
	LastModified    string
	Entries         []remoteInstallEntry
	FeaturedOrdinal *int32
	EditorialReason string
}

type remoteModelIndex struct {
	SchemaVersion   string
	Generation      string
	GeneratedAt     string
	ModelCount      int
	Source          remoteModelIndexSource
	SelectionPolicy json.RawMessage
	Build           json.RawMessage
	Models          []remoteModelEntry
}

type modelIndexCacheRecord struct {
	FetchedAt string
	Index     *remoteModelIndex
	Stale     bool
}

func (s *Service) ListFeaturedModelAssets(ctx context.Context, req *runtimev1.ListFeaturedModelAssetsRequest) (*runtimev1.ListFeaturedModelAssetsResponse, error) {
	category, err := normalizeModelIndexCategory(req.GetCategory())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "featured ModelAsset category is invalid"})
	}
	pageSize := normalizeModelIndexPageSize(req.GetPageSize())
	index, freshness, reason := s.resolveModelIndex(ctx)
	if index == nil {
		return &runtimev1.ListFeaturedModelAssetsResponse{
			Source: &runtimev1.ModelAssetFeaturedSourceObservation{
				Availability: runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_UNAVAILABLE,
				ReasonCode:   reason,
			},
			Items: []*runtimev1.ModelAssetMarketCandidate{},
		}, nil
	}
	offers, err := modelIndexOffers(index)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_CATALOG_SCHEMA_INVALID, err, grpcerr.ReasonOptions{Message: "adopted model-index generation is invalid"})
	}
	items := make([]*runtimev1.ModelAssetMarketCandidate, 0, pageSize)
	for _, offer := range offers {
		if !stringSetContains(offer.categories, category) {
			continue
		}
		items = append(items, s.projectMarketCandidate(offer))
		if len(items) == pageSize {
			break
		}
	}
	return &runtimev1.ListFeaturedModelAssetsResponse{
		Source: &runtimev1.ModelAssetFeaturedSourceObservation{
			Availability: runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_AVAILABLE,
			Freshness:    freshness,
			Generation:   strings.TrimSpace(index.Generation),
			ReasonCode:   reason,
		},
		Items: items,
	}, nil
}

func normalizeModelIndexCategory(value string) (string, error) {
	category := strings.ToLower(strings.TrimSpace(value))
	if _, ok := modelIndexPresentationCategories[category]; !ok {
		return "", fmt.Errorf("unsupported presentation category %q", value)
	}
	return category, nil
}

func normalizeModelIndexPageSize(value int32) int {
	if value <= 0 {
		return modelIndexDefaultPageSize
	}
	if value > modelIndexMaxPageSize {
		return modelIndexMaxPageSize
	}
	return int(value)
}

func (s *Service) resolveModelIndex(ctx context.Context) (*remoteModelIndex, runtimev1.ModelAssetSourceFreshness, runtimev1.ReasonCode) {
	s.modelIndexRefreshMu.Lock()
	defer s.modelIndexRefreshMu.Unlock()

	cache := s.loadModelIndexCache()
	fetched, fetchErr := fetchModelIndex(ctx, modelIndexBaseURL())
	if fetchErr == nil {
		if validationErr := validateRemoteModelIndex(fetched, cache.Index); validationErr == nil {
			if cache.Index != nil && fetched.Generation == cache.Index.Generation {
				if !cache.Stale && modelIndexSnapshotFresh(cache.Index.GeneratedAt) {
					return cache.Index, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_FRESH, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
				}
				s.markModelIndexCacheStale(cache)
				return cache.Index, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE
			}
			if saveErr := s.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: fetched}); saveErr != nil {
				if cache.Index != nil {
					s.markModelIndexCacheStale(cache)
					return cache.Index, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE
				}
				return nil, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_UNSPECIFIED, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE
			}
			if modelIndexSnapshotFresh(fetched.GeneratedAt) {
				return fetched, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_FRESH, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
			}
			return fetched, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE
		}
	}
	if cache.Index != nil && validateRemoteModelIndex(cache.Index, nil) == nil {
		s.markModelIndexCacheStale(cache)
		return cache.Index, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE, runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE
	}
	return nil, runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_UNSPECIFIED, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE
}

func (s *Service) markModelIndexCacheStale(cache modelIndexCacheRecord) {
	if cache.Index == nil || cache.Stale {
		return
	}
	cache.Stale = true
	_ = s.saveModelIndexCache(cache)
}

func modelIndexSnapshotFresh(generatedAt string) bool {
	generated, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(generatedAt))
	if err != nil {
		return false
	}
	age := time.Since(generated)
	return age >= 0 && age < modelIndexFreshWindow
}

func validateRemoteModelIndex(index *remoteModelIndex, previous *remoteModelIndex) error {
	if index == nil || strings.TrimSpace(index.SchemaVersion) != modelIndexSchemaVersion {
		return fmt.Errorf("model-index schemaVersion must be %s", modelIndexSchemaVersion)
	}
	if !modelIndexGenerationPattern.MatchString(strings.TrimSpace(index.Generation)) {
		return fmt.Errorf("model-index generation must be a lowercase UUID v4")
	}
	if _, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(index.GeneratedAt)); err != nil {
		return fmt.Errorf("model-index generatedAt is invalid: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(index.Source.Provider), "huggingface") {
		return fmt.Errorf("model-index source provider is invalid")
	}
	if index.ModelCount != len(index.Models) {
		return fmt.Errorf("model-index modelCount does not match models")
	}
	offers, err := modelIndexOffers(index)
	if err != nil {
		return err
	}
	if previous == nil {
		return nil
	}
	currentGeneratedAt, _ := time.Parse(time.RFC3339Nano, strings.TrimSpace(index.GeneratedAt))
	previousGeneratedAt, previousTimeErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(previous.GeneratedAt))
	if previousTimeErr == nil {
		if index.Generation == previous.Generation {
			if !reflect.DeepEqual(index, previous) {
				return fmt.Errorf("model-index generation mutated without a new identity")
			}
		} else if !currentGeneratedAt.After(previousGeneratedAt) {
			return fmt.Errorf("model-index generation rollback is not allowed")
		}
	}
	previousOffers, err := modelIndexOffers(previous)
	if err != nil {
		return nil
	}
	previousByRef := make(map[string]catalogOffer, len(previousOffers))
	for _, offer := range previousOffers {
		previousByRef[offer.offerRef] = offer
	}
	for _, offer := range offers {
		if prior, ok := previousByRef[offer.offerRef]; ok && !reflect.DeepEqual(canonicalOfferFacts(prior), canonicalOfferFacts(offer)) {
			return fmt.Errorf("model-index offer_ref collision for %s", offer.offerRef)
		}
	}
	return nil
}

func modelIndexOffers(index *remoteModelIndex) ([]catalogOffer, error) {
	if index == nil {
		return nil, nil
	}
	result := make([]catalogOffer, 0)
	seen := map[string][]string{}
	for modelIndex := range index.Models {
		model := index.Models[modelIndex]
		categories := normalizeStringSlice(model.Categories)
		if len(categories) == 0 {
			return nil, fmt.Errorf("model-index model %q has no categories", model.Repo)
		}
		for _, category := range categories {
			if _, ok := modelIndexPresentationCategories[category]; !ok {
				return nil, fmt.Errorf("model-index model %q has unknown category %q", model.Repo, category)
			}
		}
		if strings.TrimSpace(model.Repo) == "" || !hfCommitRevisionPattern.MatchString(strings.TrimSpace(model.Revision)) {
			return nil, fmt.Errorf("model-index model identity is incomplete")
		}
		if model.FeaturedOrdinal != nil && *model.FeaturedOrdinal < 0 {
			return nil, fmt.Errorf("model-index featured ordinal is invalid")
		}
		if (model.FeaturedOrdinal != nil) != (strings.TrimSpace(model.EditorialReason) != "") {
			return nil, fmt.Errorf("model-index featured ordinal and editorial reason must appear together")
		}
		capabilities := inferCapabilitiesFromHF(model.PipelineTag, model.Tags)
		modelType := catalogModelTypeForAssetKind(inferAssetKindFromCapabilities(capabilities))
		for entryIndex := range model.Entries {
			entry := model.Entries[entryIndex]
			if strings.TrimSpace(entry.EntryID) == "" || strings.TrimSpace(entry.Entry) == "" || len(entry.Files) == 0 {
				return nil, fmt.Errorf("model-index entry identity is incomplete")
			}
			files := make([]string, 0, len(entry.Files))
			hashes := make(map[string]string, len(entry.Files))
			var total int64
			for _, file := range entry.Files {
				path := strings.TrimSpace(file.Path)
				hash := normalizeExactSHA256Hex(file.SHA256)
				if path == "" || file.SizeBytes < 0 {
					return nil, fmt.Errorf("model-index entry %q has invalid file facts", entry.EntryID)
				}
				files = append(files, path)
				if hash != "" {
					hashes[path] = hash
				}
				total += file.SizeBytes
			}
			if entry.TotalSizeBytes <= 0 || total != entry.TotalSizeBytes {
				return nil, fmt.Errorf("model-index entry %q total size is invalid", entry.EntryID)
			}
			identity := modelAssetOfferIdentity{
				sourceKind: "model-index",
				locator:    strings.TrimSpace(model.Repo),
				revision:   strings.TrimSpace(model.Revision),
				entryID:    strings.TrimSpace(entry.EntryID),
			}
			offerRef, err := newModelAssetOfferRef(identity)
			if err != nil {
				return nil, err
			}
			offer := catalogOffer{
				identity:         identity,
				entryPath:        strings.TrimSpace(entry.Entry),
				offerRef:         offerRef,
				modelID:          strings.TrimSpace(model.Repo),
				title:            defaultString(model.Title, model.Repo),
				description:      strings.TrimSpace(model.Description),
				categories:       categories,
				capabilities:     capabilities,
				modelType:        modelType,
				architecture:     strings.TrimSpace(model.Architecture),
				format:           defaultString(entry.Format, catalogOfferFormat(entry.Entry)),
				author:           strings.TrimSpace(model.Author),
				files:            files,
				hashes:           hashes,
				totalSizeBytes:   entry.TotalSizeBytes,
				license:          strings.TrimSpace(model.License),
				tags:             normalizeStringSlice(model.Tags),
				downloads:        model.Downloads,
				likes:            model.Likes,
				lastModified:     strings.TrimSpace(model.LastModified),
				sourceProvenance: "model-index",
				featuredOrdinal:  model.FeaturedOrdinal,
				editorialReason:  strings.TrimSpace(model.EditorialReason),
			}
			facts := canonicalOfferFacts(offer)
			if prior, exists := seen[offerRef]; exists && !reflect.DeepEqual(prior, facts) {
				return nil, fmt.Errorf("model-index generation contains colliding offer_ref %s", offerRef)
			}
			seen[offerRef] = facts
			result = append(result, offer)
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		left, right := result[i], result[j]
		if (left.featuredOrdinal == nil) != (right.featuredOrdinal == nil) {
			return left.featuredOrdinal != nil
		}
		if left.featuredOrdinal != nil && right.featuredOrdinal != nil && *left.featuredOrdinal != *right.featuredOrdinal {
			return *left.featuredOrdinal < *right.featuredOrdinal
		}
		if left.downloads != right.downloads {
			return left.downloads > right.downloads
		}
		if left.likes != right.likes {
			return left.likes > right.likes
		}
		return left.offerRef < right.offerRef
	})
	return result, nil
}

func stringSetContains(values []string, expected string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(expected)) {
			return true
		}
	}
	return false
}

func (s *Service) modelIndexOfferByRef(offerRef string) (catalogOffer, bool) {
	cache := s.loadModelIndexCache()
	if cache.Index == nil {
		return catalogOffer{}, false
	}
	offers, err := modelIndexOffers(cache.Index)
	if err != nil {
		return catalogOffer{}, false
	}
	for _, offer := range offers {
		if offer.offerRef == strings.TrimSpace(offerRef) {
			return offer.clone(), true
		}
	}
	return catalogOffer{}, false
}

func (s *Service) modelIndexOffersForLocator(locator string, revision string) []catalogOffer {
	cache := s.loadModelIndexCache()
	if cache.Index == nil {
		return nil
	}
	offers, err := modelIndexOffers(cache.Index)
	if err != nil {
		return nil
	}
	result := make([]catalogOffer, 0)
	for _, offer := range offers {
		if offer.identity.locator == strings.TrimSpace(locator) && offer.identity.revision == strings.TrimSpace(revision) {
			result = append(result, offer.clone())
		}
	}
	return result
}

func (s *Service) modelIndexCachePath() string {
	if statePath := strings.TrimSpace(s.stateStorePath); statePath != "" {
		return filepath.Join(filepath.Dir(statePath), modelIndexCacheFile)
	}
	if modelsPath := strings.TrimSpace(s.localModelsPathSnapshot()); modelsPath != "" {
		return filepath.Join(filepath.Dir(modelsPath), modelIndexCacheFile)
	}
	if cacheRoot, err := os.UserCacheDir(); err == nil && strings.TrimSpace(cacheRoot) != "" {
		return filepath.Join(cacheRoot, "nimi", "runtime", modelIndexCacheFile)
	}
	return ""
}

func (s *Service) loadModelIndexCache() modelIndexCacheRecord {
	path := s.modelIndexCachePath()
	if path == "" {
		return modelIndexCacheRecord{}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return modelIndexCacheRecord{}
	}
	var cache modelIndexCacheRecord
	if err := json.Unmarshal(raw, &cache); err != nil || validateRemoteModelIndex(cache.Index, nil) != nil {
		return modelIndexCacheRecord{}
	}
	return cache
}

func (s *Service) saveModelIndexCache(cache modelIndexCacheRecord) error {
	path := s.modelIndexCachePath()
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}
	if s != nil && s.modelIndexCacheWrite != nil {
		return s.modelIndexCacheWrite(path, raw)
	}
	return writeModelIndexCacheAtomically(path, raw)
}

func writeModelIndexCacheAtomically(path string, raw []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".model-index-v3-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if err := temp.Chmod(0o644); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func modelIndexBaseURL() string {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv(modelIndexBaseURLEnv)), "/")
	if baseURL == "" {
		return defaultModelIndexBaseURL
	}
	return baseURL
}

func fetchModelIndex(ctx context.Context, baseURL string) (index *remoteModelIndex, err error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/") + "/index.json")
	if err != nil {
		return nil, err
	}
	fetchCtx, cancel := context.WithTimeout(ctx, modelIndexFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		closeErr := resp.Body.Close()
		if err == nil && closeErr != nil {
			err = closeErr
		}
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("model index status %d", resp.StatusCode)
	}
	var result remoteModelIndex
	decoder := json.NewDecoder(resp.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}
