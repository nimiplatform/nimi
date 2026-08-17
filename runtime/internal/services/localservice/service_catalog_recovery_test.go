package localservice

import (
	"context"
	"errors"
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

func TestSearchCatalogModelsDedupesByModelAndEngine(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_dup_llama",
				Source:       "huggingface",
				Title:        "Community Llama Dup",
				ModelId:      "local/llama3.1",
				Repo:         "nimiplatform/llama3.1-8b-instruct",
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
	count := 0
	for _, item := range resp.GetItems() {
		if item.GetModelId() == "local/llama3.1" && strings.EqualFold(item.GetEngine(), "llama") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected deduped model count=1 for local/llama3.1 llama, got %d", count)
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
		Query:        "Llama",
		Capability:   "image",
		EngineFilter: "media",
		PageSize:     7,
	}); err != nil {
		t.Fatalf("search catalog models: %v", err)
	}

	if captured.Query != "llama" {
		t.Fatalf("query should be normalized to lowercase, got %q", captured.Query)
	}
	if captured.Capability != "image" {
		t.Fatalf("capability mismatch: %q", captured.Capability)
	}
	if captured.EngineFilter != "media" {
		t.Fatalf("engine filter mismatch: %q", captured.EngineFilter)
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
	svc.hfCatalogVariants = func(_ context.Context, repo string) ([]*runtimev1.LocalCatalogVariantDescriptor, error) {
		capturedRepo = repo
		return []*runtimev1.LocalCatalogVariantDescriptor{
			{
				Filename:  "model-q4.gguf",
				Entry:     "model-q4.gguf",
				Files:     []string{"model-q4.gguf"},
				Format:    "gguf",
				SizeBytes: 2048,
				Sha256:    "abc",
			},
		}, nil
	}

	resp, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{
		Repo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
	})
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
	if got.GetFilename() != "model-q4.gguf" || got.GetEntry() != "model-q4.gguf" || got.GetFormat() != "gguf" {
		t.Fatalf("unexpected variant descriptor: %+v", got)
	}
	if got.GetSizeBytes() != 2048 || got.GetSha256() != "abc" {
		t.Fatalf("variant metadata mismatch: size=%d sha=%q", got.GetSizeBytes(), got.GetSha256())
	}
}

func TestListCatalogVariantsInvalidRepoReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogVariants = defaultHFCatalogVariants

	_, err := svc.ListCatalogVariants(context.Background(), &runtimev1.ListCatalogVariantsRequest{
		Repo: "invalid_repo_format",
	})
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

func TestListHFCatalogVariantsFromDetailsSelectsFilesAndSorts(t *testing.T) {
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
	if variants[0].GetFilename() != "model-q4.gguf" || variants[1].GetFilename() != "adapter/model.safetensors" || variants[2].GetFilename() != "model-q8.gguf" {
		t.Fatalf("variants should sort by size and skip unsafe files, got %v", []string{
			variants[0].GetFilename(),
			variants[1].GetFilename(),
			variants[2].GetFilename(),
		})
	}
	if got := variants[0].GetFiles(); len(got) != 1 || got[0] != "model-q4.gguf" {
		t.Fatalf("llama gguf manual variant should install only selected entry, got %v", got)
	}
	if got := variants[1].GetFiles(); len(got) < 3 || got[0] != "adapter/model.safetensors" || got[1] != "config.json" || got[2] != "tokenizer.json" {
		t.Fatalf("safetensors variant should include preferred companion files, got %v", got)
	}
	if variants[1].GetFormat() != "safetensors" || variants[1].GetSha256() != "safe" {
		t.Fatalf("safetensors metadata mismatch: %+v", variants[1])
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
		{pipeline: "feature-extraction", want: "text.embed"},
		{pipeline: "text-to-image", want: "image.generate"},
		{pipeline: "text-to-video", want: "video.generate"},
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
