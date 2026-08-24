package cognition

import (
	"context"
	"encoding/json"
	"errors"
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
	mu := s.acquirePageWriteMutex(scope.ScopeID)
	mu.Lock()
	defer mu.Unlock()
	now := time.Now().UTC()
	page, cognitionPage, err := runtimePageToCognition(scope.ScopeID, req, now)
	if err != nil {
		return nil, err
	}
	existing, err := s.resolveKnowledgePage(ctx, KnowledgeActionWritePage, req.GetContext(), scope, scope.ScopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if existing != nil {
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
	writeAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionWritePage, cognitionpkg.RuntimeBridgeOperationSaveKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	if err := s.cognitionCore.RuntimeBridge().SaveKnowledge(ctx, writeAccess, cognitionPage); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return nil, grpcerr.WrapWithReasonCode(
				codes.AlreadyExists,
				runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT,
				err,
				grpcerr.ReasonOptions{Message: "knowledge page slug already exists"},
			)
		}
		return nil, cognitionStorageError(err, "knowledge page could not be saved")
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
	page, err := s.resolveKnowledgePage(ctx, KnowledgeActionReadPage, req.GetContext(), scope, scope.ScopeID, req.GetPageId(), req.GetSlug())
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
	access, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadPage, cognitionpkg.RuntimeBridgeOperationListKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	items, err := s.cognitionCore.RuntimeBridge().ListKnowledge(ctx, access, scope.ScopeID)
	if err != nil {
		return nil, cognitionBridgeError(
			err,
			codes.Internal,
			runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
			grpcerr.ReasonOptions{Message: "knowledge page listing failed"},
		)
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
	page, err := s.resolveKnowledgePage(ctx, KnowledgeActionDeletePage, req.GetContext(), scope, scope.ScopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	deletePageAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionDeletePage, cognitionpkg.RuntimeBridgeOperationDeleteKnowledgePage, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	if err := s.cognitionCore.RuntimeBridge().DeleteKnowledgePage(ctx, deletePageAccess, scope.ScopeID, cognitionknowledge.PageID(page.GetPageId())); err != nil {
		return nil, cognitionStorageError(err, "knowledge page could not be deleted")
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

func (s *Service) resolveKnowledgePage(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext, scope cognitionpkg.KnowledgeScope, bankID string, pageID string, slug string) (*runtimev1.KnowledgePage, error) {
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if pageID != "" {
		loadAccess, err := s.authorizeRuntimeBridgeOperation(ctx, action, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, requestCtx, scope)
		if err != nil {
			return nil, err
		}
		page, err := s.cognitionCore.RuntimeBridge().LoadKnowledge(ctx, loadAccess, scope.ScopeID, cognitionknowledge.PageID(pageID))
		if err != nil {
			switch {
			case errors.Is(err, cognitionpkg.ErrKnowledgePageNotFound):
				return nil, nil
			case errors.Is(err, cognitionpkg.ErrScopeNotFound):
				return nil, grpcerr.WrapWithReasonCode(
					codes.NotFound,
					runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND,
					err,
					grpcerr.ReasonOptions{Message: "knowledge bank not found"},
				)
			default:
				return nil, cognitionBridgeError(
					err,
					codes.Internal,
					runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
					grpcerr.ReasonOptions{Message: "knowledge page lookup failed"},
				)
			}
		}
		return cognitionPageToRuntime(bankID, *page)
	}
	listAccess, err := s.authorizeRuntimeBridgeOperation(ctx, action, cognitionpkg.RuntimeBridgeOperationListKnowledge, requestCtx, scope)
	if err != nil {
		return nil, err
	}
	items, err := s.cognitionCore.RuntimeBridge().ListKnowledge(ctx, listAccess, scope.ScopeID)
	if err != nil {
		switch {
		case errors.Is(err, cognitionpkg.ErrScopeNotFound):
			return nil, grpcerr.WrapWithReasonCode(
				codes.NotFound,
				runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND,
				err,
				grpcerr.ReasonOptions{Message: "knowledge bank not found"},
			)
		default:
			return nil, cognitionBridgeError(
				err,
				codes.Internal,
				runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
				grpcerr.ReasonOptions{Message: "knowledge page lookup failed"},
			)
		}
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
