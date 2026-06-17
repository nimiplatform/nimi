package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type memoryPolicyRuntime struct {
	svc *Service
}

func (s *Service) memoryPolicyRuntime() memoryPolicyRuntime {
	return memoryPolicyRuntime{svc: s}
}

func (m memoryPolicyRuntime) query(ctx context.Context, req *runtimev1.QueryAgentMemoryRequest) (*runtimev1.QueryAgentMemoryResponse, error) {
	_, entry, err := m.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	if err := validateMemoryReadScopeAdmission(entry, req); err != nil {
		return nil, err
	}
	if requiresExplicitWorldSharedAdmission(req.GetCanonicalClasses()) && validateWorldSharedAgentState(entry) != nil {
		return nil, worldSharedAdmissionError()
	}
	queries := m.queryLocators(entry, req.GetCanonicalClasses())
	views := make([]*runtimev1.CanonicalMemoryView, 0)
	narratives := make([]*runtimev1.NarrativeRecallHit, 0)
	limit := req.GetLimit()
	if limit <= 0 {
		limit = 10
	}
	queryText := strings.TrimSpace(req.GetQuery())
	for _, locator := range queries {
		if _, err := m.svc.memorySvc.GetBank(ctx, &runtimev1.GetBankRequest{Locator: locator}); err != nil {
			if status.Code(err) == codes.NotFound {
				continue
			}
			return nil, err
		}
		if queryText == "" {
			historyResp, err := m.svc.memorySvc.History(ctx, &runtimev1.HistoryRequest{
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
		resp, err := m.svc.memorySvc.Recall(ctx, &runtimev1.RecallRequest{
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
		narratives = append(narratives, cloneNarrativeHits(resp.GetNarrativeHits())...)
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
	if int(limit) < len(narratives) {
		narratives = narratives[:limit]
	}
	return &runtimev1.QueryAgentMemoryResponse{Memories: views, Narratives: narratives}, nil
}

func (m memoryPolicyRuntime) write(ctx context.Context, req *runtimev1.WriteAgentMemoryRequest) (*runtimev1.WriteAgentMemoryResponse, error) {
	if len(req.GetCandidates()) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, entry, err := m.svc.agentEntryForIdentityContext(req.GetContext())
	if err != nil {
		return nil, err
	}
	accepted := make([]*runtimev1.CanonicalMemoryView, 0, len(req.GetCandidates()))
	rejected := make([]*runtimev1.CanonicalMemoryRejection, 0)
	for _, candidate := range req.GetCandidates() {
		if rejection := m.validateDirectMemoryPromotionEvidence(candidate); rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		if rejection := validateWorldSharedCandidateAdmission(entry, candidate); rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		view, rejection := m.writeCandidate(ctx, entry, candidate)
		if rejection != nil {
			rejected = append(rejected, rejection)
			continue
		}
		if view != nil {
			accepted = append(accepted, view)
		}
	}
	if len(accepted) > 0 || len(rejected) > 0 {
		events := []*runtimev1.AgentEvent{m.svc.newEvent(entry.Agent.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_MEMORY, &runtimev1.AgentEvent_Memory{
			Memory: &runtimev1.AgentMemoryEventDetail{
				Accepted: cloneCanonicalMemoryViews(accepted),
				Rejected: cloneCanonicalMemoryRejections(rejected),
			},
		})}
		if err := m.svc.updateAgent(entry, events...); err != nil {
			return nil, err
		}
	}
	return &runtimev1.WriteAgentMemoryResponse{Accepted: accepted, Rejected: rejected}, nil
}

type runtimeMemoryPromotionEvidence struct {
	PromotionEvidenceRef           string
	ParticipationID                string
	SourceProfile                  string
	OutputCandidateRef             string
	AuditID                        string
	ProvenanceRef                  string
	PolicyVerdictRef               string
	MemoryReadVerdict              string
	MemoryWriteVerdict             string
	CapabilityScopeVerdict         string
	TargetOwnerAuthorizationRef    string
	ExplicitUserOrManagerIntentRef string
}

var directMemoryPromotionCallerEvidenceFields = map[string]struct{}{
	"promotion_target_id":    {},
	"promotion_evidence_ref": {},
}

func (s *Service) registerRuntimeMemoryPromotionEvidence(evidence runtimeMemoryPromotionEvidence) string {
	if s == nil {
		return ""
	}
	ref := strings.TrimSpace(evidence.PromotionEvidenceRef)
	if ref == "" {
		return ""
	}
	evidence.PromotionEvidenceRef = ref
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.memoryPromotionEvidence == nil {
		s.memoryPromotionEvidence = make(map[string]runtimeMemoryPromotionEvidence)
	}
	s.memoryPromotionEvidence[ref] = evidence
	return ref
}

func (s *Service) runtimeMemoryPromotionEvidence(ref string) (runtimeMemoryPromotionEvidence, bool) {
	if s == nil {
		return runtimeMemoryPromotionEvidence{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	evidence, ok := s.memoryPromotionEvidence[strings.TrimSpace(ref)]
	return evidence, ok
}

func (m memoryPolicyRuntime) validateDirectMemoryPromotionEvidence(candidate *runtimev1.CanonicalMemoryCandidate) *runtimev1.CanonicalMemoryRejection {
	if candidate == nil {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "canonical memory candidate is required")
	}
	fields := candidate.GetExtensions().GetFields()
	if len(fields) == 0 {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "direct WriteAgentMemory requires promotion evidence extensions")
	}
	if got := strings.TrimSpace(extensionString(fields, "promotion_target_id")); got != "RUNTIME_MEMORY_OR_COGNITION" {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "promotion_target_id must be RUNTIME_MEMORY_OR_COGNITION")
	}
	for key := range fields {
		if _, ok := directMemoryPromotionCallerEvidenceFields[key]; !ok {
			return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, fmt.Sprintf("direct WriteAgentMemory field %s must be runtime-owned promotion evidence, not caller payload", key))
		}
	}
	evidenceRef := strings.TrimSpace(extensionString(fields, "promotion_evidence_ref"))
	if evidenceRef == "" {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "direct WriteAgentMemory requires runtime-owned promotion_evidence_ref")
	}
	evidence, ok := m.svc.runtimeMemoryPromotionEvidence(evidenceRef)
	if !ok {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "promotion_evidence_ref is not registered by Runtime")
	}
	if strings.TrimSpace(evidence.PromotionEvidenceRef) != evidenceRef {
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "promotion_evidence_ref mismatch")
	}
	for _, item := range []struct {
		key   string
		value string
	}{
		{"participation_id", evidence.ParticipationID},
		{"source_profile", evidence.SourceProfile},
		{"output_candidate_ref", evidence.OutputCandidateRef},
		{"audit_id", evidence.AuditID},
		{"provenance_ref", evidence.ProvenanceRef},
		{"policy_verdict_ref", evidence.PolicyVerdictRef},
		{"memory_read_verdict", evidence.MemoryReadVerdict},
		{"memory_write_verdict", evidence.MemoryWriteVerdict},
		{"capability_scope_verdict", evidence.CapabilityScopeVerdict},
		{"target_owner_authorization_ref", evidence.TargetOwnerAuthorizationRef},
		{"explicit_user_or_manager_intent_ref", evidence.ExplicitUserOrManagerIntentRef},
	} {
		if strings.TrimSpace(item.value) == "" {
			return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, fmt.Sprintf("runtime promotion evidence missing field %s", item.key))
		}
	}
	switch strings.TrimSpace(evidence.SourceProfile) {
	case "canonical_agent_chat", "realm_group_source", "scenario_sandbox", "oasis_world_participation":
	default:
		return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "source_profile is not admitted for runtime memory promotion")
	}
	for _, item := range []struct {
		key   string
		value string
	}{
		{"memory_read_verdict", evidence.MemoryReadVerdict},
		{"memory_write_verdict", evidence.MemoryWriteVerdict},
		{"capability_scope_verdict", evidence.CapabilityScopeVerdict},
	} {
		if !isPassVerdict(item.value) {
			return rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, fmt.Sprintf("%s must be PASS", item.key))
		}
	}
	return nil
}

func extensionString(fields map[string]*structpb.Value, key string) string {
	if len(fields) == 0 || fields[key] == nil {
		return ""
	}
	return strings.TrimSpace(fields[key].GetStringValue())
}

func isPassVerdict(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), "PASS")
}

func validateMemoryReadScopeAdmission(entry *agentEntry, req *runtimev1.QueryAgentMemoryRequest) error {
	if entry == nil {
		return nil
	}
	if len(req.GetCanonicalClasses()) == 0 {
		return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, grpcerr.ReasonOptions{
			ActionHint: "declare_canonical_memory_read_classes",
			Metadata: map[string]string{
				"required_read_scope": "CANONICAL_OWNER_POLICY",
			},
		})
	}
	explicitDyadicRead := requestsExplicitDyadicCanonicalMemory(req.GetCanonicalClasses())
	if !explicitDyadicRead && len(req.GetCanonicalClasses()) > 0 {
		return nil
	}
	activeUserID := strings.TrimSpace(entry.State.GetActiveUserId())
	if activeUserID == "" {
		if !explicitDyadicRead {
			return nil
		}
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	subjectUserID := strings.TrimSpace(req.GetContext().GetSubjectUserId())
	if subjectUserID != activeUserID {
		return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, runtimev1.ReasonCode_APP_GRANT_INVALID, grpcerr.ReasonOptions{
			ActionHint: "attach_canonical_memory_read_scope_context",
			Metadata: map[string]string{
				"required_read_scope": "CANONICAL_OWNER_POLICY",
			},
		})
	}
	return nil
}

func requestsExplicitDyadicCanonicalMemory(classes []runtimev1.MemoryCanonicalClass) bool {
	for _, class := range classes {
		if class == runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC {
			return true
		}
	}
	return false
}

func allCanonicalMemoryReadClasses() []runtimev1.MemoryCanonicalClass {
	return []runtimev1.MemoryCanonicalClass{
		runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
		runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_DYADIC,
		runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_WORLD_SHARED,
	}
}

func (m memoryPolicyRuntime) writeCandidate(ctx context.Context, entry *agentEntry, candidate *runtimev1.CanonicalMemoryCandidate) (*runtimev1.CanonicalMemoryView, *runtimev1.CanonicalMemoryRejection) {
	if candidate == nil || candidate.GetRecord() == nil || candidate.GetTargetBank() == nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, "candidate target_bank and record are required")
	}
	if err := validateCandidateLocator(entry.Agent.GetAgentId(), candidate); err != nil {
		return nil, rejection(candidate, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, err.Error())
	}
	if _, err := m.svc.memorySvc.EnsureCanonicalBank(ctx, cloneLocator(candidate.GetTargetBank()), canonicalBankDisplayName(candidate.GetTargetBank()), nil); err != nil {
		return nil, rejection(candidate, reasonCodeFromError(err), err.Error())
	}
	input := cloneMemoryRecordInput(candidate.GetRecord())
	input.CanonicalClass = candidate.GetCanonicalClass()
	resp, err := m.svc.memorySvc.Retain(ctx, &runtimev1.RetainRequest{
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

func (m memoryPolicyRuntime) queryLocators(entry *agentEntry, classes []runtimev1.MemoryCanonicalClass) []*runtimev1.MemoryBankLocator {
	include := func(class runtimev1.MemoryCanonicalClass) bool {
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
