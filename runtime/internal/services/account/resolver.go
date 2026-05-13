package account

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type WorkspaceBindingDecision string

const (
	WorkspaceBindingAllow                   WorkspaceBindingDecision = "ALLOW"
	WorkspaceBindingDenyMissingAttachment   WorkspaceBindingDecision = "DENY_MISSING_ATTACHMENT"
	WorkspaceBindingDenyMalformedAttachment WorkspaceBindingDecision = "DENY_MALFORMED_ATTACHMENT"
	WorkspaceBindingDenyNotFound            WorkspaceBindingDecision = "DENY_NOT_FOUND"
	WorkspaceBindingDenyRevoked             WorkspaceBindingDecision = "DENY_REVOKED"
	WorkspaceBindingDenyExpired             WorkspaceBindingDecision = "DENY_EXPIRED"
	WorkspaceBindingDenyReplay              WorkspaceBindingDecision = "DENY_REPLAY"
	WorkspaceBindingDenyAccountUnavailable  WorkspaceBindingDecision = "DENY_ACCOUNT_UNAVAILABLE"
	WorkspaceBindingDenyCallerMismatch      WorkspaceBindingDecision = "DENY_CALLER_MISMATCH"
	WorkspaceBindingDenyWorkspaceMismatch   WorkspaceBindingDecision = "DENY_WORKSPACE_MISMATCH"
	WorkspaceBindingDenyEnvMismatch         WorkspaceBindingDecision = "DENY_ENV_MISMATCH"
	WorkspaceBindingDenyDeviceMismatch      WorkspaceBindingDecision = "DENY_DEVICE_MISMATCH"
	WorkspaceBindingDenyScopeMissing        WorkspaceBindingDecision = "DENY_SCOPE_MISSING"
)

type WorkspaceBindingResolveRequest struct {
	Caller            *runtimev1.AccountCaller
	Attachment        *runtimev1.WorkspaceBindingAttachment
	TargetWorkspaceID string
	RequiredScopes    []string
	KnowledgeAction   string
}

type WorkspaceBindingResolveResult struct {
	Decision   WorkspaceBindingDecision
	Reason     runtimev1.ReasonCode
	ActionHint string
	BindingID  string
	AccountID  string
	Relation   *runtimev1.WorkspaceBindingRelation
}

type WorkspaceBindingResolver interface {
	ResolveWorkspaceBinding(ctx context.Context, req WorkspaceBindingResolveRequest) WorkspaceBindingResolveResult
}

func (s *Service) ResolveWorkspaceBinding(_ context.Context, req WorkspaceBindingResolveRequest) WorkspaceBindingResolveResult {
	attachment := req.Attachment
	if attachment == nil {
		return workspaceBindingDeny(WorkspaceBindingDenyMissingAttachment, runtimev1.ReasonCode_WORKSPACE_BINDING_MISSING, "")
	}
	bindingID := strings.TrimSpace(attachment.GetBindingId())
	if bindingID == "" ||
		strings.TrimSpace(attachment.GetRuntimeAppId()) == "" ||
		strings.TrimSpace(attachment.GetAppInstanceId()) == "" ||
		strings.TrimSpace(attachment.GetWorkspaceId()) == "" ||
		strings.TrimSpace(req.TargetWorkspaceID) == "" {
		return workspaceBindingDeny(WorkspaceBindingDenyMalformedAttachment, runtimev1.ReasonCode_WORKSPACE_BINDING_MALFORMED, bindingID)
	}
	caller, ok := s.deriveWorkspaceBindingResolverCaller(req.Caller)
	if !ok {
		return workspaceBindingDeny(WorkspaceBindingDenyCallerMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH, bindingID)
	}
	req.Caller = caller

	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.workspaceBindings[bindingID]
	if !exists {
		return workspaceBindingDeny(WorkspaceBindingDenyNotFound, runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND, bindingID)
	}
	result := s.resolveWorkspaceBindingLocked(req, record)
	if result.Decision == WorkspaceBindingAllow {
		return result
	}
	switch result.Decision {
	case WorkspaceBindingDenyExpired:
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_EXPIRED
		record.relation.ReasonCode = runtimev1.ReasonCode_WORKSPACE_BINDING_EXPIRED
		s.workspaceBindings[bindingID] = record
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_EXPIRED, workspaceBindingAccountReason(record.relation.GetReasonCode()), bindingID)
	case WorkspaceBindingDenyReplay:
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
		record.relation.ReasonCode = runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY
		s.workspaceBindings[bindingID] = record
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REPLAY_DETECTED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY, bindingID)
	case WorkspaceBindingDenyEnvMismatch, WorkspaceBindingDenyDeviceMismatch:
		record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
		record.relation.ReasonCode = runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH
		s.workspaceBindings[bindingID] = record
		s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED, bindingID)
	case WorkspaceBindingDenyAccountUnavailable:
		if record.relation.GetState() == runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE {
			record.relation.State = runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED
			record.relation.ReasonCode = runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE
			s.workspaceBindings[bindingID] = record
			s.appendEventLocked(runtimev1.AccountEventType_ACCOUNT_EVENT_TYPE_BINDING_REVOKED, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACCOUNT_UNAVAILABLE, bindingID)
		}
	}
	return result
}

func (s *Service) resolveWorkspaceBindingLocked(req WorkspaceBindingResolveRequest, record workspaceBindingRecord) WorkspaceBindingResolveResult {
	relation := record.relation
	attachment := req.Attachment
	bindingID := strings.TrimSpace(attachment.GetBindingId())
	if relation == nil || relation.GetBindingId() == "" {
		return workspaceBindingDeny(WorkspaceBindingDenyNotFound, runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND, bindingID)
	}
	if relation.GetPurpose() != runtimev1.WorkspaceBindingPurpose_WORKSPACE_BINDING_PURPOSE_KNOWLEDGE_CONSUME {
		return workspaceBindingDeny(WorkspaceBindingDenyCallerMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH, bindingID)
	}
	if attachmentReplay(relation, attachment) {
		return workspaceBindingDeny(WorkspaceBindingDenyReplay, runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY, bindingID)
	}
	switch relation.GetState() {
	case runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_REVOKED:
		return workspaceBindingDeny(WorkspaceBindingDenyRevoked, runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED, bindingID)
	case runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_EXPIRED:
		return workspaceBindingDeny(WorkspaceBindingDenyExpired, runtimev1.ReasonCode_WORKSPACE_BINDING_EXPIRED, bindingID)
	case runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE:
	default:
		return workspaceBindingDeny(WorkspaceBindingDenyRevoked, runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED, bindingID)
	}
	if s.state != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		return workspaceBindingDeny(WorkspaceBindingDenyAccountUnavailable, runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, bindingID)
	}
	if s.accountMaterialExpiredLocked() {
		s.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_EXPIRED
		return workspaceBindingDeny(WorkspaceBindingDenyAccountUnavailable, runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, bindingID)
	}
	now := s.now().UTC()
	if expires := relation.GetExpiresAt().AsTime(); !expires.IsZero() && !expires.After(now) {
		return workspaceBindingDeny(WorkspaceBindingDenyExpired, runtimev1.ReasonCode_WORKSPACE_BINDING_EXPIRED, bindingID)
	}
	if strings.TrimSpace(req.Caller.GetAppId()) != strings.TrimSpace(relation.GetRuntimeAppId()) ||
		strings.TrimSpace(req.Caller.GetAppInstanceId()) != strings.TrimSpace(relation.GetAppInstanceId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyCallerMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH, bindingID)
	}
	if strings.TrimSpace(req.Caller.GetDeviceId()) != strings.TrimSpace(relation.GetDeviceId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyDeviceMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH, bindingID)
	}
	if strings.TrimSpace(s.material.AccountID) != strings.TrimSpace(relation.GetAccountId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyAccountUnavailable, runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, bindingID)
	}
	if strings.TrimSpace(s.material.RealmEnvironmentID) != strings.TrimSpace(relation.GetRealmEnvironmentId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyEnvMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH, bindingID)
	}
	if strings.TrimSpace(req.TargetWorkspaceID) != strings.TrimSpace(relation.GetWorkspaceId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyWorkspaceMismatch, runtimev1.ReasonCode_WORKSPACE_BINDING_WORKSPACE_MISMATCH, bindingID)
	}
	if !s.hasActiveWorkspaceMembershipLocked(relation.GetWorkspaceId(), relation.GetRealmEnvironmentId()) {
		return workspaceBindingDeny(WorkspaceBindingDenyAccountUnavailable, runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE, bindingID)
	}
	if !workspaceScopesCover(relation.GetScopes(), req.RequiredScopes) {
		return workspaceBindingDeny(WorkspaceBindingDenyScopeMissing, runtimev1.ReasonCode_WORKSPACE_BINDING_SCOPE_MISSING, bindingID)
	}
	return WorkspaceBindingResolveResult{
		Decision:   WorkspaceBindingAllow,
		Reason:     runtimev1.ReasonCode_ACTION_EXECUTED,
		ActionHint: "",
		BindingID:  bindingID,
		AccountID:  relation.GetAccountId(),
		Relation:   cloneWorkspaceRelation(relation),
	}
}

func workspaceBindingDeny(decision WorkspaceBindingDecision, reason runtimev1.ReasonCode, bindingID string) WorkspaceBindingResolveResult {
	return WorkspaceBindingResolveResult{
		Decision:   decision,
		Reason:     reason,
		ActionHint: workspaceBindingActionHint(reason),
		BindingID:  strings.TrimSpace(bindingID),
	}
}

func workspaceBindingActionHint(reason runtimev1.ReasonCode) string {
	switch reason {
	case runtimev1.ReasonCode_WORKSPACE_BINDING_MISSING:
		return "attach_workspace_binding"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_MALFORMED:
		return "reissue_workspace_binding"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND,
		runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED,
		runtimev1.ReasonCode_WORKSPACE_BINDING_EXPIRED,
		runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY:
		return "reissue_workspace_binding"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE:
		return "refresh_account_membership"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH:
		return "use_caller_owned_binding"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_WORKSPACE_MISMATCH:
		return "attach_matching_workspace_binding"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH:
		return "reissue_workspace_binding_on_current_device"
	case runtimev1.ReasonCode_WORKSPACE_BINDING_SCOPE_MISSING:
		return "reissue_workspace_binding_with_required_scope"
	default:
		return ""
	}
}

func attachmentReplay(relation *runtimev1.WorkspaceBindingRelation, attachment *runtimev1.WorkspaceBindingAttachment) bool {
	if relation == nil || attachment == nil {
		return true
	}
	if strings.TrimSpace(relation.GetBindingId()) != strings.TrimSpace(attachment.GetBindingId()) ||
		strings.TrimSpace(relation.GetRuntimeAppId()) != strings.TrimSpace(attachment.GetRuntimeAppId()) ||
		strings.TrimSpace(relation.GetAppInstanceId()) != strings.TrimSpace(attachment.GetAppInstanceId()) ||
		strings.TrimSpace(relation.GetWorkspaceId()) != strings.TrimSpace(attachment.GetWorkspaceId()) {
		return true
	}
	if env := strings.TrimSpace(attachment.GetRealmEnvironmentId()); env != "" && env != strings.TrimSpace(relation.GetRealmEnvironmentId()) {
		return true
	}
	return false
}
