package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestLocalAppAgentReferenceListProjectsAllCurrentAccountActiveAgents(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-zeta-private": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-zeta-private", DisplayName: "Zeta", OwnerUserId: "account-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-alpha-private": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-alpha-private", DisplayName: "Alpha", OwnerUserId: "account-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-inactive-private": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-inactive-private", DisplayName: "Inactive", OwnerUserId: "account-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED,
		}},
		"agent-foreign-private": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-foreign-private", DisplayName: "Foreign", OwnerUserId: "account-2",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
	}}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), localAppReferenceDecision(0x11, "account-1"))
	response, err := svc.ListLocalAppAgentReferences(ctx, &runtimev1.ListLocalAppAgentReferencesRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.GetReferences()) != 2 {
		t.Fatalf("references = %+v", response.GetReferences())
	}
	for index, expectedName := range []string{"Alpha", "Zeta"} {
		reference := response.GetReferences()[index]
		if reference.GetDisplayName() != expectedName || reference.AvatarUrl != nil {
			t.Fatalf("reference[%d] = %+v", index, reference)
		}
		if !strings.HasPrefix(reference.GetAgentHandle(), localAppAgentHandlePrefix) ||
			strings.Contains(reference.GetAgentHandle(), "agent-") {
			t.Fatalf("reference handle exposes owner identity: %q", reference.GetAgentHandle())
		}
		if reference.ProtoReflect().Descriptor().Fields().Len() != 3 {
			t.Fatalf("reference wire field count = %d", reference.ProtoReflect().Descriptor().Fields().Len())
		}
	}
}

func TestLocalAppAgentReferenceHandlesAreSessionAndAccountScopedSelectors(t *testing.T) {
	inventory := []accountservice.LocalAgentOwnerProjection{{
		LocalAgentID: "agent-private-1", DisplayName: "Agent One",
	}}
	first := localAppReferenceDecision(0x21, "account-1")
	same, ok := projectLocalAppAgentReferences(first, inventory)
	if !ok {
		t.Fatal("first projection failed")
	}
	repeated, ok := projectLocalAppAgentReferences(first, inventory)
	if !ok || repeated[0].GetAgentHandle() != same[0].GetAgentHandle() {
		t.Fatal("handle was not stable inside one session")
	}
	otherSession, ok := projectLocalAppAgentReferences(localAppReferenceDecision(0x31, "account-1"), inventory)
	if !ok || otherSession[0].GetAgentHandle() == same[0].GetAgentHandle() {
		t.Fatal("handle survived a session change")
	}
	otherAccount, ok := projectLocalAppAgentReferences(localAppReferenceDecision(0x21, "account-2"), inventory)
	if !ok || otherAccount[0].GetAgentHandle() == same[0].GetAgentHandle() {
		t.Fatal("handle survived an account change")
	}
}

func TestLocalAppAgentReferenceAvatarProjectionAllowsOnlyPublicDisplayURL(t *testing.T) {
	decision := localAppReferenceDecision(0x41, "account-1")
	for _, test := range []struct {
		name string
		url  string
		want bool
	}{
		{name: "public https", url: "https://cdn.nimi.ai/avatars/one.webp", want: true},
		{name: "bearer query", url: "https://cdn.nimi.ai/avatar?token=private", want: false},
		{name: "private signature", url: "https://cdn.nimi.ai/avatar?X-Amz-Signature=private", want: false},
		{name: "userinfo", url: "https://bearer:private@cdn.nimi.ai/avatar", want: false}, // pragma: allowlist secret
		{name: "loopback endpoint", url: "http://127.0.0.1:3002/avatar", want: false},
		{name: "private endpoint", url: "https://10.0.0.1/avatar", want: false},
		{name: "local path", url: "file:///Users/private/avatar.png", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			projected, ok := projectLocalAppAgentReferences(decision, []accountservice.LocalAgentOwnerProjection{{
				LocalAgentID: "agent-private-1", DisplayName: "Agent One", AvatarURL: &test.url,
			}})
			if !ok {
				t.Fatal("projection failed")
			}
			if got := projected[0].AvatarUrl != nil; got != test.want {
				t.Fatalf("avatar presence = %v, want %v", got, test.want)
			}
		})
	}
}

func localAppReferenceDecision(seed byte, accountID string) accountservice.LocalAppCallerDecision {
	decision := accountservice.LocalAppCallerDecision{
		AppID:                "nimi.test.local-app",
		AccountID:            accountID,
		Operation:            accountservice.LocalAppOperationReferenceList,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  "agent.local",
		RegisteredAppSubject: "registered-app-subject",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed + byte(index)
	}
	return decision
}

func TestDesktopAgentReferenceResolutionIsReadOnlyAndOwnerScoped(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"selected": {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "selected", DisplayName: "Selected", OwnerUserId: "account-1", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE}},
		"foreign":  {Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "foreign", DisplayName: "Foreign", OwnerUserId: "account-2", LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE}},
	}}
	decision := localAppReferenceDecision(0x71, "account-1")
	decision.AppID = "nimi.desktop"
	decision.TrustClass = accountservice.LocalAppTrustClassBuiltIn
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	result, err := svc.ResolveDesktopAgentReference(ctx, &runtimev1.ResolveDesktopAgentReferenceRequest{LocalAgentRef: "selected"})
	if err != nil {
		t.Fatal(err)
	}
	listed, err := svc.ListLocalAppAgentReferences(ctx, &runtimev1.ListLocalAppAgentReferencesRequest{})
	if err != nil || len(listed.GetReferences()) != 1 || result.GetReference().GetAgentHandle() != listed.GetReferences()[0].GetAgentHandle() {
		t.Fatalf("selected reference differs from current-session projection: %+v, %v", result, err)
	}
	if len(svc.chatAnchors) != 0 {
		t.Fatal("identity lookup created a conversation")
	}
	for _, ref := range []string{"foreign", "missing", ""} {
		if _, err := svc.ResolveDesktopAgentReference(ctx, &runtimev1.ResolveDesktopAgentReferenceRequest{LocalAgentRef: ref}); err == nil {
			t.Fatalf("resolved unowned reference %q", ref)
		}
	}
	for _, invalid := range []accountservice.LocalAppCallerDecision{
		localAppReferenceDecision(0x71, "account-1"),
		func() accountservice.LocalAppCallerDecision {
			d := decision
			d.TrustClass = accountservice.LocalAppTrustClassDevelopment
			return d
		}(),
	} {
		if _, err := svc.ResolveDesktopAgentReference(accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), invalid), &runtimev1.ResolveDesktopAgentReferenceRequest{LocalAgentRef: "selected"}); err == nil {
			t.Fatal("non-Desktop caller used owner lookup")
		}
	}
}
