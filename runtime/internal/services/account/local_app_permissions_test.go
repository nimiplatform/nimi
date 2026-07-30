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

type mutableLocalAgentOwnershipFixture struct {
	accountID string
	agents    []LocalAgentOwnerProjection
}

func (fixture *mutableLocalAgentOwnershipFixture) OwnsActiveLocalAgent(_ context.Context, accountID string, localAgentID string) (bool, error) {
	if fixture == nil || accountID != fixture.accountID {
		return false, nil
	}
	for _, agent := range fixture.agents {
		if agent.LocalAgentID == localAgentID {
			return true, nil
		}
	}
	return false, nil
}

func (fixture *mutableLocalAgentOwnershipFixture) ListOwnedActiveLocalAgents(_ context.Context, accountID string) ([]LocalAgentOwnerProjection, error) {
	if fixture == nil || accountID != fixture.accountID {
		return nil, ErrLocalAppSelectorMismatch
	}
	return append([]LocalAgentOwnerProjection(nil), fixture.agents...), nil
}

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
	request, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-1"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || request.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE {
		t.Fatalf("reserved request = (%+v, %v)", request, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("reserved request persisted: %v", err)
	}
}

func TestLocalAppPermissionPostureDistinguishesReservedAndUnknown(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	for _, test := range []struct {
		permissionID string
		reason       runtimev1.ReasonCode
	}{
		{permissionID: "agents.configure", reason: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED},
		{permissionID: "agents.unknown", reason: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN},
	} {
		response, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: test.permissionID})
		if err != nil || response.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE || response.GetProjection().GetReasonCode() != test.reason {
			t.Fatalf("permission posture %q = (%+v, %v), want %s", test.permissionID, response, err, test.reason)
		}
	}
}

func TestDuplicatePermissionRequestIDRefreshesOnePendingDialog(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	first, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-2"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open conversations with my Agents"})
	if err != nil || first.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING || first.GetProjection().GetCanRequest() {
		t.Fatalf("first request = (%+v, %v)", first, err)
	}
	if len(first.GetProjection().GetAgents()) != 0 {
		t.Fatalf("pending permission leaked Agent metadata: %+v", first.GetProjection())
	}
	request, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact")
	if err != nil || request.Revision != 1 || request.DisplayAppID != "sample.nimi.app" {
		t.Fatalf("persisted request = (%+v, %v)", request, err)
	}
	secondReason := "Continue conversations with my Agents"
	second, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-2"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: secondReason})
	if err != nil || second.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("refreshed request = (%+v, %v)", second, err)
	}
	request, err = fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact")
	if err != nil || request.Revision != 2 || request.Reason != secondReason {
		t.Fatalf("refreshed persisted request = (%+v, %v)", request, err)
	}
	pendingRows, err := fixture.kernel.PermissionGrants().ListPendingRequests(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1")
	if err != nil || len(pendingRows) != 1 {
		t.Fatalf("duplicate request created multiple dialogs = (%+v, %v)", pendingRows, err)
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

func TestConcurrentDuplicatePermissionRequestsProduceOnePendingDialog(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	type result struct {
		response *runtimev1.RequestLocalAppPermissionResponse
		err      error
	}
	start := make(chan struct{})
	results := make(chan result, 2)
	for range 2 {
		go func() {
			<-start
			response, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("concurrent-permission-request-1"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open conversations"})
			results <- result{response: response, err: err}
		}()
	}
	close(start)
	for range 2 {
		result := <-results
		if result.err != nil || result.response.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
			t.Fatalf("concurrent request = (%+v, %v)", result.response, result.err)
		}
	}
	pending, err := fixture.kernel.PermissionGrants().ListPendingRequests(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1")
	if err != nil || len(pending) != 1 || pending[0].Revision != 2 {
		t.Fatalf("concurrent pending dialogs = (%+v, %v)", pending, err)
	}
}

func TestLocalAppPermissionRequestFailsClosedWithoutAuditAndForIneligiblePermission(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	failed, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-4"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || failed.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("audit-failed request = (%+v, %v)", failed, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("audit failure persisted request: %v", err)
	}

	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = nil
	ineligible, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-5"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || ineligible.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_UNAVAILABLE {
		t.Fatalf("manifest-ineligible request = (%+v, %v)", ineligible, err)
	}
	if _, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact"); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("ineligible request persisted: %v", err)
	}
}

func TestRejectedPermissionReturnsPromptDedupsRequestIDAndAllowsFreshCycle(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	const firstRequestID = "permission-cycle-rejected-1"
	requested, err := fixture.service.RequestLocalAppPermission(permissionRequestContext(firstRequestID), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	decision, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: false, ExpectedOwnerRevision: 1,
	})
	if err != nil || !decision.GetAccepted() || decision.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT {
		t.Fatalf("reject = (%+v, %v)", decision, err)
	}
	repeated, err := fixture.service.RequestLocalAppPermission(permissionRequestContext(firstRequestID), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Bug retry of rejected request"})
	if err != nil || repeated.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT || !repeated.GetProjection().GetCanRequest() {
		t.Fatalf("deduplicated rejected request = (%+v, %v)", repeated, err)
	}
	fresh, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("permission-cycle-rejected-2"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "User requested again"})
	if err != nil || fresh.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("fresh request cycle = (%+v, %v)", fresh, err)
	}
	pending, err := fixture.kernel.PermissionGrants().GetPendingRequest(context.Background(), fixture.kernel.LocalOSUserAnchor(), "acct-1", fixture.resolver.binding.LocalAppPrincipalID, "agents.interact")
	if err != nil || pending.RequestID != "permission-cycle-rejected-2" || pending.Revision != 3 {
		t.Fatalf("fresh pending = (%+v, %v)", pending, err)
	}
}

func TestAdmittedLocalAppPermissionManagementGrantUseAndRevoke(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	requested, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-8"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open a conversation"})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	decided, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || !decided.GetAccepted() || decided.GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED || decided.GetOwnerRevision() != 2 {
		t.Fatalf("approve permission = (%+v, %v)", decided, err)
	}
	statusResponse, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED ||
		len(statusResponse.GetProjection().GetAgents()) != 1 ||
		statusResponse.GetProjection().GetAgents()[0].GetAgentHandle() == "" ||
		statusResponse.GetProjection().GetAgents()[0].GetAgentHandle() == "agent-owned" ||
		statusResponse.GetProjection().GetAgents()[0].GetDisplayName() != "Owned Agent" {
		t.Fatalf("granted status = (%+v, %v)", statusResponse, err)
	}
	agentHandle := statusResponse.GetProjection().GetAgents()[0].GetAgentHandle()
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	operationDecision, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: agentHandle})
	if err != nil || operationDecision.LocalAgentID != "agent-owned" || operationDecision.OperationCapability != "agents.interact" {
		t.Fatalf("granted operation = (%+v, %v)", operationDecision, err)
	}
	revoked, err := fixture.service.RevokeLocalAppPermission(context.Background(), &runtimev1.RevokeLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact",
	})
	if err != nil || !revoked.GetAccepted() || revoked.GetOwnerRevision() != 3 {
		t.Fatalf("revoke permission = (%+v, %v)", revoked, err)
	}
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: agentHandle}); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED {
		t.Fatalf("removed-grant operation reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}
	statusResponse, err = fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"})
	if err != nil || statusResponse.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PROMPT ||
		!statusResponse.GetProjection().GetCanRequest() || len(statusResponse.GetProjection().GetAgents()) != 0 {
		t.Fatalf("post-revoke public status = (%+v, %v)", statusResponse, err)
	}
	audits, err := fixture.service.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "local_app_permission"})
	if err != nil || len(audits.GetEvents()) != 4 {
		t.Fatalf("permission audit count = (%d, %v)", len(audits.GetEvents()), err)
	}
}

func TestAccountScopeGrantCoversZeroCurrentAndAllFutureAgents(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.auditStore = auditlog.New(64, 64)
	ownership := &mutableLocalAgentOwnershipFixture{accountID: "acct-1"}
	fixture.service.SetLocalAgentOwnershipResolver(ownership)
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}

	requested, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-9"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: "Open conversations with all of my Agents"})
	if err != nil || requested.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_PENDING {
		t.Fatalf("request = (%+v, %v)", requested, err)
	}
	decided, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: true, ExpectedOwnerRevision: 1,
	})
	if err != nil || !decided.GetAccepted() {
		t.Fatalf("approve account scope = (%+v, %v)", decided, err)
	}
	empty, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{
		PermissionId: "agents.interact",
	})
	if err != nil || empty.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED ||
		len(empty.GetProjection().GetAgents()) != 0 {
		t.Fatalf("zero-Agent grant = (%+v, %v)", empty, err)
	}

	ownership.agents = []LocalAgentOwnerProjection{
		{LocalAgentID: "agent-a", DisplayName: "Agent A"},
		{LocalAgentID: "agent-b", DisplayName: "Agent B"},
	}
	withAgents, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{
		PermissionId: "agents.interact",
	})
	if err != nil || withAgents.GetProjection().GetPosture() != runtimev1.LocalAppPermissionPosture_LOCAL_APP_PERMISSION_POSTURE_GRANTED ||
		len(withAgents.GetProjection().GetAgents()) != 2 {
		t.Fatalf("future Agents materialization = (%+v, %v)", withAgents, err)
	}
	handles := make(map[string]string, 2)
	for _, agent := range withAgents.GetProjection().GetAgents() {
		if agent.GetAgentHandle() == "" {
			t.Fatalf("empty Agent handle: %+v", agent)
		}
		handles[agent.GetDisplayName()] = agent.GetAgentHandle()
	}
	repeated, err := fixture.service.GetLocalAppPermissionStatus(context.Background(), &runtimev1.GetLocalAppPermissionStatusRequest{
		PermissionId: "agents.interact",
	})
	if err != nil || len(repeated.GetProjection().GetAgents()) != 2 {
		t.Fatalf("repeated materialization = (%+v, %v)", repeated, err)
	}
	for _, agent := range repeated.GetProjection().GetAgents() {
		if handles[agent.GetDisplayName()] != agent.GetAgentHandle() {
			t.Fatalf("unstable Agent handle: before=%q after=%q", handles[agent.GetDisplayName()], agent.GetAgentHandle())
		}
	}

	ownership.agents = ownership.agents[1:]
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: handles["Agent A"]},
	); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED {
		t.Fatalf("removed Agent handle reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: handles["Agent B"]},
	); err != nil {
		t.Fatalf("remaining Agent handle denied: %v", err)
	}
	revoked, err := fixture.service.RevokeLocalAppPermission(context.Background(), &runtimev1.RevokeLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact",
	})
	if err != nil || !revoked.GetAccepted() {
		t.Fatalf("revoke account scope = (%+v, %v)", revoked, err)
	}
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: handles["Agent B"]},
	); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED {
		t.Fatalf("removed-grant future-Agent handle reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}
}

func TestPermissionDecisionFailsClosedWhenAuditStoreUnavailable(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" }
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact"}
	_, err := fixture.kernel.PermissionGrants().CreatePendingRequest(context.Background(), localappkernel.CreatePermissionRequestInput{
		LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1", LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID: "agents.interact", RequestID: "test-audit-failure-request", DisplayAppID: "sample.nimi.app", Reason: "Open a conversation",
	})
	if err != nil {
		t.Fatal(err)
	}
	decision, err := fixture.service.DecideLocalAppPermission(context.Background(), &runtimev1.DecideLocalAppPermissionRequest{
		Caller: desktopAccountControlCaller(), LocalAppPrincipalId: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionId: "agents.interact", Approved: true, ExpectedOwnerRevision: 1,
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
	if err != nil || status.GetProjection().GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN {
		t.Fatalf("internal operation id must fail closed: response=%+v err=%v", status, err)
	}
	request, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-10"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: " leading whitespace"})
	if err != nil || request.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || request.GetProjection().GetCanRequest() {
		t.Fatalf("non-canonical reason must fail closed: response=%+v err=%v", request, err)
	}
	tooLong, err := fixture.service.RequestLocalAppPermission(permissionRequestContext("test-local_app_permissions_test-11"), &runtimev1.RequestLocalAppPermissionRequest{PermissionId: "agents.interact", Reason: strings.Repeat("x", localAppPermissionReasonMaxBytes+1)})
	if err != nil || tooLong.GetProjection().GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID || tooLong.GetProjection().GetCanRequest() {
		t.Fatalf("unbounded reason must fail closed: response=%+v err=%v", tooLong, err)
	}
}
