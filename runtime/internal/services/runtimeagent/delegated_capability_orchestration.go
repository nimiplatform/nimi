package runtimeagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type delegatedCapabilityGateway interface {
	CallTool(context.Context, delegation.ToolCallRequest) (*delegation.QuarantinedEvidence, error)
}

type delegatedOutputFirewall interface {
	Evaluate(context.Context, delegation.FirewallInput) (*delegation.FirewallDecision, error)
}

type runtimeAgentDelegatedCapabilityRequest struct {
	ProviderID       string
	CapabilityID     string
	ToolName         string
	Arguments        json.RawMessage
	DescriptorHash   string
	ProtocolName     string
	ProtocolRevision string
	OutputKind       string
	RequiresApproval bool
}

const (
	delegatedPausedModePreinvoke    = "preinvoke"
	delegatedPausedModePostFirewall = "postfirewall"
	delegatedResumeStatePending     = "pending"
	delegatedResumeStateExecuting   = "executing"
)

type runtimeAgentPausedDelegatedCapabilityRequest struct {
	AgentID              string
	ApprovalRequestID    string
	Mode                 string
	ResumeState          string
	ConversationAnchorID string
	TurnID               string
	StreamID             string
	RequestID            string
	Request              runtimeAgentDelegatedCapabilityRequest
	DelegationRequestID  string
	DelegationResultID   string
	GatewayEvidenceID    string
	FirewallInputID      string
	FirewallVerdict      string
	ReasonCode           string
	RuntimeDecision      string
	ModelOutputJSON      json.RawMessage
	DecidedAt            time.Time
}

type runtimeAgentDelegatedCapabilityDecision struct {
	DecisionID               string
	AgentID                  string
	DelegationRequestID      string
	DelegationResultID       string
	TurnID                   string
	StreamID                 string
	ConversationAnchorID     string
	ProviderID               string
	CapabilityID             string
	ToolName                 string
	DescriptorHash           string
	PolicySnapshotID         string
	ApprovalPrincipalID      string
	ApprovalExpiresAt        time.Time
	EffectClass              runtimev1.EffectClass
	SensitivityClass         runtimev1.SensitivityClass
	SummaryRef               string
	ClassificationBasis      string
	FirewallSensitivityClass string
	GatewayEvidenceID        string
	FirewallInputID          string
	FirewallVerdict          string
	ReasonCode               string
	RuntimeDecision          string
	ModelContextAdmitted     bool
	ProjectionAdmitted       bool
	ActionAdmitted           bool
	ModelOutputJSON          json.RawMessage
	PausedRequest            *runtimeAgentPausedDelegatedCapabilityRequest
	DecidedAt                time.Time
}

type delegatedCapabilityDecisionAuditRecord struct {
	DecisionID            string
	AgentID               string
	DelegationRequestID   string
	DelegationResultID    string
	ConversationAnchorID  string
	TurnID                string
	StreamID              string
	ProviderID            string
	CapabilityID          string
	ToolName              string
	GatewayEvidenceID     string
	FirewallInputID       string
	FirewallVerdict       string
	ReasonCode            string
	SensitivityClass      string
	RuntimeDecision       string
	ProjectionDisposition string
	ActionDisposition     string
	RecordedAt            time.Time
}

func (s *Service) SetDelegatedCapabilityRuntime(gateway delegatedCapabilityGateway, firewall delegatedOutputFirewall) {
	if s == nil {
		return
	}
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.delegatedGateway = gateway
	s.delegatedFirewall = firewall
}

func (s *Service) delegatedCapabilityRuntime() (delegatedCapabilityGateway, delegatedOutputFirewall) {
	if s == nil {
		return nil, nil
	}
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	return s.delegatedGateway, s.delegatedFirewall
}

func (r publicChatRuntime) executeDelegatedCapability(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req runtimeAgentDelegatedCapabilityRequest,
) (*runtimeAgentDelegatedCapabilityDecision, error) {
	if r.svc == nil || r.svc.isClosed() {
		return nil, fmt.Errorf("runtime agent delegated capability orchestration unavailable")
	}
	gateway, firewall := r.svc.delegatedCapabilityRuntime()
	if gateway == nil {
		return nil, fmt.Errorf("runtime agent delegated gateway is not configured")
	}
	if firewall == nil {
		return nil, fmt.Errorf("runtime agent delegated firewall is not configured")
	}
	normalized, err := normalizeRuntimeAgentDelegatedCapabilityRequest(req)
	if err != nil {
		return nil, err
	}
	if r.svc.auditStore == nil {
		return nil, fmt.Errorf("runtime agent delegated audit store is not configured")
	}
	if normalized.RequiresApproval {
		decision := runtimeAgentPreinvokeApprovalDecision(session, turn, normalized)
		if err := r.svc.recordDelegatedCapabilityDecision(decision); err != nil {
			return nil, err
		}
		return decision, nil
	}
	evidence, err := gateway.CallTool(ctx, delegation.ToolCallRequest{
		ProviderID: normalized.ProviderID,
		ToolName:   normalized.ToolName,
		Arguments:  normalized.Arguments,
		TraceID:    firstNonEmpty(strings.TrimSpace(turn.LastKnownTraceID), strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
	})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(evidenceID(evidence)) == "" {
		return nil, fmt.Errorf("runtime agent delegated gateway evidence id is required")
	}
	effectClass, trustTier := r.svc.delegatedFirewallClassificationInputs(
		strings.TrimSpace(session.AgentID),
		normalized.ProviderID,
		normalized.ToolName,
	)
	firewallInput := buildRuntimeAgentFirewallInput(session, turn, normalized, evidence, effectClass, trustTier)
	verdict, err := firewall.Evaluate(ctx, firewallInput)
	if err != nil {
		return nil, err
	}
	decision := runtimeAgentDecisionFromFirewall(session, turn, normalized, evidence, firewallInput, verdict)
	if err := r.svc.recordDelegatedCapabilityDecision(decision); err != nil {
		return nil, err
	}
	return decision, nil
}

func normalizeRuntimeAgentDelegatedCapabilityRequest(req runtimeAgentDelegatedCapabilityRequest) (runtimeAgentDelegatedCapabilityRequest, error) {
	req.ProviderID = strings.TrimSpace(req.ProviderID)
	req.CapabilityID = strings.TrimSpace(req.CapabilityID)
	req.ToolName = strings.TrimSpace(req.ToolName)
	req.DescriptorHash = strings.TrimSpace(req.DescriptorHash)
	req.ProtocolName = strings.TrimSpace(req.ProtocolName)
	req.ProtocolRevision = strings.TrimSpace(req.ProtocolRevision)
	req.OutputKind = firstNonEmpty(strings.TrimSpace(req.OutputKind), delegation.OutputKindObservation)
	if req.ProviderID == "" || req.CapabilityID == "" || req.ToolName == "" || req.DescriptorHash == "" || req.ProtocolName == "" {
		return req, fmt.Errorf("delegated capability request requires provider, capability, tool, descriptor hash, and protocol")
	}
	return req, nil
}

func cloneRuntimeAgentDelegatedCapabilityRequest(req runtimeAgentDelegatedCapabilityRequest) runtimeAgentDelegatedCapabilityRequest {
	req.Arguments = cloneJSONRawMessage(req.Arguments)
	return req
}

func cloneRuntimeAgentPausedDelegatedCapabilityRequest(req *runtimeAgentPausedDelegatedCapabilityRequest) *runtimeAgentPausedDelegatedCapabilityRequest {
	if req == nil {
		return nil
	}
	return &runtimeAgentPausedDelegatedCapabilityRequest{
		AgentID:              strings.TrimSpace(req.AgentID),
		ApprovalRequestID:    strings.TrimSpace(req.ApprovalRequestID),
		Mode:                 firstNonEmpty(strings.TrimSpace(req.Mode), delegatedPausedModePreinvoke),
		ResumeState:          firstNonEmpty(strings.TrimSpace(req.ResumeState), delegatedResumeStatePending),
		ConversationAnchorID: strings.TrimSpace(req.ConversationAnchorID),
		TurnID:               strings.TrimSpace(req.TurnID),
		StreamID:             strings.TrimSpace(req.StreamID),
		RequestID:            strings.TrimSpace(req.RequestID),
		Request:              cloneRuntimeAgentDelegatedCapabilityRequest(req.Request),
		DelegationRequestID:  strings.TrimSpace(req.DelegationRequestID),
		DelegationResultID:   strings.TrimSpace(req.DelegationResultID),
		GatewayEvidenceID:    strings.TrimSpace(req.GatewayEvidenceID),
		FirewallInputID:      strings.TrimSpace(req.FirewallInputID),
		FirewallVerdict:      strings.TrimSpace(req.FirewallVerdict),
		ReasonCode:           strings.TrimSpace(req.ReasonCode),
		RuntimeDecision:      strings.TrimSpace(req.RuntimeDecision),
		ModelOutputJSON:      cloneJSONRawMessage(req.ModelOutputJSON),
		DecidedAt:            req.DecidedAt,
	}
}

func cloneJSONRawMessage(input json.RawMessage) json.RawMessage {
	if len(input) == 0 {
		return nil
	}
	out := make([]byte, len(input))
	copy(out, input)
	return json.RawMessage(out)
}

func runtimeAgentPreinvokeApprovalDecision(
	session publicChatAnchorState,
	turn publicChatTurnState,
	req runtimeAgentDelegatedCapabilityRequest,
) *runtimeAgentDelegatedCapabilityDecision {
	now := time.Now().UTC()
	return &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-" + ulid.Make().String(),
		AgentID:              strings.TrimSpace(session.AgentID),
		DelegationRequestID:  firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
		TurnID:               strings.TrimSpace(turn.TurnID),
		StreamID:             strings.TrimSpace(turn.StreamID),
		ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
		ProviderID:           req.ProviderID,
		CapabilityID:         req.CapabilityID,
		ToolName:             req.ToolName,
		DescriptorHash:       req.DescriptorHash,
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID(req.ProviderID, req.CapabilityID, req.ToolName, req.DescriptorHash),
		ApprovalPrincipalID:  firstNonEmpty(strings.TrimSpace(session.SubjectUserID), strings.TrimSpace(session.CallerAppID)),
		ApprovalExpiresAt:    now.Add(defaultDelegatedApprovalTTL),
		FirewallVerdict:      delegation.FirewallVerdictApprovalRequired,
		ReasonCode:           delegation.ReasonApprovalRequired,
		RuntimeDecision:      "approval_required",
		PausedRequest: &runtimeAgentPausedDelegatedCapabilityRequest{
			AgentID:              strings.TrimSpace(session.AgentID),
			ApprovalRequestID:    "",
			Mode:                 delegatedPausedModePreinvoke,
			ResumeState:          delegatedResumeStatePending,
			ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
			TurnID:               strings.TrimSpace(turn.TurnID),
			StreamID:             strings.TrimSpace(turn.StreamID),
			RequestID:            firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
			Request:              cloneRuntimeAgentDelegatedCapabilityRequest(req),
			DelegationRequestID:  firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
			FirewallVerdict:      delegation.FirewallVerdictApprovalRequired,
			ReasonCode:           delegation.ReasonApprovalRequired,
			RuntimeDecision:      "",
			DecidedAt:            now,
		},
		DecidedAt: now,
	}
}

func buildRuntimeAgentFirewallInput(
	session publicChatAnchorState,
	turn publicChatTurnState,
	req runtimeAgentDelegatedCapabilityRequest,
	evidence *delegation.QuarantinedEvidence,
	effectClass string,
	trustTier string,
) delegation.FirewallInput {
	now := time.Now().UTC()
	resultID := "deleg-result-" + ulid.Make().String()
	provenance := delegation.ProvenanceRecord{
		ProvenanceID:        "deleg-prov-" + ulid.Make().String(),
		ProviderProfileID:   req.ProviderID,
		CapabilityID:        req.CapabilityID,
		DelegationRequestID: firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
		DelegationResultID:  resultID,
		DescriptorHash:      req.DescriptorHash,
		ProtocolName:        req.ProtocolName,
		ProtocolRevision:    req.ProtocolRevision,
		ReceivedAt:          now,
	}
	return delegation.FirewallInput{
		FirewallInputID:    "deleg-fw-" + ulid.Make().String(),
		DelegationResultID: resultID,
		CandidateOutputRef: strings.TrimSpace(evidenceID(evidence)),
		ProviderProfileID:  req.ProviderID,
		CapabilityID:       req.CapabilityID,
		DescriptorHash:     req.DescriptorHash,
		ProtocolName:       req.ProtocolName,
		ProtocolRevision:   req.ProtocolRevision,
		OutputKind:         req.OutputKind,
		RequiresApproval:   req.RequiresApproval,
		EffectClass:        effectClass,
		TrustTier:          trustTier,
		Confidence: delegation.ConfidenceRecord{
			Level:         delegation.ConfidenceLevelHigh,
			EvidenceCount: 1,
			Reason:        delegation.ConfidenceReasonProviderEvidence,
		},
		Provenance: provenance,
		Evidence:   evidence,
		ReceivedAt: now,
	}
}

func runtimeAgentDecisionFromFirewall(
	session publicChatAnchorState,
	turn publicChatTurnState,
	req runtimeAgentDelegatedCapabilityRequest,
	evidence *delegation.QuarantinedEvidence,
	input delegation.FirewallInput,
	verdict *delegation.FirewallDecision,
) *runtimeAgentDelegatedCapabilityDecision {
	decision := &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-" + ulid.Make().String(),
		AgentID:              strings.TrimSpace(session.AgentID),
		DelegationRequestID:  strings.TrimSpace(input.Provenance.DelegationRequestID),
		DelegationResultID:   strings.TrimSpace(input.DelegationResultID),
		TurnID:               strings.TrimSpace(turn.TurnID),
		StreamID:             strings.TrimSpace(turn.StreamID),
		ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
		ProviderID:           req.ProviderID,
		CapabilityID:         req.CapabilityID,
		ToolName:             req.ToolName,
		DescriptorHash:       req.DescriptorHash,
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID(req.ProviderID, req.CapabilityID, req.ToolName, req.DescriptorHash),
		ApprovalPrincipalID:  firstNonEmpty(strings.TrimSpace(session.SubjectUserID), strings.TrimSpace(session.CallerAppID)),
		ApprovalExpiresAt:    time.Now().UTC().Add(defaultDelegatedApprovalTTL),
		GatewayEvidenceID:    evidenceID(evidence),
		FirewallInputID:      strings.TrimSpace(input.FirewallInputID),
		RuntimeDecision:      "ignore",
		DecidedAt:            time.Now().UTC(),
	}
	if verdict == nil {
		decision.FirewallVerdict = delegation.FirewallVerdictRejected
		decision.ReasonCode = delegation.ReasonFirewallQuarantined
		return decision
	}
	decision.FirewallVerdict = strings.TrimSpace(verdict.Verdict)
	decision.ReasonCode = strings.TrimSpace(verdict.ReasonCode)
	// K-DELEG-068 content classification recorded for every firewall-evaluated
	// path so the replay outcome can mark sensitive output as PARTIAL_REDACTED.
	decision.FirewallSensitivityClass = strings.TrimSpace(verdict.SensitivityClass)
	switch verdict.Verdict {
	case delegation.FirewallVerdictAcceptedObservation:
		decision.RuntimeDecision = "context_candidate"
		decision.ModelOutputJSON = cloneJSONRawMessage(verdict.NormalizedOutput)
	case delegation.FirewallVerdictAcceptedSuggestion:
		decision.RuntimeDecision = "suggestion_candidate"
		decision.ModelOutputJSON = cloneJSONRawMessage(verdict.NormalizedOutput)
	case delegation.FirewallVerdictApprovalRequired:
		decision.RuntimeDecision = "approval_required"
		// FirewallSensitivityClass (set above) carries the firewall's K-DELEG-068
		// content classification of the actual output for the post-firewall
		// approval record, rather than the declared descriptor.
		decision.PausedRequest = &runtimeAgentPausedDelegatedCapabilityRequest{
			AgentID:              strings.TrimSpace(session.AgentID),
			ApprovalRequestID:    "",
			Mode:                 delegatedPausedModePostFirewall,
			ResumeState:          delegatedResumeStatePending,
			ConversationAnchorID: strings.TrimSpace(session.ConversationAnchorID),
			TurnID:               strings.TrimSpace(turn.TurnID),
			StreamID:             strings.TrimSpace(turn.StreamID),
			RequestID:            firstNonEmpty(strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
			Request:              cloneRuntimeAgentDelegatedCapabilityRequest(req),
			DelegationRequestID:  strings.TrimSpace(input.Provenance.DelegationRequestID),
			DelegationResultID:   strings.TrimSpace(input.DelegationResultID),
			GatewayEvidenceID:    evidenceID(evidence),
			FirewallInputID:      strings.TrimSpace(input.FirewallInputID),
			FirewallVerdict:      strings.TrimSpace(verdict.Verdict),
			ReasonCode:           strings.TrimSpace(verdict.ReasonCode),
			RuntimeDecision:      runtimeDecisionForApprovedDelegatedOutputKind(req.OutputKind),
			ModelOutputJSON:      cloneJSONRawMessage(verdict.NormalizedOutput),
			DecidedAt:            decision.DecidedAt,
		}
	default:
		decision.RuntimeDecision = "rejected"
	}
	return decision
}

func runtimeDecisionForApprovedDelegatedOutputKind(outputKind string) string {
	switch strings.TrimSpace(outputKind) {
	case delegation.OutputKindSuggestedIntent, delegation.OutputKindSuggestedPresentation, delegation.OutputKindSuggestedToolRequest:
		return "suggestion_candidate"
	default:
		return "context_candidate"
	}
}

func (s *Service) recordDelegatedCapabilityDecision(decision *runtimeAgentDelegatedCapabilityDecision) error {
	if s == nil || decision == nil {
		return nil
	}
	record := delegatedCapabilityDecisionAuditRecord{
		DecisionID:            strings.TrimSpace(decision.DecisionID),
		AgentID:               strings.TrimSpace(decision.AgentID),
		DelegationRequestID:   strings.TrimSpace(decision.DelegationRequestID),
		DelegationResultID:    strings.TrimSpace(decision.DelegationResultID),
		ConversationAnchorID:  strings.TrimSpace(decision.ConversationAnchorID),
		TurnID:                strings.TrimSpace(decision.TurnID),
		StreamID:              strings.TrimSpace(decision.StreamID),
		ProviderID:            strings.TrimSpace(decision.ProviderID),
		CapabilityID:          strings.TrimSpace(decision.CapabilityID),
		ToolName:              strings.TrimSpace(decision.ToolName),
		GatewayEvidenceID:     strings.TrimSpace(decision.GatewayEvidenceID),
		FirewallInputID:       strings.TrimSpace(decision.FirewallInputID),
		FirewallVerdict:       strings.TrimSpace(decision.FirewallVerdict),
		ReasonCode:            strings.TrimSpace(decision.ReasonCode),
		SensitivityClass:      strings.TrimSpace(decision.FirewallSensitivityClass),
		RuntimeDecision:       strings.TrimSpace(decision.RuntimeDecision),
		ProjectionDisposition: projectionDispositionForDelegatedDecision(decision),
		ActionDisposition:     actionDispositionForDelegatedDecision(decision),
		RecordedAt:            decision.DecidedAt.UTC(),
	}
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	if record.RuntimeDecision == "approval_required" {
		approvalKey := delegatedApprovalRequestKey(strings.TrimSpace(decision.AgentID), strings.TrimSpace(decision.DecisionID))
		previousApproval, hadApproval := s.delegatedApprovalRequests[approvalKey]
		previousPaused, hadPaused := s.delegatedPausedRequests[approvalKey]
		s.classifyDelegatedApprovalDecisionLocked(decision)
		s.recordDelegatedApprovalRequestLocked(decision)
		s.recordDelegatedPausedCapabilityRequestLocked(decision)
		if err := s.persistDelegatedControlStateLocked(); err != nil {
			if hadApproval {
				s.delegatedApprovalRequests[approvalKey] = previousApproval
			} else {
				delete(s.delegatedApprovalRequests, approvalKey)
			}
			if hadPaused {
				s.delegatedPausedRequests[approvalKey] = previousPaused
			} else {
				delete(s.delegatedPausedRequests, approvalKey)
			}
			s.delegatedMu.Unlock()
			return fmt.Errorf("delegated approval state persistence failed: %w", err)
		}
	}
	s.delegatedMu.Unlock()
	s.appendDelegatedDecisionAuditEvent(record)
	return nil
}

func (s *Service) recordDelegatedPausedCapabilityRequestLocked(decision *runtimeAgentDelegatedCapabilityDecision) {
	if s == nil || decision == nil || decision.PausedRequest == nil {
		return
	}
	agentID := strings.TrimSpace(decision.AgentID)
	approvalID := strings.TrimSpace(decision.DecisionID)
	if agentID == "" || approvalID == "" {
		return
	}
	key := delegatedApprovalRequestKey(agentID, approvalID)
	if existing := s.delegatedPausedRequests[key]; existing != nil {
		return
	}
	paused := cloneRuntimeAgentPausedDelegatedCapabilityRequest(decision.PausedRequest)
	paused.ApprovalRequestID = approvalID
	if paused.Mode == "" {
		paused.Mode = delegatedPausedModePreinvoke
	}
	if paused.ResumeState == "" {
		paused.ResumeState = delegatedResumeStatePending
	}
	s.delegatedPausedRequests[key] = paused
}

func (s *Service) recordDelegatedApprovalRequestLocked(decision *runtimeAgentDelegatedCapabilityDecision) {
	if s == nil || decision == nil {
		return
	}
	agentID := strings.TrimSpace(decision.AgentID)
	approvalID := strings.TrimSpace(decision.DecisionID)
	if agentID == "" || approvalID == "" {
		return
	}
	key := delegatedApprovalRequestKey(agentID, approvalID)
	if existing := s.delegatedApprovalRequests[key]; existing != nil {
		return
	}
	decidedAt := decision.DecidedAt.UTC()
	if decidedAt.IsZero() {
		decidedAt = time.Now().UTC()
	}
	expiresAt := decision.ApprovalExpiresAt.UTC()
	if expiresAt.IsZero() {
		expiresAt = decidedAt.Add(defaultDelegatedApprovalTTL)
	}
	policySnapshotID := firstNonEmpty(
		strings.TrimSpace(decision.PolicySnapshotID),
		delegatedApprovalPolicySnapshotID(decision.ProviderID, decision.CapabilityID, decision.ToolName, decision.DescriptorHash),
	)
	detail, _ := structpb.NewStruct(map[string]any{
		"gateway_evidence_id":   strings.TrimSpace(decision.GatewayEvidenceID),
		"firewall_input_id":     strings.TrimSpace(decision.FirewallInputID),
		"delegation_request_id": strings.TrimSpace(decision.DelegationRequestID),
		"delegation_result_id":  strings.TrimSpace(decision.DelegationResultID),
		"descriptor_hash":       strings.TrimSpace(decision.DescriptorHash),
		"policy_snapshot_id":    policySnapshotID,
		"principal_id":          strings.TrimSpace(decision.ApprovalPrincipalID),
		"approval_kind":         delegatedApprovalKindFromDecision(decision),
		"summary":               delegatedApprovalSummaryText(decision),
		"classification_basis":  firstNonEmpty(strings.TrimSpace(decision.ClassificationBasis), delegatedClassificationBasisDeclared),
	})
	s.delegatedApprovalRequests[key] = &runtimev1.DelegatedApprovalRequest{
		ApprovalRequestId:    approvalID,
		AgentId:              agentID,
		ConversationAnchorId: strings.TrimSpace(decision.ConversationAnchorID),
		TurnId:               strings.TrimSpace(decision.TurnID),
		ProviderProfileId:    strings.TrimSpace(decision.ProviderID),
		CapabilityId:         strings.TrimSpace(decision.CapabilityID),
		DelegationRequestId:  strings.TrimSpace(decision.DelegationRequestID),
		PolicySnapshotId:     policySnapshotID,
		EffectClass:          decision.EffectClass,
		SensitivityClass:     decision.SensitivityClass,
		SummaryRef:           strings.TrimSpace(decision.SummaryRef),
		ToolName:             strings.TrimSpace(decision.ToolName),
		FirewallVerdict:      strings.TrimSpace(decision.FirewallVerdict),
		ReasonCode:           strings.TrimSpace(decision.ReasonCode),
		State:                runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_PENDING,
		Detail:               detail,
		CreatedAt:            timestamppb.New(decidedAt),
		UpdatedAt:            timestamppb.New(decidedAt),
		ExpiresAt:            timestamppb.New(expiresAt),
	}
}

func delegatedApprovalKindFromDecision(decision *runtimeAgentDelegatedCapabilityDecision) string {
	if decision == nil || decision.PausedRequest == nil {
		return delegatedPausedModePreinvoke
	}
	switch strings.TrimSpace(decision.PausedRequest.Mode) {
	case delegatedPausedModePostFirewall:
		return delegatedPausedModePostFirewall
	default:
		return delegatedPausedModePreinvoke
	}
}

func evidenceID(evidence *delegation.QuarantinedEvidence) string {
	if evidence == nil {
		return ""
	}
	return strings.TrimSpace(evidence.EvidenceID)
}
