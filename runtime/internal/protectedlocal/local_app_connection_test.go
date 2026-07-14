package protectedlocal

import (
	"context"
	"sync"
	"testing"
)

func TestLocalAppCarrierPromotesBootstrapToSession(t *testing.T) {
	connection := newLocalAppTestConnection(t, 0x41)
	origin := connection.Origin()
	if origin.TransportClass != TransportLocalAppBootstrap || !origin.HasRole(RoleLocalAppProcess) || origin.HasRole(RoleLocalAppSession) {
		t.Fatalf("unexpected local-app bootstrap origin: %+v", origin)
	}
	handle := LocalAppSessionHandle{SessionID: localAppTestIdentifier(0x44), SessionProof: localAppTestIdentifier(0x45)}
	if err := connection.BindSession(handle); err != nil {
		t.Fatalf("bind local-app session: %v", err)
	}
	origin = connection.Origin()
	if origin.TransportClass != TransportLocalAppHost || !origin.HasRole(RoleLocalAppSession) || origin.HasRole(RoleLocalAppProcess) {
		t.Fatalf("connection did not atomically promote to local-app host: %+v", origin)
	}
	if err := connection.BindSession(handle); err == nil {
		t.Fatal("local-app connection accepted a second session")
	}
}

func newLocalAppTestConnection(t testing.TB, seed byte) *LocalAppConnection {
	t.Helper()
	liveness := &localAppTestLiveness{revoked: make(chan struct{})}
	peer := VerifiedLocalAppLaunchPeer{
		LaunchID:         localAppTestIdentifier(seed),
		Process:          ProcessTuple{OS: OSWindows, PID: uint32(seed) + 1000, CreationMarker: "local-app-test", OSLoginSession: "local-app-logon", SecurityPrincipal: "local-app-user", CanonicalExecutableIdentity: "local-app-file", ExecutableDigest: localAppTestIdentifier(seed + 1), ExecutableTrustSetID: "local-app-test-trust"},
		RuntimeBootEpoch: localAppTestIdentifier(seed + 2),
		ProcessLiveness:  liveness,
		TrustClass:       LocalAppTrustLocalDevelopment,
	}
	connection, err := EstablishLocalAppConnection(context.Background(), localAppTestVerifier{peer: peer})
	if err != nil {
		t.Fatalf("establish local-app connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}

type localAppTestVerifier struct{ peer VerifiedLocalAppLaunchPeer }

func (verifier localAppTestVerifier) VerifyLocalAppLaunchPeer(context.Context) (VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type localAppTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *localAppTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *localAppTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func localAppTestIdentifier(value byte) Identifier {
	var identifier Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}
