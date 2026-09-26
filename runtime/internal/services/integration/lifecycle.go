package integration

import "context"

func (s *Service) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.closed {
		done := s.closeDone
		s.mu.Unlock()
		<-done
		return nil
	}
	s.closed = true
	s.cancel()
	s.cancelOwnedWorkLocked()
	s.mu.Unlock()
	s.workers.Wait()
	s.mu.Lock()
	s.clearTerminalCallsLocked()
	close(s.closeDone)
	s.mu.Unlock()
	return nil
}

func (s *Service) cancelOwnedWorkLocked() {
	for _, p := range s.providers {
		p.cancel()
	}
	for _, c := range s.calls {
		if c.expiry != nil {
			c.expiry.Stop()
			c.expiry = nil
		}
		s.cancelInvocationLocked(c)
	}
	for _, r := range s.receivers {
		r.cancel()
	}
}
func (s *Service) clearTerminalCallsLocked() {
	for id, c := range s.calls {
		if c.fact.Status != "accepted" {
			s.dropCallLocked(id)
		}
	}
}

// Admission remains closed until all canceled workers, including their final
// call-fact writes and scope watchers, finish. An aborted handoff may request
// reopening earlier; reopening then waits for that same drain without replay.
func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	s.quiesced.Store(true)
	s.resumePending = false
	if s.drainDone == nil {
		s.cancelOwnedWorkLocked()
		done := make(chan struct{})
		s.drainDone = done
		go func() {
			s.workers.Wait()
			s.mu.Lock()
			s.providers = map[string]*provider{}
			s.receivers = map[string]*telegramReceiver{}
			s.clearTerminalCallsLocked()
			close(done)
			if s.resumePending && !s.closed {
				s.quiesced.Store(false)
				s.drainDone = nil
				s.resumePending = false
			}
			s.mu.Unlock()
		}()
	}
	done := s.drainDone
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return nil
	}
}
func (s *Service) ResumeDataRootAfterAbort() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || !s.quiesced.Load() {
		return
	}
	s.resumePending = true
	if s.drainDone == nil || closed(s.drainDone) {
		s.quiesced.Store(false)
		s.drainDone = nil
		s.resumePending = false
	}
}
