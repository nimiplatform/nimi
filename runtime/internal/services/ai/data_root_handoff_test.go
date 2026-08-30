package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDataRootHandoffWaitsForInFlightScenarioJobTerminal(t *testing.T) {
	store := newScenarioJobStore()
	jobCtx, cancel := context.WithCancel(context.Background())
	now := timestamppb.New(time.Now().UTC())
	jobID := "scenario-root-handoff"
	store.create(&runtimev1.ScenarioJob{
		JobId: jobID, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		CreatedAt: now, UpdatedAt: now,
	}, cancel)
	store.mu.Lock()
	store.jobs[jobID].executionStarted = true
	store.mu.Unlock()
	go func() {
		<-jobCtx.Done()
		_, _, _ = store.transition(
			jobID,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
			func(job *runtimev1.ScenarioJob) {
				job.ReasonDetail = "data-root handoff interrupted in-flight execution"
			},
		)
	}()
	service := &Service{scenarioJobs: store}
	service.QuiesceDataRoot()
	terminal, ok := store.get(jobID)
	if !ok || terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("root handoff scenario terminal = %+v", terminal)
	}
}

func TestDataRootHandoffRespectsContextWhileScenarioJobDoesNotTerminalize(t *testing.T) {
	store := newScenarioJobStore()
	jobCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	now := timestamppb.New(time.Now().UTC())
	jobID := "scenario-root-handoff-stuck"
	store.create(&runtimev1.ScenarioJob{
		JobId: jobID, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		CreatedAt: now, UpdatedAt: now,
	}, cancel)
	store.mu.Lock()
	store.jobs[jobID].executionStarted = true
	store.mu.Unlock()
	service := &Service{scenarioJobs: store}
	ctx, stop := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer stop()
	if err := service.QuiesceDataRootContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("root handoff wait error = %v, want deadline exceeded", err)
	}
	_ = jobCtx
}
