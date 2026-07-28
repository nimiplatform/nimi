package account

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestLocalAppPermissionOwnerProjectionPreservesLifecycleAndSelectedAgent(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open a conversation with my selected Agent",
	})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	pending := getSingleOwnerPermissionProjection(t, fixture)
	if pending.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_PENDING ||
		pending.GetOwnerRevision() != 1 || pending.GetRequestedAt() == nil || pending.GetDecidedAt() != nil || len(pending.GetSelectedAgents()) != 0 {
		t.Fatalf("pending owner projection = %+v", pending)
	}
	issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(context.Background(), desktopAccountControlCaller(), fixture.resolver.binding.LocalAppPrincipalID, "agents.interact", "agent-owned")
	if err != nil {
		t.Fatal(err)
	}
	approved, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.Handle, Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || !approved.GetAccepted() {
		t.Fatalf("approve = (%+v, %v)", approved, err)
	}
	granted := getSingleOwnerPermissionProjection(t, fixture)
	if granted.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED ||
		granted.GetOwnerRevision() != 2 || granted.GetDecidedAt() == nil || len(granted.GetSelectedAgents()) != 1 ||
		granted.GetSelectedAgents()[0].GetLocalAgentId() != "agent-owned" || granted.GetSelectedAgents()[0].GetDisplayName() != "Owned Agent" {
		t.Fatalf("granted owner projection = %+v", granted)
	}
	selector, err := fixture.kernel.AgentSelectorHandles().Resolve(context.Background(), localappkernel.ResolveAgentSelectorHandleInput{
		Handle: issued.Handle, AccountID: "acct-1", LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID, PermissionID: "agents.interact",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.kernel.PermissionGrants().Transition(context.Background(), localappkernel.TransitionPermissionGrantInput{
		Key: localappkernel.PermissionGrantKey{LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1",
			LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID, PermissionID: "agents.interact", OwnerSelectorDigest: selector.OwnerSelectorDigest},
		ExpectedRevision: 2, State: localappkernel.PermissionGrantStateExpired,
	}); err != nil {
		t.Fatal(err)
	}
	expired := getSingleOwnerPermissionProjection(t, fixture)
	if expired.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_EXPIRED || expired.GetOwnerRevision() != 3 || len(expired.GetSelectedAgents()) != 1 {
		t.Fatalf("expired owner projection = %+v", expired)
	}
	appStatus, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || appStatus.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED {
		t.Fatalf("expired app projection = (%+v, %v)", appStatus, err)
	}
	revoked, err := fixture.service.RevokeLocalAppPermission(context.Background(), &runtimev1.RevokeLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.Handle,
	})
	if err != nil || !revoked.GetAccepted() {
		t.Fatalf("revoke = (%+v, %v)", revoked, err)
	}
	revokedProjection := getSingleOwnerPermissionProjection(t, fixture)
	if revokedProjection.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_REVOKED ||
		revokedProjection.GetOwnerRevision() != 4 || len(revokedProjection.GetSelectedAgents()) != 1 {
		t.Fatalf("revoked owner projection = %+v", revokedProjection)
	}
	appStatus, err = fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || appStatus.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED {
		t.Fatalf("revoked app projection = (%+v, %v)", appStatus, err)
	}
}

func TestLocalAppPermissionOwnerProjectionShowsDeniedWithoutSelector(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	_, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil {
		t.Fatal(err)
	}
	denied, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: false, ExpectedOwnerRevision: 1,
	})
	if err != nil || !denied.GetAccepted() {
		t.Fatalf("deny = (%+v, %v)", denied, err)
	}
	projection := getSingleOwnerPermissionProjection(t, fixture)
	if projection.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_DENIED ||
		projection.GetOwnerRevision() != 2 || projection.GetDecidedAt() == nil || len(projection.GetSelectedAgents()) != 0 {
		t.Fatalf("denied owner projection = %+v", projection)
	}
}

func getSingleOwnerPermissionProjection(t *testing.T, fixture *localAppAuthorityFixture) *runtimev1.LocalAppPermissionOwnerProjection {
	t.Helper()
	response, err := fixture.service.GetLocalAppPermissionOwnerProjection(context.Background(), &runtimev1.GetLocalAppPermissionOwnerProjectionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
	})
	if err != nil || !response.GetAccepted() || len(response.GetPermissions()) != 1 {
		t.Fatalf("owner projection response = (%+v, %v)", response, err)
	}
	return response.GetPermissions()[0]
}
