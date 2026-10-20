package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
	"testing"
	"time"
)

// TestRuntimeAgentTerminateBroadcastsTeardownThenHardDeletes is the
// K-AGCORE-141 conformance for the terminate execution-state teardown.
//
// Pre-K-AGCORE-141 TerminateAgent flipped the agent to a TERMINATED tombstone
// and persisted a SUSPENDED execution-state projection event replayable via a
// subscriber cursor. K-AGCORE-141 makes TerminateAgent a hard delete: the
// agent state projection and the agent event log are removed, so there is no
// surviving SUSPENDED state and no persisted event to cursor-replay. The
// execution-state teardown is instead broadcast to live subscribers as
// observability of the in-flight cancellation, then the projection is gone.
func TestRuntimeAgentTerminateBroadcastsTeardownThenHardDeletes(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx, cancel := context.WithCancel(authenticatedRuntimeAgentTestContext(context.Background(), "user-1"))
	defer cancel()
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}

	// Attach a live STATE subscriber before terminate. The teardown event is
	// broadcast-only (the persisted event log for the agent is deleted), so it
	// is observable only to a subscriber that is live at terminate time.
	sub := &subscriber{
		agentID: testRuntimeAgentLocalRef("agent-terminate-state"),
		eventFilters: map[runtimev1.AgentEventType]struct{}{
			runtimev1.AgentEventType_AGENT_EVENT_TYPE_STATE: {},
		},
		ch: make(chan *runtimev1.AgentEvent, 1),
	}
	svc.mu.Lock()
	svc.nextSubscriberID++
	sub.id = svc.nextSubscriberID
	svc.subscribers[sub.id] = sub
	svc.mu.Unlock()
	t.Cleanup(func() { svc.removeSubscriber(sub.id) })

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"),
		AgentId: "agent-terminate-state",
		Reason:  "shutdown",
	}); err != nil {
		t.Fatalf("TerminateAgent: %v", err)
	}

	var event *runtimev1.AgentEvent
	select {
	case event = <-sub.ch:
	case <-time.After(time.Second):
		t.Fatal("expected the terminate teardown event to reach the live subscriber")
	}
	detail := event.GetState()
	if detail.GetFamily() != runtimev1.AgentStateEventFamily_AGENT_STATE_EVENT_FAMILY_EXECUTION_STATE_CHANGED {
		t.Fatalf("expected execution_state_changed on terminate, got %#v", event)
	}
	if detail.GetCurrentExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_SUSPENDED {
		t.Fatalf("expected current_execution_state=SUSPENDED, got %s", detail.GetCurrentExecutionState())
	}
	if detail.GetPreviousExecutionState() != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
		t.Fatalf("expected previous_execution_state=IDLE, got %s", detail.GetPreviousExecutionState())
	}
	if strings.TrimSpace(detail.GetConversationAnchorId()) != "" ||
		strings.TrimSpace(detail.GetOriginatingTurnId()) != "" ||
		strings.TrimSpace(detail.GetOriginatingStreamId()) != "" {
		t.Fatalf("terminate execution-state event must not fabricate origin, got %#v", detail)
	}

	// K-AGCORE-141 hard delete: the agent state projection is physically gone.
	if _, err := svc.GetAgentState(ctx, &runtimev1.GetAgentStateRequest{
		Context: testRuntimeAgentIdentityContext("agent-terminate-state"),
		AgentId: "agent-terminate-state",
	}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgentState after terminate: status = %s, want NotFound (%v)", status.Code(err), err)
	}
}
