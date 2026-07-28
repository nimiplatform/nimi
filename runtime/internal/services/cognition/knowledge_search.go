package cognition

import (
	"context"
	"sort"
	"strings"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// SearchKeyword performs lexical search across one or more typed
// scopes. When req.bank_ids is empty, search defaults to every scope
// the caller can read.
func (s *Service) SearchKeyword(ctx context.Context, req *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scopes, err := s.resolveSearchScopes(ctx, req.GetContext(), req.GetBankIds())
	if err != nil {
		return nil, err
	}
	topK := clampPageSize(req.GetTopK(), defaultSearchTopK, maxSearchTopK)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0)
	for _, scope := range scopes {
		access := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionSearch, req.GetContext(), scope)
		pages, err := s.cognitionCore.RuntimeBridge().SearchKnowledge(ctx, access, scope.ScopeID, query, topK)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
		}
		for idx, page := range pages {
			runtimePage, err := cognitionPageToRuntime(scope.ScopeID, page)
			if err != nil {
				return nil, err
			}
			if !matchesPageFilters(runtimePage, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
				continue
			}
			hits = append(hits, buildKeywordHit(runtimePage, float32(1.0/float32(idx+1))))
		}
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].GetScore() > hits[j].GetScore() })
	if len(hits) > topK {
		hits = hits[:topK]
	}
	return &runtimev1.SearchKeywordResponse{Hits: hits, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

// SearchHybrid performs lexical+vector recall on a single typed
// scope. Hybrid retrieval failure surfaces the
// KNOWLEDGE_HYBRID_SEARCH_UNAVAILABLE reason; never silently
// downgrades to SearchKeyword (D-DSYNC-018 / K-KNOW-004a).
func (s *Service) SearchHybrid(ctx context.Context, req *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionSearch)
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultSearchPageSize, maxSearchPageSize)
	access := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionSearch, req.GetContext(), scope)
	pages, err := s.cognitionCore.RuntimeBridge().SearchKnowledgeHybrid(ctx, access, scope.ScopeID, query, pageSize*4)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_KNOWLEDGE_HYBRID_SEARCH_UNAVAILABLE)
	}
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0, len(pages))
	for idx, page := range pages {
		runtimePage, err := cognitionPageToRuntime(scope.ScopeID, page)
		if err != nil {
			return nil, err
		}
		if !matchesPageFilters(runtimePage, req.GetEntityTypeFilters(), "") {
			continue
		}
		hits = append(hits, buildKeywordHit(runtimePage, float32(1.0/float32(idx+1))))
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	start, end, next := pageWindow(len(hits), offset, pageSize)
	return &runtimev1.SearchHybridResponse{
		Hits:          hits[start:end],
		NextPageToken: next,
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

// resolveSearchScopes returns the explicit bank_ids (each authorized
// for read) when present; otherwise enumerates every scope the caller
// can read via listAuthorizedScopes.
func (s *Service) resolveSearchScopes(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext, bankIDs []string) ([]cognitionpkg.KnowledgeScope, error) {
	normalized := make([]string, 0, len(bankIDs))
	seen := map[string]struct{}{}
	for _, id := range bankIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	if len(normalized) == 0 {
		return s.listAuthorizedScopes(ctx, requestCtx)
	}
	scopes := make([]cognitionpkg.KnowledgeScope, 0, len(normalized))
	for _, id := range normalized {
		scope, err := s.loadAuthorizedScope(ctx, requestCtx, id, KnowledgeActionSearch)
		if err != nil {
			return nil, err
		}
		scopes = append(scopes, scope)
	}
	return scopes, nil
}
