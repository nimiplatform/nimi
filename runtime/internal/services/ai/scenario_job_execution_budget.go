package ai

import (
	"context"
	"errors"
	"sync"
	"time"
)

var errScenarioJobExecutionResourceLimit = errors.New("finite execution resource budget exhausted")

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-execution-scope
// This budget starts only at actual Host execution admission. It has no clock
// while the Job waits, and stops when this Host invocation exits. It is never
// persisted or carried into another Job work/result-acquisition step.
type scenarioJobExecutionBudget struct {
	context.Context
	mu      sync.Mutex
	cancel  context.CancelCauseFunc
	timer   *time.Timer
	stopped bool
}

func newScenarioJobExecutionBudget(parent context.Context) *scenarioJobExecutionBudget {
	ctx, cancel := context.WithCancelCause(parent)
	return &scenarioJobExecutionBudget{Context: ctx, cancel: cancel}
}

func (b *scenarioJobExecutionBudget) Err() error {
	if errors.Is(context.Cause(b.Context), errScenarioJobExecutionResourceLimit) {
		return context.DeadlineExceeded
	}
	return b.Context.Err()
}

func (b *scenarioJobExecutionBudget) start(duration time.Duration) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.Err(); err != nil {
		return err
	}
	if b.timer != nil || b.stopped || duration <= 0 {
		return errors.New("execution budget must start exactly once")
	}
	b.timer = time.AfterFunc(duration, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if !b.stopped {
			b.cancel(errScenarioJobExecutionResourceLimit)
		}
	})
	return nil
}

func (b *scenarioJobExecutionBudget) stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.stopped = true
	if b.timer != nil {
		b.timer.Stop()
	}
}

func (b *scenarioJobExecutionBudget) close() { b.stop(); b.cancel(context.Canceled) }
