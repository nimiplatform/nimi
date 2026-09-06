package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSearchCatalogModelsMergesVerifiedAndHuggingFaceSorted(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_zeta_model",
				Source:       "huggingface",
				Title:        "Zeta Model",
				ModelId:      "org/zeta-model",
				Repo:         "org/zeta-model",
				Revision:     immutableHFRevisionForTest,
				Capabilities: []string{"text.generate"},
				Engine:       "llama",
				Verified:     false,
			},
			{
				ItemId:       "hf_alpha_model",
				Source:       "huggingface",
				Title:        "Alpha Community",
				ModelId:      "org/alpha-community",
				Repo:         "org/alpha-community",
				Revision:     immutableHFRevisionForTest,
				Capabilities: []string{"text.generate"},
				Engine:       "llama",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query:    "a",
		PageSize: 200,
	})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	if len(resp.GetItems()) < 4 {
		t.Fatalf("expected merged verified+hf items, got %d", len(resp.GetItems()))
	}
	firstHFIndex := -1
	for index, item := range resp.GetItems() {
		if !item.GetVerified() {
			firstHFIndex = index
			break
		}
	}
	if firstHFIndex < 0 {
		t.Fatalf("expected huggingface items in merged results")
	}
	for _, item := range resp.GetItems()[:firstHFIndex] {
		if !item.GetVerified() {
			t.Fatalf("verified items must come first")
		}
	}
	hfItems := resp.GetItems()[firstHFIndex:]
	if len(hfItems) < 2 {
		t.Fatalf("expected at least two huggingface items, got %d", len(hfItems))
	}
	if hfItems[0].GetVerified() || hfItems[1].GetVerified() {
		t.Fatalf("hf items must follow verified items")
	}
	if hfItems[0].GetTitle() != "Alpha Community" || hfItems[1].GetTitle() != "Zeta Model" {
		t.Fatalf("hf items should sort by title asc, got [%s, %s]", hfItems[0].GetTitle(), hfItems[1].GetTitle())
	}
}

func TestSearchCatalogModelsReturnsUniqueBrowseLocators(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_dup_llama",
				Source:       "huggingface",
				Title:        "Community Llama Dup",
				ModelId:      "local/llama3.1",
				Repo:         "nimiplatform/llama3.1-8b-instruct",
				Revision:     immutableHFRevisionForTest,
				Capabilities: []string{"text.generate"},
				Engine:       "llama",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "llama"})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	seen := map[string]bool{}
	for _, item := range resp.GetItems() {
		if item.GetModelLocator() == "" {
			t.Fatal("search result is missing model_locator")
		}
		if seen[item.GetModelLocator()] {
			t.Fatalf("duplicate model_locator %q", item.GetModelLocator())
		}
		seen[item.GetModelLocator()] = true
	}
}

func TestSearchCatalogModelsHFFailureReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	upstreamErr := errors.New(`hf timeout for C:\private\models?token=secret`)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return nil, upstreamErr
	}

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "llama",
	})
	if err == nil {
		t.Fatalf("expected hf search failure")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unavailable {
		t.Fatalf("expected Unavailable, got %v", st.Code())
	}
	assertGRPCReasonCode(t, err, "SearchCatalogModels(HF failure)", runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED)
	if !errors.Is(err, upstreamErr) {
		t.Fatal("expected upstream HF error to remain available in-process")
	}
	if strings.Contains(st.Message(), upstreamErr.Error()) || strings.Contains(st.Message(), "token=secret") {
		t.Fatalf("public status leaked upstream error: %q", st.Message())
	}
}

func TestSearchCatalogModelsInvalidHFRepoQueryReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = defaultHFCatalogSearch

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "hf://invalid_repo_format",
	})
	if err == nil {
		t.Fatalf("expected invalid hf repo error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	assertGRPCReasonCode(t, err, "SearchCatalogModels(invalid HF repo)", runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID)
	if !errors.Is(err, errHfRepoInvalid) {
		t.Fatal("expected invalid HF repo cause to remain available in-process")
	}
	if strings.Contains(st.Message(), "hf://invalid_repo_format") {
		t.Fatalf("public status leaked invalid repo input: %q", st.Message())
	}
}

func TestSearchCatalogModelsPassesHFRequestShape(t *testing.T) {
	svc := newTestService(t)
	captured := hfCatalogSearchRequest{}
	svc.hfCatalogSearch = func(_ context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		captured = req
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}

	if _, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query:    "Llama",
		Category: "image",
		PageSize: 7,
	}); err != nil {
		t.Fatalf("search catalog models: %v", err)
	}

	if captured.Query != "llama" {
		t.Fatalf("query should be normalized to lowercase, got %q", captured.Query)
	}
	if captured.CategoryFilter != "image" {
		t.Fatalf("category mismatch: %q", captured.CategoryFilter)
	}
	if captured.Limit != 7 {
		t.Fatalf("hf limit mismatch: got=%d want=7", captured.Limit)
	}
}

func TestSearchCatalogModelsRejectsEmptyQueryBeforeExternalSearch(t *testing.T) {
	svc := newTestService(t)
	called := false
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		called = true
		return nil, nil
	}
	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{PageSize: 500})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for empty query, got %v", err)
	}
	if called {
		t.Fatal("empty query must fail before external catalog search")
	}
}

func TestSearchCatalogModelsClampsPageSizeBeforeExternalSearch(t *testing.T) {
	svc := newTestService(t)
	captured := hfCatalogSearchRequest{}
	svc.hfCatalogSearch = func(_ context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		captured = req
		return nil, nil
	}
	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query:    "llama",
		PageSize: 500,
	})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	if captured.Limit != 200 {
		t.Fatalf("hf limit = %d, want 200", captured.Limit)
	}
}

func TestListCatalogVariantsReturnsRuntimeOwnedHFVariants(t *testing.T) {
	svc := newTestService(t)
	var capturedRepo string
	svc.hfCatalogVariants = func(_ context.Context, repo string, revision string) ([]hfCatalogVariant, error) {
		capturedRepo = repo
		return []hfCatalogVariant{
			{
				Filename:     "model-q4.gguf",
				Entry:        "model-q4.gguf",
				Files:        []string{"model-q4.gguf"},
				Hashes:       map[string]string{"model-q4.gguf": strings.Repeat("a", 64)},
				Format:       "gguf",
				SizeBytes:    2048,
				SHA256:       strings.Repeat("a", 64),
				Revision:     revision,
				Capabilities: []string{"text.generate"},
				ModelType:    "chat",
			},
		}, nil
	}

	locator, locatorErr := newModelAssetModelLocator("huggingface", "Qwen/Qwen2.5-7B-Instruct-GGUF", immutableHFRevisionForTest)
	if locatorErr != nil {
		t.Fatal(locatorErr)
	}
	resp, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{ModelLocator: locator})
	if err != nil {
		t.Fatalf("list catalog variants: %v", err)
	}
	if capturedRepo != "Qwen/Qwen2.5-7B-Instruct-GGUF" {
		t.Fatalf("repo should pass through service boundary, got %q", capturedRepo)
	}
	if len(resp.GetVariants()) != 1 {
		t.Fatalf("expected one variant, got %d", len(resp.GetVariants()))
	}
	got := resp.GetVariants()[0]
	if got.GetSourceLabel() != "huggingface" || got.GetVariantLabel() != "model-q4.gguf" || got.GetFormat() != "gguf" || got.GetOfferRef() == "" {
		t.Fatalf("unexpected variant descriptor: %+v", got)
	}
	if got.GetTotalSizeBytes() != 2048 || !got.GetInstallable() {
		t.Fatalf("variant metadata mismatch: %+v", got)
	}
}

func TestListCatalogVariantsInvalidRepoReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogVariants = defaultHFCatalogVariants

	locator, locatorErr := newModelAssetModelLocator("huggingface", "invalid_repo_format", immutableHFRevisionForTest)
	if locatorErr != nil {
		t.Fatal(locatorErr)
	}
	_, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{ModelLocator: locator})
	if err == nil {
		t.Fatalf("expected invalid hf repo error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	assertGRPCReasonCode(t, err, "ListCatalogVariants(invalid HF repo)", runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID)
	if !errors.Is(err, errHfRepoInvalid) {
		t.Fatal("expected invalid HF repo cause to remain available in-process")
	}
	if strings.Contains(st.Message(), "invalid_repo_format") {
		t.Fatalf("public status leaked invalid repo input: %q", st.Message())
	}
}

func TestListHFCatalogVariantsFromDetailsFailsClosedForUnresolvedSafetensorsBundles(t *testing.T) {
	variants := listHFCatalogVariantsFromDetails(&hfModelDetails{
		ID:          "org/model",
		PipelineTag: "text-generation",
		Tags:        []string{"gguf"},
		Siblings: []hfModelSibling{
			{Rfilename: "config.json"},
			{Rfilename: "tokenizer.json"},
			{Rfilename: "../../escape.gguf"},
			{Rfilename: "model-q8.gguf", Lfs: &hfModelSiblingLFS{Size: 3000, Sha256: "q8"}},
			{Rfilename: "model-q4.gguf", Lfs: &hfModelSiblingLFS{Size: 1000, Sha256: "q4"}},
			{Rfilename: "adapter/model.safetensors", Lfs: &hfModelSiblingLFS{Size: 2000, Sha256: "safe"}},
		},
	})
	if len(variants) != 3 {
		t.Fatalf("expected three installable variants, got %d", len(variants))
	}
	if variants[0].Filename != "model-q4.gguf" || variants[1].Filename != "adapter/model.safetensors" || variants[2].Filename != "model-q8.gguf" {
		t.Fatalf("variants should sort by size and skip unsafe files, got %v", []string{
			variants[0].Filename,
			variants[1].Filename,
			variants[2].Filename,
		})
	}
	if got := variants[0].Files; len(got) != 1 || got[0] != "model-q4.gguf" {
		t.Fatalf("llama gguf manual variant should install only selected entry, got %v", got)
	}
	if got := variants[1].Files; len(got) != 0 {
		t.Fatalf("unresolved safetensors bundle must remain browse-only, got files %v", got)
	}
	if variants[1].Format != "safetensors" || variants[1].SizeBytes != 2000 || variants[1].SHA256 != "safe" {
		t.Fatalf("safetensors browse-only metadata mismatch: %+v", variants[1])
	}
	safeOffer, err := catalogOfferFromHFVariant("org/model", immutableHFRevisionForTest, variants[1])
	if err != nil {
		t.Fatal(err)
	}
	if catalogOfferInstallable(safeOffer) || safeOffer.totalSizeBytes != 0 {
		t.Fatalf("direct HF safetensors component was promoted to an install offer: %+v", safeOffer)
	}
}

func TestHFCatalogRequestURLsUseImmutableRevisionAndRequiredSourceFacts(t *testing.T) {
	searchURL, err := hfCatalogSearchURL(hfCatalogSearchRequest{Query: "flux", CategoryFilter: "image", Limit: 12})
	if err != nil {
		t.Fatal(err)
	}
	query := searchURL.Query()
	if query.Get("library") != "" || query.Get("pipeline_tag") != "text-to-image" {
		t.Fatalf("search query=%v", query)
	}
	wantExpand := map[string]bool{"sha": true, "pipeline_tag": true, "tags": true, "downloads": true, "likes": true, "lastModified": true, "cardData": true}
	for _, value := range query["expand[]"] {
		delete(wantExpand, value)
	}
	if len(wantExpand) != 0 {
		t.Fatalf("search query missing expanded source facts: %v", wantExpand)
	}

	var seen *url.URL
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		copy := *r.URL
		seen = &copy
		_ = json.NewEncoder(w).Encode(hfModelDetails{
			ID: "org/model", ModelID: "org/model", Sha: immutableHFRevisionForTest,
			PipelineTag: "text-generation", Downloads: 42, Likes: 7, LastModified: "2026-09-03T00:00:00Z",
			CardData: map[string]any{"license": "apache-2.0"},
			Siblings: []hfModelSibling{{Rfilename: "model.gguf", Lfs: &hfModelSiblingLFS{Size: 8, Sha256: strings.Repeat("b", 64)}}},
		})
	}))
	defer server.Close()
	variants, err := fetchHFCatalogVariants(context.Background(), server.URL+"/api/models", "org/model", immutableHFRevisionForTest)
	if err != nil {
		t.Fatal(err)
	}
	if seen == nil || seen.Path != "/api/models/org/model/revision/"+immutableHFRevisionForTest || seen.Query().Get("blobs") != "true" {
		t.Fatalf("variant request URL=%v", seen)
	}
	if len(variants) != 1 || variants[0].Revision != immutableHFRevisionForTest || variants[0].SizeBytes != 8 ||
		variants[0].Title != "org/model" || variants[0].License != "apache-2.0" || variants[0].Downloads != 42 || variants[0].Likes != 7 {
		t.Fatalf("revision-bound variants=%+v", variants)
	}
}

func TestHFCatalogRevisionMismatchFailsClosed(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(hfModelDetails{
			ID: "org/model", ModelID: "org/model", Sha: strings.Repeat("b", 40), PipelineTag: "text-generation",
		})
	}))
	defer server.Close()
	if _, err := fetchHFCatalogVariants(context.Background(), server.URL+"/api/models", "org/model", immutableHFRevisionForTest); err == nil {
		t.Fatal("revision-bound HF detail accepted a mismatched source revision")
	}
}

func TestResolveHFCatalogOfferKeepsRevisionBoundParentFacts(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogVariants = func(context.Context, string, string) ([]hfCatalogVariant, error) {
		return []hfCatalogVariant{{
			Filename: "model.gguf", Entry: "model.gguf", Files: []string{"model.gguf"},
			Hashes: map[string]string{"model.gguf": strings.Repeat("a", 64)}, Format: "gguf", SizeBytes: 8,
			SHA256: strings.Repeat("a", 64), Revision: immutableHFRevisionForTest,
			Title: "Pinned title", Capabilities: []string{"text.generate"}, ModelType: "chat", License: "apache-2.0",
		}}, nil
	}
	identity := modelAssetOfferIdentity{
		sourceKind: "huggingface", locator: "org/model", revision: immutableHFRevisionForTest, entryID: "gguf:model.gguf",
	}
	offer, err := svc.resolveHFCatalogOffer(context.Background(), identity)
	if err != nil {
		t.Fatal(err)
	}
	if offer.title != "Pinned title" || offer.modelType != "chat" || offer.license != "apache-2.0" || !stringSetContains(offer.capabilities, "text.generate") {
		t.Fatalf("revision-bound parent facts changed: %+v", offer)
	}
}

func TestHFCatalogUnknownPipelineFailsClosed(t *testing.T) {
	if capabilities := inferCapabilitiesFromHF("unknown-pipeline", nil); len(capabilities) != 0 {
		t.Fatalf("unknown pipeline must not fall back to chat, got %v", capabilities)
	}

	item, ok := mapHFRowToCatalogItem(hfModelSearchEntry{
		ID:          "org/unknown-pipeline-model",
		ModelID:     "org/unknown-pipeline-model",
		PipelineTag: "unknown-pipeline",
	}, "")
	if ok || item != nil {
		t.Fatalf("unknown pipeline row must be blocked, got ok=%v item=%v", ok, item)
	}
}

func TestHFCatalogProjectsExternalPipelineCategoriesToCanonicalCapabilities(t *testing.T) {
	tests := []struct {
		pipeline string
		want     string
	}{
		{pipeline: "text-generation", want: "text.generate"},
		{pipeline: "image-text-to-text", want: "text.generate"},
		{pipeline: "visual-question-answering", want: "text.generate"},
		{pipeline: "feature-extraction", want: "text.embed"},
		{pipeline: "text-to-image", want: "image.generate"},
		{pipeline: "image-to-image", want: "image.generate"},
		{pipeline: "text-to-video", want: "video.generate"},
		{pipeline: "image-to-video", want: "video.generate"},
		{pipeline: "text-to-speech", want: "audio.synthesize"},
		{pipeline: "automatic-speech-recognition", want: "audio.transcribe"},
	}
	for _, test := range tests {
		t.Run(test.pipeline, func(t *testing.T) {
			capabilities := inferCapabilitiesFromHF(test.pipeline, nil)
			if len(capabilities) != 1 || capabilities[0] != test.want {
				t.Fatalf("capabilities=%v, want [%s]", capabilities, test.want)
			}
		})
	}
}

func TestHFCatalogAmbiguousCrossKindRowFailsClosed(t *testing.T) {
	item, ok := mapHFRowToCatalogItem(hfModelSearchEntry{
		ID:          "org/ambiguous-model",
		PipelineTag: "text-to-speech",
		Tags:        []string{"text-generation"},
	}, "")
	if ok || item != nil {
		t.Fatalf("cross-kind inferred row must be blocked, got ok=%v item=%v", ok, item)
	}
}

func TestUnfilteredCatalogSearchIncludesSpeechAndPassiveAssets(t *testing.T) {
	svc := newTestService(t)
	svc.catalog = []*runtimev1.LocalCatalogModelDescriptor{
		{ItemId: "speech-asset", Source: "verified", Title: "Speech asset", Repo: "org/speech", Revision: immutableHFRevisionForTest, ModelType: "tts", Capabilities: []string{"audio.synthesize"}},
		{ItemId: "vae-asset", Source: "verified", Title: "VAE asset", Repo: "org/vae", Revision: immutableHFRevisionForTest, ModelType: "vae"},
	}
	svc.hfCatalogSearch = func(_ context.Context, request hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		if request.CategoryFilter != "" {
			t.Fatalf("unfiltered search gained a pipeline category: %q", request.CategoryFilter)
		}
		return nil, nil
	}
	result, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "asset"})
	if err != nil || len(result.GetItems()) != 2 {
		t.Fatalf("speech/passive search = %+v err=%v", result, err)
	}
}
