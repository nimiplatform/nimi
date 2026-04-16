package cognition

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	cognitionknowledge "github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) CreateKnowledgeBank(ctx context.Context, req *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	return s.knowledgeSvc.CreateKnowledgeBank(ctx, req)
}

func (s *Service) GetKnowledgeBank(ctx context.Context, req *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	return s.knowledgeSvc.GetKnowledgeBank(ctx, req)
}

func (s *Service) ListKnowledgeBanks(ctx context.Context, req *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	return s.knowledgeSvc.ListKnowledgeBanks(ctx, req)
}

func (s *Service) DeleteKnowledgeBank(ctx context.Context, req *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	resp, err := s.knowledgeSvc.DeleteKnowledgeBank(ctx, req)
	if err != nil {
		return nil, err
	}
	if err := s.cognitionCore.DeleteScope(knowledgeScopeID(strings.TrimSpace(req.GetBankId()))); err != nil && s.logger != nil {
		s.logger.Warn("runtime cognition knowledge scope cleanup failed", "bank_id", strings.TrimSpace(req.GetBankId()), "error", err)
	}
	return resp, nil
}

func (s *Service) PutPage(ctx context.Context, req *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	now := time.Now().UTC()
	page, cognitionPage, err := runtimePageToCognition(scopeID, req, now)
	if err != nil {
		return nil, err
	}
	if existing, err := s.resolveKnowledgePage(bank.GetBankId(), scopeID, req.GetPageId(), req.GetSlug()); err == nil && existing != nil {
		page.PageId = existing.GetPageId()
		cognitionPage.PageID = cognitionknowledge.PageID(existing.GetPageId())
	}
	if err := s.cognitionCore.KnowledgeService().Save(cognitionPage); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "already exists") {
			return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
		}
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return &runtimev1.PutPageResponse{Page: page}, nil
}

func (s *Service) GetPage(ctx context.Context, req *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	page, err := s.resolveKnowledgePage(bank.GetBankId(), knowledgeScopeID(bank.GetBankId()), req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	return &runtimev1.GetPageResponse{Page: page}, nil
}

func (s *Service) ListPages(ctx context.Context, req *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	items, err := s.cognitionCore.KnowledgeService().List(scopeID)
	if err != nil {
		return nil, err
	}
	pages := make([]*runtimev1.KnowledgePage, 0, len(items))
	for _, item := range items {
		page, err := cognitionPageToRuntime(bank.GetBankId(), item)
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

func (s *Service) DeletePage(ctx context.Context, req *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	page, err := s.resolveKnowledgePage(bank.GetBankId(), scopeID, req.GetPageId(), req.GetSlug())
	if err != nil {
		return nil, err
	}
	if page == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	if err := s.deleteKnowledgeRelationsForPage(scopeID, page.GetPageId()); err != nil {
		return nil, err
	}
	if err := s.cognitionCore.KnowledgeService().Delete(scopeID, cognitionknowledge.PageID(page.GetPageId())); err != nil {
		return nil, err
	}
	return &runtimev1.DeletePageResponse{Ack: okAck()}, nil
}

func (s *Service) AddLink(ctx context.Context, req *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	now := time.Now().UTC()
	relation := cognitionknowledge.Relation{
		ScopeID:      scopeID,
		FromPageID:   cognitionknowledge.PageID(strings.TrimSpace(req.GetFromPageId())),
		ToPageID:     cognitionknowledge.PageID(strings.TrimSpace(req.GetToPageId())),
		RelationType: strings.TrimSpace(req.GetLinkType()),
		Strength:     "strong",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.cognitionCore.KnowledgeService().PutRelation(relation); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return &runtimev1.AddLinkResponse{Link: relationToRuntimeLink(bank.GetBankId(), relation)}, nil
}

func (s *Service) RemoveLink(ctx context.Context, req *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	relations, err := s.listAllKnowledgeRelations(scopeID)
	if err != nil {
		return nil, err
	}
	linkID := strings.TrimSpace(req.GetLinkId())
	for _, relation := range relations {
		if linkIDForRelation(bank.GetBankId(), relation) != linkID {
			continue
		}
		if err := s.cognitionCore.KnowledgeService().DeleteRelation(scopeID, relation.FromPageID, relation.ToPageID, relation.RelationType); err != nil {
			return nil, err
		}
		return &runtimev1.RemoveLinkResponse{Ack: okAck()}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_LINK_NOT_FOUND)
}

func (s *Service) ListLinks(ctx context.Context, req *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	rels, err := s.cognitionCore.KnowledgeService().ListRelations(scopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetFromPageId())))
	if err != nil {
		return nil, err
	}
	edges, next, err := s.buildGraphEdges(bank.GetBankId(), scopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListLinksResponse{Links: edges, NextPageToken: next}, nil
}

func (s *Service) ListBacklinks(ctx context.Context, req *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	rels, err := s.cognitionCore.KnowledgeService().ListBacklinks(scopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetToPageId())))
	if err != nil {
		return nil, err
	}
	edges, next, err := s.buildGraphEdges(bank.GetBankId(), scopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListBacklinksResponse{Backlinks: edges, NextPageToken: next}, nil
}

func (s *Service) TraverseGraph(ctx context.Context, req *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	depth := int(req.GetMaxDepth())
	if depth <= 0 {
		depth = defaultGraphTraversalDepth
	}
	if depth > maxGraphTraversalDepth {
		depth = maxGraphTraversalDepth
	}
	hits, err := s.cognitionCore.KnowledgeService().Traverse(scopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetRootPageId())), depth)
	if err != nil {
		return nil, err
	}
	nodes := make([]*runtimev1.KnowledgeGraphNode, 0, len(hits))
	for _, hit := range hits {
		page, err := s.cognitionCore.KnowledgeService().Load(scopeID, hit.PageID)
		if err != nil {
			return nil, err
		}
		runtimePage, err := cognitionPageToRuntime(bank.GetBankId(), *page)
		if err != nil {
			return nil, err
		}
		if !matchesLinkTypes(hit.RelationType, req.GetLinkTypeFilters()) {
			continue
		}
		nodes = append(nodes, &runtimev1.KnowledgeGraphNode{
			BankId:     bank.GetBankId(),
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
	bank, err := s.authorizedKnowledgeBank(ctx, req.GetContext(), req.GetBankId())
	if err != nil {
		return nil, err
	}
	scopeID := knowledgeScopeID(bank.GetBankId())
	pageID := strings.TrimSpace(req.GetPageId())
	if pageID == "" {
		pageID = ulid.Make().String()
	}
	env := cognitionknowledge.IngestEnvelope{
		PageID: cognitionknowledge.PageID(pageID),
		Kind:   projectionKindForEntityType(req.GetEntityType()),
		Title:  defaultPageTitle(strings.TrimSpace(req.GetSlug()), req.GetTitle()),
		Body:   mustMarshalJSON(storedKnowledgeBody{Content: strings.TrimSpace(req.GetContent())}),
	}
	task, err := s.cognitionCore.KnowledgeService().IngestDocument(scopeID, env)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.rememberIngestTaskProjection(task.TaskID, bank.GetBankId(), slug, defaultPageTitle(slug, req.GetTitle()))
	return &runtimev1.IngestDocumentResponse{
		TaskId:     task.TaskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetIngestTask(ctx context.Context, req *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	banks, err := s.resolveSearchBanks(ctx, req.GetContext(), nil)
	if err != nil {
		return nil, err
	}
	for _, bank := range banks {
		scopeID := knowledgeScopeID(bank.GetBankId())
		task, err := s.cognitionCore.KnowledgeService().GetIngestTask(scopeID, taskID)
		if err != nil {
			continue
		}
		return &runtimev1.GetIngestTaskResponse{Task: s.projectIngestTask(bank.GetBankId(), task)}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
}

func (s *Service) authorizedKnowledgeBank(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext, bankID string) (*runtimev1.KnowledgeBank, error) {
	resp, err := s.knowledgeSvc.GetKnowledgeBank(ctx, &runtimev1.GetKnowledgeBankRequest{
		Context: requestCtx,
		BankId:  strings.TrimSpace(bankID),
	})
	if err != nil {
		return nil, err
	}
	return resp.GetBank(), nil
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

func (s *Service) resolveSearchBanks(ctx context.Context, requestCtx *runtimev1.KnowledgeRequestContext, bankIDs []string) ([]*runtimev1.KnowledgeBank, error) {
	normalized := make([]string, 0, len(bankIDs))
	seen := map[string]struct{}{}
	for _, bankID := range bankIDs {
		bankID = strings.TrimSpace(bankID)
		if bankID == "" {
			continue
		}
		if _, ok := seen[bankID]; ok {
			continue
		}
		seen[bankID] = struct{}{}
		normalized = append(normalized, bankID)
	}
	if len(normalized) == 0 {
		resp, err := s.knowledgeSvc.ListKnowledgeBanks(ctx, &runtimev1.ListKnowledgeBanksRequest{Context: requestCtx})
		if err != nil {
			return nil, err
		}
		return resp.GetBanks(), nil
	}
	banks := make([]*runtimev1.KnowledgeBank, 0, len(normalized))
	for _, bankID := range normalized {
		bank, err := s.authorizedKnowledgeBank(ctx, requestCtx, bankID)
		if err != nil {
			return nil, err
		}
		banks = append(banks, bank)
	}
	return banks, nil
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

func (s *Service) projectIngestTask(bankID string, task *cognitionknowledge.IngestTask) *runtimev1.KnowledgeIngestTask {
	runtimeTask := cognitionTaskToRuntime(bankID, task)
	if runtimeTask == nil {
		return nil
	}
	if projection, ok := s.ingestTaskProjectionFor(runtimeTask.GetTaskId()); ok {
		if runtimeTask.GetBankId() == "" {
			runtimeTask.BankId = projection.BankID
		}
		runtimeTask.Slug = projection.Slug
		runtimeTask.Title = projection.Title
	}
	if runtimeTask.GetPageId() != "" && (runtimeTask.GetSlug() == "" || runtimeTask.GetTitle() == "") {
		page, err := s.resolveKnowledgePage(bankID, knowledgeScopeID(bankID), runtimeTask.GetPageId(), "")
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
