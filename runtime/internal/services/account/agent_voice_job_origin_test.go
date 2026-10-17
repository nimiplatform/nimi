package account

import (
	"context"
	"testing"
)

func TestAgentVoiceJobOriginRequiresResolvedSameOwnerConversation(t *testing.T) {
	invalidated := make(chan struct{})
	d := LocalAppCallerDecision{
		AppID: "chat-app", AccountID: "account-1", RegisteredAppSubject: "registered-1",
		LocalAgentID: "agent-1", Operation: LocalAppOperationSendConversationTurn,
		SessionInvalidated: invalidated,
	}
	ingress := ContextWithAuthorizedLocalAppDecision(context.Background(), d)
	for _, operation := range []LocalAppOperation{LocalAppOperationSendConversationTurn, LocalAppOperationConversationVoiceRender} {
		origin := d
		origin.Operation = operation
		ctx := ContextWithAgentVoiceJobOrigin(context.Background(), ContextWithAuthorizedLocalAppDecision(ingress, origin), "voice-owner", "account-1", "agent-1")
		if app, ok := AgentVoiceJobExecutionApp(ctx); !ok || app != "voice-owner" {
			t.Fatal("resolved voice origin missing")
		}
		got, _ := AuthorizedLocalAppDecisionFromContext(ctx)
		if got != origin {
			t.Fatal("voice delegation must not invent ScenarioJobSubmit admission")
		}
		changed := origin
		changed.RegisteredAppSubject = "different-app"
		if _, ok := AgentVoiceJobExecutionApp(ContextWithAuthorizedLocalAppDecision(ctx, changed)); ok {
			t.Fatal("changed origin retained voice scope")
		}
	}
	for _, candidate := range []context.Context{
		ContextWithAgentVoiceJobOrigin(context.Background(), nil, "voice-owner", "account-1", "agent-1"),
		ContextWithAgentVoiceJobOrigin(context.Background(), ingress, "voice-owner", "other-account", "agent-1"),
		ContextWithAgentVoiceJobOrigin(context.Background(), ingress, "voice-owner", "account-1", "other-agent"),
		ContextWithAgentVoiceJobOrigin(context.Background(), ingress, "", "account-1", "agent-1"),
	} {
		if _, ok := AgentVoiceJobExecutionApp(candidate); ok {
			t.Fatal("invalid origin gained voice scope")
		}
	}
	d.Operation = LocalAppOperationScenarioJobSubmit
	if _, ok := AgentVoiceJobExecutionApp(ContextWithAgentVoiceJobOrigin(context.Background(), ContextWithAuthorizedLocalAppDecision(ingress, d), "voice-owner", "account-1", "agent-1")); ok {
		t.Fatal("unrelated operation gained Agent voice scope")
	}
	close(invalidated)
	if _, ok := AgentVoiceJobExecutionApp(ContextWithAgentVoiceJobOrigin(context.Background(), ingress, "voice-owner", "account-1", "agent-1")); ok {
		t.Fatal("revoked ingress gained new voice scope")
	}
}
