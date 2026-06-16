package runtimeagent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
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

func (s *Service) GetAvatarDebugSnapshot(_ context.Context, req *runtimev1.GetAvatarDebugSnapshotRequest) (*runtimev1.GetAvatarDebugSnapshotResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
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

func (s *Service) RequestAvatarDebugProbe(_ context.Context, req *runtimev1.RequestAvatarDebugProbeRequest) (*runtimev1.RequestAvatarDebugProbeResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugWriteScope)
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

func (s *Service) SubmitAvatarDebugProbeResult(_ context.Context, req *runtimev1.SubmitAvatarDebugProbeResultRequest) (*runtimev1.SubmitAvatarDebugProbeResultResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugWriteScope)
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

func (s *Service) ListAvatarDebugProbeResults(_ context.Context, req *runtimev1.ListAvatarDebugProbeResultsRequest) (*runtimev1.ListAvatarDebugProbeResultsResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
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

func (s *Service) GetAvatarDebugReplay(_ context.Context, req *runtimev1.GetAvatarDebugReplayRequest) (*runtimev1.GetAvatarDebugReplayResponse, error) {
	agentID, anchorID, err := s.validateAvatarDebugControlRequest(req.GetContext(), req.GetAgentId(), req.GetConversationAnchorId(), avatarDebugReadScope)
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

func (s *Service) validateAvatarDebugControlRequest(ctx *runtimev1.AgentRequestContext, agentID string, anchorID string, requiredScope string) (string, string, error) {
	if s == nil || s.isClosed() {
		return "", "", status.Error(codes.FailedPrecondition, "runtime agent service unavailable")
	}
	identity, entry, err := s.agentEntryForIdentityContext(ctx)
	if err != nil {
		return "", "", err
	}
	trimmedAgentID := strings.TrimSpace(agentID)
	if trimmedAgentID == "" {
		return "", "", status.Error(codes.InvalidArgument, "agent_id is required")
	}
	if trimmedAgentID != identity.LocalAgentRef {
		return "", "", status.Error(codes.FailedPrecondition, "agent_id must match local_agent_ref")
	}
	callerAppID := strings.TrimSpace(ctx.GetAppId())
	if callerAppID == "" {
		return "", "", status.Error(codes.InvalidArgument, "context.app_id is required")
	}
	scopedBinding := ctx.GetScopedBinding()
	if scopedBinding == nil {
		return "", "", runtimeAgentBindingError(runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_NOT_FOUND)
	}
	trimmedAnchorID := strings.TrimSpace(anchorID)
	if trimmedAnchorID == "" {
		return "", "", status.Error(codes.InvalidArgument, "conversation_anchor_id is required")
	}
	if err := s.validateScopedBindingAttachment(scopedBinding, callerAppID, trimmedAgentID, requiredScope); err != nil {
		return "", "", err
	}
	if err := s.validateAvatarDebugAnchor(identity, entry, trimmedAnchorID); err != nil {
		return "", "", err
	}
	if s.auditStore == nil {
		return "", "", status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	return trimmedAgentID, trimmedAnchorID, nil
}

func (s *Service) validateAvatarDebugAnchor(identity localAgentIdentity, entry *agentEntry, anchorID string) error {
	if entry == nil {
		return status.Error(codes.NotFound, "agent not found")
	}
	if err := validateAgentRecordIdentity(entry.Agent, identity); err != nil {
		return err
	}
	s.chatSurfaceMu.Lock()
	anchor := s.chatAnchors[strings.TrimSpace(anchorID)]
	if anchor == nil {
		s.chatSurfaceMu.Unlock()
		return status.Error(codes.NotFound, "conversation anchor not found")
	}
	cloned := *anchor
	s.chatSurfaceMu.Unlock()
	if cloned.AgentID != identity.LocalAgentRef ||
		cloned.OwnerUserID != identity.OwnerUserID ||
		cloned.RealmAgentID != identity.RealmAgentID ||
		cloned.LocalAgentRef != identity.LocalAgentRef {
		return status.Error(codes.FailedPrecondition, "conversation anchor local identity mismatch")
	}
	return nil
}

func (s *Service) appendAvatarDebugProjectionEvents(
	request *runtimev1.AvatarDebugProbeRequestEnvelope,
	result *runtimev1.AvatarDebugProbeResultEnvelope,
	replay *runtimev1.AvatarDebugReplayRef,
) error {
	events := []*runtimev1.AgentEvent{
		s.newEvent(request.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family:  runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_REQUESTED,
				Request: request,
			},
		}),
		s.newEvent(result.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_RESULT,
				Result: result,
			},
		}),
		s.newEvent(request.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
			AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
				Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_REPLAY_LINKED,
				Replay: replay,
			},
		}),
	}
	s.mu.Lock()
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	committedEvents := s.eventStreamRuntime().appendEventsLocked(events...)
	if err := s.saveStateLocked(); err != nil {
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) appendAvatarDebugResultProjectionEvent(result *runtimev1.AvatarDebugProbeResultEnvelope) error {
	event := s.newEvent(result.GetAgentId(), runtimev1.AgentEventType_AGENT_EVENT_TYPE_AVATAR_DEBUG, &runtimev1.AgentEvent_AvatarDebug{
		AvatarDebug: &runtimev1.AgentAvatarDebugEventDetail{
			Family: runtimev1.AvatarDebugEventFamily_AVATAR_DEBUG_EVENT_FAMILY_PROBE_RESULT,
			Result: result,
		},
	})
	s.mu.Lock()
	previousEvents := append([]*runtimev1.AgentEvent(nil), s.events...)
	previousSequence := s.sequence
	committedEvents := s.eventStreamRuntime().appendEventsLocked(event)
	if err := s.saveStateLocked(); err != nil {
		s.events = previousEvents
		s.sequence = previousSequence
		s.mu.Unlock()
		return err
	}
	targetsByEvent := s.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	s.mu.Unlock()
	s.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

func (s *Service) appendAvatarDebugAudit(
	request *runtimev1.AvatarDebugProbeRequestEnvelope,
	result *runtimev1.AvatarDebugProbeResultEnvelope,
	replay *runtimev1.AvatarDebugReplayRef,
) error {
	if s == nil || s.auditStore == nil {
		return status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	for _, event := range []*runtimev1.AuditEventRecord{
		avatarDebugAuditEvent(request.GetProbeId(), request.GetAgentId(), request.GetConversationAnchorId(), avatarDebugRequestOperation, request.GetRequestedAt().AsTime(), avatarDebugRequestPayload(request)),
		avatarDebugResultAuditEvent(result),
		avatarDebugAuditEvent(replay.GetProbeId(), request.GetAgentId(), request.GetConversationAnchorId(), avatarDebugReplayLinkOperation, replay.GetLinkedAt().AsTime(), avatarDebugReplayPayload(replay)),
	} {
		s.auditStore.AppendEvent(event)
	}
	return nil
}

func (s *Service) appendAvatarDebugResultAudit(result *runtimev1.AvatarDebugProbeResultEnvelope) error {
	if s == nil || s.auditStore == nil {
		return status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	s.auditStore.AppendEvent(avatarDebugResultAuditEvent(result))
	return nil
}

func avatarDebugResultAuditEvent(result *runtimev1.AvatarDebugProbeResultEnvelope) *runtimev1.AuditEventRecord {
	event := avatarDebugAuditEvent(
		result.GetProbeId(),
		result.GetAgentId(),
		result.GetConversationAnchorId(),
		avatarDebugResultOperation,
		result.GetObservedAt().AsTime(),
		avatarDebugResultPayload(result),
	)
	if resultID := strings.TrimSpace(result.GetResultId()); resultID != "" {
		event.AuditId = fmt.Sprintf("%s:%s:%s", avatarDebugResultOperation, result.GetProbeId(), resultID)
	}
	return event
}

func avatarDebugAuditEvent(probeID string, agentID string, anchorID string, operation string, observedAt time.Time, payload *structpb.Struct) *runtimev1.AuditEventRecord {
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	return &runtimev1.AuditEventRecord{
		AuditId:              fmt.Sprintf("%s:%s", operation, probeID),
		AppId:                "runtime",
		Domain:               avatarDebugAuditDomain,
		Operation:            operation,
		ReasonCode:           runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:              probeID,
		Timestamp:            timestamppb.New(observedAt.UTC()),
		Payload:              payload,
		CallerKind:           runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:             "runtime.agent.service",
		SurfaceId:            "runtime.agent.avatar_debug",
		Capability:           "runtime.agent.avatar_debug",
		PrincipalId:          agentID,
		ResourceSelectorHash: anchorID,
	}
}

func avatarDebugRequestPayload(request *runtimev1.AvatarDebugProbeRequestEnvelope) *structpb.Struct {
	payload, _ := structpb.NewStruct(map[string]any{
		"probe_id":                request.GetProbeId(),
		"agent_id":                request.GetAgentId(),
		"conversation_anchor_id":  request.GetConversationAnchorId(),
		"probe_kind":              request.GetProbeKind().String(),
		"requested_by":            request.GetRequestedBy().String(),
		"requested_at":            timestampString(request.GetRequestedAt()),
		"turn_id":                 request.GetTurnId(),
		"stream_id":               request.GetStreamId(),
		"avatar_instance_id":      request.GetAvatarInstanceId(),
		"runtime_replay_ref":      request.GetRuntimeReplayRef(),
		"replay_requested":        request.GetReplayRequested(),
		"access_decision_verdict": avatarDebugAuthorizationVerdict,
		"access_decision_scope":   avatarDebugWriteScope,
		"access_decision_ref":     avatarDebugAuthorizationRefPrefix + request.GetProbeId(),
	})
	return payload
}

func avatarDebugResultPayload(result *runtimev1.AvatarDebugProbeResultEnvelope) *structpb.Struct {
	payload, _ := structpb.NewStruct(map[string]any{
		"probe_id":                result.GetProbeId(),
		"agent_id":                result.GetAgentId(),
		"conversation_anchor_id":  result.GetConversationAnchorId(),
		"probe_kind":              result.GetProbeKind().String(),
		"status":                  result.GetStatus().String(),
		"observed_at":             timestampString(result.GetObservedAt()),
		"evidence_refs":           avatarDebugStructList(result.GetEvidenceRefs()),
		"reason_code":             result.GetReasonCode(),
		"result_id":               result.GetResultId(),
		"access_decision_verdict": avatarDebugAuthorizationVerdict,
		"access_decision_scope":   avatarDebugWriteScope,
		"access_decision_ref":     avatarDebugAuthorizationRefPrefix + result.GetProbeId(),
	})
	return payload
}

func avatarDebugStructList(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func avatarDebugReplayPayload(replay *runtimev1.AvatarDebugReplayRef) *structpb.Struct {
	payload, _ := structpb.NewStruct(map[string]any{
		"probe_id":                 replay.GetProbeId(),
		"request_event_id":         fmt.Sprintf("%s:%s", avatarDebugRequestOperation, replay.GetProbeId()),
		"result_event_id":          fmt.Sprintf("%s:%s", avatarDebugResultOperation, replay.GetProbeId()),
		"authorization_verdict_id": avatarDebugAuthorizationRefPrefix + replay.GetProbeId(),
		"projection_lineage_id":    avatarDebugProjectionRefPrefix + replay.GetProbeId(),
		"replay_ref":               replay.GetReplayRef(),
		"redaction_state":          replay.GetRedactionState().String(),
		"replay_visibility":        replay.GetVisibility().String(),
		"visibility":               replay.GetVisibility().String(),
		"linked_at":                timestampString(replay.GetLinkedAt()),
		"access_decision_verdict":  avatarDebugAuthorizationVerdict,
		"access_decision_scope":    avatarDebugWriteScope,
		"access_decision_ref":      avatarDebugAuthorizationRefPrefix + replay.GetProbeId(),
	})
	return payload
}

func (s *Service) listAvatarDebugAuditProjection(agentID string, anchorID string, probeKind runtimev1.AvatarDebugProbeKind) ([]*runtimev1.AvatarDebugProbeResultEnvelope, []*runtimev1.AvatarDebugReplayRef, error) {
	events, err := s.listAvatarDebugAuditEvents()
	if err != nil {
		return nil, nil, err
	}
	resultsByProbe := map[string]*runtimev1.AvatarDebugProbeResultEnvelope{}
	replays := make([]*runtimev1.AvatarDebugReplayRef, 0)
	for _, event := range events {
		switch strings.TrimSpace(event.GetOperation()) {
		case avatarDebugResultOperation:
			result, ok := avatarDebugResultFromAuditEvent(event)
			if !ok || result.GetAgentId() != agentID || result.GetConversationAnchorId() != anchorID {
				continue
			}
			if probeKind != runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED && result.GetProbeKind() != probeKind {
				continue
			}
			if current := resultsByProbe[result.GetProbeId()]; current == nil || avatarDebugResultObservedAt(result).After(avatarDebugResultObservedAt(current)) {
				resultsByProbe[result.GetProbeId()] = result
			}
		case avatarDebugReplayLinkOperation:
			replay, ok := avatarDebugReplayFromAuditEvent(event)
			if !ok {
				continue
			}
			if event.GetPrincipalId() != agentID || event.GetResourceSelectorHash() != anchorID {
				continue
			}
			replays = append(replays, replay)
		}
	}
	results := make([]*runtimev1.AvatarDebugProbeResultEnvelope, 0, len(resultsByProbe))
	for _, result := range resultsByProbe {
		results = append(results, result)
	}
	sort.SliceStable(results, func(i, j int) bool {
		left := avatarDebugResultObservedAt(results[i])
		right := avatarDebugResultObservedAt(results[j])
		if left.Equal(right) {
			return results[i].GetProbeId() < results[j].GetProbeId()
		}
		return left.After(right)
	})
	return results, replays, nil
}

func (s *Service) findAvatarDebugReplay(agentID string, anchorID string, probeID string) (*runtimev1.AvatarDebugProbeRequestEnvelope, *runtimev1.AvatarDebugProbeResultEnvelope, *runtimev1.AvatarDebugReplayRef, error) {
	events, err := s.listAvatarDebugAuditEvents()
	if err != nil {
		return nil, nil, nil, err
	}
	var request *runtimev1.AvatarDebugProbeRequestEnvelope
	var result *runtimev1.AvatarDebugProbeResultEnvelope
	var replay *runtimev1.AvatarDebugReplayRef
	for _, event := range events {
		if event.GetTraceId() != probeID || event.GetPrincipalId() != agentID || event.GetResourceSelectorHash() != anchorID {
			continue
		}
		switch strings.TrimSpace(event.GetOperation()) {
		case avatarDebugRequestOperation:
			if parsed, ok := avatarDebugRequestFromAuditEvent(event); ok {
				request = parsed
			}
		case avatarDebugResultOperation:
			if parsed, ok := avatarDebugResultFromAuditEvent(event); ok {
				if result == nil || avatarDebugResultObservedAt(parsed).After(avatarDebugResultObservedAt(result)) {
					result = parsed
				}
			}
		case avatarDebugReplayLinkOperation:
			if parsed, ok := avatarDebugReplayFromAuditEvent(event); ok {
				replay = parsed
			}
		}
	}
	if request == nil || result == nil || replay == nil {
		return nil, nil, nil, status.Error(codes.NotFound, "avatar debug replay audit lineage not found")
	}
	return request, result, replay, nil
}

func (s *Service) listAvatarDebugAuditEvents() ([]*runtimev1.AuditEventRecord, error) {
	if s == nil || s.auditStore == nil {
		return nil, status.Error(codes.FailedPrecondition, "runtime audit store is required for avatar debug replay")
	}
	req := &runtimev1.ListAuditEventsRequest{
		Domain:   avatarDebugAuditDomain,
		PageSize: 200,
	}
	var events []*runtimev1.AuditEventRecord
	for {
		resp, err := s.auditStore.ListEvents(req)
		if err != nil {
			return nil, err
		}
		events = append(events, resp.GetEvents()...)
		if strings.TrimSpace(resp.GetNextPageToken()) == "" {
			break
		}
		req.PageToken = resp.GetNextPageToken()
	}
	return events, nil
}

func avatarDebugRequestFromAuditEvent(event *runtimev1.AuditEventRecord) (*runtimev1.AvatarDebugProbeRequestEnvelope, bool) {
	fields := event.GetPayload().GetFields()
	probeKind, ok := avatarDebugProbeKindFromString(avatarDebugStructString(fields, "probe_kind"))
	if !ok {
		return nil, false
	}
	requestedBy, ok := avatarDebugRequestedByFromString(avatarDebugStructString(fields, "requested_by"))
	if !ok {
		return nil, false
	}
	return &runtimev1.AvatarDebugProbeRequestEnvelope{
		ProbeId:              avatarDebugStructString(fields, "probe_id"),
		AgentId:              avatarDebugStructString(fields, "agent_id"),
		ConversationAnchorId: avatarDebugStructString(fields, "conversation_anchor_id"),
		ProbeKind:            probeKind,
		RequestedAt:          avatarDebugTimestamp(fields, "requested_at"),
		RequestedBy:          requestedBy,
		TurnId:               avatarDebugStructString(fields, "turn_id"),
		StreamId:             avatarDebugStructString(fields, "stream_id"),
		AvatarInstanceId:     avatarDebugStructString(fields, "avatar_instance_id"),
		RuntimeReplayRef:     avatarDebugStructString(fields, "runtime_replay_ref"),
		ReplayRequested:      avatarDebugStructBool(fields, "replay_requested"),
	}, true
}

func avatarDebugResultFromAuditEvent(event *runtimev1.AuditEventRecord) (*runtimev1.AvatarDebugProbeResultEnvelope, bool) {
	fields := event.GetPayload().GetFields()
	probeKind, ok := avatarDebugProbeKindFromString(avatarDebugStructString(fields, "probe_kind"))
	if !ok {
		return nil, false
	}
	probeStatus, ok := avatarDebugProbeStatusFromString(avatarDebugStructString(fields, "status"))
	if !ok {
		return nil, false
	}
	return &runtimev1.AvatarDebugProbeResultEnvelope{
		ProbeId:              avatarDebugStructString(fields, "probe_id"),
		AgentId:              avatarDebugStructString(fields, "agent_id"),
		ConversationAnchorId: avatarDebugStructString(fields, "conversation_anchor_id"),
		ProbeKind:            probeKind,
		Status:               probeStatus,
		ObservedAt:           avatarDebugTimestamp(fields, "observed_at"),
		EvidenceRefs:         avatarDebugStructStringList(fields, "evidence_refs"),
		ReasonCode:           avatarDebugStructString(fields, "reason_code"),
		ResultId:             avatarDebugStructString(fields, "result_id"),
	}, true
}

func avatarDebugReplayFromAuditEvent(event *runtimev1.AuditEventRecord) (*runtimev1.AvatarDebugReplayRef, bool) {
	fields := event.GetPayload().GetFields()
	redaction, ok := avatarDebugRedactionStateFromString(avatarDebugStructString(fields, "redaction_state"))
	if !ok {
		return nil, false
	}
	visibilityRaw := avatarDebugStructString(fields, "replay_visibility")
	if visibilityRaw == "" {
		visibilityRaw = avatarDebugStructString(fields, "visibility")
	}
	visibility, ok := avatarDebugReplayVisibilityFromString(visibilityRaw)
	if !ok {
		return nil, false
	}
	return &runtimev1.AvatarDebugReplayRef{
		ProbeId:        avatarDebugStructString(fields, "probe_id"),
		ReplayRef:      avatarDebugStructString(fields, "replay_ref"),
		RedactionState: redaction,
		Visibility:     visibility,
		LinkedAt:       avatarDebugTimestamp(fields, "linked_at"),
	}, true
}

func isAdmittedAvatarDebugProbeKind(kind runtimev1.AvatarDebugProbeKind) bool {
	return kind >= runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_PACKAGE_VALIDATION &&
		kind <= runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_WINDOW_HIT_REGION
}

func isAdmittedAvatarDebugRequestedBy(value runtimev1.AvatarDebugRequestedBy) bool {
	return value == runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_DESKTOP_DEBUG_WORKBENCH ||
		value == runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_RUNTIME_POLICY
}

func avatarDebugProbeKindFromString(raw string) (runtimev1.AvatarDebugProbeKind, bool) {
	value, ok := runtimev1.AvatarDebugProbeKind_value[strings.TrimSpace(raw)]
	if !ok {
		return runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_UNSPECIFIED, false
	}
	kind := runtimev1.AvatarDebugProbeKind(value)
	return kind, isAdmittedAvatarDebugProbeKind(kind)
}

func avatarDebugProbeStatusFromString(raw string) (runtimev1.AvatarDebugProbeStatus, bool) {
	value, ok := runtimev1.AvatarDebugProbeStatus_value[strings.TrimSpace(raw)]
	if !ok {
		return runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_UNSPECIFIED, false
	}
	statusValue := runtimev1.AvatarDebugProbeStatus(value)
	return statusValue, isAdmittedAvatarDebugProbeStatus(statusValue)
}

func isAdmittedAvatarDebugProbeStatus(statusValue runtimev1.AvatarDebugProbeStatus) bool {
	return statusValue >= runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_PASSED &&
		statusValue <= runtimev1.AvatarDebugProbeStatus_AVATAR_DEBUG_PROBE_STATUS_INVALID
}

func normalizeAvatarDebugEvidenceRefs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func avatarDebugResultObservedAt(result *runtimev1.AvatarDebugProbeResultEnvelope) time.Time {
	if result == nil || result.GetObservedAt() == nil || !result.GetObservedAt().IsValid() {
		return time.Time{}
	}
	return result.GetObservedAt().AsTime()
}

func avatarDebugRequestedByFromString(raw string) (runtimev1.AvatarDebugRequestedBy, bool) {
	value, ok := runtimev1.AvatarDebugRequestedBy_value[strings.TrimSpace(raw)]
	if !ok {
		return runtimev1.AvatarDebugRequestedBy_AVATAR_DEBUG_REQUESTED_BY_UNSPECIFIED, false
	}
	requestedBy := runtimev1.AvatarDebugRequestedBy(value)
	return requestedBy, isAdmittedAvatarDebugRequestedBy(requestedBy)
}

func avatarDebugRedactionStateFromString(raw string) (runtimev1.AvatarDebugReplayRedactionState, bool) {
	value, ok := runtimev1.AvatarDebugReplayRedactionState_value[strings.TrimSpace(raw)]
	if !ok {
		return runtimev1.AvatarDebugReplayRedactionState_AVATAR_DEBUG_REPLAY_REDACTION_STATE_UNSPECIFIED, false
	}
	redaction := runtimev1.AvatarDebugReplayRedactionState(value)
	return redaction, redaction != runtimev1.AvatarDebugReplayRedactionState_AVATAR_DEBUG_REPLAY_REDACTION_STATE_UNSPECIFIED
}

func avatarDebugReplayVisibilityFromString(raw string) (runtimev1.AvatarDebugReplayVisibility, bool) {
	value, ok := runtimev1.AvatarDebugReplayVisibility_value[strings.TrimSpace(raw)]
	if !ok {
		return runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_UNSPECIFIED, false
	}
	visibility := runtimev1.AvatarDebugReplayVisibility(value)
	return visibility, visibility != runtimev1.AvatarDebugReplayVisibility_AVATAR_DEBUG_REPLAY_VISIBILITY_UNSPECIFIED
}

func avatarDebugStructString(fields map[string]*structpb.Value, key string) string {
	if fields == nil {
		return ""
	}
	return strings.TrimSpace(fields[key].GetStringValue())
}

func avatarDebugStructBool(fields map[string]*structpb.Value, key string) bool {
	if fields == nil {
		return false
	}
	return fields[key].GetBoolValue()
}

func avatarDebugStructStringList(fields map[string]*structpb.Value, key string) []string {
	if fields == nil || fields[key] == nil || fields[key].GetListValue() == nil {
		return nil
	}
	values := fields[key].GetListValue().GetValues()
	out := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value.GetStringValue()); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func avatarDebugTimestamp(fields map[string]*structpb.Value, key string) *timestamppb.Timestamp {
	if fields == nil {
		return nil
	}
	raw := strings.TrimSpace(fields[key].GetStringValue())
	if raw == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return nil
	}
	return timestamppb.New(parsed.UTC())
}
