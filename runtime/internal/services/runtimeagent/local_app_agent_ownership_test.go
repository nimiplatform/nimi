package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppAgentOwnershipRequiresCurrentOwnerAndActiveLifecycle(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-active-zeta": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-zeta", DisplayName: "Zeta Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-active-alpha-b": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-alpha-b", DisplayName: "Alpha Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-active-alpha-a": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active-alpha-a", DisplayName: "Alpha Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-other-owner": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-other-owner", DisplayName: "Other Owner", OwnerUserId: "acct-2",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-suspended": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-suspended", DisplayName: "Suspended Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED,
		}},
	}}
	owned, err := svc.OwnsActiveLocalAgent(context.Background(), "acct-1", "agent-active-zeta")
	if err != nil || !owned {
		t.Fatalf("active ownership = (%v, %v)", owned, err)
	}
	inventory, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	want := [][2]string{
		{"agent-active-alpha-a", "Alpha Agent"},
		{"agent-active-alpha-b", "Alpha Agent"},
		{"agent-active-zeta", "Zeta Agent"},
	}
	if len(inventory) != len(want) {
		t.Fatalf("active owned inventory = %+v", inventory)
	}
	for index, expected := range want {
		if inventory[index].LocalAgentID != expected[0] || inventory[index].DisplayName != expected[1] {
			t.Fatalf("active owned inventory[%d] = %+v, want id=%q name=%q", index, inventory[index], expected[0], expected[1])
		}
	}
	for _, input := range [][2]string{{"acct-2", "agent-active-zeta"}, {"acct-1", "agent-suspended"}, {"acct-1", "agent-missing"}} {
		owned, err := svc.OwnsActiveLocalAgent(context.Background(), input[0], input[1])
		if err != nil || owned {
			t.Fatalf("ownership(%q, %q) = (%v, %v)", input[0], input[1], owned, err)
		}
	}
}

func TestLocalAppAgentAccountProjectionRejectsNonCanonicalIdentity(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-invalid": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: " agent-invalid", DisplayName: "Invalid Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
	}}
	if _, err := svc.ListOwnedActiveLocalAgents(context.Background(), "acct-1"); err == nil {
		t.Fatal("non-canonical Agent identity entered the account projection")
	}
}
