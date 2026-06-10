package runtimeagent

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/delegation"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) ExecuteDelegatedCapability(ctx context.Context, req *runtimev1.ExecuteDelegatedCapabilityRequest) (*runtimev1.ExecuteDelegatedCapabilityResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	anchorID := strings.TrimSpace(req.GetConversationAnchorId())
	if anchorID == "" {
		return nil, status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	turnID := strings.TrimSpace(req.GetTurnId())
	if turnID == "" {
		return nil, status.Error(codes.InvalidArgument, "turn_id is required")
	}
	arguments, err := delegatedCapabilityArgumentsJSON(req.GetArguments())
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "delegated capability arguments invalid: %v", err)
	}
	session, err := s.delegatedExecutionSession(req.GetContext(), agentID, anchorID)
	if err != nil {
		return nil, err
	}
	turn := publicChatTurnState{
		ConversationAnchorID: anchorID,
		TurnID:               turnID,
		StreamID:             strings.TrimSpace(req.GetStreamId()),
		RequestID:            strings.TrimSpace(req.GetRequestId()),
		AgentID:              agentID,
	}
	decision, err := s.publicChatRuntime().executeDelegatedCapability(ctx, session, turn, runtimeAgentDelegatedCapabilityRequest{
		ProviderID:       strings.TrimSpace(req.GetProviderProfileId()),
		CapabilityID:     strings.TrimSpace(req.GetCapabilityId()),
		ToolName:         strings.TrimSpace(req.GetToolName()),
		Arguments:        arguments,
		DescriptorHash:   strings.TrimSpace(req.GetDescriptorHash()),
		ProtocolRevision: strings.TrimSpace(req.GetProtocolRevision()),
		OutputKind:       firstNonEmpty(strings.TrimSpace(req.GetOutputKind()), delegation.OutputKindObservation),
		RequiresApproval: req.GetRequiresApproval(),
	})
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "delegated capability execution failed: %v", err)
	}
	record, err := s.findDelegatedReplayAuditRecord(agentID, decision.DecisionID, anchorID, turnID)
	if err != nil {
		return nil, err
	}
	trace, err := s.buildDelegatedReplayTrace(agentID, record)
	if err != nil {
		return nil, err
	}
	modelOutput, err := delegatedModelOutputStruct(decision.ModelOutputJSON)
	if err != nil {
		return nil, status.Errorf(codes.FailedPrecondition, "delegated capability model output invalid: %v", err)
	}
	approval, err := s.delegatedApprovalRequestForExecutionResponse(agentID, record)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteDelegatedCapabilityResponse{
		Diagnostic:      delegatedDiagnosticFromAuditRecord(agentID, record),
		ReplayTrace:     trace,
		ModelOutput:     modelOutput,
		ApprovalRequest: approval,
	}, nil
}

func (s *Service) ResumeDelegatedCapability(ctx context.Context, req *runtimev1.ResumeDelegatedCapabilityRequest) (*runtimev1.ResumeDelegatedCapabilityResponse, error) {
	agentID, err := s.validateDelegatedControlRequest(req.GetContext(), req.GetAgentId(), "runtime.agent.delegation.write")
	if err != nil {
		return nil, err
	}
	approvalID := strings.TrimSpace(req.GetApprovalRequestId())
	if approvalID == "" {
		return nil, status.Error(codes.InvalidArgument, "approval_request_id is required")
	}
	paused, _, err := s.loadApprovedDelegatedPausedRequest(req.GetContext(), agentID, approvalID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	session, err := s.delegatedExecutionSession(req.GetContext(), agentID, paused.ConversationAnchorID)
	if err != nil {
		return nil, err
	}
	paused, approval, err := s.claimApprovedDelegatedPausedRequest(req.GetContext(), agentID, approvalID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	if paused.Mode == delegatedPausedModePostFirewall {
		decision, err := runtimeAgentDecisionFromApprovedPausedRequest(paused)
		if err != nil {
			_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
			return nil, status.Errorf(codes.FailedPrecondition, "delegated capability resume failed: %v", err)
		}
		s.recordDelegatedCapabilityDecision(decision)
		record, err := s.findDelegatedReplayAuditRecord(agentID, decision.DecisionID, paused.ConversationAnchorID, paused.TurnID)
		if err != nil {
			_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
			return nil, err
		}
		trace, err := s.buildDelegatedReplayTrace(agentID, record)
		if err != nil {
			_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
			return nil, err
		}
		modelOutput, err := delegatedModelOutputStruct(decision.ModelOutputJSON)
		if err != nil {
			_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
			return nil, status.Errorf(codes.FailedPrecondition, "delegated capability model output invalid: %v", err)
		}
		if err := s.finalizeDelegatedPausedRequest(agentID, approvalID); err != nil {
			return nil, err
		}
		return &runtimev1.ResumeDelegatedCapabilityResponse{
			Diagnostic:      delegatedDiagnosticFromAuditRecord(agentID, record),
			ReplayTrace:     trace,
			ModelOutput:     modelOutput,
			ApprovalRequest: approval,
		}, nil
	}
	resumeRequest := cloneRuntimeAgentDelegatedCapabilityRequest(paused.Request)
	resumeRequest.RequiresApproval = false
	turn := publicChatTurnState{
		ConversationAnchorID: paused.ConversationAnchorID,
		TurnID:               paused.TurnID,
		StreamID:             paused.StreamID,
		RequestID:            paused.RequestID,
		AgentID:              agentID,
	}
	decision, err := s.publicChatRuntime().executeDelegatedCapability(ctx, session, turn, resumeRequest)
	if err != nil {
		_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
		return nil, status.Errorf(codes.FailedPrecondition, "delegated capability resume failed: %v", err)
	}
	record, err := s.findDelegatedReplayAuditRecord(agentID, decision.DecisionID, paused.ConversationAnchorID, paused.TurnID)
	if err != nil {
		_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
		return nil, err
	}
	trace, err := s.buildDelegatedReplayTrace(agentID, record)
	if err != nil {
		_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
		return nil, err
	}
	modelOutput, err := delegatedModelOutputStruct(decision.ModelOutputJSON)
	if err != nil {
		_ = s.releaseDelegatedPausedRequestClaim(agentID, approvalID)
		return nil, status.Errorf(codes.FailedPrecondition, "delegated capability model output invalid: %v", err)
	}
	if err := s.finalizeDelegatedPausedRequest(agentID, approvalID); err != nil {
		return nil, err
	}
	if newApproval, err := s.delegatedApprovalRequestForExecutionResponse(agentID, record); err != nil {
		return nil, err
	} else if newApproval != nil {
		approval = newApproval
	}
	return &runtimev1.ResumeDelegatedCapabilityResponse{
		Diagnostic:      delegatedDiagnosticFromAuditRecord(agentID, record),
		ReplayTrace:     trace,
		ModelOutput:     modelOutput,
		ApprovalRequest: approval,
	}, nil
}

func runtimeAgentDecisionFromApprovedPausedRequest(paused *runtimeAgentPausedDelegatedCapabilityRequest) (*runtimeAgentDelegatedCapabilityDecision, error) {
	if paused == nil {
		return nil, status.Error(codes.FailedPrecondition, "delegated paused request not found")
	}
	if len(paused.ModelOutputJSON) == 0 {
		return nil, status.Error(codes.FailedPrecondition, "delegated paused request missing cached model output")
	}
	now := time.Now().UTC()
	return &runtimeAgentDelegatedCapabilityDecision{
		DecisionID:           "deleg-decision-" + strings.TrimPrefix(paused.ApprovalRequestID, "deleg-decision-") + "-resume-" + strings.ReplaceAll(now.Format("20060102150405.000000000"), ".", ""),
		AgentID:              strings.TrimSpace(paused.AgentID),
		DelegationRequestID:  firstNonEmpty(strings.TrimSpace(paused.DelegationRequestID), strings.TrimSpace(paused.RequestID), strings.TrimSpace(paused.TurnID)),
		DelegationResultID:   strings.TrimSpace(paused.DelegationResultID),
		TurnID:               strings.TrimSpace(paused.TurnID),
		StreamID:             strings.TrimSpace(paused.StreamID),
		ConversationAnchorID: strings.TrimSpace(paused.ConversationAnchorID),
		ProviderID:           strings.TrimSpace(paused.Request.ProviderID),
		CapabilityID:         strings.TrimSpace(paused.Request.CapabilityID),
		ToolName:             strings.TrimSpace(paused.Request.ToolName),
		DescriptorHash:       strings.TrimSpace(paused.Request.DescriptorHash),
		PolicySnapshotID:     delegatedApprovalPolicySnapshotID(paused.Request.ProviderID, paused.Request.CapabilityID, paused.Request.ToolName, paused.Request.DescriptorHash),
		GatewayEvidenceID:    strings.TrimSpace(paused.GatewayEvidenceID),
		FirewallInputID:      strings.TrimSpace(paused.FirewallInputID),
		FirewallVerdict:      strings.TrimSpace(paused.FirewallVerdict),
		ReasonCode:           strings.TrimSpace(paused.ReasonCode),
		RuntimeDecision:      firstNonEmpty(strings.TrimSpace(paused.RuntimeDecision), runtimeDecisionForApprovedDelegatedOutputKind(paused.Request.OutputKind)),
		ModelOutputJSON:      cloneJSONRawMessage(paused.ModelOutputJSON),
		DecidedAt:            now,
	}, nil
}

func (s *Service) delegatedExecutionSession(ctx *runtimev1.AgentRequestContext, agentID string, anchorID string) (publicChatAnchorState, error) {
	if s == nil {
		return publicChatAnchorState{}, status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	callerAppID := strings.TrimSpace(ctx.GetAppId())
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatAnchors[anchorID]
	if session == nil {
		return publicChatAnchorState{}, status.Error(codes.NotFound, "conversation_anchor_id not found")
	}
	if strings.TrimSpace(session.AgentID) != agentID {
		return publicChatAnchorState{}, status.Error(codes.FailedPrecondition, "public chat anchor agent mismatch")
	}
	if callerAppID != "" && strings.TrimSpace(session.CallerAppID) != callerAppID {
		return publicChatAnchorState{}, status.Error(codes.PermissionDenied, "public chat anchor caller mismatch")
	}
	return *session, nil
}

func (s *Service) loadApprovedDelegatedPausedRequest(
	ctx *runtimev1.AgentRequestContext,
	agentID string,
	approvalID string,
	now time.Time,
) (*runtimeAgentPausedDelegatedCapabilityRequest, *runtimev1.DelegatedApprovalRequest, error) {
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.ensureDelegatedControlStoresLocked()
	approval := s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)]
	if approval == nil {
		return nil, nil, status.Error(codes.NotFound, "delegated approval request not found")
	}
	if approval.GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED {
		return nil, nil, status.Error(codes.FailedPrecondition, "delegated approval request is not approved")
	}
	if err := s.validateDelegatedApprovalResumeLocked(ctx, agentID, approval, now); err != nil {
		return nil, nil, s.persistDelegatedApprovalExpiryIfNeededLocked(approval, err)
	}
	paused := s.delegatedPausedRequests[delegatedApprovalRequestKey(agentID, approvalID)]
	if paused == nil {
		return nil, nil, status.Error(codes.FailedPrecondition, "delegated paused request not found")
	}
	return cloneRuntimeAgentPausedDelegatedCapabilityRequest(paused), proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest), nil
}

func (s *Service) claimApprovedDelegatedPausedRequest(
	ctx *runtimev1.AgentRequestContext,
	agentID string,
	approvalID string,
	now time.Time,
) (*runtimeAgentPausedDelegatedCapabilityRequest, *runtimev1.DelegatedApprovalRequest, error) {
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.ensureDelegatedControlStoresLocked()
	key := delegatedApprovalRequestKey(agentID, approvalID)
	approval := s.delegatedApprovalRequests[key]
	if approval == nil {
		return nil, nil, status.Error(codes.NotFound, "delegated approval request not found")
	}
	if approval.GetState() != runtimev1.DelegatedApprovalRequestState_DELEGATED_APPROVAL_REQUEST_STATE_APPROVED {
		return nil, nil, status.Error(codes.FailedPrecondition, "delegated approval request is not approved")
	}
	if err := s.validateDelegatedApprovalResumeLocked(ctx, agentID, approval, now); err != nil {
		return nil, nil, s.persistDelegatedApprovalExpiryIfNeededLocked(approval, err)
	}
	paused := s.delegatedPausedRequests[key]
	if paused == nil {
		return nil, nil, status.Error(codes.FailedPrecondition, "delegated paused request not found")
	}
	if paused.ResumeState == delegatedResumeStateExecuting {
		return nil, nil, status.Error(codes.FailedPrecondition, "delegated paused request is already resuming")
	}
	paused = cloneRuntimeAgentPausedDelegatedCapabilityRequest(paused)
	paused.ResumeState = delegatedResumeStateExecuting
	s.delegatedPausedRequests[key] = paused
	if err := s.persistDelegatedControlStateLocked(); err != nil {
		paused.ResumeState = delegatedResumeStatePending
		s.delegatedPausedRequests[key] = paused
		return nil, nil, status.Errorf(codes.FailedPrecondition, "delegated paused request claim persistence failed: %v", err)
	}
	return cloneRuntimeAgentPausedDelegatedCapabilityRequest(paused), proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest), nil
}

func (s *Service) releaseDelegatedPausedRequestClaim(agentID string, approvalID string) error {
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.ensureDelegatedControlStoresLocked()
	key := delegatedApprovalRequestKey(agentID, approvalID)
	paused := s.delegatedPausedRequests[key]
	if paused == nil {
		return nil
	}
	paused = cloneRuntimeAgentPausedDelegatedCapabilityRequest(paused)
	paused.ResumeState = delegatedResumeStatePending
	s.delegatedPausedRequests[key] = paused
	if err := s.persistDelegatedControlStateLocked(); err != nil {
		return status.Errorf(codes.FailedPrecondition, "delegated paused request release persistence failed: %v", err)
	}
	return nil
}

func (s *Service) finalizeDelegatedPausedRequest(agentID string, approvalID string) error {
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.ensureDelegatedControlStoresLocked()
	key := delegatedApprovalRequestKey(agentID, approvalID)
	previous := cloneRuntimeAgentPausedDelegatedCapabilityRequest(s.delegatedPausedRequests[key])
	delete(s.delegatedPausedRequests, key)
	if err := s.persistDelegatedControlStateLocked(); err != nil {
		if previous != nil {
			s.delegatedPausedRequests[key] = previous
		}
		return status.Errorf(codes.FailedPrecondition, "delegated paused request finalize persistence failed: %v", err)
	}
	return nil
}

func delegatedCapabilityArgumentsJSON(args *structpb.Struct) (json.RawMessage, error) {
	if args == nil {
		return json.RawMessage(`{}`), nil
	}
	raw, err := json.Marshal(args.AsMap())
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	return json.RawMessage(raw), nil
}

func (s *Service) delegatedApprovalRequestForExecutionResponse(agentID string, record delegatedCapabilityDecisionAuditRecord) (*runtimev1.DelegatedApprovalRequest, error) {
	if strings.TrimSpace(record.RuntimeDecision) != "approval_required" {
		return nil, nil
	}
	approvalID := strings.TrimSpace(record.DecisionID)
	if approvalID == "" {
		return nil, status.Error(codes.FailedPrecondition, "delegated approval decision id missing")
	}
	s.delegatedMu.Lock()
	defer s.delegatedMu.Unlock()
	s.ensureDelegatedControlStoresLocked()
	approval := s.delegatedApprovalRequests[delegatedApprovalRequestKey(agentID, approvalID)]
	if approval == nil {
		return nil, status.Error(codes.FailedPrecondition, "delegated approval request missing")
	}
	return proto.Clone(approval).(*runtimev1.DelegatedApprovalRequest), nil
}

func delegatedModelOutputStruct(raw json.RawMessage) (*structpb.Struct, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return structpb.NewStruct(payload)
}
