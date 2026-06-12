package runtimeagent

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func missingDelegatedPostFirewallApprovalReplayJoinKeys(record delegatedCapabilityDecisionAuditRecord) []string {
	required := []struct {
		name  string
		value string
	}{
		{"decision_id", record.DecisionID},
		{"delegation_request_id", record.DelegationRequestID},
		{"delegation_result_id", record.DelegationResultID},
		{"turn_id", record.TurnID},
		{"provider_profile_id", record.ProviderID},
		{"capability_id", record.CapabilityID},
		{"gateway_evidence_id", record.GatewayEvidenceID},
		{"firewall_input_id", record.FirewallInputID},
		{"firewall_verdict", record.FirewallVerdict},
		{"runtime_decision", record.RuntimeDecision},
		{"projection_disposition", record.ProjectionDisposition},
		{"action_disposition", record.ActionDisposition},
	}
	var missing []string
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	return missing
}

func delegatedApprovalKind(approval *runtimev1.DelegatedApprovalRequest) string {
	if approval == nil {
		return delegatedPausedModePreinvoke
	}
	kind := structStringField(approval.GetDetail().GetFields(), "approval_kind")
	if kind == delegatedPausedModePostFirewall {
		return delegatedPausedModePostFirewall
	}
	return delegatedPausedModePreinvoke
}

func delegatedReplayStage(kind runtimev1.DelegatedTraceStageKind, stageID string, state string, reasonCode string, summary string, observedAt *timestamppb.Timestamp) *runtimev1.DelegatedReplayTraceStage {
	return &runtimev1.DelegatedReplayTraceStage{
		Kind:            kind,
		StageId:         strings.TrimSpace(stageID),
		State:           strings.TrimSpace(state),
		ReasonCode:      strings.TrimSpace(reasonCode),
		RedactedSummary: summary,
		ObservedAt:      cloneTimestamp(observedAt),
	}
}

func delegatedReplayOutcome(record delegatedCapabilityDecisionAuditRecord) runtimev1.DelegatedReplayOutcome {
	if record.RuntimeDecision == "rejected" {
		if record.FirewallVerdict == "POLICY_BLOCKED" || record.ReasonCode == "DELEG_FIREWALL_QUARANTINED" {
			return runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_BLOCKED_BY_POLICY
		}
		return runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_PARTIAL_REDACTED
	}
	// K-DELEG-087: a reconstructed trace whose underlying output carried
	// sensitive content (classified non-NONE by the firewall) is reported as
	// PARTIAL_REDACTED so the consumer knows protected content was withheld.
	if sensitiveDelegatedOutputClass(record.SensitivityClass) {
		return runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_PARTIAL_REDACTED
	}
	return runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_RECONSTRUCTED
}

// sensitiveDelegatedOutputClass reports whether a recorded sensitivity class
// represents content that must be redacted from replay views (K-DELEG-087).
// NONE and an empty/unclassified value are not redaction-bearing.
func sensitiveDelegatedOutputClass(class string) bool {
	switch strings.TrimSpace(class) {
	case "", delegation.SensitivityClassNone:
		return false
	default:
		return true
	}
}

func (s *Service) delegatedApprovalRequest(agentID string, approvalID string) *runtimev1.DelegatedApprovalRequest {
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	approval := s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)]
	if approval == nil {
		return nil
	}
	return proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
}

func approvalStateName(state runtimev1.DelegatedApprovalRequestState) string {
	switch state {
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_PENDING:
		return "pending"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED_ONCE:
		return "approved_once"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_REJECTED:
		return "rejected"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED:
		return "expired"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED_FOR_SESSION:
		return "approved_for_session"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_POLICY_BLOCKED:
		return "policy_blocked"
	default:
		return "unspecified"
	}
}
