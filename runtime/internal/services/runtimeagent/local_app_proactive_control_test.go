package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func enablePublicChatTestFollowUps(t *testing.T, svc *Service, anchorID string) {
	t.Helper()
	svc.chatSurfaceMu.Lock()
	ref := svc.chatAnchors[anchorID].LocalAgentRef
	svc.chatSurfaceMu.Unlock()
	entry, err := svc.agentByID(ref)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := validateLocalAgentIdentity(entry.Agent.GetOwnerUserId(), entry.Agent.GetRuntimeSourceRef(), ref)
	if err != nil {
		t.Fatal(err)
	}
	config := cloneAutonomyConfig(entry.Agent.Autonomy.Config)
	config.FreeContactEnabled = true
	config.MaxFreeContactsPerDay = 24
	if _, err := svc.updateAgentAutonomyCAS(identity, entry.Agent.Autonomy.Revision, agentAutonomyMutationIntent{config: config}); err != nil {
		t.Fatal(err)
	}
}
func openEnabledPublicChatTestAnchor(t *testing.T, svc *Service, agentID, callerAppID, subjectUserID string) string {
	t.Helper()
	id := openPublicChatTestAnchor(t, svc, agentID, callerAppID, subjectUserID)
	enablePublicChatTestFollowUps(t, svc, id)
	return id
}

func commitFollowUpSourceForTest(t *testing.T, svc *Service, anchorID, turnID string) {
	t.Helper()
	svc.chatSurfaceMu.Lock()
	anchor := svc.chatAnchors[anchorID]
	input := publicChatRecoveryInputForTurn(anchor, anchor.Recoveries[turnID])
	text := input.Text
	svc.chatSurfaceMu.Unlock()
	if err := svc.commitPublicChatTurnTranscriptForTurn(anchorID, turnID, &runtimev1.ChatMessage{Role: "user", Content: text}, "body"); err != nil {
		t.Fatal(err)
	}
}

func TestConversationFollowUpPolicyIsDefaultOffAndControlFailureKeepsTimer(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
	svc.chatSurfaceMu.Lock()
	state := svc.localAppConversationStateLocked(svc.chatAnchors[anchorID])
	svc.chatSurfaceMu.Unlock()
	if state.FreeContactEnabled || state.MaxFollowUpTurns != 1 {
		t.Fatalf("default policy=%+v", state)
	}
	enablePublicChatTestFollowUps(t, svc, anchorID)
	turnID := reserveConversationPublicationTestTurn(t, svc, anchorID)
	svc.chatSurfaceMu.Lock()
	session := *svc.chatAnchors[anchorID]
	turn := *svc.chatTurns[turnID]
	svc.chatSurfaceMu.Unlock()
	structured, err := parsePublicChatStructuredEnvelope(`<message intent="reply">body</message><time-hook><delay-ms>3600000</delay-ms></time-hook>`)
	if err != nil {
		t.Fatal(err)
	}
	assignPublicChatOutputIdentities(structured, turnID)
	commitFollowUpSourceForTest(t, svc, anchorID, turnID)
	outcome := svc.schedulePublicChatFollowUp(session, turn, publicChatTurnRequestPayload{}, structured)
	if outcome.Status != "scheduled" {
		t.Fatalf("schedule=%+v", outcome)
	}
	canceled := 0
	svc.chatSurfaceMu.Lock()
	pending := svc.chatFollowUps[outcome.FollowUpID]
	pending.Cancel = func() { canceled++ }
	revision := pending.Revision
	svc.chatSurfaceMu.Unlock()
	if _, err := svc.backend.DB().Exec(`CREATE TRIGGER reject_followup_cancel BEFORE UPDATE ON runtime_conversation_followup BEGIN SELECT RAISE(FAIL, 'save unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	decision := localAppConversationDecision(accountservice.LocalAppOperationConversationFollowUpCancel, 0x51, "user-1")
	req := &runtimev1.CancelLocalAppConversationFollowUpRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, TaskId: outcome.FollowUpID, ExpectedRevision: revision}
	callCtx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	if _, err := svc.CancelLocalAppConversationFollowUp(callCtx, req); err == nil {
		t.Fatal("failed save reported canceled")
	}
	svc.chatSurfaceMu.Lock()
	same := svc.chatFollowUps[outcome.FollowUpID] == pending && svc.chatAnchors[anchorID].PendingFollowUpID == outcome.FollowUpID
	svc.chatSurfaceMu.Unlock()
	if !same || canceled != 0 {
		t.Fatalf("failed cancel destroyed timer: same=%v canceled=%d", same, canceled)
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER reject_followup_cancel`); err != nil {
		t.Fatal(err)
	}
	changed, err := svc.CancelLocalAppConversationFollowUp(callCtx, req)
	if err != nil || changed.State.PendingFollowUp != nil || canceled != 1 {
		t.Fatalf("durable cancel=%+v err=%v count=%d", changed, err, canceled)
	}
	if _, err := svc.CancelLocalAppConversationFollowUp(callCtx, req); err == nil {
		t.Fatal("already canceled task was reported as newly canceled")
	}
}
