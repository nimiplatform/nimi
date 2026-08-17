package ai

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/metadata"
)

func scenarioJobContext(appID string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

func scenarioJobUserContext(appID string, subjectUserID string) context.Context {
	return authn.WithIdentity(scenarioJobContext(appID), &authn.Identity{SubjectUserID: subjectUserID})
}

func TestDetachedAsyncJobContextDropsRequestMetadataAndCredentials(t *testing.T) {
	parent, cancel := context.WithCancel(metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"authorization", "Bearer request-secret",
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-trace-id", "trace-123",
	)))
	parent = metadata.NewOutgoingContext(parent, metadata.Pairs(
		"authorization", "Bearer request-secret",
		"x-nimi-participant-id", "nimi.desktop.test",
	))

	child := newDetachedAsyncJobContext(parent)
	cancel()
	if _, ok := metadata.FromIncomingContext(child); ok {
		t.Fatal("detached job retained incoming request metadata")
	}
	if _, ok := metadata.FromOutgoingContext(child); ok {
		t.Fatal("detached job retained outgoing request metadata")
	}
	if err := child.Err(); err != nil {
		t.Fatalf("detached job inherited parent cancellation: %v", err)
	}
}

func waitScenarioJobTerminal(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.ScenarioJob {
	t.Helper()
	queryCtx := scenarioJobContext("nimi.desktop")
	if stored, ok := svc.scenarioJobs.get(jobID); ok && stored.GetHead().GetSubjectUserId() != anonymousScenarioJobOwner {
		queryCtx = scenarioJobUserContext("nimi.desktop", stored.GetHead().GetSubjectUserId())
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetScenarioJob(queryCtx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("get scenario job: %v", err)
		}
		switch resp.GetJob().GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return resp.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetScenarioJob(queryCtx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get scenario job: %v", err)
	}
	t.Fatalf("scenario job timeout: id=%s status=%s", jobID, resp.GetJob().GetStatus().String())
	return nil
}

type scenarioJobEventCollector struct {
	ctx    context.Context
	events []*runtimev1.ScenarioJobEvent
}

func (s *scenarioJobEventCollector) Send(event *runtimev1.ScenarioJobEvent) error {
	s.events = append(s.events, event)
	return nil
}

func (s *scenarioJobEventCollector) SetHeader(_ metadata.MD) error  { return nil }
func (s *scenarioJobEventCollector) SendHeader(_ metadata.MD) error { return nil }
func (s *scenarioJobEventCollector) SetTrailer(_ metadata.MD)       {}
func (s *scenarioJobEventCollector) Context() context.Context       { return s.ctx }
func (s *scenarioJobEventCollector) SendMsg(any) error              { return nil }
func (s *scenarioJobEventCollector) RecvMsg(any) error              { return nil }

// TestSubscribeJobEventsTerminalThenClose (K-STREAM-005) verifies that when a
// scenario job reaches a terminal state, subscribers receive the terminal event
// and that subscribing to an already-terminal job returns the full backlog with
// terminal=true.
func TestSubscribeJobEventsTerminalThenClose(t *testing.T) {
	store := newScenarioJobStore()

	// Create a SUBMITTED job.
	job := &runtimev1.ScenarioJob{
		JobId:        "stream-edge-001",
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		TraceId:      "trace-stream-001",
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	snapshot := store.create(job, cancel)
	if snapshot == nil {
		t.Fatalf("store.create returned nil")
	}

	// Subscribe before any transitions beyond SUBMITTED.
	subID, ch, backlog, terminal, ok := store.subscribe("stream-edge-001", 32)
	if !ok {
		t.Fatalf("subscribe should succeed for existing job")
	}
	if terminal {
		t.Fatalf("terminal should be false for a SUBMITTED job")
	}
	// Backlog should contain the SUBMITTED event emitted by create.
	if len(backlog) == 0 {
		t.Fatalf("backlog should contain the SUBMITTED event")
	}
	if backlog[0].GetEventType() != runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED {
		t.Fatalf("first backlog event should be SUBMITTED, got %v", backlog[0].GetEventType())
	}

	// Transition to RUNNING.
	if _, ok, err := store.transition(
		"stream-edge-001",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING,
		nil,
	); err != nil || !ok {
		t.Fatalf("transition to RUNNING failed: %v", err)
	}
	if _, ok, err := store.updateProgress("stream-edge-001", 4, 8, 50); err != nil || !ok {
		t.Fatalf("updateProgress failed: %v", err)
	}

	// Transition to COMPLETED (terminal).
	if _, ok, err := store.transition(
		"stream-edge-001",
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(j *runtimev1.ScenarioJob) {
			j.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		},
	); err != nil || !ok {
		t.Fatalf("transition to COMPLETED failed: %v", err)
	}

	// Drain events from the channel; expect RUNNING then COMPLETED.
	var received []*runtimev1.ScenarioJobEvent
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event, open := <-ch:
			if !open {
				// Channel was closed by unsubscribe; stop draining.
				goto drained
			}
			received = append(received, event)
			if isTerminalScenarioJobEvent(event.GetEventType()) {
				goto drained
			}
		case <-timeout:
			t.Fatalf("timed out waiting for events on subscriber channel")
		}
	}
drained:
	if len(received) < 2 {
		t.Fatalf("expected at least 2 events (RUNNING + COMPLETED), got %d", len(received))
	}

	var gotRunning, gotCompleted, gotProgress bool
	for _, event := range received {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			gotRunning = true
			if event.GetJob().GetProgressPercent() == 50 && event.GetJob().GetProgressCurrentStep() == 4 && event.GetJob().GetProgressTotalSteps() == 8 {
				gotProgress = true
			}
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED:
			gotCompleted = true
		}
	}
	if !gotRunning {
		t.Fatalf("expected RUNNING event on subscriber channel")
	}
	if !gotCompleted {
		t.Fatalf("expected COMPLETED (terminal) event on subscriber channel")
	}
	if !gotProgress {
		t.Fatalf("expected RUNNING event carrying progress snapshot")
	}

	// Unsubscribe closes the channel.
	store.unsubscribe("stream-edge-001", subID)
	select {
	case _, open := <-ch:
		if open {
			t.Fatalf("channel should be closed after unsubscribe")
		}
	default:
		// Channel already closed; acceptable.
	}
	_ = ctx // keep linter happy

	// --- Late subscriber: subscribe to an already-terminal job ---
	lateSubID, lateCh, lateBacklog, lateTerminal, lateOK := store.subscribe("stream-edge-001", 32)
	if !lateOK {
		t.Fatalf("late subscribe should succeed for existing terminal job")
	}
	if !lateTerminal {
		t.Fatalf("late subscriber should see terminal=true")
	}
	// Backlog should contain all events: SUBMITTED, RUNNING, COMPLETED.
	if len(lateBacklog) < 3 {
		t.Fatalf("late backlog should have at least 3 events (SUBMITTED+RUNNING+COMPLETED), got %d", len(lateBacklog))
	}
	var lateHasSubmitted, lateHasRunning, lateHasCompleted bool
	for _, event := range lateBacklog {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_SUBMITTED:
			lateHasSubmitted = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			lateHasRunning = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED:
			lateHasCompleted = true
		}
	}
	if !lateHasSubmitted {
		t.Fatalf("late backlog missing SUBMITTED event")
	}
	if !lateHasRunning {
		t.Fatalf("late backlog missing RUNNING event")
	}
	if !lateHasCompleted {
		t.Fatalf("late backlog missing COMPLETED event")
	}

	// Clean up late subscriber.
	store.unsubscribe("stream-edge-001", lateSubID)
	select {
	case _, open := <-lateCh:
		if open {
			t.Fatalf("late channel should be closed after unsubscribe")
		}
	default:
	}
}
