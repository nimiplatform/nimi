package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	hfCatalogEndpoint          = "https://huggingface.co/api/models"
	hfCatalogTimeout           = 20 * time.Second
	hfCatalogDefaultLimit      = 50
	hfCatalogMinLimit          = 1
	hfCatalogMaxLimit          = 80
	hfCatalogMaxBodyBytes      = 4 << 20
	hfCatalogUserAgent         = "nimi-runtime/0.1"
	hfImmutableCacheTTL        = 5 * time.Minute
	hfImmutableCacheMaxEntries = 64
)

var errHFRepoNotFound = errors.New("hf repo not found")

type hfVariantsCacheEntry struct {
	variants  []hfCatalogVariant
	expiresAt time.Time
}

type hfCheckpointLayoutCacheEntry struct {
	layout    capabilitydriver.DiffusionCheckpointLayout
	expiresAt time.Time
}

func (s *Service) hfHTTPClient() *http.Client {
	s.hfHTTPClientOnce.Do(func() {
		s.hfHTTPClientInstance = &http.Client{Timeout: hfCatalogTimeout}
	})
	return s.hfHTTPClientInstance
}

func (s *Service) hfCatalogEndpointURL() string {
	s.mu.RLock()
	endpoint := strings.TrimSpace(s.hfCatalogEndpoint)
	s.mu.RUnlock()
	return defaultString(endpoint, hfCatalogEndpoint)
}

func hfRateLimitedRPCError(err error, retryAfter time.Duration, message string) error {
	retryable := true
	metadata := map[string]string{}
	if seconds := int64(math.Ceil(retryAfter.Seconds())); seconds > 0 {
		metadata["retry_after_seconds"] = strconv.FormatInt(seconds, 10)
	}
	return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, err, grpcerr.ReasonOptions{
		ActionHint: "retry_after_rate_limit_window",
		Retryable:  &retryable,
		Message:    message,
		Metadata:   metadata,
	})
}

func hfCatalogRPCError(err error, message string) error {
	var rateLimit *filedownload.RateLimitError
	if errors.As(err, &rateLimit) {
		return hfRateLimitedRPCError(err, rateLimit.RetryAfter, message)
	}
	return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: message})
}

func cloneHFCatalogVariants(items []hfCatalogVariant) []hfCatalogVariant {
	if len(items) == 0 {
		return nil
	}
	cloned := make([]hfCatalogVariant, len(items))
	for i, item := range items {
		item.Files = append([]string(nil), item.Files...)
		item.Hashes = cloneStringMap(item.Hashes)
		item.Categories = append([]string(nil), item.Categories...)
		item.Capabilities = append([]string(nil), item.Capabilities...)
		item.Tags = append([]string(nil), item.Tags...)
		cloned[i] = item
	}
	return cloned
}

func (s *Service) getCachedHFVariants(key string, now time.Time) ([]hfCatalogVariant, bool) {
	s.hfCacheMu.Lock()
	defer s.hfCacheMu.Unlock()
	entry, ok := s.hfVariantsCache[key]
	if !ok {
		return nil, false
	}
	if !now.Before(entry.expiresAt) {
		delete(s.hfVariantsCache, key)
		return nil, false
	}
	return cloneHFCatalogVariants(entry.variants), true
}

func (s *Service) putCachedHFVariants(key string, variants []hfCatalogVariant, now time.Time) {
	s.hfCacheMu.Lock()
	defer s.hfCacheMu.Unlock()
	if s.hfVariantsCache == nil {
		s.hfVariantsCache = make(map[string]hfVariantsCacheEntry)
	}
	if len(s.hfVariantsCache) >= hfImmutableCacheMaxEntries {
		var oldestKey string
		var oldestTime time.Time
		for k, v := range s.hfVariantsCache {
			if !now.Before(v.expiresAt) {
				delete(s.hfVariantsCache, k)
				continue
			}
			if oldestKey == "" || v.expiresAt.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.expiresAt
			}
		}
		if len(s.hfVariantsCache) >= hfImmutableCacheMaxEntries && oldestKey != "" {
			delete(s.hfVariantsCache, oldestKey)
		}
	}
	s.hfVariantsCache[key] = hfVariantsCacheEntry{
		variants:  cloneHFCatalogVariants(variants),
		expiresAt: now.Add(hfImmutableCacheTTL),
	}
}

func (s *Service) getCachedHFCheckpointLayout(key string, now time.Time) (capabilitydriver.DiffusionCheckpointLayout, bool) {
	s.hfCacheMu.Lock()
	defer s.hfCacheMu.Unlock()
	entry, ok := s.hfCheckpointLayoutCache[key]
	if !ok {
		return capabilitydriver.DiffusionCheckpointLayoutNone, false
	}
	if !now.Before(entry.expiresAt) {
		delete(s.hfCheckpointLayoutCache, key)
		return capabilitydriver.DiffusionCheckpointLayoutNone, false
	}
	return entry.layout, true
}

func (s *Service) putCachedHFCheckpointLayout(key string, layout capabilitydriver.DiffusionCheckpointLayout, now time.Time) {
	s.hfCacheMu.Lock()
	defer s.hfCacheMu.Unlock()
	if s.hfCheckpointLayoutCache == nil {
		s.hfCheckpointLayoutCache = make(map[string]hfCheckpointLayoutCacheEntry)
	}
	if len(s.hfCheckpointLayoutCache) >= hfImmutableCacheMaxEntries {
		var oldestKey string
		var oldestTime time.Time
		for k, v := range s.hfCheckpointLayoutCache {
			if !now.Before(v.expiresAt) {
				delete(s.hfCheckpointLayoutCache, k)
				continue
			}
			if oldestKey == "" || v.expiresAt.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.expiresAt
			}
		}
		if len(s.hfCheckpointLayoutCache) >= hfImmutableCacheMaxEntries && oldestKey != "" {
			delete(s.hfCheckpointLayoutCache, oldestKey)
		}
	}
	s.hfCheckpointLayoutCache[key] = hfCheckpointLayoutCacheEntry{
		layout:    layout,
		expiresAt: now.Add(hfImmutableCacheTTL),
	}
}

var hfCommitRevisionPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var hfNumberedWeightFile = regexp.MustCompile(`(?i)-([0-9]+)-of-([0-9]+)\.(gguf|gguf_file|safetensors)$`)

func isHFWeightShard(entry string) bool {
	parts := hfNumberedWeightFile.FindStringSubmatch(entry)
	return len(parts) > 0 && (strings.TrimLeft(parts[1], "0") != "1" || strings.TrimLeft(parts[2], "0") != "1")
}

// Resolve only the variant the user is reviewing. A model listing can contain
// hundreds of component files; browsing it must never fetch their weights.
// @nimi-authority: rule.nimi.runtime.local-compute.r015
func (s *Service) resolveSingleFileCheckpoint(ctx context.Context, identity modelAssetOfferIdentity, variant *hfCatalogVariant) error {
	hash := normalizeExactSHA256Hex(variant.SHA256)
	if hash == "" || variant.SizeBytes < 10 || isHFWeightShard(variant.Entry) {
		return nil
	}
	base := defaultString(s.hfDownloadBaseURL, defaultHFDownloadBaseURL)
	cacheKey := strings.Join([]string{base, identity.locator, identity.revision, variant.Entry, strconv.FormatInt(variant.SizeBytes, 10), hash}, "\x00")
	now := time.Now()
	layout, cached := s.getCachedHFCheckpointLayout(cacheKey, now)
	if !cached {
		source, err := buildHFResolveURL(base, identity.locator, identity.revision, variant.Entry)
		if err != nil {
			return err
		}
		size := variant.SizeBytes
		end := min(size, int64(capabilitydriver.MaxAssetFormatProbeBytes)) - 1
		requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, source, nil)
		if err != nil {
			return fmt.Errorf("build checkpoint header request: %w", err)
		}
		req.Header.Set("User-Agent", hfCatalogUserAgent)
		req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", end))
		req.Header.Set("Accept-Encoding", "identity")
		resp, err := s.hfHTTPClient().Do(req)
		if err != nil {
			return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: "checkpoint header could not be read"})
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusTooManyRequests {
			rateErr := &filedownload.RateLimitError{
				StatusCode: resp.StatusCode,
				RetryAfter: filedownload.ParseRetryAfter(resp.Header, time.Now()),
			}
			return hfRateLimitedRPCError(rateErr, rateErr.RetryAfter, "checkpoint header review rate limited")
		}
		partial := resp.StatusCode == http.StatusPartialContent && resp.Header.Get("Content-Range") == fmt.Sprintf("bytes 0-%d/%d", end, size)
		full := resp.StatusCode == http.StatusOK && resp.ContentLength == size
		if !partial && !full {
			return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, grpcerr.ReasonOptions{Message: "checkpoint header response did not match the pinned file"})
		}
		layout, err = capabilitydriver.ProbeStandaloneDiffusionCheckpoint(io.LimitReader(resp.Body, end+1), size)
		if err != nil {
			return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: "checkpoint header read did not complete"})
		}
		s.putCachedHFCheckpointLayout(cacheKey, layout, time.Now())
	}
	if layout == capabilitydriver.DiffusionCheckpointLayoutNone {
		return nil
	}
	variant.Files = []string{variant.Entry}
	variant.Hashes = map[string]string{variant.Entry: hash}
	variant.CheckpointLayout = string(layout)
	return nil
}

type hfCatalogSearchRequest struct {
	Query          string
	Capability     string
	CategoryFilter string
	EngineFilter   string
	Limit          int32
}

type hfCatalogSearchFunc func(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error)
type hfCatalogVariantsFunc func(ctx context.Context, repo string, revision string) ([]hfCatalogVariant, error)

type hfCatalogVariant struct {
	Filename     string
	Entry        string
	Files        []string
	Hashes       map[string]string
	Format       string
	SizeBytes    int64
	SHA256       string
	Revision     string
	Title        string
	Description  string
	Categories   []string
	Capabilities []string
	ModelType    string
	License      string
	Tags         []string
	Downloads        int64
	Likes            int64
	LastModified     string
	CheckpointLayout string
}

type hfModelSearchEntry struct {
	ID           string         `json:"id"`
	ModelID      string         `json:"modelId"`
	PipelineTag  string         `json:"pipeline_tag"`
	Tags         []string       `json:"tags"`
	Likes        int64          `json:"likes"`
	Downloads    int64          `json:"downloads"`
	LastModified string         `json:"lastModified"`
	Sha          string         `json:"sha"`
	CardData     map[string]any `json:"cardData"`
}

type hfModelDetails struct {
	ID           string           `json:"id"`
	ModelID      string           `json:"modelId"`
	Sha          string           `json:"sha"`
	PipelineTag  string           `json:"pipeline_tag"`
	Tags         []string         `json:"tags"`
	Downloads    int64            `json:"downloads"`
	Likes        int64            `json:"likes"`
	LastModified string           `json:"lastModified"`
	CardData     map[string]any   `json:"cardData"`
	Siblings     []hfModelSibling `json:"siblings"`
}

type hfModelSibling struct {
	Rfilename string             `json:"rfilename"`
	Lfs       *hfModelSiblingLFS `json:"lfs"`
}

type hfModelSiblingLFS struct {
	Size   int64  `json:"size"`
	Sha256 string `json:"sha256"`
}

func (s *Service) hasCustomHFCatalogSearch() bool {
	s.mu.RLock()
	custom := s.hfCatalogSearch != nil
	s.mu.RUnlock()
	return custom
}

func (s *Service) searchHFCatalog(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	s.mu.RLock()
	searchFn := s.hfCatalogSearch
	s.mu.RUnlock()
	if searchFn != nil {
		return searchFn(ctx, req)
	}
	return fetchHFCatalogSearch(ctx, s.hfHTTPClient(), s.hfCatalogEndpointURL(), req)
}

func (s *Service) listHFCatalogVariants(ctx context.Context, repo string, revision string) ([]hfCatalogVariant, error) {
	s.mu.RLock()
	variantsFn := s.hfCatalogVariants
	s.mu.RUnlock()
	if variantsFn != nil {
		return variantsFn(ctx, repo, revision)
	}
	endpoint := s.hfCatalogEndpointURL()
	normalizedRepo, repoErr := normalizeHFRepo(repo)
	normalizedRev := strings.ToLower(strings.TrimSpace(revision))
	cacheable := repoErr == nil && hfCommitRevisionPattern.MatchString(normalizedRev)
	cacheKey := endpoint + "\x00" + normalizedRepo + "\x00" + normalizedRev
	if cacheable {
		if cached, ok := s.getCachedHFVariants(cacheKey, time.Now()); ok {
			return cached, nil
		}
	}
	variants, err := fetchHFCatalogVariantsWithClient(ctx, s.hfHTTPClient(), endpoint, repo, revision)
	if err != nil {
		return nil, err
	}
	if cacheable {
		s.putCachedHFVariants(cacheKey, variants, time.Now())
	}
	return variants, nil
}

func defaultHFCatalogSearch(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	return fetchHFCatalogSearch(ctx, &http.Client{Timeout: hfCatalogTimeout}, hfCatalogEndpoint, req)
}

func fetchHFCatalogSearch(ctx context.Context, client *http.Client, endpoint string, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	u, err := hfCatalogSearchURLAt(endpoint, req)
	if err != nil {
		return nil, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(requestCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build hf request: %w", err)
	}
	httpReq.Header.Set("User-Agent", hfCatalogUserAgent)
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("hf request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, &filedownload.RateLimitError{
			StatusCode: resp.StatusCode,
			RetryAfter: filedownload.ParseRetryAfter(resp.Header, time.Now()),
		}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf request status=%d", resp.StatusCode)
	}

	var rows []hfModelSearchEntry
	if err := json.NewDecoder(io.LimitReader(resp.Body, hfCatalogMaxBodyBytes)).Decode(&rows); err != nil {
		return nil, fmt.Errorf("decode hf response: %w", err)
	}

	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(rows))
	for _, row := range rows {
		item, ok := mapHFRowToCatalogItem(row, req.EngineFilter)
		if !ok {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

func hfCatalogSearchURL(req hfCatalogSearchRequest) (*url.URL, error) {
	return hfCatalogSearchURLAt(hfCatalogEndpoint, req)
}

func hfCatalogSearchURLAt(endpoint string, req hfCatalogSearchRequest) (*url.URL, error) {
	query, err := normalizeHFSearchQuery(req.Query)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errHfRepoInvalid, err)
	}

	limit := req.Limit
	if limit <= 0 {
		limit = hfCatalogDefaultLimit
	}
	if limit < hfCatalogMinLimit {
		limit = hfCatalogMinLimit
	}
	if limit > hfCatalogMaxLimit {
		limit = hfCatalogMaxLimit
	}

	params := url.Values{}
	if strings.TrimSpace(query) != "" {
		params.Set("search", strings.TrimSpace(query))
	}
	capability := req.Capability
	if capability == "" {
		capability = capabilityForMarketCategory(req.CategoryFilter)
	}
	if pipelineTag := pipelineTagFromCapability(capability); pipelineTag != "" {
		params.Set("pipeline_tag", pipelineTag)
	}
	for _, field := range []string{"sha", "pipeline_tag", "tags", "downloads", "likes", "lastModified", "cardData"} {
		params.Add("expand[]", field)
	}
	params.Set("limit", fmt.Sprintf("%d", limit))

	u, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("%w: endpoint is invalid", errHfRepoInvalid)
	}
	u.RawQuery = params.Encode()
	return u, nil
}

func fetchHFRepoHeadRevision(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	repoRaw string,
	revisionRaw string,
) (*runtimev1.LocalCatalogModelDescriptor, error) {
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errHfRepoInvalid, err)
	}
	base, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("%w: endpoint is invalid", errHfRepoInvalid)
	}
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + repo
	if trimmedRev := strings.TrimSpace(revisionRaw); trimmedRev != "" && trimmedRev != "main" {
		base.RawPath = base.EscapedPath() + "/revision/" + url.PathEscape(trimmedRev)
		base.Path += "/revision/" + trimmedRev
	}
	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(requestCtx, http.MethodGet, base.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build hf repo request: %w", err)
	}
	httpReq.Header.Set("User-Agent", hfCatalogUserAgent)
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("hf repo request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, &filedownload.RateLimitError{
			StatusCode: resp.StatusCode,
			RetryAfter: filedownload.ParseRetryAfter(resp.Header, time.Now()),
		}
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, errHFRepoNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf repo request status=%d", resp.StatusCode)
	}
	var details hfModelDetails
	if err := json.NewDecoder(io.LimitReader(resp.Body, hfCatalogMaxBodyBytes)).Decode(&details); err != nil {
		return nil, fmt.Errorf("decode hf repo response: %w", err)
	}
	resolvedRevision := strings.ToLower(strings.TrimSpace(details.Sha))
	if !hfCommitRevisionPattern.MatchString(resolvedRevision) {
		return nil, fmt.Errorf("hf repo response is missing immutable revision")
	}
	capabilities := inferCapabilitiesFromHF(details.PipelineTag, details.Tags)
	kind := inferAssetKindFromCapabilities(capabilities)
	return &runtimev1.LocalCatalogModelDescriptor{
		ItemId:       "hf_" + slug(repo),
		Source:       "huggingface",
		Title:        defaultString(strings.TrimSpace(details.ModelID), defaultString(strings.TrimSpace(details.ID), repo)),
		ModelId:      repo,
		Repo:         repo,
		Revision:     resolvedRevision,
		Capabilities: capabilities,
		License:      hfCatalogLicense(details.CardData, details.Tags),
		ModelType:    catalogModelTypeForAssetKind(kind),
	}, nil
}

func capabilityForMarketCategory(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "image":
		return "image.generate"
	case "video":
		return "video.generate"
	case "chat":
		return "text.generate"
	default:
		return ""
	}
}

func defaultHFCatalogVariants(ctx context.Context, repoRaw string, revisionRaw string) ([]hfCatalogVariant, error) {
	return fetchHFCatalogVariants(ctx, hfCatalogEndpoint, repoRaw, revisionRaw)
}

func fetchHFCatalogVariants(ctx context.Context, endpoint string, repoRaw string, revisionRaw string) ([]hfCatalogVariant, error) {
	return fetchHFCatalogVariantsWithClient(ctx, &http.Client{Timeout: hfCatalogTimeout}, endpoint, repoRaw, revisionRaw)
}

func fetchHFCatalogVariantsWithClient(ctx context.Context, client *http.Client, endpoint string, repoRaw string, revisionRaw string) ([]hfCatalogVariant, error) {
	u, _, revision, err := hfCatalogVariantsURLAt(endpoint, repoRaw, revisionRaw)
	if err != nil {
		return nil, err
	}

	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(requestCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build hf variants request: %w", err)
	}
	httpReq.Header.Set("User-Agent", hfCatalogUserAgent)
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("hf variants request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, &filedownload.RateLimitError{
			StatusCode: resp.StatusCode,
			RetryAfter: filedownload.ParseRetryAfter(resp.Header, time.Now()),
		}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf variants request status=%d", resp.StatusCode)
	}

	var details hfModelDetails
	if err := json.NewDecoder(io.LimitReader(resp.Body, hfCatalogMaxBodyBytes)).Decode(&details); err != nil {
		return nil, fmt.Errorf("decode hf variants response: %w", err)
	}
	resolvedRevision := strings.TrimSpace(details.Sha)
	if resolvedRevision == "" {
		return nil, fmt.Errorf("hf variants response is missing source revision")
	}
	if revision != "main" && resolvedRevision != revision {
		return nil, fmt.Errorf("hf variants source revision changed")
	}
	variants := listHFCatalogVariantsFromDetails(&details)
	capabilities := inferCapabilitiesFromHF(details.PipelineTag, details.Tags)
	categories := capabilityCategories(capabilities)
	modelType := catalogModelTypeForAssetKind(inferAssetKindFromCapabilities(capabilities))
	license := hfCatalogLicense(details.CardData, details.Tags)
	for index := range variants {
		variants[index].Revision = resolvedRevision
		variants[index].Title = defaultString(strings.TrimSpace(details.ModelID), strings.TrimSpace(details.ID))
		variants[index].Description = "Hugging Face model"
		variants[index].Categories = append([]string(nil), categories...)
		variants[index].Capabilities = append([]string(nil), capabilities...)
		variants[index].ModelType = modelType
		variants[index].License = license
		variants[index].Tags = normalizeStringSlice(details.Tags)
		variants[index].Downloads = details.Downloads
		variants[index].Likes = details.Likes
		variants[index].LastModified = strings.TrimSpace(details.LastModified)
	}
	return variants, nil
}

func hfCatalogVariantsURL(repoRaw string, revisionRaw string) (*url.URL, string, string, error) {
	return hfCatalogVariantsURLAt(hfCatalogEndpoint, repoRaw, revisionRaw)
}

func hfCatalogVariantsURLAt(endpoint string, repoRaw string, revisionRaw string) (*url.URL, string, string, error) {
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, "", "", fmt.Errorf("%w: %v", errHfRepoInvalid, err)
	}
	revision := strings.ToLower(strings.TrimSpace(revisionRaw))
	if !hfCommitRevisionPattern.MatchString(revision) {
		return nil, "", "", fmt.Errorf("%w: immutable revision is required", errHfRepoInvalid)
	}
	base, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, "", "", fmt.Errorf("%w: endpoint is invalid", errHfRepoInvalid)
	}
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + repo + "/revision/" + revision
	params := base.Query()
	params.Set("blobs", "true")
	base.RawQuery = params.Encode()
	return base, repo, revision, nil
}

var errHfRepoInvalid = fmt.Errorf("hf repo invalid")

func normalizeHFSearchQuery(query string) (string, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return "", nil
	}
	if strings.HasPrefix(strings.ToLower(q), "hf://") {
		repo, err := normalizeHFRepo(q)
		if err != nil {
			return "", err
		}
		return repo, nil
	}
	if strings.HasPrefix(strings.ToLower(q), "https://huggingface.co/") || strings.HasPrefix(strings.ToLower(q), "http://huggingface.co/") {
		repo, err := normalizeHFRepo(q)
		if err != nil {
			return "", err
		}
		return repo, nil
	}
	return q, nil
}

func normalizeHFRepo(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("empty repo")
	}

	lower := strings.ToLower(value)
	switch {
	case strings.HasPrefix(lower, "hf://"):
		value = strings.TrimSpace(value[len("hf://"):])
	case strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://"):
		u, err := url.Parse(value)
		if err != nil {
			return "", err
		}
		if !strings.EqualFold(strings.TrimSpace(u.Host), "huggingface.co") {
			return "", fmt.Errorf("unsupported host %q", u.Host)
		}
		segments := splitPathSegments(u.Path)
		switch {
		case len(segments) >= 3 && strings.EqualFold(segments[0], "models"):
			value = segments[1] + "/" + segments[2]
		case len(segments) >= 2:
			value = segments[0] + "/" + segments[1]
		default:
			return "", fmt.Errorf("repo path missing")
		}
	default:
		// Keep user-supplied org/model format.
	}

	value = strings.Trim(strings.TrimSpace(value), "/")
	if strings.Count(value, "/") != 1 {
		return "", fmt.Errorf("repo format must be org/model")
	}
	parts := strings.SplitN(value, "/", 2)
	if strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("repo format must be org/model")
	}
	return parts[0] + "/" + parts[1], nil
}

func splitPathSegments(p string) []string {
	raw := strings.Split(strings.TrimSpace(p), "/")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		segment := strings.TrimSpace(item)
		if segment == "" {
			continue
		}
		out = append(out, segment)
	}
	return out
}

func pipelineTagFromCapability(capability string) string {
	switch normalizeLocalCapabilityToken(capability) {
	case "chat", "text.generate":
		return "text-generation"
	case "image", "image.generate":
		return "text-to-image"
	case "video", "video.generate":
		return "text-to-video"
	case "tts", "audio.synthesize":
		return "text-to-speech"
	case "stt", "audio.transcribe":
		return "automatic-speech-recognition"
	case "embedding", "text.embed":
		return "feature-extraction"
	default:
		return ""
	}
}

func inferCapabilitiesFromHF(pipelineTag string, tags []string) []string {
	caps := make([]string, 0, 2)
	appendCap := func(pipeline string) {
		switch strings.ToLower(strings.TrimSpace(pipeline)) {
		case "text-generation", "text2text-generation", "image-text-to-text", "visual-question-answering":
			caps = append(caps, "text.generate")
		case "text-to-image", "image-to-image":
			caps = append(caps, "image.generate")
		case "text-to-video", "image-to-video":
			caps = append(caps, "video.generate")
		case "text-to-speech", "text-to-audio":
			caps = append(caps, "audio.synthesize")
		case "automatic-speech-recognition":
			caps = append(caps, "audio.transcribe")
		case "feature-extraction", "sentence-similarity":
			caps = append(caps, "text.embed")
		}
	}

	appendCap(pipelineTag)
	for _, tag := range tags {
		appendCap(tag)
	}
	caps = normalizeAssetCapabilities(caps)
	if len(caps) == 0 {
		return nil
	}
	return caps
}

// @nimi-authority: rule.nimi.runtime.local-compute.r103
func mapHFRowToCatalogItem(row hfModelSearchEntry, _ string) (*runtimev1.LocalCatalogModelDescriptor, bool) {
	repoRaw := defaultString(strings.TrimSpace(row.ID), strings.TrimSpace(row.ModelID))
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, false
	}
	revision := strings.ToLower(strings.TrimSpace(row.Sha))
	if !hfCommitRevisionPattern.MatchString(revision) {
		return nil, false
	}
	capabilities := inferCapabilitiesFromHF(row.PipelineTag, row.Tags)
	kind := inferAssetKindFromCapabilities(capabilities)
	tags := normalizeStringSlice(append(append([]string(nil), row.Tags...), capabilities...))
	// Discovery describes source content, not whether a Driver admits it. In
	// particular, any-to-any and unclassified repositories remain discoverable
	// without guessing a capability or a model kind.
	license := hfCatalogLicense(row.CardData, row.Tags)
	return &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "hf_" + slug(repo),
		Source:            "huggingface",
		Title:             repo,
		Description:       "HuggingFace model",
		ModelId:           repo,
		Repo:              repo,
		Revision:          revision,
		TemplateId:        "",
		Capabilities:      capabilities,
		Engine:            "",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED,
		InstallKind:       "download",
		InstallAvailable:  false,
		Endpoint:          "",
		ProviderHints:     nil,
		Entry:             "./dist/index.js",
		Files:             []string{},
		License:           license,
		Hashes:            map[string]string{},
		Tags:              tags,
		Downloads:         row.Downloads,
		Likes:             row.Likes,
		LastModified:      strings.TrimSpace(row.LastModified),
		Verified:          false,
		ModelType:         catalogModelTypeForAssetKind(kind),
	}, true
}

func listHFCatalogVariantsFromDetails(details *hfModelDetails) []hfCatalogVariant {
	if details == nil {
		return nil
	}
	variants := make([]hfCatalogVariant, 0, len(details.Siblings))
	for _, sibling := range details.Siblings {
		entry, ok := normalizeHFFilePath(sibling.Rfilename)
		if !ok {
			continue
		}
		lower := strings.ToLower(entry)
		if !ggufmeta.IsGGUFExtension(entry) && !strings.HasSuffix(lower, ".safetensors") {
			continue
		}
		format := variantFormatForEntry(entry)
		files := []string(nil)
		hashes := map[string]string(nil)
		var sizeBytes int64
		sha256 := ""
		if sibling.Lfs != nil {
			sizeBytes = sibling.Lfs.Size
			sha256 = strings.TrimSpace(sibling.Lfs.Sha256)
		}
		if format == "gguf" && sibling.Lfs != nil && !isHFWeightShard(entry) {
			files = []string{entry}
			if digest := normalizeExactSHA256Hex(sha256); digest != "" {
				hashes = map[string]string{entry: digest}
			}
		}
		variants = append(variants, hfCatalogVariant{
			Filename:  entry,
			Entry:     entry,
			Files:     files,
			Hashes:    hashes,
			Format:    format,
			SizeBytes: sizeBytes,
			SHA256:    sha256,
		})
	}
	sort.Slice(variants, func(i, j int) bool {
		if (variants[i].SizeBytes == 0) != (variants[j].SizeBytes == 0) {
			return variants[i].SizeBytes != 0
		}
		if variants[i].SizeBytes != variants[j].SizeBytes {
			return variants[i].SizeBytes < variants[j].SizeBytes
		}
		return variants[i].Filename < variants[j].Filename
	})
	return variants
}

func hfCatalogLicense(card map[string]any, tags []string) string {
	if raw, ok := card["license"].(string); ok && strings.TrimSpace(raw) != "" {
		return strings.TrimSpace(raw)
	}
	license := ""
	for _, tag := range tags {
		if !strings.HasPrefix(tag, "license:") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(tag, "license:"))
		if value == "" {
			continue
		}
		if license != "" && license != value {
			return "unknown"
		}
		license = value
	}
	return defaultString(license, "unknown")
}

func variantFormatForEntry(entry string) string {
	lower := strings.ToLower(strings.TrimSpace(entry))
	switch {
	case ggufmeta.IsGGUFExtension(entry):
		return "gguf"
	case strings.HasSuffix(lower, ".safetensors"):
		return "safetensors"
	default:
		return "unknown"
	}
}

func normalizeHFFilePath(value string) (string, bool) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if normalized == "" || strings.HasPrefix(normalized, "/") {
		return "", false
	}
	for _, segment := range strings.Split(normalized, "/") {
		if segment == ".." {
			return "", false
		}
	}
	return normalized, true
}
