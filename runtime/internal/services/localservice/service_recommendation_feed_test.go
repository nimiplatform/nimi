package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func readModelIndexV3Vector(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "model-index-v3.raw"))
	if err != nil {
		t.Fatalf("read model-index v3 vector: %v", err)
	}
	return raw
}

func decodeModelIndexV3Vector(t *testing.T) *remoteModelIndex {
	t.Helper()
	var index remoteModelIndex
	decoder := json.NewDecoder(strings.NewReader(string(readModelIndexV3Vector(t))))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&index); err != nil {
		t.Fatalf("decode actual Worker vector: %v", err)
	}
	return &index
}

func TestModelIndexV3RawVectorProducesExactOffer(t *testing.T) {
	index := decodeModelIndexV3Vector(t)
	if err := validateRemoteModelIndex(index, nil); err != nil {
		t.Fatalf("validate actual Worker vector: %v", err)
	}
	offers, err := modelIndexOffers(index)
	if err != nil {
		t.Fatalf("project offers: %v", err)
	}
	if len(offers) != 1 {
		t.Fatalf("offers=%d, want 1", len(offers))
	}
	offer := offers[0]
	if offer.identity.sourceKind != "model-index" || offer.identity.locator != "test/model" || offer.identity.revision != immutableHFRevisionForTest ||
		offer.identity.entryID != "gguf:model-Q4_K_M.gguf" || offer.entryPath != "model-Q4_K_M.gguf" {
		t.Fatalf("offer identity=%+v", offer.identity)
	}
	if !catalogOfferInstallable(offer) || offer.featuredOrdinal == nil || *offer.featuredOrdinal != 0 {
		t.Fatalf("offer projection=%+v", offer)
	}
}

func TestCatalogDetailReusesAdoptedFeaturedOfferRefAndFacts(t *testing.T) {
	index := decodeModelIndexV3Vector(t)
	featured, err := modelIndexOffers(index)
	if err != nil || len(featured) != 1 {
		t.Fatalf("featured offers=%d err=%v", len(featured), err)
	}
	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: index}); err != nil {
		t.Fatal(err)
	}
	svc.hfCatalogVariants = func(context.Context, string, string) ([]hfCatalogVariant, error) {
		t.Fatal("indexed detail fell through to direct Hugging Face reconstruction")
		return nil, nil
	}
	locator, err := newModelAssetModelLocator("huggingface", index.Models[0].Repo, index.Models[0].Revision)
	if err != nil {
		t.Fatal(err)
	}
	response, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{ModelLocator: locator})
	want := svc.projectMarketCandidate(featured[0])
	if err != nil || len(response.GetVariants()) != 1 || !proto.Equal(response.GetVariants()[0], want) {
		t.Fatalf("indexed catalog detail=%+v err=%v", response, err)
	}
}

func TestModelIndexSemanticValidationRejectsInvalidGenerationAndKeepsMissingHashBrowseOnly(t *testing.T) {
	invalid := decodeModelIndexV3Vector(t)
	invalid.Generation = "not-a-generation"
	if err := validateRemoteModelIndex(invalid, nil); err == nil {
		t.Fatal("invalid generation was accepted")
	}
	missingHash := decodeModelIndexV3Vector(t)
	missingHash.Models[0].Entries[0].Files[0].SHA256 = ""
	missingHash.Models[0].Entries[0].SHA256 = ""
	if err := validateRemoteModelIndex(missingHash, nil); err != nil {
		t.Fatalf("source-legal missing hash rejected whole generation: %v", err)
	}
	offers, err := modelIndexOffers(missingHash)
	if err != nil || len(offers) != 1 {
		t.Fatalf("missing-hash offers=%d err=%v", len(offers), err)
	}
	if catalogOfferInstallable(offers[0]) {
		t.Fatal("missing-hash offer became installable")
	}
	negativeOrdinal := decodeModelIndexV3Vector(t)
	ordinal := int32(-1)
	negativeOrdinal.Models[0].FeaturedOrdinal = &ordinal
	if err := validateRemoteModelIndex(negativeOrdinal, nil); err == nil {
		t.Fatal("negative featured ordinal was accepted")
	}
	for _, test := range []struct {
		name   string
		mutate func(*remoteModelIndex)
	}{
		{name: "ordinal-only", mutate: func(index *remoteModelIndex) { index.Models[0].EditorialReason = "" }},
		{name: "reason-only", mutate: func(index *remoteModelIndex) { index.Models[0].FeaturedOrdinal = nil }},
	} {
		t.Run(test.name, func(t *testing.T) {
			index := decodeModelIndexV3Vector(t)
			test.mutate(index)
			if err := validateRemoteModelIndex(index, nil); err == nil {
				t.Fatal("unpaired featured metadata was accepted")
			}
		})
	}
	presentationOnly := decodeModelIndexV3Vector(t)
	presentationOnly.Models[0].Categories = []string{"image"}
	offers, err = modelIndexOffers(presentationOnly)
	if err != nil || len(offers) != 1 {
		t.Fatalf("presentation-only category projection failed: offers=%d err=%v", len(offers), err)
	}
	if !stringSetContains(offers[0].capabilities, "text.generate") || stringSetContains(offers[0].capabilities, "image.generate") {
		t.Fatalf("presentation category became capability truth: categories=%v capabilities=%v", offers[0].categories, offers[0].capabilities)
	}
}

func TestListFeaturedModelAssetsProjectsFreshAndStaleLKG(t *testing.T) {
	index := decodeModelIndexV3Vector(t)
	index.GeneratedAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	raw, err := json.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	serveOK := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.json" || !serveOK {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write(raw)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)
	svc := newTestService(t)

	fresh, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "chat"})
	if err != nil {
		t.Fatalf("fresh featured: %v", err)
	}
	if fresh.GetSource().GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_AVAILABLE ||
		fresh.GetSource().GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_FRESH ||
		fresh.GetSource().GetGeneration() != index.Generation || len(fresh.GetItems()) != 1 {
		t.Fatalf("fresh response=%+v", fresh)
	}
	if fresh.GetItems()[0].GetOfferRef() == "" || !fresh.GetItems()[0].GetInstallable() {
		t.Fatalf("featured item=%+v", fresh.GetItems()[0])
	}

	serveOK = false
	stale, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "chat", ForceRefresh: true})
	if err != nil {
		t.Fatalf("stale featured: %v", err)
	}
	if stale.GetSource().GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE ||
		stale.GetSource().GetReasonCode() != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE ||
		len(stale.GetItems()) != 1 {
		t.Fatalf("stale response=%+v", stale)
	}

	serveOK = true
	revalidated, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "chat", ForceRefresh: true})
	if err != nil {
		t.Fatalf("same generation refetch: %v", err)
	}
	if revalidated.GetSource().GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_FRESH || svc.loadModelIndexCache().Stale {
		t.Fatalf("same generation revalidation did not recover freshness: %+v", revalidated.GetSource())
	}
}

func TestListFeaturedModelAssetsColdFailureIsUnavailableNotEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)
	svc := newTestService(t)

	response, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "image"})
	if err != nil {
		t.Fatalf("featured unavailable: %v", err)
	}
	if response.GetSource().GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_UNAVAILABLE ||
		response.GetSource().GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_UNSPECIFIED ||
		len(response.GetItems()) != 0 {
		t.Fatalf("unavailable response=%+v", response)
	}
}

func TestOfferIdentityExcludesGenerationAndRejectsFactCollision(t *testing.T) {
	before := decodeModelIndexV3Vector(t)
	after := decodeModelIndexV3Vector(t)
	after.Generation = "22222222-2222-4222-8222-222222222222"
	beforeOffers, _ := modelIndexOffers(before)
	afterOffers, _ := modelIndexOffers(after)
	if beforeOffers[0].offerRef != afterOffers[0].offerRef {
		t.Fatalf("generation changed offer_ref: %q != %q", beforeOffers[0].offerRef, afterOffers[0].offerRef)
	}
	after.Models[0].Revision = strings.Repeat("b", 40)
	revised, _ := modelIndexOffers(after)
	if revised[0].offerRef == beforeOffers[0].offerRef {
		t.Fatal("source revision did not change offer_ref")
	}
	collision := decodeModelIndexV3Vector(t)
	collision.Generation = "33333333-3333-4333-8333-333333333333"
	collision.Models[0].Entries[0].Files[0].SHA256 = "sha256:" + strings.Repeat("b", 64)
	if err := validateRemoteModelIndex(collision, before); err == nil {
		t.Fatal("same offer_ref remapped to different acquisition facts")
	}
	parsed, err := parseModelAssetOfferRef(beforeOffers[0].offerRef)
	if err != nil {
		t.Fatalf("parse offer ref: %v", err)
	}
	restarted, err := newModelAssetOfferRef(parsed)
	if err != nil || restarted != beforeOffers[0].offerRef {
		t.Fatalf("restart reconstruction=%q err=%v", restarted, err)
	}
}

func TestRemovedModelIndexOfferRefFailsTypedAfterGenerationAdoption(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogVariants = func(context.Context, string, string) ([]hfCatalogVariant, error) {
		return nil, errors.New("source tuple removed")
	}
	generationA := decodeModelIndexV3Vector(t)
	offers, err := modelIndexOffers(generationA)
	if err != nil || len(offers) != 1 {
		t.Fatalf("generation A offers=%d err=%v", len(offers), err)
	}
	oldRef := offers[0].offerRef
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: generationA}); err != nil {
		t.Fatal(err)
	}
	if resolved, err := svc.resolveCatalogOffer(context.Background(), oldRef); err != nil || resolved.offerRef != oldRef {
		t.Fatalf("generation A resolve=%+v err=%v", resolved, err)
	}

	generationB := decodeModelIndexV3Vector(t)
	generationB.Generation = "22222222-2222-4222-8222-222222222222"
	generationB.GeneratedAt = time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)
	generationB.Models[0].Entries = nil
	if err := validateRemoteModelIndex(generationB, generationA); err != nil {
		t.Fatalf("generation B validation: %v", err)
	}
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: generationB}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.resolveCatalogOffer(context.Background(), oldRef)
	if status.Code(err) != codes.NotFound {
		t.Fatalf("removed offer resolve=%v, want typed NotFound", err)
	}
	assertGRPCReasonCode(t, err, "removed model-index offer", runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND)
	model := generationB.Models[0]
	locator, err := newModelAssetModelLocator("huggingface", model.Repo, model.Revision)
	if err != nil {
		t.Fatal(err)
	}
	variants, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{ModelLocator: locator})
	if err != nil || len(variants.GetVariants()) != 0 {
		t.Fatalf("adopted empty offers must not fall through to HF: %+v err=%v", variants, err)
	}

}

func TestModelIndexAdoptionRejectsRollbackAndCacheWriteFailure(t *testing.T) {
	previous := decodeModelIndexV3Vector(t)
	previous.GeneratedAt = time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339Nano)
	next := decodeModelIndexV3Vector(t)
	next.Generation = "22222222-2222-4222-8222-222222222222"
	next.GeneratedAt = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)

	serverPayload, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(serverPayload)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: previous}); err != nil {
		t.Fatal(err)
	}
	svc.modelIndexCacheWrite = func(string, []byte) error { return os.ErrPermission }
	index, freshness, reason := svc.resolveModelIndex(context.Background())
	if index == nil || index.Generation != previous.Generation ||
		freshness != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE ||
		reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE {
		t.Fatalf("cache write failure adopted new generation: generation=%v freshness=%v reason=%v", index, freshness, reason)
	}

	rollback := decodeModelIndexV3Vector(t)
	rollback.Generation = "33333333-3333-4333-8333-333333333333"
	rollback.GeneratedAt = time.Now().UTC().Add(-3 * time.Hour).Format(time.RFC3339Nano)
	if err := validateRemoteModelIndex(rollback, previous); err == nil {
		t.Fatal("older generatedAt replaced last-known-good")
	}
	mutated := decodeModelIndexV3Vector(t)
	mutated.GeneratedAt = previous.GeneratedAt
	mutated.Models[0].Downloads++
	if err := validateRemoteModelIndex(mutated, previous); err == nil {
		t.Fatal("same generation mutated in place")
	}
}

func TestConcurrentModelIndexRefreshCannotCommitAnOlderGenerationLast(t *testing.T) {
	generationA := decodeModelIndexV3Vector(t)
	generationA.GeneratedAt = time.Now().UTC().Add(-3 * time.Minute).Format(time.RFC3339Nano)
	generationB := decodeModelIndexV3Vector(t)
	generationB.Generation = "22222222-2222-4222-8222-222222222222"
	generationB.GeneratedAt = time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano)
	generationC := decodeModelIndexV3Vector(t)
	generationC.Generation = "33333333-3333-4333-8333-333333333333"
	generationC.GeneratedAt = time.Now().UTC().Add(-time.Minute).Format(time.RFC3339Nano)
	rawB, _ := json.Marshal(generationB)
	rawC, _ := json.Marshal(generationC)

	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			close(firstStarted)
			<-releaseFirst
			_, _ = w.Write(rawB)
			return
		}
		_, _ = w.Write(rawC)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)
	svc := newTestService(t)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: generationA}); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{}, 2)
	go func() { svc.resolveModelIndex(context.Background()); done <- struct{}{} }()
	<-firstStarted
	go func() { svc.resolveModelIndex(context.Background()); done <- struct{}{} }()
	time.AfterFunc(50*time.Millisecond, func() { close(releaseFirst) })
	<-done
	<-done

	adopted := svc.loadModelIndexCache()
	if adopted.Index == nil || adopted.Index.Generation != generationC.Generation {
		t.Fatalf("concurrent refresh rolled back final generation: %+v", adopted.Index)
	}
}

func TestListFeaturedModelAssetsReturnsSnapshotFirstCoalescesRoundAndUpdates(t *testing.T) {
	staleSnapshot := decodeModelIndexV3Vector(t)
	staleSnapshot.GeneratedAt = time.Now().UTC().Add(-26 * time.Hour).Format(time.RFC3339Nano)
	staleSnapshot.Models[0].Categories = []string{"chat", "image", "video"}
	ineligible := staleSnapshot.Models[0]
	ineligible.Repo = "test/missing-hash-model"
	ineligible.Title = "Missing Hash Model"
	ineligible.FeaturedOrdinal = nil
	ineligible.EditorialReason = ""
	ineligible.Entries = []remoteInstallEntry{{
		EntryID:        "gguf:no-hash.gguf",
		Format:         "gguf",
		Entry:          "no-hash.gguf",
		TotalSizeBytes: 1024,
		Files:          []remoteModelFile{{Path: "no-hash.gguf", SizeBytes: 1024, DownloadURL: "https://huggingface.co/test/missing-hash-model/resolve/main/no-hash.gguf"}},
	}}
	staleSnapshot.Models = append(staleSnapshot.Models, ineligible)
	staleSnapshot.ModelCount = len(staleSnapshot.Models)

	generationB := decodeModelIndexV3Vector(t)
	generationB.Generation = "22222222-2222-4222-8222-222222222222"
	generationB.GeneratedAt = time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339Nano)
	generationB.Models[0].Categories = []string{"chat", "image", "video"}
	generationB.Models[0].Title = "Updated Model B"
	rawB, err := json.Marshal(generationB)
	if err != nil {
		t.Fatal(err)
	}

	generationC := decodeModelIndexV3Vector(t)
	generationC.Generation = "33333333-3333-4333-8333-333333333333"
	generationC.GeneratedAt = time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339Nano)
	generationC.Models[0].Categories = []string{"chat", "image", "video"}
	generationC.Models[0].Title = "Explicit Refresh Model C"
	rawC, err := json.Marshal(generationC)
	if err != nil {
		t.Fatal(err)
	}

	remoteStarted := make(chan struct{})
	releaseRemote := make(chan struct{})
	var serveGen atomic.Int32
	serveGen.Store(1)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.json" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		count := requests.Add(1)
		if count == 1 {
			close(remoteStarted)
			<-releaseRemote
		}
		if serveGen.Load() == 1 {
			_, _ = w.Write(rawB)
			return
		}
		_, _ = w.Write(rawC)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	svc := newTestService(t)
	t.Cleanup(svc.Close)
	if err := svc.saveModelIndexCache(modelIndexCacheRecord{FetchedAt: nowISO(), Index: staleSnapshot}); err != nil {
		t.Fatal(err)
	}

	categories := []string{"chat", "image", "video"}
	type callResult struct {
		resp *runtimev1.ListFeaturedModelAssetsResponse
		err  error
	}
	initialResults := make([]callResult, len(categories))
	initialDone := make(chan struct{}, len(categories))
	for i, cat := range categories {
		go func(idx int, category string) {
			resp, callErr := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: category, PageSize: 80})
			initialResults[idx] = callResult{resp: resp, err: callErr}
			initialDone <- struct{}{}
		}(i, cat)
	}
	for range categories {
		select {
		case <-initialDone:
		case <-time.After(2 * time.Second):
			t.Fatal("initial snapshot-first featured calls blocked on slow remote")
		}
	}

	// Verify old snapshot returned immediately with accurate stale freshness and ineligible model blocked from install.
	var ineligibleRef string
	for i, res := range initialResults {
		if res.err != nil {
			t.Fatalf("initial %s: %v", categories[i], res.err)
		}
		src := res.resp.GetSource()
		if src.GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_AVAILABLE ||
			src.GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_STALE ||
			src.GetGeneration() != staleSnapshot.Generation ||
			!src.GetRefreshInProgress() {
			t.Fatalf("initial %s source=%+v", categories[i], src)
		}
		if len(res.resp.GetItems()) != 2 {
			t.Fatalf("initial %s items=%d, want 2", categories[i], len(res.resp.GetItems()))
		}
		for _, item := range res.resp.GetItems() {
			if item.GetTitle() == "Missing Hash Model" {
				if item.GetInstallable() {
					t.Fatal("ineligible missing-hash candidate in stale snapshot reported installable")
				}
				ineligibleRef = item.GetOfferRef()
			}
		}
	}
	if ineligibleRef == "" {
		t.Fatal("missing-hash candidate not present in stale snapshot")
	}
	planResp, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{OfferRef: ineligibleRef})
	if err == nil && planResp.GetPlan().GetInstallAvailable() {
		t.Fatalf("ineligible candidate from stale snapshot entered install flow: %+v", planResp.GetPlan())
	}

	select {
	case <-remoteStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("background remote refresh never started")
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("remote requests during initial 3-category round = %d, want 1", got)
	}

	awaitResults := make([]callResult, len(categories))
	awaitDone := make(chan struct{}, len(categories))
	for i, cat := range categories {
		go func(idx int, category string) {
			resp, callErr := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: category, PageSize: 80, AwaitRefresh: true})
			awaitResults[idx] = callResult{resp: resp, err: callErr}
			awaitDone <- struct{}{}
		}(i, cat)
	}
	close(releaseRemote)
	for range categories {
		<-awaitDone
	}
	for i, res := range awaitResults {
		if res.err != nil {
			t.Fatalf("await %s: %v", categories[i], res.err)
		}
		src := res.resp.GetSource()
		if src.GetFreshness() != runtimev1.ModelAssetSourceFreshness_MODEL_ASSET_SOURCE_FRESHNESS_FRESH ||
			src.GetGeneration() != generationB.Generation ||
			src.GetRefreshInProgress() ||
			len(res.resp.GetItems()) != 1 ||
			res.resp.GetItems()[0].GetTitle() != "Updated Model B" {
			t.Fatalf("await %s got source=%+v items=%+v", categories[i], src, res.resp.GetItems())
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("remote requests after awaiting background refresh = %d, want 1", got)
	}

	// Explicit refresh bypasses the round coalesce window and fetches generation C once for all three categories.
	serveGen.Store(2)
	explicitFirst, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "chat", PageSize: 80, ForceRefresh: true})
	if err != nil {
		t.Fatalf("explicit refresh chat: %v", err)
	}
	if explicitFirst.GetSource().GetGeneration() != generationC.Generation || explicitFirst.GetItems()[0].GetTitle() != "Explicit Refresh Model C" {
		t.Fatalf("explicit refresh chat got %+v", explicitFirst)
	}
	for _, cat := range []string{"image", "video"} {
		follow, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: cat, PageSize: 80, AwaitRefresh: true})
		if err != nil || follow.GetSource().GetGeneration() != generationC.Generation {
			t.Fatalf("explicit refresh follow %s got %+v err=%v", cat, follow, err)
		}
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("remote requests after explicit refresh = %d, want 2", got)
	}
}

func TestListFeaturedModelAssetsColdUnavailableSharesSingleRemoteFetch(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			close(started)
			<-release
		}
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	t.Setenv(modelIndexBaseURLEnv, server.URL)

	svc := newTestService(t)
	t.Cleanup(svc.Close)
	categories := []string{"chat", "image", "video"}
	errs := make(chan error, len(categories))
	resps := make([]*runtimev1.ListFeaturedModelAssetsResponse, len(categories))
	for i, cat := range categories {
		go func(idx int, category string) {
			resp, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: category, PageSize: 80})
			resps[idx] = resp
			errs <- err
		}(i, cat)
	}
	<-started
	time.Sleep(30 * time.Millisecond)
	close(release)
	for range categories {
		if err := <-errs; err != nil {
			t.Fatalf("cold unavailable call error: %v", err)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("cold unavailable requests=%d, want 1", got)
	}
	for i, resp := range resps {
		if resp.GetSource().GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_UNAVAILABLE ||
			len(resp.GetItems()) != 0 {
			t.Fatalf("cold unavailable %s=%+v", categories[i], resp)
		}
	}

	// Explicit refresh while cold+offline also shares a single remote fetch across the three categories.
	explicitFirst, err := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: "chat", PageSize: 80, ForceRefresh: true})
	if err != nil || explicitFirst.GetSource().GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_UNAVAILABLE {
		t.Fatalf("cold explicit refresh chat=%+v err=%v", explicitFirst, err)
	}
	for _, cat := range []string{"image", "video"} {
		follow, followErr := svc.ListFeaturedModelAssets(context.Background(), &runtimev1.ListFeaturedModelAssetsRequest{Category: cat, PageSize: 80, AwaitRefresh: true})
		if followErr != nil || follow.GetSource().GetAvailability() != runtimev1.ModelAssetSourceAvailability_MODEL_ASSET_SOURCE_AVAILABILITY_UNAVAILABLE {
			t.Fatalf("cold explicit refresh follow %s=%+v err=%v", cat, follow, followErr)
		}
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("cold unavailable requests after explicit refresh=%d, want 2", got)
	}
}
