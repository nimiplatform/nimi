package runtimeagent

import (
	"context"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const lifeTrackLoopInterval = time.Second

// hookExecutionDecision is the runtime-side decision carried from gate /
// executor into the admission-state transition writer. `admissionState` is
// the target committed state; `nextIntent` is set on RESCHEDULED only and
// must be a valid HookIntent per K-AGCORE-041.
type hookExecutionDecision struct {
	admissionState runtimev1.HookAdmissionState
	summary        string
	reasonCode     runtimev1.ReasonCode
	message        string
	retryable      bool
	nextIntent     *runtimev1.HookIntent
	tokensUsed     int64
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
		admissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_REJECTED,
		reasonCode:     runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED,
		message:        "runtime internal life-track executor unavailable or not admitted",
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
