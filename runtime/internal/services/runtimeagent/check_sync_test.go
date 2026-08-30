package runtimeagent

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestCheckSyncDataRootProjectsOnlyAuthenticatedAccountWithoutPrivateReferences(t *testing.T) {
	dataRoot := t.TempDir()
	svc := newRuntimeAgentServiceForPublicChatStatePath(t, filepath.Join(dataRoot, "accounts", "runtime", "local-state.json"))
	current := testRuntimeAgentLocalRef("agent-alpha")
	svc.mu.Lock()
	currentSource := svc.agents[current].Agent.GetRuntimeSourceRef()
	svc.agents["private-other-agent"] = &agentEntry{Agent: &runtimev1.LocalAgentRecord{
		LocalAgentRef: "private-other-agent", RuntimeSourceRef: "private-other-source", OwnerUserId: "account-other",
	}}
	svc.mu.Unlock()
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors["private-current-anchor"] = &publicChatAnchorState{
		ConversationAnchorID: "private-current-anchor", AgentID: current, LocalAgentRef: current,
		OwnerUserID: "user-1", SubjectUserID: "user-1", RuntimeSourceRef: currentSource,
	}
	svc.chatAnchors["private-other-anchor"] = &publicChatAnchorState{
		ConversationAnchorID: "private-other-anchor", AgentID: "private-other-agent", LocalAgentRef: "private-other-agent",
		OwnerUserID: "account-other", SubjectUserID: "account-other", RuntimeSourceRef: "private-other-source",
	}
	svc.chatSurfaceMu.Unlock()

	resources, err := svc.CheckSyncDataRoot(context.Background(), dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	var agents, conversations int
	for _, resource := range resources {
		if strings.Contains(resource.Reason, "other") || strings.Contains(resource.Reason, "private") {
			t.Fatalf("Check & Sync leaked another Account: %+v", resource)
		}
		switch resource.Kind {
		case "local_agent":
			agents++
		case "conversation":
			conversations++
		}
	}
	if agents != 1 || conversations != 1 {
		t.Fatalf("current Account resources agents=%d conversations=%d: %+v", agents, conversations, resources)
	}
}

func TestCheckSyncDataRootWithoutAuthenticatedAccountIsUnavailable(t *testing.T) {
	dataRoot := t.TempDir()
	svc, closeFn := openRuntimeAgentTestComposition(t, filepath.Join(dataRoot, "accounts", "runtime", "local-state.json"))
	t.Cleanup(closeFn)
	svc.SetRuntimeAccountProjectionProvider(nil)
	resources, err := svc.CheckSyncDataRoot(context.Background(), dataRoot)
	if err != nil || len(resources) != 1 || resources[0].Status != "unavailable" || resources[0].Reason != "RUNTIME_OWNER_ACCOUNT_REAUTH_REQUIRED" {
		t.Fatalf("unauthenticated Check & Sync=%+v err=%v", resources, err)
	}
}
