package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestAgentRealtimeIgnoresOldRequestEvents(t *testing.T) {
	events := []*runtimev1.AiRealtimeEvent{
		{Event: &runtimev1.AiRealtimeEvent_TextOutput{TextOutput: &runtimev1.AiRealtimeTextOutput{RequestId: "old-turn", OutputTrackId: "old-text", Text: "Old response", Final: true}}},
		{Event: &runtimev1.AiRealtimeEvent_AudioFrame{AudioFrame: &runtimev1.AiRealtimeAudioFrameOutput{RequestId: "old-turn", OutputTrackId: "old-audio", Frame: []byte{1, 2}}}},
		{Event: &runtimev1.AiRealtimeEvent_OutputTrack{OutputTrack: &runtimev1.AiRealtimeOutputTrackStatus{RequestId: "old-turn", OutputTrackId: "old-audio"}}},
		{Event: &runtimev1.AiRealtimeEvent_RequestTerminal{RequestTerminal: &runtimev1.AiRealtimeRequestTerminal{RequestId: "old-turn", FinishReason: runtimev1.FinishReason_FINISH_REASON_ERROR}}},
		{Event: &runtimev1.AiRealtimeEvent_Failure{Failure: &runtimev1.AiRealtimeFailure{RequestId: "old-turn", ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE}}},
	}
	for _, event := range events {
		svc, session, _, _ := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
		active := session.turn
		projected, err := svc.projectAgentRealtimeEvent(context.Background(), session, agentRealtimeExecutorStub{}, event)
		if err != nil || projected != nil || session.turn != active || active.text != "" {
			t.Fatalf("old event affected a newer turn: %T %v", event.Event, err)
		}
		svc.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "test cleanup")
	}
}

func TestAgentRealtimeReusesCanonicalInputIdentity(t *testing.T) {
	svc, session, decision, handle := prepareActiveAgentRealtimeTurnForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend)
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	resolved, ctx, err := svc.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAgentRealtimeInputAppend, handle)
	if err != nil {
		t.Fatal(err)
	}
	original := session.turn
	for _, finished := range []bool{false, true} {
		if finished {
			svc.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "test terminal")
		}
		created, err := svc.ensureAgentRealtimeTurn(ctx, session, resolved, "agent-realtime-request-1", "hello")
		if err != nil || created || (!finished && session.turn != original) || (finished && session.turn != nil) {
			t.Fatalf("same request replayed: created=%t err=%v", created, err)
		}
		if _, err := svc.ensureAgentRealtimeTurn(ctx, session, resolved, "agent-realtime-request-1", "different"); err == nil {
			t.Fatal("request identity reused for different input")
		}
	}
	svc.recordAgentRealtimeUsage(session, original.turn.TurnID, &runtimev1.UsageStats{InputTokens: 23, OutputTokens: 7})
	svc.chatSurfaceMu.Lock()
	old := svc.chatAnchors[session.conversationAnchorID].LastTurnSnapshot
	svc.chatSurfaceMu.Unlock()
	if old == nil || old.TurnID != original.turn.TurnID || old.Usage.GetInputTokens() != 23 {
		t.Fatal("late usage did not stay with the original terminal turn")
	}
}

func TestMemorySwitchRetiresIdleRealtimeExecutionCopies(t *testing.T) {
	svc, accountID, ref := newLocalAppConfigureTestService(t)
	decision, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemorySwitch, 0x61, accountID)
	handle := mintLocalAppAgentHandle(decision, ref)
	session := &localAppAgentRealtimeSession{realtimeSessionID: "idle-memory-session", agentID: ref, accountID: accountID}
	svc.agentRealtimeSessions[session.realtimeSessionID] = session
	if _, err := svc.SetLocalAppAgentMemoryEnabled(ctx, &runtimev1.SetLocalAppAgentMemoryEnabledRequest{AgentHandle: handle, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if !session.isClosed() {
		t.Fatal("idle provider context survived Memory switch")
	}
	if _, found := svc.agentRealtimeSessions[session.realtimeSessionID]; found {
		t.Fatal("retired native generation still accepts new inputs")
	}
	projected, err := svc.projectAgentRealtimeEvent(ctx, session, agentRealtimeExecutorStub{}, &runtimev1.AiRealtimeEvent{
		Event: &runtimev1.AiRealtimeEvent_SessionTerminal{SessionTerminal: &runtimev1.AiRealtimeSessionTerminal{ReasonCode: runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED}},
	})
	if err != nil || projected.GetTerminal().GetReasonCode() != runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED {
		t.Fatalf("actual native terminal hidden by lifecycle fence: %+v %v", projected, err)
	}
}

func TestRejectedForgetDoesNotRetireRealtime(t *testing.T) {
	svc, accountID, ref := newLocalAppConfigureTestService(t)
	decision, ctx := localAppConfigureContext(accountservice.LocalAppOperationMemoryForget, 0x61, accountID)
	handle := mintLocalAppAgentHandle(decision, ref)
	session := &localAppAgentRealtimeSession{realtimeSessionID: "idle-memory-session", agentID: ref, accountID: accountID}
	svc.agentRealtimeSessions[session.realtimeSessionID] = session
	if _, err := svc.ForgetLocalAppAgentMemory(ctx, &runtimev1.ForgetLocalAppAgentMemoryRequest{AgentHandle: handle, MemoryIds: []string{"missing"}, Confirmed: false}); err == nil {
		t.Fatal("unconfirmed Forget accepted")
	}
	if session.isClosed() {
		t.Fatal("failed Memory mutation retired a valid session")
	}
}

func TestRealtimeAdmissionUsesCapturedRouteWithoutTextBinding(t *testing.T) {
	svc, session, decision, handle := prepareAgentRealtimeSessionForTest(t, accountservice.LocalAppOperationAgentRealtimeInputAppend, false)
	svc.SetPublicChatBindingResolver(rejectingPublicChatBindingResolver{})
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	resolved, ctx, err := svc.resolveLocalAppAgent(ctx, accountservice.LocalAppOperationAgentRealtimeInputAppend, handle)
	if err != nil {
		t.Fatal(err)
	}
	created, err := svc.ensureAgentRealtimeTurn(ctx, session, resolved, "captured-route", "hello")
	if err != nil || !created || session.turn.session.Binding.ModelID != "test-realtime" || session.turn.session.Binding.ContextWindowTokens != 32768 {
		t.Fatalf("Realtime depended on ordinary text routing: created=%t err=%v", created, err)
	}
	svc.failAgentRealtimeTurn(session, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "test cleanup")
}
