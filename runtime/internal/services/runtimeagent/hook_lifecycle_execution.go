package runtimeagent

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) executeDueHooks(ctx context.Context, now time.Time, executor hookExecutor) ([]*runtimev1.HookExecutionOutcome, error) {
	return s.lifeTrackController().executeDueHooks(ctx, now, executor)
}

func (s *Service) executePendingHook(ctx context.Context, agentID string, hookID string, now time.Time, executor hookExecutor) (*runtimev1.HookExecutionOutcome, error) {
	return s.lifeTrackController().executePendingHook(ctx, agentID, hookID, now, executor)
}

func (s *Service) applyHookDecision(agentID string, hookID string, decision *hookExecutionDecision, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.lifeTrackController().applyHookDecision(agentID, hookID, decision, now)
}

func (s *Service) assembleLifeTurnRecall(ctx context.Context, entry *agentEntry, limit int32) ([]*runtimev1.CanonicalMemoryView, error) {
	return s.lifeTrackController().assembleRecall(ctx, entry, limit)
}

func (s *Service) applyLifeTurnResult(ctx context.Context, agentID string, hookID string, result *lifeTurnResult, now time.Time) (*runtimev1.HookExecutionOutcome, error) {
	return s.lifeTrackController().applyResult(ctx, agentID, hookID, result, now)
}
