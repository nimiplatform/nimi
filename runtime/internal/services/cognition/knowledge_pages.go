package cognition

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	cognitionknowledge "github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PutPage upserts a knowledge page in the typed scope. Per-scope
// serialization makes the resolveKnowledgePage->Save sequence atomic
// so concurrent writers on the same (bank, slug) cannot both miss
// the existing-slug check and commit two distinct page rows.
func (s *Service) PutPage(ctx context.Context, req *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionWritePage)
	if err != nil {
		return nil, err
	}
	writeAccess := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionWritePage, req.GetContext(), scope)
	readAccess := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionReadPage, req.GetContext(), scope)
	mu := s.acquirePageWriteMutex(scope.ScopeID)
	mu.Lock()
	defer mu.Unlock()
	now := time.Now().UTC()
	page, cognitionPage, err := runtimePageToCognition(scope.ScopeID, req, now)
	if err != nil {
		return nil, err
	}
	if existing, err := s.resolveKnowledgePage(ctx, readAccess, scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug()); err == nil && existing != nil {
		page.PageId = existing.GetPageId()
		cognitionPage.PageID = cognitionknowledge.PageID(existing.GetPageId())
		// Rebuild the embedded runtime-projection body so its inner
		// page_id matches the upsert target. Without this the body
		// keeps the freshly-generated pageID from runtimePageToCognition
		// while the row's primary key is the existing pageID, causing
		// follow-up Load to return the body's stale pageID.
		body := storedKnowledgeBody{
			Content: page.GetContent(),
			Runtime: mustProtoJSON(page),
		}
		cognitionPage.Body = mustMarshalJSON(body)
	}
	if err := s.cognitionCore.RuntimeBridge().SaveKnowledge(ctx, writeAccess, cognitionPage); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "put page: cognition storage error: " + err.Error(),
		})
	}
	page.BankId = scope.ScopeID
	return &runtimev1.PutPageResponse{Page: page}, nil
}

// GetPage loads a single page by id or slug.
func (s *Service) GetPage(ctx context.Context, req *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadPage)
	if err != nil {
		return nil, err
	}
	access := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionReadPage, req.GetContext(), scope)
	page, err := s.resolveKnowledgePage(ctx, access, scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	return &runtimev1.GetPageResponse{Page: page}, nil
}

// ListPages enumerates pages in a typed scope with admitted filters.
func (s *Service) ListPages(ctx context.Context, req *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadPage)
	if err != nil {
		return nil, err
	}
	access := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionReadPage, req.GetContext(), scope)
	items, err := s.cognitionCore.RuntimeBridge().ListKnowledge(ctx, access, scope.ScopeID)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	pages := make([]*runtimev1.KnowledgePage, 0, len(items))
	for _, item := range items {
		page, err := cognitionPageToRuntime(scope.ScopeID, item)
		if err != nil {
			return nil, err
		}
		if !matchesPageFilters(page, req.GetEntityTypeFilters(), req.GetSlugPrefix()) {
			continue
		}
		pages = append(pages, page)
	}
	sortKnowledgePages(pages)
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultKnowledgePageSize, maxKnowledgePageSize)
	start, end, next := pageWindow(len(pages), offset, pageSize)
	return &runtimev1.ListPagesResponse{
		Pages:         pages[start:end],
		NextPageToken: next,
	}, nil
}

// DeletePage removes a single page after authorization.
func (s *Service) DeletePage(ctx context.Context, req *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionDeletePage)
	if err != nil {
		return nil, err
	}
	writeAccess := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionDeletePage, req.GetContext(), scope)
	readAccess := runtimeAuthorizationForKnowledge(ctx, KnowledgeActionReadPage, req.GetContext(), scope)
	page, err := s.resolveKnowledgePage(ctx, readAccess, scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	if err := s.deleteKnowledgeRelationsForPage(ctx, readAccess, writeAccess, scope.ScopeID, page.GetPageId()); err != nil {
		return nil, err
	}
	if err := s.cognitionCore.RuntimeBridge().DeleteKnowledge(ctx, writeAccess, scope.ScopeID, cognitionknowledge.PageID(page.GetPageId())); err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "delete page: cognition storage error: " + err.Error(),
		})
	}
	return &runtimev1.DeletePageResponse{Ack: okAck()}, nil
}

// acquirePageWriteMutex returns the per-scope mutex for serializing
// PutPage critical sections. Lazy-initialized via sync.Map.
func (s *Service) acquirePageWriteMutex(scopeID string) *sync.Mutex {
	if existing, ok := s.pageWriteMu.Load(scopeID); ok {
		return existing.(*sync.Mutex)
	}
	actual, _ := s.pageWriteMu.LoadOrStore(scopeID, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

func runtimePageToCognition(scopeID string, req *runtimev1.PutPageRequest, now time.Time) (*runtimev1.KnowledgePage, cognitionknowledge.Page, error) {
	pageID := strings.TrimSpace(req.GetPageId())
	if pageID == "" {
		pageID = newULID()
	}
	page := &runtimev1.KnowledgePage{
		PageId:     pageID,
		BankId:     strings.TrimSpace(req.GetBankId()),
		Slug:       strings.TrimSpace(req.GetSlug()),
		Title:      defaultPageTitle(strings.TrimSpace(req.GetSlug()), req.GetTitle()),
		Content:    strings.TrimSpace(req.GetContent()),
		EntityType: strings.TrimSpace(req.GetEntityType()),
		Metadata:   cloneStruct(req.GetMetadata()),
		CreatedAt:  timestamppb.New(now),
		UpdatedAt:  timestamppb.New(now),
	}
	body := storedKnowledgeBody{
		Content: page.GetContent(),
		Runtime: mustProtoJSON(page),
	}
	return page, cognitionknowledge.Page{
		PageID:    cognitionknowledge.PageID(page.GetPageId()),
		ScopeID:   scopeID,
		Kind:      projectionKindForEntityType(page.GetEntityType()),
		Version:   1,
		Title:     page.GetTitle(),
		Body:      mustMarshalJSON(body),
		Lifecycle: cognitionknowledge.ProjectionLifecycleActive,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}

func cognitionPageToRuntime(bankID string, page cognitionknowledge.Page) (*runtimev1.KnowledgePage, error) {
	var stored storedKnowledgeBody
	if err := json.Unmarshal(page.Body, &stored); err != nil {
		return nil, err
	}
	if len(stored.Runtime) > 0 {
		var out runtimev1.KnowledgePage
		if err := protojson.Unmarshal(stored.Runtime, &out); err == nil {
			out.BankId = bankID
			out.UpdatedAt = timestamppb.New(page.UpdatedAt)
			return &out, nil
		}
	}
	return &runtimev1.KnowledgePage{
		PageId:    string(page.PageID),
		BankId:    bankID,
		Title:     page.Title,
		Content:   stored.Content,
		CreatedAt: timestamppb.New(page.CreatedAt),
		UpdatedAt: timestamppb.New(page.UpdatedAt),
	}, nil
}

func (s *Service) resolveKnowledgePage(ctx context.Context, access cognitionpkg.RuntimeAuthorization, bankID string, scopeID string, pageID string, slug string) (*runtimev1.KnowledgePage, error) {
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if pageID != "" {
		page, err := s.cognitionCore.RuntimeBridge().LoadKnowledge(ctx, access, scopeID, cognitionknowledge.PageID(pageID))
		if err != nil {
			return nil, nil
		}
		return cognitionPageToRuntime(bankID, *page)
	}
	items, err := s.cognitionCore.RuntimeBridge().ListKnowledge(ctx, access, scopeID)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		page, err := cognitionPageToRuntime(bankID, item)
		if err != nil {
			return nil, err
		}
		if page.GetSlug() == slug {
			return page, nil
		}
	}
	return nil, nil
}

func defaultPageTitle(slug, title string) string {
	if strings.TrimSpace(title) != "" {
		return strings.TrimSpace(title)
	}
	return strings.TrimSpace(slug)
}

func projectionKindForEntityType(entityType string) cognitionknowledge.ProjectionKind {
	value := strings.ToLower(strings.TrimSpace(entityType))
	switch {
	case strings.Contains(value, "summary"):
		return cognitionknowledge.ProjectionKindSummary
	case strings.Contains(value, "guide"):
		return cognitionknowledge.ProjectionKindGuide
	case strings.Contains(value, "explainer"):
		return cognitionknowledge.ProjectionKindExplainer
	default:
		return cognitionknowledge.ProjectionKindNote
	}
}

func mustMarshalJSON(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

func matchesPageFilters(page *runtimev1.KnowledgePage, entityTypes []string, slugPrefix string) bool {
	if page == nil {
		return false
	}
	if strings.TrimSpace(slugPrefix) != "" && !strings.HasPrefix(strings.ToLower(page.GetSlug()), strings.ToLower(strings.TrimSpace(slugPrefix))) {
		return false
	}
	if len(entityTypes) == 0 {
		return true
	}
	for _, entityType := range entityTypes {
		if strings.EqualFold(strings.TrimSpace(entityType), strings.TrimSpace(page.GetEntityType())) {
			return true
		}
	}
	return false
}

func buildKeywordHit(page *runtimev1.KnowledgePage, score float32) *runtimev1.KnowledgeKeywordHit {
	snippet := strings.TrimSpace(page.GetContent())
	if len(snippet) > 160 {
		snippet = snippet[:160]
	}
	return &runtimev1.KnowledgeKeywordHit{
		BankId:   page.GetBankId(),
		PageId:   page.GetPageId(),
		Slug:     page.GetSlug(),
		Title:    page.GetTitle(),
		Snippet:  snippet,
		Score:    score,
		Metadata: cloneStruct(page.GetMetadata()),
	}
}
