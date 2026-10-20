package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"testing"
)

func TestConversationCancellationReauthorizesAtCommit(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	anchorID := openEnabledPublicChatTestAnchor(t, svc, "agent-alpha", "desktop.app", "user-1")
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
		t.Fatal(outcome)
	}
	svc.chatSurfaceMu.Lock()
	pending := svc.chatFollowUps[outcome.FollowUpID]
	before := *svc.chatAnchors[anchorID]
	svc.chatSurfaceMu.Unlock()
	decision := localAppConversationDecision(localappop.OperationConversationFollowUpCancel, 0x51, "user-1")
	ctx, cancel := context.WithCancel(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision))
	defer cancel()
	visited := false
	svc.SetLocalAppIngressRevalidator(voiceCommitTestFence{beforeCommit: func() { visited = true; cancel() }, authorize: func(c context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressConversationFollowUpCancel {
			t.Fatalf("ingress=%v", ingress)
		}
		return accountservice.ContextWithAuthorizedLocalAppDecision(c, decision), nil
	}})
	_, err = svc.CancelLocalAppConversationFollowUp(ctx, &runtimev1.CancelLocalAppConversationFollowUpRequest{AgentHandle: mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha")), ConversationAnchorId: anchorID, TaskId: pending.FollowUpID, ExpectedRevision: pending.Revision})
	svc.chatSurfaceMu.Lock()
	defer svc.chatSurfaceMu.Unlock()
	after := svc.chatAnchors[anchorID]
	if err == nil || !visited || svc.chatFollowUps[pending.FollowUpID] != pending || after.LocalAppSequence != before.LocalAppSequence || after.PendingFollowUpID != pending.FollowUpID {
		t.Fatalf("invalidated cancellation mutated owner: %v", err)
	}
}
