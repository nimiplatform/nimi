package agentcore

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const lifeTrackLoopInterval = time.Second

type hookExecutionDecision struct {
	status     runtimev1.AgentHookStatus
	summary    string
	reasonCode runtimev1.ReasonCode
	message    string
	retryable  bool
	nextIntent *runtimev1.NextHookIntent
	tokensUsed int64
}

type hookExecutor func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)

type LifeTrackExecutor interface {
	ExecuteLifeTrackHook(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)
}

type rejectingLifeTrackExecutor struct{}

type dueHookRef struct {
	agentID      string
	hookID       string
	scheduledFor time.Time
}

func (rejectingLifeTrackExecutor) ExecuteLifeTrackHook(_ context.Context, _ *lifeTurnRequest) (*lifeTurnResult, error) {
	return nil, &lifeTurnExecutionError{
		status:     runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_REJECTED,
		reasonCode: runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		message:    "runtime internal life-track executor unavailable or not admitted",
	}
}

func (s *Service) HasLifeTrackExecutor() bool {
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if s.lifeExecutor == nil {
		return false
	}
	_, rejecting := s.lifeExecutor.(rejectingLifeTrackExecutor)
	return !rejecting
}

func (s *Service) currentLifeTrackExecutor() LifeTrackExecutor {
	s.lifeLoopMu.Lock()
	defer s.lifeLoopMu.Unlock()
	if s.lifeExecutor == nil {
		return rejectingLifeTrackExecutor{}
	}
	return s.lifeExecutor
}

func (s *Service) runLifeTrackLoop(ctx context.Context, done chan struct{}) {
	defer close(done)
	runMaintenanceSweep := func(now time.Time, lastCanonicalReviewSweep *time.Time) {
		if shouldRunCanonicalReviewSchedulingSweep(*lastCanonicalReviewSweep, now) {
			*lastCanonicalReviewSweep = now
			if err := s.runCanonicalReviewSchedulingSweep(ctx, now); err != nil && ctx.Err() == nil {
				s.logger.Warn("agentcore canonical-review scheduling sweep failed", "error", err)
			}
		}
		if err := s.runLifeTrackSweep(ctx, now); err != nil && ctx.Err() == nil {
			s.logger.Warn("agentcore life-track sweep failed", "error", err)
		}
	}
	var lastCanonicalReviewSweep time.Time
	runMaintenanceSweep(time.Now().UTC(), &lastCanonicalReviewSweep)
	ticker := time.NewTicker(lifeTrackLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			runMaintenanceSweep(tickAt.UTC(), &lastCanonicalReviewSweep)
		}
	}
}

func (s *Service) runLifeTrackSweep(ctx context.Context, now time.Time) error {
	if err := s.reconcileCadenceHooks(now); err != nil {
		return err
	}
	_, err := s.executeDueHooks(ctx, now, s.lifeTrackHookExecutor())
	if err != nil {
		return err
	}
	return s.reconcileCadenceHooks(now)
}

func (s *Service) lifeTrackHookExecutor() hookExecutor {
	executor := s.currentLifeTrackExecutor()
	return func(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		return executor.ExecuteLifeTrackHook(ctx, req)
	}
}
