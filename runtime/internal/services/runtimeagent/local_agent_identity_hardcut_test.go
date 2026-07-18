package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func testLocalAgentContext(ownerUserID string, runtimeSourceRef string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-hardcut-test",
		SubjectUserId:    ownerUserID,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: runtimeSourceRef,
		LocalAgentRef:    testOpaqueLocalAgentRef(ownerUserID, runtimeSourceRef),
	}
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

func testInitializeLocalAgent(t *testing.T, svc *Service, ownerUserID string, runtimeSourceRef string) string {
	t.Helper()
	ctx := testLocalAgentContext(ownerUserID, runtimeSourceRef)
	resp, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          ctx,
		LocalAgentRef:    ctx.GetLocalAgentRef(),
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      ownerUserID + " local fork",
	})
	if err != nil {
		t.Fatalf("InitializeAgent(%s,%s): %v", ownerUserID, runtimeSourceRef, err)
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
	userALocalRef := testInitializeLocalAgent(t, svc, "user-a", runtimeSourceRef)
	userBLocalRef := testInitializeLocalAgent(t, svc, "user-b", runtimeSourceRef)
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
		RuntimeSourceRef: runtimeSourceRef,
		SubjectUserId:    "user-a",
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(user-a): %v", err)
	}
	anchorB, err := svc.OpenConversationAnchor(context.Background(), &runtimev1.OpenConversationAnchorRequest{
		Context:          ctxB,
		LocalAgentRef:    userBLocalRef,
		OwnerUserId:      "user-b",
		RuntimeSourceRef: runtimeSourceRef,
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

func TestInitializeAgentRejectsRealmSourceAndRetiredPacketMetadata(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	realmSourceRef := "runtime-source:worldCharacter:world-1:character-1:hash-1"
	realmContext := testLocalAgentContext("user-a", realmSourceRef)
	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          realmContext,
		LocalAgentRef:    realmContext.GetLocalAgentRef(),
		OwnerUserId:      "user-a",
		RuntimeSourceRef: realmSourceRef,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("Realm source InitializeAgent status = %s, want FailedPrecondition (%v)", status.Code(err), err)
	}

	ordinarySourceRef := "runtime-source-local-fixture"
	ordinaryContext := testLocalAgentContext("user-a", ordinarySourceRef)
	metadata, metadataErr := structpb.NewStruct(map[string]any{
		"sourceMaterializationPacket": map[string]any{"packetSchemaVersion": "retired"},
	})
	if metadataErr != nil {
		t.Fatalf("build retired packet metadata: %v", metadataErr)
	}
	_, err = svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          ordinaryContext,
		LocalAgentRef:    ordinaryContext.GetLocalAgentRef(),
		OwnerUserId:      "user-a",
		RuntimeSourceRef: ordinarySourceRef,
		Metadata:         metadata,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("retired packet metadata status = %s, want InvalidArgument (%v)", status.Code(err), err)
	}
	if _, getErr := svc.GetAgent(context.Background(), &runtimev1.GetAgentRequest{Context: ordinaryContext}); status.Code(getErr) != codes.NotFound {
		t.Fatalf("retired packet metadata created an agent: %v", getErr)
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

func TestInitializeAgentIdempotencyRejectsExistingIdentityMismatch(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	runtimeSourceRef := "runtime-source-existing-idempotency"
	localRef := testInitializeLocalAgent(t, svc, "user-a", runtimeSourceRef)

	ownerMismatchCtx := &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-hardcut-test",
		SubjectUserId:    "user-b",
		OwnerUserId:      "user-b",
		RuntimeSourceRef: runtimeSourceRef,
		LocalAgentRef:    localRef,
	}
	_, err := svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          ownerMismatchCtx,
		LocalAgentRef:    localRef,
		OwnerUserId:      "user-b",
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      "owner mismatch",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("owner mismatch status = %s, want %s (%v)", status.Code(err), codes.FailedPrecondition, err)
	}

	runtimeSourceMismatchCtx := &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-hardcut-test",
		SubjectUserId:    "user-a",
		OwnerUserId:      "user-a",
		RuntimeSourceRef: "runtime-source-other",
		LocalAgentRef:    localRef,
	}
	_, err = svc.InitializeAgent(context.Background(), &runtimev1.InitializeAgentRequest{
		Context:          runtimeSourceMismatchCtx,
		LocalAgentRef:    localRef,
		OwnerUserId:      "user-a",
		RuntimeSourceRef: "runtime-source-other",
		DisplayName:      "source mismatch",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("runtime source mismatch status = %s, want %s (%v)", status.Code(err), codes.FailedPrecondition, err)
	}
}

func TestRuntimeAgentConversationAnchorRejectsOwnerMismatch(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	runtimeSourceRef := "runtime-source-anchor"
	localRef := testInitializeLocalAgent(t, svc, "user-a", runtimeSourceRef)
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
