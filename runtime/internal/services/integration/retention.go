package integration

import "time"

// Results are retained for at most fifteen minutes and 512 total call slots.
// Capacity pressure evicts the oldest terminal result; it never evicts an
// accepted invocation. An all-active full store rejects before acceptance.
func (s *Service) reserveCallSlotLocked(now time.Time) bool {
	s.pruneCallsLocked(now)
	if len(s.calls) < maxRetainedCalls {
		return true
	}
	var oldestID string
	var oldest time.Time
	for id, c := range s.calls {
		if c.fact.Status != "accepted" && (oldestID == "" || c.fact.UpdatedAt.AsTime().Before(oldest)) {
			oldestID, oldest = id, c.fact.UpdatedAt.AsTime()
		}
	}
	if oldestID == "" {
		return false
	}
	s.dropCallLocked(oldestID)
	return true
}
func (s *Service) pruneCallsLocked(now time.Time) {
	for id, c := range s.calls {
		if c.fact.Status != "accepted" && !now.Before(c.fact.UpdatedAt.AsTime().Add(resultRetention)) {
			s.dropCallLocked(id)
		}
	}
}
func (s *Service) dropCallLocked(id string) {
	if c := s.calls[id]; c != nil {
		if c.expiry != nil {
			c.expiry.Stop()
			c.expiry = nil
		}
		c.input, c.credential, c.fact.ResultJson = "", "", ""
		delete(s.calls, id)
	}
}
func (s *Service) scheduleCallExpiryLocked(c *invocation) {
	if s.closed || s.quiesced.Load() {
		s.dropCallLocked(c.fact.CallId)
		return
	}
	if c.expiry != nil {
		c.expiry.Stop()
	}
	delay := time.Until(c.fact.UpdatedAt.AsTime().Add(resultRetention))
	c.expiry = time.AfterFunc(delay, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.calls[c.fact.CallId] == c {
			s.dropCallLocked(c.fact.CallId)
		}
	})
}
