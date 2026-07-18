package account

import (
	"context"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
		{LocalAppOperationVoiceTranscribe, localappop.Selector{AgentID: "agent-a"}},
		{LocalAppOperationVoiceStreamSubscribe, localappop.Selector{AgentID: "agent-a", ConversationAnchorID: "anchor-a", TurnID: "turn-a", VoiceStreamID: "voice-a"}},
	}
	for _, test := range tests {
		if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, test.operation, test.selector); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
			t.Fatalf("operation %q reason = %s err=%v", test.operation, LocalAppOperationAuthorizationReason(err), err)
		}
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
