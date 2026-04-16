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

func (s *Service) AddLink(_ context.Context, req *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	fromPageID := strings.TrimSpace(req.GetFromPageId())
	toPageID := strings.TrimSpace(req.GetToPageId())
	linkType := strings.TrimSpace(req.GetLinkType())
	if bankID == "" || fromPageID == "" || toPageID == "" || linkType == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if fromPageID == toPageID {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_LINK_INVALID)
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
	if state.PagesByID[fromPageID] == nil || state.PagesByID[toPageID] == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_PAGE_NOT_FOUND)
	}
	if findDuplicateLink(state, fromPageID, toPageID, linkType) != nil {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_LINK_ALREADY_EXISTS)
	}

	previous := cloneBankState(state)
	now := time.Now().UTC()
	link := &runtimev1.KnowledgeLink{
		LinkId:     ulid.Make().String(),
		BankId:     bankID,
		FromPageId: fromPageID,
		ToPageId:   toPageID,
		LinkType:   linkType,
		Metadata:   cloneStruct(req.GetMetadata()),
		CreatedAt:  timestamppb.New(now),
		UpdatedAt:  timestamppb.New(now),
	}
	state.LinksByID[link.GetLinkId()] = link
	state.Bank.UpdatedAt = timestamppb.New(now)
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.AddLinkResponse{Link: cloneKnowledgeLink(link)}, nil
}

func (s *Service) RemoveLink(_ context.Context, req *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	linkID := strings.TrimSpace(req.GetLinkId())
	if bankID == "" || linkID == "" {
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
	if state.LinksByID[linkID] == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_LINK_NOT_FOUND)
	}

	previous := cloneBankState(state)
	delete(state.LinksByID, linkID)
	state.Bank.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.banksByID[bankID] = previous
		return nil, err
	}
	return &runtimev1.RemoveLinkResponse{
		Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
	}, nil
}

func (s *Service) ListLinks(_ context.Context, req *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, _, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetFromPageId(), "")
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	items := make([]*runtimev1.KnowledgeGraphEdge, 0, len(state.LinksByID))
	for _, link := range state.LinksByID {
		if link == nil || link.GetFromPageId() != strings.TrimSpace(req.GetFromPageId()) {
			continue
		}
		if !matchesLinkTypeFilters(link, req.GetLinkTypeFilters()) {
			continue
		}
		items = append(items, buildGraphEdge(state, link))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetLink().GetUpdatedAt())
		right := timestampValue(items[j].GetLink().GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetLink().GetLinkId() < items[j].GetLink().GetLinkId()
		}
		return left.After(right)
	})
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListLinksResponse{Links: items[start:end], NextPageToken: next}, nil
}

func (s *Service) ListBacklinks(_ context.Context, req *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, _, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetToPageId(), "")
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	items := make([]*runtimev1.KnowledgeGraphEdge, 0, len(state.LinksByID))
	for _, link := range state.LinksByID {
		if link == nil || link.GetToPageId() != strings.TrimSpace(req.GetToPageId()) {
			continue
		}
		if !matchesLinkTypeFilters(link, req.GetLinkTypeFilters()) {
			continue
		}
		items = append(items, buildGraphEdge(state, link))
	}
	s.mu.RUnlock()
	sort.Slice(items, func(i, j int) bool {
		left := timestampValue(items[i].GetLink().GetUpdatedAt())
		right := timestampValue(items[j].GetLink().GetUpdatedAt())
		if left.Equal(right) {
			return items[i].GetLink().GetLinkId() < items[j].GetLink().GetLinkId()
		}
		return left.After(right)
	})
	start, end, next := sliceBounds(len(items), offset, pageSize)
	return &runtimev1.ListBacklinksResponse{Backlinks: items[start:end], NextPageToken: next}, nil
}

func (s *Service) TraverseGraph(_ context.Context, req *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	offset, err := decodePageToken(req.GetPageToken())
	if err != nil {
		return nil, err
	}
	maxDepth := int(req.GetMaxDepth())
	if maxDepth == 0 {
		maxDepth = defaultGraphTraversalDepth
	}
	if maxDepth < 1 || maxDepth > maxGraphTraversalDepth {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_KNOWLEDGE_GRAPH_DEPTH_INVALID)
	}
	pageSize := clampPageSize(req.GetPageSize(), defaultGraphPageSize, maxGraphPageSize)
	state, root, err := s.lookupPage(req.GetContext(), req.GetBankId(), req.GetRootPageId(), "")
	if err != nil {
		return nil, err
	}

	type traversalStep struct {
		pageID string
		depth  int
	}

	s.mu.RLock()
	visited := map[string]struct{}{root.GetPageId(): {}}
	queue := []traversalStep{{pageID: root.GetPageId(), depth: 0}}
	nodes := make([]*runtimev1.KnowledgeGraphNode, 0, len(state.PagesByID))
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		page := state.PagesByID[current.pageID]
		if page == nil {
			continue
		}
		nodes = append(nodes, &runtimev1.KnowledgeGraphNode{
			BankId:     page.GetBankId(),
			PageId:     page.GetPageId(),
			Slug:       page.GetSlug(),
			Title:      page.GetTitle(),
			EntityType: page.GetEntityType(),
			Metadata:   cloneStruct(page.GetMetadata()),
			Depth:      int32(current.depth),
		})
		if current.depth >= maxDepth {
			continue
		}
		neighbors := outgoingLinksForPage(state, current.pageID, req.GetLinkTypeFilters())
		sort.Slice(neighbors, func(i, j int) bool {
			if neighbors[i].GetToPageId() == neighbors[j].GetToPageId() {
				return neighbors[i].GetLinkId() < neighbors[j].GetLinkId()
			}
			return neighbors[i].GetToPageId() < neighbors[j].GetToPageId()
		})
		for _, link := range neighbors {
			nextPageID := link.GetToPageId()
			if _, seen := visited[nextPageID]; seen {
				continue
			}
			visited[nextPageID] = struct{}{}
			queue = append(queue, traversalStep{pageID: nextPageID, depth: current.depth + 1})
		}
	}
	s.mu.RUnlock()

	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].GetDepth() == nodes[j].GetDepth() {
			return nodes[i].GetPageId() < nodes[j].GetPageId()
		}
		return nodes[i].GetDepth() < nodes[j].GetDepth()
	})
	start, end, next := sliceBounds(len(nodes), offset, pageSize)
	return &runtimev1.TraverseGraphResponse{Nodes: nodes[start:end], NextPageToken: next}, nil
}
