package runtimeagent

import (
	"testing"
	"time"
)

func TestAgentLifeMultiLivePreservesPostureAndConcurrentSessions(t *testing.T) {
	state := newAgentLifeState()
	now := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	state.Current = &lifeFrame{
		ID:       "frame-reading",
		Title:    "Reading",
		StartsAt: now.Add(-10 * time.Minute),
		EndsAt:   now.Add(20 * time.Minute),
	}

	// pc_work session must NOT interrupt ongoing companion activity or set WaitReason="interaction"
	if err := state.beginNonDisruptiveSessionInteraction("session:pc-work-1", now); err != nil {
		t.Fatalf("beginNonDisruptiveSessionInteraction: %v", err)
	}
	if state.Current == nil || state.Current.ID != "frame-reading" {
		t.Fatalf("pc_work must not interrupt companion life frame: %+v", state.Current)
	}
	if state.WaitReason == "interaction" {
		t.Fatalf("pc_work must not alter companion WaitReason: %q", state.WaitReason)
	}
	if !state.hasActiveInteractions(now.Add(10 * time.Second)) {
		t.Fatal("expected ActiveInteractions to report active session")
	}

	// Concurrent second session tracked independently; ending one leaves the other live
	if err := state.beginNonDisruptiveSessionInteraction("session:pc-work-2", now.Add(5*time.Second)); err != nil {
		t.Fatalf("beginNonDisruptiveSessionInteraction #2: %v", err)
	}
	if err := state.endSessionInteraction("session:pc-work-1", now.Add(10*time.Second)); err != nil {
		t.Fatalf("endSessionInteraction #1: %v", err)
	}
	if len(state.ActiveInteractions) != 1 || state.ActiveInteractions["session:pc-work-2"].IsZero() {
		t.Fatalf("expected session:pc-work-2 to remain active: %+v", state.ActiveInteractions)
	}

	// Clone preserves ActiveInteractions map without aliasing
	cloned := cloneAgentLifeState(state)
	cloned.ActiveInteractions["session:cloned"] = now
	if _, leaked := state.ActiveInteractions["session:cloned"]; leaked {
		t.Fatal("cloneAgentLifeState aliased ActiveInteractions map")
	}
}

func TestAcquireSessionExecutionSlotSerializesPerSessionNotGlobalAgent(t *testing.T) {
	svc := &Service{}
	relA, err := svc.AcquireSessionExecutionSlot("agent-1", "ws-a", "exec-a1")
	if err != nil {
		t.Fatalf("acquire ws-a: %v", err)
	}
	defer relA()

	// Same (agent, session) rejects concurrent execution with AGENT_BUSY.
	if _, err := svc.AcquireSessionExecutionSlot("agent-1", "ws-a", "exec-a2"); err == nil {
		t.Fatal("expected AGENT_BUSY for concurrent execution on same (agent, work_session_ref)")
	}

	// Independent work_session_ref on the SAME Agent succeeds concurrently!
	relB, err := svc.AcquireSessionExecutionSlot("agent-1", "ws-b", "exec-b1")
	if err != nil {
		t.Fatalf("independent session ws-b on same Agent must not block: %v", err)
	}
	relB()
}
