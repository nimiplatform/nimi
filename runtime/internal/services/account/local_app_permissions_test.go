package account

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
)

func TestLocalAppPublicPermissionStatusKeepsReservedCatalogUnavailable(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	response, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	projection := response.GetProjection()
	if projection.GetPermissionId() != "agents.interact" || projection.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE || projection.GetCanRequest() || projection.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("unexpected reserved posture: %+v", projection)
	}
}

func TestAdmittedLocalAppPermissionManagementGrantUseAndRevoke(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	issued, err := fixture.service.IssueLocalAppAgentSelectorHandle(context.Background(), &runtimev1.IssueLocalAppAgentSelectorHandleRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", LocalAgentId: "agent-owned",
	})
	if err != nil || !issued.GetAccepted() || issued.GetSelectorHandle() == "" {
		t.Fatalf("issue selector = (%+v, %v)", issued, err)
	}
	decided, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.GetSelectorHandle(), Approved: true,
	})
	if err != nil || !decided.GetAccepted() || decided.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED || decided.GetOwnerRevision() != 2 {
		t.Fatalf("approve permission = (%+v, %v)", decided, err)
	}
	statusResponse, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED {
		t.Fatalf("granted status = (%+v, %v)", statusResponse, err)
	}
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	operationDecision, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: issued.GetSelectorHandle()})
	if err != nil || operationDecision.OwnerSelectedAgentID != "agent-owned" || operationDecision.OperationCapability != "agents.interact" {
		t.Fatalf("granted operation = (%+v, %v)", operationDecision, err)
	}
	revoked, err := fixture.service.RevokeLocalAppPermission(context.Background(), &runtimev1.RevokeLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.GetSelectorHandle(),
	})
	if err != nil || !revoked.GetAccepted() || revoked.GetOwnerRevision() != 3 {
		t.Fatalf("revoke permission = (%+v, %v)", revoked, err)
	}
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: issued.GetSelectorHandle()}); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED {
		t.Fatalf("revoked operation reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}
	statusResponse, err = fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED {
		t.Fatalf("revoked public status = (%+v, %v)", statusResponse, err)
	}
	audits, err := fixture.service.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "local_app_permission"})
	if err != nil || len(audits.GetEvents()) != 4 {
		t.Fatalf("permission audit count = (%d, %v)", len(audits.GetEvents()), err)
	}
}

func TestPermissionDecisionFailsClosedWhenAuditStoreUnavailable(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(context.Background(), desktopAccountControlCaller(), fixture.resolver.binding.LocalAppPrincipalID, "agents.interact", "agent-owned")
	if err != nil {
		t.Fatal(err)
	}
	decision, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.Handle, Approved: true,
	})
	if err != nil || decision.GetAccepted() || decision.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("audit-failed decision = (%+v, %v)", decision, err)
	}
	statusResponse, _ := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT {
		t.Fatalf("audit failure mutated owner decision: %+v", statusResponse)
	}
}

func TestLocalAppPublicPermissionRejectsInternalIDsAndAuthorityFields(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	status, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "runtime_agent.conversation.open"})
	if err != nil || status.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
		t.Fatalf("internal operation id must fail closed: response=%+v err=%v", status, err)
	}
	request, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: " leading whitespace"})
	if err != nil || request.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || request.GetProjection().GetCanRequest() {
		t.Fatalf("non-canonical reason must fail closed: response=%+v err=%v", request, err)
	}
}
