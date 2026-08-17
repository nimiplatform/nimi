package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	modelIndexBaseURLEnv       = "NIMI_MODEL_INDEX_BASE_URL"
	defaultModelIndexBaseURL   = "https://models.nimi.ai"
	modelIndexCacheFile        = "model-index-feed-cache.json"
	modelIndexDefaultPageSize  = 40
	modelIndexMaxPageSize      = 80
	modelIndexFetchTimeout     = 15 * time.Second
	recommendationBytesPerGiB  = 1024 * 1024 * 1024
	reasonBaselineImageDefault = "baseline_image_default_v1"
	reasonBaselineVideoDefault = "baseline_video_default_v1"
	reasonEngineOverhead       = "engine_overhead_applied"
	reasonPrereqOverhead       = "hard_prerequisite_overhead_applied"
	reasonGPUMemoryUnknown     = "gpu_memory_unknown"
	reasonHostAttachedOnly     = "host_attached_only"
	reasonHostUnsupported      = "host_unsupported"
	reasonMainSizeUnknown      = "main_size_unknown"
	reasonMetadataIncomplete   = "metadata_incomplete"
	reasonMemoryExceeded       = "memory_budget_exceeded"
	reasonMemoryRecommended    = "memory_headroom_recommended"
	reasonMemoryRunnable       = "memory_headroom_runnable"
	reasonMemoryTight          = "memory_headroom_tight"
	reasonRepoLevelEstimate    = "safetensors_repo_level_estimate"
	reasonUnifiedMemory        = "unified_memory_estimate"
	reasonVariantQuantParsed   = "variant_quant_parsed"
	reasonLLMFITCPUOnly        = "llmfit_cpu_only"
	reasonLLMFITCPUOffload     = "llmfit_cpu_offload"
	reasonLLMFITGPUPath        = "llmfit_gpu_path"
	reasonLLMFITMarginal       = "llmfit_marginal"
	reasonLLMFITParamsFile     = "llmfit_params_from_filename"
	reasonLLMFITParamsSize     = "llmfit_params_from_filesize"
	reasonLLMFITQuantFile      = "llmfit_quant_from_filename"
	reasonLLMFITRecommended    = "llmfit_recommended"
	reasonLLMFITRunnable       = "llmfit_runnable"
	reasonLLMFITTight          = "llmfit_tight"
	reasonLLMFITCtxDefaulted   = "llmfit_context_defaulted"
	reasonLLMFITVision         = "llmfit_vision_model"
	reasonLLMFITTpsEstimated   = "llmfit_tps_estimated"
)

type remoteModelFile struct {
	Path      string `json:"path"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
}

type remoteInstallEntry struct {
	EntryID        string            `json:"entry_id"`
	Format         string            `json:"format"`
	Entry          string            `json:"entry"`
	Files          []remoteModelFile `json:"files"`
	TotalSizeBytes int64             `json:"total_size_bytes"`
	SHA256         string            `json:"sha256"`
}

type remoteModelEntry struct {
	Repo         string               `json:"repo"`
	Revision     string               `json:"revision"`
	Title        string               `json:"title"`
	Description  string               `json:"description"`
	Capabilities []string             `json:"capabilities"`
	Tags         []string             `json:"tags"`
	Formats      []string             `json:"formats"`
	Downloads    int64                `json:"downloads"`
	Likes        int64                `json:"likes"`
	LastModified string               `json:"last_modified"`
	Entries      []remoteInstallEntry `json:"entries"`
}

type remoteLeaderboardResponse struct {
	SchemaVersion string             `json:"schema_version"`
	GeneratedAt   string             `json:"generated_at"`
	Capability    string             `json:"capability"`
	Page          int                `json:"page"`
	PageSize      int                `json:"page_size"`
	Total         int                `json:"total"`
	Items         []remoteModelEntry `json:"items"`
}

type modelIndexCacheRecord struct {
	FetchedAt string                               `json:"fetched_at"`
	Feeds     map[string]remoteLeaderboardResponse `json:"feeds"`
}

type recommendationCandidate struct {
	modelID             string
	repo                string
	title               string
	capability          string
	engine              string
	entry               string
	format              runtimev1.LocalRecommendationFormat
	mainSizeBytes       int64
	knownTotalSizeBytes int64
	fallbackEntries     []string
	tags                []string
}

type hostSupportDescriptor struct {
	class  runtimev1.LocalHostSupportClass
	detail string
}

func (s *Service) GetRecommendationFeed(ctx context.Context, req *runtimev1.GetRecommendationFeedRequest) (*runtimev1.GetRecommendationFeedResponse, error) {
	capability := normalizeRecommendationFeedCapability(req.GetCapability())
	pageSize := normalizeRecommendationFeedPageSize(req.GetPageSize())
	deviceProfile := collectDeviceProfile()
	installedAssets := s.installedModelAssetsSnapshot()
	cache := s.loadModelIndexCache()
	feed, cacheState := s.resolveRecommendationRemoteFeed(ctx, capability, pageSize, cache)
	if feed == nil {
		return &runtimev1.GetRecommendationFeedResponse{
			Feed: &runtimev1.LocalRecommendationFeedDescriptor{
				DeviceProfile:    cloneDeviceProfile(deviceProfile),
				ActiveCapability: recommendationFeedCapability(capability),
				CacheState:       runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_EMPTY,
				Items:            []*runtimev1.LocalRecommendationFeedItemDescriptor{},
			},
		}, nil
	}
	if cacheState == runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH {
		next := cache
		if next.Feeds == nil {
			next.Feeds = make(map[string]remoteLeaderboardResponse)
		}
		next.FetchedAt = nowISO()
		next.Feeds[capability] = *feed
		_ = s.saveModelIndexCache(next)
	}
	return &runtimev1.GetRecommendationFeedResponse{
		Feed: materializeRecommendationFeed(feed, cacheState, capability, deviceProfile, installedAssets, s.verified),
	}, nil
}

func normalizeRecommendationFeedCapability(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image":
		return "image"
	case "video":
		return "video"
	default:
		return "chat"
	}
}

func normalizeRecommendationFeedPageSize(value int32) int {
	if value <= 0 {
		return modelIndexDefaultPageSize
	}
	if value > modelIndexMaxPageSize {
		return modelIndexMaxPageSize
	}
	return int(value)
}

func recommendationFeedCapability(value string) runtimev1.LocalRecommendationFeedCapability {
	switch normalizeRecommendationFeedCapability(value) {
	case "image":
		return runtimev1.LocalRecommendationFeedCapability_LOCAL_RECOMMENDATION_FEED_CAPABILITY_IMAGE
	case "video":
		return runtimev1.LocalRecommendationFeedCapability_LOCAL_RECOMMENDATION_FEED_CAPABILITY_VIDEO
	default:
		return runtimev1.LocalRecommendationFeedCapability_LOCAL_RECOMMENDATION_FEED_CAPABILITY_CHAT
	}
}

func preferredEngineForRecommendationCapability(capability string) string {
	switch normalizeRecommendationFeedCapability(capability) {
	case "image", "video":
		return "media"
	default:
		return "llama"
	}
}

func recommendationAssetKind(capability string) runtimev1.LocalAssetKind {
	switch normalizeRecommendationFeedCapability(capability) {
	case "image":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	case "video":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	}
}

func recommendationFormat(value string) runtimev1.LocalRecommendationFormat {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "gguf":
		return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF
	case "safetensors":
		return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS
	default:
		return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_UNSPECIFIED
	}
}

func formatFromEntry(entry string) runtimev1.LocalRecommendationFormat {
	lower := strings.ToLower(strings.TrimSpace(entry))
	if strings.HasSuffix(lower, ".gguf") {
		return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF
	}
	if strings.HasSuffix(lower, ".safetensors") {
		return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS
	}
	return runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_UNSPECIFIED
}

func (s *Service) installedModelAssetsSnapshot() []*runtimev1.ModelAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.ModelAssetRecord, 0, len(s.modelAssets))
	for _, asset := range s.modelAssets {
		if asset == nil {
			continue
		}
		items = append(items, cloneModelAsset(asset))
	}
	return items
}

func (s *Service) modelIndexCachePath() string {
	if statePath := strings.TrimSpace(s.stateStorePath); statePath != "" {
		return filepath.Join(filepath.Dir(statePath), modelIndexCacheFile)
	}
	if modelsPath := strings.TrimSpace(s.localModelsPath); modelsPath != "" {
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
		return modelIndexCacheRecord{Feeds: map[string]remoteLeaderboardResponse{}}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return modelIndexCacheRecord{Feeds: map[string]remoteLeaderboardResponse{}}
	}
	var cache modelIndexCacheRecord
	if err := json.Unmarshal(raw, &cache); err != nil {
		return modelIndexCacheRecord{Feeds: map[string]remoteLeaderboardResponse{}}
	}
	if cache.Feeds == nil {
		cache.Feeds = map[string]remoteLeaderboardResponse{}
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
	return os.WriteFile(path, raw, 0o644)
}

func (s *Service) resolveRecommendationRemoteFeed(ctx context.Context, capability string, pageSize int, cache modelIndexCacheRecord) (*remoteLeaderboardResponse, runtimev1.LocalRecommendationFeedCacheState) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv(modelIndexBaseURLEnv)), "/")
	if baseURL == "" {
		baseURL = defaultModelIndexBaseURL
	}
	if feed, err := fetchRecommendationLeaderboard(ctx, baseURL, capability, pageSize); err == nil && feed != nil {
		return feed, runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH
	}
	if cached, ok := cache.Feeds[capability]; ok {
		return &cached, runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_STALE
	}
	return nil, runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_EMPTY
}

func fetchRecommendationLeaderboard(ctx context.Context, baseURL string, capability string, pageSize int) (feedResponse *remoteLeaderboardResponse, err error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/") + "/leaderboard")
	if err != nil {
		return nil, err
	}
	query := parsed.Query()
	query.Set("capability", capability)
	query.Set("page", "1")
	query.Set("pageSize", fmt.Sprintf("%d", pageSize))
	parsed.RawQuery = query.Encode()

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
	var feed remoteLeaderboardResponse
	if err := json.NewDecoder(resp.Body).Decode(&feed); err != nil {
		return nil, err
	}
	return &feed, nil
}

func materializeRecommendationFeed(
	feed *remoteLeaderboardResponse,
	cacheState runtimev1.LocalRecommendationFeedCacheState,
	capability string,
	deviceProfile *runtimev1.LocalDeviceProfile,
	installedAssets []*runtimev1.ModelAssetRecord,
	verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor,
) *runtimev1.LocalRecommendationFeedDescriptor {
	items := make([]*runtimev1.LocalRecommendationFeedItemDescriptor, 0, len(feed.Items))
	sourceRank := make(map[string]int, len(feed.Items))
	for index, item := range feed.Items {
		sourceRank[strings.ToLower(strings.TrimSpace(item.Repo))] = index
		items = append(items, buildRecommendationFeedItem(&item, capability, deviceProfile, installedAssets, verifiedAssets, index))
	}
	sort.SliceStable(items, func(i, j int) bool {
		leftRank := sourceRank[strings.ToLower(strings.TrimSpace(items[i].GetRepo()))]
		rightRank := sourceRank[strings.ToLower(strings.TrimSpace(items[j].GetRepo()))]
		leftKey := recommendationFeedItemSortKey(items[i], leftRank)
		rightKey := recommendationFeedItemSortKey(items[j], rightRank)
		if leftKey != rightKey {
			return leftKey.less(rightKey)
		}
		return strings.ToLower(items[i].GetTitle()) < strings.ToLower(items[j].GetTitle())
	})
	return &runtimev1.LocalRecommendationFeedDescriptor{
		DeviceProfile:    cloneDeviceProfile(deviceProfile),
		ActiveCapability: recommendationFeedCapability(capability),
		GeneratedAt:      strings.TrimSpace(feed.GeneratedAt),
		CacheState:       cacheState,
		Items:            items,
	}
}

type recommendationRank struct {
	tier       int
	host       int
	confidence int
	verified   int
	sizeBytes  int64
	sourceRank int
}

func (r recommendationRank) less(other recommendationRank) bool {
	if r.tier != other.tier {
		return r.tier < other.tier
	}
	if r.host != other.host {
		return r.host < other.host
	}
	if r.confidence != other.confidence {
		return r.confidence < other.confidence
	}
	if r.verified != other.verified {
		return r.verified < other.verified
	}
	if r.sizeBytes != other.sizeBytes {
		return r.sizeBytes < other.sizeBytes
	}
	return r.sourceRank < other.sourceRank
}

func recommendationSortKey(recommendation *runtimev1.LocalCatalogRecommendation, verified bool, sourceRank int) recommendationRank {
	tierRank := 4
	switch recommendation.GetTier() {
	case runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RECOMMENDED:
		tierRank = 0
	case runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RUNNABLE:
		tierRank = 1
	case runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_TIGHT:
		tierRank = 2
	case runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_NOT_RECOMMENDED:
		tierRank = 3
	}
	hostRank := 3
	switch recommendation.GetHostSupportClass() {
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED:
		hostRank = 0
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY:
		hostRank = 1
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED:
		hostRank = 2
	}
	confidenceRank := 3
	switch recommendation.GetConfidence() {
	case runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_HIGH:
		confidenceRank = 0
	case runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_MEDIUM:
		confidenceRank = 1
	case runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_LOW:
		confidenceRank = 2
	}
	verifiedRank := 1
	if verified {
		verifiedRank = 0
	}
	return recommendationRank{tier: tierRank, host: hostRank, confidence: confidenceRank, verified: verifiedRank, sizeBytes: 0, sourceRank: sourceRank}
}

func recommendationFeedItemSortKey(item *runtimev1.LocalRecommendationFeedItemDescriptor, sourceRank int) recommendationRank {
	key := recommendationSortKey(item.GetRecommendation(), item.GetVerified(), sourceRank)
	key.sizeBytes = recommendationFeedItemSmallestEntrySize(item)
	return key
}

func recommendationFeedItemSmallestEntrySize(item *runtimev1.LocalRecommendationFeedItemDescriptor) int64 {
	const unknownSizeRank = int64(1 << 62)
	best := unknownSizeRank
	for _, entry := range item.GetEntries() {
		size := entry.GetTotalSizeBytes()
		if size > 0 && size < best {
			best = size
		}
	}
	return best
}

func buildRecommendationFeedItem(
	item *remoteModelEntry,
	capability string,
	profile *runtimev1.LocalDeviceProfile,
	installedAssets []*runtimev1.ModelAssetRecord,
	verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor,
	sourceRank int,
) *runtimev1.LocalRecommendationFeedItemDescriptor {
	engine := preferredEngineForRecommendationCapability(capability)
	entries := make([]*runtimev1.LocalRecommendationFeedEntryDescriptor, 0, len(item.Entries))
	for _, entry := range item.Entries {
		format := recommendationFormat(entry.Format)
		if format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_UNSPECIFIED {
			continue
		}
		entries = append(entries, &runtimev1.LocalRecommendationFeedEntryDescriptor{
			EntryId:        strings.TrimSpace(entry.EntryID),
			Format:         format,
			Entry:          strings.TrimSpace(entry.Entry),
			Files:          recommendationEntryFiles(entry),
			TotalSizeBytes: entry.TotalSizeBytes,
			Sha256:         strings.TrimSpace(entry.SHA256),
		})
	}

	bestEntry := remoteInstallEntry{}
	if len(item.Entries) > 0 {
		bestEntry = item.Entries[0]
	}
	var bestRecommendation *runtimev1.LocalCatalogRecommendation
	for _, entry := range item.Entries {
		candidate := buildRecommendationCandidate(item, capability, engine, entry)
		recommendation := buildFeedRecommendation(candidate, profile, verifiedAssets)
		if recommendation == nil {
			continue
		}
		if bestRecommendation == nil || recommendationSortKey(recommendation, false, sourceRank).less(recommendationSortKey(bestRecommendation, false, sourceRank)) {
			bestRecommendation = recommendation
			bestEntry = entry
		}
	}
	if bestRecommendation != nil && strings.TrimSpace(bestRecommendation.GetRecommendedEntry()) != "" {
		for _, entry := range item.Entries {
			if strings.TrimSpace(entry.Entry) == strings.TrimSpace(bestRecommendation.GetRecommendedEntry()) {
				bestEntry = entry
				break
			}
		}
	}

	installedState := recommendationInstalledState(item, installedAssets)
	verified := recommendationVerified(item, verifiedAssets)
	actionState := &runtimev1.LocalRecommendationActionState{
		CanReviewInstallPlan: !installedState.GetInstalled() && strings.TrimSpace(bestEntry.Entry) != "",
		CanOpenVariants:      len(item.Entries) > 1,
		CanOpenLocalAsset:    installedState.GetInstalled(),
	}
	installPayload := &runtimev1.LocalRecommendationInstallPayload{
		ModelId:      strings.TrimSpace(item.Repo),
		Kind:         recommendationAssetKind(capability),
		Repo:         strings.TrimSpace(item.Repo),
		Revision:     defaultString(item.Revision, "main"),
		Capabilities: normalizeStringSlice(item.Capabilities),
		Engine:       engine,
		Entry:        strings.TrimSpace(bestEntry.Entry),
		Files:        recommendationEntryFiles(bestEntry),
		License:      "",
		Hashes:       recommendationEntryHashes(bestEntry),
	}
	formats := make([]runtimev1.LocalRecommendationFormat, 0, len(item.Formats))
	for _, format := range item.Formats {
		parsed := recommendationFormat(format)
		if parsed != runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_UNSPECIFIED {
			formats = append(formats, parsed)
		}
	}
	return &runtimev1.LocalRecommendationFeedItemDescriptor{
		ItemId:          fmt.Sprintf("model-index:%s:%s", capability, strings.TrimSpace(item.Repo)),
		Source:          runtimev1.LocalRecommendationFeedSource_LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX,
		Repo:            strings.TrimSpace(item.Repo),
		Revision:        defaultString(item.Revision, "main"),
		Title:           defaultString(item.Title, item.Repo),
		Description:     strings.TrimSpace(item.Description),
		Capabilities:    normalizeStringSlice(item.Capabilities),
		Tags:            normalizeStringSlice(item.Tags),
		Formats:         formats,
		Downloads:       item.Downloads,
		Likes:           item.Likes,
		LastModified:    strings.TrimSpace(item.LastModified),
		PreferredEngine: engine,
		Verified:        verified,
		Entries:         entries,
		Recommendation:  bestRecommendation,
		InstalledState:  installedState,
		ActionState:     actionState,
		InstallPayload:  installPayload,
	}
}

func buildRecommendationCandidate(item *remoteModelEntry, capability string, engine string, entry remoteInstallEntry) recommendationCandidate {
	fallback := make([]string, 0, len(item.Entries))
	for _, other := range item.Entries {
		if other.EntryID == entry.EntryID {
			continue
		}
		fallback = append(fallback, strings.TrimSpace(other.Entry))
	}
	format := recommendationFormat(entry.Format)
	if format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_UNSPECIFIED {
		format = formatFromEntry(entry.Entry)
	}
	return recommendationCandidate{
		modelID:             strings.TrimSpace(item.Repo),
		repo:                strings.TrimSpace(item.Repo),
		title:               defaultString(item.Title, item.Repo),
		capability:          capability,
		engine:              engine,
		entry:               strings.TrimSpace(entry.Entry),
		format:              format,
		mainSizeBytes:       entry.TotalSizeBytes,
		knownTotalSizeBytes: entry.TotalSizeBytes,
		fallbackEntries:     fallback,
		tags:                normalizeStringSlice(item.Tags),
	}
}

func buildFeedRecommendation(candidate recommendationCandidate, profile *runtimev1.LocalDeviceProfile, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) *runtimev1.LocalCatalogRecommendation {
	switch normalizeRecommendationFeedCapability(candidate.capability) {
	case "image", "video":
		return buildMediaRecommendation(candidate, profile, verifiedAssets)
	default:
		return buildLLMRecommendation(candidate, profile)
	}
}

func recommendationEntryFiles(entry remoteInstallEntry) []string {
	files := make([]string, 0, len(entry.Files))
	for _, file := range entry.Files {
		if path := strings.TrimSpace(file.Path); path != "" {
			files = append(files, path)
		}
	}
	return files
}

func recommendationEntryHashes(entry remoteInstallEntry) map[string]string {
	hashes := map[string]string{}
	for _, file := range entry.Files {
		if strings.TrimSpace(file.Path) == "" || strings.TrimSpace(file.SHA256) == "" {
			continue
		}
		hashes[strings.TrimSpace(file.Path)] = strings.TrimSpace(file.SHA256)
	}
	return hashes
}

func recommendationInstalledState(item *remoteModelEntry, installedAssets []*runtimev1.ModelAssetRecord) *runtimev1.LocalRecommendationInstalledState {
	for _, asset := range installedAssets {
		if asset == nil || asset.GetProvenance() == nil {
			continue
		}
		repo := strings.TrimSpace(asset.GetProvenance().GetFields()["source_repo"].GetStringValue())
		if strings.EqualFold(repo, strings.TrimSpace(item.Repo)) {
			return &runtimev1.LocalRecommendationInstalledState{
				Installed: true,
			}
		}
	}
	return &runtimev1.LocalRecommendationInstalledState{}
}

func recommendationVerified(item *remoteModelEntry, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) bool {
	for _, asset := range verifiedAssets {
		if asset == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(asset.GetRepo()), strings.TrimSpace(item.Repo)) ||
			strings.EqualFold(strings.TrimSpace(asset.GetAssetId()), strings.TrimSpace(item.Repo)) {
			return true
		}
	}
	return false
}
