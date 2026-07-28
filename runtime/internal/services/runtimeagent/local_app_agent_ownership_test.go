package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLocalAppAgentOwnershipRequiresCurrentOwnerAndActiveLifecycle(t *testing.T) {
	svc := &Service{agents: map[string]*agentEntry{
		"agent-active": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-active", DisplayName: "Active Agent", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		}},
		"agent-suspended": {Agent: &runtimev1.LocalAgentRecord{
			LocalAgentRef: "agent-suspended", OwnerUserId: "acct-1",
			LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED,
		}},
	}}
	owned, err := svc.OwnsActiveLocalAgent(context.Background(), "acct-1", "agent-active")
	if err != nil || !owned {
		t.Fatalf("active ownership = (%v, %v)", owned, err)
	}
	projection, err := svc.ProjectOwnedLocalAgent(context.Background(), "acct-1", "agent-active")
	if err != nil || projection.LocalAgentID != "agent-active" || projection.DisplayName != "Active Agent" {
		t.Fatalf("owner projection = (%+v, %v)", projection, err)
	}
	for _, input := range [][2]string{{"acct-2", "agent-active"}, {"acct-1", "agent-suspended"}, {"acct-1", "agent-missing"}} {
		owned, err := svc.OwnsActiveLocalAgent(context.Background(), input[0], input[1])
		if err != nil || owned {
			t.Fatalf("ownership(%q, %q) = (%v, %v)", input[0], input[1], owned, err)
		}
	}
}
