package knowledge

import (
	"context"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) PutPage(_ context.Context, req *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	if bankID == "" || slug == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}

	pageID := strings.TrimSpace(req.GetPageId())
	slugOwnerPageID, slugTaken := state.SlugToPage[slug]
	if pageID != "" && slugTaken && slugOwnerPageID != pageID {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
	}

	now := time.Now().UTC()
	previous := cloneBankState(state)
	page := upsertPageLocked(state, req, now)
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.PutPageResponse{Page: cloneKnowledgePage(page)}, nil
}

func (s *Service) GetPage(_ context.Context, req *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	state, page, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	_ = state
	return &runtimev1.GetPageResponse{Page: cloneKnowledgePage(page)}, nil
}

func (s *Service) ListPages(_ context.Context, req *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	if bankID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.RUnlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.RUnlock()
		return nil, err
	}
	items := make([]*runtimev1.KnowledgePage, 0, len(state.PagesByID))
	for _, page := range state.PagesByID {
		if !matchesPageFilters(page, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
			continue
		}
		items = append(items, cloneKnowledgePage(page))
	}
	s.mu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetUpdatedAt())
		right := timestampValue(items[j].GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetPageId() < items[j].GetPageId()
		}
		return left.After(right)
	})

	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultPagePageSize, maxPagePageSize)
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListPagesResponse{
		Pages:         items[start:end],
		NextPageToken: next,
	}, nil
}

func (s *Service) DeletePage(_ context.Context, req *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	if bankID == "" || (pageID == "" && slug == "") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	page := resolveExistingPage(state, pageID, slug)
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	previous := cloneBankState(state)
	delete(state.PagesByID, page.GetPageId())
	delete(state.SlugToPage, page.GetSlug())
	for linkID, link := range state.LinksByID {
		if link == nil {
			continue
		}
		if link.GetFromPageId() == page.GetPageId() || link.GetToPageId() == page.GetPageId() {
			delete(state.LinksByID, linkID)
		}
	}
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.DeletePageResponse{
		Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
	}, nil
}

func upsertPageLocked(state *bankState, req *runtimev1.PutPageRequest, now time.Time) *runtimev1.KnowledgePage {
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	existing := resolveExistingPage(state, pageID, slug)
	if existing == nil {
		if pageID == "" {
			pageID = ulid.Make().String()
		}
		page := &runtimev1.KnowledgePage{
			PageId:     pageID,
			BankId:     strings.TrimSpace(req.GetBankId()),
			Slug:       slug,
			Title:      defaultPageTitle(slug, req.GetTitle()),
			Content:    strings.TrimSpace(req.GetContent()),
			EntityType: strings.TrimSpace(req.GetEntityType()),
			Metadata:   cloneStruct(req.GetMetadata()),
			CreatedAt:  timestamppb.New(now),
			UpdatedAt:  timestamppb.New(now),
		}
		state.PagesByID[pageID] = page
		state.SlugToPage[slug] = pageID
		state.Bank.UpdatedAt = timestamppb.New(now)
		return page
	}

	if existing.GetSlug() != slug {
		delete(state.SlugToPage, existing.GetSlug())
		state.SlugToPage[slug] = existing.GetPageId()
	}
	existing.Slug = slug
	existing.Title = defaultPageTitle(slug, req.GetTitle())
	existing.Content = strings.TrimSpace(req.GetContent())
	existing.EntityType = strings.TrimSpace(req.GetEntityType())
	existing.Metadata = cloneStruct(req.GetMetadata())
	existing.UpdatedAt = timestamppb.New(now)
	state.Bank.UpdatedAt = timestamppb.New(now)
	return existing
}
