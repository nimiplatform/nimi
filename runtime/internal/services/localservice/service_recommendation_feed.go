package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
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
	installedAssets := s.installedRunnableAssetsSnapshot()
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

func (s *Service) installedRunnableAssetsSnapshot() []*runtimev1.LocalAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for _, asset := range s.assets {
		if asset == nil || !isRunnableKind(asset.GetKind()) {
			continue
		}
		items = append(items, cloneLocalAsset(asset))
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

func fetchRecommendationLeaderboard(ctx context.Context, baseURL string, capability string, pageSize int) (*remoteLeaderboardResponse, error) {
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
	defer resp.Body.Close()
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
	installedAssets []*runtimev1.LocalAssetRecord,
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
		leftKey := recommendationSortKey(items[i].GetRecommendation(), items[i].GetVerified(), leftRank)
		rightKey := recommendationSortKey(items[j].GetRecommendation(), items[j].GetVerified(), rightRank)
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
	return recommendationRank{tier: tierRank, host: hostRank, confidence: confidenceRank, verified: verifiedRank, sourceRank: sourceRank}
}

func buildRecommendationFeedItem(
	item *remoteModelEntry,
	capability string,
	profile *runtimev1.LocalDeviceProfile,
	installedAssets []*runtimev1.LocalAssetRecord,
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

func recommendationInstalledState(item *remoteModelEntry, installedAssets []*runtimev1.LocalAssetRecord) *runtimev1.LocalRecommendationInstalledState {
	for _, asset := range installedAssets {
		if asset == nil || asset.GetSource() == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(asset.GetSource().GetRepo()), strings.TrimSpace(item.Repo)) {
			return &runtimev1.LocalRecommendationInstalledState{
				Installed:    true,
				LocalAssetId: asset.GetLocalAssetId(),
				Status:       asset.GetStatus(),
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

func buildMediaRecommendation(candidate recommendationCandidate, profile *runtimev1.LocalDeviceProfile, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) *runtimev1.LocalCatalogRecommendation {
	support := classifyRecommendationHostSupport(candidate.engine, profile)
	reasonCodes := []string{}
	notes := []string{}
	baseline := runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_UNSPECIFIED
	switch normalizeRecommendationFeedCapability(candidate.capability) {
	case "image":
		baseline = runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_IMAGE_DEFAULT_V1
		pushRecommendationCode(&reasonCodes, reasonBaselineImageDefault)
		pushRecommendationNote(&notes, "Baseline: image-default-v1 (1024x1024 text-to-image).")
	case "video":
		baseline = runtimev1.LocalRecommendationBaseline_LOCAL_RECOMMENDATION_BASELINE_VIDEO_DEFAULT_V1
		pushRecommendationCode(&reasonCodes, reasonBaselineVideoDefault)
		pushRecommendationNote(&notes, "Baseline: video-default-v1 (720p, 4s, 16fps, text-to-video, no audio).")
	}
	sizeBytes := candidate.mainSizeBytes
	if sizeBytes <= 0 {
		sizeBytes = candidate.knownTotalSizeBytes
		pushRecommendationCode(&reasonCodes, reasonMetadataIncomplete)
		if sizeBytes > 0 {
			pushRecommendationCode(&reasonCodes, reasonRepoLevelEstimate)
		} else {
			pushRecommendationCode(&reasonCodes, reasonMainSizeUnknown)
		}
	}
	budgetBytes := mediaMemoryBudgetBytes(candidate.capability, profile, &reasonCodes, &notes)
	if budgetBytes <= 0 {
		pushRecommendationCode(&reasonCodes, reasonGPUMemoryUnknown)
		pushRecommendationNote(&notes, "Host memory profile is incomplete; recommendation confidence is reduced.")
	}
	confidence := runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_MEDIUM
	if candidate.format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF && candidate.mainSizeBytes > 0 && budgetBytes > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_HIGH
	}
	if candidate.mainSizeBytes <= 0 || budgetBytes <= 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_LOW
	}
	multiplier := mediaOverheadMultiplier(candidate.capability, candidate.format, candidate.engine)
	estimatedBytes := int64(math.Ceil(float64(sizeBytes) * multiplier))
	pushRecommendationCode(&reasonCodes, reasonPrereqOverhead)
	pushRecommendationCode(&reasonCodes, reasonEngineOverhead)
	pushRecommendationNote(&notes, "Estimate includes conservative hard-prerequisite and engine overhead.")
	if quant := quantHintFromEntry(candidate.entry); quant != "" {
		pushRecommendationCode(&reasonCodes, reasonVariantQuantParsed)
		pushRecommendationNote(&notes, fmt.Sprintf("Parsed quant hint from variant filename: %s.", quant))
	}
	tier := recommendationTierForBudget(estimatedBytes, budgetBytes, &reasonCodes, &notes)
	switch support.class {
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY:
		pushRecommendationCode(&reasonCodes, reasonHostAttachedOnly)
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED:
		pushRecommendationCode(&reasonCodes, reasonHostUnsupported)
	}
	if support.detail != "" {
		pushRecommendationNote(&notes, support.detail)
	}
	pushRecommendationNote(&notes, "Dependency assets may still be required and are not part of the runnable-asset tier.")
	return &runtimev1.LocalCatalogRecommendation{
		Source:           runtimev1.LocalRecommendationSource_LOCAL_RECOMMENDATION_SOURCE_MEDIA_FIT,
		Format:           candidate.format,
		Tier:             tier,
		HostSupportClass: support.class,
		Confidence:       confidence,
		ReasonCodes:      reasonCodes,
		RecommendedEntry: candidate.entry,
		FallbackEntries:  append([]string(nil), candidate.fallbackEntries...),
		SuggestedAssets:  companionSuggestions(candidate, verifiedAssets),
		SuggestedNotes:   notes,
		Baseline:         baseline,
	}
}

func buildLLMRecommendation(candidate recommendationCandidate, profile *runtimev1.LocalDeviceProfile) *runtimev1.LocalCatalogRecommendation {
	support := classifyRecommendationHostSupport(candidate.engine, profile)
	reasonCodes := []string{}
	notes := []string{}
	quant := llmQuantHint(candidate)
	if quant != "" {
		pushRecommendationCode(&reasonCodes, reasonLLMFITQuantFile)
	}
	parameters, fromName := inferParameters(candidate, quant)
	if fromName {
		pushRecommendationCode(&reasonCodes, reasonLLMFITParamsFile)
	} else {
		pushRecommendationCode(&reasonCodes, reasonLLMFITParamsSize)
	}
	if _, defaulted := inferContextLength(candidate); defaulted {
		pushRecommendationCode(&reasonCodes, reasonLLMFITCtxDefaulted)
	}
	if hasVisionHint(candidate) {
		pushRecommendationCode(&reasonCodes, reasonLLMFITVision)
	}
	sizeBytes := candidate.mainSizeBytes
	if sizeBytes <= 0 {
		sizeBytes = candidate.knownTotalSizeBytes
	}
	if sizeBytes <= 0 && parameters > 0 {
		sizeBytes = int64(float64(parameters) * quantBytesPerParam(defaultString(quant, "Q4_K_M")))
	}
	requiredGB := (float64(sizeBytes) / recommendationBytesPerGiB) + 0.5
	availableGB := llmAvailableMemoryGB(profile)
	tier := runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_NOT_RECOMMENDED
	if availableGB > 0 && requiredGB > 0 {
		ratio := requiredGB / availableGB
		switch {
		case ratio <= 0.70:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RECOMMENDED
			pushRecommendationCode(&reasonCodes, reasonLLMFITRecommended)
		case ratio <= 0.85:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RUNNABLE
			pushRecommendationCode(&reasonCodes, reasonLLMFITRunnable)
		case ratio <= 1.0:
			tier = runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_TIGHT
			pushRecommendationCode(&reasonCodes, reasonLLMFITMarginal)
			pushRecommendationCode(&reasonCodes, reasonLLMFITTight)
		default:
			pushRecommendationCode(&reasonCodes, reasonMemoryExceeded)
		}
	}
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		pushRecommendationCode(&reasonCodes, reasonLLMFITGPUPath)
	case "cpu-offload":
		pushRecommendationCode(&reasonCodes, reasonLLMFITCPUOffload)
	default:
		pushRecommendationCode(&reasonCodes, reasonLLMFITCPUOnly)
	}
	switch support.class {
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY:
		pushRecommendationCode(&reasonCodes, reasonHostAttachedOnly)
	case runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED:
		pushRecommendationCode(&reasonCodes, reasonHostUnsupported)
	}
	if support.detail != "" {
		pushRecommendationNote(&notes, support.detail)
	}
	pushRecommendationCode(&reasonCodes, reasonLLMFITTpsEstimated)
	pushRecommendationNote(&notes, fmt.Sprintf("llmfit estimated %.1f tok/s via %s in %s mode.", estimateLLMTokensPerSecond(profile, requiredGB), llmRuntimeText(profile), llmRunModeText(profile, requiredGB)))
	pushRecommendationNote(&notes, fmt.Sprintf("Estimated memory %.1f GB against %.1f GB available.", requiredGB, availableGB))
	confidence := runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_LOW
	if candidate.mainSizeBytes > 0 && quant != "" && parameters > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_HIGH
	} else if candidate.mainSizeBytes > 0 || candidate.knownTotalSizeBytes > 0 {
		confidence = runtimev1.LocalRecommendationConfidence_LOCAL_RECOMMENDATION_CONFIDENCE_MEDIUM
	}
	return &runtimev1.LocalCatalogRecommendation{
		Source:           runtimev1.LocalRecommendationSource_LOCAL_RECOMMENDATION_SOURCE_LLMFIT,
		Format:           candidate.format,
		Tier:             tier,
		HostSupportClass: support.class,
		Confidence:       confidence,
		ReasonCodes:      reasonCodes,
		RecommendedEntry: candidate.entry,
		FallbackEntries:  append([]string(nil), candidate.fallbackEntries...),
		SuggestedNotes:   notes,
	}
}

func classifyRecommendationHostSupport(engine string, profile *runtimev1.LocalDeviceProfile) hostSupportDescriptor {
	normalized := strings.ToLower(strings.TrimSpace(engine))
	switch normalized {
	case "media":
		windowsX64 := strings.EqualFold(profile.GetOs(), "windows") &&
			(strings.EqualFold(profile.GetArch(), "amd64") || strings.EqualFold(profile.GetArch(), "x86_64"))
		if !windowsX64 {
			return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY, detail: "media supervised mode requires Windows x64; configure an attached endpoint instead"}
		}
		if !strings.EqualFold(profile.GetGpu().GetVendor(), "nvidia") {
			return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY, detail: "media supervised mode requires an NVIDIA GPU; configure an attached endpoint instead"}
		}
		if !profile.GetGpu().GetAvailable() {
			return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY, detail: "media supervised mode requires a CUDA-ready NVIDIA runtime; configure an attached endpoint instead"}
		}
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED}
	case "llama":
		supported := (strings.EqualFold(profile.GetOs(), "darwin") &&
			(strings.EqualFold(profile.GetArch(), "arm64") || strings.EqualFold(profile.GetArch(), "amd64") || strings.EqualFold(profile.GetArch(), "x86_64"))) ||
			(strings.EqualFold(profile.GetOs(), "linux") &&
				(strings.EqualFold(profile.GetArch(), "amd64") || strings.EqualFold(profile.GetArch(), "x86_64") || strings.EqualFold(profile.GetArch(), "arm64")))
		if supported {
			return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED}
		}
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY, detail: "llama supervised mode requires macOS or Linux; configure an attached endpoint instead"}
	case "speech":
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_SUPPORTED_SUPERVISED}
	default:
		return hostSupportDescriptor{class: runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED, detail: "unknown managed engine"}
	}
}

func mediaMemoryBudgetBytes(capability string, profile *runtimev1.LocalDeviceProfile, reasonCodes *[]string, notes *[]string) int64 {
	if normalizeRecommendationFeedCapability(capability) != "image" && normalizeRecommendationFeedCapability(capability) != "video" {
		return 0
	}
	gpu := profile.GetGpu()
	switch gpu.GetMemoryModel() {
	case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED:
		budget := gpu.GetAvailableVramBytes()
		if budget <= 0 {
			budget = profile.GetAvailableRamBytes()
		}
		if budget > 0 {
			pushRecommendationCode(reasonCodes, reasonUnifiedMemory)
			pushRecommendationNote(notes, fmt.Sprintf("Using unified memory estimate from host profile (available %s).", formatRecommendationGB(budget)))
		}
		return budget
	case runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_DISCRETE:
		return gpu.GetAvailableVramBytes()
	default:
		if gpu.GetAvailableVramBytes() > 0 {
			return gpu.GetAvailableVramBytes()
		}
		return profile.GetAvailableRamBytes()
	}
}

func mediaOverheadMultiplier(capability string, format runtimev1.LocalRecommendationFormat, engine string) float64 {
	capability = normalizeRecommendationFeedCapability(capability)
	engine = strings.ToLower(strings.TrimSpace(engine))
	switch {
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF && engine == "llama":
		return 1.5
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF:
		return 1.6
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS && engine == "media":
		return 2.2
	case capability == "image" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS:
		return 2.0
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_GGUF:
		return 2.2
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS && engine == "media":
		return 2.8
	case capability == "video" && format == runtimev1.LocalRecommendationFormat_LOCAL_RECOMMENDATION_FORMAT_SAFETENSORS:
		return 2.5
	case capability == "image":
		return 1.8
	case capability == "video":
		return 2.6
	default:
		return 1.0
	}
}

func recommendationTierForBudget(estimate int64, budget int64, reasonCodes *[]string, notes *[]string) runtimev1.LocalRecommendationTier {
	if estimate <= 0 || budget <= 0 {
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_UNSPECIFIED
	}
	ratio := float64(estimate) / float64(budget)
	pushRecommendationNote(notes, fmt.Sprintf("Estimated memory %s against available host budget %s.", formatRecommendationGB(estimate), formatRecommendationGB(budget)))
	switch {
	case ratio <= 0.70:
		pushRecommendationCode(reasonCodes, reasonMemoryRecommended)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RECOMMENDED
	case ratio <= 0.85:
		pushRecommendationCode(reasonCodes, reasonMemoryRunnable)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_RUNNABLE
	case ratio <= 1.0:
		pushRecommendationCode(reasonCodes, reasonMemoryTight)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_TIGHT
	default:
		pushRecommendationCode(reasonCodes, reasonMemoryExceeded)
		return runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_NOT_RECOMMENDED
	}
}

func formatRecommendationGB(bytes int64) string {
	return fmt.Sprintf("%.1f GB", float64(bytes)/recommendationBytesPerGiB)
}

func quantHintFromEntry(entry string) string {
	upper := strings.ToUpper(strings.TrimSpace(entry))
	for _, token := range []string{"Q2", "Q3", "Q4", "Q5", "Q6", "Q8", "IQ1", "IQ2", "IQ3", "IQ4"} {
		if strings.Contains(upper, token) {
			return token
		}
	}
	return ""
}

func llmQuantHint(candidate recommendationCandidate) string {
	for _, text := range []string{candidate.entry, candidate.title, candidate.modelID, candidate.repo} {
		upper := strings.ToUpper(text)
		for _, row := range []struct{ needle, output string }{
			{"Q8_0", "Q8_0"},
			{"Q6_K", "Q6_K"},
			{"Q5_K_M", "Q5_K_M"},
			{"Q4_K_M", "Q4_K_M"},
			{"Q4_0", "Q4_0"},
			{"Q3_K_M", "Q3_K_M"},
			{"Q2_K", "Q2_K"},
			{"BF16", "BF16"},
			{"F16", "F16"},
			{"AWQ-4BIT", "AWQ-4bit"},
			{"AWQ-8BIT", "AWQ-8bit"},
			{"GPTQ-INT4", "GPTQ-Int4"},
			{"GPTQ-INT8", "GPTQ-Int8"},
		} {
			if strings.Contains(upper, row.needle) {
				return row.output
			}
		}
	}
	return quantHintFromEntry(candidate.entry)
}

func parseSuffixNumber(input string, suffix byte) (float64, bool) {
	lower := strings.ToLower(input)
	best := 0.0
	found := false
	for index := 0; index < len(lower); index++ {
		if (lower[index] < '0' || lower[index] > '9') && lower[index] != '.' {
			continue
		}
		start := index
		dot := lower[index] == '.'
		index++
		for index < len(lower) {
			ch := lower[index]
			if ch >= '0' && ch <= '9' {
				index++
				continue
			}
			if ch == '.' && !dot {
				dot = true
				index++
				continue
			}
			break
		}
		if index >= len(lower) || lower[index] != suffix {
			continue
		}
		var value float64
		if _, err := fmt.Sscanf(lower[start:index], "%f", &value); err == nil {
			if !found || value > best {
				best = value
			}
			found = true
		}
	}
	return best, found
}

func inferParameters(candidate recommendationCandidate, quant string) (uint64, bool) {
	for _, text := range []string{candidate.entry, candidate.title, candidate.modelID, candidate.repo, strings.Join(candidate.tags, " ")} {
		if value, ok := parseSuffixNumber(text, 'b'); ok {
			return uint64(math.Round(value * 1_000_000_000)), true
		}
		if value, ok := parseSuffixNumber(text, 'm'); ok {
			return uint64(math.Round(value * 1_000_000)), true
		}
	}
	size := candidate.mainSizeBytes
	if size <= 0 {
		size = candidate.knownTotalSizeBytes
	}
	if size <= 0 {
		return 0, false
	}
	bpp := quantBytesPerParam(defaultString(quant, "Q4_K_M"))
	if bpp <= 0 {
		bpp = 0.5
	}
	return uint64(math.Max(1, math.Round(float64(size)/bpp))), false
}

func quantBytesPerParam(quant string) float64 {
	upper := strings.ToUpper(strings.TrimSpace(quant))
	switch {
	case strings.Contains(upper, "Q8"), strings.Contains(upper, "INT8"):
		return 1.0
	case strings.Contains(upper, "Q6"):
		return 0.75
	case strings.Contains(upper, "Q5"):
		return 0.625
	case strings.Contains(upper, "Q4"), strings.Contains(upper, "INT4"), strings.Contains(upper, "4BIT"):
		return 0.5
	case strings.Contains(upper, "Q3"):
		return 0.375
	case strings.Contains(upper, "Q2"):
		return 0.25
	case strings.Contains(upper, "BF16"), strings.Contains(upper, "F16"):
		return 2.0
	default:
		return 0.5
	}
}

func inferContextLength(candidate recommendationCandidate) (uint32, bool) {
	for _, tag := range candidate.tags {
		lower := strings.ToLower(tag)
		if !strings.Contains(lower, "context") && !strings.Contains(lower, "ctx") && !strings.HasSuffix(lower, "k") {
			continue
		}
		if value, ok := parseSuffixNumber(lower, 'k'); ok {
			tokens := uint32(math.Round(value * 1024))
			if tokens >= 1024 {
				return tokens, false
			}
		}
	}
	return 4096, true
}

func hasVisionHint(candidate recommendationCandidate) bool {
	haystack := strings.ToLower(strings.Join([]string{candidate.modelID, candidate.repo, candidate.title, strings.Join(candidate.tags, " ")}, " "))
	return strings.Contains(haystack, "vision") ||
		strings.Contains(haystack, "-vl-") ||
		strings.Contains(haystack, " llava") ||
		strings.Contains(haystack, "pixtral") ||
		strings.Contains(haystack, "multimodal") ||
		strings.Contains(haystack, "onevision")
}

func llmAvailableMemoryGB(profile *runtimev1.LocalDeviceProfile) float64 {
	gpu := profile.GetGpu()
	if gpu.GetAvailableVramBytes() > 0 {
		return float64(gpu.GetAvailableVramBytes()) / recommendationBytesPerGiB
	}
	if profile.GetAvailableRamBytes() > 0 {
		return float64(profile.GetAvailableRamBytes()) / recommendationBytesPerGiB
	}
	if profile.GetTotalRamBytes() > 0 {
		return float64(profile.GetTotalRamBytes()) / recommendationBytesPerGiB
	}
	return 0
}

func llmRunMode(profile *runtimev1.LocalDeviceProfile, requiredGB float64) string {
	gpu := profile.GetGpu()
	vramGB := float64(gpu.GetAvailableVramBytes()) / recommendationBytesPerGiB
	if gpu.GetAvailable() && vramGB >= requiredGB {
		return "gpu"
	}
	if gpu.GetAvailable() && vramGB > 0 {
		return "cpu-offload"
	}
	return "cpu"
}

func llmRuntimeText(profile *runtimev1.LocalDeviceProfile) string {
	gpu := profile.GetGpu()
	if gpu.GetMemoryModel() == runtimev1.GpuMemoryModel_GPU_MEMORY_MODEL_UNIFIED || strings.EqualFold(profile.GetOs(), "darwin") {
		return "metal"
	}
	switch strings.ToLower(strings.TrimSpace(gpu.GetVendor())) {
	case "nvidia":
		return "cuda"
	case "amd":
		return "rocm"
	case "intel":
		return "sycl"
	default:
		return "cpu"
	}
}

func llmRunModeText(profile *runtimev1.LocalDeviceProfile, requiredGB float64) string {
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		return "gpu"
	case "cpu-offload":
		return "cpu offload"
	default:
		return "cpu only"
	}
}

func estimateLLMTokensPerSecond(profile *runtimev1.LocalDeviceProfile, requiredGB float64) float64 {
	base := 6.0
	switch llmRunMode(profile, requiredGB) {
	case "gpu":
		base = 22.0
	case "cpu-offload":
		base = 12.0
	}
	if requiredGB <= 4 {
		return base * 1.4
	}
	if requiredGB >= 32 {
		return base * 0.45
	}
	return base
}

func companionSuggestions(candidate recommendationCandidate, verifiedAssets []*runtimev1.LocalVerifiedAssetDescriptor) []*runtimev1.LocalSuggestedAsset {
	haystack := strings.ToLower(strings.Join([]string{candidate.modelID, candidate.repo, candidate.title, strings.Join(candidate.tags, " ")}, " "))
	if !strings.Contains(haystack, "z-image") {
		return nil
	}
	items := make([]*runtimev1.LocalSuggestedAsset, 0)
	for _, asset := range verifiedAssets {
		if asset == nil {
			continue
		}
		family := ""
		if meta := asset.GetMetadata(); meta != nil {
			if value := meta.GetFields()["family"]; value != nil {
				family = value.GetStringValue()
			}
		}
		if family != "z-image" {
			continue
		}
		items = append(items, &runtimev1.LocalSuggestedAsset{
			TemplateId: asset.GetTemplateId(),
			AssetId:    asset.GetAssetId(),
			Kind:       strings.TrimPrefix(strings.ToLower(asset.GetKind().String()), "local_asset_kind_"),
			Family:     family,
		})
	}
	return items
}

func pushRecommendationCode(codes *[]string, code string) {
	code = strings.TrimSpace(code)
	if code == "" {
		return
	}
	for _, item := range *codes {
		if item == code {
			return
		}
	}
	*codes = append(*codes, code)
}

func pushRecommendationNote(notes *[]string, note string) {
	note = strings.TrimSpace(note)
	if note == "" {
		return
	}
	for _, item := range *notes {
		if item == note {
			return
		}
	}
	*notes = append(*notes, note)
}
