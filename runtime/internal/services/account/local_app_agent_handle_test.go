package account

import (
	"context"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

type localAgentOwnershipFixture struct {
	accountID   string
	agentID     string
	displayName string
}

func (fixture localAgentOwnershipFixture) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	return accountID == fixture.accountID && localAgentID == fixture.agentID && fixture.agentID != "", nil
}

func (fixture localAgentOwnershipFixture) ListOwnedActiveLocalAgents(_ context.Context, accountID string) ([]LocalAgentOwnerProjection, error) {
	if accountID != fixture.accountID {
		return nil, ErrLocalAppSelectorMismatch
	}
	if fixture.agentID == "" {
		return []LocalAgentOwnerProjection{}, nil
	}
	displayName := fixture.displayName
	if displayName == "" {
		displayName = "Owned Agent"
	}
	return []LocalAgentOwnerProjection{{
		LocalAgentID: fixture.agentID,
		DisplayName:  displayName,
	}}, nil
}

func TestAccountScopeAgentHandleIsStableOpaqueAndLiveOwned(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{
		accountID: "acct-1", agentID: "agent-owned",
	})
	caller, err := fixture.service.AuthorizeLocalAppCaller(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	digest := localappkernel.AgentAccountScopeDigest(caller.AccountID)
	first, err := fixture.service.materializeAccountAgentHandles(
		context.Background(), caller, "agents.interact", digest,
	)
	if err != nil || len(first) != 1 {
		t.Fatalf("first materialization = (%+v, %v)", first, err)
	}
	second, err := fixture.service.materializeAccountAgentHandles(
		context.Background(), caller, "agents.interact", digest,
	)
	if err != nil || len(second) != 1 || second[0].Handle != first[0].Handle {
		t.Fatalf("stable materialization = (%+v, %v)", second, err)
	}
	if first[0].Handle == "" || first[0].Handle == "agent-owned" {
		t.Fatalf("handle is not opaque: %+v", first[0])
	}
	resolved, err := fixture.service.ResolveLocalAppAgentHandle(
		context.Background(), first[0].Handle, "agents.interact",
	)
	if err != nil || resolved.LocalAgentID != "agent-owned" || resolved.OwnerSelectorDigest != digest {
		t.Fatalf("resolve Agent handle = (%+v, %v)", resolved, err)
	}
	if _, err := fixture.service.ResolveLocalAppAgentHandle(
		context.Background(), "agent-owned", "agents.interact",
	); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("app-authored raw localAgentId error = %v", err)
	}
}

func TestAccountScopeAgentHandleFailsAfterAccountSwitch(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{
		accountID: "acct-1", agentID: "agent-owned",
	})
	caller, err := fixture.service.AuthorizeLocalAppCaller(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	agents, err := fixture.service.materializeAccountAgentHandles(
		context.Background(), caller, "agents.interact",
		localappkernel.AgentAccountScopeDigest(caller.AccountID),
	)
	if err != nil || len(agents) != 1 {
		t.Fatalf("materialize Agent handle = (%+v, %v)", agents, err)
	}
	fixture.resolver.binding.AccountGeneration++
	if _, err := fixture.service.ResolveLocalAppAgentHandle(
		context.Background(), agents[0].Handle, "agents.interact",
	); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("account-switched handle error = %v", err)
	}
}

func TestAccountScopeAgentMaterializationRejectsDuplicateAgentIdentity(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.SetLocalAgentOwnershipResolver(&mutableLocalAgentOwnershipFixture{
		accountID: "acct-1",
		agents: []LocalAgentOwnerProjection{
			{LocalAgentID: "agent-duplicate", DisplayName: "Agent One"},
			{LocalAgentID: "agent-duplicate", DisplayName: "Agent Two"},
		},
	})
	caller, err := fixture.service.AuthorizeLocalAppCaller(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.materializeAccountAgentHandles(
		context.Background(), caller, "agents.interact",
		localappkernel.AgentAccountScopeDigest(caller.AccountID),
	); err != ErrLocalAppSelectorMismatch {
		t.Fatalf("duplicate Agent identity error = %v", err)
	}
}
