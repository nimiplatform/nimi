package runtimeagent

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) newEvent(agentID string, eventType runtimev1.AgentEventType, detail any) *runtimev1.AgentEvent {
	return s.newEventAt(agentID, eventType, detail, time.Now().UTC())
}

func (s *Service) newEventForIdentity(identity localAgentIdentity, eventType runtimev1.AgentEventType, detail any) *runtimev1.AgentEvent {
	return s.newEventForIdentityAt(identity, eventType, detail, time.Now().UTC())
}

func (s *Service) newEventForIdentityAt(identity localAgentIdentity, eventType runtimev1.AgentEventType, detail any, observedAt time.Time) *runtimev1.AgentEvent {
	event := s.newEventAt(identity.LocalAgentRef, eventType, detail, observedAt)
	event.LocalAgentRef = identity.LocalAgentRef
	event.OwnerUserId = identity.OwnerUserID
	event.RuntimeSourceRef = identity.RuntimeSourceRef
	return event
}

func (s *Service) newEventAt(agentID string, eventType runtimev1.AgentEventType, detail any, observedAt time.Time) *runtimev1.AgentEvent {
	event := &runtimev1.AgentEvent{
		EventType:     eventType,
		AgentId:       agentID,
		LocalAgentRef: strings.TrimSpace(agentID),
		Timestamp:     timestamppb.New(observedAt.UTC()),
	}
	switch typed := detail.(type) {
	case *runtimev1.AgentEvent_Lifecycle:
		event.Detail = typed
	case *runtimev1.AgentEvent_Hook:
		event.Detail = typed
	case *runtimev1.AgentEvent_Budget:
		event.Detail = typed
	case *runtimev1.AgentEvent_State:
		event.Detail = typed
	case *runtimev1.AgentEvent_Presentation:
		event.Detail = typed
	case *runtimev1.AgentEvent_Proactive:
		event.Detail = typed
	}
	return event
}

func remainingTokens(state *runtimev1.AgentAutonomyState) int64 {
	if state == nil || state.GetConfig() == nil || state.GetConfig().GetDailyTokenBudget() <= 0 {
		return 0
	}
	remaining := state.GetConfig().GetDailyTokenBudget() - state.GetUsedTokensInWindow()
	if remaining < 0 {
		return 0
	}
	return remaining
}

func pageBounds(pageToken string, pageSize int32, defaultSize int, maxSize int, total int) (int, int, string, error) {
	offset, err := decodeCursor(pageToken)
	if err != nil {
		return 0, 0, "", err
	}
	size := int(pageSize)
	if size <= 0 {
		size = defaultSize
	}
	if size > maxSize {
		size = maxSize
	}
	start := int(offset)
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	next := ""
	if end < total {
		next = encodeCursor(uint64(end))
	}
	return start, end, next, nil
}

func encodeCursor(offset uint64) string {
	if offset == 0 {
		return ""
	}
	return strconv.FormatUint(offset, 10)
}

func decodeCursor(token string) (uint64, error) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return 0, nil
	}
	value, err := strconv.ParseUint(trimmed, 10, 64)
	if err != nil {
		return 0, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			err,
			grpcerr.ReasonOptions{
				ActionHint: "provide_valid_page_cursor",
				Message:    "page cursor is invalid",
			},
		)
	}
	return value, nil
}

func reasonCodeFromError(err error) runtimev1.ReasonCode {
	if reason, ok := grpcerr.ExtractReasonCode(err); ok && reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return reason
	}
	if status.Code(err) == codes.Unavailable {
		return runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE
	}
	if status.Code(err) == codes.InvalidArgument {
		return runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	}
	return runtimev1.ReasonCode_AI_OUTPUT_INVALID
}

type runtimeErrorDetail struct {
	ReasonCode runtimev1.ReasonCode
	ActionHint string
	Message    string
}

func runtimeErrorDetailFromError(err error) runtimeErrorDetail {
	if err == nil {
		return runtimeErrorDetail{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	}
	var capacity *agentTurnContextCapacityExceededError
	if errors.As(err, &capacity) {
		return runtimeErrorDetail{
			ReasonCode: runtimev1.ReasonCode_AI_CONFIG_INVALID,
			ActionHint: "open_machine_local_ai_configuration",
			Message:    capacity.Error(),
		}
	}
	detail := runtimeErrorDetail{
		ReasonCode: reasonCodeFromError(err),
		Message:    strings.TrimSpace(err.Error()),
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		detail.ActionHint = strings.TrimSpace(metadata["action_hint"])
	}
	if st, ok := status.FromError(err); ok {
		if message := runtimeErrorMessageFromStatus(st.Message()); message != "" {
			detail.Message = message
		}
	}
	return detail
}

func runtimeErrorMessageFromStatus(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	var payload struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(trimmed), &payload); err == nil {
		if message := strings.TrimSpace(payload.Message); message != "" {
			return message
		}
	}
	return trimmed
}

func okAck() *runtimev1.Ack {
	return &runtimev1.Ack{Ok: true}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func cloneStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*structpb.Struct)
}

func cloneTimestamp(input *timestamppb.Timestamp) *timestamppb.Timestamp {
	if input == nil {
		return nil
	}
	return timestamppb.New(input.AsTime())
}

func timestampString(input *timestamppb.Timestamp) string {
	if input == nil {
		return ""
	}
	return input.AsTime().UTC().Format(time.RFC3339Nano)
}

func encodeSequenceValue(input uint64) string {
	return fmt.Sprintf("%d", input)
}

func decodeSequenceValue(raw string) (uint64, error) {
	var value uint64
	_, err := fmt.Sscanf(strings.TrimSpace(raw), "%d", &value)
	if err != nil {
		return 0, fmt.Errorf("decode sequence: %w", err)
	}
	return value, nil
}

func cloneAutonomyConfig(input *runtimev1.AgentAutonomyConfig) *runtimev1.AgentAutonomyConfig {
	return normalizeAutonomyConfig(input)
}

func normalizeAutonomyConfig(input *runtimev1.AgentAutonomyConfig) *runtimev1.AgentAutonomyConfig {
	if input == nil {
		return &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF,
		}
	}
	config := proto.Clone(input).(*runtimev1.AgentAutonomyConfig)
	if config.GetMode() == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_UNSPECIFIED {
		config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF
	}
	return config
}

func autonomyMode(config *runtimev1.AgentAutonomyConfig) runtimev1.AgentAutonomyMode {
	if config == nil {
		return runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF
	}
	mode := config.GetMode()
	if mode == runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_UNSPECIFIED {
		return runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_OFF
	}
	return mode
}

func cloneAutonomy(input *runtimev1.AgentAutonomyState) *runtimev1.AgentAutonomyState {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentAutonomyState)
}

func cloneLocalAgentRecord(input *runtimev1.LocalAgentRecord) *runtimev1.LocalAgentRecord {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.LocalAgentRecord)
}

func cloneAgentState(input *runtimev1.AgentStateProjection) *runtimev1.AgentStateProjection {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentStateProjection)
}

func clonePendingHook(input *runtimev1.PendingHook) *runtimev1.PendingHook {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.PendingHook)
}

func cloneHookOutcome(input *runtimev1.HookExecutionOutcome) *runtimev1.HookExecutionOutcome {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.HookExecutionOutcome)
}

func cloneAgentEvent(input *runtimev1.AgentEvent) *runtimev1.AgentEvent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AgentEvent)
}

func cloneAgentEntry(input *agentEntry) *agentEntry {
	if input == nil {
		return nil
	}
	cloned := &agentEntry{
		Agent: cloneLocalAgentRecord(input.Agent),
		State: cloneAgentState(input.State),
		Hooks: make(map[string]*runtimev1.PendingHook, len(input.Hooks)),
	}
	for hookID, hook := range input.Hooks {
		cloned.Hooks[hookID] = clonePendingHook(hook)
	}
	return cloned
}
