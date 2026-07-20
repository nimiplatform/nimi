package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	avatarDebugReadScope  = "runtime.agent.avatar_debug.read"
	avatarDebugWriteScope = "runtime.agent.avatar_debug.write"

	avatarDebugAuditDomain            = "runtime.agent.avatar_debug"
	avatarDebugRequestOperation       = "runtime.agent.avatar_debug.probe_requested"
	avatarDebugResultOperation        = "runtime.agent.avatar_debug.probe_result"
	avatarDebugReplayLinkOperation    = "runtime.agent.avatar_debug.replay_linked"
	avatarDebugSessionUnavailable     = "avatar_debug_session_not_available"
	avatarDebugAuthorizationVerdict   = "PASS"
	avatarDebugAuthorizationRefPrefix = "runtime.audit.avatar_debug.authorization/"
	avatarDebugProjectionRefPrefix    = "runtime.agent.avatar_debug.projection/"
	avatarDebugReplayRefPrefix        = "runtime.audit.avatar_debug.replay/"
	avatarDebugRequestAuditRefPrefix  = "runtime.audit.avatar_debug.request/"
	avatarDebugResultAuditRefPrefix   = "runtime.audit.avatar_debug.result/"
)

func (s *Service) GetAvatarDebugSnapshot(ctx context.Context, req *runtimev1.GetAvatarDebugSnapshotRequest) (*runtimev1.GetAvatarDebugSnapshotResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
	if err != nil {
		return nil, err
	}
	results, replays, err := s.listAvatarDebugAuditProjection(agentID, anchorID, runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAvatarDebugSnapshotResponse{
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeResults:         results,
		ReplayRefs:           replays,
		ObservedAt:           timestamppb.New(time.Now().UTC()),
	}, nil
}

func (s *Service) RequestAvatarDebugProbe(ctx context.Context, req *runtimev1.RequestAvatarDebugProbeRequest) (*runtimev1.RequestAvatarDebugProbeResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugWriteScope)
	if err != nil {
		return nil, err
	}
	if !isAdmittedAvatarDebugProbeKind(req.GetProbeKind()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug probe_kind is not admitted")
	}
	if !isAdmittedAvatarDebugRequestedBy(req.GetRequestedBy()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug requested_by is not admitted")
	}
	probeID := strings.TrimSpace(req.GetProbeId())
	if probeID == "" {
		probeID = "avatar-debug-probe-" + ulid.Make().String()
	}
	now := time.Now().UTC()
	visibility := runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_RUNTIME_AUDIT_ONLY
	if req.GetReplayRequested() {
		visibility = runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_DESKTOP_DEBUG_WORKBENCH
	}
	replay := &runtimev1.AvatarDebugReplayRef{
		ProbeId:        probeID,
		ReplayRef:      avatarDebugReplayRefPrefix + probeID,
		RedactionState: runtimev1.AvatarDebugReplayRedactionState_AVATAR_DEBUG_REPLAY_REDACTION_STATE_VISIBLE,
		Visibility:     visibility,
		LinkedAt:       timestamppb.New(now),
	}
	request := &runtimev1.AvatarDebugProbeRequestEnvelope{
		ProbeId:              probeID,
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            req.GetProbeKind(),
		RequestedAt:          timestamppb.New(now),
		RequestedBy:          req.GetRequestedBy(),
		TurnId:               strings.TrimSpace(req.GetTurnId()),
		StreamId:             strings.TrimSpace(req.GetStreamId()),
		AvatarInstanceId:     strings.TrimSpace(req.GetAvatarInstanceId()),
		RuntimeReplayRef:     replay.GetReplayRef(),
		ReplayRequested:      req.GetReplayRequested(),
		ScopedBinding:        cloneScopedBindingAttachment(req.GetContext().GetScopedBinding()),
	}
	result := &runtimev1.AvatarDebugProbeResultEnvelope{
		ProbeId:              probeID,
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            req.GetProbeKind(),
		Status:               runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_BLOCKED,
		ObservedAt:           timestamppb.New(now),
		EvidenceRefs: []string{
			avatarDebugAuthorizationRefPrefix + probeID,
			avatarDebugRequestAuditRefPrefix + probeID,
			avatarDebugResultAuditRefPrefix + probeID,
			avatarDebugProjectionRefPrefix + probeID,
		},
		ReasonCode: avatarDebugSessionUnavailable,
		ResultId:   "avatar-debug-result-" + ulid.Make().String(),
	}
	if err := s.appendAvatarDebugAudit(request, result, replay); err != nil {
		return nil, err
	}
	if err := s.appendAvatarDebugProjectionEvents(request, result, replay); err != nil {
		return nil, err
	}
	return &runtimev1.RequestAvatarDebugProbeResponse{
		Request:   request,
		Result:    result,
		ReplayRef: replay,
	}, nil
}

func (s *Service) SubmitAvatarDebugProbeResult(ctx context.Context, req *runtimev1.SubmitAvatarDebugProbeResultRequest) (*runtimev1.SubmitAvatarDebugProbeResultResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugWriteScope)
	if err != nil {
		return nil, err
	}
	result, err := validateSubmittedAvatarDebugProbeResult(agentID, anchorID, req.GetResult())
	if err != nil {
		return nil, err
	}
	if err := s.appendAvatarDebugResultAudit(result); err != nil {
		return nil, err
	}
	if err := s.appendAvatarDebugResultProjectionEvent(result); err != nil {
		return nil, err
	}
	return &runtimev1.SubmitAvatarDebugProbeResultResponse{Result: result}, nil
}

func (s *Service) ListAvatarDebugProbeResults(ctx context.Context, req *runtimev1.ListAvatarDebugProbeResultsRequest) (*runtimev1.ListAvatarDebugProbeResultsResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
	if err != nil {
		return nil, err
	}
	if req.GetProbeKind() != runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED &&
		!isAdmittedAvatarDebugProbeKind(req.GetProbeKind()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug probe_kind is not admitted")
	}
	results, _, err := s.listAvatarDebugAuditProjection(agentID, anchorID, req.GetProbeKind())
	if err != nil {
		return nil, err
	}
	return &runtimev1.ListAvatarDebugProbeResultsResponse{ProbeResults: results}, nil
}

func validateSubmittedAvatarDebugProbeResult(agentID string, anchorID string, result *runtimev1.AvatarDebugProbeResultEnvelope) (*runtimev1.AvatarDebugProbeResultEnvelope, error) {
	if result == nil {
		return nil, status.Error(codes.InvalidArgument, "avatar debug result is required")
	}
	probeID := strings.TrimSpace(result.GetProbeId())
	if probeID == "" {
		return nil, status.Error(codes.InvalidArgument, "probe_id is required")
	}
	if strings.TrimSpace(result.GetAgentId()) != agentID {
		return nil, status.Error(codes.FailedPrecondition, "result agent_id must match request agent_id")
	}
	if strings.TrimSpace(result.GetConversationAnchorId()) != anchorID {
		return nil, status.Error(codes.FailedPrecondition, "result conversation_anchor_id must match request conversation_anchor_id")
	}
	if !isAdmittedAvatarDebugProbeKind(result.GetProbeKind()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug probe_kind is not admitted")
	}
	if !isAvatarSubmittableDebugProbeKind(result.GetProbeKind()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug probe_kind is not avatar-submittable")
	}
	if !isAdmittedAvatarDebugProbeStatus(result.GetStatus()) {
		return nil, status.Error(codes.InvalidArgument, "avatar debug status is not admitted")
	}
	resultID := strings.TrimSpace(result.GetResultId())
	if resultID == "" {
		return nil, status.Error(codes.InvalidArgument, "result_id is required")
	}
	evidenceRefs := normalizeAvatarDebugEvidenceRefs(result.GetEvidenceRefs())
	if result.GetStatus() == runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED && len(evidenceRefs) == 0 {
		return nil, status.Error(codes.InvalidArgument, "passed avatar debug result requires evidence_refs")
	}
	reasonCode := strings.TrimSpace(result.GetReasonCode())
	if result.GetStatus() != runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED && reasonCode == "" {
		return nil, status.Error(codes.InvalidArgument, "non-passed avatar debug result requires reason_code")
	}
	observedAt := result.GetObservedAt()
	if observedAt == nil || !observedAt.IsValid() {
		observedAt = timestamppb.New(time.Now().UTC())
	}
	return &runtimev1.AvatarDebugProbeResultEnvelope{
		ProbeId:              probeID,
		AgentId:              agentID,
		ConversationAnchorId: anchorID,
		ProbeKind:            result.GetProbeKind(),
		Status:               result.GetStatus(),
		ObservedAt:           observedAt,
		EvidenceRefs:         evidenceRefs,
		ReasonCode:           reasonCode,
		ResultId:             resultID,
	}, nil
}

func (s *Service) GetAvatarDebugReplay(ctx context.Context, req *runtimev1.GetAvatarDebugReplayRequest) (*runtimev1.GetAvatarDebugReplayResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(ctx, req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
	if err != nil {
		return nil, err
	}
	probeID := strings.TrimSpace(req.GetProbeId())
	if probeID == "" {
		return nil, status.Error(codes.InvalidArgument, "probe_id is required")
	}
	request, result, replay, err := s.findAvatarDebugReplay(agentID, anchorID, probeID)
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetAvatarDebugReplayResponse{
		Request:   request,
		Result:    result,
		ReplayRef: replay,
	}, nil
}
