package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
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

func TestSearchCatalogModelsHFFailurePreservesLocalResults(t *testing.T) {
	svc := newTestService(t)
	upstreamErr := errors.New(`hf timeout for C:\private\models?token=secret`)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return nil, upstreamErr
	}

	for _, query := range []string{"qwen2", "no-such-catalog-model"} {
		resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: query})
		if err != nil {
			t.Fatalf("HF outage discarded local discovery: %v", err)
		}
		if !resp.GetHuggingFaceUnavailable() {
			t.Fatal("HF outage must remain explicit even when local results are empty")
		}
		if (len(resp.GetItems()) > 0) != (query == "qwen2") {
			t.Fatalf("unexpected local matches for %q: %v", query, resp.GetItems())
		}
		payload, err := json.Marshal(resp)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(payload), "token=secret") || strings.Contains(string(payload), "private") {
			t.Fatal("partial response leaked upstream error")
		}
	}
}

func TestSearchCatalogModelsHFFailureDuringPagingRestartsLocalDiscovery(t *testing.T) {
	for _, localCount := range []int{2, 65} {
		t.Run(fmt.Sprintf("local-%d", localCount), func(t *testing.T) {
			svc := newTestService(t)
			svc.catalog = nil
			for index := 0; index < localCount; index++ {
				svc.catalog = append(svc.catalog, &runtimev1.LocalCatalogModelDescriptor{
					ItemId: fmt.Sprintf("local-asset-%d", index), Source: "verified",
					Title: fmt.Sprintf("Z local asset %03d", index), Repo: fmt.Sprintf("org/local-asset-%d", index),
					Revision: immutableHFRevisionForTest, ModelType: "vae", Verified: index == 0,
				})
			}
			calls := 0
			svc.hfCatalogSearch = func(context.Context, hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
				calls++
				if calls == 2 {
					return nil, errors.New("HF connection lost after first page")
				}
				items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, 50)
				for index := 0; index < 50; index++ {
					items = append(items, &runtimev1.LocalCatalogModelDescriptor{
						ItemId: fmt.Sprintf("hf-asset-%d", index), Source: "huggingface",
						Title: fmt.Sprintf("A HF asset %03d", index), Repo: fmt.Sprintf("org/hf-asset-%d", index),
						Revision: immutableHFRevisionForTest, ModelType: "vae",
					})
				}
				return items, nil
			}
			first, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "asset", PageSize: 50})
			if err != nil || first.GetNextPageToken() == "" || first.GetHuggingFaceUnavailable() {
				t.Fatalf("first merged page = %v, %v", first, err)
			}
			local := make(map[string]bool)
			token := first.GetNextPageToken()
			for page := 0; token != "" && page < 3; page++ {
				result, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "asset", PageSize: 50, PageToken: token})
				if err != nil {
					t.Fatalf("source outage invalidated an issued page token: %v", err)
				}
				if !result.GetHuggingFaceUnavailable() {
					t.Fatal("local continuation lost the source failure")
				}
				for _, item := range result.GetItems() {
					if !strings.HasPrefix(item.GetTitle(), "Z local asset") {
						t.Fatalf("source set changed inside local continuation: %v", item)
					}
					local[item.GetModelLocator()] = true
				}
				token = result.GetNextPageToken()
			}
			if token != "" || len(local) != localCount || calls != 2 {
				t.Fatalf("incomplete local discovery: count=%d want=%d HF calls=%d token=%q", len(local), localCount, calls, token)
			}
		})
	}
}

func TestSearchCatalogModelsOutageDoesNotAcceptMalformedOrForeignPageTokens(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(context.Context, hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		t.Fatal("invalid token must be rejected before external search")
		return nil, nil
	}
	digest := pagination.FilterDigest("asset", "")
	for _, token := range []string{
		pagination.Encode("not-a-number", digest),
		pagination.Encode("local:", digest),
		pagination.Encode("local:-1", digest),
		pagination.Encode("50", pagination.FilterDigest("different-query", "")),
	} {
		_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "asset", PageToken: token})
		assertGRPCReasonCode(t, err, "malformed catalog continuation", runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
}

func TestSearchCatalogModelsCancellationDoesNotBecomePartialSuccess(t *testing.T) {
	svc := newTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		cancel()
		return nil, ctx.Err()
	}
	resp, err := svc.SearchCatalogModels(ctx, &runtimev1.SearchCatalogModelsRequest{Query: "llama"})
	if resp != nil || status.Code(err) != codes.Canceled {
		t.Fatalf("cancelled search returned %v, %v", resp, err)
	}
}

func TestSearchCatalogModelsMatchesRepositoryLinks(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		if req.Query != "community/model" {
			t.Fatalf("unexpected query: %q", req.Query)
		}
		return []*runtimev1.LocalCatalogModelDescriptor{{
			ItemId: "hf_community_model", ModelId: "Community/Model", Repo: "Community/Model",
			Source: "huggingface", Title: "Community/Model", Revision: immutableHFRevisionForTest,
		}}, nil
	}
	for _, query := range []string{"Community/Model", "hf://Community/Model", "https://huggingface.co/Community/Model"} {
		response, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: query})
		if err != nil || len(response.GetItems()) != 1 || response.GetItems()[0].GetTitle() != "Community/Model" {
			t.Fatalf("search for %q returned %v, %v", query, response, err)
		}
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

func TestHFNumberedGGUFPartsAreNotStandaloneAcquisitions(t *testing.T) {
	hash := strings.Repeat("a", 64)
	var details hfModelDetails
	for _, entry := range []string{"nested/m-00001-of-00002.gguf", "nested/m-00002-of-00002.gguf", "alt-00001-of-00002.gguf_file", "single-00001-of-00001.gguf"} {
		details.Siblings = append(details.Siblings, hfModelSibling{Rfilename: entry, Lfs: &hfModelSiblingLFS{Size: 144, Sha256: hash}})
	}
	variants := listHFCatalogVariantsFromDetails(&details)
	if len(variants) != len(details.Siblings) {
		t.Fatalf("shards should remain discoverable: %v", variants)
	}
	for _, variant := range variants {
		offer, err := catalogOfferFromHFVariant("org/model", immutableHFRevisionForTest, variant)
		if err != nil {
			t.Fatal(err)
		}
		single := variant.Entry == "single-00001-of-00001.gguf"
		if catalogOfferInstallable(offer) != single || (single && len(offer.hashes) != 1) {
			t.Fatalf("incorrect distribution for %s: %v", variant.Entry, offer)
		}
	}
	const source = "nested/m-00001-of-00002.gguf"
	svc := newTestService(t)
	_, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{
		Source: "huggingface", Repo: "org/model", Revision: immutableHFRevisionForTest, Entry: source,
		Hashes: map[string]string{source: hash}, Capabilities: []string{"text.generate"},
	})
	if code, _ := grpcerr.ExtractReasonCode(err); code != runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID {
		t.Fatalf("partial portable source: %v", err)
	}
}

func TestHFCatalogReviewsOnlySelectedStandaloneCheckpoint(t *testing.T) {
	xlShapes := map[string][]int64{
		"model.diffusion_model.input_blocks.0.0.weight":                                       {320, 4, 3, 3},
		"model.diffusion_model.out.2.weight":                                                  {4, 320, 3, 3},
		"conditioner.embedders.0.transformer.text_model.embeddings.token_embedding.weight":    {49408, 768},
		"conditioner.embedders.0.transformer.text_model.encoder.layers.11.layer_norm2.weight": {768},
		"conditioner.embedders.1.model.token_embedding.weight":                                {49408, 1280},
		"conditioner.embedders.1.model.transformer.resblocks.31.ln_2.weight":                  {1280},
		"first_stage_model.encoder.conv_in.weight":                                            {128, 3, 3, 3},
		"first_stage_model.decoder.conv_in.weight":                                            {512, 4, 3, 3},
		"first_stage_model.decoder.conv_out.weight":                                           {3, 128, 3, 3},
		"first_stage_model.encoder.mid.block_1.norm1.weight":                                  {512},
		"first_stage_model.decoder.mid.block_1.norm1.weight":                                  {512},
		"model.diffusion_model.middle_block.1.transformer_blocks.0.attn2.to_k.weight":         {1280, 2048},
		"model.diffusion_model.output_blocks.8.0.in_layers.0.weight":                          {640},
	}
	sd1Shapes := map[string][]int64{
		"model.diffusion_model.input_blocks.0.0.weight":                                {320, 4, 3, 3},
		"model.diffusion_model.out.2.weight":                                           {4, 320, 3, 3},
		"first_stage_model.encoder.conv_in.weight":                                     {128, 3, 3, 3},
		"first_stage_model.encoder.mid.block_1.norm1.weight":                           {512},
		"first_stage_model.decoder.conv_in.weight":                                     {512, 4, 3, 3},
		"first_stage_model.decoder.mid.block_1.norm1.weight":                           {512},
		"first_stage_model.decoder.conv_out.weight":                                    {3, 128, 3, 3},
		"cond_stage_model.transformer.text_model.embeddings.token_embedding.weight":    {49408, 768},
		"cond_stage_model.transformer.text_model.encoder.layers.11.layer_norm2.weight": {768},
		"model.diffusion_model.middle_block.1.transformer_blocks.0.attn2.to_k.weight":  {1280, 768},
		"model.diffusion_model.output_blocks.11.0.in_layers.0.weight":                  {640},
	}
	makeHeader := func(shapes map[string][]int64) ([]byte, int64) {
		var tensorBytes int64
		meta := map[string]any{}
		for name, shape := range shapes {
			n := int64(2)
			for _, dim := range shape {
				n *= dim
			}
			meta[name] = map[string]any{"dtype": "F16", "shape": shape, "data_offsets": []int64{tensorBytes, tensorBytes + n}}
			tensorBytes += n
		}
		raw, err := json.Marshal(meta)
		if err != nil {
			t.Fatal(err)
		}
		header := binary.LittleEndian.AppendUint64(nil, uint64(len(raw)))
		header = append(header, raw...)
		return header, int64(len(header)) + tensorBytes
	}
	header, size := makeHeader(xlShapes)
	sd1Header, sd1Size := makeHeader(sd1Shapes)
	hash := strings.Repeat("a", 64)
	full := hfCatalogVariant{Entry: "full.safetensors", Format: "safetensors", SizeBytes: size, SHA256: hash, Revision: immutableHFRevisionForTest}
	sd1 := full
	sd1.Entry, sd1.SizeBytes = "classic.safetensors", sd1Size
	shard := full
	shard.Entry = "model-00001-of-00002.safetensors"
	component := full
	component.Entry = "vae/model.safetensors"
	partialCheckpoint := full
	partialCheckpoint.Entry = "partial.safetensors"
	missingHash := full
	missingHash.Entry, missingHash.SHA256 = "no-hash.safetensors", ""
	wrongSize := full
	wrongSize.Entry = "wrong-size.safetensors"
	short := full
	short.Entry = "interrupted.safetensors"
	var probeHits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&probeHits, 1)
		if r.Header.Get("Range") != "bytes=0-4194303" {
			t.Errorf("unbounded or wrong range %q", r.Header.Get("Range"))
		}
		responseSize := size
		if strings.HasSuffix(r.URL.Path, "/classic.safetensors") {
			responseSize = sd1Size
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-4194303/%d", responseSize))
		w.WriteHeader(http.StatusPartialContent)
		switch r.URL.Path {
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/full.safetensors":
			_, _ = w.Write(header)
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/classic.safetensors":
			_, _ = w.Write(sd1Header)
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/vae/model.safetensors":
			changed := bytes.ReplaceAll(header, []byte("first_stage_model"), []byte("other_stage_model"))
			_, _ = w.Write(changed)
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/partial.safetensors":
			_, _ = w.Write(bytes.ReplaceAll(header, []byte("middle_block"), []byte("absent_block")))
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/wrong-size.safetensors":
			_, _ = w.Write(bytes.ReplaceAll(header, []byte("F16"), []byte("F32")))
		case "/org/model/resolve/" + immutableHFRevisionForTest + "/interrupted.safetensors":
			_, _ = w.Write(header[:8])
		default:
			t.Errorf("unexpected metadata fetch %s", r.URL.Path)
		}
	}))
	defer server.Close()
	svc := newTestService(t)
	variants := []hfCatalogVariant{full, sd1, shard, component, partialCheckpoint, missingHash, wrongSize, short}
	svc.hfDownloadBaseURL = server.URL
	svc.hfCatalogVariants = func(context.Context, string, string) ([]hfCatalogVariant, error) {
		return variants, nil
	}
	for _, v := range variants {
		offer, err := catalogOfferFromHFVariant("org/model", immutableHFRevisionForTest, v)
		if err != nil {
			t.Fatal(err)
		}
		res, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{OfferRef: offer.offerRef})
		if v.Entry == short.Entry {
			if status.Code(err) != codes.Unavailable {
				t.Fatalf("incomplete response was classified as a reviewed file: %v", err)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		plan := res.GetPlan()
		standalone := v.Entry == full.Entry || v.Entry == sd1.Entry
		if plan.GetInstallAvailable() != standalone {
			t.Fatalf("%s: installable=%v", v.Entry, plan.GetInstallAvailable())
		}
		if standalone && (len(plan.GetFiles()) != 1 || plan.GetFiles()[0] != v.Entry || plan.GetHashes()[v.Entry] != hash || plan.GetTotalSizeBytes() != v.SizeBytes || plan.GetRevision() != immutableHFRevisionForTest) {
			t.Fatalf("unexpected plan: %v", plan)
		}
		if v.Entry == full.Entry && (slices.Contains(plan.GetWarnings(), "WARN_NO_HOST_RECIPE_SD1") || slices.Contains(plan.GetWarnings(), "WARN_COMMUNITY_RECIPE_COMPATIBILITY_UNVERIFIED")) {
			t.Fatalf("SDXL checkpoint should not carry unsupported-recipe warning: %v", plan.GetWarnings())
		}
		if v.Entry == sd1.Entry && !slices.Contains(plan.GetWarnings(), "WARN_NO_HOST_RECIPE_SD1") {
			t.Fatalf("SD 1.x checkpoint must warn before download when no SD 1.x recipe exists: %v", plan.GetWarnings())
		}
	}
	hitsBeforeRepeat := atomic.LoadInt32(&probeHits)
	fullOffer, err := catalogOfferFromHFVariant("org/model", immutableHFRevisionForTest, full)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{OfferRef: fullOffer.offerRef}); err != nil {
		t.Fatalf("cached checkpoint review failed: %v", err)
	}
	if got := atomic.LoadInt32(&probeHits); got != hitsBeforeRepeat {
		t.Fatalf("repeat immutable checkpoint probe made %d extra HTTP requests", got-hitsBeforeRepeat)
	}
}

func TestPortableSourceMainPinsResolvedCommitAndSurvivesBranchMove(t *testing.T) {
	commitA := strings.Repeat("a", 40)
	commitB := strings.Repeat("b", 40)
	payload := append([]byte("GGUF"), bytes.Repeat([]byte{1}, 64)...)
	digestBytes := sha256.Sum256(payload)
	payloadHash := hex.EncodeToString(digestBytes[:])
	branchMoved := atomic.Bool{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.EscapedPath() {
		case "/api/models/community/untagged-model":
			sha := commitA
			if branchMoved.Load() {
				sha = commitB
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "community/untagged-model", "modelId": "community/untagged-model", "sha": sha,
			})
		case "/api/models/community/untagged-model/revision/release%2Fv2":
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": commitB})
		case "/api/models/community/untagged-model/revision/" + commitA, "/api/models/community/untagged-model/revision/" + commitB:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "community/untagged-model", "modelId": "community/untagged-model",
				"sha": strings.TrimPrefix(r.URL.Path, "/api/models/community/untagged-model/revision/"),
				"siblings": []map[string]any{{
					"rfilename": "model-q4.gguf",
					"lfs":       map[string]any{"size": len(payload), "sha256": payloadHash},
				}},
			})
		case "/community/untagged-model/resolve/" + commitA + "/model-q4.gguf":
			_, _ = w.Write(payload)
		case "/community/untagged-model/resolve/main/model-q4.gguf":
			http.Error(w, "branch moved to different weights", http.StatusNotFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(t)
	svc.hfCatalogSearch = nil
	svc.hfCatalogEndpoint = server.URL + "/api/models"
	svc.hfDownloadBaseURL = server.URL
	request := &runtimev1.ResolveModelInstallPlanRequest{
		Source: "huggingface", Repo: "community/untagged-model", Revision: "main",
		Capabilities: []string{"text.generate"}, Entry: "model-q4.gguf",
		Files: []string{"model-q4.gguf"}, Hashes: map[string]string{"model-q4.gguf": payloadHash},
	}
	resolved, err := svc.ResolveModelInstallPlan(context.Background(), request)
	if err != nil {
		t.Fatalf("resolve plan for main branch: %v", err)
	}
	plan := resolved.GetPlan()
	if plan.GetRevision() != commitA {
		t.Fatalf("plan revision = %q, want pinned commit %q", plan.GetRevision(), commitA)
	}
	if !slices.Contains(plan.GetWarnings(), "WARN_COMMUNITY_RECIPE_COMPATIBILITY_UNVERIFIED") {
		t.Fatalf("community GGUF plan missing unverified-recipe warning: %v", plan.GetWarnings())
	}
	request.Revision = "release/v2"
	branchPlan, err := svc.ResolveModelInstallPlan(context.Background(), request)
	if err != nil || branchPlan.GetPlan().GetRevision() != commitB {
		t.Fatalf("resolve named branch: plan=%v err=%v", branchPlan.GetPlan(), err)
	}

	// Simulate upstream moving main before download begins.
	branchMoved.Store(true)
	installed, err := svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: plan.GetPlanId()})
	if err != nil {
		t.Fatalf("install from pinned commit after branch move: %v", err)
	}
	provenance := installed.GetModelAsset().GetProvenance().AsMap()
	if got := provenance["source_revision"]; got != commitA {
		t.Fatalf("persisted provenance source_revision = %v, want %q", got, commitA)
	}
}

func TestHFRateLimitPreservesRetryAfterAndUsesImmutableCache(t *testing.T) {
	commit := strings.Repeat("d", 40)
	payload := append([]byte("GGUF"), bytes.Repeat([]byte{2}, 64)...)
	digestBytes := sha256.Sum256(payload)
	payloadHash := hex.EncodeToString(digestBytes[:])

	var variantHits int32
	rateLimited := atomic.Bool{}
	rateLimited.Store(true)
	downloadRateLimited := atomic.Bool{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/models/org/cached/revision/"+commit {
			atomic.AddInt32(&variantHits, 1)
			if rateLimited.Load() {
				w.Header().Set("RateLimit", `"api";r=0;t=42`)
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "org/cached", "modelId": "org/cached", "sha": commit,
				"siblings": []map[string]any{{
					"rfilename": "model.gguf",
					"lfs":       map[string]any{"size": len(payload), "sha256": payloadHash},
				}},
			})
			return
		}
		if r.URL.Path == "/org/cached/resolve/"+commit+"/model.gguf" {
			if downloadRateLimited.Load() {
				w.Header().Set("Retry-After", "55")
				w.WriteHeader(http.StatusTooManyRequests)
				return
			}
			_, _ = w.Write(payload)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	svc := newTestService(t)
	svc.hfCatalogSearch = nil
	svc.hfCatalogEndpoint = server.URL + "/api/models"
	svc.hfDownloadBaseURL = server.URL

	locator, err := newModelAssetModelLocator("huggingface", "org/cached", commit)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{ModelLocator: locator})
	assertGRPCReasonCode(t, err, "ListCatalogVariants 429", runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("ListCatalogVariants 429 code = %v, want ResourceExhausted", status.Code(err))
	}
	meta, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || meta["retry_after_seconds"] != "42" || meta["retryable"] != "true" {
		t.Fatalf("ListCatalogVariants 429 metadata = %v (ok=%v)", meta, ok)
	}

	req := &runtimev1.ResolveModelInstallPlanRequest{
		Source: "huggingface", Repo: "org/cached", Revision: commit,
		Capabilities: []string{"text.generate"}, Entry: "model.gguf",
		Files: []string{"model.gguf"}, Hashes: map[string]string{"model.gguf": payloadHash},
	}
	_, err = svc.ResolveModelInstallPlan(context.Background(), req)
	assertGRPCReasonCode(t, err, "ResolveModelInstallPlan 429", runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)

	// Once rate-limit window clears, the immutable revision response is cached.
	rateLimited.Store(false)
	hitsBefore := atomic.LoadInt32(&variantHits)
	firstPlan, err := svc.ResolveModelInstallPlan(context.Background(), req)
	if err != nil {
		t.Fatalf("first resolve after cooldown: %v", err)
	}
	if _, err := svc.ResolveModelInstallPlan(context.Background(), req); err != nil {
		t.Fatalf("second resolve using immutable cache: %v", err)
	}
	if got := atomic.LoadInt32(&variantHits) - hitsBefore; got != 1 {
		t.Fatalf("immutable variant lookup made %d HTTP calls, want 1", got)
	}

	// Download 429 returns AI_PROVIDER_RATE_LIMITED and keeps the transfer retryable.
	downloadRateLimited.Store(true)
	_, err = svc.InstallModelFromPlan(context.Background(), &runtimev1.InstallModelFromPlanRequest{PlanId: firstPlan.GetPlan().GetPlanId()})
	assertGRPCReasonCode(t, err, "InstallModelFromPlan 429", runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	dlMeta, _ := grpcerr.ExtractReasonMetadata(err)
	if dlMeta["retry_after_seconds"] != "55" {
		t.Fatalf("download 429 metadata = %v, want retry_after_seconds=55", dlMeta)
	}
	transfers, listErr := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if listErr != nil || len(transfers.GetTransfers()) == 0 || !transfers.GetTransfers()[0].GetRetryable() {
		t.Fatalf("download 429 transfer should stay retryable: %+v err=%v", transfers, listErr)
	}
	original := transfers.GetTransfers()[0]
	if original.GetPlanId() != firstPlan.GetPlan().GetPlanId() || !slices.Contains(original.GetAvailableActions(), runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_RESUME) {
		t.Fatalf("original install plan has no resumable transfer: %v", original)
	}
	downloadRateLimited.Store(false)
	sessionID := original.GetInstallSessionId()
	if _, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: sessionID}); err != nil {
		t.Fatal(err)
	}
	waitTransferStateForTest(t, svc, sessionID, localTransferStateCompleted)
	completed := svc.localTransferSummary(sessionID)
	asset, err := svc.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: completed.GetAssetId()})
	if err != nil || asset.GetAsset().GetContentId() != "sha256:"+payloadHash {
		t.Fatalf("resumed transfer returned wrong content: %v, err=%v", asset, err)
	}
}

func TestPortableSourceUsesRecordedRevisionAndExactHash(t *testing.T) {
	svc := newTestService(t)
	pinned := strings.Repeat("b", 40)
	hash := strings.Repeat("a", 64)
	svc.hfCatalogSearch = func(context.Context, hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		t.Fatal("pinned acquisition must not depend on current search results")
		return nil, nil
	}
	svc.hfCatalogVariants = func(_ context.Context, repo, rev string) ([]hfCatalogVariant, error) {
		if repo != "org/model" || rev != pinned {
			t.Fatalf("unexpected source %s@%s", repo, rev)
		}
		return []hfCatalogVariant{{Revision: pinned, Entry: "model.gguf", SHA256: hash, SizeBytes: 1024}}, nil
	}
	req := &runtimev1.ResolveModelInstallPlanRequest{Source: "huggingface", Repo: "org/model", Revision: pinned, Capabilities: []string{"text.generate"}, Entry: "model.gguf", Files: []string{"model.gguf"}, Hashes: map[string]string{"model.gguf": hash}}
	result, err := svc.ResolveModelInstallPlan(context.Background(), req)
	if err != nil || !result.GetPlan().GetInstallAvailable() || result.GetPlan().GetRevision() != pinned {
		t.Fatalf("pinned recovery: %v %v", result, err)
	}
	req.Hashes["model.gguf"] = strings.Repeat("c", 64)
	if _, err = svc.ResolveModelInstallPlan(context.Background(), req); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("wrong hash accepted: %v", err)
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

func TestHFCatalogUnclassifiedContentRemainsDiscoverableWithoutCapabilityAdmission(t *testing.T) {
	if capabilities := inferCapabilitiesFromHF("unknown-pipeline", nil); len(capabilities) != 0 {
		t.Fatalf("unknown pipeline must not fall back to chat, got %v", capabilities)
	}

	item, ok := mapHFRowToCatalogItem(hfModelSearchEntry{
		ID:          "org/unknown-pipeline-model",
		ModelID:     "org/unknown-pipeline-model",
		PipelineTag: "unknown-pipeline",
		Sha:         immutableHFRevisionForTest,
	}, "")
	if !ok || item == nil || len(item.Capabilities) != 0 || item.ModelType != "" || item.InstallAvailable || item.Engine != "" {
		t.Fatalf("unclassified discovery must not invent admission, got ok=%v item=%v", ok, item)
	}

	variants := listHFCatalogVariantsFromDetails(&hfModelDetails{
		PipelineTag: "any-to-any",
		Siblings:    []hfModelSibling{{Rfilename: "model.gguf", Lfs: &hfModelSiblingLFS{Size: 8, Sha256: strings.Repeat("a", 64)}}},
	})
	if len(variants) != 1 {
		t.Fatalf("unclassified GGUF variants missing: %+v", variants)
	}
	offer, err := catalogOfferFromHFVariant("org/model", immutableHFRevisionForTest, variants[0])
	if err != nil || !catalogOfferInstallable(offer) || len(offer.capabilities) != 0 || offer.modelType != "" {
		t.Fatalf("downloadability must not require inferred capability: %+v err=%v", offer, err)
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

func TestHFCatalogAmbiguousCrossKindRowDoesNotInventKind(t *testing.T) {
	item, ok := mapHFRowToCatalogItem(hfModelSearchEntry{
		ID:          "org/ambiguous-model",
		PipelineTag: "text-to-speech",
		Tags:        []string{"text-generation"},
		Sha:         immutableHFRevisionForTest,
	}, "")
	if !ok || item == nil || item.ModelType != "" || item.InstallAvailable || item.Engine != "" {
		t.Fatalf("cross-kind discovery must not invent admission, got ok=%v item=%v", ok, item)
	}
}

func TestHFCatalogLicenseUsesSourceFactsWithoutGuessing(t *testing.T) {
	for _, tc := range []struct {
		card map[string]any
		tags []string
		want string
	}{
		{nil, []string{"any-to-any", "license:apache-2.0"}, "apache-2.0"},
		{map[string]any{"license": "other"}, []string{"license:apache-2.0"}, "other"},
		{nil, []string{"license:apache-2.0", "license:mit"}, "unknown"},
		{nil, nil, "unknown"},
	} {
		if got := hfCatalogLicense(tc.card, tc.tags); got != tc.want {
			t.Fatalf("license=%q want=%q", got, tc.want)
		}
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

func TestVerifiedAssetDiscoverySurvivesHuggingFaceSearchFailure(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(context.Context, hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return nil, errors.New("Hugging Face unavailable")
	}
	result, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{Query: "qwen"})
	if err != nil || !result.GetHuggingFaceUnavailable() || len(result.GetItems()) == 0 {
		t.Fatalf("HF failure discarded local discovery: result=%v err=%v", result, err)
	}
	assets, err := svc.ListVerifiedAssets(context.Background(), &runtimev1.ListVerifiedAssetsRequest{PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, asset := range assets.GetAssets() {
		if asset.GetTemplateId() == "test.chat.qwen2" {
			found = true
		}
	}
	if !found {
		t.Fatal("HF failure hid the independent built-in catalog")
	}
	plan, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{Source: "verified", TemplateId: "test.chat.qwen2"})
	if err != nil || plan.GetPlan().GetTemplateId() != "test.chat.qwen2" || plan.GetPlan().GetPlanId() == "" {
		t.Fatalf("built-in selection did not resolve its exact plan: %+v, %v", plan, err)
	}
}
