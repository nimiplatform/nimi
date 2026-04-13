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
	if err := s.runLifeTrackSweep(ctx, time.Now().UTC()); err != nil && ctx.Err() == nil {
		s.logger.Warn("agentcore life-track sweep failed", "error", err)
	}
	ticker := time.NewTicker(lifeTrackLoopInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case tickAt := <-ticker.C:
			if err := s.runLifeTrackSweep(ctx, tickAt.UTC()); err != nil && ctx.Err() == nil {
				s.logger.Warn("agentcore life-track sweep failed", "error", err)
			}
		}
	}
}

func (s *Service) runLifeTrackSweep(ctx context.Context, now time.Time) error {
	_, err := s.executeDueHooks(ctx, now, s.lifeTrackHookExecutor())
	return err
}

func (s *Service) lifeTrackHookExecutor() hookExecutor {
	executor := s.currentLifeTrackExecutor()
	return func(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
		return executor.ExecuteLifeTrackHook(ctx, req)
	}
}
