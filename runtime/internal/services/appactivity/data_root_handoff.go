package appactivity

import "context"

// @nimi-authority: rule.nimi.runtime.app-surface.r101
// QuiesceDataRootContext is called after root RPCs and producer owners drain.
// The periodic worker may stay alive, but no retention I/O can cross activation.
func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.rootQuiesced.Store(true)
	acquired := make(chan struct{})
	go func() {
		s.retentionMu.Lock()
		select {
		case acquired <- struct{}{}:
		case <-ctx.Done():
			s.retentionMu.Unlock()
		}
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-acquired:
		s.retentionMu.Unlock()
		return nil
	}
}

// ResumeDataRootAfterAbort reopens only the same owner after a pre-commit abort.
// It does not create a second timer or revive canceled activity-open requests.
func (s *Service) ResumeDataRootAfterAbort() {
	if s != nil {
		s.rootQuiesced.Store(false)
	}
}
