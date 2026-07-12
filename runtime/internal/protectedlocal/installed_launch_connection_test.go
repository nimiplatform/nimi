package protectedlocal

import (
	"context"
	"sync"
	"testing"
)

func TestInstalledHostCarrierKeepsProductionAndLocalDevelopmentOriginsMutuallyExclusive(t *testing.T) {
	production := newNativeAppHostTestConnection(t, NativeAppHostTrustProductionInstalled, 0x31)
	productionOrigin := production.Origin()
	if productionOrigin.TransportClass != TransportInstalledHost || !productionOrigin.HasRole(RoleVerifiedInstalledProcess) || productionOrigin.HasRole(RoleVerifiedLocalDevelopmentProcess) {
		t.Fatalf("unexpected production app-host origin: %+v", productionOrigin)
	}
	if err := production.BindLocalDevelopmentSession(LocalDevelopmentSessionHandle{SessionID: nativeAppHostTestIdentifier(0x32), SessionProof: nativeAppHostTestIdentifier(0x33)}); err == nil {
		t.Fatal("production app-host connection converted to local-development session")
	}
	if err := production.BindInstalledSession(InstalledSessionHandle{SessionID: nativeAppHostTestIdentifier(0x34), SessionProof: nativeAppHostTestIdentifier(0x35)}); err != nil {
		t.Fatalf("bind production-installed session: %v", err)
	}
	productionOrigin = production.Origin()
	if !productionOrigin.HasRole(RoleInstalledHostSession) || productionOrigin.HasRole(RoleLocalDevelopmentHostSession) {
		t.Fatalf("production session origin widened across trust classes: %+v", productionOrigin)
	}

	development := newNativeAppHostTestConnection(t, NativeAppHostTrustLocalDevelopment, 0x41)
	developmentOrigin := development.Origin()
	if developmentOrigin.TransportClass != TransportInstalledHost || !developmentOrigin.HasRole(RoleVerifiedLocalDevelopmentProcess) || developmentOrigin.HasRole(RoleVerifiedInstalledProcess) {
		t.Fatalf("unexpected local-development app-host origin: %+v", developmentOrigin)
	}
	if err := development.BindInstalledSession(InstalledSessionHandle{SessionID: nativeAppHostTestIdentifier(0x42), SessionProof: nativeAppHostTestIdentifier(0x43)}); err == nil {
		t.Fatal("local-development app-host connection converted to production session")
	}
	if err := development.BindLocalDevelopmentSession(LocalDevelopmentSessionHandle{SessionID: nativeAppHostTestIdentifier(0x44), SessionProof: nativeAppHostTestIdentifier(0x45)}); err != nil {
		t.Fatalf("bind local-development session: %v", err)
	}
	developmentOrigin = development.Origin()
	if !developmentOrigin.HasRole(RoleLocalDevelopmentHostSession) || developmentOrigin.HasRole(RoleInstalledHostSession) {
		t.Fatalf("local-development session origin widened across trust classes: %+v", developmentOrigin)
	}
}

func newNativeAppHostTestConnection(t testing.TB, trustClass NativeAppHostTrustClass, seed byte) *InstalledLaunchConnection {
	t.Helper()
	liveness := &nativeAppHostTestLiveness{revoked: make(chan struct{})}
	peer := VerifiedInstalledLaunchPeer{
		LaunchID:         nativeAppHostTestIdentifier(seed),
		Process:          ProcessTuple{OS: OSWindows, PID: uint32(seed) + 1000, CreationMarker: "native-app-host-test", OSLoginSession: "native-app-host-logon", SecurityPrincipal: "native-app-host-user", CanonicalExecutableIdentity: "native-app-host-file", ExecutableDigest: nativeAppHostTestIdentifier(seed + 1), ExecutableTrustSetID: "native-app-host-test-trust"},
		RuntimeBootEpoch: nativeAppHostTestIdentifier(seed + 2),
		ProcessLiveness:  liveness,
		TrustClass:       trustClass,
	}
	connection, err := EstablishInstalledLaunchConnection(context.Background(), nativeAppHostTestVerifier{peer: peer})
	if err != nil {
		t.Fatalf("establish native app-host connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}

type nativeAppHostTestVerifier struct{ peer VerifiedInstalledLaunchPeer }

func (verifier nativeAppHostTestVerifier) VerifyInstalledLaunchPeer(context.Context) (VerifiedInstalledLaunchPeer, error) {
	return verifier.peer, nil
}

type nativeAppHostTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *nativeAppHostTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *nativeAppHostTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func nativeAppHostTestIdentifier(value byte) Identifier {
	var identifier Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}
