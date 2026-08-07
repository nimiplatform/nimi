package app

import (
	"bytes"
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func TestLocalAppSessionInvalidationAndSameHostRebind(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, nil)
	ctx := fixture.context

	if _, err := fixture.service.OpenLocalAppSessionProjection(ctx); err != nil {
		t.Fatalf("open protected session: %v", err)
	}
	firstHandle, ok := fixture.connection.Session()
	if !ok {
		t.Fatal("protected connection has no private session handle")
	}
	if err := fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead); err != nil {
		t.Fatalf("Base admission with present empty snapshot: %v", err)
	}
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressRealmWorldCoreList), runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)

	fixture.registrationInput.RawDeclaration = []string{"realm.data"}
	updated, err := fixture.kernel.Registrations().RegisterDevelopment(ctx, fixture.registrationInput)
	if err != nil {
		t.Fatal(err)
	}
	if updated.DeclarationGeneration != fixture.registration.DeclarationGeneration+1 {
		t.Fatalf("declaration generation = %d", updated.DeclarationGeneration)
	}
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	if _, err := fixture.service.RenewLocalAppSessionProjection(ctx); err != nil {
		t.Fatalf("same-Host declaration rebind: %v", err)
	}
	secondHandle, ok := fixture.connection.Session()
	if !ok || secondHandle == firstHandle {
		t.Fatal("declaration rebind did not replace the private session")
	}
	if !fixture.connection.Live() || fixture.connection.Process().PID != fixture.process.PID {
		t.Fatal("declaration rebind replaced or terminated the verified Host")
	}
	if err := fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressRealmWorldCoreList); err != nil {
		t.Fatalf("rebound realm.data admission: %v", err)
	}

	fixture.registrationInput.SourceDigest = "source-digest-2"
	if _, err := fixture.kernel.Registrations().RegisterDevelopment(ctx, fixture.registrationInput); err != nil {
		t.Fatal(err)
	}
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	if _, err := fixture.service.RenewLocalAppSessionProjection(ctx); err != nil {
		t.Fatalf("same-Host source-generation rebind: %v", err)
	}
	if !fixture.connection.Live() || fixture.connection.Process().PID != fixture.process.PID {
		t.Fatal("source-generation rebind replaced or terminated the verified Host")
	}

	fixture.account.replace("account-2", "realm-2")
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED)
	if _, err := fixture.service.RenewLocalAppSessionProjection(ctx); err != nil {
		t.Fatalf("same-Host account rebind: %v", err)
	}
	thirdHandle, ok := fixture.connection.Session()
	if !ok || thirdHandle == secondHandle || !fixture.connection.Live() {
		t.Fatal("account rebind did not replace only the private session")
	}
	if err := fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead); err != nil {
		t.Fatalf("Base admission after account rebind: %v", err)
	}

	restarted := New(nil,
		WithRuntimeAccountProjectionProvider(fixture.account),
		WithLocalAppKernel(fixture.kernel),
		WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute),
	)
	assertLocalAppReason(t, restarted.AdmitLocalAppIngress(ctx, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
}

func TestLocalAppSessionSnapshotMissingFailsClosed(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, []string{"realm.data"})
	if _, err := fixture.service.OpenLocalAppSessionProjection(fixture.context); err != nil {
		t.Fatal(err)
	}
	fixture.service.localAppSessionMu.Lock()
	session := fixture.service.localAppSessions[fixture.connection]
	session.snapshot = nil
	fixture.service.localAppSessions[fixture.connection] = session
	fixture.service.localAppSessionMu.Unlock()
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(fixture.context, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_SNAPSHOT_UNAVAILABLE)
}

func assertLocalAppReason(t testing.TB, err error, want runtimev1.ReasonCode) {
	t.Helper()
	if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != want {
		t.Fatalf("reason = %v (%v), want %v", got, err, want)
	}
}

type localAppSessionFixture struct {
	service           *Service
	kernel            *localappkernel.Kernel
	account           *localAppSessionTestAccount
	connection        *protectedlocal.LocalAppConnection
	context           context.Context
	process           protectedlocal.ProcessTuple
	registration      localappkernel.Registration
	registrationInput localappkernel.RegisterDevelopmentInput
}

func newLocalAppSessionFixture(t testing.TB, domains []string) localAppSessionFixture {
	t.Helper()
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	kernelEntropy := bytes.Repeat([]byte{0x31}, 256)
	kernel, err := localappkernel.OpenSQLite(ctx, filepath.Join(t.TempDir(), "registered-apps.db"), identity, localappkernel.Options{Random: bytes.NewReader(kernelEntropy)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	input := localappkernel.RegisterDevelopmentInput{
		AppID: "nimi.test.session", DisplayName: "Session Test", SourceRef: "source-1",
		ProjectRoot: "/tmp/nimi-session-test", ManifestPath: "/tmp/nimi-session-test/nimi.app.yaml",
		ShellKind: 1, RawDeclaration: append([]string(nil), domains...), SourceDigest: "source-digest-1",
		HostExecutableDigest: "host-digest-1", PayloadRootDigest: "payload-digest-1",
	}
	registration, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	registrationHandle, ok := localDevelopmentRegistrationIdentifier(registration.RegistrationHandle)
	if !ok {
		t.Fatal("registration handle is not a protected identifier")
	}
	launchID := localAppSessionTestIdentifier(0x41)
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSMacOS, PID: 2401, CreationMarker: "session-test-start",
		OSLoginSession: "session-test-login", SecurityPrincipal: "session-test-user",
		CanonicalExecutableIdentity: "session-test-host", ExecutableDigest: localAppSessionTestIdentifier(0x42),
		ExecutableTrustSetID: "session-test-trust",
	}
	liveness := &localAppSessionTestLiveness{revoked: make(chan struct{})}
	connection, err := protectedlocal.EstablishLocalAppConnection(ctx, localAppSessionTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID: launchID, Process: process, RuntimeBootEpoch: localAppSessionTestIdentifier(0x43),
		ProcessLiveness: liveness, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	store := &localDevelopmentStore{now: func() time.Time { return now }, launches: map[protectedlocal.Identifier]localDevelopmentLaunchTicket{
		launchID: {
			LaunchID: launchID, RegistrationHandle: registrationHandle, Process: process,
			ExpiresAt: now.Add(time.Minute), BindDeadline: now.Add(time.Minute),
		},
	}}
	account := newLocalAppSessionTestAccount("account-1", "realm-1")
	service := New(nil,
		WithClock(func() time.Time { return now }),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalDevelopmentAuthority(store, nil, nil, nil),
		WithLocalAppKernel(kernel),
		WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute),
	)
	return localAppSessionFixture{
		service: service, kernel: kernel, account: account, connection: connection,
		context: protectedlocal.ContextWithLocalAppConnection(ctx, connection), process: process,
		registration: registration, registrationInput: input,
	}
}

type localAppSessionTestAccount struct {
	mu          sync.Mutex
	projection  *runtimev1.AccountProjection
	generation  uint64
	invalidated chan struct{}
}

func newLocalAppSessionTestAccount(accountID, realmID string) *localAppSessionTestAccount {
	return &localAppSessionTestAccount{
		projection: &runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: realmID},
		generation: 1, invalidated: make(chan struct{}),
	}
}

func (account *localAppSessionTestAccount) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	projection, _, ok := account.AuthenticatedRuntimeSecurityContext(context.Background())
	return projection, ok
}

func (account *localAppSessionTestAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	projection, generation, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background())
	return projection, generation, ok
}

func (account *localAppSessionTestAccount) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	account.mu.Lock()
	defer account.mu.Unlock()
	copy := *account.projection
	return &copy, account.generation, account.invalidated, true
}

func (account *localAppSessionTestAccount) replace(accountID, realmID string) {
	account.mu.Lock()
	close(account.invalidated)
	account.generation++
	account.invalidated = make(chan struct{})
	account.projection = &runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: realmID}
	account.mu.Unlock()
}

type localAppSessionTestVerifier struct {
	peer protectedlocal.VerifiedLocalAppLaunchPeer
}

func (verifier localAppSessionTestVerifier) VerifyLocalAppLaunchPeer(context.Context) (protectedlocal.VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type localAppSessionTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *localAppSessionTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *localAppSessionTestLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func localAppSessionTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func sessionTestEntropy() []byte {
	result := make([]byte, 512)
	for index := range result {
		result[index] = byte(index%251 + 1)
	}
	return result
}
