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

type runtimeAgentDelegatedCapabilityDecision struct {
	DecisionID           string
	AgentID              string
	DelegationRequestID  string
	DelegationResultID   string
	TurnID               string
	StreamID             string
	ConversationAnchorID string
	ProviderID           string
	CapabilityID         string
	ToolName             string
	GatewayEvidenceID    string
	FirewallInputID      string
	FirewallVerdict      string
	ReasonCode           string
	RuntimeDecision      string
	ModelContextAdmitted bool
	ProjectionAdmitted   bool
	ActionAdmitted       bool
	DecidedAt            time.Time
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
	evidence, err := gateway.CallTool(ctx, delegation.ToolCallRequest{
		ProviderID: normalized.ProviderID,
		ToolName:   normalized.ToolName,
		Arguments:  normalized.Arguments,
		TraceID:    firstNonEmpty(strings.TrimSpace(turn.LastKnownTraceID), strings.TrimSpace(turn.RequestID), strings.TrimSpace(turn.TurnID)),
	})
	if err != nil {
		return nil, err
	}
	firewallInput := buildRuntimeAgentFirewallInput(session, turn, normalized, evidence)
	verdict, err := firewall.Evaluate(ctx, firewallInput)
	if err != nil {
		return nil, err
	}
	decision := runtimeAgentDecisionFromFirewall(session, turn, normalized, evidence, firewallInput, verdict)
	r.svc.recordDelegatedCapabilityDecision(decision)
	return decision, nil
}

func normalizeRuntimeAgentDelegatedCapabilityRequest(req runtimeAgentDelegatedCapabilityRequest) (runtimeAgentDelegatedCapabilityRequest, error) {
	req.ProviderID = strings.TrimSpace(req.ProviderID)
	req.CapabilityID = strings.TrimSpace(req.CapabilityID)
	req.ToolName = strings.TrimSpace(req.ToolName)
	req.DescriptorHash = strings.TrimSpace(req.DescriptorHash)
	req.ProtocolName = firstNonEmpty(strings.TrimSpace(req.ProtocolName), "mcp")
	req.ProtocolRevision = strings.TrimSpace(req.ProtocolRevision)
	req.OutputKind = firstNonEmpty(strings.TrimSpace(req.OutputKind), delegation.OutputKindObservation)
	if req.ProviderID == "" || req.CapabilityID == "" || req.ToolName == "" || req.DescriptorHash == "" {
		return req, fmt.Errorf("delegated capability request requires provider, capability, tool, and descriptor hash")
	}
	return req, nil
}

func buildRuntimeAgentFirewallInput(
	session publicChatAnchorState,
	turn publicChatTurnState,
	req runtimeAgentDelegatedCapabilityRequest,
	evidence *delegation.QuarantinedEvidence,
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
		CandidateOutputRef: firstNonEmpty(strings.TrimSpace(evidenceID(evidence)), "deleg-evidence-unavailable"),
		ProviderProfileID:  req.ProviderID,
		CapabilityID:       req.CapabilityID,
		DescriptorHash:     req.DescriptorHash,
		ProtocolName:       req.ProtocolName,
		ProtocolRevision:   req.ProtocolRevision,
		OutputKind:         req.OutputKind,
		RequiresApproval:   req.RequiresApproval,
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
	switch verdict.Verdict {
	case delegation.FirewallVerdictAcceptedObservation:
		decision.RuntimeDecision = "context_candidate"
	case delegation.FirewallVerdictAcceptedSuggestion:
		decision.RuntimeDecision = "suggestion_candidate"
	case delegation.FirewallVerdictApprovalRequired:
		decision.RuntimeDecision = "approval_required"
	default:
		decision.RuntimeDecision = "rejected"
	}
	return decision
}

func (s *Service) recordDelegatedCapabilityDecision(decision *runtimeAgentDelegatedCapabilityDecision) {
	if s == nil || decision == nil {
		return
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
		RuntimeDecision:       strings.TrimSpace(decision.RuntimeDecision),
		ProjectionDisposition: projectionDispositionForDelegatedDecision(decision),
		ActionDisposition:     actionDispositionForDelegatedDecision(decision),
		RecordedAt:            decision.DecidedAt.UTC(),
	}
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	s.delegatedDecisionAudit = append(s.delegatedDecisionAudit, record)
	if record.RuntimeDecision == "approval_required" {
		s.recordDelegatedApprovalRequestLocked(decision)
	}
	s.delegatedMu.Unlock()
	s.appendDelegatedDecisionAuditEvent(record)
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
	detail, _ := structpb.NewStruct(map[string]any{
		"gateway_evidence_id":   strings.TrimSpace(decision.GatewayEvidenceID),
		"firewall_input_id":     strings.TrimSpace(decision.FirewallInputID),
		"delegation_request_id": strings.TrimSpace(decision.DelegationRequestID),
		"delegation_result_id":  strings.TrimSpace(decision.DelegationResultID),
	})
	s.delegatedApprovalRequests[key] = &runtimev1.DelegatedApprovalRequest{
		ApprovalRequestId:    approvalID,
		AgentId:              agentID,
		ConversationAnchorId: strings.TrimSpace(decision.ConversationAnchorID),
		TurnId:               strings.TrimSpace(decision.TurnID),
		ProviderProfileId:    strings.TrimSpace(decision.ProviderID),
		CapabilityId:         strings.TrimSpace(decision.CapabilityID),
		ToolName:             strings.TrimSpace(decision.ToolName),
		FirewallVerdict:      strings.TrimSpace(decision.FirewallVerdict),
		ReasonCode:           strings.TrimSpace(decision.ReasonCode),
		State:                runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_PENDING,
		Detail:               detail,
		CreatedAt:            timestamppb.New(decidedAt),
		UpdatedAt:            timestamppb.New(decidedAt),
	}
}

func (s *Service) delegatedCapabilityDecisionAuditSnapshot() []delegatedCapabilityDecisionAuditRecord {
	if s == nil {
		return nil
	}
	if records := s.delegatedCapabilityDecisionAuditRecordsFromRuntimeAudit(); len(records) > 0 {
		return records
	}
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	out := make([]delegatedCapabilityDecisionAuditRecord, len(s.delegatedDecisionAudit))
	copy(out, s.delegatedDecisionAudit)
	return out
}

func (s *Service) appendDelegatedDecisionAuditEvent(record delegatedCapabilityDecisionAuditRecord) {
	if s == nil || s.auditStore == nil || strings.TrimSpace(record.DecisionID) == "" {
		return
	}
	payload, err := structpb.NewStruct(map[string]any{
		"decision_id":            record.DecisionID,
		"agent_id":               record.AgentID,
		"delegation_request_id":  record.DelegationRequestID,
		"delegation_result_id":   record.DelegationResultID,
		"conversation_anchor_id": record.ConversationAnchorID,
		"turn_id":                record.TurnID,
		"stream_id":              record.StreamID,
		"provider_profile_id":    record.ProviderID,
		"capability_id":          record.CapabilityID,
		"tool_name":              record.ToolName,
		"gateway_evidence_id":    record.GatewayEvidenceID,
		"firewall_input_id":      record.FirewallInputID,
		"firewall_verdict":       record.FirewallVerdict,
		"reason_code_text":       record.ReasonCode,
		"runtime_decision":       record.RuntimeDecision,
		"projection_disposition": record.ProjectionDisposition,
		"action_disposition":     record.ActionDisposition,
		"recorded_at":            record.RecordedAt.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return
	}
	s.auditStore.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:     record.DecisionID,
		AppId:       "runtime",
		Domain:      "runtime.delegation",
		Operation:   "runtime.agent.delegation.decision_recorded",
		ReasonCode:  runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:     firstNonEmpty(record.DelegationRequestID, record.DecisionID),
		Timestamp:   timestamppb.New(record.RecordedAt.UTC()),
		Payload:     payload,
		CallerId:    "runtime.agent.service",
		SurfaceId:   "runtime.agent.delegation",
		Capability:  "runtime.agent.delegation.execute",
		PrincipalId: record.AgentID,
	})
}

func (s *Service) delegatedCapabilityDecisionAuditRecordsFromRuntimeAudit() []delegatedCapabilityDecisionAuditRecord {
	if s == nil || s.auditStore == nil {
		return nil
	}
	req := &runtimev1.ListAuditEventsRequest{
		Domain:   "runtime.delegation",
		PageSize: 200,
	}
	var records []delegatedCapabilityDecisionAuditRecord
	for {
		resp, err := s.auditStore.ListEvents(req)
		if err != nil {
			return nil
		}
		for _, event := range resp.GetEvents() {
			if strings.TrimSpace(event.GetOperation()) != "runtime.agent.delegation.decision_recorded" {
				continue
			}
			record, ok := delegatedDecisionAuditRecordFromRuntimeAuditEvent(event)
			if ok {
				records = append(records, record)
			}
		}
		if strings.TrimSpace(resp.GetNextPageToken()) == "" {
			break
		}
		req.PageToken = resp.GetNextPageToken()
	}
	return records
}

func delegatedDecisionAuditRecordFromRuntimeAuditEvent(event *runtimev1.AuditEventRecord) (delegatedCapabilityDecisionAuditRecord, bool) {
	if event == nil || event.GetPayload() == nil {
		return delegatedCapabilityDecisionAuditRecord{}, false
	}
	fields := event.GetPayload().GetFields()
	recordedAt := event.GetTimestamp().AsTime()
	if raw := structStringField(fields, "recorded_at"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			recordedAt = parsed
		}
	}
	record := delegatedCapabilityDecisionAuditRecord{
		DecisionID:            structStringField(fields, "decision_id"),
		AgentID:               structStringField(fields, "agent_id"),
		DelegationRequestID:   structStringField(fields, "delegation_request_id"),
		DelegationResultID:    structStringField(fields, "delegation_result_id"),
		ConversationAnchorID:  structStringField(fields, "conversation_anchor_id"),
		TurnID:                structStringField(fields, "turn_id"),
		StreamID:              structStringField(fields, "stream_id"),
		ProviderID:            structStringField(fields, "provider_profile_id"),
		CapabilityID:          structStringField(fields, "capability_id"),
		ToolName:              structStringField(fields, "tool_name"),
		GatewayEvidenceID:     structStringField(fields, "gateway_evidence_id"),
		FirewallInputID:       structStringField(fields, "firewall_input_id"),
		FirewallVerdict:       structStringField(fields, "firewall_verdict"),
		ReasonCode:            structStringField(fields, "reason_code_text"),
		RuntimeDecision:       structStringField(fields, "runtime_decision"),
		ProjectionDisposition: structStringField(fields, "projection_disposition"),
		ActionDisposition:     structStringField(fields, "action_disposition"),
		RecordedAt:            recordedAt.UTC(),
	}
	return record, strings.TrimSpace(record.DecisionID) != ""
}

func structStringField(fields map[string]*structpb.Value, name string) string {
	if fields == nil {
		return ""
	}
	return strings.TrimSpace(fields[name].GetStringValue())
}

func projectionDispositionForDelegatedDecision(decision *runtimeAgentDelegatedCapabilityDecision) string {
	if decision == nil {
		return "not_projected"
	}
	if decision.ProjectionAdmitted {
		return "projection_admitted"
	}
	switch strings.TrimSpace(decision.RuntimeDecision) {
	case "context_candidate", "suggestion_candidate":
		return "runtime_decision_pending_projection"
	default:
		return "not_projected"
	}
}

func actionDispositionForDelegatedDecision(decision *runtimeAgentDelegatedCapabilityDecision) string {
	if decision == nil {
		return "not_admitted"
	}
	if decision.ActionAdmitted {
		return "action_admitted"
	}
	switch strings.TrimSpace(decision.RuntimeDecision) {
	case "approval_required":
		return "pending_approval"
	case "suggestion_candidate":
		return "runtime_decision_pending_action"
	default:
		return "not_admitted"
	}
}

func evidenceID(evidence *delegation.QuarantinedEvidence) string {
	if evidence == nil {
		return ""
	}
	return strings.TrimSpace(evidence.EvidenceID)
}
