package ai

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func runtimeJobStopping() error {
	return status.Error(codes.Unavailable, "Runtime is shutting down")
}

// BeginRuntimeShutdown fences new claims, outbound intent, and publication.
// The existing writer continues to own late receipts from dispatches that won.
func (s *Service) BeginRuntimeShutdown() {
	if s != nil && s.scenarioJobs != nil {
		s.scenarioJobs.runtimeStopping.Store(true)
	}
}

// DrainRuntimeJobs stops boot-local work, including work for a Job whose
// public terminal won earlier. Startup recovery uses the last durable facts
// to interrupt unrecoverable work and retain accepted provider receipts.
func (s *Service) DrainRuntimeJobs(ctx context.Context) error {
	if s == nil || s.scenarioJobs == nil {
		return nil
	}
	s.BeginRuntimeShutdown()
	store := s.scenarioJobs
	store.mu.RLock()
	var cancels []context.CancelFunc
	for _, record := range store.jobs {
		if record != nil && record.cancel != nil {
			cancels = append(cancels, record.cancel)
		}
	}
	store.mu.RUnlock()
	for _, cancel := range cancels {
		cancel()
	}
	drained := make(chan struct{})
	go func() {
		store.runtimeWorkers.Wait()
		close(drained)
	}()
	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// The claim and worker count are published together under the Job writer.
func (s *scenarioJobStore) startClaimLocked(record *scenarioJobRecord) {
	record.executionStarted = true
	record.executionDone = make(chan struct{})
	record.runtimeWorkTracked = true
	s.runtimeWorkers.Add(1)
}

func (s *scenarioJobStore) takeTrackedRuntimeWork(jobID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	record := s.jobs[jobID]
	if record == nil || !record.runtimeWorkTracked {
		return false
	}
	record.runtimeWorkTracked = false
	return true
}
