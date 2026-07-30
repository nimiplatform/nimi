package account

import (
	"context"
	"errors"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestAuthorizeLocalAppProtectedOperationsFailClosedUntilProductPermissionAdmission(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	tests := []struct {
		operation LocalAppOperation
		selector  localappop.Selector
	}{
		{LocalAppOperationReadArtifactBytes, localappop.Selector{ArtifactID: "artifact-a"}},
		{LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationSendConversationTurn, localappop.Selector{AgentID: "agent-a", ConversationAnchorID: "anchor-a", TurnID: "turn-a"}},
		{LocalAppOperationSubscribeConversation, localappop.Selector{AgentID: "agent-a", ConversationAnchorID: "anchor-a"}},
		{LocalAppOperationConversationSnapshot, localappop.Selector{AgentID: "agent-a", ConversationAnchorID: "anchor-a"}},
		{LocalAppOperationConfigurationSnapshot, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationUpdateConfiguration, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationReadinessSnapshot, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationAutonomySnapshot, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationUpdateAutonomy, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationPresentationSnapshot, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationCommitPresentation, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationVoiceTranscribe, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationVoiceStreamSubscribe, localappop.Selector{AgentID: "agent-a", ConversationAnchorID: "anchor-a", TurnID: "turn-a", VoiceStreamID: "voice-a"}},
	}
	for _, test := range tests {
		expected := runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE
		if permission, mapped := apppermissionForTestOperation(test.operation); mapped && permission == "reserved" {
			expected = runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED
		}
		if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, test.operation, test.selector); LocalAppOperationAuthorizationReason(err) != expected {
			t.Fatalf("operation %q reason = %s, want %s err=%v", test.operation, LocalAppOperationAuthorizationReason(err), expected, err)
		}
	}
}

func apppermissionForTestOperation(operation LocalAppOperation) (string, bool) {
	switch operation {
	case LocalAppOperationReadArtifactBytes,
		LocalAppOperationConfigurationSnapshot, LocalAppOperationUpdateConfiguration,
		LocalAppOperationReadinessSnapshot, LocalAppOperationAutonomySnapshot,
		LocalAppOperationUpdateAutonomy, LocalAppOperationPresentationSnapshot,
		LocalAppOperationCommitPresentation:
		return "reserved", true
	default:
		return "", false
	}
}

func TestConfigureGrantCannotMaterializeOrValidateHandlesWithoutInteract(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" || id == "agents.configure" }
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact", "agents.configure"}
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	digest := localappkernel.AgentAccountScopeDigest("acct-1")
	configureKey := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1",
		LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID:        "agents.configure", OwnerSelectorDigest: digest,
	}
	pending, err := fixture.kernel.PermissionGrants().CreatePending(context.Background(), localappkernel.CreatePermissionGrantInput{Key: configureKey})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.kernel.PermissionGrants().Transition(context.Background(), localappkernel.TransitionPermissionGrantInput{Key: configureKey, ExpectedRevision: pending.Revision, State: localappkernel.PermissionGrantStateGranted}); err != nil {
		t.Fatal(err)
	}
	handle, err := fixture.kernel.AgentHandles().EnsureAccountScope(context.Background(), localappkernel.EnsureAccountScopeAgentHandleInput{
		AccountID: "acct-1", LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID: "agents.interact", OwnerSelectorDigest: digest, LocalAgentID: "agent-owned",
	})
	if err != nil {
		t.Fatal(err)
	}
	caller, err := fixture.service.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.materializeAccountAgentHandles(ctx, caller, "agents.configure", digest); !errors.Is(err, ErrLocalAppSelectorUnavailable) {
		t.Fatalf("configure materialization without interact error = %v", err)
	}
	_, err = fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationConfigurationSnapshot, localappop.Selector{AgentID: handle.Handle})
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED {
		t.Fatalf("configure without interact reason = %s, want required (err=%v)", got, err)
	}
}

func TestConfigureGrantBecomesImmediatelyIneffectiveWhenInteractIsRevoked(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.service.permissionAdmitted = func(id string) bool { return id == "agents.interact" || id == "agents.configure" }
	fixture.service.auditStore = auditlog.New(32, 32)
	fixture.service.SetLocalAgentOwnershipResolver(localAgentOwnershipFixture{accountID: "acct-1", agentID: "agent-owned"})
	fixture.resolver.binding.Capabilities = []string{"agents.interact", "agents.configure"}
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	digest := localappkernel.AgentAccountScopeDigest("acct-1")
	for _, permissionID := range []string{"agents.interact", "agents.configure"} {
		key := localappkernel.PermissionGrantKey{
			LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1",
			LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
			PermissionID:        permissionID, OwnerSelectorDigest: digest,
		}
		pending, err := fixture.kernel.PermissionGrants().CreatePending(context.Background(), localappkernel.CreatePermissionGrantInput{Key: key})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fixture.kernel.PermissionGrants().Transition(context.Background(), localappkernel.TransitionPermissionGrantInput{Key: key, ExpectedRevision: pending.Revision, State: localappkernel.PermissionGrantStateGranted}); err != nil {
			t.Fatal(err)
		}
	}
	handle, err := fixture.kernel.AgentHandles().EnsureAccountScope(context.Background(), localappkernel.EnsureAccountScopeAgentHandleInput{
		AccountID: "acct-1", LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID: "agents.interact", OwnerSelectorDigest: digest, LocalAgentID: "agent-owned",
	})
	if err != nil {
		t.Fatal(err)
	}
	caller, err := fixture.service.AuthorizeLocalAppCaller(ctx)
	if err != nil {
		t.Fatal(err)
	}
	interactHandles, err := fixture.service.materializeAccountAgentHandles(ctx, caller, "agents.interact", digest)
	if err != nil || len(interactHandles) != 1 {
		t.Fatalf("interact handle materialization = (%+v, %v)", interactHandles, err)
	}
	configureHandles, err := fixture.service.materializeAccountAgentHandles(ctx, caller, "agents.configure", digest)
	if err != nil || len(configureHandles) != 1 {
		t.Fatalf("configure handle materialization = (%+v, %v)", configureHandles, err)
	}
	if got, want := configureHandles[0].Handle, interactHandles[0].Handle; got != want || got != handle.Handle {
		t.Fatalf("configure handle = %q, interact handle = %q, issued handle = %q", got, want, handle.Handle)
	}
	selector := localappop.Selector{AgentID: handle.Handle}
	configureOperations := []LocalAppOperation{
		LocalAppOperationConfigurationSnapshot, LocalAppOperationUpdateConfiguration,
		LocalAppOperationReadinessSnapshot, LocalAppOperationAutonomySnapshot,
		LocalAppOperationUpdateAutonomy, LocalAppOperationPresentationSnapshot,
		LocalAppOperationCommitPresentation,
	}
	for _, operation := range configureOperations {
		if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, operation, selector); err != nil {
			t.Fatalf("hypothetically admitted configure operation %s was ineffective before dependency revoke: %v", operation, err)
		}
	}
	audits, err := fixture.service.auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "local_app_permission"})
	if err != nil || len(audits.GetEvents()) != len(configureOperations) {
		t.Fatalf("configure operation audits = (%d, %v), want %d", len(audits.GetEvents()), err, len(configureOperations))
	}
	interactKey := localappkernel.PermissionGrantKey{
		LocalOSUserAnchor: fixture.kernel.LocalOSUserAnchor(), AccountID: "acct-1",
		LocalAppPrincipalID: fixture.resolver.binding.LocalAppPrincipalID,
		PermissionID:        "agents.interact", OwnerSelectorDigest: digest,
	}
	if _, err := fixture.kernel.PermissionGrants().Transition(context.Background(), localappkernel.TransitionPermissionGrantInput{
		Key: interactKey, ExpectedRevision: 2, State: localappkernel.PermissionGrantStateRevoked,
	}); err != nil {
		t.Fatal(err)
	}
	_, err = fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationConfigurationSnapshot, selector)
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED {
		t.Fatalf("configure after interact revoke reason = %s, want revoked (err=%v)", got, err)
	}
	if _, err := fixture.service.materializeAccountAgentHandles(ctx, caller, "agents.configure", digest); !errors.Is(err, ErrLocalAppSelectorUnavailable) {
		t.Fatalf("configure materialization after interact revoke error = %v", err)
	}
}

func TestAuthorizeLocalAppStorageUsesBaseEntitlementWithoutPermission(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	fixture.resolver.binding.Capabilities = nil
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	decision, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx,
		LocalAppOperationStorageJSONWrite,
		localappop.Selector{StorageRelativePath: "state/value.json"},
	)
	if err != nil {
		t.Fatalf("app-private storage authorization failed: %v", err)
	}
	if decision.AuthorityClass != localappop.AuthorityClassBaseEntitlement ||
		decision.OperationCapability != "app.private_storage" ||
		decision.LocalAppPrincipalID != fixture.resolver.binding.LocalAppPrincipalID {
		t.Fatalf("app-private storage decision = %+v", decision)
	}
}

func TestAuthorizeLocalAppStorageRejectsInvalidPathBeforeAuthorityEvaluation(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	_, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx,
		LocalAppOperationStorageJSONRead,
		localappop.Selector{StorageRelativePath: "../secret.json"},
	)
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID {
		t.Fatalf("invalid storage selector reason = %s err=%v", got, err)
	}
}

func TestAuthorizeLocalAppStorageStillRequiresExactLiveProcess(t *testing.T) {
	fixture := newLocalAppAuthorityFixture(t)
	process := fixture.resolver.binding.Process
	process.PID++
	ctx := localAppOperationConnectionContext(t, process, fixture.resolver.binding.RuntimeBootEpoch)
	_, err := fixture.service.AuthorizeLocalAppProtectedOperation(
		ctx,
		LocalAppOperationStorageJSONRead,
		localappop.Selector{StorageRelativePath: "state/value.json"},
	)
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("mismatched storage process reason = %s err=%v", got, err)
	}
}

type localAppOperationTestVerifier struct {
	peer protectedlocal.VerifiedLocalAppLaunchPeer
}

func (verifier localAppOperationTestVerifier) VerifyLocalAppLaunchPeer(context.Context) (protectedlocal.VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type localAppOperationTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *localAppOperationTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *localAppOperationTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func localAppOperationConnectionContext(t testing.TB, process protectedlocal.ProcessTuple, boot protectedlocal.Identifier) context.Context {
	t.Helper()
	liveness := &localAppOperationTestLiveness{revoked: make(chan struct{})}
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), localAppOperationTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID: accountLocalAppIdentifier(0x91), Process: process, RuntimeBootEpoch: boot,
		ProcessLiveness: liveness, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatalf("establish local-app connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return protectedlocal.ContextWithLocalAppConnection(context.Background(), connection)
}
