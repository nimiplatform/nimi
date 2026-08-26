package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// setExecutionState mutates committed execution-state truth and, when the
// execution state actually transitions, emits
// `runtime.agent.state.execution_state_changed` with optional origin linkage
// back to the anchor/turn/stream that caused the change. Per K-AGCORE-037
// state_envelope origin linkage is OPTIONAL and MUST be omitted when the
// transition has no real continuity branch (e.g. IDLE on shutdown).
func (r publicChatRuntime) setExecutionState(agentID string, subjectUserID string, worldID string, state runtimev1.AgentExecutionState) error {
	return r.setExecutionStateWithOrigin(agentID, subjectUserID, worldID, state, stateEventOrigin{})
}

func (r publicChatRuntime) setExecutionStateWithOrigin(agentID string, subjectUserID string, worldID string, state runtimev1.AgentExecutionState, origin stateEventOrigin) error {
	if r.svc == nil || r.svc.isClosed() {
		return nil
	}
	r.svc.mu.Lock()
	committedEvents, targetsByEvent, err := r.setExecutionStateWithOriginLocked(agentID, subjectUserID, worldID, state, origin)
	r.svc.mu.Unlock()
	if err != nil {
		return err
	}
	r.svc.eventStreamRuntime().broadcast(committedEvents, targetsByEvent)
	return nil
}

// setExecutionStateWithOriginLocked is the committed execution-state mutation
// boundary for callers that already hold svc.mu. It returns the exact event
// delivery plan so callers can release every service lock before broadcasting.
// This lets turn finalization atomically check chat reservation ownership while
// following the service-wide svc.mu -> chatSurfaceMu lock order.
func (r publicChatRuntime) setExecutionStateWithOriginLocked(
	agentID string,
	subjectUserID string,
	worldID string,
	state runtimev1.AgentExecutionState,
	origin stateEventOrigin,
) ([]*runtimev1.AgentEvent, [][]*subscriber, error) {
	if r.svc == nil || r.svc.isClosed() {
		return nil, nil, nil
	}
	localAgentRef := strings.TrimSpace(agentID)
	if localAgentRef == "" {
		return nil, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	entry := cloneAgentEntry(r.svc.agents[localAgentRef])
	if entry == nil {
		return nil, nil, status.Error(codes.NotFound, "agent not found")
	}
	if err := validatePersistedAgentPresentationProfile(entry.Agent); err != nil {
		return nil, nil, err
	}
	previousExecution := entry.State.GetExecutionState()
	executionChanged := false
	if previousExecution != state {
		entry.State.ExecutionState = state
		executionChanged = true
	}
	if trimmed := strings.TrimSpace(subjectUserID); trimmed != "" && entry.State.GetActiveUserId() != trimmed {
		entry.State.ActiveUserId = trimmed
	}
	if trimmed := strings.TrimSpace(worldID); trimmed != "" && entry.State.GetActiveWorldId() != trimmed {
		entry.State.ActiveWorldId = trimmed
	}
	if !executionChanged && strings.TrimSpace(subjectUserID) == "" && strings.TrimSpace(worldID) == "" {
		return nil, nil, nil
	}
	now := time.Now().UTC()
	entry.State.UpdatedAt = timestamppb.New(now)
	events := make([]*runtimev1.AgentEvent, 0, 1)
	if executionChanged {
		events = append(events, r.svc.stateExecutionStateChangedEvent(entry.Agent.GetLocalAgentRef(), state, previousExecution, origin, now))
	}
	committedAgentRef, err := localAgentRefForEntry(entry)
	if err != nil {
		return nil, nil, err
	}
	previousEntry, hadEntry := r.svc.agents[committedAgentRef]
	if !hadEntry {
		return nil, nil, status.Error(codes.NotFound, "agent not found")
	}
	previousEvents := append([]*runtimev1.AgentEvent(nil), r.svc.events...)
	previousSequence := r.svc.sequence
	r.svc.agents[committedAgentRef] = cloneAgentEntry(entry)
	committedEvents := r.svc.eventStreamRuntime().appendEventsLocked(events...)
	if err := r.svc.saveStateLocked(); err != nil {
		r.svc.agents[committedAgentRef] = previousEntry
		r.svc.events = previousEvents
		r.svc.sequence = previousSequence
		return nil, nil, err
	}
	targetsByEvent := r.svc.eventStreamRuntime().matchingSubscribersLocked(committedEvents)
	return committedEvents, targetsByEvent, nil
}

// emitTurnInterrupted projects yaml `turn.interrupted.detail.reason`.
// trace_id / model_resolved / route_decision belong to runtime execution
// truth and surface only via the unary public chat session snapshot `last_turn`.
func (r publicChatRuntime) emitTurnInterrupted(session publicChatAnchorState, turn publicChatTurnState, _ string, _ string, _ runtimev1.RoutePolicy, reason string) {
	canonicalReason, err := normalizePublicChatCancellationReason(reason)
	if err != nil {
		canonicalReason = "policy_refusal"
	}
	payload := map[string]any{
		"reason": canonicalReason,
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnInterruptedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat interrupted event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

func normalizePublicChatCancellationReason(raw string) (string, error) {
	reason := strings.TrimSpace(raw)
	if reason == "" {
		return "user_cancel", nil
	}
	switch reason {
	case "user_cancel",
		"room_closed",
		"superseded_turn",
		"budget_exhausted",
		"timeout",
		"gateway_revoked",
		"policy_refusal":
		return reason, nil
	default:
		return "", status.Errorf(codes.InvalidArgument, "public chat cancellation reason %q is not admitted", reason)
	}
}

// emitTurnFailed projects yaml `turn.failed.detail` admitting only
// `reason_code` (required) and `message?`. action_hint / trace_id /
// model_resolved / route_decision are runtime execution truth and live
// on the unary public chat session snapshot `last_turn` only.
func (r publicChatRuntime) emitTurnFailed(session publicChatAnchorState, turn publicChatTurnState, _ string, _ string, _ runtimev1.RoutePolicy, reasonCode runtimev1.ReasonCode, message string, _ string) {
	payload := map[string]any{
		"reason_code": publicChatReasonCodeLabel(reasonCode),
	}
	if trimmed := strings.TrimSpace(message); trimmed != "" {
		payload["message"] = trimmed
	}
	if err := r.emitTurnEvent(session, turn.TurnID, publicChatTurnFailedType, payload); err != nil && r.svc.logger != nil {
		r.svc.logger.Warn("emit public chat failed event failed", "agent_id", session.AgentID, "turn_id", turn.TurnID, "error", err)
	}
}

// projectCommittedStatusCue emits runtime.agent.state.emotion_changed plus
// runtime.agent.presentation.* requests derived from the structured envelope's
// StatusCue once the turn has committed. Runtime MUST NOT emit presentation
// events without real stream identity; when origin linkage cannot be
// constructed the projection is skipped rather than fabricated.
