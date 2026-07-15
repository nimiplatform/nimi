package account

import (
	"context"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestAuthorizeLocalAppProtectedOperationPreservesTerminalGrantReasons(t *testing.T) {
	for _, test := range []struct {
		name   string
		state  localappkernel.GrantState
		reason runtimev1.ReasonCode
	}{
		{name: "zero grant", reason: runtimev1.ReasonCode_LOCAL_APP_GRANT_REQUIRED},
		{name: "revoked", state: localappkernel.GrantStateRevoked, reason: runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED},
		{name: "superseded", state: localappkernel.GrantStateSuperseded, reason: runtimev1.ReasonCode_LOCAL_APP_GRANT_SUPERSEDED},
		{name: "expired", state: localappkernel.GrantStateExpired, reason: runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newLocalAppGrantFixture(t)
			if test.state != "" {
				establishLocalAppOperationGrant(t, fixture, test.state)
			}
			ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
			_, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
			if err == nil {
				t.Fatal("terminal grant state authorized the operation")
			}
			if got := LocalAppOperationAuthorizationReason(err); got != test.reason {
				t.Fatalf("reason = %s, want %s", got, test.reason)
			}
		})
	}
}

func TestAuthorizeLocalAppProtectedOperationAllowsOnlyExactLiveProcessAndGrant(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	establishLocalAppOperationGrant(t, fixture, localappkernel.GrantStateGranted)
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	decision, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
	if err != nil || decision.LocalAppPrincipalID != fixture.resolver.binding.LocalAppPrincipalID || decision.Operation != LocalAppOperationOpenConversation {
		t.Fatalf("exact operation decision = (%+v, %v)", decision, err)
	}

	mismatchedProcess := fixture.resolver.binding.Process
	mismatchedProcess.PID++
	mismatchContext := localAppOperationConnectionContext(t, mismatchedProcess, fixture.resolver.binding.RuntimeBootEpoch)
	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(mismatchContext, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"}); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("process mismatch reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}

	if _, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{}); LocalAppOperationAuthorizationReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("invalid selector reason = %s err=%v", LocalAppOperationAuthorizationReason(err), err)
	}
}

func TestLocalAppGrantPreflightStaleSupervisedProcessIsProcessReplaced(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	establishLocalAppOperationGrant(t, fixture, localappkernel.GrantStateGranted)
	staleProcess := fixture.resolver.binding.Process
	staleProcess.PID++
	ctx := localAppOperationConnectionContext(t, staleProcess, fixture.resolver.binding.RuntimeBootEpoch)
	_, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("stale supervised process reason = %s err=%v", got, err)
	}
}

func TestLocalAppGrantPreflightRevokeDeniesNextOperation(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	const operationID = "runtime_agent.conversation.open"
	const resourceRef = "agent:agent:matrix"
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{
		OperationId: operationID, ResourceRef: resourceRef, Purpose: "Open the selected conversation",
	})
	if err != nil {
		t.Fatal(err)
	}
	granted, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true,
		PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED {
		t.Fatalf("grant = (%+v, %v)", granted, err)
	}
	revoked, err := fixture.service.RevokeLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.RevokeLocalAppGrantRequest{
		GrantId: granted.GetProjection().GetGrantId(),
	})
	if err != nil || revoked.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_REVOKED {
		t.Fatalf("revoke = (%+v, %v)", revoked, err)
	}
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	_, err = fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED {
		t.Fatalf("next operation reason = %s err=%v", got, err)
	}
}

func TestAuthorizeLocalAppProtectedOperationPreservesStaleBindingReasons(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		reason runtimev1.ReasonCode
	}{
		{name: "session revoked", err: ErrLocalAppCallerUnauthorized, reason: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED},
		{name: "account generation changed", err: ErrLocalAppAccountChanged, reason: runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED},
		{name: "process replaced", err: ErrLocalAppProcessMismatch, reason: runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newLocalAppGrantFixture(t)
			establishLocalAppOperationGrant(t, fixture, localappkernel.GrantStateGranted)
			fixture.resolver.err = test.err
			ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
			_, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
			if got := LocalAppOperationAuthorizationReason(err); got != test.reason {
				t.Fatalf("stale binding reason = %s, want %s err=%v", got, test.reason, err)
			}
		})
	}
}

func TestAuthorizeLocalAppProtectedOperationRejectsCapabilityDrift(t *testing.T) {
	fixture := newLocalAppGrantFixture(t)
	establishLocalAppOperationGrant(t, fixture, localappkernel.GrantStateGranted)
	fixture.resolver.binding.Capabilities = []string{"runtime.agent.turn.read"}
	ctx := localAppOperationConnectionContext(t, fixture.resolver.binding.Process, fixture.resolver.binding.RuntimeBootEpoch)
	_, err := fixture.service.AuthorizeLocalAppProtectedOperation(ctx, LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent:matrix"})
	if got := LocalAppOperationAuthorizationReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("capability drift reason = %s err=%v", got, err)
	}
}

func establishLocalAppOperationGrant(t *testing.T, fixture *localAppGrantFixture, target localappkernel.GrantState) {
	t.Helper()
	const operationID = "runtime_agent.conversation.open"
	const resourceRef = "agent:agent:matrix"
	pending, err := fixture.service.RequestLocalAppGrant(context.Background(), &runtimev1.RequestLocalAppGrantRequest{
		OperationId: operationID, ResourceRef: resourceRef, Purpose: "Open the selected conversation",
	})
	if err != nil || pending.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_PENDING {
		t.Fatalf("request grant = (%+v, %v)", pending, err)
	}
	granted, err := fixture.service.DecideLocalAppGrant(protectedDesktopAccountContext(t), &runtimev1.DecideLocalAppGrantRequest{
		RequestId: pending.GetProjection().GetRequestId(), Approved: true,
		PresenceChallengeId: fixture.control.challenge.PresenceChallengeID,
	})
	if err != nil || granted.GetProjection().GetState() != runtimev1.LocalAppGrantState_LOCAL_APP_GRANT_STATE_GRANTED {
		t.Fatalf("grant operation = (%+v, %v)", granted, err)
	}
	if target == localappkernel.GrantStateGranted {
		return
	}
	projection, _, authenticated := fixture.service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !authenticated || projection == nil {
		t.Fatal("account projection unavailable")
	}
	binding, err := localAppGrantOperation(operationID, resourceRef)
	if err != nil {
		t.Fatal(err)
	}
	current, err := fixture.kernel.Grants().GetCurrent(context.Background(), projection.GetAccountId(), fixture.resolver.binding.LocalAppPrincipalID, binding.fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.kernel.Grants().Transition(context.Background(), current.AccountID, current.LocalAppPrincipalID, current.CapabilityResourceFingerprint, current.GrantRevision, target, current.PresenceEvidenceRef); err != nil {
		t.Fatalf("transition grant to %s: %v", target, err)
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
