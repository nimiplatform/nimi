package app

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestFormalDesktopAppUsesRegisteredReleaseSessionAndEffectiveAccess(t *testing.T) {
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		Random: bytes.NewReader(bytes.Repeat([]byte{0x71}, 1024)), HostInstallID: "formal-session-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	boot := localAppSessionTestIdentifier(0x81)
	client := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 4101, CreationMarker: "desktop-built-in-start",
		OSLoginSession: "interactive-login", SecurityPrincipal: "interactive-user",
		CanonicalExecutableIdentity: "desktop-built-in-executable",
		ExecutableDigest:            localAppSessionTestIdentifier(0x82), ExecutableTrustSetID: "desktop-release",
	}
	server := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 4102, CreationMarker: "runtime-built-in-start",
		OSLoginSession: "service-login", SecurityPrincipal: "runtime-service",
		CanonicalExecutableIdentity: "runtime-service-executable",
		ExecutableDigest:            localAppSessionTestIdentifier(0x83), ExecutableTrustSetID: "runtime-release",
	}
	liveness := &localAppSessionTestLiveness{revoked: make(chan struct{})}
	desktop, err := protectedlocal.EstablishDesktopConnection(ctx, builtInDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: client, Server: server, ClientLiveness: liveness, RuntimeBootEpoch: boot,
		EndpointInstanceID: localAppSessionTestIdentifier(0x84), TranscriptNonce: localAppSessionTestIdentifier(0x85),
	}}, bytes.NewReader(bytes.Repeat([]byte{0x86}, 64)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(desktop.Revoke)
	account := newLocalAppSessionTestAccount("account-built-in", "realm-built-in")
	release := FormalAppRelease{
		AppID: "nimi.desktop", DisplayName: "Nimi Desktop", SourceRef: "platform-app-release:nimi.desktop",
		InstallRoot: t.TempDir(), ManifestRef: "formal-release:nimi.desktop", ShellKind: 1,
		Declaration:  []string{"realm.data", "runtime.consume", "agent.local", "agent.configure"},
		SourceDigest: "release-source:desktop", PayloadRootDigest: "release-payload:desktop",
	}
	service := New(nil,
		WithRuntimeAccountProjectionProvider(account),
		WithLocalAppKernel(kernel),
		WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute),
		WithFormalAppReleaseResolver(formalAppReleaseResolverFunc(func(_ context.Context, appID string) (FormalAppRelease, error) {
			if appID != release.AppID {
				return FormalAppRelease{}, errFormalAppReleaseUnavailable
			}
			return release, nil
		})),
	)
	desktopCtx := protectedlocal.ContextWithDesktopConnection(ctx, desktop)
	formalSessionCtx, releaseFormalSession, err := service.BindFormalAppSession(desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot)
	if err != nil {
		t.Fatalf("bind formal Desktop session: %v", err)
	}
	if _, err := service.OpenLocalAppSessionProjection(formalSessionCtx); err != nil {
		releaseFormalSession()
		t.Fatalf("open formal Desktop session: %v", err)
	}
	if _, err := service.OpenLocalAppSessionProjection(formalSessionCtx); err != nil {
		releaseFormalSession()
		t.Fatalf("repeat formal Desktop session open: %v", err)
	}
	releaseFormalSession()
	authorized, err := service.AuthorizeFormalAppIngress(
		desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot, localappop.IngressAgentManagerSnapshotGet,
	)
	if err != nil {
		t.Fatal(err)
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
	if !ok || decision.AppID != "nimi.desktop" || decision.Operation != accountservice.LocalAppOperationManagerSnapshot ||
		decision.OperationCapability != "agent.configure" || decision.TrustClass != accountservice.LocalAppTrustClassBuiltIn ||
		decision.SessionID == (protectedlocal.Identifier{}) || !strings.HasPrefix(decision.RegisteredAppSubject, "ras_v1_") ||
		strings.HasPrefix(decision.RegisteredAppSubject, "protected-product:") {
		t.Fatalf("built-in Desktop decision = %+v ok=%v", decision, ok)
	}
	secondAuthorized, err := service.AuthorizeFormalAppIngress(
		desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot, localappop.IngressAgentAIConfigGet,
	)
	if err != nil {
		t.Fatal(err)
	}
	secondDecision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(secondAuthorized)
	if !ok || secondDecision.Operation == decision.Operation || secondDecision.OperationCapability != "agent.configure" ||
		secondDecision.RegisteredAppSubject != decision.RegisteredAppSubject || secondDecision.SessionID != decision.SessionID {
		t.Fatalf("second built-in Desktop decision = %+v ok=%v, first = %+v", secondDecision, ok, decision)
	}
	embodimentAuthorized, err := service.AuthorizeFormalAppIngress(
		desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot, localappop.IngressAgentEmbodimentSnapshotGet,
	)
	if err != nil {
		t.Fatal(err)
	}
	embodimentDecision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(embodimentAuthorized)
	if !ok || embodimentDecision.Operation != accountservice.LocalAppOperationEmbodimentSnapshot ||
		embodimentDecision.OperationCapability != "agent.local" ||
		embodimentDecision.SessionID != decision.SessionID {
		t.Fatalf("formal embodiment decision = %+v ok=%v", embodimentDecision, ok)
	}

	service.formalAppMu.Lock()
	binding := service.formalApps[formalAppConnectionKey{desktop: desktop, appID: "nimi.desktop", bindingSlot: protectedlocal.DesktopAccountProductProfileID}]
	service.formalAppMu.Unlock()
	if binding == nil || binding.connection == nil {
		t.Fatal("built-in Desktop connection was not retained")
	}
	localCtx := protectedlocal.ContextWithLocalAppConnection(desktopCtx, binding.connection)
	if _, err := service.RenewLocalAppSessionProjection(localCtx); err != nil {
		t.Fatalf("renew built-in Desktop technical session: %v", err)
	}
	renewedAuthorized, err := service.AuthorizeFormalAppIngress(
		desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot, localappop.IngressAgentAutonomySnapshotGet,
	)
	if err != nil {
		t.Fatal(err)
	}
	renewedDecision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(renewedAuthorized)
	if !ok || renewedDecision.RegisteredAppSubject != decision.RegisteredAppSubject ||
		renewedDecision.SessionID == (protectedlocal.Identifier{}) || renewedDecision.SessionID == decision.SessionID {
		t.Fatalf("renewed built-in Desktop decision = %+v ok=%v, first = %+v", renewedDecision, ok, decision)
	}
	registration, err := kernel.Registrations().GetActiveByBindingSlot(ctx, protectedlocal.DesktopAccountProductProfileID)
	if err != nil {
		t.Fatal(err)
	}
	if registration.SourceClass != localappkernel.SourceClassInstalled || registration.RegisteredAppSubject != decision.RegisteredAppSubject ||
		!containsAll(registration.ActivatedDomains, "realm.data", "runtime.consume", "agent.local", "agent.configure") {
		t.Fatalf("built-in Desktop registration = %+v", registration)
	}
	registrationHandle, ok := binding.connection.InstalledRegistrationHandle()
	if !ok || registrationHandle != registration.RegistrationHandle {
		t.Fatalf("installed connection registration handle = %q ok=%v, want %q", registrationHandle, ok, registration.RegistrationHandle)
	}

	protectedApp := newLocalAppSessionFixture(t, []string{"agent.configure"})
	if _, err := protectedApp.service.OpenLocalAppSessionProjection(protectedApp.context); err != nil {
		t.Fatal(err)
	}
	protectedAuthorized, err := protectedApp.service.AuthorizeLocalAppIngress(protectedApp.context, localappop.IngressAgentManagerSnapshotGet)
	if err != nil {
		t.Fatal(err)
	}
	protectedDecision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(protectedAuthorized)
	if !ok || protectedDecision.Operation != decision.Operation ||
		protectedDecision.AuthorityClass != decision.AuthorityClass ||
		protectedDecision.OperationCapability != decision.OperationCapability ||
		!strings.HasPrefix(protectedDecision.RegisteredAppSubject, "ras_v1_") {
		t.Fatalf("protected App parity decision = %+v ok=%v", protectedDecision, ok)
	}

	release.SourceDigest = "release-source:desktop:2"
	release.PayloadRootDigest = "release-payload:desktop:2"
	replacementProcess := client
	replacementProcess.PID++
	replacementProcess.CreationMarker = "desktop-built-in-replacement"
	replacementProcess.ExecutableDigest = localAppSessionTestIdentifier(0x98)
	replacement, err := service.registerFormalAppRelease(ctx, release.AppID, protectedlocal.DesktopAccountProductProfileID, replacementProcess)
	if err != nil {
		t.Fatalf("register replacement formal Desktop release: %v", err)
	}
	if replacement.HostExecutableDigest != protectedExecutableDigestRef(replacementProcess.ExecutableDigest) {
		t.Fatalf("replacement executable witness = %q", replacement.HostExecutableDigest)
	}
	if _, err := service.AuthorizeFormalAppIngress(
		desktopCtx, "nimi.desktop", protectedlocal.DesktopAccountProductProfileID, boot, localappop.IngressAgentManagerSnapshotGet,
	); err == nil {
		t.Fatal("old live formal Desktop rewrote the replacement executable witness")
	}
	current, err := kernel.Registrations().GetActiveByBindingSlot(ctx, protectedlocal.DesktopAccountProductProfileID)
	if err != nil {
		t.Fatal(err)
	}
	if current.HostExecutableDigest != replacement.HostExecutableDigest || current.SourceGeneration != replacement.SourceGeneration {
		t.Fatalf("old formal Desktop changed replacement registration: current=%+v replacement=%+v", current, replacement)
	}
}

type builtInDesktopVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier builtInDesktopVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

func containsAll(values []string, expected ...string) bool {
	found := make(map[string]bool, len(values))
	for _, value := range values {
		found[value] = true
	}
	for _, value := range expected {
		if !found[value] {
			return false
		}
	}
	return true
}
