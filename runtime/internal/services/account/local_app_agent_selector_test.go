package account

import (
	"context"
	"testing"
)

type localAgentOwnershipFixture struct {
	accountID string
	agentID   string
}

func (fixture localAgentOwnershipFixture) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	return accountID == fixture.accountID && localAgentID == fixture.agentID, nil
}

func (fixture localAgentOwnershipFixture) ProjectOwnedLocalAgent(_ context.Context, accountID string, localAgentID string) (LocalAgentOwnerProjection, error) {
	if accountID != fixture.accountID || localAgentID != fixture.agentID {
		return LocalAgentOwnerProjection{}, ErrLocalAppSelectorMismatch
	}
	return LocalAgentOwnerProjection{LocalAgentID: localAgentID, DisplayName: "Owned Agent"}, nil
}

func TestOwnerAgentSelectorHandleRequiresCanonicalAccountOwnership(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	principalID := fixture.resolver.binding.LocalAppPrincipalID
	issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(
		context.Background(), desktopAccountControlCaller(), principalID, "agents.interact", "agent-owned",
	)
	if err != nil {
		t.Fatalf("issue owner selector: %v", err)
	}
	if issued.Handle == "" || issued.Handle == issued.LocalAgentID || issued.LocalAgentID != "agent-owned" {
		t.Fatalf("issued selector = %+v", issued)
	}
	if _, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(
		context.Background(), desktopAccountControlCaller(), principalID, "agents.interact", "agent-other",
	); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("foreign Agent issue error = %v", err)
	}
	resolved, err := fixture.service.ResolveLocalAppAgentSelectorHandle(context.Background(), issued.Handle, "agents.interact")
	if err != nil || resolved.OwnerSelectorDigest != issued.OwnerSelectorDigest {
		t.Fatalf("resolve owner selector = (%+v, %v)", resolved, err)
	}
	if _, err := fixture.service.ResolveLocalAppAgentSelectorHandle(context.Background(), "agent-owned", "agents.interact"); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("app-authored raw localAgentId error = %v", err)
	}
}

func TestOwnerAgentSelectorHandleFailsAfterAccountSwitch(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(
		context.Background(), desktopAccountControlCaller(), fixture.resolver.binding.LocalAppPrincipalID, "agents.interact", "agent-owned",
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.resolver.binding.AccountGeneration++
	if _, err := fixture.service.ResolveLocalAppAgentSelectorHandle(context.Background(), issued.Handle, "agents.interact"); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("account-switched selector error = %v", err)
	}
}
