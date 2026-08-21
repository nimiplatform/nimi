package app

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
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
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressRealmWorldCoreList), runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	assertLocalAppReason(t, fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressRealmPersonaCharacterReplace), runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

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
	if err := fixture.service.AdmitLocalAppIngress(ctx, localappop.IngressRealmPersonaCharacterReplace); err != nil {
		t.Fatalf("rebound realm.data PersonaCharacter admission: %v", err)
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

func TestLocalAppSessionSameHostRebindAcrossConsecutiveRuntimeLosses(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, nil)
	if _, err := fixture.service.OpenLocalAppSessionProjection(fixture.context); err != nil {
		t.Fatalf("open protected session: %v", err)
	}
	for loss := 1; loss <= 2; loss++ {
		// Runtime loss: the replacement Runtime shares only the durable
		// registration kernel and the account; every in-memory session is gone.
		restarted := New(nil,
			WithRuntimeAccountProjectionProvider(fixture.account),
			WithLocalDevelopmentAuthority(fixture.store, nil, nil, nil),
			WithLocalAppKernel(fixture.kernel),
			WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute),
		)
		// Same-Host rebind: the supervisor prepared a fresh one-shot launch for
		// the still-running verified Host process.
		launchID := localAppSessionTestIdentifier(0x50 + byte(loss))
		fixture.store.launches[launchID] = localDevelopmentLaunchTicket{
			LaunchID: launchID, RegistrationHandle: fixture.registrationHandle,
			Process: fixture.process, ExpiresAt: fixture.now.Add(time.Minute),
			BindDeadline: fixture.now.Add(time.Minute),
		}
		liveness := &localAppSessionTestLiveness{revoked: make(chan struct{})}
		connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), localAppSessionTestVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
			LaunchID: launchID, Process: fixture.process, RuntimeBootEpoch: localAppSessionTestIdentifier(0x60 + byte(loss)),
			ProcessLiveness: liveness, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
		}})
		if err != nil {
			t.Fatal(err)
		}
		connectionCtx := protectedlocal.ContextWithLocalAppConnection(context.Background(), connection)
		if _, err := restarted.OpenLocalAppSessionProjection(connectionCtx); err != nil {
			t.Fatalf("same-Host rebind after Runtime loss %d: %v", loss, err)
		}
		if err := restarted.AdmitLocalAppIngress(connectionCtx, localappop.IngressStorageJSONRead); err != nil {
			t.Fatalf("admission after Runtime loss %d: %v", loss, err)
		}
		if !connection.Live() || connection.Process().PID != fixture.process.PID {
			t.Fatalf("Runtime loss %d replaced the verified Host", loss)
		}
		connection.Revoke()
	}
}

func TestLocalAppSessionSignedOutFailsTypedWithoutBindingAccessSession(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, nil)
	fixture.account.signOut()

	_, err := fixture.service.OpenLocalAppSessionProjection(fixture.context)
	assertLocalAppReason(t, err, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	if _, bound := fixture.connection.Session(); bound {
		t.Fatal("signed-out Runtime must not bind a private App Access session")
	}
	if !fixture.connection.Live() {
		t.Fatal("signed-out account must not revoke the verified Host connection")
	}
}

func TestLocalAppSessionCurrentUserProjectionAndFailureIsolation(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, nil)
	projection, err := fixture.service.OpenLocalAppSessionProjection(fixture.context)
	if err != nil {
		t.Fatal(err)
	}
	if projection.CurrentUser == nil || projection.CurrentUser.GetHandle() != "tester" ||
		projection.CurrentUser.GetDisplayName() != "Tester" || projection.CurrentUser.GetAvatarUrl() != "https://cdn.example/avatar.png" ||
		projection.CurrentUserReasonCode != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("Current User projection = %+v", projection)
	}

	failure := newLocalAppSessionFixture(t, nil)
	failure.account.currentUserErr = errors.New("owner unavailable")
	projection, err = failure.service.OpenLocalAppSessionProjection(failure.context)
	if err != nil {
		t.Fatalf("display failure must not fail App session: %v", err)
	}
	if projection.CurrentUser != nil || projection.CurrentUserReasonCode != runtimev1.ReasonCode_CURRENT_USER_DISPLAY_UNAVAILABLE {
		t.Fatalf("isolated Current User failure = %+v", projection)
	}
	if err := failure.service.AdmitLocalAppIngress(failure.context, localappop.IngressStorageJSONRead); err != nil {
		t.Fatalf("Base access after Current User failure: %v", err)
	}
}

func TestLocalAppSessionOwnerHandoffContainsOnlyRuntimeDerivedAdmission(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, []string{"realm.data", "agent.local", "agent.configure"})
	if _, err := fixture.service.OpenLocalAppSessionProjection(fixture.context); err != nil {
		t.Fatal(err)
	}
	for ingress, want := range map[localappop.Ingress]struct {
		operation  accountservice.LocalAppOperation
		class      localappop.AuthorityClass
		capability string
	}{
		localappop.IngressStorageJSONWrite: {
			operation: accountservice.LocalAppOperationStorageJSONWrite,
			class:     localappop.AuthorityClassBase, capability: "app.private_storage",
		},
		localappop.IngressAppAIConfigGet: {
			operation: accountservice.LocalAppOperationAppAIConfigRead,
			class:     localappop.AuthorityClassBase, capability: "",
		},
		localappop.IngressRealmWorldCoreList: {
			operation: accountservice.LocalAppOperationRealmWorldCoreList,
			class:     localappop.AuthorityClassAppAccess, capability: "realm.world-core.list",
		},
		localappop.IngressRealmPersonaCharacterReplace: {
			operation: accountservice.LocalAppOperationPersonaReplace,
			class:     localappop.AuthorityClassAppAccess, capability: localappop.AppOperationIDPersonaReplace,
		},
		localappop.IngressConversationOpen: {
			operation: accountservice.LocalAppOperationOpenConversation,
			class:     localappop.AuthorityClassAppAccess, capability: "agent.local",
		},
		localappop.IngressAgentAIConfigGet: {
			operation: accountservice.LocalAppOperationSharedAIConfigGet,
			class:     localappop.AuthorityClassAppAccess, capability: "agent.configure",
		},
	} {
		authorized, err := fixture.service.AuthorizeLocalAppIngress(fixture.context, ingress)
		if err != nil {
			t.Fatalf("authorize %v: %v", ingress, err)
		}
		decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
		if !ok || decision.Operation != want.operation || decision.AuthorityClass != want.class ||
			decision.OperationCapability != want.capability || decision.RegisteredAppSubject != fixture.registration.RegisteredAppSubject ||
			decision.AccountID != "account-1" || decision.RegistrationHandle == (protectedlocal.Identifier{}) {
			t.Fatalf("owner handoff for %v = %+v", ingress, decision)
		}
	}
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

func TestLocalAppSessionAgentConfigureRequiresIndependentDeclarationDomain(t *testing.T) {
	localOnly := newLocalAppSessionFixture(t, []string{"agent.local"})
	if _, err := localOnly.service.OpenLocalAppSessionProjection(localOnly.context); err != nil {
		t.Fatal(err)
	}
	if err := localOnly.service.AdmitLocalAppIngress(localOnly.context, localappop.IngressConversationOpen); err != nil {
		t.Fatalf("agent.local conversation admission: %v", err)
	}
	for _, ingress := range []localappop.Ingress{
		localappop.IngressAgentAIConfigGet,
		localappop.IngressAgentAIConfigOverwrite,
		localappop.IngressAgentAutonomySnapshotGet,
		localappop.IngressAgentAutonomyUpdate,
		localappop.IngressAgentPresentationSnapshotGet,
		localappop.IngressAgentPresentationCommit,
	} {
		assertLocalAppReason(
			t,
			localOnly.service.AdmitLocalAppIngress(localOnly.context, ingress),
			runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
		)
	}

	configureOnly := newLocalAppSessionFixture(t, []string{"agent.configure"})
	if _, err := configureOnly.service.OpenLocalAppSessionProjection(configureOnly.context); err != nil {
		t.Fatal(err)
	}
	if err := configureOnly.service.AdmitLocalAppIngress(configureOnly.context, localappop.IngressAgentAIConfigGet); err != nil {
		t.Fatalf("agent.configure admission: %v", err)
	}
	assertLocalAppReason(
		t,
		configureOnly.service.AdmitLocalAppIngress(configureOnly.context, localappop.IngressConversationOpen),
		runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
	)
}

func TestLocalAppSessionScenarioConsumptionFamilyAuthorization(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, []string{"runtime.consume"})
	if _, err := fixture.service.OpenLocalAppSessionProjection(fixture.context); err != nil {
		t.Fatal(err)
	}
	for ingress, want := range map[localappop.Ingress]struct {
		operation  accountservice.LocalAppOperation
		capability string
	}{
		localappop.IngressTextTurnStream:         {operation: accountservice.LocalAppOperationTextTurnStream, capability: localappop.AppOperationIDTextTurnStream},
		localappop.IngressScenarioExecute:        {operation: accountservice.LocalAppOperationScenarioExecute, capability: localappop.AppOperationIDScenarioExecute},
		localappop.IngressScenarioJobSubmit:      {operation: accountservice.LocalAppOperationScenarioJobSubmit, capability: localappop.AppOperationIDScenarioJobSubmit},
		localappop.IngressScenarioJobGet:         {operation: accountservice.LocalAppOperationScenarioJobGet, capability: localappop.AppOperationIDScenarioJobGet},
		localappop.IngressScenarioJobSubscribe:   {operation: accountservice.LocalAppOperationScenarioJobSubscribe, capability: localappop.AppOperationIDScenarioJobSubscribe},
		localappop.IngressScenarioJobCancel:      {operation: accountservice.LocalAppOperationScenarioJobCancel, capability: localappop.AppOperationIDScenarioJobCancel},
		localappop.IngressArtifactRead:           {operation: accountservice.LocalAppOperationArtifactRead, capability: localappop.AppOperationIDArtifactRead},
		localappop.IngressArtifactUpload:         {operation: accountservice.LocalAppOperationArtifactUpload, capability: localappop.AppOperationIDArtifactUpload},
		localappop.IngressArtifactAdoptToStorage: {operation: accountservice.LocalAppOperationArtifactAdoptToStorage, capability: "runtime.consume"},
		localappop.IngressVoiceAssetsList:        {operation: accountservice.LocalAppOperationVoiceAssetsList, capability: localappop.AppOperationIDVoiceAssetsList},
	} {
		authorized, err := fixture.service.AuthorizeLocalAppIngress(fixture.context, ingress)
		if err != nil {
			t.Fatalf("authorize %v: %v", ingress, err)
		}
		decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
		if !ok || decision.Operation != want.operation || decision.AuthorityClass != localappop.AuthorityClassAppAccess ||
			decision.OperationCapability != want.capability {
			t.Fatalf("scenario family handoff for %v = %+v", ingress, decision)
		}
	}

	denied := newLocalAppSessionFixture(t, []string{"realm.data"})
	if _, err := denied.service.OpenLocalAppSessionProjection(denied.context); err != nil {
		t.Fatal(err)
	}
	for _, ingress := range []localappop.Ingress{
		localappop.IngressTextTurnStream,
		localappop.IngressScenarioExecute,
		localappop.IngressScenarioJobSubmit,
		localappop.IngressScenarioJobGet,
		localappop.IngressScenarioJobSubscribe,
		localappop.IngressScenarioJobCancel,
		localappop.IngressArtifactRead,
		localappop.IngressArtifactUpload,
		localappop.IngressArtifactAdoptToStorage,
		localappop.IngressVoiceAssetsList,
	} {
		assertLocalAppReason(
			t,
			denied.service.AdmitLocalAppIngress(denied.context, ingress),
			runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE,
		)
	}
}

func TestLocalAppSessionAssetStorageBaseAuthorization(t *testing.T) {
	fixture := newLocalAppSessionFixture(t, nil)
	if _, err := fixture.service.OpenLocalAppSessionProjection(fixture.context); err != nil {
		t.Fatal(err)
	}
	for ingress, operation := range map[localappop.Ingress]accountservice.LocalAppOperation{
		localappop.IngressStorageAssetStat:   accountservice.LocalAppOperationStorageAssetStat,
		localappop.IngressStorageAssetList:   accountservice.LocalAppOperationStorageAssetList,
		localappop.IngressStorageAssetWrite:  accountservice.LocalAppOperationStorageAssetWrite,
		localappop.IngressStorageAssetRead:   accountservice.LocalAppOperationStorageAssetRead,
		localappop.IngressStorageAssetRemove: accountservice.LocalAppOperationStorageAssetRemove,
		localappop.IngressStorageAssetMove:   accountservice.LocalAppOperationStorageAssetMove,
		localappop.IngressStorageAssetReveal: accountservice.LocalAppOperationStorageAssetReveal,
	} {
		authorized, err := fixture.service.AuthorizeLocalAppIngress(fixture.context, ingress)
		if err != nil {
			t.Fatalf("authorize %v: %v", ingress, err)
		}
		decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
		if !ok || decision.Operation != operation || decision.AuthorityClass != localappop.AuthorityClassBase ||
			decision.OperationCapability != appstorage.LocalAppPrivateStorageEntitlement {
			t.Fatalf("asset storage Base handoff for %v = %+v", ingress, decision)
		}
	}
}

func assertLocalAppReason(t testing.TB, err error, want runtimev1.ReasonCode) {
	t.Helper()
	if got, ok := grpcerr.ExtractReasonCode(err); !ok || got != want {
		t.Fatalf("reason = %v (%v), want %v", got, err, want)
	}
}

type localAppSessionFixture struct {
	service            *Service
	kernel             *localappkernel.Kernel
	account            *localAppSessionTestAccount
	connection         *protectedlocal.LocalAppConnection
	context            context.Context
	process            protectedlocal.ProcessTuple
	registration       localappkernel.Registration
	registrationInput  localappkernel.RegisterDevelopmentInput
	store              *localDevelopmentStore
	registrationHandle protectedlocal.Identifier
	now                time.Time
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
		store: store, registrationHandle: registrationHandle, now: now,
	}
}

type localAppSessionTestAccount struct {
	mu             sync.Mutex
	projection     *runtimev1.AccountProjection
	generation     uint64
	invalidated    chan struct{}
	currentUser    accountservice.CurrentUserDisplay
	currentUserErr error
}

func newLocalAppSessionTestAccount(accountID, realmID string) *localAppSessionTestAccount {
	return &localAppSessionTestAccount{
		projection: &runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: realmID},
		generation: 1, invalidated: make(chan struct{}),
		currentUser: accountservice.CurrentUserDisplay{
			Handle: "tester", DisplayName: "Tester", AvatarURL: localAppSessionTestString("https://cdn.example/avatar.png"),
		},
	}
}

func (account *localAppSessionTestAccount) CurrentUserDisplay(context.Context) (accountservice.CurrentUserDisplay, error) {
	account.mu.Lock()
	defer account.mu.Unlock()
	return account.currentUser, account.currentUserErr
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
	if account.projection == nil {
		return nil, account.generation, account.invalidated, false
	}
	projection := proto.Clone(account.projection).(*runtimev1.AccountProjection)
	return projection, account.generation, account.invalidated, true
}

func (account *localAppSessionTestAccount) signOut() {
	account.mu.Lock()
	account.projection = nil
	account.mu.Unlock()
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

func localAppSessionTestString(value string) *string { return &value }

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
