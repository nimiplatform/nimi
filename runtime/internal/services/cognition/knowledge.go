package cognition

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	cognitionknowledge "github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateKnowledgeBank registers a new runtime_knowledge_bank scope via
// the typed cognition KnowledgeScopeRegistry, after the authorizer
// confirms the caller may create on the proposed owner.
func (s *Service) CreateKnowledgeBank(ctx context.Context, req *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	owner, err := ownerFromPublicLocator(req.GetLocator())
	if err != nil {
		return nil, err
	}
	if err := s.authorize(ctx, KnowledgeActionCreateBank, req.GetContext(), owner); err != nil {
		return nil, err
	}
	desc := cognitionpkg.KnowledgeScopeDescriptor{
		Owner:       owner,
		DisplayName: strings.TrimSpace(req.GetDisplayName()),
		Metadata:    structToMap(req.GetMetadata()),
	}
	scope, err := s.cognitionCore.KnowledgeScopeRegistry().CreateKnowledgeScope(ctx, desc)
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeOwnerConflict) {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_BANK_ALREADY_EXISTS)
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "create knowledge bank: cognition storage error: " + err.Error(),
		})
	}
	return &runtimev1.CreateKnowledgeBankResponse{Bank: bankFromScope(scope)}, nil
}

// GetKnowledgeBank loads a registered scope and authorizes read.
func (s *Service) GetKnowledgeBank(ctx context.Context, req *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadBank)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetKnowledgeBankResponse{Bank: bankFromScope(scope)}, nil
}

// ListKnowledgeBanks enumerates scopes the caller can read. Banks the
// caller cannot read are silently dropped from the page (per-bank
// denial is silent on list, explicit on get).
func (s *Service) ListKnowledgeBanks(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	filter := s.buildScopeFilterFromList(req)
	scopes, nextToken, err := s.cognitionCore.KnowledgeScopeRegistry().ListKnowledgeScopes(ctx, filter)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	banks := make([]*runtimev1.KnowledgeBank, 0, len(scopes))
	for _, scope := range scopes {
		if err := s.authorize(ctx, KnowledgeActionReadBank, req.GetContext(), scope.Owner); err != nil {
			continue
		}
		banks = append(banks, bankFromScope(scope))
	}
	return &runtimev1.ListKnowledgeBanksResponse{Banks: banks, NextPageToken: nextToken}, nil
}

// DeleteKnowledgeBank deletes the scope and cascades all dependent
// rows in one transaction via SQLiteBackend.DeleteScope (wired into
// nimi-cognition KnowledgeScopeRegistry.DeleteKnowledgeScope).
func (s *Service) DeleteKnowledgeBank(ctx context.Context, req *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	if _, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionDeleteBank); err != nil {
		return nil, err
	}
	if err := s.cognitionCore.KnowledgeScopeRegistry().DeleteKnowledgeScope(ctx, strings.TrimSpace(req.GetBankId())); err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
		}
		return nil, grpcerr.WithReasonCodeOptions(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{
			ActionHint: "retry_after_cognition_storage_recovery",
			Message:    "delete knowledge bank: cascade error: " + err.Error(),
		})
	}
	return &runtimev1.DeleteKnowledgeBankResponse{Ack: okAck()}, nil
}

// PutPage upserts a knowledge page in the typed scope. Per-scope
// serialization makes the resolveKnowledgePage→Save sequence atomic
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
	if existing, err := s.resolveKnowledgePage(scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug()); err == nil && existing != nil {
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
	if err := s.cognitionCore.KnowledgeService().Save(cognitionPage); err != nil {
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
	page, err := s.resolveKnowledgePage(scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug())
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
	items, err := s.cognitionCore.KnowledgeService().List(scope.ScopeID)
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
	page, err := s.resolveKnowledgePage(scope.ScopeID, scope.ScopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	if err := s.deleteKnowledgeRelationsForPage(scope.ScopeID, page.GetPageId()); err != nil {
		return nil, err
	}
	if err := s.cognitionCore.KnowledgeService().Delete(scope.ScopeID, cognitionknowledge.PageID(page.GetPageId())); err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	return &runtimev1.DeletePageResponse{Ack: okAck()}, nil
}

// AddLink writes a same-scope page-to-page relation.
func (s *Service) AddLink(ctx context.Context, req *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionWriteLink)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	relation := cognitionknowledge.Relation{
		ScopeID:      scope.ScopeID,
		FromPageID:   cognitionknowledge.PageID(strings.TrimSpace(req.GetFromPageId())),
		ToPageID:     cognitionknowledge.PageID(strings.TrimSpace(req.GetToPageId())),
		RelationType: strings.TrimSpace(req.GetLinkType()),
		Strength:     artifactref.StrengthStrong,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.cognitionCore.KnowledgeService().PutRelation(relation); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID)
	}
	return &runtimev1.AddLinkResponse{Link: relationToRuntimeLink(scope.ScopeID, relation)}, nil
}

// RemoveLink deletes a relation by composite link id.
func (s *Service) RemoveLink(ctx context.Context, req *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionWriteLink)
	if err != nil {
		return nil, err
	}
	relations, err := s.listAllKnowledgeRelations(scope.ScopeID)
	if err != nil {
		return nil, err
	}
	linkID := strings.TrimSpace(req.GetLinkId())
	for _, relation := range relations {
		if linkIDForRelation(scope.ScopeID, relation) != linkID {
			continue
		}
		if err := s.cognitionCore.KnowledgeService().DeleteRelation(scope.ScopeID, relation.FromPageID, relation.ToPageID, relation.RelationType); err != nil {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
		}
		return &runtimev1.RemoveLinkResponse{Ack: okAck()}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_LINK_NOT_FOUND)
}

// ListLinks enumerates outgoing edges from one page.
func (s *Service) ListLinks(ctx context.Context, req *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadLink)
	if err != nil {
		return nil, err
	}
	rels, err := s.cognitionCore.KnowledgeService().ListRelations(scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetFromPageId())))
	if err != nil {
		return nil, err
	}
	edges, next, err := s.buildGraphEdges(scope.ScopeID, scope.ScopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLinksResponse{Links: edges, NextPageToken: next}, nil
}

// ListBacklinks enumerates incoming edges to one page.
func (s *Service) ListBacklinks(ctx context.Context, req *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadLink)
	if err != nil {
		return nil, err
	}
	rels, err := s.cognitionCore.KnowledgeService().ListBacklinks(scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetToPageId())))
	if err != nil {
		return nil, err
	}
	edges, next, err := s.buildGraphEdges(scope.ScopeID, scope.ScopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListBacklinksResponse{Backlinks: edges, NextPageToken: next}, nil
}

// TraverseGraph walks the same-bank graph from a root page.
func (s *Service) TraverseGraph(ctx context.Context, req *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionReadLink)
	if err != nil {
		return nil, err
	}
	depth := int(req.GetMaxDepth())
	if depth < 1 || depth > maxGraphTraversalDepth {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_GRAPH_DEPTH_INVALID)
	}
	hits, err := s.cognitionCore.KnowledgeService().Traverse(scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetRootPageId())), depth)
	if err != nil {
		return nil, err
	}
	nodes := make([]*runtimev1.KnowledgeGraphNode, 0, len(hits))
	for _, hit := range hits {
		page, err := s.cognitionCore.KnowledgeService().Load(scope.ScopeID, hit.PageID)
		if err != nil {
			return nil, err
		}
		runtimePage, err := cognitionPageToRuntime(scope.ScopeID, *page)
		if err != nil {
			return nil, err
		}
		if !matchesLinkTypes(hit.RelationType, req.GetLinkTypeFilters()) {
			continue
		}
		nodes = append(nodes, &runtimev1.KnowledgeGraphNode{
			BankId:     scope.ScopeID,
			PageId:     runtimePage.GetPageId(),
			Slug:       runtimePage.GetSlug(),
			Title:      runtimePage.GetTitle(),
			EntityType: runtimePage.GetEntityType(),
			Metadata:   cloneStruct(runtimePage.GetMetadata()),
			Depth:      int32(hit.Depth),
		})
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	start, end, next := pageWindow(len(nodes), offset, pageSize)
	return &runtimev1.TraverseGraphResponse{Nodes: nodes[start:end], NextPageToken: next}, nil
}

// IngestDocument enqueues an ingest task in the typed scope.
func (s *Service) IngestDocument(ctx context.Context, req *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	content := strings.TrimSpace(req.GetContent())
	if bankID == "" || slug == "" || content == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionIngest)
	if err != nil {
		return nil, err
	}
	pageID := strings.TrimSpace(req.GetPageId())
	if pageID == "" {
		pageID = newULID()
	}
	env := cognitionknowledge.IngestEnvelope{
		PageID: cognitionknowledge.PageID(pageID),
		Kind:   projectionKindForEntityType(req.GetEntityType()),
		Title:  defaultPageTitle(slug, req.GetTitle()),
		Body:   mustMarshalJSON(storedKnowledgeBody{Content: content}),
	}
	task, err := s.cognitionCore.KnowledgeService().IngestDocument(scope.ScopeID, env)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.rememberIngestTaskProjection(task.TaskID, scope.ScopeID, slug, defaultPageTitle(slug, req.GetTitle()))
	return &runtimev1.IngestDocumentResponse{
		TaskId:     task.TaskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) rememberIngestTaskProjection(taskID, bankID, slug, title string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ingestTasks[strings.TrimSpace(taskID)] = ingestTaskProjection{
		BankID: strings.TrimSpace(bankID),
		Slug:   strings.TrimSpace(slug),
		Title:  strings.TrimSpace(title),
	}
}

func (s *Service) ingestTaskProjectionFor(taskID string) (ingestTaskProjection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	projection, ok := s.ingestTasks[strings.TrimSpace(taskID)]
	return projection, ok
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

// GetIngestTask reads a task by id, scanning the caller's accessible
// scopes since proto envelope does not bind task to bank.
func (s *Service) GetIngestTask(ctx context.Context, req *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scopes, err := s.listAuthorizedScopes(ctx, req.GetContext())
	if err != nil {
		return nil, err
	}
	for _, scope := range scopes {
		task, err := s.cognitionCore.KnowledgeService().GetIngestTask(scope.ScopeID, taskID)
		if err != nil {
			continue
		}
		return &runtimev1.GetIngestTaskResponse{Task: s.projectIngestTask(scope.ScopeID, task)}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
}

// ============================================================
// Authorization helpers
// ============================================================

// authorize is the single seam every knowledge RPC uses to invoke the
// KnowledgeAuthorizer. It maps the typed result into a gRPC error.
func (s *Service) authorize(ctx context.Context, action KnowledgeAction, requestCtx *runtimev1.KnowledgeRequestContext, owner cognitionpkg.KnowledgeScopeOwner) error {
	res, err := s.authorizer.Authorize(ctx, KnowledgeAuthRequest{
		Action:  action,
		Context: requestCtx,
		Owner:   owner,
	})
	if err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	if res.Decision == KnowledgeAuthAllow {
		return nil
	}
	code := codes.PermissionDenied
	if res.Reason == runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		code = codes.InvalidArgument
	}
	return grpcerr.WithReasonCodeOptions(code, res.Reason, grpcerr.ReasonOptions{
		ActionHint: res.ActionHint,
		Message:    res.Message,
	})
}

// loadAuthorizedScope loads a scope by id and authorizes the action
// against its owner. Maps not-found to KNOWLEDGE_BANK_NOT_FOUND.
func (s *Service) loadAuthorizedScope(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext, bankID string, action KnowledgeAction) (cognitionpkg.KnowledgeScope, error) {
	scope, err := s.cognitionCore.KnowledgeScopeRegistry().GetKnowledgeScope(ctx, strings.TrimSpace(bankID))
	if err != nil {
		if errors.Is(err, cognitionpkg.ErrScopeNotFound) {
			return cognitionpkg.KnowledgeScope{}, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
		}
		return cognitionpkg.KnowledgeScope{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	if err := s.authorize(ctx, action, requestCtx, scope.Owner); err != nil {
		return cognitionpkg.KnowledgeScope{}, err
	}
	return scope, nil
}

// listAuthorizedScopes returns every scope the caller can read. Used
// by SearchKeyword (default empty bank list) and GetIngestTask.
func (s *Service) listAuthorizedScopes(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext) ([]cognitionpkg.KnowledgeScope, error) {
	filter := cognitionpkg.KnowledgeScopeFilter{
		OwnerKinds: []string{cognitionpkg.KnowledgeScopeOwnerKindAppPrivate},
		Owners: []cognitionpkg.KnowledgeScopeOwner{{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: trimContextAppID(requestCtx),
		}},
	}
	scopes, _, err := s.cognitionCore.KnowledgeScopeRegistry().ListKnowledgeScopes(ctx, filter)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE)
	}
	out := make([]cognitionpkg.KnowledgeScope, 0, len(scopes))
	for _, scope := range scopes {
		if err := s.authorize(ctx, KnowledgeActionReadBank, requestCtx, scope.Owner); err != nil {
			continue
		}
		out = append(out, scope)
	}
	return out, nil
}

// buildScopeFilterFromList narrows the registry list by request
// owner_filters / scope_filters; defaults to caller's app_private
// when neither is provided (per design D3 ListKnowledgeBanks).
func (s *Service) buildScopeFilterFromList(req *runtimev1.ListKnowledgeBanksRequest) cognitionpkg.KnowledgeScopeFilter {
	filter := cognitionpkg.KnowledgeScopeFilter{
		PageSize:  int(req.GetPageSize()),
		PageToken: req.GetPageToken(),
	}
	for _, scope := range req.GetScopeFilters() {
		switch scope {
		case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE:
			filter.OwnerKinds = append(filter.OwnerKinds, cognitionpkg.KnowledgeScopeOwnerKindAppPrivate)
		case runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE:
			filter.OwnerKinds = append(filter.OwnerKinds, cognitionpkg.KnowledgeScopeOwnerKindWorkspace)
		}
	}
	for _, owner := range req.GetOwnerFilters() {
		if app := owner.GetAppPrivate(); app != nil {
			filter.Owners = append(filter.Owners, cognitionpkg.KnowledgeScopeOwner{
				Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
				AppID: strings.TrimSpace(app.GetAppId()),
			})
		}
		if ws := owner.GetWorkspacePrivate(); ws != nil {
			filter.Owners = append(filter.Owners, cognitionpkg.KnowledgeScopeOwner{
				Kind:        cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
				WorkspaceID: strings.TrimSpace(ws.GetWorkspaceId()),
			})
		}
	}
	if len(filter.OwnerKinds) == 0 && len(filter.Owners) == 0 {
		filter.OwnerKinds = []string{cognitionpkg.KnowledgeScopeOwnerKindAppPrivate}
		filter.Owners = []cognitionpkg.KnowledgeScopeOwner{{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: trimContextAppID(req.GetContext()),
		}}
	}
	return filter
}

// ownerFromPublicLocator translates the proto PublicKnowledgeBankLocator
// into the typed KnowledgeScopeOwner used by the registry.
func ownerFromPublicLocator(locator *runtimev1.PublicKnowledgeBankLocator) (cognitionpkg.KnowledgeScopeOwner, error) {
	if locator == nil {
		return cognitionpkg.KnowledgeScopeOwner{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if app := locator.GetAppPrivate(); app != nil {
		return cognitionpkg.KnowledgeScopeOwner{
			Kind:  cognitionpkg.KnowledgeScopeOwnerKindAppPrivate,
			AppID: strings.TrimSpace(app.GetAppId()),
		}, nil
	}
	if ws := locator.GetWorkspacePrivate(); ws != nil {
		return cognitionpkg.KnowledgeScopeOwner{
			Kind:        cognitionpkg.KnowledgeScopeOwnerKindWorkspace,
			WorkspaceID: strings.TrimSpace(ws.GetWorkspaceId()),
		}, nil
	}
	return cognitionpkg.KnowledgeScopeOwner{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_BANK_SCOPE_INVALID)
}

// bankFromScope projects a typed KnowledgeScope into the runtime proto
// KnowledgeBank envelope. The scope_id is the bank_id.
func bankFromScope(scope cognitionpkg.KnowledgeScope) *runtimev1.KnowledgeBank {
	bank := &runtimev1.KnowledgeBank{
		BankId:      scope.ScopeID,
		Locator:     locatorFromOwner(scope.Owner),
		DisplayName: scope.DisplayName,
		Metadata:    mapToStruct(scope.Metadata),
		CreatedAt:   timestamppb.New(scope.CreatedAt),
		UpdatedAt:   timestamppb.New(scope.UpdatedAt),
	}
	return bank
}

func locatorFromOwner(owner cognitionpkg.KnowledgeScopeOwner) *runtimev1.KnowledgeBankLocator {
	switch owner.Kind {
	case cognitionpkg.KnowledgeScopeOwnerKindAppPrivate:
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: owner.AppID},
			},
		}
	case cognitionpkg.KnowledgeScopeOwnerKindWorkspace:
		return &runtimev1.KnowledgeBankLocator{
			Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_WORKSPACE_PRIVATE,
			Owner: &runtimev1.KnowledgeBankLocator_WorkspacePrivate{
				WorkspacePrivate: &runtimev1.KnowledgeWorkspacePrivateOwner{WorkspaceId: owner.WorkspaceID},
			},
		}
	}
	return nil
}

func structToMap(value *structpb.Struct) map[string]any {
	if value == nil {
		return nil
	}
	return value.AsMap()
}

func mapToStruct(value map[string]any) *structpb.Struct {
	if len(value) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(value)
	if err != nil {
		return nil
	}
	return out
}

// ============================================================
// Page / Relation / Ingest helpers (unchanged from prior wave; now
// consume scope.ScopeID rather than the legacy knowledgeScopeID).
// ============================================================

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

func (s *Service) resolveKnowledgePage(bankID string, scopeID string, pageID string, slug string) (*runtimev1.KnowledgePage, error) {
	pageID = strings.TrimSpace(pageID)
	slug = strings.TrimSpace(slug)
	if pageID != "" {
		page, err := s.cognitionCore.KnowledgeService().Load(scopeID, cognitionknowledge.PageID(pageID))
		if err != nil {
			return nil, nil
		}
		return cognitionPageToRuntime(bankID, *page)
	}
	items, err := s.cognitionCore.KnowledgeService().List(scopeID)
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

func relationToRuntimeLink(bankID string, rel cognitionknowledge.Relation) *runtimev1.KnowledgeLink {
	return &runtimev1.KnowledgeLink{
		LinkId:     linkIDForRelation(bankID, rel),
		BankId:     bankID,
		FromPageId: string(rel.FromPageID),
		ToPageId:   string(rel.ToPageID),
		LinkType:   rel.RelationType,
		CreatedAt:  timestamppb.New(rel.CreatedAt),
		UpdatedAt:  timestamppb.New(rel.UpdatedAt),
	}
}

func linkIDForRelation(bankID string, rel cognitionknowledge.Relation) string {
	return fmt.Sprintf("%s:%s:%s:%s", bankID, rel.FromPageID, rel.ToPageID, rel.RelationType)
}

func (s *Service) buildGraphEdges(bankID string, scopeID string, rels []cognitionknowledge.Relation, linkTypes []string, pageToken string, pageSizeRaw int32) ([]*runtimev1.KnowledgeGraphEdge, string, error) {
	edges := make([]*runtimev1.KnowledgeGraphEdge, 0, len(rels))
	for _, rel := range rels {
		if !matchesLinkTypes(rel.RelationType, linkTypes) {
			continue
		}
		fromPage, err := s.cognitionCore.KnowledgeService().Load(scopeID, rel.FromPageID)
		if err != nil {
			return nil, "", err
		}
		toPage, err := s.cognitionCore.KnowledgeService().Load(scopeID, rel.ToPageID)
		if err != nil {
			return nil, "", err
		}
		fromRuntime, err := cognitionPageToRuntime(bankID, *fromPage)
		if err != nil {
			return nil, "", err
		}
		toRuntime, err := cognitionPageToRuntime(bankID, *toPage)
		if err != nil {
			return nil, "", err
		}
		edges = append(edges, &runtimev1.KnowledgeGraphEdge{
			Link:           relationToRuntimeLink(bankID, rel),
			FromSlug:       fromRuntime.GetSlug(),
			FromTitle:      fromRuntime.GetTitle(),
			FromEntityType: fromRuntime.GetEntityType(),
			ToSlug:         toRuntime.GetSlug(),
			ToTitle:        toRuntime.GetTitle(),
			ToEntityType:   toRuntime.GetEntityType(),
		})
	}
	sort.Slice(edges, func(i, j int) bool {
		left := edges[i].GetLink().GetUpdatedAt().AsTime()
		right := edges[j].GetLink().GetUpdatedAt().AsTime()
		if left.Equal(right) {
			return edges[i].GetLink().GetLinkId() < edges[j].GetLink().GetLinkId()
		}
		return left.After(right)
	})
	offset, err := decodePageToken(pageToken)
	if err != nil {
		return nil, "", err
	}
	pageSize := clampPageSize(pageSizeRaw, defaultGraphPageSize, maxGraphPageSize)
	start, end, next := pageWindow(len(edges), offset, pageSize)
	return edges[start:end], next, nil
}

func matchesLinkTypes(linkType string, filters []string) bool {
	if len(filters) == 0 {
		return true
	}
	for _, filter := range filters {
		if strings.EqualFold(strings.TrimSpace(filter), strings.TrimSpace(linkType)) {
			return true
		}
	}
	return false
}

func (s *Service) listAllKnowledgeRelations(scopeID string) ([]cognitionknowledge.Relation, error) {
	pages, err := s.cognitionCore.KnowledgeService().List(scopeID)
	if err != nil {
		return nil, err
	}
	relations := make([]cognitionknowledge.Relation, 0)
	seen := map[string]struct{}{}
	for _, page := range pages {
		items, err := s.cognitionCore.KnowledgeService().ListRelations(scopeID, page.PageID)
		if err != nil {
			continue
		}
		for _, item := range items {
			key := string(item.FromPageID) + ":" + string(item.ToPageID) + ":" + item.RelationType
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			relations = append(relations, item)
		}
	}
	return relations, nil
}

func (s *Service) deleteKnowledgeRelationsForPage(scopeID string, pageID string) error {
	rels, err := s.listAllKnowledgeRelations(scopeID)
	if err != nil {
		return err
	}
	for _, rel := range rels {
		if string(rel.FromPageID) != pageID && string(rel.ToPageID) != pageID {
			continue
		}
		if err := s.cognitionCore.KnowledgeService().DeleteRelation(scopeID, rel.FromPageID, rel.ToPageID, rel.RelationType); err != nil {
			return err
		}
	}
	return nil
}

func cognitionTaskToRuntime(bankID string, task *cognitionknowledge.IngestTask) *runtimev1.KnowledgeIngestTask {
	if task == nil {
		return nil
	}
	status := runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_UNSPECIFIED
	switch task.Status {
	case cognitionknowledge.IngestTaskStatusQueued:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_QUEUED
	case cognitionknowledge.IngestTaskStatusRunning:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_RUNNING
	case cognitionknowledge.IngestTaskStatusCompleted:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED
	case cognitionknowledge.IngestTaskStatusFailed:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_FAILED
	}
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if task.Status == cognitionknowledge.IngestTaskStatusFailed {
		reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	return &runtimev1.KnowledgeIngestTask{
		TaskId:          task.TaskID,
		BankId:          bankID,
		PageId:          string(task.PageID),
		Status:          status,
		ProgressPercent: int32(task.ProgressPercent),
		ReasonCode:      reason,
		ActionHint:      strings.TrimSpace(task.Error),
		CreatedAt:       timestamppb.New(task.CreatedAt),
		UpdatedAt:       timestamppb.New(task.UpdatedAt),
	}
}

func (s *Service) projectIngestTask(bankID string, task *cognitionknowledge.IngestTask) *runtimev1.KnowledgeIngestTask {
	runtimeTask := cognitionTaskToRuntime(bankID, task)
	if runtimeTask == nil {
		return nil
	}
	if projection, ok := s.ingestTaskProjectionFor(runtimeTask.GetTaskId()); ok {
		if runtimeTask.GetBankId() == "" {
			runtimeTask.BankId = projection.BankID
		}
		if runtimeTask.GetSlug() == "" {
			runtimeTask.Slug = projection.Slug
		}
		if runtimeTask.GetTitle() == "" {
			runtimeTask.Title = projection.Title
		}
	}
	if runtimeTask.GetPageId() != "" && (runtimeTask.GetSlug() == "" || runtimeTask.GetTitle() == "") {
		page, err := s.resolveKnowledgePage(bankID, bankID, runtimeTask.GetPageId(), "")
		if err == nil && page != nil {
			if runtimeTask.GetSlug() == "" {
				runtimeTask.Slug = page.GetSlug()
			}
			if runtimeTask.GetTitle() == "" {
				runtimeTask.Title = page.GetTitle()
			}
		}
	}
	return runtimeTask
}
