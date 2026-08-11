package runtimeagent

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) SetPublicChatTurnExecutor(executor PublicChatTurnExecutor) {
	if s == nil || s.isClosed() {
		return
	}
	s.setPublicChatTurnExecutor(executor)
	s.resumeRecoveredPublicChatFollowUps()
}
func (s *Service) HasPublicChatTurnExecutor() bool {
	if s == nil || s.isClosed() {
		return false
	}
	_, rejecting := s.currentPublicChatTurnExecutor().(rejectingPublicChatTurnExecutor)
	return !rejecting
}
func (s *Service) SetPublicChatAppEmitter(emitter publicChatAppMessageEmitter) {
	if s == nil || s.isClosed() {
		return
	}
	s.chatAppEmit = emitter
	if emitter != nil {
		s.resumeRecoveredPublicChatFollowUps()
	}
}
func (s *Service) ConsumePublicChatAppMessage(ctx context.Context, event *runtimev1.AppMessageEvent) error {
	return s.publicChatRuntime().consumeAppMessage(ctx, event)
}
func (s *Service) handlePublicChatTurnRequest(
	ctx context.Context,
	event *runtimev1.AppMessageEvent,
	req publicChatTurnRequestPayload,
) error {
	return s.publicChatRuntime().handleTurnRequest(ctx, event, req)
}
func (s *Service) handlePublicChatTurnInterrupt(
	event *runtimev1.AppMessageEvent,
	req publicChatTurnInterruptPayload,
) error {
	return s.publicChatRuntime().handleTurnInterrupt(event, req)
}
func (s *Service) runPublicChatTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
) {
	s.publicChatRuntime().runTurn(ctx, session, turn, req)
}
func (s *Service) reservePublicChatTurn(
	parent context.Context,
	callerAppID string,
	subjectUserID string,
	req publicChatTurnRequestPayload,
) (publicChatAnchorState, publicChatTurnState, context.Context, error) {
	return s.publicChatRuntime().reserveTurn(parent, callerAppID, subjectUserID, req)
}
func (s *Service) releasePublicChatTurn(sessionID string, turnID string) {
	s.publicChatRuntime().releaseTurn(sessionID, turnID)
}
func (s *Service) lookupPublicChatTurnForInterrupt(
	callerAppID string,
	subjectUserID string,
	req publicChatTurnInterruptPayload,
) (publicChatAnchorState, publicChatTurnState, error) {
	return s.publicChatRuntime().lookupTurnForInterrupt(callerAppID, subjectUserID, req)
}
func (s *Service) publicChatInterruptStatus(turnID string) (bool, string, string) {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return false, "", ""
	}
	return turn.Interrupted, turn.InterruptReason, turn.LastKnownTraceID
}
func (s *Service) nextPublicChatStreamSequence(turnID string) uint64 {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return 0
	}
	turn.StreamSequence++
	if turn.TerminalProjection != nil {
		turn.TerminalProjection.StreamSequence = turn.StreamSequence
	}
	if turn.Projection != nil {
		turn.Projection.StreamSequence = turn.StreamSequence
		if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil && session.ActiveTurnSnapshot != nil {
			session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
		}
	}
	return turn.StreamSequence
}

// publicChatTurnStreamID returns the runtime-owned foreground stream id for
// the given turn. Per K-AGCORE-030 stream identity is distinct from turn
// identity; per K-AGCORE-037 `runtime.agent.turn.*` and
// `runtime.agent.presentation.*` envelopes require real `stream_id`.
func (s *Service) publicChatTurnStreamID(turnID string) string {
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	turn := s.chatTurns[strings.TrimSpace(turnID)]
	if turn == nil {
		return ""
	}
	return strings.TrimSpace(turn.StreamID)
}
func (s *Service) recordPublicChatTraceID(turnID string, traceID string) {
	if strings.TrimSpace(turnID) == "" || strings.TrimSpace(traceID) == "" {
		return
	}
	s.chatSurfaceMu.Lock()
	defer s.chatSurfaceMu.Unlock()
	if turn := s.chatTurns[strings.TrimSpace(turnID)]; turn != nil {
		turn.LastKnownTraceID = strings.TrimSpace(traceID)
		if turn.Projection != nil {
			turn.Projection.TraceID = strings.TrimSpace(traceID)
			turn.Projection.UpdatedAt = time.Now().UTC()
			if session := s.chatAnchors[turn.ConversationAnchorID]; session != nil {
				session.ActiveTurnSnapshot = clonePublicChatTurnProjectionState(turn.Projection)
			}
		}
	}
}
func (s *Service) setPublicChatExecutionState(
	agentID string,
	subjectUserID string,
	worldID string,
	state runtimev1.AgentExecutionState,
) error {
	return s.publicChatRuntime().setExecutionState(agentID, subjectUserID, worldID, state)
}
func (s *Service) setPublicChatExecutionStateWithOrigin(
	agentID string,
	subjectUserID string,
	worldID string,
	state runtimev1.AgentExecutionState,
	origin stateEventOrigin,
) error {
	return s.publicChatRuntime().setExecutionStateWithOrigin(agentID, subjectUserID, worldID, state, origin)
}
func (s *Service) emitPublicChatTurnInterrupted(
	session publicChatAnchorState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	reason string,
) {
	s.publicChatRuntime().emitTurnInterrupted(session, turn, traceID, modelResolved, routeDecision, reason)
}
func (s *Service) emitPublicChatTurnFailed(
	session publicChatAnchorState,
	turn publicChatTurnState,
	traceID string,
	modelResolved string,
	routeDecision runtimev1.RoutePolicy,
	reasonCode runtimev1.ReasonCode,
	message string,
	actionHint string,
) {
	s.publicChatRuntime().emitTurnFailed(session, turn, traceID, modelResolved, routeDecision, reasonCode, message, actionHint)
}
func (s *Service) emitPublicChatTurnEvent(
	session publicChatAnchorState,
	turnID string,
	messageType string,
	payload map[string]any,
) error {
	return s.publicChatRuntime().emitTurnEvent(session, turnID, messageType, payload)
}
func (s *Service) emitPublicChatEvent(
	subjectUserID string,
	messageType string,
	payload map[string]any,
) error {
	return s.publicChatRuntime().emitEvent(subjectUserID, messageType, payload)
}
func (s *Service) shutdownPublicChatSurface() {
	s.publicChatRuntime().shutdownSurface()
}
func (s *Service) startPublicChatAsync(fn func()) bool {
	if s == nil || fn == nil {
		return false
	}
	s.chatSurfaceMu.Lock()
	if s.isClosed() {
		s.chatSurfaceMu.Unlock()
		return false
	}
	s.chatAsyncWG.Add(1)
	s.chatSurfaceMu.Unlock()
	go func() {
		defer s.chatAsyncWG.Done()
		fn()
	}()
	return true
}

func (s *Service) publicChatAsyncLifetime() context.Context {
	if s == nil {
		return context.Background()
	}
	s.chatSurfaceMu.Lock()
	lifetime := s.chatAsyncLifecycleCtx
	s.chatSurfaceMu.Unlock()
	if lifetime == nil {
		return context.Background()
	}
	return lifetime
}
func (s *Service) applyPublicChatPostTurn(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	req publicChatTurnRequestPayload,
	structured *publicChatStructuredEnvelope,
) publicChatPostTurnOutcome {
	return s.publicChatRuntime().applyPostTurn(ctx, session, turn, req, structured)
}
func (s *Service) applyPublicChatAssistantTurnMemory(
	ctx context.Context,
	session publicChatAnchorState,
	turn publicChatTurnState,
	assistantText string,
) publicChatAssistantMemoryOutcome {
	return s.publicChatRuntime().applyAssistantTurnMemory(ctx, session, turn, assistantText)
}
