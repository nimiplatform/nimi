package runtimeagent

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
	return s.lifeTrackController().hasExecutor()
}

func (s *Service) currentLifeTrackExecutor() LifeTrackExecutor {
	return s.lifeTrackController().currentExecutor()
}

func (s *Service) runLifeTrackLoop(ctx context.Context, done chan struct{}) {
	s.lifeTrackController().runLoop(ctx, done)
}

func (s *Service) runLifeTrackSweep(ctx context.Context, now time.Time) error {
	return s.lifeTrackController().runSweep(ctx, now)
}

func (s *Service) lifeTrackHookExecutor() hookExecutor {
	return s.lifeTrackController().hookExecutor()
}
