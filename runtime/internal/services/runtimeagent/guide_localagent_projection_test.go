package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// guideRealmAgentID is the `~archivist` Nimi guide RealmAgent's realm_agent_id.
//
// It is the W1 backend bootstrap's `AgentProfile.id` for the guide agent
// (`NIMI_GUIDE_AGENT_IDS.archivist` in
// nimi-backend/libs/common/src/guide-agent-bootstrap.ts). It is referenced here
// only as an ordinary opaque realm_agent_id test input: the runtime treats it
// as any other RealmAgent identifier. This is NOT a runtime-local guide
// constant — it carries no welcome copy, no prompt, no guide branch — and the
// anti-regression guard in guide_localagent_no_constant_test.go deliberately
// exempts `_test.go` files for exactly this reason.
const guideRealmAgentID = "nimi-guide-archivist"

// TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent is the K-AGCORE-139 /
// K-AGCORE-140 runtime conformance evidence: it proves the `~archivist` guide
// RealmAgent projects through InitializeAgent into a
// `local-agent:${owner}:${realm}` LocalAgent via the identical ordinary code
// path as any non-guide RealmAgent.
//
// The proof is by construction: the test drives the guide realm_agent_id
// through the same public Service methods, with the same request shapes, that
// TestRuntimeAgentLocalAgentRefIsolatesTwoOwnersForSameRealmAgent uses for a
// plain `realm-agent-shared` id. There is no guide-specific code path to take,
// so identical behavior is the conformance result.
func TestRuntimeAgentGuideProjectsAsOrdinaryLocalAgent(t *testing.T) {
	t.Parallel()

	svc := newRuntimeAgentTestService(t)
	ctx := context.Background()
	ownerUserID := "user-guide-owner"
	guideCtx := testLocalAgentContext(ownerUserID, guideRealmAgentID)

	// Ordinary projection identity: local_agent_ref is the deterministic
	// owner-scoped projection of the guide realm_agent_id, with no special
	// prefix or branch.
	wantLocalRef := buildLocalAgentRef(ownerUserID, guideRealmAgentID)
	if wantLocalRef != "local-agent:"+ownerUserID+":"+guideRealmAgentID {
		t.Fatalf("guide local_agent_ref is not an ordinary projection: %q", wantLocalRef)
	}

	// InitializeAgent: ordinary write path, no guide field on the request.
	initResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context:       guideCtx,
		LocalAgentRef: wantLocalRef,
		OwnerUserId:   ownerUserID,
		RealmAgentId:  guideRealmAgentID,
		DisplayName:   "Archivist",
	})
	if err != nil {
		t.Fatalf("InitializeAgent(guide): %v", err)
	}
	agent := initResp.GetAgent()
	if agent.GetLocalAgentRef() != wantLocalRef {
		t.Fatalf("local_agent_ref = %q, want %q", agent.GetLocalAgentRef(), wantLocalRef)
	}
	if agent.GetRealmAgentId() != guideRealmAgentID {
		t.Fatalf("realm_agent_id = %q, want %q", agent.GetRealmAgentId(), guideRealmAgentID)
	}
	if agent.GetOwnerUserId() != ownerUserID {
		t.Fatalf("owner_user_id = %q, want %q", agent.GetOwnerUserId(), ownerUserID)
	}
	if agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
		t.Fatalf("guide lifecycle = %s, want ACTIVE", agent.GetLifecycleStatus())
	}

	// Idempotency gate (K-AGCORE-139 "one account-scoped LocalAgent projection
	// ... idempotently"): re-init is a typed no-op for the same LocalAgent.
	reinitResp, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context:       guideCtx,
		LocalAgentRef: wantLocalRef,
		OwnerUserId:   ownerUserID,
		RealmAgentId:  guideRealmAgentID,
		DisplayName:   "Archivist",
	})
	if err != nil {
		t.Fatalf("re-init guide: %v", err)
	}
	if got := reinitResp.GetAgent().GetLocalAgentRef(); got != wantLocalRef {
		t.Fatalf("re-init local_agent_ref = %q, want %q", got, wantLocalRef)
	}

	// Ordinary conversation anchor: opens through the same seam, no
	// first-message / welcome-copy seeding by the runtime.
	anchorResp, err := svc.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{
		Context:       guideCtx,
		LocalAgentRef: wantLocalRef,
		OwnerUserId:   ownerUserID,
		RealmAgentId:  guideRealmAgentID,
		SubjectUserId: ownerUserID,
	})
	if err != nil {
		t.Fatalf("OpenConversationAnchor(guide): %v", err)
	}
	anchor := anchorResp.GetSnapshot().GetAnchor()
	if anchor.GetLocalAgentRef() != wantLocalRef {
		t.Fatalf("anchor local_agent_ref = %q, want %q", anchor.GetLocalAgentRef(), wantLocalRef)
	}
	if anchor.GetStatus() != runtimev1.ConversationAnchorStatus_CONVERSATION_ANCHOR_STATUS_ACTIVE {
		t.Fatalf("anchor status = %s, want ACTIVE", anchor.GetStatus())
	}
	// The runtime seeds no first turn / welcome message into the anchor.
	if anchorResp.GetSnapshot().GetActiveTurnId() != "" {
		t.Fatalf("guide anchor seeded an active turn %q; runtime must not seed welcome copy", anchorResp.GetSnapshot().GetActiveTurnId())
	}
	if anchor.GetLastTurnId() != "" || anchor.GetLastMessageId() != "" {
		t.Fatalf("guide anchor carries seeded turn/message linkage; runtime must not seed welcome copy")
	}

	// Ordinary lifecycle: TerminateAgent behaves as for any RealmAgent. Per
	// K-AGCORE-141 TerminateAgent hard-deletes the LocalAgent projection — it
	// does not flip a status field and does not retain a TERMINATED tombstone.
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: guideCtx,
		Reason:  "conformance teardown",
	}); err != nil {
		t.Fatalf("TerminateAgent(guide): %v", err)
	}
	// The projection row is physically gone: GetAgent must report NotFound, not
	// a retained TERMINATED record.
	if _, err := svc.GetAgent(ctx, &runtimev1.GetAgentRequest{Context: guideCtx}); status.Code(err) != codes.NotFound {
		t.Fatalf("GetAgent(guide) after terminate: status = %s, want NotFound (%v)", status.Code(err), err)
	}

	// TerminateAgent is idempotent: a second terminate of the now-absent ref is
	// a typed no-op, not a not-found error (K-AGCORE-141 fixed rule).
	if _, err := svc.TerminateAgent(ctx, &runtimev1.TerminateAgentRequest{
		Context: guideCtx,
		Reason:  "conformance teardown repeat",
	}); err != nil {
		t.Fatalf("TerminateAgent(guide) idempotent repeat: %v", err)
	}

	// Post-terminate the ref is absent, so a fresh InitializeAgent is an
	// ordinary clean create that re-materializes the projection through the
	// K-AGCORE-139 path — not a tombstone repair.
	if _, err := svc.InitializeAgent(ctx, &runtimev1.InitializeAgentRequest{
		Context:       guideCtx,
		LocalAgentRef: wantLocalRef,
		OwnerUserId:   ownerUserID,
		RealmAgentId:  guideRealmAgentID,
		DisplayName:   "Archivist",
	}); err != nil {
		t.Fatalf("re-init guide after terminate (clean re-materialize): %v", err)
	}
}

// TestRuntimeAgentGuideRealmAgentIDTakesNoSpecialBranch asserts the guide
// realm_agent_id is treated identically to an arbitrary non-guide id by the
// projection identity layer — there is no privileged-id recognition anywhere
// in the LocalAgent identity surface (K-AGCORE-139 "no special official-guide
// path").
func TestRuntimeAgentGuideRealmAgentIDTakesNoSpecialBranch(t *testing.T) {
	t.Parallel()

	ownerUserID := "user-branch-check"
	guideIdentity, err := validateLocalAgentIdentity(
		ownerUserID, guideRealmAgentID, buildLocalAgentRef(ownerUserID, guideRealmAgentID),
	)
	if err != nil {
		t.Fatalf("validateLocalAgentIdentity(guide): %v", err)
	}
	plainIdentity, err := validateLocalAgentIdentity(
		ownerUserID, "realm-agent-plain", buildLocalAgentRef(ownerUserID, "realm-agent-plain"),
	)
	if err != nil {
		t.Fatalf("validateLocalAgentIdentity(plain): %v", err)
	}
	// The only difference between the guide and a plain RealmAgent is the
	// opaque realm_agent_id string; the identity struct shape, the ref
	// construction rule, and the validation path are identical.
	if guideIdentity.LocalAgentRef == plainIdentity.LocalAgentRef {
		t.Fatalf("distinct realm_agent_id values must yield distinct refs")
	}
	if guideIdentity.OwnerUserID != plainIdentity.OwnerUserID {
		t.Fatalf("owner scoping diverges between guide and plain identity")
	}
}
