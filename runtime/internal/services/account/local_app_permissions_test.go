package account

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
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
	request, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || request.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE {
		t.Fatalf("reserved request = (%+v, %v)", request, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("reserved request persisted: %v", err)
	}
}

func TestAdmittedLocalAppPermissionRequestPersistsAndRefreshesPending(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	first, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open a conversation with my selected Agent",
	})
	if err != nil || first.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING || first.GetProjection().GetCanRequest() {
		t.Fatalf("first request = (%+v, %v)", first, err)
	}
	request, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact")
	if err != nil || request.Revision != 1 || request.DisplayAppID != "sample.nimi.app" {
		t.Fatalf("persisted request = (%+v, %v)", request, err)
	}
	secondReason := "Continue the selected Agent conversation"
	second, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: secondReason,
	})
	if err != nil || second.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("refreshed request = (%+v, %v)", second, err)
	}
	request, err = fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact")
	if err != nil || request.Revision != 2 || request.Reason != secondReason {
		t.Fatalf("refreshed persisted request = (%+v, %v)", request, err)
	}
	status, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || status.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("pending status = (%+v, %v)", status, err)
	}
	audits, err := fixture.service.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "local_app_permission"})
	if err != nil || len(audits.GetEvents()) != 1 || audits.GetEvents()[0].GetPayload().GetFields()["selector_digest"] != nil {
		t.Fatalf("prompt-to-pending audits = (%+v, %v)", audits, err)
	}
}

func TestLocalAppPermissionRequestFailsClosedWithoutAuditAndForIneligiblePermission(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	failed, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open a conversation",
	})
	if err != nil || failed.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("audit-failed request = (%+v, %v)", failed, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("audit failure persisted request: %v", err)
	}

	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = nil
	ineligible, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
		PermissionId: "agents.interact", Reason: "Open a conversation",
	})
	if err != nil || ineligible.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE {
		t.Fatalf("manifest-ineligible request = (%+v, %v)", ineligible, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("ineligible request persisted: %v", err)
	}
}

func TestResolvedLocalAppPermissionRequestDoesNotRevivePending(t *testing.T) {
	for _, test := range []struct {
		name     string
		approved bool
		posture  runtimev1.LocalAppPermissionPosture
	}{
		{name: "granted", approved: true, posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED},
		{name: "denied", approved: false, posture: runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_DENIED},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newLocalAppAuthorityFixture(t)
			fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
			fixture.service.auditStore = auditlog.New(32, 32)
			fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
			fixture.resolver.binding.Capabilities = []string{"agents.interact"}
			requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
			if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
				t.Fatalf("request = (%+v, %v)", requested, err)
			}
			issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(context.Background(), desktopAccountControlCaller(), fixture.resolver.binding.LocalAppPrincipalID, "agents.interact", "agent-owned")
			if err != nil {
				t.Fatal(err)
			}
			decisionRequest := &runtimev1.DecideLocalAppPermissionRequest{
				Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
				PermissionId: "agents.interact", SelectorHandle: map[bool]string{true: issued.Handle}[test.approved], Approved: test.approved, ExpectedOwnerRevision: 1,
			}
			decision, err := fixture.service.DecideLocalAppPermission(context.Background(), decisionRequest)
			if err != nil || !decision.GetAccepted() || decision.GetOwnerRevision() != 2 {
				t.Fatalf("decision = (%+v, %v)", decision, err)
			}
			repeatedDecision, err := fixture.service.DecideLocalAppPermission(context.Background(), decisionRequest)
			if err != nil || repeatedDecision.GetAccepted() || repeatedDecision.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
				t.Fatalf("already-decided request = (%+v, %v)", repeatedDecision, err)
			}
			request, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{
				PermissionId: "agents.interact", Reason: "Try to request this permission again",
			})
			if err != nil || request.GetProjection().GetPosture() != test.posture {
				t.Fatalf("resolved repeated request = (%+v, %v)", request, err)
			}
			if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
				t.Fatalf("resolved request revived pending: %v", err)
			}
		})
	}
}

func TestAdmittedLocalAppPermissionManagementGrantUseAndRevoke(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	requested, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	issued, err := fixture.service.IssueLocalAppAgentSelectorHandle(context.Background(), &runtimev1.IssueLocalAppAgentSelectorHandleRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", LocalAgentId: "agent-owned",
	})
	if err != nil || !issued.GetAccepted() || issued.GetSelectorHandle() == "" {
		t.Fatalf("issue selector = (%+v, %v)", issued, err)
	}
	decided, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.GetSelectorHandle(), Approved: true, ExpectedOwnerRevision: 1,
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
	_, err := fixture.kernel.PermissionGrants().CreatePendingRequest(context.Background(), localappkernel.CreatePermissionRequestInput{
		LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1", LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID: "agents.interact", DisplayAppID: "sample.nimi.app", Reason: "Open a conversation",
	})
	if err != nil {
		t.Fatal(err)
	}
	issued, err := fixture.service.IssueOwnerLocalAppAgentSelectorHandle(context.Background(), desktopAccountControlCaller(), fixture.resolver.binding.LocalAppPrincipalID, "agents.interact", "agent-owned")
	if err != nil {
		t.Fatal(err)
	}
	decision, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", SelectorHandle: issued.Handle, Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || decision.GetAccepted() || decision.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("audit-failed decision = (%+v, %v)", decision, err)
	}
	statusResponse, _ := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
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
	tooLong, err := fixture.service.RequestLocalAppPermission(context.Background(), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: strings.Repeat("x", localAppPermissionReasonMaxBytes+1)})
	if err != nil || tooLong.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || tooLong.GetProjection().GetCanRequest() {
		t.Fatalf("unbounded reason must fail closed: response=%+v err=%v", tooLong, err)
	}
}
