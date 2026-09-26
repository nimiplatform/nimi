package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestAgentDeltaRetainsEventWindowAfterOtherAgentDeletion(t *testing.T) {
	svc, _ := newRuntimeAgentHardDeleteTestService(t)
	ctx := context.Background()
	for _, source := range []string{"event-survivor", "event-deleted"} {
		if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
			t.Fatal(err)
		}
	}
	survivor := testRuntimeAgentIdentityContext("event-survivor").GetLocalAgentRef()
	deleted := testRuntimeAgentIdentityContext("event-deleted").GetLocalAgentRef()
	update := func(ref string, active bool) {
		t.Helper()
		state := runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE
		if active {
			state = runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE
		}
		if err := svc.setPublicChatExecutionStateWithOrigin(ref, "", "", state, stateEventOrigin{}); err != nil {
			t.Fatal(err)
		}
	}
	assertReload := func() {
		t.Helper()
		want := append([]*runtimev1.AgentEvent(nil), svc.events...)
		sequence := svc.sequence
		if err := svc.stateRepo.loadStateFromDB(svc); err != nil {
			t.Fatal(err)
		}
		if svc.sequence != sequence || len(svc.events) != len(want) {
			t.Fatalf("reload window: sequence=%d events=%d, want sequence=%d events=%d", svc.sequence, len(svc.events), sequence, len(want))
		}
		for i, event := range want {
			if !proto.Equal(event, svc.events[i]) {
				t.Fatalf("reload changed retained event %d", event.GetSequence())
			}
		}
	}
	update(survivor, true)
	wanted := svc.sequence
	for i := 0; i < maxEventLogSize-1; i++ {
		update(deleted, i%2 == 0)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext("event-deleted")}); err != nil {
		t.Fatal(err)
	}
	update(survivor, false)
	if len(svc.events) != 2 || svc.events[0].GetSequence() != wanted {
		t.Fatalf("expected surviving event %d and its new update, got %v", wanted, svc.events)
	}
	assertReload()
	// Once actual rows fill the window again, the oldest survivor must expire.
	for i := 0; i < maxEventLogSize; i++ {
		update(survivor, i%2 == 0)
	}
	if len(svc.events) != maxEventLogSize || svc.events[0].GetSequence() <= wanted {
		t.Fatal("event window did not advance after reaching its row limit")
	}
	assertReload()
}
