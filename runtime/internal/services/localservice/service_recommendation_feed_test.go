package localservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRecommendationFeedFetchesRemoteAndBuildsInstallPayload(t *testing.T) {
	svc := newTestService(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/leaderboard" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("capability") != "chat" {
			t.Fatalf("unexpected capability: %s", r.URL.Query().Get("capability"))
		}
		writeRecommendationFeed(t, w, remoteLeaderboardResponse{
			SchemaVersion: "2.0.0",
			GeneratedAt:   "2026-05-27T00:00:00Z",
			Capability:    "chat",
			Page:          1,
			PageSize:      48,
			Total:         2,
			Items: []remoteModelEntry{
				recommendationChatItem("repo/large", "Large", "large-Q8_0.gguf", 96*1024*1024*1024),
				recommendationChatItem("repo/small", "Small", "small-Q4_K_M.gguf", 4*1024*1024*1024),
			},
		})
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	resp, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{
		Capability: "text.generate",
		PageSize:   48,
	})
	if err != nil {
		t.Fatalf("get recommendation feed: %v", err)
	}
	feed := resp.GetFeed()
	if feed.GetCacheState() != runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH {
		t.Fatalf("cache state = %s", feed.GetCacheState())
	}
	if feed.GetActiveCapability() != runtimev1.LocalRecommendationFeedCapability_LOCAL_RECOMMENDATION_FEED_CAPABILITY_CHAT {
		t.Fatalf("active capability = %s", feed.GetActiveCapability())
	}
	if len(feed.GetItems()) != 2 {
		t.Fatalf("items = %d", len(feed.GetItems()))
	}
	first := feed.GetItems()[0]
	if first.GetRepo() != "repo/small" {
		t.Fatalf("expected small model first, got %s", first.GetRepo())
	}
	if first.GetSource() != runtimev1.LocalRecommendationFeedSource_LOCAL_RECOMMENDATION_FEED_SOURCE_MODEL_INDEX {
		t.Fatalf("source = %s", first.GetSource())
	}
	if first.GetInstallPayload().GetKind() != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT {
		t.Fatalf("install payload kind = %s", first.GetInstallPayload().GetKind())
	}
	if !first.GetActionState().GetCanReviewInstallPlan() {
		t.Fatalf("expected review-install-plan action")
	}
	if first.GetRecommendation().GetTier() == runtimev1.LocalRecommendationTier_LOCAL_RECOMMENDATION_TIER_UNSPECIFIED {
		t.Fatalf("expected recommendation tier")
	}
}

func TestRecommendationFeedFallsBackToStaleCache(t *testing.T) {
	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{
		FetchedAt: "2026-05-27T00:00:00Z",
		Feeds: map[string]remoteLeaderboardResponse{
			"image": {
				SchemaVersion: "2.0.0",
				GeneratedAt:   "2026-05-27T00:00:00Z",
				Capability:    "image",
				Page:          1,
				PageSize:      1,
				Total:         1,
				Items: []remoteModelEntry{
					recommendationImageItem("repo/image", "Image", "model.safetensors", 6*1024*1024*1024),
				},
			},
		},
	}); err != nil {
		t.Fatalf("save cache: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "offline", http.StatusBadGateway)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	resp, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{Capability: "image"})
	if err != nil {
		t.Fatalf("get recommendation feed: %v", err)
	}
	feed := resp.GetFeed()
	if feed.GetCacheState() != runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_STALE {
		t.Fatalf("cache state = %s", feed.GetCacheState())
	}
	if len(feed.GetItems()) != 1 || feed.GetItems()[0].GetRepo() != "repo/image" {
		t.Fatalf("unexpected cached items: %#v", feed.GetItems())
	}
}

func TestRecommendationFeedProjectsInstalledState(t *testing.T) {
	svc := newTestService(t)
	provenance, err := structpb.NewStruct(map[string]any{"source_repo": "repo/small"})
	if err != nil {
		t.Fatalf("build provenance: %v", err)
	}
	svc.mu.Lock()
	svc.modelAssets["model_chat"] = &runtimev1.ModelAssetRecord{
		ModelAssetId:    "model_chat",
		ContentId:       "sha256:test",
		ContentVerified: true,
		Provenance:      provenance,
	}
	svc.mu.Unlock()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeRecommendationFeed(t, w, remoteLeaderboardResponse{
			SchemaVersion: "2.0.0",
			GeneratedAt:   "2026-05-27T00:00:00Z",
			Capability:    "chat",
			Page:          1,
			PageSize:      1,
			Total:         1,
			Items: []remoteModelEntry{
				recommendationChatItem("repo/small", "Small", "small-Q4_K_M.gguf", 4*1024*1024*1024),
			},
		})
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	resp, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{Capability: "text.generate"})
	if err != nil {
		t.Fatalf("get recommendation feed: %v", err)
	}
	item := resp.GetFeed().GetItems()[0]
	if !item.GetInstalledState().GetInstalled() {
		t.Fatalf("expected installed state")
	}
	if item.GetActionState().GetCanReviewInstallPlan() {
		t.Fatalf("installed item must not review install plan")
	}
	if !item.GetActionState().GetCanOpenModelAsset() {
		t.Fatalf("installed item should open local asset")
	}
}

func TestRecommendationHostSupportUsesManagedEngineAuthority(t *testing.T) {
	media := classifyRecommendationHostSupport("media", nil)
	if media.class != runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_UNSUPPORTED {
		t.Fatalf("media host support without profile = %s, want unsupported", media.class)
	}
	if media.detail != "device profile unavailable" {
		t.Fatalf("media detail = %q", media.detail)
	}

	speech := classifyRecommendationHostSupport("speech", &runtimev1.LocalDeviceProfile{Os: "freebsd", Arch: "amd64"})
	if speech.class != runtimev1.LocalHostSupportClass_LOCAL_HOST_SUPPORT_CLASS_ATTACHED_ONLY {
		t.Fatalf("speech host support on unsupported platform = %s, want attached-only", speech.class)
	}
	if speech.detail == "" {
		t.Fatalf("speech host support should project managed-engine detail")
	}
}

func TestRecommendationFeedServesFreshCacheWithoutSyncFetch(t *testing.T) {
	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{
		FetchedAt: nowISO(),
		Feeds: map[string]remoteLeaderboardResponse{
			"chat": {
				SchemaVersion: "2.0.0",
				GeneratedAt:   "2026-05-27T00:00:00Z",
				Capability:    "chat",
				Page:          1,
				PageSize:      1,
				Total:         1,
				Items: []remoteModelEntry{
					recommendationChatItem("repo/cached", "Cached", "cached-Q4_K_M.gguf", 4*1024*1024*1024),
				},
			},
		},
	}); err != nil {
		t.Fatalf("save cache: %v", err)
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		writeRecommendationFeed(t, w, remoteLeaderboardResponse{
			SchemaVersion: "2.0.0",
			GeneratedAt:   "2026-05-28T00:00:00Z",
			Capability:    "chat",
			Page:          1,
			PageSize:      1,
			Total:         1,
			Items: []remoteModelEntry{
				recommendationChatItem("repo/remote", "Remote", "remote-Q4_K_M.gguf", 4*1024*1024*1024),
			},
		})
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	resp, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{Capability: "chat"})
	if err != nil {
		t.Fatalf("get recommendation feed: %v", err)
	}
	feed := resp.GetFeed()
	if feed.GetCacheState() != runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH {
		t.Fatalf("cache state = %s", feed.GetCacheState())
	}
	if len(feed.GetItems()) != 1 || feed.GetItems()[0].GetRepo() != "repo/cached" {
		t.Fatalf("expected cached feed items, got %#v", feed.GetItems())
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		cache := svc.loadModelIndexCache()
		if entry, ok := cache.Feeds["chat"]; ok && len(entry.Items) == 1 && entry.Items[0].Repo == "repo/remote" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("background refresh did not persist refreshed cache (requests = %d)", requests.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
	if requests.Load() != 1 {
		t.Fatalf("expected exactly one background refresh request, got %d", requests.Load())
	}
}

func TestRecommendationFeedFetchesWhenCacheExpired(t *testing.T) {
	svc := newTestService(t)
	expired := time.Now().UTC().Add(-(modelIndexFreshWindow + time.Hour)).Format(time.RFC3339Nano)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{
		FetchedAt: expired,
		Feeds: map[string]remoteLeaderboardResponse{
			"chat": {
				SchemaVersion: "2.0.0",
				GeneratedAt:   "2026-05-27T00:00:00Z",
				Capability:    "chat",
				Page:          1,
				PageSize:      1,
				Total:         1,
				Items: []remoteModelEntry{
					recommendationChatItem("repo/cached", "Cached", "cached-Q4_K_M.gguf", 4*1024*1024*1024),
				},
			},
		},
	}); err != nil {
		t.Fatalf("save cache: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeRecommendationFeed(t, w, remoteLeaderboardResponse{
			SchemaVersion: "2.0.0",
			GeneratedAt:   "2026-05-28T00:00:00Z",
			Capability:    "chat",
			Page:          1,
			PageSize:      1,
			Total:         1,
			Items: []remoteModelEntry{
				recommendationChatItem("repo/remote", "Remote", "remote-Q4_K_M.gguf", 4*1024*1024*1024),
			},
		})
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	resp, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{Capability: "chat"})
	if err != nil {
		t.Fatalf("get recommendation feed: %v", err)
	}
	feed := resp.GetFeed()
	if feed.GetCacheState() != runtimev1.LocalRecommendationFeedCacheState_LOCAL_RECOMMENDATION_FEED_CACHE_STATE_FRESH {
		t.Fatalf("cache state = %s", feed.GetCacheState())
	}
	if len(feed.GetItems()) != 1 || feed.GetItems()[0].GetRepo() != "repo/remote" {
		t.Fatalf("expected network feed items, got %#v", feed.GetItems())
	}
}

func TestRecommendationFeedBackgroundRefreshSingleFlight(t *testing.T) {
	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{
		FetchedAt: nowISO(),
		Feeds: map[string]remoteLeaderboardResponse{
			"chat": {
				SchemaVersion: "2.0.0",
				GeneratedAt:   "2026-05-27T00:00:00Z",
				Capability:    "chat",
				Page:          1,
				PageSize:      1,
				Total:         1,
				Items: []remoteModelEntry{
					recommendationChatItem("repo/cached", "Cached", "cached-Q4_K_M.gguf", 4*1024*1024*1024),
				},
			},
		},
	}); err != nil {
		t.Fatalf("save cache: %v", err)
	}
	release := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		<-release
		writeRecommendationFeed(t, w, remoteLeaderboardResponse{
			SchemaVersion: "2.0.0",
			GeneratedAt:   "2026-05-28T00:00:00Z",
			Capability:    "chat",
			Page:          1,
			PageSize:      1,
			Total:         1,
			Items: []remoteModelEntry{
				recommendationChatItem("repo/remote", "Remote", "remote-Q4_K_M.gguf", 4*1024*1024*1024),
			},
		})
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	for i := 0; i < 2; i++ {
		if _, err := svc.GetRecommendationFeed(context.Background(), &runtimev1.GetRecommendationFeedRequest{Capability: "chat"}); err != nil {
			t.Fatalf("get recommendation feed: %v", err)
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for requests.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	close(release)
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected single-flight background refresh, got %d requests", got)
	}
	for time.Now().Before(deadline) {
		svc.modelIndexRefreshMu.Lock()
		inFlight := svc.modelIndexRefreshInFlight["chat"]
		svc.modelIndexRefreshMu.Unlock()
		if !inFlight {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("background refresh did not finish")
}

func TestDeviceProfileSnapshotCachesWithinTTL(t *testing.T) {
	svc := newTestService(t)
	first := svc.deviceProfileSnapshot()
	if first == nil {
		t.Fatalf("expected device profile")
	}
	if second := svc.deviceProfileSnapshot(); second != first {
		t.Fatalf("expected cached device profile within TTL")
	}
	svc.deviceProfileMu.Lock()
	svc.deviceProfileCachedAt = time.Now().Add(-(deviceProfileCacheTTL + time.Minute))
	svc.deviceProfileMu.Unlock()
	if third := svc.deviceProfileSnapshot(); third == first {
		t.Fatalf("expected re-probe after TTL expiry")
	}
}

func recommendationChatItem(repo string, title string, entry string, size int64) remoteModelEntry {
	return remoteModelEntry{
		Repo:         repo,
		Revision:     "main",
		Title:        title,
		Capabilities: []string{"text.generate"},
		Tags:         []string{"gguf"},
		Formats:      []string{"gguf"},
		Entries: []remoteInstallEntry{{
			EntryID:        "main",
			Format:         "gguf",
			Entry:          entry,
			TotalSizeBytes: size,
			Files:          []remoteModelFile{{Path: entry, SizeBytes: size}},
		}},
	}
}

func recommendationImageItem(repo string, title string, entry string, size int64) remoteModelEntry {
	return remoteModelEntry{
		Repo:         repo,
		Revision:     "main",
		Title:        title,
		Capabilities: []string{"image.generate"},
		Tags:         []string{"safetensors"},
		Formats:      []string{"safetensors"},
		Entries: []remoteInstallEntry{{
			EntryID:        "main",
			Format:         "safetensors",
			Entry:          entry,
			TotalSizeBytes: size,
			Files:          []remoteModelFile{{Path: entry, SizeBytes: size}},
		}},
	}
}

func writeRecommendationFeed(t *testing.T, w http.ResponseWriter, feed remoteLeaderboardResponse) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(feed); err != nil {
		t.Fatalf("encode feed: %v", err)
	}
}
