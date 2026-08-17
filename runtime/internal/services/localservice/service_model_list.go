package localservice

import (
	"context"
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
	capability := strings.ToLower(strings.TrimSpace(req.GetCapability()))
	categoryFilter := strings.ToLower(strings.TrimSpace(req.GetCategoryFilter()))
	engineFilter := strings.ToLower(strings.TrimSpace(req.GetEngineFilter()))
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	pageSize := normalizeCatalogSearchPageSize(req.GetPageSize())
	filterDigest := pagination.FilterDigest(query, capability, categoryFilter, engineFilter)
	if _, err := pagination.ValidatePageToken(req.GetPageToken(), filterDigest); err != nil {
		return nil, err
	}

	localCatalog := s.catalogSnapshot()

	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(localCatalog)+hfCatalogDefaultLimit)
	for _, item := range localCatalog {
		if !matchesCatalogFilters(item, query, capability, categoryFilter, engineFilter) {
			continue
		}
		items = append(items, item)
	}

	hfItems, err := s.searchHFCatalog(ctx, hfCatalogSearchRequest{
		Query:          query,
		Capability:     capability,
		CategoryFilter: categoryFilter,
		EngineFilter:   engineFilter,
		Limit:          int32(pageSize),
	})
	if err != nil {
		if strings.Contains(err.Error(), errHfRepoInvalid.Error()) {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "catalog repository is invalid"},
			)
		}
		return nil, grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED,
			err,
			grpcerr.ReasonOptions{Message: "catalog search failed"},
		)
	}
	for _, item := range hfItems {
		if !matchesCatalogFilters(item, query, capability, categoryFilter, engineFilter) {
			continue
		}
		items = append(items, cloneCatalogItem(item))
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].GetVerified() != items[j].GetVerified() {
			return items[i].GetVerified()
		}
		if strings.EqualFold(items[i].GetTitle(), items[j].GetTitle()) {
			return items[i].GetItemId() < items[j].GetItemId()
		}
		return strings.ToLower(items[i].GetTitle()) < strings.ToLower(items[j].GetTitle())
	})
	items = dedupeCatalogItems(items)

	start, end, next, err := resolvePageBounds(req.GetPageToken(), filterDigest, int32(pageSize), 50, 200, len(items))
	if err != nil {
		return nil, err
	}
	return &runtimev1.SearchCatalogModelsResponse{
		Items:         items[start:end],
		NextPageToken: next,
	}, nil
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
	variants, err := s.listHFCatalogVariants(ctx, req.GetRepo())
	if err != nil {
		if strings.Contains(err.Error(), errHfRepoInvalid.Error()) {
			return nil, grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "catalog repository is invalid"},
			)
		}
		return nil, grpcerr.WrapWithReasonCode(
			codes.Unavailable,
			runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED,
			err,
			grpcerr.ReasonOptions{Message: "catalog search failed"},
		)
	}
	return &runtimev1.ListCatalogVariantsResponse{Variants: variants}, nil
}

func matchesCatalogFilters(item *runtimev1.LocalCatalogModelDescriptor, query string, capability string, categoryFilter string, engineFilter string) bool {
	if !matchesCatalogSearch(item, query, capability) {
		return false
	}
	if engineFilter != "" && strings.ToLower(strings.TrimSpace(item.GetEngine())) != engineFilter {
		return false
	}
	if categoryFilter == "" {
		return true
	}
	for _, tag := range item.GetTags() {
		if strings.EqualFold(strings.TrimSpace(tag), categoryFilter) {
			return true
		}
	}
	for _, capName := range item.GetCapabilities() {
		if strings.EqualFold(strings.TrimSpace(capName), categoryFilter) {
			return true
		}
	}
	return false
}

func dedupeCatalogItems(items []*runtimev1.LocalCatalogModelDescriptor) []*runtimev1.LocalCatalogModelDescriptor {
	seen := make(map[string]bool, len(items))
	out := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(item.GetModelId()) + "|" + strings.TrimSpace(item.GetEngine()))
		if key == "|" {
			key = strings.ToLower(strings.TrimSpace(item.GetItemId()))
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}
