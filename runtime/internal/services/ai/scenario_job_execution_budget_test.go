package ai

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestScenarioJobExecutionBudgetStartsAtHostAdmission(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	budget := newScenarioJobExecutionBudget(parent)
	defer budget.close()
	select {
	case <-budget.Done():
		t.Fatal("queued Job acquired an execution deadline")
	case <-time.After(20 * time.Millisecond):
	}
	if err := budget.start(10 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	select {
	case <-budget.Done():
	case <-time.After(time.Second):
		t.Fatal("finite Host budget failed to stop its work")
	}
	if !errors.Is(budget.Err(), context.DeadlineExceeded) || !errors.Is(context.Cause(budget), errScenarioJobExecutionResourceLimit) {
		t.Fatal("resource limit lost its distinct cause")
	}
	if parent.Err() != nil {
		t.Fatal("one work timeout canceled the whole Job")
	}
}

func TestScenarioJobExecutionBudgetEndsWithHostAndDoesNotBoundResultWork(t *testing.T) {
	budget := newScenarioJobExecutionBudget(context.Background())
	defer budget.close()
	if err := budget.start(200 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
	budget.stop()
	select {
	case <-budget.Done():
		t.Fatal("finished Host timer canceled later result work")
	case <-time.After(220 * time.Millisecond):
	}
	if err := budget.start(time.Second); err == nil {
		t.Fatal("one work budget was restarted")
	}
}
