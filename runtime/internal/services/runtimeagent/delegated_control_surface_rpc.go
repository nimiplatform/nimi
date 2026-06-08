package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const defaultDelegatedApprovalTTL = 15 * time.Minute

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
	existing := s.delegatedProviderProfiles[key]
	if existing != nil && existing.GetCreatedAt() != nil {
		profile.CreatedAt = cloneTimestamp(existing.GetCreatedAt())
	} else {
		profile.CreatedAt = timestamppb.New(now)
	}
	profile.UpdatedAt = timestamppb.New(now)
	s.delegatedProviderProfiles[key] = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	if err := s.rebuildDelegatedGatewayLocked(); err != nil {
		if existing != nil {
			s.delegatedProviderProfiles[key] = proto.Clone(existing).(*runtimev1.DelegatedProviderProfile)
		} else {
			delete(s.delegatedProviderProfiles, key)
		}
		s.delegatedMu.Unlock()
		return nil, status.Errorf(codes.InvalidArgument, "delegated provider profile cannot configure gateway: %v", err)
	}
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
	if !isAdmittedDelegatedProviderState(req.GetState()) {
		return nil, status.Error(codes.InvalidArgument, "delegated provider state is not admitted")
	}
	lifecycleReasonCode := strings.TrimSpace(req.GetLifecycleReasonCode())
	if delegatedStateRequiresLifecycleReason(req.GetState()) && lifecycleReasonCode == "" {
		return nil, status.Error(codes.InvalidArgument, "lifecycle_reason_code is required for delegated provider degraded, disabled, or quarantined states")
	}
	s.delegatedMu.Lock()
	s.ensureDelegatedControlStoresLocked()
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, profileID)]
	if profile == nil {
		s.delegatedMu.Unlock()
		return nil, status.Error(codes.NotFound, "delegated provider profile not found")
	}
	if req.GetState() == runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY {
		if profile.GetTrustTier() == runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_BLOCKED {
			s.delegatedMu.Unlock()
			return nil, status.Error(codes.InvalidArgument, "blocked delegated provider cannot be READY")
		}
		if strings.TrimSpace(profile.GetCommand()) == "" {
			s.delegatedMu.Unlock()
			return nil, status.Error(codes.InvalidArgument, "READY stdio delegated provider requires command")
		}
	}
	previous := proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	profile = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	profile.State = req.GetState()
	if lifecycleReasonCode != "" {
		profile.LifecycleReasonCode = lifecycleReasonCode
	} else if !delegatedStateRequiresLifecycleReason(req.GetState()) {
		profile.LifecycleReasonCode = ""
	}
	profile.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, profileID)] = proto.Clone(profile).(*runtimev1.DelegatedProviderProfile)
	if err := s.rebuildDelegatedGatewayLocked(); err != nil {
		s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, profileID)] = previous
		s.delegatedMu.Unlock()
		return nil, status.Errorf(codes.InvalidArgument, "delegated provider state cannot configure gateway: %v", err)
	}
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
	var nextState runtimev1.DelegatedApprovalRequestState
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
	if err := s.validateDelegatedApprovalResumeLocked(req.GetContext(), agentID, approval, time.Now().UTC()); err != nil {
		s.delegatedMu.Unlock()
		return nil, err
	}
	approval = proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	approval.State = nextState
	approval.UpdatedAt = timestamppb.New(time.Now().UTC())
	s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)] = proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	out := proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest)
	s.delegatedMu.Unlock()

	// K-DELEG-095 / K-DELEG-097: every approval decision (APPROVE and REJECT)
	// must be audited and observable, linked to delegation/provider/capability/
	// principal lineage. Emitted after the lock is released, mirroring the
	// orchestration decision-recording path.
	s.appendDelegatedApprovalDecisionAuditEvent(agentID, out, delegatedApprovalPrincipalID(req.GetContext()))
	return &runtimev1.SubmitDelegatedApprovalDecisionResponse{ApprovalRequest: out}, nil
}

func (s *Service) validateDelegatedApprovalResumeLocked(ctx *runtimev1.AgentRequestContext, agentID string, approval *runtimev1.DelegatedApprovalRequest, now time.Time) error {
	if approval == nil {
		return status.Error(codes.NotFound, "delegated approval request not found")
	}
	if approval.GetExpiresAt() == nil {
		return status.Error(codes.FailedPrecondition, "delegated approval request expiry is required")
	}
	if !approval.GetExpiresAt().AsTime().After(now) {
		approval.State = runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_EXPIRED
		approval.UpdatedAt = timestamppb.New(now)
		return status.Error(codes.FailedPrecondition, "delegated approval request expired")
	}
	fields := approval.GetDetail().GetFields()
	descriptorHash := structStringField(fields, "descriptor_hash")
	policySnapshotID := structStringField(fields, "policy_snapshot_id")
	principalID := structStringField(fields, "principal_id")
	if descriptorHash == "" || policySnapshotID == "" || principalID == "" {
		return status.Error(codes.FailedPrecondition, "delegated approval request missing policy snapshot, descriptor, or principal lineage")
	}
	currentPrincipal := delegatedApprovalPrincipalID(ctx)
	if currentPrincipal == "" || currentPrincipal != principalID {
		return status.Error(codes.PermissionDenied, "delegated approval principal is not authorized for this request")
	}
	profile := s.delegatedProviderProfiles[delegatedProviderProfileKey(agentID, approval.GetProviderProfileId())]
	if profile == nil {
		return status.Error(codes.FailedPrecondition, "delegated approval provider profile is unavailable")
	}
	if profile.GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY {
		return status.Error(codes.FailedPrecondition, "delegated approval provider profile is not ready")
	}
	currentDescriptor := delegatedProviderToolDescriptorHash(profile, approval.GetToolName())
	if currentDescriptor == "" {
		return status.Error(codes.FailedPrecondition, "delegated approval capability descriptor is unavailable")
	}
	if currentDescriptor != descriptorHash {
		return status.Error(codes.FailedPrecondition, "delegated approval descriptor drifted")
	}
	expectedPolicySnapshotID := delegatedApprovalPolicySnapshotID(
		approval.GetProviderProfileId(),
		approval.GetCapabilityId(),
		approval.GetToolName(),
		descriptorHash,
	)
	if policySnapshotID != expectedPolicySnapshotID {
		return status.Error(codes.FailedPrecondition, "delegated approval policy snapshot drifted")
	}
	return nil
}

func delegatedApprovalPrincipalID(ctx *runtimev1.AgentRequestContext) string {
	if ctx == nil {
		return ""
	}
	return firstNonEmpty(strings.TrimSpace(ctx.GetSubjectUserId()), strings.TrimSpace(ctx.GetAppId()))
}

func delegatedApprovalPolicySnapshotID(providerID string, capabilityID string, toolName string, descriptorHash string) string {
	providerID = strings.TrimSpace(providerID)
	capabilityID = strings.TrimSpace(capabilityID)
	toolName = strings.TrimSpace(toolName)
	descriptorHash = strings.TrimSpace(descriptorHash)
	if providerID == "" || capabilityID == "" || toolName == "" || descriptorHash == "" {
		return ""
	}
	return strings.Join([]string{"deleg-policy", providerID, capabilityID, toolName, descriptorHash}, ":")
}

func delegatedProviderToolDescriptorHash(profile *runtimev1.DelegatedProviderProfile, toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if profile == nil || toolName == "" {
		return ""
	}
	for _, tool := range profile.GetAllowedTools() {
		if strings.TrimSpace(tool.GetToolName()) == toolName {
			return strings.TrimSpace(tool.GetInputSchemaDigest())
		}
	}
	return ""
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
	out.LifecycleReasonCode = strings.TrimSpace(out.GetLifecycleReasonCode())
	out.Command = strings.TrimSpace(out.GetCommand())
	out.Args = normalizeStringList(out.GetArgs())
	if out.ProviderProfileId == "" {
		return nil, status.Error(codes.InvalidArgument, "provider_profile_id is required")
	}
	if out.ProviderKind != runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER {
		return nil, status.Error(codes.InvalidArgument, "delegated provider kind must be MCP_TOOL_PROVIDER")
	}
	if out.TransportKind != runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND {
		return nil, status.Error(codes.InvalidArgument, "delegated transport kind must be STDIO_COMMAND")
	}
	if out.TrustTier == runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_UNSPECIFIED {
		return nil, status.Error(codes.InvalidArgument, "delegated provider trust_tier is required")
	}
	if out.State == runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_UNSPECIFIED {
		out.State = runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REGISTERED
	}
	if !isAdmittedDelegatedProviderState(out.State) {
		return nil, status.Error(codes.InvalidArgument, "delegated provider state is not admitted")
	}
	if out.TrustTier == runtimev1.DelegatedProviderTrustTier_DELEGATED_PROVIDER_TRUST_TIER_BLOCKED &&
		out.State == runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY {
		return nil, status.Error(codes.InvalidArgument, "blocked delegated provider cannot be READY")
	}
	if out.TransportRef == "" {
		return nil, status.Error(codes.InvalidArgument, "transport_ref is required")
	}
	if out.State == runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY && out.Command == "" {
		return nil, status.Error(codes.InvalidArgument, "READY stdio delegated provider requires command")
	}
	if delegatedStateRequiresLifecycleReason(out.State) && out.LifecycleReasonCode == "" {
		return nil, status.Error(codes.InvalidArgument, "lifecycle_reason_code is required for delegated provider degraded, disabled, or quarantined states")
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

func isAdmittedDelegatedProviderState(state runtimev1.DelegatedProviderState) bool {
	switch state {
	case runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REGISTERED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISCOVERING,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DEGRADED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_QUARANTINED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_REMOVED:
		return true
	default:
		return false
	}
}

func delegatedStateRequiresLifecycleReason(state runtimev1.DelegatedProviderState) bool {
	switch state {
	case runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DEGRADED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_DISABLED,
		runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_QUARANTINED:
		return true
	default:
		return false
	}
}

func normalizeStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func (s *Service) rebuildDelegatedGatewayLocked() error {
	if s == nil {
		return nil
	}
	var profiles []delegation.ProviderProfile
	for _, profile := range s.delegatedProviderProfiles {
		if profile.GetState() != runtimev1.DelegatedProviderState_DELEGATED_PROVIDER_STATE_READY {
			continue
		}
		converted, err := delegatedGatewayProfileFromProto(profile)
		if err != nil {
			return err
		}
		profiles = append(profiles, converted)
	}
	opts := []delegation.Option{}
	if s.delegatedTransportFactory != nil {
		opts = append(opts, delegation.WithTransportFactory(s.delegatedTransportFactory))
	}
	gateway, err := delegation.NewGateway(profiles, opts...)
	if err != nil {
		return err
	}
	firewall := s.delegatedFirewall
	if firewall == nil {
		var firewallErr error
		firewall, firewallErr = delegation.NewFirewall(delegation.FirewallPolicy{})
		if firewallErr != nil {
			return firewallErr
		}
	}
	s.delegatedGateway = gateway
	s.delegatedFirewall = firewall
	return nil
}

func delegatedGatewayProfileFromProto(profile *runtimev1.DelegatedProviderProfile) (delegation.ProviderProfile, error) {
	if profile == nil {
		return delegation.ProviderProfile{}, fmt.Errorf("nil delegated provider profile")
	}
	if profile.GetProviderKind() != runtimev1.DelegatedProviderKind_DELEGATED_PROVIDER_KIND_MCP_TOOL_PROVIDER {
		return delegation.ProviderProfile{}, fmt.Errorf("provider %q is not an MCP tool provider", profile.GetProviderProfileId())
	}
	if profile.GetTransportKind() != runtimev1.DelegatedTransportKind_DELEGATED_TRANSPORT_KIND_STDIO_COMMAND {
		return delegation.ProviderProfile{}, fmt.Errorf("provider %q must use stdio command transport", profile.GetProviderProfileId())
	}
	timeout := time.Duration(0)
	if profile.GetTimeout() != nil {
		timeout = profile.GetTimeout().AsDuration()
	}
	allowed := make([]delegation.ToolAllowlistEntry, 0, len(profile.GetAllowedTools()))
	for _, tool := range profile.GetAllowedTools() {
		allowed = append(allowed, delegation.ToolAllowlistEntry{
			Name:              strings.TrimSpace(tool.GetToolName()),
			InputSchemaDigest: strings.TrimSpace(tool.GetInputSchemaDigest()),
		})
	}
	return delegation.ProviderProfile{
		ID:            strings.TrimSpace(profile.GetProviderProfileId()),
		Name:          strings.TrimSpace(profile.GetDisplayName()),
		ProviderKind:  delegation.ProviderKindMCPToolProvider,
		TransportKind: delegation.TransportKindStdioCommand,
		State:         delegation.ProviderStateReady,
		Command:       strings.TrimSpace(profile.GetCommand()),
		Args:          append([]string(nil), profile.GetArgs()...),
		AllowedTools:  allowed,
		Timeout:       timeout,
	}, nil
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
