package runtimeagent

import (
	"context"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
)

func TestLifeTrackTerminalCommitsOutboxWithHookStateAndReachesCognition(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	const sourceRef = "agent-life-terminal-memory"
	localAgentRef := testRuntimeAgentLocalRef(sourceRef)
	if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(sourceRef)}); err != nil {
		t.Fatalf("RealmSourceMaterialization: %v", err)
	}
	now := time.Now().UTC()
	hook := newTestTimePendingHookWithReason(t, "hook-life-terminal-memory", sourceRef, "remember activity outcome", now, now)
	if err := svc.admitPendingHook(localAgentRef, hook); err != nil {
		t.Fatalf("admit hook: %v", err)
	}
	if _, err := svc.markHookRunningAt(localAgentRef, hook.GetIntent().GetIntentId(), now); err != nil {
		t.Fatalf("mark hook running: %v", err)
	}
	if _, err := svc.completeHookAt(localAgentRef, hook.GetIntent().GetIntentId(), "completed a meaningful activity", 3, now.Add(time.Second)); err != nil {
		t.Fatalf("complete hook: %v", err)
	}
	svc.cognitionMemoryWG.Wait()
	var eventCount int
	if err := svc.backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_cognition_memory_committed_event WHERE local_agent_ref = ? AND event_kind = 'activity_terminal'`, localAgentRef).Scan(&eventCount); err != nil {
		t.Fatalf("inspect committed activity event: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("committed activity event count = %d, want 1", eventCount)
	}
	projection, err := svc.cognitionMemoryFacade.Inspect(ctx, localAgentRef)
	if err != nil || projection.Outcome != memoryv1.OutcomeReady || projection.CurrentCount != 1 {
		t.Fatalf("inspect Cognition Memory after activity: projection=%+v err=%v", projection, err)
	}
	if got := projection.Items[0].Content; got != "completed: completed a meaningful activity" {
		t.Fatalf("canonical activity Memory = %q", got)
	}
}
