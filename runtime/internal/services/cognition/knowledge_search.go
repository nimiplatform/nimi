package cognition

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) SearchKeyword(ctx context.Context, req *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	targetBanks, err := s.resolveSearchBanks(ctx, req.GetContext(), req.GetBankIds())
	if err != nil {
		return nil, err
	}
	topK := clampPageSize(req.GetTopK(), defaultSearchTopK, maxSearchTopK)
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0)
	for _, bank := range targetBanks {
		scopeID := knowledgeScopeID(bank.GetBankId())
		pages, err := s.cognitionCore.KnowledgeService().SearchLexical(scopeID, query, topK)
		if err != nil {
			return nil, err
		}
		for idx, page := range pages {
			runtimePage, err := cognitionPageToRuntime(bank.GetBankId(), page)
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

func (s *Service) SearchHybrid(ctx context.Context, req *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	pageSize := clampPageSize(req.GetPageSize(), defaultSearchPageSize, maxSearchPageSize)
	pages, err := s.cognitionCore.KnowledgeService().SearchHybrid(scopeID, query, pageSize*4)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	hits := make([]*runtimev1.KnowledgeKeywordHit, 0, len(pages))
	for idx, page := range pages {
		runtimePage, err := cognitionPageToRuntime(bank.GetBankId(), page)
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
