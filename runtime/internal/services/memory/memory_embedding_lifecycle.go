package memory

import (
	"context"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) executeMemoryEmbeddingVectors(
	ctx context.Context,
	executor MemoryEmbeddingVectorExecutor,
	profile *runtimev1.MemoryEmbeddingProfile,
	raws []string,
) ([][]float64, error) {
	executionCtx, finish, err := s.beginMemoryEmbeddingExecution(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	return embeddingVectorsWithExecutor(executionCtx, executor, profile, raws)
}

func (s *Service) beginMemoryEmbeddingExecution(ctx context.Context) (context.Context, func(), error) {
	if s == nil {
		return nil, nil, context.Canceled
	}
	if ctx == nil {
		ctx = context.Background()
	}

	s.embeddingLifecycleMu.Lock()
	if s.embeddingClosing {
		s.embeddingLifecycleMu.Unlock()
		return nil, nil, context.Canceled
	}
	if s.embeddingLifecycleCtx == nil {
		s.embeddingLifecycleCtx, s.embeddingLifecycleCancel = context.WithCancel(context.Background())
	}
	lifetimeCtx := s.embeddingLifecycleCtx
	s.embeddingInflight.Add(1)
	s.embeddingLifecycleMu.Unlock()

	executionCtx, cancelExecution := context.WithCancel(ctx)
	stopLifetimeCancellation := context.AfterFunc(lifetimeCtx, cancelExecution)
	if lifetimeCtx.Err() != nil {
		cancelExecution()
	}
	var finishOnce sync.Once
	finish := func() {
		finishOnce.Do(func() {
			stopLifetimeCancellation()
			cancelExecution()
			s.embeddingInflight.Done()
		})
	}
	return executionCtx, finish, nil
}

func (s *Service) closeMemoryEmbeddingAdmissions() {
	s.embeddingLifecycleMu.Lock()
	if s.embeddingClosing {
		s.embeddingLifecycleMu.Unlock()
		return
	}
	s.embeddingClosing = true
	cancel := s.embeddingLifecycleCancel
	s.embeddingLifecycleMu.Unlock()
	if cancel != nil {
		cancel()
	}
}
