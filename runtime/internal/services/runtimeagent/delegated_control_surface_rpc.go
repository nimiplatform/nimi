package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) ListDelegatedProviderProfiles(_ context.Context, req *runtimev1.ListDelegatedProviderProfilesRequest) (*runtimev1.ListDelegatedProviderProfilesResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.read")
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListDelegatedProviderProfilesResponse{ProviderProfiles: s.listDelegatedProviderProfiles(agentID)}, nil
}

func (s *Service) UpsertDelegatedProviderProfile(_ context.Context, req *runtimev1.UpsertDelegatedProviderProfileRequest) (*runtimev1.UpsertDelegatedProviderProfileResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	profile, err := normalizeDelegatedProviderProfile(req.GetProviderProfile())
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	key := delegatedProviderProfileKey(agentID, profile.GetProviderProfileId())
	if existing := s.delegatedProviderProfiles[key]; existing != nil && existing.GetCreatedAt() != nil {
		profile.CreatedAt = cloneTimestamp(existing.GetCreatedAt())
	} else {
		profile.CreatedAt = timestamppb.New(now)
	}
	profile.UpdatedAt = timestamppb.New(now)
	s.delegatedProviderProfiles[key] = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	out := proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	s.delegatedMu.Unlock()
	return &runtimev1.UpsertDelegatedProviderProfileResponse{ProviderProfile: out}, nil
}

func (s *Service) SetDelegatedProviderState(_ context.Context, req *runtimev1.SetDelegatedProviderStateRequest) (*runtimev1.SetDelegatedProviderStateResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	profileID := strings.TrimSpace(req.GetProviderProfileId())
	if profileID == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_profile_id is required")
	}
	if req.GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_ACTIVE &&
		req.GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED {
		return nil, status.Error(codes.InvalidArgument, "delegated provider state must be ACTIVE or DISABLED")
	}
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, profileID)]
	if profile == nil {
		s.delegatedMu.Unlock()
		return nil, status.Error(codes.NotFound, "delegated provider profile not found")
	}
	profile = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	profile.State = req.GetState()
	profile.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, profileID)] = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	out := proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	s.delegatedMu.Unlock()
	return &runtimev1.SetDelegatedProviderStateResponse{ProviderProfile: out}, nil
}

func (s *Service) ListDelegatedApprovalRequests(_ context.Context, req *runtimev1.ListDelegatedApprovalRequestsRequest) (*runtimev1.ListDelegatedApprovalRequestsResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.read")
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListDelegatedApprovalRequestsResponse{ApprovalRequests: s.listDelegatedApprovalRequests(agentID, strings.TrimSpace(req.GetConversationAnchorId()))}, nil
}

func (s *Service) SubmitDelegatedApprovalDecision(_ context.Context, req *runtimev1.SubmitDelegatedApprovalDecisionRequest) (*runtimev1.SubmitDelegatedApprovalDecisionResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	approvalID := strings.TrimSpace(req.GetApprovalRequestId())
	if approvalID == "" {
		return nil, status.Error(codes.InvalidArgument, "approval_request_id is required")
	}
	nextState := runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_UNSPECIFIED
	switch req.GetDecision() {
	case runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_APPROVE:
		nextState = runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED
	case runtimev1.DelegatedApprovalDecision_DELEGATED_APPROVAL_DECISION_REJECT:
		nextState = runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_REJECTED
	default:
		return nil, status.Error(codes.InvalidArgument, "delegated approval decision must be APPROVE or REJECT")
	}
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	approval := s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)]
	if approval == nil {
		s.delegatedMu.Unlock()
		return nil, status.Error(codes.NotFound, "delegated approval request not found")
	}
	if approval.GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_PENDING {
		s.delegatedMu.Unlock()
		return nil, status.Error(codes.FailedPrecondition, "delegated approval request is not pending")
	}
	approval = proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	approval.State = nextState
	approval.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)] = proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	out := proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	s.delegatedMu.Unlock()
	return &runtimev1.SubmitDelegatedApprovalDecisionResponse{ApprovalRequest: out}, nil
}

func (s *Service) ListDelegatedDiagnostics(_ context.Context, req *runtimev1.ListDelegatedDiagnosticsRequest) (*runtimev1.ListDelegatedDiagnosticsResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.read")
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	records := s.delegatedCapabilityDecisionAuditSnapshot()
	out := make([]*runtimev1.DelegatedDiagnostic, 0, len(records))
	for _, record := range records {
		if record.AgentID != "" && record.AgentID != agentID {
			continue
		}
		if anchorID != "" && record.ConversationAnchorID != anchorID {
			continue
		}
		out = append(out, delegatedDiagnosticFromAuditRecord(agentID, record))
	}
	return &runtimev1.ListDelegatedDiagnosticsResponse{Diagnostics: out}, nil
}

func (s *Service) GetDelegatedReplayTrace(_ context.Context, req *runtimev1.GetDelegatedReplayTraceRequest) (*runtimev1.GetDelegatedReplayTraceResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.read")
	if err != nil {
		return nil, err
	}
	record, err := s.findDelegatedReplayAuditRecord(agentID, strings.TrimSpace(req.GetDecisionId()), strings.TrimSpace(req.GetConversationAnchorId()), strings.TrimSpace(req.GetTurnId()))
	if err != nil {
		return nil, err
	}
	trace, err := s.buildDelegatedReplayTrace(agentID, record)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetDelegatedReplayTraceResponse{Trace: trace}, nil
}

func (s *Service) GetDelegatedControlSurfaceSnapshot(_ context.Context, req *runtimev1.GetDelegatedControlSurfaceSnapshotRequest) (*runtimev1.GetDelegatedControlSurfaceSnapshotResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.read")
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	return &runtimev1.GetDelegatedControlSurfaceSnapshotResponse{Snapshot: &runtimev1.DelegatedControlSurfaceSnapshot{
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ApprovalMode:         runtimev1.DelegatedApprovalMode_DELEGATED_APPROVAL_MODE_RUNTIME_POLICY,
		ProviderProfiles:     s.listDelegatedProviderProfiles(agentID),
		ApprovalRequests:     s.listDelegatedApprovalRequests(agentID, anchorID),
		Diagnostics:          s.listDelegatedDiagnostics(agentID, anchorID),
		ObservedAt:           timestamppb.New(time.Now().UTC()),
	}}, nil
}

func (s *Service) validateDelegatedControlRequest(ctx *runtimev1.AgentRequestContext, agentID string, requiredScope string) (string, error) {
	if s == nil || s.isClosed() {
		return "", status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	trimmedAgentID := strings.TrimSpace(agentID)
	if trimmedAgentID == "" {
		return "", status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if _, err := s.agentByID(trimmedAgentID); err != nil {
		return "", err
	}
	callerAppID := strings.TrimSpace(ctx.GetAppId())
	if callerAppID == "" {
		return "", status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	if scopedBinding := ctx.GetScopedBinding(); scopedBinding != nil {
		if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, trimmedAgentID, requiredScope); err != nil {
			return "", err
		}
	} else if strings.TrimSpace(ctx.GetSubjectUserId()) == "" {
		return "", runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	return trimmedAgentID, nil
}

func normalizeDelegatedProviderProfile(input *runtimev1.DelegatedProviderProfile) (*runtimev1.DelegatedProviderProfile, error) {
	if input == nil {
		return nil, status.Error(codes.InvalidArgument, "delegated provider profile is required")
	}
	out := proto.Clone(input).(*runtimev1.DelegatedProviderProfile)
	out.ProviderProfileId = strings.TrimSpace(out.GetProviderProfileId())
	out.DisplayName = strings.TrimSpace(out.GetDisplayName())
	out.CredentialRef = strings.TrimSpace(out.GetCredentialRef())
	out.TransportRef = strings.TrimSpace(out.GetTransportRef())
	if out.ProviderProfileId == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_profile_id is required")
	}
	if out.ProviderKind != runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER {
		return nil, status.Error(codes.InvalidArgument, "delegated provider kind must be MCP_TOOL_PROVIDER")
	}
	if out.TransportKind != runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND {
		return nil, status.Error(codes.InvalidArgument, "delegated transport kind must be STDIO_COMMAND")
	}
	if out.State == runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_UNSPECIFIED {
		out.State = runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_ACTIVE
	}
	if out.State != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_ACTIVE &&
		out.State != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED {
		return nil, status.Error(codes.InvalidArgument, "delegated provider state must be ACTIVE or DISABLED")
	}
	if out.TransportRef == "" {
		return nil, status.Error(codes.InvalidArgument, "transport_ref is required")
	}
	if err := validateDelegatedCredentialRef(out.CredentialRef); err != nil {
		return nil, err
	}
	if len(out.AllowedTools) == 0 {
		return nil, status.Error(codes.InvalidArgument, "delegated provider allowed_tools is required")
	}
	seen := map[string]struct{}{}
	for _, tool := range out.AllowedTools {
		if tool == nil {
			return nil, status.Error(codes.InvalidArgument, "delegated provider allowed_tools cannot contain null")
		}
		tool.ToolName = strings.TrimSpace(tool.GetToolName())
		tool.InputSchemaDigest = strings.TrimSpace(tool.GetInputSchemaDigest())
		if tool.ToolName == "" {
			return nil, status.Error(codes.InvalidArgument, "delegated provider allowed tool name is required")
		}
		if _, ok := seen[tool.ToolName]; ok {
			return nil, status.Error(codes.InvalidArgument, fmt.Sprintf("delegated provider allowed tool duplicated: %s", tool.ToolName))
		}
		seen[tool.ToolName] = struct{}{}
	}
	return out, nil
}

func validateDelegatedCredentialRef(ref string) error {
	if ref == "" {
		return nil
	}
	allowed := strings.HasPrefix(ref, "connector://") || strings.HasPrefix(ref, "key-source://") || strings.HasPrefix(ref, "grant://")
	if !allowed {
		return status.Error(codes.InvalidArgument, "credential_ref must reference Runtime credential custody")
	}
	lower := strings.ToLower(ref)
	for _, marker := range []string{"authorization:", "bearer ", "api_key=", "apikey=", "token=", "secret="} {
		if strings.Contains(lower, marker) {
			return status.Error(codes.InvalidArgument, "credential_ref must not contain raw credential material")
		}
	}
	return nil
}

func (s *Service) ensureDelegatedControlStoresLocked() {
	if s.delegatedProviderProfiles == nil {
		s.delegatedProviderProfiles = map[string]*runtimev1.DelegatedProviderProfile{}
	}
	if s.delegatedApprovalRequests == nil {
		s.delegatedApprovalRequests = map[string]*runtimev1.DelegatedApprovalRequest{}
	}
}

func (s *Service) listDelegatedProviderProfiles(agentID string) []*runtimev1.DelegatedProviderProfile {
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	out := []*runtimev1.DelegatedProviderProfile{}
	for key, profile := range s.delegatedProviderProfiles {
		if !strings.HasPrefix(key, agentID+":") {
			continue
		}
		out = append(out, proto.Clone(profile).(*runtimev1.DelegatedProviderProfile))
	}
	return out
}

func (s *Service) listDelegatedApprovalRequests(agentID string, anchorID string) []*runtimev1.DelegatedApprovalRequest {
	s.delegatedMu.RLock()
	defer s.delegatedMu.RUnlock()
	out := []*runtimev1.DelegatedApprovalRequest{}
	for key, approval := range s.delegatedApprovalRequests {
		if !strings.HasPrefix(key, agentID+":") {
			continue
		}
		if anchorID != "" && strings.TrimSpace(approval.GetConversationAnchorId()) != anchorID {
			continue
		}
		out = append(out, proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest))
	}
	return out
}

func (s *Service) listDelegatedDiagnostics(agentID string, anchorID string) []*runtimev1.DelegatedDiagnostic {
	records := s.delegatedCapabilityDecisionAuditSnapshot()
	out := make([]*runtimev1.DelegatedDiagnostic, 0, len(records))
	for _, record := range records {
		if record.AgentID != "" && record.AgentID != agentID {
			continue
		}
		if anchorID != "" && record.ConversationAnchorID != anchorID {
			continue
		}
		out = append(out, delegatedDiagnosticFromAuditRecord(agentID, record))
	}
	return out
}

func delegatedDiagnosticFromAuditRecord(agentID string, record delegatedCapabilityDecisionAuditRecord) *runtimev1.DelegatedDiagnostic {
	return &runtimev1.DelegatedDiagnostic{
		DiagnosticId:         firstNonEmpty(record.DecisionID, record.GatewayEvidenceID),
		AgentId:              agentID,
		ConversationAnchorId: record.ConversationAnchorID,
		TurnId:               record.TurnID,
		ProviderProfileId:    record.ProviderID,
		CapabilityId:         record.CapabilityID,
		ToolName:             record.ToolName,
		GatewayEvidenceId:    record.GatewayEvidenceID,
		FirewallInputId:      record.FirewallInputID,
		FirewallVerdict:      record.FirewallVerdict,
		RuntimeDecision:      record.RuntimeDecision,
		ReasonCode:           record.ReasonCode,
		ObservedAt:           timestamppb.New(record.RecordedAt.UTC()),
	}
}

func (s *Service) findDelegatedReplayAuditRecord(agentID string, decisionID string, anchorID string, turnID string) (delegatedCapabilityDecisionAuditRecord, error) {
	records := s.delegatedCapabilityDecisionAuditSnapshot()
	var matched []delegatedCapabilityDecisionAuditRecord
	for _, record := range records {
		if record.AgentID != "" && record.AgentID != agentID {
			continue
		}
		if decisionID != "" && record.DecisionID != decisionID {
			continue
		}
		if anchorID != "" && record.ConversationAnchorID != anchorID {
			continue
		}
		if turnID != "" && record.TurnID != turnID {
			continue
		}
		matched = append(matched, record)
	}
	if len(matched) == 0 {
		return delegatedCapabilityDecisionAuditRecord{}, status.Error(codes.NotFound, "delegated replay trace not found")
	}
	if decisionID == "" && len(matched) > 1 {
		return delegatedCapabilityDecisionAuditRecord{}, status.Error(codes.InvalidArgument, "delegated replay trace lookup is ambiguous without decision_id")
	}
	return matched[len(matched)-1], nil
}

func (s *Service) buildDelegatedReplayTrace(agentID string, record delegatedCapabilityDecisionAuditRecord) (*runtimev1.DelegatedReplayTrace, error) {
	if missing := missingDelegatedReplayJoinKeys(record); len(missing) > 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "delegated replay invalid lineage: missing %s", strings.Join(missing, ","))
	}
	observedAt := timestamppb.New(record.RecordedAt.UTC())
	stages := []*runtimev1.DelegatedReplayTraceStage{
		delegatedReplayStage(runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_REQUEST, record.DelegationRequestID, "recorded", "", "Runtime delegation request recorded", observedAt),
		delegatedReplayStage(runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_GATEWAY_EVIDENCE, record.GatewayEvidenceID, "quarantined", "", "Gateway evidence retained by Runtime; raw provider output is redacted", observedAt),
		delegatedReplayStage(runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_FIREWALL_VERDICT, record.FirewallInputID, record.FirewallVerdict, record.ReasonCode, "Firewall verdict recorded before Runtime decision", observedAt),
	}
	if record.RuntimeDecision == "approval_required" {
		approval := s.delegatedApprovalRequest(agentID, record.DecisionID)
		if approval == nil {
			return nil, status.Error(codes.FailedPrecondition, "delegated replay invalid lineage: missing approval_request")
		}
		stages = append(stages, delegatedReplayStage(
			runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_APPROVAL_DECISION,
			approval.GetApprovalRequestId(),
			approvalStateName(approval.GetState()),
			approval.GetReasonCode(),
			"Runtime approval request state recorded; operator note is redacted",
			approval.GetUpdatedAt(),
		))
	}
	stages = append(stages,
		delegatedReplayStage(runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_RUNTIME_DECISION, record.DecisionID, record.RuntimeDecision, record.ReasonCode, "Runtime decision recorded from firewall verdict", observedAt),
		delegatedReplayStage(runtimev1.DelegatedTraceStageKind_DELEGATED_TRACE_STAGE_KIND_PROJECTION_DISPOSITION, record.DecisionID, firstNonEmpty(record.ProjectionDisposition, "not_projected"), "", "Projection and action disposition reconstructed from Runtime decision", observedAt),
	)
	return &runtimev1.DelegatedReplayTrace{
		ReplayId:              "deleg-replay-" + record.DecisionID,
		AgentId:               agentID,
		ConversationAnchorId:  record.ConversationAnchorID,
		TurnId:                record.TurnID,
		ProviderProfileId:     record.ProviderID,
		CapabilityId:          record.CapabilityID,
		ToolName:              record.ToolName,
		Outcome:               delegatedReplayOutcome(record),
		ReasonCode:            record.ReasonCode,
		Stages:                stages,
		ProjectionDisposition: firstNonEmpty(record.ProjectionDisposition, "not_projected"),
		ActionDisposition:     firstNonEmpty(record.ActionDisposition, "not_admitted"),
		Redacted:              true,
		ObservedAt:            observedAt,
	}, nil
}

func missingDelegatedReplayJoinKeys(record delegatedCapabilityDecisionAuditRecord) []string {
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
	}
	var missing []string
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.name)
		}
	}
	return missing
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
	return runtimev1.DelegatedReplayOutcome_DELEGATED_REPLAY_OUTCOME_RECONSTRUCTED
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
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED:
		return "approved"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_REJECTED:
		return "rejected"
	case runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED:
		return "expired"
	default:
		return "unspecified"
	}
}

func delegatedProviderProfileKey(agentID string, profileID string) string {
	return strings.TrimSpace(agentID) + ":" + strings.TrimSpace(profileID)
}

func delegatedApprovalRequestKey(agentID string, approvalID string) string {
	return strings.TrimSpace(agentID) + ":" + strings.TrimSpace(approvalID)
}
