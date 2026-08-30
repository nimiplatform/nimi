package runtimeagent

import (
	"context"
	"fmt"
)

// QuiesceDataRoot stops only work that can retain Runtime owner-store paths.
// Canonical records and injected owner seams remain intact so a pre-commit
// Product Control abort can reopen the unchanged activation.
func (s *Service) QuiesceDataRoot() {
	_ = s.QuiesceDataRootContext(context.Background())
}

func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil || s.closed.Load() || s.dataRootHandoffClosed.Swap(true) {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.sourceCognitionLifecycleMu.Lock()
	if s.sourceCognitionLifecycleCancel != nil {
		s.sourceCognitionLifecycleCancel()
	}
	s.sourceCognitionLifecycleMu.Unlock()

	s.accountTerminationRetryMu.Lock()
	s.cognitionMemoryDrainMu.Lock()
	if s.cognitionMemoryLifecycleCancel != nil {
		s.cognitionMemoryLifecycleCancel()
	}
	s.cognitionMemoryDrainMu.Unlock()
	s.accountTerminationRetryMu.Unlock()

	s.chatSurfaceMu.Lock()
	chatCancel := s.chatAsyncLifecycleCancel
	turns := make([]*publicChatTurnState, 0, len(s.chatTurns))
	for _, turn := range s.chatTurns {
		if turn != nil {
			turns = append(turns, turn)
		}
	}
	followUps := make([]*publicChatFollowUpState, 0, len(s.chatFollowUps))
	for _, followUp := range s.chatFollowUps {
		if followUp != nil {
			followUps = append(followUps, followUp)
		}
	}
	s.chatSurfaceMu.Unlock()
	if chatCancel != nil {
		chatCancel()
	}
	for _, turn := range turns {
		if turn.Cancel != nil {
			turn.Cancel()
		}
	}
	for _, followUp := range followUps {
		if followUp.Cancel != nil {
			followUp.Cancel()
		}
	}
	if err := s.stopLifeTrackLoopForDataRoot(ctx); err != nil {
		return err
	}
	if err := s.shutdownAgentRealtimeContext(ctx); err != nil {
		return fmt.Errorf("close Runtime Agent realtime for data-root handoff: %w", err)
	}
	done := make(chan struct{})
	go func() {
		s.sourceCognitionWG.Wait()
		s.cognitionMemoryWG.Wait()
		s.chatAsyncWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("drain Runtime Agent root-bound work: %w", ctx.Err())
	}
}

func (s *Service) stopLifeTrackLoopForDataRoot(ctx context.Context) error {
	s.lifeLoopMu.Lock()
	cancel := s.lifeLoopCancel
	done := s.lifeLoopDone
	s.lifeLoopCancel = nil
	s.lifeLoopDone = nil
	s.lifeLoopMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("stop Runtime Agent LifeTrack loop: %w", ctx.Err())
	}
}

func (s *Service) ResumeDataRootAfterAbort() {
	if s == nil || s.closed.Load() || !s.dataRootHandoffClosed.Load() {
		return
	}
	s.sourceCognitionLifecycleMu.Lock()
	s.sourceCognitionLifecycleCtx, s.sourceCognitionLifecycleCancel = context.WithCancel(context.Background())
	s.sourceCognitionLifecycleMu.Unlock()
	s.cognitionMemoryDrainMu.Lock()
	s.cognitionMemoryLifecycleCtx, s.cognitionMemoryLifecycleCancel = context.WithCancel(context.Background())
	s.cognitionMemoryDraining = make(map[string]bool)
	s.cognitionMemoryDrainPending = make(map[string]bool)
	s.cognitionMemoryDrainMu.Unlock()
	s.chatSurfaceMu.Lock()
	s.chatAsyncLifecycleCtx, s.chatAsyncLifecycleCancel = context.WithCancel(context.Background())
	s.chatSurfaceMu.Unlock()
	s.dataRootHandoffClosed.Store(false)
	_ = s.StartLifeTrackLoop(context.Background())
}
