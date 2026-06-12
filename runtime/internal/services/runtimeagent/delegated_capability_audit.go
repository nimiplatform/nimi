package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) delegatedCapabilityDecisionAuditSnapshot() []delegatedCapabilityDecisionAuditRecord {
	if s == nil {
		return nil
	}
	return s.delegatedCapabilityDecisionAuditRecordsFromRuntimeAudit()
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
		"sensitivity_class":      record.SensitivityClass,
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

// delegatedApprovalDecisionAuditEvent builds the required audit event for a
// delegated approval decision (K-DELEG-095, K-DELEG-097). Missing audit storage
// or lineage is a write precondition failure, not a best-effort side channel.
func (s *Service) delegatedApprovalDecisionAuditEvent(agentID string, approval *runtimev1.DelegatedApprovalRequest, principalID string) (*runtimev1.AuditEventRecord, error) {
	if s == nil || s.auditStore == nil {
		return nil, fmt.Errorf("audit store is required")
	}
	if approval == nil {
		return nil, fmt.Errorf("approval request is required")
	}
	approvalID := strings.TrimSpace(approval.GetApprovalRequestId())
	if approvalID == "" {
		return nil, fmt.Errorf("approval_request_id is required")
	}
	detail := approval.GetDetail().GetFields()
	delegationRequestID := firstNonEmpty(strings.TrimSpace(approval.GetDelegationRequestId()), structStringField(detail, "delegation_request_id"))
	policySnapshotID := firstNonEmpty(strings.TrimSpace(approval.GetPolicySnapshotId()), structStringField(detail, "policy_snapshot_id"))
	if strings.TrimSpace(principalID) == "" {
		principalID = structStringField(detail, "principal_id")
	}
	if strings.TrimSpace(agentID) == "" ||
		delegationRequestID == "" ||
		policySnapshotID == "" ||
		strings.TrimSpace(principalID) == "" ||
		strings.TrimSpace(approval.GetProviderProfileId()) == "" ||
		strings.TrimSpace(approval.GetCapabilityId()) == "" {
		return nil, fmt.Errorf("approval decision audit lineage is incomplete")
	}
	decidedAt := approval.GetUpdatedAt().AsTime().UTC()
	if decidedAt.IsZero() {
		decidedAt = time.Now().UTC()
	}
	payload, err := structpb.NewStruct(map[string]any{
		"approval_request_id": approvalID,
		// decision_id is the explicit join key back to the capability
		// decision_recorded event (K-DELEG-086); it equals approval_request_id
		// because the approval request id is the orchestration decision id.
		"decision_id":            approvalID,
		"agent_id":               strings.TrimSpace(agentID),
		"delegation_request_id":  delegationRequestID,
		"conversation_anchor_id": strings.TrimSpace(approval.GetConversationAnchorId()),
		"turn_id":                strings.TrimSpace(approval.GetTurnId()),
		"provider_profile_id":    strings.TrimSpace(approval.GetProviderProfileId()),
		"capability_id":          strings.TrimSpace(approval.GetCapabilityId()),
		"tool_name":              strings.TrimSpace(approval.GetToolName()),
		"policy_snapshot_id":     policySnapshotID,
		"principal_id":           strings.TrimSpace(principalID),
		"approval_state":         approvalStateName(approval.GetState()),
		"reason_code_text":       strings.TrimSpace(approval.GetReasonCode()),
		"recorded_at":            decidedAt.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, fmt.Errorf("build approval decision audit payload: %w", err)
	}
	return &runtimev1.AuditEventRecord{
		AuditId:     approvalID + ":approval-decision",
		AppId:       "runtime",
		Domain:      "runtime.delegation",
		Operation:   "runtime.agent.delegation.approval_decision",
		ReasonCode:  runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:     firstNonEmpty(delegationRequestID, approvalID),
		Timestamp:   timestamppb.New(decidedAt),
		Payload:     payload,
		CallerId:    "runtime.agent.service",
		SurfaceId:   "runtime.agent.delegation",
		Capability:  "runtime.agent.delegation.execute",
		PrincipalId: firstNonEmpty(strings.TrimSpace(principalID), strings.TrimSpace(agentID)),
	}, nil
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
		SensitivityClass:      structStringField(fields, "sensitivity_class"),
		RuntimeDecision:       structStringField(fields, "runtime_decision"),
		ProjectionDisposition: structStringField(fields, "projection_disposition"),
		ActionDisposition:     structStringField(fields, "action_disposition"),
		RecordedAt:            recordedAt.UTC(),
	}
	return record, strings.TrimSpace(record.DecisionID) != ""
}

// delegatedApprovalDecisionAuditRecord is the committed approval decision
// recovered from the runtime.agent.delegation.approval_decision audit event,
// joined to the capability decision by decision_id (K-DELEG-086).
type delegatedApprovalDecisionAuditRecord struct {
	DecisionID    string
	ApprovalID    string
	ApprovalState string
	ReasonCode    string
	PrincipalID   string
	RecordedAt    time.Time
}

// delegatedApprovalDecisionAuditRecord returns the committed approval decision
// audit record for a decision id, or nil when no decision has been recorded
// (i.e. the approval is still pending). It is the audit-lineage source for the
// replay approval stage, so a reconstructed trace reflects the committed
// decision rather than the mutable in-memory approval object.
func (s *Service) delegatedApprovalDecisionAuditRecord(decisionID string) *delegatedApprovalDecisionAuditRecord {
	if s == nil || s.auditStore == nil || strings.TrimSpace(decisionID) == "" {
		return nil
	}
	req := &runtimev1.ListAuditEventsRequest{
		Domain:   "runtime.delegation",
		PageSize: 200,
	}
	var latest *delegatedApprovalDecisionAuditRecord
	for {
		resp, err := s.auditStore.ListEvents(req)
		if err != nil {
			return latest
		}
		for _, event := range resp.GetEvents() {
			if strings.TrimSpace(event.GetOperation()) != "runtime.agent.delegation.approval_decision" {
				continue
			}
			fields := event.GetPayload().GetFields()
			if structStringField(fields, "decision_id") != decisionID {
				continue
			}
			recordedAt := event.GetTimestamp().AsTime()
			if raw := structStringField(fields, "recorded_at"); raw != "" {
				if parsed, perr := time.Parse(time.RFC3339Nano, raw); perr == nil {
					recordedAt = parsed
				}
			}
			latest = &delegatedApprovalDecisionAuditRecord{
				DecisionID:    decisionID,
				ApprovalID:    structStringField(fields, "approval_request_id"),
				ApprovalState: structStringField(fields, "approval_state"),
				ReasonCode:    structStringField(fields, "reason_code_text"),
				PrincipalID:   structStringField(fields, "principal_id"),
				RecordedAt:    recordedAt.UTC(),
			}
		}
		if strings.TrimSpace(resp.GetNextPageToken()) == "" {
			break
		}
		req.PageToken = resp.GetNextPageToken()
	}
	return latest
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
