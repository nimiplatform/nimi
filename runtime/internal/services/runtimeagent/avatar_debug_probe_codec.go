package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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

func isAvatarSubmittableDebugProbeKind(kind runtimev1.AvatarDebugProbeKind) bool {
	switch kind {
	case runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_BACKEND_LOAD,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_CAPABILITY_PROFILE,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_ROUTE_SUPPORT_MATRIX,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_GENERATED_MOTION,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_EMOTION_EXPRESSION,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_SPEECH_LIPSYNC,
		runtimev1.AvatarDebugProbeKind_AVATAR_DEBUG_PROBE_KIND_WINDOW_HIT_REGION:
		return true
	default:
		return false
	}
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
