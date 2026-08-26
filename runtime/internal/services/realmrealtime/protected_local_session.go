package realmrealtime

import "github.com/nimiplatform/nimi/runtime/internal/realtimecore"

// @nimi-authority: rule.nimi.runtime.protected-session.r016
func (s *Service) RevokeProtectedLocalAppRealmRealtimeChannel(channelID string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	channel := s.channels[channelID]
	s.mu.Unlock()
	if channel != nil {
		s.closeChannel(channel, realtimecore.TerminalStaleGeneration)
	}
}
