package runtimeagent

import (
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	publicChatTurnStatusAccepted    = "accepted"
	publicChatTurnStatusStarted     = "started"
	publicChatTurnStatusStreaming   = "streaming"
	publicChatTurnStatusCompleted   = "completed"
	publicChatTurnStatusFailed      = "failed"
	publicChatTurnStatusInterrupted = "interrupted"
)

type publicChatTurnProjectionState struct {
	TurnID            string
	Status            string
	TraceID           string
	StreamSequence    uint64
	Origin            string
	ChainID           string
	FollowUpDepth     int
	MaxFollowUpTurns  int
	SourceTurnID      string
	SourceActionID    string
	ModelResolved     string
	RouteDecision     runtimev1.RoutePolicy
	OutputObserved    bool
	ReasoningObserved bool
	MessageID         string
	AssistantText     string
	Structured        *publicChatStructuredEnvelope
	AssistantMemory   *publicChatAssistantMemoryOutcome
	Sidecar           *publicChatSidecarOutcome
	FollowUp          *publicChatFollowUpOutcome
	FinishReason      string
	StreamSimulated   bool
	ReasonCode        runtimev1.ReasonCode
	ActionHint        string
	Message           string
	UpdatedAt         time.Time
}

func newPublicChatTurnProjection(turn *publicChatTurnState) *publicChatTurnProjectionState {
	if turn == nil {
		return nil
	}
	return &publicChatTurnProjectionState{
		TurnID:           turn.TurnID,
		Status:           publicChatTurnStatusAccepted,
		Origin:           firstNonEmpty(strings.TrimSpace(turn.Origin), publicChatTurnOriginUser),
		ChainID:          strings.TrimSpace(turn.ChainID),
		FollowUpDepth:    turn.FollowUpDepth,
		MaxFollowUpTurns: turn.MaxFollowUpTurns,
		SourceTurnID:     strings.TrimSpace(turn.SourceTurnID),
		SourceActionID:   strings.TrimSpace(turn.SourceActionID),
		UpdatedAt:        time.Now().UTC(),
	}
}

func clonePublicChatTurnProjectionState(input *publicChatTurnProjectionState) *publicChatTurnProjectionState {
	if input == nil {
		return nil
	}
	out := *input
	out.Structured = clonePublicChatStructuredEnvelope(input.Structured)
	out.AssistantMemory = clonePublicChatAssistantMemoryOutcome(input.AssistantMemory)
	out.Sidecar = clonePublicChatSidecarOutcome(input.Sidecar)
	out.FollowUp = clonePublicChatFollowUpOutcome(input.FollowUp)
	return &out
}

func (p *publicChatTurnProjectionState) payload() map[string]any {
	if p == nil {
		return map[string]any{}
	}
	out := map[string]any{
		"turn_id":             strings.TrimSpace(p.TurnID),
		"status":              strings.TrimSpace(p.Status),
		"stream_sequence":     p.StreamSequence,
		"turn_origin":         firstNonEmpty(strings.TrimSpace(p.Origin), publicChatTurnOriginUser),
		"follow_up_depth":     p.FollowUpDepth,
		"max_follow_up_turns": p.MaxFollowUpTurns,
		"output_observed":     p.OutputObserved,
		"reasoning_observed":  p.ReasoningObserved,
		"updated_at":          p.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
	if strings.TrimSpace(p.TraceID) != "" {
		out["trace_id"] = strings.TrimSpace(p.TraceID)
	}
	if strings.TrimSpace(p.ChainID) != "" {
		out["chain_id"] = strings.TrimSpace(p.ChainID)
	}
	if strings.TrimSpace(p.SourceTurnID) != "" {
		out["source_turn_id"] = strings.TrimSpace(p.SourceTurnID)
	}
	if strings.TrimSpace(p.SourceActionID) != "" {
		out["source_action_id"] = strings.TrimSpace(p.SourceActionID)
	}
	if strings.TrimSpace(p.ModelResolved) != "" {
		out["model_resolved"] = strings.TrimSpace(p.ModelResolved)
	}
	if p.RouteDecision != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		out["route_decision"] = publicChatRouteLabel(p.RouteDecision)
	}
	if strings.TrimSpace(p.MessageID) != "" {
		out["message_id"] = strings.TrimSpace(p.MessageID)
	}
	if strings.TrimSpace(p.AssistantText) != "" {
		out["text"] = strings.TrimSpace(p.AssistantText)
	}
	if p.Structured != nil {
		out["structured"] = p.Structured.payload()
	}
	if p.AssistantMemory != nil {
		out["assistant_memory"] = p.AssistantMemory.payload()
	}
	if p.Sidecar != nil {
		out["chat_sidecar"] = p.Sidecar.payload()
	}
	if p.FollowUp != nil {
		out["follow_up"] = p.FollowUp.payload()
	}
	if strings.TrimSpace(p.FinishReason) != "" {
		out["finish_reason"] = strings.TrimSpace(p.FinishReason)
	}
	if p.StreamSimulated {
		out["stream_simulated"] = true
	}
	if p.ReasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		out["reason_code"] = publicChatReasonCodeLabel(p.ReasonCode)
	}
	if strings.TrimSpace(p.ActionHint) != "" {
		out["action_hint"] = strings.TrimSpace(p.ActionHint)
	}
	if strings.TrimSpace(p.Message) != "" {
		out["message"] = strings.TrimSpace(p.Message)
	}
	return out
}

func publicChatExecutionBindingProjectionPayload(binding publicChatExecutionBinding) map[string]any {
	out := map[string]any{
		"route":    publicChatRouteLabel(binding.RoutePolicy),
		"model_id": strings.TrimSpace(binding.ModelID),
	}
	if strings.TrimSpace(binding.ConnectorID) != "" {
		out["connector_id"] = strings.TrimSpace(binding.ConnectorID)
	}
	return out
}

func publicChatPendingFollowUpPayload(followUp *publicChatFollowUpState) map[string]any {
	if followUp == nil {
		return map[string]any{}
	}
	return map[string]any{
		"status":              "scheduled",
		"follow_up_id":        followUp.FollowUpID,
		"scheduled_for":       followUp.ScheduledFor.UTC().Format(time.RFC3339Nano),
		"chain_id":            followUp.ChainID,
		"follow_up_depth":     followUp.FollowUpDepth,
		"max_follow_up_turns": followUp.MaxFollowUpTurns,
		"source_turn_id":      followUp.SourceTurnID,
		"source_action_id":    followUp.SourceActionID,
	}
}

func (s *Service) mutatePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	if turn.Projection == nil {
		turn.Projection = newPublicChatTurnProjection(turn)
	}
	projection := turn.Projection
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	if session := s.chatSessions[turn.SessionID]; session != nil {
		session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	}
	out := clonePublicChatTurnProjectionState(projection)
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

func (s *Service) finalizePublicChatTurnProjection(turnID string, persist bool, mutate func(*publicChatTurnProjectionState)) *publicChatTurnProjectionState {
	trimmedTurnID := strings.TrimSpace(turnID)
	if trimmedTurnID == "" {
		return nil
	}
	s.chatSurfaceMu.Lock()
	turn := s.chatTurns[trimmedTurnID]
	if turn == nil {
		s.chatSurfaceMu.Unlock()
		return nil
	}
	if turn.Projection == nil {
		turn.Projection = newPublicChatTurnProjection(turn)
	}
	projection := turn.Projection
	if mutate != nil {
		mutate(projection)
	}
	projection.UpdatedAt = time.Now().UTC()
	out := clonePublicChatTurnProjectionState(projection)
	if session := s.chatSessions[turn.SessionID]; session != nil {
		session.ActiveTurnSnapshot = nil
		session.LastTurnSnapshot = clonePublicChatTurnProjectionState(projection)
	}
	s.chatSurfaceMu.Unlock()
	if persist {
		s.persistCurrentPublicChatSurfaceState()
	}
	return out
}

func (s *Service) snapshotPublicChatSessionForCaller(callerAppID string, sessionID string) (publicChatSessionState, *publicChatTurnProjectionState, *publicChatTurnProjectionState, *publicChatFollowUpState, error) {
	trimmedSessionID := strings.TrimSpace(sessionID)
	if strings.TrimSpace(callerAppID) == "" || trimmedSessionID == "" {
		return publicChatSessionState{}, nil, nil, nil, status.Error(codes.InvalidArgument, "public chat session snapshot requires caller app and session id")
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	session := s.chatSessions[trimmedSessionID]
	if session == nil {
		return publicChatSessionState{}, nil, nil, nil, status.Error(codes.NotFound, "public chat session not found")
	}
	if session.CallerAppID != strings.TrimSpace(callerAppID) {
		return publicChatSessionState{}, nil, nil, nil, status.Error(codes.PermissionDenied, "public chat session caller mismatch")
	}
	snapshot := *session
	snapshot.Reasoning = clonePublicChatReasoningConfig(session.Reasoning)
	snapshot.Transcript = cloneChatMessages(session.Transcript)
	snapshot.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	snapshot.LastTurnSnapshot = clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	var activeTurn *publicChatTurnProjectionState
	if trimmedActiveTurnID := strings.TrimSpace(session.ActiveTurnID); trimmedActiveTurnID != "" && session.ActiveTurnSnapshot != nil {
		if turn := s.chatTurns[trimmedActiveTurnID]; turn != nil {
			activeTurn = clonePublicChatTurnProjectionState(turn.Projection)
		}
	}
	if activeTurn == nil {
		activeTurn = clonePublicChatTurnProjectionState(session.ActiveTurnSnapshot)
	}
	lastTurn := clonePublicChatTurnProjectionState(session.LastTurnSnapshot)
	var pendingFollowUp *publicChatFollowUpState
	if trimmedFollowUpID := strings.TrimSpace(session.PendingFollowUpID); trimmedFollowUpID != "" {
		if followUp := s.chatFollowUps[trimmedFollowUpID]; followUp != nil {
			copyFollowUp := *followUp
			pendingFollowUp = &copyFollowUp
		}
	}
	return snapshot, activeTurn, lastTurn, pendingFollowUp, nil
}

func publicChatSessionStatus(activeTurn *publicChatTurnProjectionState, pendingFollowUp *publicChatFollowUpState) string {
	if activeTurn != nil && strings.TrimSpace(activeTurn.TurnID) != "" {
		return "turn_active"
	}
	if pendingFollowUp != nil && strings.TrimSpace(pendingFollowUp.FollowUpID) != "" {
		return "follow_up_pending"
	}
	return "idle"
}

func clonePublicChatStructuredEnvelope(input *publicChatStructuredEnvelope) *publicChatStructuredEnvelope {
	if input == nil {
		return nil
	}
	out := &publicChatStructuredEnvelope{
		SchemaID: strings.TrimSpace(input.SchemaID),
		Message: publicChatStructuredMessage{
			MessageID: strings.TrimSpace(input.Message.MessageID),
			Text:      strings.TrimSpace(input.Message.Text),
		},
		Actions: make([]publicChatStructuredAction, 0, len(input.Actions)),
	}
	if input.StatusCue != nil {
		statusCue := *input.StatusCue
		if input.StatusCue.Intensity != nil {
			intensity := *input.StatusCue.Intensity
			statusCue.Intensity = &intensity
		}
		out.StatusCue = &statusCue
	}
	for _, action := range input.Actions {
		out.Actions = append(out.Actions, action)
	}
	return out
}

func clonePublicChatAssistantMemoryOutcome(input *publicChatAssistantMemoryOutcome) *publicChatAssistantMemoryOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}

func clonePublicChatSidecarOutcome(input *publicChatSidecarOutcome) *publicChatSidecarOutcome {
	if input == nil {
		return nil
	}
	out := *input
	out.CanceledHookIDs = append([]string(nil), input.CanceledHookIDs...)
	return &out
}

func clonePublicChatFollowUpOutcome(input *publicChatFollowUpOutcome) *publicChatFollowUpOutcome {
	if input == nil {
		return nil
	}
	out := *input
	return &out
}
