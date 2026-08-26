package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func testLocalAgentContext(ownerUserID string, runtimeSourceRef string) *runtimev1.AgentRequestContext {
	fixtureKey := runtimeSourceRef
	canonicalRuntimeSourceRef := testRuntimeAgentSourceRef(fixtureKey)
	return &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-boundary-test",
		SubjectUserId:    ownerUserID,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: canonicalRuntimeSourceRef,
		LocalAgentRef:    testOpaqueLocalAgentRef(ownerUserID, fixtureKey),
	}
}

func testRuntimeAgentSourceRef(_ string) string {
	verifiedSourceRef := sourceMaterializationCharacterSourceRefV3{
		Kind:           "personaCharacter",
		ID:             "persona-materialization-v3",
		WorldID:        "world-materialization-v3",
		OwnerAccountID: "source-owner-1",
		SourceHash:     "0bab0c4faf1548436903d6f0c90f0f2a610ea5bc3f28796b3fd344bd7f1a1e20",
	}
	canonicalRuntimeSourceRef, err := runtimeSourceRefForRealmSourceV3(verifiedSourceRef)
	if err != nil {
		panic(err)
	}
	return canonicalRuntimeSourceRef
}

func testRuntimeAgentIdentityContext(runtimeSourceRef string) *runtimev1.AgentRequestContext {
	return testLocalAgentContext("user-1", runtimeSourceRef)
}

func testRuntimeAgentLocalRef(runtimeSourceRef string) string {
	if strings.HasPrefix(strings.TrimSpace(runtimeSourceRef), localAgentRefPrefix) {
		return strings.TrimSpace(runtimeSourceRef)
	}
	return testOpaqueLocalAgentRef("user-1", runtimeSourceRef)
}

func testOpaqueLocalAgentRef(ownerUserID string, runtimeSourceRef string) string {
	digest := sha256HexBytes([]byte(strings.TrimSpace(ownerUserID) + "\x00" + strings.TrimSpace(runtimeSourceRef)))
	return runtimeGeneratedLocalAgentRefPrefix + digest[:32]
}

func testMaterializeLocalAgent(t *testing.T, svc *Service, ownerUserID string, runtimeSourceRef string) string {
	t.Helper()
	ctx := testLocalAgentContext(ownerUserID, runtimeSourceRef)
	resp, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context:          ctx,
		LocalAgentRef:    ctx.GetLocalAgentRef(),
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: runtimeSourceRef,
	})
	if err != nil {
		t.Fatalf("RealmSourceMaterialization(%s,%s): %v", ownerUserID, runtimeSourceRef, err)
	}
	if resp.GetAgent().GetLocalAgentRef() != ctx.GetLocalAgentRef() {
		t.Fatalf("local_agent_ref mismatch: got %q want %q", resp.GetAgent().GetLocalAgentRef(), ctx.GetLocalAgentRef())
	}
	return ctx.GetLocalAgentRef()
}

func TestRuntimeAgentLocalAgentRefIsolatesTwoOwnersForSameRuntimeSource(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	runtimeSourceRef := "runtime-source-shared"
	userALocalRef := testMaterializeLocalAgent(t, svc, "user-a", runtimeSourceRef)
	userBLocalRef := testMaterializeLocalAgent(t, svc, "user-b", runtimeSourceRef)
	if userALocalRef == userBLocalRef {
		t.Fatalf("expected distinct local refs for two owners, got %q", userALocalRef)
	}

	ctxA := testLocalAgentContext("user-a", runtimeSourceRef)
	ctxB := testLocalAgentContext("user-b", runtimeSourceRef)
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
		Context:          ctxA,
		LocalAgentRef:    userALocalRef,
		OwnerUserId:      "user-a",
		RuntimeSourceRef: ctxA.GetRuntimeSourceRef(),
		SubjectUserId:    "user-a",
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(user-a): %v", err)
	}
	anchorB, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:          ctxB,
		LocalAgentRef:    userBLocalRef,
		OwnerUserId:      "user-b",
		RuntimeSourceRef: ctxB.GetRuntimeSourceRef(),
		SubjectUserId:    "user-b",
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
		Candidates: []*runtimev1.CanonicalMemoryCandidate{promotionEvidenceTestCandidate(userALocalRef, completePromotionEvidence(t, svc))},
	})
	if err != nil {
		t.Fatalf("WriteAgentMemory(user-a): %v", err)
	}
	if len(writeResp.GetAccepted()) != 1 {
		t.Fatalf("expected one accepted memory, got %#v", writeResp)
	}
	memA, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{Context: ctxA, Query: "PromotionEvidence", Limit: 10, CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED}})
	if err != nil {
		t.Fatalf("QueryAgentMemory(user-a): %v", err)
	}
	memB, err := svc.QueryAgentMemory(context.Background(), &runtimev1.QueryAgentMemoryRequest{Context: ctxB, Query: "PromotionEvidence", Limit: 10, CanonicalClasses: []runtimev1.MemoryCanonicalClass{runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED}})
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
		name          string
		owner         string
		runtimeSource string
		local         string
		wantStatus    codes.Code
	}{
		{name: "missing localAgentRef", owner: "user-a", runtimeSource: "runtime-source-1", local: "", wantStatus: codes.InvalidArgument},
		{name: "bare runtimeSourceRef", owner: "user-a", runtimeSource: "runtime-source-1", local: "runtime-source-1", wantStatus: codes.InvalidArgument},
		{name: "malformed localAgentRef", owner: "user-a", runtimeSource: "runtime-source-1", local: "agent:user-a:runtime-source-1", wantStatus: codes.InvalidArgument},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateLocalAgentIdentity(tt.owner, tt.runtimeSource, tt.local)
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
	runtimeSourceRef := "runtime-source-anchor"
	localRef := testMaterializeLocalAgent(t, svc, "user-a", runtimeSourceRef)
	_, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:          testLocalAgentContext("user-a", runtimeSourceRef),
		LocalAgentRef:    localRef,
		OwnerUserId:      "user-a",
		RuntimeSourceRef: runtimeSourceRef,
		SubjectUserId:    "user-b",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected owner mismatch failure, got %v", err)
	}
}
