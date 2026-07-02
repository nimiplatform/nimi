package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// guideRuntimeSourceRef is the `~archivist` Nimi guide runtime_source_ref.
//
// It is referenced here only as an ordinary hash-bearing runtime source
// identifier carried by a SourceMaterializationPacket. This is not a
// runtime-local guide constant: it carries no welcome copy, no prompt, and no
// guide branch. The anti-regression guard in guide_localagent_no_constant_test.go
// deliberately exempts `_test.go` files for exactly this reason.
const guideRuntimeSourceRef = "runtime-source:worldCharacter:nimi-system:nimi-guide-archivist:hash-1"

// TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent is the K-AGCORE-139 /
// K-AGCORE-140 runtime conformance evidence: it proves the `~archivist` guide
// runtime source materializes through SourceMaterializationPacket validation
// into a runtime-owned opaque LocalAgent via the identical ordinary code path as
// any non-guide runtime source.
func TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent(t *testing.T) {
	t.Setenv(sourceMaterializationHMACSecretEnv, "unit-test-source-packet-secret")

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	ownerUserID := "user-guide-owner"
	packet := testSourceMaterializationPacket(
		t,
		ownerUserID,
		guideRuntimeSourceRef,
		"nonce-guide-materialization-1",
		time.Now().UTC().Add(5*time.Minute),
		sourceMaterializationAudienceDesktop,
	)

	initResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime-agent-guide-packet-test",
			SubjectUserId:    ownerUserID,
			OwnerUserId:      ownerUserID,
			RuntimeSourceRef: guideRuntimeSourceRef,
		},
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: guideRuntimeSourceRef,
		DisplayName:      "Archivist",
		Metadata:         testSourceMaterializationMetadata(t, packet),
	})
	if err != nil {
		t.Fatalf("InitializeAgent(guide): %v", err)
	}
	agent := initResp.GetAgent()
	localAgentRef := agent.GetLocalAgentRef()
	if !strings.HasPrefix(localAgentRef, runtimeGeneratedLocalAgentRefPrefix) {
		t.Fatalf("local_agent_ref = %q, want Runtime-generated opaque ref", localAgentRef)
	}
	if strings.Contains(localAgentRef, ownerUserID) || strings.Contains(localAgentRef, guideRuntimeSourceRef) {
		t.Fatalf("local_agent_ref is source-derived: %q", localAgentRef)
	}
	if agent.GetRuntimeSourceRef() != guideRuntimeSourceRef {
		t.Fatalf("runtime_source_ref = %q, want %q", agent.GetRuntimeSourceRef(), guideRuntimeSourceRef)
	}
	if agent.GetOwnerUserId() != ownerUserID {
		t.Fatalf("owner_user_id = %q, want %q", agent.GetOwnerUserId(), ownerUserID)
	}
	if agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		t.Fatalf("guide lifecycle = %s, want ACTIVE", agent.GetLifecycleStatus())
	}

	guideCtx := &runtimev1.AgentRequestContext{
		AppId:            "runtime-agent-guide-packet-test",
		SubjectUserId:    ownerUserID,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: guideRuntimeSourceRef,
		LocalAgentRef:    localAgentRef,
	}

	anchorResp, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{
		Context:          guideCtx,
		LocalAgentRef:    localAgentRef,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: guideRuntimeSourceRef,
		SubjectUserId:    ownerUserID,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(guide): %v", err)
	}
	anchor := anchorResp.GetSnapshot().GetAnchor()
	if anchor.GetLocalAgentRef() != localAgentRef {
		t.Fatalf("anchor local_agent_ref = %q, want %q", anchor.GetLocalAgentRef(), localAgentRef)
	}
	if anchor.GetStatus() != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE {
		t.Fatalf("anchor status = %s, want ACTIVE", anchor.GetStatus())
	}
	if anchorResp.GetSnapshot().GetActiveTurnId() != "" {
		t.Fatalf("guide anchor seeded an active turn %q; runtime must not seed welcome copy", anchorResp.GetSnapshot().GetActiveTurnId())
	}
	if anchor.GetLastTurnId() != "" || anchor.GetLastMessageId() != "" {
		t.Fatalf("guide anchor carries seeded turn/message linkage; runtime must not seed welcome copy")
	}

	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: guideCtx,
		Reason:  "conformance teardown",
	}); err != nil {
		t.Fatalf("TerminateAgent(guide): %v", err)
	}
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: guideCtx}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent(guide) after terminate: status = %s, want NotFound (%v)", status.Code(err), err)
	}
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: guideCtx,
		Reason:  "conformance teardown repeat",
	}); err != nil {
		t.Fatalf("TerminateAgent(guide) idempotent repeat: %v", err)
	}

	nextPacket := testSourceMaterializationPacket(
		t,
		ownerUserID,
		guideRuntimeSourceRef,
		"nonce-guide-materialization-2",
		time.Now().UTC().Add(5*time.Minute),
		sourceMaterializationAudienceDesktop,
	)
	nextResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:            "runtime-agent-guide-packet-test",
			SubjectUserId:    ownerUserID,
			OwnerUserId:      ownerUserID,
			RuntimeSourceRef: guideRuntimeSourceRef,
		},
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: guideRuntimeSourceRef,
		DisplayName:      "Archivist",
		Metadata:         testSourceMaterializationMetadata(t, nextPacket),
	})
	if err != nil {
		t.Fatalf("re-init guide after terminate (clean re-materialize): %v", err)
	}
	if nextResp.GetAgent().GetLocalAgentRef() == localAgentRef {
		t.Fatalf("fresh guide materialization reused deleted local_agent_ref %q", localAgentRef)
	}
}

// TestRuntimeAgentGuideRuntimeSourceRefTakesNoSpecialBranch asserts the guide
// runtime_source_ref is treated identically to an arbitrary non-guide id by the
// projection identity layer. There is no privileged-id recognition anywhere in
// the LocalAgent identity surface.
func TestRuntimeAgentGuideRuntimeSourceRefTakesNoSpecialBranch(t *testing.T) {
	t.Parallel()

	ownerUserID := "user-branch-check"
	guideIdentity, err := validateLocalAgentIdentity(
		ownerUserID, guideRuntimeSourceRef, testOpaqueLocalAgentRef(ownerUserID, guideRuntimeSourceRef),
	)
	if err != nil {
		t.Fatalf("validateLocalAgentIdentity(guide): %v", err)
	}
	plainIdentity, err := validateLocalAgentIdentity(
		ownerUserID, "runtime-source:worldCharacter:world-1:plain:hash-1", testOpaqueLocalAgentRef(ownerUserID, "runtime-source:worldCharacter:world-1:plain:hash-1"),
	)
	if err != nil {
		t.Fatalf("validateLocalAgentIdentity(plain): %v", err)
	}
	if guideIdentity.LocalAgentRef == plainIdentity.LocalAgentRef {
		t.Fatalf("distinct runtime_source_ref values must yield distinct refs")
	}
	if guideIdentity.OwnerUserID != plainIdentity.OwnerUserID {
		t.Fatalf("owner scoping diverges between guide and plain identity")
	}
}
