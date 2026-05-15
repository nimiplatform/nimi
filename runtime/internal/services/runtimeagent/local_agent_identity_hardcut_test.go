package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func testLocalAgentContext(ownerUserID string, realmAgentID string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:         "runtime-agent-hardcut-test",
		SubjectUserId: ownerUserID,
		OwnerUserId:   ownerUserID,
		RealmAgentId:  realmAgentID,
		LocalAgentRef: buildLocalAgentRef(ownerUserID, realmAgentID),
	}
}

func testRuntimeAgentIdentityContext(realmAgentID string) *runtimev1.AgentRequestContext {
	return testLocalAgentContext("user-1", realmAgentID)
}

func testRuntimeAgentLocalRef(realmAgentID string) string {
	if strings.HasPrefix(strings.TrimSpace(realmAgentID), localAgentRefPrefix) {
		return strings.TrimSpace(realmAgentID)
	}
	return buildLocalAgentRef("user-1", realmAgentID)
}

func testInitializeLocalAgent(t *testing.T, svc *Service, ownerUserID string, realmAgentID string) string {
	t.Helper()
	ctx := testLocalAgentContext(ownerUserID, realmAgentID)
	resp, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:       ctx,
		LocalAgentRef: ctx.GetLocalAgentRef(),
		OwnerUserId:   ownerUserID,
		RealmAgentId:  realmAgentID,
		DisplayName:   ownerUserID + " local fork",
	})
	if err != nil {
		t.Fatalf("InitializeAgent(%s,%s): %v", ownerUserID, realmAgentID, err)
	}
	if resp.GetAgent().GetLocalAgentRef() != ctx.GetLocalAgentRef() {
		t.Fatalf("local_agent_ref mismatch: got %q want %q", resp.GetAgent().GetLocalAgentRef(), ctx.GetLocalAgentRef())
	}
	return ctx.GetLocalAgentRef()
}

func TestRuntimeAgentLocalAgentRefIsolatesTwoOwnersForSameRealmAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	realmAgentID := "realm-agent-shared"
	userALocalRef := testInitializeLocalAgent(t, svc, "user-a", realmAgentID)
	userBLocalRef := testInitializeLocalAgent(t, svc, "user-b", realmAgentID)
	if userALocalRef == userBLocalRef {
		t.Fatalf("expected distinct local refs for two owners, got %q", userALocalRef)
	}

	ctxA := testLocalAgentContext("user-a", realmAgentID)
	ctxB := testLocalAgentContext("user-b", realmAgentID)
	if _, err := svc.UpdateAgentState(context.Background(), &runtimev1.UpdateAgentStateRequest{
		Context: ctxA,
		Mutations: []*runtimev1.AgentStateMutation{{
			Mutation: &runtimev1.AgentStateMutation_SetStatusText{
				SetStatusText: &runtimev1.AgentStateSetStatusText{StatusText: "owner a state"},
			},
		}},
	}); err != nil {
		t.Fatalf("UpdateAgentState(user-a): %v", err)
	}
	stateA, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{Context: ctxA})
	if err != nil {
		t.Fatalf("GetAgentState(user-a): %v", err)
	}
	stateB, err := svc.GetAgentState(context.Background(), &runtimev1.GetAgentStateRequest{Context: ctxB})
	if err != nil {
		t.Fatalf("GetAgentState(user-b): %v", err)
	}
	if stateA.GetState().GetStatusText() != "owner a state" {
		t.Fatalf("owner a state not persisted: %#v", stateA.GetState())
	}
	if strings.TrimSpace(stateB.GetState().GetStatusText()) != "" {
		t.Fatalf("owner b shared owner a state: %#v", stateB.GetState())
	}

	anchorA, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       ctxA,
		LocalAgentRef: userALocalRef,
		OwnerUserId:   "user-a",
		RealmAgentId:  realmAgentID,
		SubjectUserId: "user-a",
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(user-a): %v", err)
	}
	anchorB, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       ctxB,
		LocalAgentRef: userBLocalRef,
		OwnerUserId:   "user-b",
		RealmAgentId:  realmAgentID,
		SubjectUserId: "user-b",
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(user-b): %v", err)
	}
	if anchorA.GetSnapshot().GetAnchor().GetConversationAnchorId() == anchorB.GetSnapshot().GetAnchor().GetConversationAnchorId() {
		t.Fatalf("expected separate conversation anchors")
	}
	if anchorA.GetSnapshot().GetAnchor().GetLocalAgentRef() != userALocalRef || anchorB.GetSnapshot().GetAnchor().GetLocalAgentRef() != userBLocalRef {
		t.Fatalf("anchor local refs not isolated: a=%q b=%q", anchorA.GetSnapshot().GetAnchor().GetLocalAgentRef(), anchorB.GetSnapshot().GetAnchor().GetLocalAgentRef())
	}

	writeResp, err := svc.WriteAgentMemory(context.Background(), &runtimev1.WriteAgentMemoryRequest{
		Context:    ctxA,
		Candidates: []*runtimev1.CanonicalMemoryCandidate{promotionEvidenceTestCandidate(userALocalRef, completePromotionEvidence(t))},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(user-a): %v", err)
	}
	if len(writeResp.GetAccepted()) != 1 {
		t.Fatalf("expected one accepted memory, got %#v", writeResp)
	}
	memA, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{Context: ctxA, Query: "PromotionEvidence", Limit: 10})
	if err != nil {
		t.Fatalf("QueryAgentMemory(user-a): %v", err)
	}
	memB, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{Context: ctxB, Query: "PromotionEvidence", Limit: 10})
	if err != nil {
		t.Fatalf("QueryAgentMemory(user-b): %v", err)
	}
	if len(memA.GetMemories()) == 0 {
		t.Fatalf("expected owner a memory recall")
	}
	if len(memB.GetMemories()) != 0 {
		t.Fatalf("owner b recalled owner a memory: %#v", memB.GetMemories())
	}
}

func TestRuntimeAgentLocalAgentIdentityNegativeGates(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		owner      string
		realm      string
		local      string
		wantStatus codes.Code
	}{
		{name: "missing localAgentRef", owner: "user-a", realm: "realm-agent-1", local: "", wantStatus: codes.InvalidArgument},
		{name: "bare realmAgentId", owner: "user-a", realm: "realm-agent-1", local: "realm-agent-1", wantStatus: codes.InvalidArgument},
		{name: "owner mismatch", owner: "user-a", realm: "realm-agent-1", local: "local-agent:user-b:realm-agent-1", wantStatus: codes.InvalidArgument},
		{name: "realmAgentId mismatch", owner: "user-a", realm: "realm-agent-1", local: "local-agent:user-a:realm-agent-2", wantStatus: codes.InvalidArgument},
		{name: "malformed localAgentRef", owner: "user-a", realm: "realm-agent-1", local: "agent:user-a:realm-agent-1", wantStatus: codes.InvalidArgument},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateLocalAgentIdentity(tt.owner, tt.realm, tt.local)
			if err == nil {
				t.Fatalf("expected validation failure")
			}
			if status.Code(err) != tt.wantStatus {
				t.Fatalf("status.Code = %s, want %s (%v)", status.Code(err), tt.wantStatus, err)
			}
		})
	}
}

func TestRuntimeAgentConversationAnchorRejectsOwnerMismatch(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	realmAgentID := "realm-agent-anchor"
	localRef := testInitializeLocalAgent(t, svc, "user-a", realmAgentID)
	_, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:       testLocalAgentContext("user-a", realmAgentID),
		LocalAgentRef: localRef,
		OwnerUserId:   "user-a",
		RealmAgentId:  realmAgentID,
		SubjectUserId: "user-b",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected owner mismatch failure, got %v", err)
	}
}
