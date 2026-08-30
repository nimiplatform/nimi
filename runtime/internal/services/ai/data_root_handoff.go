package ai

import "context"

// QuiesceDataRoot terminates Runtime-owned ephemeral execution that may retain
// paths captured from the current root. Durable completed Job and artifact
// records remain owned by the scenario store; no Job is rebound to a new root.
func (s *Service) QuiesceDataRoot() {
	_ = s.QuiesceDataRootContext(context.Background())
}

func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.ShutdownRealtime()
	if s.scenarioJobs == nil {
		return nil
	}
	s.scenarioJobs.mu.Lock()
	cancels := make([]func(), 0)
	waits := make([]<-chan struct{}, 0)
	for _, record := range s.scenarioJobs.jobs {
		if record == nil || record.job == nil || isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		if record.cancel != nil {
			cancels = append(cancels, record.cancel)
		}
		if record.done != nil && !record.doneClosed {
			waits = append(waits, record.done)
		}
	}
	s.scenarioJobs.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	for _, done := range waits {
		select {
		case <-done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}
