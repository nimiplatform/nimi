package account

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestListLocalAppPermissionOwnerProjectionsReturnsCurrentAccountScopeAgentsOnly(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	ownership := &ownerProjectionAgentSetFixture{
		accountID: "acct-1",
		agents: []LocalAgentOwnerProjection{
			{LocalAgentID: "agent-owned-1", DisplayName: "Owned Agent One"},
			{LocalAgentID: "agent-owned-2", DisplayName: "Owned Agent Two"},
		},
	}
	fixture.service.SetLocalAgentOwnershipResolver(ownership)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	if _, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open conversations with my Agents",
	}); err != nil {
		t.Fatal(err)
	}
	approved, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || !approved.GetAccepted() {
		t.Fatalf("approve = (%+v, %v)", approved, err)
	}
	if _, err := fixture.kernel.PermissionGrants().CreatePendingRequest(context.Background(), localappkernel.CreatePermissionRequestInput{
		LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-other",
		LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID, PermissionID: "agents.interact",
		DisplayAppID: "other-account.nimi.app", Reason: "Must remain isolated",
	}); err != nil {
		t.Fatal(err)
	}

	response, err := fixture.service.ListLocalAppPermissionOwnerProjections(context.Background(), &runtimev1.ListLocalAppPermissionOwnerProjectionsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || len(response.GetPermissions()) != 1 {
		t.Fatalf("owner list = (%+v, %v)", response, err)
	}
	projection := response.GetPermissions()[0]
	if projection.GetLocalAppPrincipalId() != fixture.resolver.binding.LocalAppPrincipalID || projection.GetDisplayAppId() != "sample.nimi.app" ||
		projection.GetPermissionId() != "agents.interact" || projection.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED ||
		projection.GetOwnerRevision() != 2 || projection.GetRequestedAt() == nil || projection.GetDecidedAt() == nil || len(projection.GetCoveredAgents()) != 2 ||
		projection.GetCoveredAgents()[0].GetLocalAgentId() != "agent-owned-1" || projection.GetCoveredAgents()[0].GetDisplayName() != "Owned Agent One" ||
		projection.GetCoveredAgents()[1].GetLocalAgentId() != "agent-owned-2" || projection.GetCoveredAgents()[1].GetDisplayName() != "Owned Agent Two" {
		t.Fatalf("granted owner list projection = %+v", projection)
	}

	ownership.agents = append(ownership.agents, LocalAgentOwnerProjection{LocalAgentID: "agent-owned-3", DisplayName: "Owned Agent Three"})
	response, err = fixture.service.ListLocalAppPermissionOwnerProjections(context.Background(), &runtimev1.ListLocalAppPermissionOwnerProjectionsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !response.GetAccepted() || len(response.GetPermissions()) != 1 {
		t.Fatalf("owner list after Agent creation = (%+v, %v)", response, err)
	}
	coveredAgents := response.GetPermissions()[0].GetCoveredAgents()
	coveredByID := make(map[string]string, len(coveredAgents))
	for _, agent := range coveredAgents {
		coveredByID[agent.GetLocalAgentId()] = agent.GetDisplayName()
	}
	if len(coveredAgents) != 3 || coveredByID["agent-owned-3"] != "Owned Agent Three" {
		t.Fatalf("owner list after Agent creation = %+v", response.GetPermissions()[0])
	}
}

func TestListLocalAppPermissionOwnerProjectionsReservedAndEmpty(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	response, err := fixture.service.ListLocalAppPermissionOwnerProjections(context.Background(), &runtimev1.ListLocalAppPermissionOwnerProjectionsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !response.GetAccepted() || response.GetPermissions() == nil || len(response.GetPermissions()) != 0 {
		t.Fatalf("empty owner list = (%+v, %v)", response, err)
	}
	requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Reserved permission"})
	if err != nil || requested.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("reserved request = (%+v, %v)", requested, err)
	}
	response, err = fixture.service.ListLocalAppPermissionOwnerProjections(context.Background(), &runtimev1.ListLocalAppPermissionOwnerProjectionsRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !response.GetAccepted() || response.GetPermissions() == nil || len(response.GetPermissions()) != 0 {
		t.Fatalf("reserved owner list = (%+v, %v)", response, err)
	}
}

func TestListLocalAppPermissionOwnerProjectionsRejectsNonOwnerCaller(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	response, err := fixture.service.ListLocalAppPermissionOwnerProjections(context.Background(), &runtimev1.ListLocalAppPermissionOwnerProjectionsRequest{Caller: firstPartyCaller()})
	if err != nil || response.GetAccepted() || response.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
		t.Fatalf("non-owner list = (%+v, %v)", response, err)
	}
}

func TestLocalAppPermissionOwnerProjectionPreservesLifecycleAndCurrentAgentSnapshot(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open conversations with my Agents",
	})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	pending := getSingleOwnerPermissionProjection(t, fixture)
	if pending.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_PENDING ||
		pending.GetOwnerRevision() != 1 || pending.GetRequestedAt() == nil || pending.GetDecidedAt() != nil || len(pending.GetCoveredAgents()) != 0 {
		t.Fatalf("pending owner projection = %+v", pending)
	}
	approved, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || !approved.GetAccepted() {
		t.Fatalf("approve = (%+v, %v)", approved, err)
	}
	granted := getSingleOwnerPermissionProjection(t, fixture)
	if granted.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_GRANTED ||
		granted.GetOwnerRevision() != 2 || granted.GetDecidedAt() == nil || len(granted.GetCoveredAgents()) != 1 ||
		granted.GetCoveredAgents()[0].GetLocalAgentId() != "agent-owned" || granted.GetCoveredAgents()[0].GetDisplayName() != "Owned Agent" {
		t.Fatalf("granted owner projection = %+v", granted)
	}
	if _, err := fixture.kernel.PermissionGrants().Transition(context.Background(), localappkernel.TransitionPermissionGrantInput{
		Key: localappkernel.PermissionGrantKey{LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1",
			LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID, PermissionID: "agents.interact",
			OwnerSelectorDigest: localappkernel.AgentAccountScopeDigest("acct-1")},
		ExpectedRevision: 2, State: localappkernel.PermissionGrantStateExpired,
	}); err != nil {
		t.Fatal(err)
	}
	expired := getSingleOwnerPermissionProjection(t, fixture)
	if expired.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_EXPIRED || expired.GetOwnerRevision() != 3 || len(expired.GetCoveredAgents()) != 0 {
		t.Fatalf("expired owner projection = %+v", expired)
	}
	appStatus, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || appStatus.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED {
		t.Fatalf("expired app projection = (%+v, %v)", appStatus, err)
	}
	revoked, err := fixture.service.RevokeLocalAppPermission(context.Background(), &runtimev1.RevokeLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact",
	})
	if err != nil || !revoked.GetAccepted() {
		t.Fatalf("revoke = (%+v, %v)", revoked, err)
	}
	revokedProjection := getSingleOwnerPermissionProjection(t, fixture)
	if revokedProjection.GetPosture() != runtimev1.LocalAppPermissionOwnerPosture_LOCAL_APP_PERMISSION_OWNER_POSTURE_REVOKED ||
		revokedProjection.GetOwnerRevision() != 4 || len(revokedProjection.GetCoveredAgents()) != 0 {
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
		projection.GetOwnerRevision() != 2 || projection.GetDecidedAt() == nil || len(projection.GetCoveredAgents()) != 0 {
		t.Fatalf("denied owner projection = %+v", projection)
	}
}

type ownerProjectionAgentSetFixture struct {
	accountID string
	agents    []LocalAgentOwnerProjection
}

func (fixture *ownerProjectionAgentSetFixture) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	if accountID != fixture.accountID {
		return false, nil
	}
	for _, agent := range fixture.agents {
		if agent.LocalAgentID == localAgentID {
			return true, nil
		}
	}
	return false, nil
}

func (fixture *ownerProjectionAgentSetFixture) ListOwnedActiveLocalAgents(_ context.Context, accountID string) ([]LocalAgentOwnerProjection, error) {
	if accountID != fixture.accountID {
		return nil, ErrLocalAppSelectorMismatch
	}
	return append([]LocalAgentOwnerProjection(nil), fixture.agents...), nil
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
