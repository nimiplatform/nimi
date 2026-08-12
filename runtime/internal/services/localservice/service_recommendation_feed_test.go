package localservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	svc.mu.Lock()
	svc.assets["local_chat"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "local_chat",
		AssetId:      "repo/small",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT,
		Source:       &runtimev1.LocalAssetSource{Repo: "repo/small", Revision: "main"},
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
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
	if !item.GetActionState().GetCanOpenLocalAsset() {
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
