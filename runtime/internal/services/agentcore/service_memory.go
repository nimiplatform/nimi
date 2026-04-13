package agentcore

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) QueryAgentMemory(ctx context.Context, req *runtimev1.QueryAgentMemoryRequest) (*runtimev1.QueryAgentMemoryResponse, error) {
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	if requiresExplicitWorldSharedAdmission(req.GetCanonicalClasses()) && validateWorldSharedAgentState(entry) != nil {
		return nil, worldSharedAdmissionError()
	}
	queries := s.queryLocatorsForAgent(entry, req.GetCanonicalClasses())
	views := make([]*runtimev1.CanonicalMemoryView, 0)
	limit := req.GetLimit()
	if limit <= 0 {
		limit = 10
	}
	queryText := strings.TrimSpace(req.GetQuery())
	for _, locator := range queries {
		if _, err := s.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: locator}); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			return nil, err
		}
		if queryText == "" {
			historyResp, err := s.memorySvc.History(ctx, &runtimev1.HistoryRequest{
				Bank: locator,
				Query: &runtimev1.MemoryHistoryQuery{
					Kinds:              append([]runtimev1.MemoryRecordKind(nil), req.GetKinds()...),
					PageSize:           limit,
					IncludeInvalidated: req.GetIncludeInvalidated(),
				},
			})
			if err != nil {
				return nil, err
			}
			for _, record := range historyResp.GetRecords() {
				if record == nil {
					continue
				}
				views = append(views, &runtimev1.CanonicalMemoryView{
					CanonicalClass: record.GetCanonicalClass(),
					SourceBank:     cloneLocator(record.GetBank()),
					Record:         cloneMemoryRecord(record),
					RecallScore:    0,
					PolicyReason:   "query_agent_memory_history",
				})
			}
			continue
		}
		resp, err := s.memorySvc.Recall(ctx, &runtimev1.RecallRequest{
			Bank: locator,
			Query: &runtimev1.MemoryRecallQuery{
				Query:              queryText,
				Kinds:              append([]runtimev1.MemoryRecordKind(nil), req.GetKinds()...),
				Limit:              limit,
				CanonicalClasses:   append([]runtimev1.MemoryCanonicalClass(nil), req.GetCanonicalClasses()...),
				IncludeInvalidated: req.GetIncludeInvalidated(),
			},
		})
		if err != nil {
			return nil, err
		}
		for _, hit := range resp.GetHits() {
			if hit.GetRecord() == nil {
				continue
			}
			views = append(views, &runtimev1.CanonicalMemoryView{
				CanonicalClass: hit.GetRecord().GetCanonicalClass(),
				SourceBank:     cloneLocator(hit.GetRecord().GetBank()),
				Record:         cloneMemoryRecord(hit.GetRecord()),
				RecallScore:    hit.GetRelevanceScore(),
				PolicyReason:   "query_agent_memory",
			})
		}
	}
	sort.Slice(views, func(i, j int) bool {
		if views[i].GetRecallScore() == views[j].GetRecallScore() {
			leftUpdated := views[i].GetRecord().GetUpdatedAt().AsTime()
			rightUpdated := views[j].GetRecord().GetUpdatedAt().AsTime()
			if !leftUpdated.Equal(rightUpdated) {
				return leftUpdated.After(rightUpdated)
			}
			return views[i].GetRecord().GetMemoryId() < views[j].GetRecord().GetMemoryId()
		}
		return views[i].GetRecallScore() > views[j].GetRecallScore()
	})
	if int(limit) < len(views) {
		views = views[:limit]
	}
	return &runtimev1.QueryAgentMemoryResponse{Memories: views}, nil
}

func (s *Service) WriteAgentMemory(ctx context.Context, req *runtimev1.WriteAgentMemoryRequest) (*runtimev1.WriteAgentMemoryResponse, error) {
	if len(req.GetCandidates()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry, err := s.agentByID(strings.TrimSpace(req.GetAgentId()))
	if err != nil {
		return nil, err
	}
	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(req.GetCandidates()))
	rejected := make([]*runtimev1.CanonicalMemoryRejection, 0)
	for _, candidate := range req.GetCandidates() {
		if rejection := validateWorldSharedCandidateAdmission(entry, candidate); rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		view, rejection := s.writeCandidate(ctx, entry, candidate)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	if len(accepted) > 0 || len(rejected) > 0 {
		events := []*runtimev1.AgentEvent{s.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
				Rejected: cloneCanonicalMemoryRejections(rejected),
			},
		})}
		if err := s.updateAgent(entry, events...); err != nil {
			return nil, err
		}
	}
	return &runtimev1.WriteAgentMemoryResponse{Accepted: accepted, Rejected: rejected}, nil
}

func (s *Service) writeCandidate(ctx context.Context, entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) (*runtimev1.CanonicalMemoryView, *runtimev1.CanonicalMemoryRejection) {
	if candidate == nil || candidate.GetRecord() == nil || candidate.GetTargetBank() == nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "candidate target_bank and record are required")
	}
	if err := validateCandidateLocator(entry.Agent.GetAgentId(), candidate); err != nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err.Error())
	}
	if _, err := s.memorySvc.EnsureCanonicalBank(ctx, cloneLocator(candidate.GetTargetBank()), canonicalBankDisplayName(candidate.GetTargetBank()), nil); err != nil {
		return nil, rejection(candidate, reasonCodeFromError(err), err.Error())
	}
	input := cloneMemoryRecordInput(candidate.GetRecord())
	input.CanonicalClass = candidate.GetCanonicalClass()
	resp, err := s.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
		Bank:    cloneLocator(candidate.GetTargetBank()),
		Records: []*runtimev1.MemoryRecordInput{input},
	})
	if err != nil {
		return nil, rejection(candidate, reasonCodeFromError(err), err.Error())
	}
	if len(resp.GetRecords()) == 0 {
		return nil, rejection(candidate, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "memory retain returned no records")
	}
	record := resp.GetRecords()[0]
	return &runtimev1.CanonicalMemoryView{
		CanonicalClass: candidate.GetCanonicalClass(),
		SourceBank:     cloneLocator(record.GetBank()),
		Record:         cloneMemoryRecord(record),
		RecallScore:    1,
		PolicyReason:   firstNonEmpty(strings.TrimSpace(candidate.GetPolicyReason()), "write_agent_memory"),
	}, nil
}

func validateCandidateLocator(agentID string, candidate *runtimev1.CanonicalMemoryCandidate) error {
	locator := candidate.GetTargetBank()
	switch candidate.GetCanonicalClass() {
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE || locator.GetAgentCore() == nil {
			return fmt.Errorf("public_shared candidate must target agent_core bank")
		}
		if strings.TrimSpace(locator.GetAgentCore().GetAgentId()) != strings.TrimSpace(agentID) {
			return fmt.Errorf("agent_core bank must match agent_id")
		}
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC || locator.GetAgentDyadic() == nil {
			return fmt.Errorf("dyadic candidate must target agent_dyadic bank")
		}
		if strings.TrimSpace(locator.GetAgentDyadic().GetAgentId()) != strings.TrimSpace(agentID) || strings.TrimSpace(locator.GetAgentDyadic().GetUserId()) == "" {
			return fmt.Errorf("agent_dyadic bank must match agent_id and user_id")
		}
	case runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED:
		if locator.GetScope() != runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED || locator.GetWorldShared() == nil {
			return fmt.Errorf("world_shared candidate must target world_shared bank")
		}
		if strings.TrimSpace(locator.GetWorldShared().GetWorldId()) == "" {
			return fmt.Errorf("world_shared bank requires world_id")
		}
	default:
		return fmt.Errorf("canonical memory candidate requires admitted canonical class")
	}
	return nil
}

func (s *Service) queryLocatorsForAgent(entry *agentEntry, classes []runtimev1.MemoryCanonicalClass) []*runtimev1.MemoryBankLocator {
	includeAll := len(classes) == 0
	include := func(class runtimev1.MemoryCanonicalClass) bool {
		if includeAll {
			return true
		}
		for _, item := range classes {
			if item == class {
				return true
			}
		}
		return false
	}
	locators := []*runtimev1.MemoryBankLocator{}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED) {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
			Owner: &runtimev1.MemoryBankLocator_AgentCore{
				AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: entry.Agent.GetAgentId()},
			},
		})
	}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC) && strings.TrimSpace(entry.State.GetActiveUserId()) != "" {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC,
			Owner: &runtimev1.MemoryBankLocator_AgentDyadic{
				AgentDyadic: &runtimev1.AgentDyadicBankOwner{
					AgentId: entry.Agent.GetAgentId(),
					UserId:  entry.State.GetActiveUserId(),
				},
			},
		})
	}
	if include(runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED) && strings.TrimSpace(entry.State.GetActiveWorldId()) != "" {
		locators = append(locators, &runtimev1.MemoryBankLocator{
			Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED,
			Owner: &runtimev1.MemoryBankLocator_WorldShared{
				WorldShared: &runtimev1.WorldSharedBankOwner{
					WorldId: entry.State.GetActiveWorldId(),
				},
			},
		})
	}
	return locators
}

func canonicalBankDisplayName(locator *runtimev1.MemoryBankLocator) string {
	if locator == nil {
		return "Agent Memory"
	}
	switch locator.GetScope() {
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE:
		return "Agent Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_DYADIC:
		return "Agent Dyadic Memory"
	case runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_WORLD_SHARED:
		return "World Shared Memory"
	default:
		return "Memory Bank"
	}
}
