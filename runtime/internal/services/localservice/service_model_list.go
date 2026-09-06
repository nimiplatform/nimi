package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"google.golang.org/grpc/codes"
)

func (s *Service) ListVerifiedAssets(_ context.Context, req *runtimev1.ListVerifiedAssetsRequest) (*runtimev1.ListVerifiedAssetsResponse, error) {
	kindFilter := req.GetKindFilter()
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))

	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.LocalVerifiedAssetDescriptor, 0, len(s.verified))
	for _, item := range s.verified {
		projected := cloneVerifiedAsset(item)
		projected.Kind = effectiveAssetKind(projected.GetKind(), projected.GetCapabilities())
		if engineFilter != "" && strings.ToLower(strings.TrimSpace(item.GetEngine())) != engineFilter {
			continue
		}
		if kindFilter != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED && projected.GetKind() != kindFilter {
			continue
		}
		items = append(items, projected)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].GetTemplateId() < items[j].GetTemplateId()
	})
	filterDigest := pagination.FilterDigest(kindFilter.String(), engineFilter)
	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, req.GetPageSize(), 50, 200, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListVerifiedAssetsResponse{
		Assets:        items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) SearchCatalogModels(ctx context.Context, req *runtimev1.SearchCatalogModelsRequest) (*runtimev1.SearchCatalogModelsResponse, error) {
	query := strings.ToLower(strings.TrimSpace(req.GetQuery()))
	category := strings.ToLower(strings.TrimSpace(req.GetCategory()))
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if category != "" {
		if _, err := normalizeModelIndexCategory(category); err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "catalog category is invalid"})
		}
	}
	pageSize := normalizeCatalogSearchPageSize(req.GetPageSize())
	filterDigest := pagination.FilterDigest(query, category)
	if _, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest); err != nil {
		return nil, err
	}

	internal := make([]*runtimev1.LocalCatalogModelDescriptor, 0)
	for _, item := range s.catalogSnapshot() {
		if !matchesCatalogBrowse(item, query, category) {
			continue
		}
		internal = append(internal, item)
	}
	hfItems, err := s.searchHFCatalog(ctx, hfCatalogSearchRequest{
		Query:          query,
		CategoryFilter: category,
		Limit:          int32(pageSize),
	})
	if err != nil {
		if strings.Contains(err.Error(), errHfRepoInvalid.Error()) {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID, err, grpcerr.ReasonOptions{Message: "catalog repository is invalid"})
		}
		return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: "catalog search failed"})
	}
	for _, item := range hfItems {
		if matchesCatalogBrowse(item, query, category) {
			internal = append(internal, cloneCatalogItem(item))
		}
	}
	sort.Slice(internal, func(i, j int) bool {
		if internal[i].GetVerified() != internal[j].GetVerified() {
			return internal[i].GetVerified()
		}
		if strings.EqualFold(internal[i].GetTitle(), internal[j].GetTitle()) {
			return internal[i].GetItemId() < internal[j].GetItemId()
		}
		return strings.ToLower(internal[i].GetTitle()) < strings.ToLower(internal[j].GetTitle())
	})
	internal = dedupeCatalogItems(internal)

	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, int32(pageSize), 50, 200, len(internal))
	if err != nil {
		return nil, err
	}
	items := make([]*runtimev1.ModelAssetCatalogSearchResult, 0, end-start)
	for _, item := range internal[start:end] {
		projected, err := projectCatalogSearchResult(item)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_CATALOG_SCHEMA_INVALID, err, grpcerr.ReasonOptions{Message: "catalog search result identity is invalid"})
		}
		items = append(items, projected)
	}
	return &runtimev1.SearchCatalogModelsResponse{Items: items, NextPageToken: next}, nil
}

func normalizeCatalogSearchPageSize(raw int32) int {
	if raw <= 0 {
		return 50
	}
	if raw > 200 {
		return 200
	}
	return int(raw)
}

func (s *Service) ListCatalogVariants(ctx context.Context, req *runtimev1.ListCatalogVariantsRequest) (*runtimev1.ListCatalogVariantsResponse, error) {
	sourceKind, locator, revision, err := parseModelAssetModelLocator(req.GetModelLocator())
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{Message: "catalog model locator is invalid"})
	}
	offers := make([]catalogOffer, 0)
	switch sourceKind {
	case "huggingface":
		var found bool
		offers, found = s.modelIndexOffersForLocator(locator, revision)
		if found {
			break
		}
		variants, err := s.listHFCatalogVariants(ctx, locator, revision)
		if err != nil {
			if strings.Contains(err.Error(), errHfRepoInvalid.Error()) {
				return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID, err, grpcerr.ReasonOptions{Message: "catalog repository is invalid"})
			}
			return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED, err, grpcerr.ReasonOptions{Message: "catalog variant lookup failed"})
		}
		for _, variant := range variants {
			offer, err := catalogOfferFromHFVariant(locator, variant.Revision, variant)
			if err != nil {
				continue
			}
			offers = append(offers, offer)
		}
	case "verified":
		for _, item := range s.catalogSnapshot() {
			itemLocator := catalogItemLocator(item)
			if itemLocator != locator || defaultString(strings.TrimSpace(item.GetRevision()), "main") != revision {
				continue
			}
			offer, err := catalogOfferFromCatalogItem(item)
			if err == nil {
				offers = append(offers, offer)
			}
		}
	default:
		return nil, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "catalog source is unsupported"})
	}
	sort.Slice(offers, func(i, j int) bool {
		if offers[i].totalSizeBytes != offers[j].totalSizeBytes {
			return offers[i].totalSizeBytes < offers[j].totalSizeBytes
		}
		return offers[i].offerRef < offers[j].offerRef
	})
	result := make([]*runtimev1.ModelAssetMarketCandidate, 0, len(offers))
	for _, offer := range offers {
		result = append(result, s.projectMarketCandidate(offer))
	}
	return &runtimev1.ListCatalogVariantsResponse{Variants: result}, nil
}

func matchesCatalogBrowse(item *runtimev1.LocalCatalogModelDescriptor, query string, category string) bool {
	if !matchesCatalogSearch(item, query, "") {
		return false
	}
	return category == "" || stringSetContains(marketCategoriesForCatalogItem(item), category)
}

func projectCatalogSearchResult(item *runtimev1.LocalCatalogModelDescriptor) (*runtimev1.ModelAssetCatalogSearchResult, error) {
	if item == nil {
		return nil, fmt.Errorf("catalog item is required")
	}
	sourceKind := strings.ToLower(strings.TrimSpace(item.GetSource()))
	if sourceKind == "" {
		sourceKind = "verified"
	}
	locator := catalogItemLocator(item)
	revision := defaultString(strings.TrimSpace(item.GetRevision()), "main")
	modelLocator, err := newModelAssetModelLocator(sourceKind, locator, revision)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ModelAssetCatalogSearchResult{
		ModelLocator: modelLocator,
		SourceLabel:  sourceKind,
		Title:        defaultString(item.GetTitle(), locator),
		Description:  strings.TrimSpace(item.GetDescription()),
		Categories:   marketCategoriesForCatalogItem(item),
		ModelType:    strings.TrimSpace(item.GetModelType()),
		Author:       catalogLocatorOwner(locator),
		License:      strings.TrimSpace(item.GetLicense()),
		Tags:         normalizeStringSlice(item.GetTags()),
		Downloads:    item.GetDownloads(),
		Likes:        item.GetLikes(),
		LastModified: strings.TrimSpace(item.GetLastModified()),
		Verified:     item.GetVerified(),
	}, nil
}

func catalogItemLocator(item *runtimev1.LocalCatalogModelDescriptor) string {
	if item == nil {
		return ""
	}
	return defaultString(strings.TrimSpace(item.GetRepo()), defaultString(strings.TrimSpace(item.GetModelId()), strings.TrimSpace(item.GetTemplateId())))
}

func marketCategoriesForCatalogItem(item *runtimev1.LocalCatalogModelDescriptor) []string {
	if item == nil {
		return nil
	}
	categories := make([]string, 0, 3)
	for _, capability := range item.GetCapabilities() {
		switch normalizeLocalCapabilityToken(capability) {
		case "image.generate":
			categories = append(categories, "image")
		case "video.generate":
			categories = append(categories, "video")
		case "text.generate", "text.embed":
			categories = append(categories, "chat")
		}
	}
	switch strings.ToLower(strings.TrimSpace(item.GetModelType())) {
	case "image":
		categories = append(categories, "image")
	case "video":
		categories = append(categories, "video")
	case "chat", "llm":
		categories = append(categories, "chat")
	}
	return normalizeStringSlice(categories)
}

func catalogOfferFromCatalogItem(item *runtimev1.LocalCatalogModelDescriptor) (catalogOffer, error) {
	if item == nil {
		return catalogOffer{}, fmt.Errorf("catalog item is required")
	}
	sourceKind := strings.ToLower(strings.TrimSpace(item.GetSource()))
	if sourceKind == "" {
		sourceKind = "verified"
	}
	identity := modelAssetOfferIdentity{
		sourceKind: sourceKind,
		locator:    catalogItemLocator(item),
		revision:   defaultString(strings.TrimSpace(item.GetRevision()), "main"),
		entryID:    defaultString(strings.TrimSpace(item.GetTemplateId()), defaultString(strings.TrimSpace(item.GetItemId()), strings.TrimSpace(item.GetEntry()))),
	}
	offerRef, err := newModelAssetOfferRef(identity)
	if err != nil {
		return catalogOffer{}, err
	}
	return catalogOffer{
		identity:         identity,
		entryPath:        strings.TrimSpace(item.GetEntry()),
		offerRef:         offerRef,
		itemID:           strings.TrimSpace(item.GetItemId()),
		templateID:       strings.TrimSpace(item.GetTemplateId()),
		modelID:          strings.TrimSpace(item.GetModelId()),
		title:            strings.TrimSpace(item.GetTitle()),
		description:      strings.TrimSpace(item.GetDescription()),
		categories:       marketCategoriesForCatalogItem(item),
		capabilities:     normalizeAssetCapabilities(item.GetCapabilities()),
		modelType:        strings.TrimSpace(item.GetModelType()),
		format:           catalogOfferFormat(item.GetEntry()),
		files:            append([]string(nil), item.GetFiles()...),
		hashes:           cloneStringMap(item.GetHashes()),
		totalSizeBytes:   item.GetTotalSizeBytes(),
		license:          strings.TrimSpace(item.GetLicense()),
		tags:             normalizeStringSlice(item.GetTags()),
		downloads:        item.GetDownloads(),
		likes:            item.GetLikes(),
		lastModified:     strings.TrimSpace(item.GetLastModified()),
		verified:         item.GetVerified(),
		sourceProvenance: strings.TrimSpace(item.GetSourceProvenance()),
		hostRequirements: cloneHostRequirements(item.GetHostRequirements()),
	}, nil
}

func catalogOfferFromHFVariant(repo string, revision string, variant hfCatalogVariant) (catalogOffer, error) {
	identity := modelAssetOfferIdentity{
		sourceKind: "huggingface",
		locator:    strings.TrimSpace(repo),
		revision:   defaultString(strings.TrimSpace(revision), "main"),
		entryID:    hfVariantEntryIdentity(variant.Format, variant.Entry),
	}
	offerRef, err := newModelAssetOfferRef(identity)
	if err != nil {
		return catalogOffer{}, err
	}
	hash := normalizeExactSHA256Hex(variant.SHA256)
	hashes := cloneStringMap(variant.Hashes)
	totalSizeBytes := variant.SizeBytes
	if len(variant.Files) == 0 {
		totalSizeBytes = 0
	}
	for _, file := range variant.Files {
		if file == strings.TrimSpace(variant.Entry) && hashes[file] == "" && hash != "" {
			hashes[file] = hash
		}
	}
	return catalogOffer{
		identity:       identity,
		entryPath:      strings.TrimSpace(variant.Entry),
		offerRef:       offerRef,
		modelID:        identity.locator,
		title:          defaultString(variant.Title, identity.locator),
		description:    strings.TrimSpace(variant.Description),
		categories:     normalizeStringSlice(variant.Categories),
		capabilities:   normalizeAssetCapabilities(variant.Capabilities),
		modelType:      strings.TrimSpace(variant.ModelType),
		format:         defaultString(variant.Format, catalogOfferFormat(variant.Entry)),
		files:          append([]string(nil), variant.Files...),
		hashes:         hashes,
		totalSizeBytes: totalSizeBytes,
		license:        defaultString(strings.TrimSpace(variant.License), "unknown"),
		tags:           normalizeStringSlice(variant.Tags),
		downloads:      variant.Downloads,
		likes:          variant.Likes,
		lastModified:   strings.TrimSpace(variant.LastModified),
	}, nil
}

func hfVariantEntryIdentity(format string, entry string) string {
	normalizedFormat := strings.ToLower(strings.TrimSpace(format))
	if normalizedFormat == "" {
		normalizedFormat = catalogOfferFormat(entry)
	}
	if normalizedFormat == "" {
		return strings.TrimSpace(entry)
	}
	return normalizedFormat + ":" + strings.TrimSpace(entry)
}

func dedupeCatalogItems(items []*runtimev1.LocalCatalogModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	seen := make(map[string]bool, len(items))
	out := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(item.GetSource()) + "|" + catalogItemLocator(item))
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}
