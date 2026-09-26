package app

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func runAccessDesktop(t *testing.T, seed byte) (context.Context, *protectedlocal.Connection) {
	t.Helper()
	client := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 4101 + uint32(seed), CreationMarker: "desktop-start", OSLoginSession: "interactive-login", SecurityPrincipal: "interactive-user", CanonicalExecutableIdentity: "desktop", ExecutableDigest: localAppSessionTestIdentifier(0x82), ExecutableTrustSetID: "desktop-release"}
	server := protectedlocal.ProcessTuple{OS: protectedlocal.OSWindows, PID: 4102, CreationMarker: "runtime-start", OSLoginSession: "service-login", SecurityPrincipal: "runtime-service", CanonicalExecutableIdentity: "runtime", ExecutableDigest: localAppSessionTestIdentifier(0x83), ExecutableTrustSetID: "runtime-release"}
	owner, err := protectedlocal.EstablishDesktopConnection(context.Background(), builtInDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{Client: client, Server: server, ClientLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})}, RuntimeBootEpoch: localAppSessionTestIdentifier(0x81), EndpointInstanceID: localAppSessionTestIdentifier(0x84), TranscriptNonce: localAppSessionTestIdentifier(0x85)}}, bytes.NewReader(bytes.Repeat([]byte{seed}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Revoke)
	return protectedlocal.ContextWithDesktopConnection(context.Background(), owner), owner
}

func runAccessFixture(t *testing.T, options ...Option) (localAppSessionFixture, context.Context, *runtimev1.GetLocalDevelopmentRunAccessRequest) {
	t.Helper()
	f := newLocalAppSessionFixture(t, nil, options...)
	ctx, owner := runAccessDesktop(t, 0x61)
	run := localAppSessionTestIdentifier(0x62)
	if err := owner.BindRevocationHook(run, func() {}); err != nil {
		t.Fatal(err)
	}
	f.store.mu.Lock()
	ticket := f.store.launches[f.connection.LaunchID()]
	ticket.DesktopOwner = owner
	ticket.SupervisorRunID = run
	f.store.launches[ticket.LaunchID] = ticket
	f.store.mu.Unlock()
	return f, ctx, &runtimev1.GetLocalDevelopmentRunAccessRequest{RegistrationHandle: append([]byte(nil), f.registrationHandle[:]...), SupervisorRunId: append([]byte(nil), run[:]...)}
}

func TestLocalDevelopmentRunAccessPendingRenewalAndIdleScopeReplacement(t *testing.T) {
	f, ctx, req := runAccessFixture(t)
	pending, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || pending.Available || pending.ExecutionScopeRef != "" {
		t.Fatalf("first pending fabricated a scope baseline: %v %v", pending, err)
	}
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	first, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !first.Available || !strings.HasPrefix(first.ExecutionScopeRef, "execution_scope_") {
		t.Fatalf("live run access missing: %v %v", first, err)
	}
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	renewed, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !renewed.Available || renewed.ExecutionScopeRef != first.ExecutionScopeRef {
		t.Fatalf("ordinary renewal changed execution scope: %v %v", renewed, err)
	}
	// No call or stream is active, and the observer sees no unavailable sample
	// between A and B. A real account fence replacement must still be visible.
	f.account.replace("account-2", "realm-1")
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err == nil {
		t.Fatal("renewal silently replaced a revoked scope")
	}
	f = reopenRunAccessVerifiedConnection(t, f, localAppSessionTestIdentifier(0x7e))
	replaced, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !replaced.Available || replaced.ExecutionScopeRef == first.ExecutionScopeRef || replaced.ExecutionScopeRef == "" {
		t.Fatalf("idle A-to-B scope replacement was hidden: %v %v", replaced, err)
	}
	f.connection.Revoke()
	unavailable, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || unavailable.Available || unavailable.ExecutionScopeRef != "" {
		t.Fatalf("revoked run retained current scope projection: %v %v", unavailable, err)
	}
}

func TestLocalDevelopmentRunAccessRejectsForeignDesktopAndRunAssertion(t *testing.T) {
	f, ctx, req := runAccessFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	foreignCtx, foreign := runAccessDesktop(t, 0x71)
	if _, err := f.service.GetLocalDevelopmentRunAccess(foreignCtx, req); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign Desktop queried run: %v", err)
	}
	if _, err := f.service.GetLocalDevelopmentRunAccess(context.Background(), req); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("ordinary origin queried run: %v", err)
	}
	run, _ := localDevelopmentIdentifierFromBytes(req.SupervisorRunId)
	if err := foreign.BindRevocationHook(run, func() {}); err != nil {
		t.Fatal(err)
	}
	result, err := f.service.GetLocalDevelopmentRunAccess(foreignCtx, req)
	if status.Code(err) != codes.PermissionDenied || result != nil {
		t.Fatalf("non-authorizing run id impersonated the true session owner: %v %v", result, err)
	}
	current, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !current.Available {
		t.Fatalf("foreign observation affected real owner: %v %v", current, err)
	}
}

func TestRunAccessSelectsValidSessionAndFailsClosedOnAmbiguity(t *testing.T) {
	f, ctx, req := runAccessFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	first, _ := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	f.store.mu.Lock()
	ticket := f.store.launches[f.connection.LaunchID()]
	f.store.mu.Unlock()
	secondLaunch := localAppSessionTestIdentifier(0x76)
	ticket.LaunchID = secondLaunch
	f.store.mu.Lock()
	f.store.launches[secondLaunch] = ticket
	f.store.mu.Unlock()
	second, err := protectedlocal.EstablishLocalAppConnection(context.Background(), localAppSessionTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{LaunchID: secondLaunch, Process: f.process, RuntimeBootEpoch: localAppSessionTestIdentifier(0x43), ProcessLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})}, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(second.Revoke)
	if _, err := f.service.OpenLocalAppSessionProjection(protectedlocal.ContextWithLocalAppConnection(context.Background(), second)); err != nil {
		t.Fatal(err)
	}
	ambiguous, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || ambiguous.Available || ambiguous.ExecutionScopeRef != "" || ambiguous.ReasonCode != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("multiple current scopes chose map order: %v %v", ambiguous, err)
	}
	oldHandle, _ := f.connection.Session()
	f.connection.InvalidateSession(oldHandle)
	current, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !current.Available || current.ExecutionScopeRef == first.ExecutionScopeRef {
		t.Fatalf("stale retained connection shadowed valid scope: %v %v", current, err)
	}
}

func TestInstalledRunAccessUsesSameSessionFenceAndExactOwner(t *testing.T) {
	// Exercise the projection seam with the existing admitted-session fixture;
	// package verification and OS process launch have their separate owner tests.
	f, ctx, _ := runAccessFixture(t)
	owner, _ := protectedlocal.DesktopConnectionFromContext(ctx)
	launchID := f.connection.LaunchID()
	lease := &installedAppLaunch{id: launchID, owner: owner, policy: protectedlocal.InstalledAppProcessPolicy{RegistrationHandle: f.registration.RegistrationHandle}}
	f.service.installedLaunches = map[protectedlocal.Identifier]*installedAppLaunch{launchID: lease}
	req := &runtimev1.GetInstalledAppRunAccessRequest{LaunchId: append([]byte(nil), launchID[:]...)}
	pending, err := f.service.GetInstalledAppRunAccess(ctx, req)
	if err != nil || pending.Available || pending.ExecutionScopeRef != "" {
		t.Fatalf("pending installed run acquired a scope: %v %v", pending, err)
	}
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	lease.bound = true
	first, err := f.service.GetInstalledAppRunAccess(ctx, req)
	if err != nil || !first.Available || first.ExecutionScopeRef == "" {
		t.Fatalf("installed run scope missing: %v %v", first, err)
	}
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	renewed, err := f.service.GetInstalledAppRunAccess(ctx, req)
	if err != nil || renewed.ExecutionScopeRef != first.ExecutionScopeRef {
		t.Fatalf("installed renewal changed scope: %v %v", renewed, err)
	}
	f.account.replace("account-2", "realm-1")
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err == nil {
		t.Fatal("renewal silently replaced a revoked installed scope")
	}
	f = reopenRunAccessVerifiedConnection(t, f, launchID)
	next, err := f.service.GetInstalledAppRunAccess(ctx, req)
	if err != nil || !next.Available || next.ExecutionScopeRef == first.ExecutionScopeRef {
		t.Fatalf("installed scope replacement was hidden: %v %v", next, err)
	}
	foreign, _ := runAccessDesktop(t, 0x72)
	if _, err := f.service.GetInstalledAppRunAccess(foreign, req); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("foreign Desktop observed installed scope: %v", err)
	}
}

func TestLocalDevelopmentRunAccessOwnerReadFailureDoesNotClaimScopeRevocation(t *testing.T) {
	f, ctx, req := runAccessFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	before, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !before.Available {
		t.Fatalf("missing admitted baseline: %v %v", before, err)
	}
	if err := f.kernel.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || result.Available || result.ExecutionScopeRef != "" || result.ReasonCode != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("unread owner state was misreported as scope loss: %v %v", result, err)
	}
}

// This fixture supplies the independently verified new connection at the App
// owner seam. Native one-time-witness re-provisioning is a separate Host test.
func reopenRunAccessVerifiedConnection(t *testing.T, f localAppSessionFixture, launchID protectedlocal.Identifier) localAppSessionFixture {
	t.Helper()
	f.store.mu.Lock()
	ticket := f.store.launches[f.connection.LaunchID()]
	ticket.LaunchID = launchID
	ticket.ExpiresAt = f.store.now().Add(time.Minute)
	ticket.BindDeadline = ticket.ExpiresAt
	f.store.launches[launchID] = ticket
	f.store.mu.Unlock()
	f.connection.Revoke()
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), localAppSessionTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID: launchID, Process: f.process, RuntimeBootEpoch: localAppSessionTestIdentifier(0x43), ProcessLiveness: &localAppSessionTestLiveness{revoked: make(chan struct{})}, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	f.connection = connection
	f.context = protectedlocal.ContextWithLocalAppConnection(context.Background(), connection)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatalf("fresh verified connection could not open: %v", err)
	}
	return f
}
