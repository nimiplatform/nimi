package ai

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
)

// @nimi-authority: rule.nimi.runtime.protected-session.r016
// RevokeProtectedLocalAppAIRealtimeSession is Runtime-private technical-session
// cleanup. It does not add an App operation or expose provider state.
func (s *Service) RevokeProtectedLocalAppAIRealtimeSession(sessionID string) {
	if s == nil || s.realtimeSessions == nil {
		return
	}
	record, ok := s.realtimeSessions.get(sessionID)
	if !ok {
		return
	}
	s.terminalizeRealtimeSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalStaleGeneration)
}
