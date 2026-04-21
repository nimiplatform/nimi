package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// stateEventOrigin carries the optional origin linkage for runtime.agent.state.*
// projection. Per K-AGCORE-037 / state_envelope, origin linkage is OPTIONAL
// and MUST remain empty when the state transition has no real continuity
// branch (admin posture change, lifecycle-driven state, etc.). Runtime MUST
// NOT fabricate origin linkage just to reuse a projection envelope.
type stateEventOrigin struct {
	ConversationAnchorID string
	OriginatingTurnID    string
	OriginatingStreamID  string
}

func (o stateEventOrigin) apply(detail *runtimev1.AgentStateEventDetail) {
	if detail == nil {
		return
	}
	if trimmed := strings.TrimSpace(o.ConversationAnchorID); trimmed != "" {
		detail.ConversationAnchorId = trimmed
	}
	if trimmed := strings.TrimSpace(o.OriginatingTurnID); trimmed != "" {
		detail.OriginatingTurnId = trimmed
	}
	if trimmed := strings.TrimSpace(o.OriginatingStreamID); trimmed != "" {
		detail.OriginatingStreamId = trimmed
	}
}

// stateStatusTextChangedEvent projects runtime.agent.state.status_text_changed.
// `previous` may be empty; when non-empty we set has_previous_status_text.
func (s *Service) stateStatusTextChangedEvent(agentID string, current string, previous string, hadPrevious bool, origin stateEventOrigin, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentStateEventDetail{
		Family:                runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_STATUS_TEXT_CHANGED,
		CurrentStatusText:     strings.TrimSpace(current),
		PreviousStatusText:    strings.TrimSpace(previous),
		HasPreviousStatusText: hadPrevious,
	}
	origin.apply(detail)
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, &runtimev1.AgentEvent_State{State: detail}, observedAt)
}

// stateExecutionStateChangedEvent projects
// runtime.agent.state.execution_state_changed. No previous_* admission
// fabrication: `previous` may be UNSPECIFIED when no prior state is known.
func (s *Service) stateExecutionStateChangedEvent(agentID string, current runtimev1.AgentExecutionState, previous runtimev1.AgentExecutionState, origin stateEventOrigin, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentStateEventDetail{
		Family:                 runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED,
		CurrentExecutionState:  current,
		PreviousExecutionState: previous,
	}
	origin.apply(detail)
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, &runtimev1.AgentEvent_State{State: detail}, observedAt)
}

// stateEmotionChangedEvent projects runtime.agent.state.emotion_changed.
// `source` identifies the commit source (e.g. `chat_status_cue`, `sidecar`).
func (s *Service) stateEmotionChangedEvent(agentID string, current string, previous string, source string, origin stateEventOrigin, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentStateEventDetail{
		Family:          runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EMOTION_CHANGED,
		CurrentEmotion:  strings.TrimSpace(current),
		PreviousEmotion: strings.TrimSpace(previous),
		EmotionSource:   strings.TrimSpace(source),
	}
	origin.apply(detail)
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, &runtimev1.AgentEvent_State{State: detail}, observedAt)
}

// statePostureChangedEvent projects runtime.agent.state.posture_changed with
// K-AGCORE-037 `PostureProjection` shape. `previous` may be nil for first-set.
func (s *Service) statePostureChangedEvent(agentID string, current *runtimev1.AgentPostureProjection, previous *runtimev1.AgentPostureProjection, origin stateEventOrigin, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentStateEventDetail{
		Family:          runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_POSTURE_CHANGED,
		CurrentPosture:  clonePostureProjection(current),
		PreviousPosture: clonePostureProjection(previous),
	}
	origin.apply(detail)
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE, &runtimev1.AgentEvent_State{State: detail}, observedAt)
}

// postureProjectionFromPatch builds the read-only PostureProjection admitted
// on the public surface from a runtime-private BehavioralPosture. Runtime-
// private truth_basis_ids / transition_reason / posture_class remain
// runtime-private per K-AGCORE-015.
func postureProjectionFromBehavioral(posture BehavioralPosture) *runtimev1.AgentPostureProjection {
	actionFamily := strings.TrimSpace(posture.ActionFamily)
	interruptMode := strings.TrimSpace(posture.InterruptMode)
	if actionFamily == "" && interruptMode == "" {
		return nil
	}
	return &runtimev1.AgentPostureProjection{
		ActionFamily:  actionFamily,
		InterruptMode: interruptMode,
	}
}

func clonePostureProjection(input *runtimev1.AgentPostureProjection) *runtimev1.AgentPostureProjection {
	if input == nil {
		return nil
	}
	return &runtimev1.AgentPostureProjection{
		ActionFamily:  input.GetActionFamily(),
		InterruptMode: input.GetInterruptMode(),
	}
}

// emitPresentationExpressionEvent builds and envelope-validates a
// runtime.agent.presentation.expression_requested event. Runtime MUST NOT
// emit presentation events without real anchor/turn/stream identity; this
// wrapper is the single admitted commit path so fail-closed envelope check
// runs on every emission.
func (s *Service) emitPresentationExpressionEvent(agentID string, anchorID string, turnID string, streamID string, expressionID string, expectedDurationMs int64, observedAt time.Time) (*runtimev1.AgentEvent, error) {
	event := s.presentationExpressionRequestedEvent(agentID, anchorID, turnID, streamID, expressionID, expectedDurationMs, observedAt)
	if err := validatePresentationDetail(event.GetPresentation()); err != nil {
		return nil, err
	}
	return event, nil
}

// emitPresentationActivityEvent is the corresponding activity_requested
// commit path with fail-closed envelope validation.
func (s *Service) emitPresentationActivityEvent(agentID string, anchorID string, turnID string, streamID string, activityName string, category string, intensity string, source string, observedAt time.Time) (*runtimev1.AgentEvent, error) {
	event := s.presentationActivityRequestedEvent(agentID, anchorID, turnID, streamID, activityName, category, intensity, source, observedAt)
	if err := validatePresentationDetail(event.GetPresentation()); err != nil {
		return nil, err
	}
	return event, nil
}

// presentationExpressionRequestedEvent emits
// runtime.agent.presentation.expression_requested. Presentation is
// stream-scoped: all four envelope identifiers are required. Runtime MUST
// NOT emit presentation events without real stream identity. Callers should
// prefer emitPresentationExpressionEvent which fail-closes on envelope
// violations at commit time; this constructor is retained for completeness.
func (s *Service) presentationExpressionRequestedEvent(agentID string, anchorID string, turnID string, streamID string, expressionID string, expectedDurationMs int64, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentPresentationEventDetail{
		Family:                       runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_EXPRESSION_REQUESTED,
		ConversationAnchorId:         strings.TrimSpace(anchorID),
		TurnId:                       strings.TrimSpace(turnID),
		StreamId:                     strings.TrimSpace(streamID),
		ExpressionId:                 strings.TrimSpace(expressionID),
		ExpressionExpectedDurationMs: expectedDurationMs,
	}
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION, &runtimev1.AgentEvent_Presentation{Presentation: detail}, observedAt)
}

// presentationActivityRequestedEvent emits
// runtime.agent.presentation.activity_requested.
func (s *Service) presentationActivityRequestedEvent(agentID string, anchorID string, turnID string, streamID string, activityName string, category string, intensity string, source string, observedAt time.Time) *runtimev1.AgentEvent {
	detail := &runtimev1.AgentPresentationEventDetail{
		Family:               runtimev1.AgentPresentationEventFamily_AGENT_PRESENTATION_EVENT_FAMILY_ACTIVITY_REQUESTED,
		ConversationAnchorId: strings.TrimSpace(anchorID),
		TurnId:               strings.TrimSpace(turnID),
		StreamId:             strings.TrimSpace(streamID),
		ActivityName:         strings.TrimSpace(activityName),
		ActivityCategory:     strings.TrimSpace(category),
		ActivityIntensity:    strings.TrimSpace(intensity),
		ActivitySource:       strings.TrimSpace(source),
	}
	return s.newEventAt(agentID, runtimev1.AgentEventType_AGENT_EVENT_TYPE_PRESENTATION, &runtimev1.AgentEvent_Presentation{Presentation: detail}, observedAt)
}

// validatePresentationDetail enforces presentation_envelope: all four
// identifiers must be present. Fail-closed prevents silent drift.
func validatePresentationDetail(detail *runtimev1.AgentPresentationEventDetail) error {
	if detail == nil {
		return errPresentationEnvelopeMissing
	}
	if strings.TrimSpace(detail.GetConversationAnchorId()) == "" ||
		strings.TrimSpace(detail.GetTurnId()) == "" ||
		strings.TrimSpace(detail.GetStreamId()) == "" {
		return errPresentationEnvelopeMissing
	}
	return nil
}

var errPresentationEnvelopeMissing = newPresentationEnvelopeError()

type presentationEnvelopeError struct{}

func (presentationEnvelopeError) Error() string {
	return "runtime.agent.presentation.* requires agent_id + conversation_anchor_id + turn_id + stream_id"
}

func newPresentationEnvelopeError() error { return presentationEnvelopeError{} }

// stateEventObservedAt picks a consistent observedAt for state events emitted
// alongside an agent state mutation; if zero, defaults to now.
func stateEventObservedAt(observedAt time.Time) *timestamppb.Timestamp {
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	return timestamppb.New(observedAt.UTC())
}

// applyBehavioralPostureUpdate persists the new posture and returns the
// runtime.agent.state.* events that project the transition. This is the
// runtime-owned admission boundary for K-AGCORE-037 `posture_changed` +
// `status_text_changed`: the caller appends these events to updateAgent so
// that posture, status text, and runtime event log commit together.
//
// Behavior:
//   - Previous posture is read from runtime-owned posture persistence.
//   - New posture is persisted via postures.PutBehavioralPosture.
//   - runtime.agent.state.posture_changed emits with K-AGCORE-037
//     PostureProjection shape. previous_posture is included ONLY when prior
//     posture existed; runtime MUST NOT synthesize a placeholder previous.
//   - runtime.agent.state.status_text_changed emits ONLY when status text
//     actually changes; previous_status_text is carried when we had one.
//   - origin linkage is applied verbatim; callers with no real continuity
//     branch MUST pass an empty stateEventOrigin so no turn linkage is
//     fabricated (admin / life-track / review paths).
func (s *Service) applyBehavioralPostureUpdate(
	ctx context.Context,
	entry *agentEntry,
	posture BehavioralPosture,
	origin stateEventOrigin,
	now time.Time,
) ([]*runtimev1.AgentEvent, error) {
	if entry == nil {
		return nil, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var previousPosture *runtimev1.AgentPostureProjection
	previousStatusText := strings.TrimSpace(entry.State.GetStatusText())
	hadPreviousStatus := previousStatusText != ""
	if s.postures != nil {
		prior, err := s.postures.GetBehavioralPosture(ctx, entry.Agent.GetAgentId())
		if err == nil && prior != nil {
			previousPosture = postureProjectionFromBehavioral(*prior)
			if text := strings.TrimSpace(prior.StatusText); text != "" {
				previousStatusText = text
				hadPreviousStatus = true
			}
		}
	}
	if err := s.PutBehavioralPosture(ctx, posture); err != nil {
		return nil, err
	}
	currentPosture := postureProjectionFromBehavioral(posture)
	if currentPosture == nil {
		return nil, nil
	}
	events := make([]*runtimev1.AgentEvent, 0, 2)
	events = append(events, s.statePostureChangedEvent(
		entry.Agent.GetAgentId(),
		currentPosture,
		previousPosture,
		origin,
		now,
	))
	newStatus := strings.TrimSpace(posture.StatusText)
	if newStatus != "" && newStatus != previousStatusText {
		events = append(events, s.stateStatusTextChangedEvent(
			entry.Agent.GetAgentId(),
			newStatus,
			previousStatusText,
			hadPreviousStatus,
			origin,
			now,
		))
	}
	return events, nil
}
