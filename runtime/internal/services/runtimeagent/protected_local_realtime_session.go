package runtimeagent

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// @nimi-authority: rule.nimi.runtime.protected-session.r016
// RevokeProtectedLocalAppAgentRealtimeSession closes one App-owned transient
// media session when its technical session is replaced or revoked.
func (s *Service) RevokeProtectedLocalAppAgentRealtimeSession(sessionID string) {
	if s == nil {
		return
	}
	s.agentRealtimeMu.Lock()
	session := s.agentRealtimeSessions[strings.TrimSpace(sessionID)]
	executor := s.agentRealtimeAI
	if session != nil {
		delete(s.agentRealtimeSessions, session.realtimeSessionID)
		session.mu.Lock()
		session.closed = true
		session.mu.Unlock()
	}
	s.agentRealtimeMu.Unlock()
	if session == nil {
		return
	}
	if active := session.detachTurn(); active != nil {
		s.interruptDetachedAgentRealtimeTurn(active, "session_revoked")
	}
	if executor != nil {
		_, _ = executor.CloseRuntimeAgentRealtime(context.Background(), session.accountID, &runtimev1.CloseRealtimeSessionRequest{
			RealtimeSessionId: session.realtimeSessionID,
			Generation:        session.generation,
		})
	}
}
