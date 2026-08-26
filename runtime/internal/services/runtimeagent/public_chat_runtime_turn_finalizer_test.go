package runtimeagent

import (
	"runtime"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestFinishTurnReservationLocksAgentStateBeforeChatSurface(t *testing.T) {
	previousMaxProcs := runtime.GOMAXPROCS(1)
	t.Cleanup(func() { runtime.GOMAXPROCS(previousMaxProcs) })

	svc := newRuntimeAgentServiceForPublicChatTest(t)
	chatRuntime := publicChatRuntime{svc: svc}
	agentID := testRuntimeAgentLocalRef("agent-alpha")
	if err := chatRuntime.setExecutionState(agentID, "user-1", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE); err != nil {
		t.Fatalf("set CHAT_ACTIVE: %v", err)
	}

	bindingReleaseReached := make(chan struct{})
	allowBindingReleaseReturn := make(chan struct{})
	const turnID = "turn-lock-order"
	svc.chatSurfaceMu.Lock()
	svc.chatTurns[turnID] = &publicChatTurnState{
		TurnID:  turnID,
		AgentID: agentID,
		BindingRelease: func() {
			close(bindingReleaseReached)
			<-allowBindingReleaseReturn
		},
	}
	svc.chatActiveByAgent[agentID] = turnID
	svc.chatSurfaceMu.Unlock()

	// Holding svc.mu reproduces the termination side of the lock order. The
	// binding-release latch places the finalizer immediately before its final
	// state transition, after its earlier chat reservation mutation is done.
	svc.mu.Lock()
	finished := make(chan struct{})
	go func() {
		chatRuntime.finishTurnReservation(publicChatAnchorState{AgentID: agentID}, turnID)
		close(finished)
	}()
	select {
	case <-bindingReleaseReached:
	case <-time.After(5 * time.Second):
		close(allowBindingReleaseReturn)
		svc.mu.Unlock()
		t.Fatal("finalizer did not reach binding release")
	}
	close(allowBindingReleaseReturn)
	// With one scheduler P, the yielded finalizer reaches and blocks on its
	// first lock before this goroutine resumes. The required order blocks on
	// svc.mu without owning chatSurfaceMu; the old inverse order owned the chat
	// mutex here and deadlocked against termination.
	runtime.Gosched()
	chatAvailable := svc.chatSurfaceMu.TryLock()
	if chatAvailable {
		svc.chatSurfaceMu.Unlock()
	}
	svc.mu.Unlock()
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("finalizer did not complete after agent lock release")
	}
	if !chatAvailable {
		t.Fatal("finalizer acquired chatSurfaceMu before svc.mu")
	}
}

func TestFinishTurnReservationCommitsIdleWithoutOverwritingNewerReservation(t *testing.T) {
	t.Run("terminal turn commits idle", func(t *testing.T) {
		svc := newRuntimeAgentServiceForPublicChatTest(t)
		runtime := publicChatRuntime{svc: svc}
		agentID := testRuntimeAgentLocalRef("agent-alpha")
		if err := runtime.setExecutionState(agentID, "user-1", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE); err != nil {
			t.Fatalf("set CHAT_ACTIVE: %v", err)
		}

		svc.mu.RLock()
		sequenceBeforeFinish := svc.sequence
		svc.mu.RUnlock()
		runtime.finishTurnReservation(publicChatAnchorState{AgentID: agentID}, "turn-old")

		entry, err := svc.agentByID(agentID)
		if err != nil {
			t.Fatalf("agentByID: %v", err)
		}
		if got := entry.State.GetExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE {
			t.Fatalf("execution state after finalization = %s, want IDLE", got)
		}
		svc.mu.RLock()
		sequenceAfterFinish := svc.sequence
		svc.mu.RUnlock()
		if sequenceAfterFinish != sequenceBeforeFinish+1 {
			t.Fatalf("execution-state event sequence after finalization = %d, want %d", sequenceAfterFinish, sequenceBeforeFinish+1)
		}
	})

	t.Run("newer reservation retains chat active", func(t *testing.T) {
		svc := newRuntimeAgentServiceForPublicChatTest(t)
		runtime := publicChatRuntime{svc: svc}
		agentID := testRuntimeAgentLocalRef("agent-alpha")
		if err := runtime.setExecutionState(agentID, "user-1", "", runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE); err != nil {
			t.Fatalf("set CHAT_ACTIVE: %v", err)
		}
		svc.chatSurfaceMu.Lock()
		svc.chatActiveByAgent[agentID] = "turn-new"
		svc.chatSurfaceMu.Unlock()
		svc.mu.RLock()
		sequenceBeforeFinish := svc.sequence
		svc.mu.RUnlock()

		runtime.finishTurnReservation(publicChatAnchorState{AgentID: agentID}, "turn-old")

		entry, err := svc.agentByID(agentID)
		if err != nil {
			t.Fatalf("agentByID: %v", err)
		}
		if got := entry.State.GetExecutionState(); got != runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_CHAT_ACTIVE {
			t.Fatalf("newer reservation execution state = %s, want CHAT_ACTIVE", got)
		}
		svc.mu.RLock()
		sequenceAfterFinish := svc.sequence
		svc.mu.RUnlock()
		if sequenceAfterFinish != sequenceBeforeFinish {
			t.Fatalf("old finalizer appended an event after newer reservation: before=%d after=%d", sequenceBeforeFinish, sequenceAfterFinish)
		}
	})
}
