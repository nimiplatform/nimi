package cognition

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/artifactref"
	cognitionpkg "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	cognitionknowledge "github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AddLink writes a same-scope page-to-page relation.
func (s *Service) AddLink(ctx context.Context, req *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionWriteLink)
	if err != nil {
		return nil, err
	}
	access, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionWriteLink, cognitionpkg.RuntimeBridgeOperationPutKnowledgeRelation, req.GetContext(), scope)
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
	if err := s.cognitionCore.RuntimeBridge().PutKnowledgeRelation(ctx, access, relation); err != nil {
		return nil, cognitionBridgeError(
			err,
			codes.InvalidArgument,
			runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID,
			grpcerr.ReasonOptions{Message: "knowledge link is invalid"},
		)
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
	listPagesAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionWriteLink, cognitionpkg.RuntimeBridgeOperationListKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	listRelationsAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionWriteLink, cognitionpkg.RuntimeBridgeOperationListKnowledgeRelations, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	deleteAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionWriteLink, cognitionpkg.RuntimeBridgeOperationDeleteKnowledgeRelation, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	relations, err := s.listAllKnowledgeRelations(ctx, listPagesAccess, listRelationsAccess, scope.ScopeID)
	if err != nil {
		return nil, err
	}
	linkID := strings.TrimSpace(req.GetLinkId())
	for _, relation := range relations {
		if linkIDForRelation(scope.ScopeID, relation) != linkID {
			continue
		}
		if err := s.cognitionCore.RuntimeBridge().DeleteKnowledgeRelation(ctx, deleteAccess, scope.ScopeID, relation.FromPageID, relation.ToPageID, relation.RelationType); err != nil {
			return nil, cognitionBridgeError(
				err,
				codes.Internal,
				runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE,
				grpcerr.ReasonOptions{Message: "knowledge link deletion failed"},
			)
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
	listAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationListKnowledgeRelations, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	loadAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	rels, err := s.cognitionCore.RuntimeBridge().ListKnowledgeRelations(ctx, listAccess, scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetFromPageId())))
	if err != nil {
		return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge link listing failed"})
	}
	edges, next, err := s.buildGraphEdges(ctx, loadAccess, scope.ScopeID, scope.ScopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
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
	backlinksAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationListKnowledgeBacklinks, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	loadAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	rels, err := s.cognitionCore.RuntimeBridge().ListKnowledgeBacklinks(ctx, backlinksAccess, scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetToPageId())))
	if err != nil {
		return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge backlink listing failed"})
	}
	edges, next, err := s.buildGraphEdges(ctx, loadAccess, scope.ScopeID, scope.ScopeID, rels, req.GetLinkTypeFilters(), req.GetPageToken(), req.GetPageSize())
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
	traverseAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationTraverseKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	loadAccess, err := s.authorizeRuntimeBridgeOperation(ctx, KnowledgeActionReadLink, cognitionpkg.RuntimeBridgeOperationLoadKnowledge, req.GetContext(), scope)
	if err != nil {
		return nil, err
	}
	hits, err := s.cognitionCore.RuntimeBridge().TraverseKnowledge(ctx, traverseAccess, scope.ScopeID, cognitionknowledge.PageID(strings.TrimSpace(req.GetRootPageId())), depth)
	if err != nil {
		return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge graph traversal failed"})
	}
	nodes := make([]*runtimev1.KnowledgeGraphNode, 0, len(hits))
	for _, hit := range hits {
		page, err := s.cognitionCore.RuntimeBridge().LoadKnowledge(ctx, loadAccess, scope.ScopeID, hit.PageID)
		if err != nil {
			return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge graph page lookup failed"})
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

func (s *Service) buildGraphEdges(ctx context.Context, loadAccess cognitionpkg.RuntimeAuthorization, bankID string, scopeID string, rels []cognitionknowledge.Relation, linkTypes []string, pageToken string, pageSizeRaw int32) ([]*runtimev1.KnowledgeGraphEdge, string, error) {
	edges := make([]*runtimev1.KnowledgeGraphEdge, 0, len(rels))
	for _, rel := range rels {
		if !matchesLinkTypes(rel.RelationType, linkTypes) {
			continue
		}
		fromPage, err := s.cognitionCore.RuntimeBridge().LoadKnowledge(ctx, loadAccess, scopeID, rel.FromPageID)
		if err != nil {
			return nil, "", cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge link source lookup failed"})
		}
		toPage, err := s.cognitionCore.RuntimeBridge().LoadKnowledge(ctx, loadAccess, scopeID, rel.ToPageID)
		if err != nil {
			return nil, "", cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge link target lookup failed"})
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

func (s *Service) listAllKnowledgeRelations(ctx context.Context, listPagesAccess cognitionpkg.RuntimeAuthorization, listRelationsAccess cognitionpkg.RuntimeAuthorization, scopeID string) ([]cognitionknowledge.Relation, error) {
	pages, err := s.cognitionCore.RuntimeBridge().ListKnowledge(ctx, listPagesAccess, scopeID)
	if err != nil {
		return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge page listing failed"})
	}
	relations := make([]cognitionknowledge.Relation, 0)
	seen := map[string]struct{}{}
	for _, page := range pages {
		items, err := s.cognitionCore.RuntimeBridge().ListKnowledgeRelations(ctx, listRelationsAccess, scopeID, page.PageID)
		if err != nil {
			return nil, cognitionBridgeError(err, codes.Internal, runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE, grpcerr.ReasonOptions{Message: "knowledge relation listing failed"})
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
