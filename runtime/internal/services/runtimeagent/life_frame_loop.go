package runtimeagent

import (
	"context"
	"time"
)

func (s *Service) runLifeFrameLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	defer s.lifeFrameWG.Wait()
	sweep := func(at time.Time) {
		if err := s.runLifeFrameSweep(ctx, at.UTC()); err != nil && ctx.Err() == nil {
			s.logger.Warn("Runtime life frame maintenance failed", "error", err)
		}
		s.maintainPublicChatFollowUps(at.UTC())
	}
	sweep(time.Now())
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			sweep(now)
		}
	}
}
