package runtimeagent

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
