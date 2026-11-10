package app

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/remoteaccess"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

// Unit boundary fixture only: real registration, storage and App admission;
// the already-authenticated transport is replaced, never product acceptance.
type remoteSessionTestPeer struct {
	info remoteaccess.PeerInfo
	done chan struct{}
}

func (p *remoteSessionTestPeer) Snapshot() (remoteaccess.PeerInfo, bool) {
	select {
	case <-p.done:
		return remoteaccess.PeerInfo{}, false
	default:
		return p.info, true
	}
}
func (p *remoteSessionTestPeer) Done() <-chan struct{} { return p.done }
func (p *remoteSessionTestPeer) Commit(ctx context.Context, id protectedlocal.Identifier, work func() error) error {
	if _, live := p.Snapshot(); !live || id != p.info.SessionID {
		return errors.New("peer ended")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return work()
}

type remoteSessionTestAccount struct{ *localAppSessionTestAccount }

func TestMissingRemotePeerCannotAcquireAppOrManagerAuthority(t *testing.T) {
	f := newLocalAppSessionFixture(t, nil)
	if _, err := f.service.AuthorizeRemoteAppIngress(f.context, nil, localappop.IngressStorageJSONRead); err == nil {
		t.Fatal("native context substituted for a missing remote App peer")
	}
	if _, err := f.service.AuthorizeRemoteManager(f.context, nil); err == nil {
		t.Fatal("native context substituted for a missing remote owner peer")
	}
}

func (a *remoteSessionTestAccount) CommitAuthenticatedRuntimeGeneration(ctx context.Context, account, realm string, generation uint64, work func() error) (bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	if a.projection == nil || a.projection.AccountId != account || a.projection.RealmEnvironmentId != realm || a.generation != generation {
		return false, nil
	}
	return true, work()
}

func TestRemoteAppRevalidationAndStorageNeverNeedNativeProcessProof(t *testing.T) {
	for _, invalidation := range []string{"pause", "account", "binding", "peer", "declaration"} {
		t.Run(invalidation, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			root := t.TempDir()
			identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
			if err != nil {
				t.Fatal(err)
			}
			db, err := localappkernel.CanonicalRegistrationDatabasePath(root)
			if err != nil {
				t.Fatal(err)
			}
			kernel, err := localappkernel.OpenSQLite(ctx, db, identity, localappkernel.Options{HostInstallID: "remote-unit", DataRoot: root})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = kernel.Close() }()
			account := &remoteSessionTestAccount{newLocalAppSessionTestAccount("account-1", "realm-1")}
			service := New(nil, WithLocalAppKernel(kernel), WithAppStorageDataRoot(root), WithRuntimeAccountProjectionProvider(account))
			t.Cleanup(service.CloseLocalAppStorage)
			scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-1", AccountID: "account-1", BindingID: "binding-1"}
			input := localappkernel.RegisterRemoteInput{AppID: "nimi.test.remote", DisplayName: "Remote unit", RealmEnvironmentID: "realm-1", ClientID: "remote.unit",
				Origin: "https://lab.example", RedirectURI: "https://lab.example/", Role: "app", SourceRevision: 1, RawDeclaration: []string{"runtime.consume", "agent.local"}}
			if err := kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); err != nil {
				t.Fatal(err)
			}
			if err := kernel.RemoteAccess().SetEnabled(ctx, scope, true); err != nil {
				t.Fatal(err)
			}
			access, err := kernel.RemoteAccess().Source(ctx, scope, input.ClientID)
			if err != nil {
				t.Fatal(err)
			}
			registration, err := kernel.Registrations().GetActiveByHandle(ctx, access.RegistrationHandle)
			if err != nil {
				t.Fatal(err)
			}
			source, err := kernel.Registrations().RemoteSource(ctx, access.RegistrationHandle)
			if err != nil {
				t.Fatal(err)
			}
			peer := &remoteSessionTestPeer{done: make(chan struct{}), info: remoteaccess.PeerInfo{Scope: scope, ContextID: "verified-context", AccountGeneration: 1,
				AccountInvalidated: account.invalidated, Registration: registration, Source: source, SessionID: localAppSessionTestIdentifier(0x41),
				RuntimeInstanceID: localAppSessionTestIdentifier(0x42), Deadline: time.Now().Add(time.Minute)}}
			defer func() {
				select {
				case <-peer.done:
				default:
					close(peer.done)
				}
			}()
			admitted, err := service.authorizeRemoteAppIngress(ctx, peer, localappop.IngressStorageJSONWrite)
			if err != nil {
				t.Fatal(err)
			}
			decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(admitted)
			if !ok || decision.TrustClass != accountservice.LocalAppTrustClassRemote || decision.Process.PID != 0 {
				t.Fatal("remote admission fabricated a native process")
			}
			if _, exists := protectedlocal.LocalAppConnectionFromContext(admitted); exists {
				t.Fatal("remote admission used a native connection")
			}
			if _, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressAppActivityList); err == nil {
				t.Fatal("remote peer without app.activity obtained activity access")
			}
			if _, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressAppActivityPut); err == nil {
				t.Fatal("remote peer without app.activity obtained publication access")
			}
			for _, ingress := range []localappop.Ingress{localappop.IngressRealmWorldCoreGet, localappop.IngressRealmPersonaCharacterGetOwned} {
				if _, err := service.AuthorizeLocalAppIngress(admitted, ingress); err == nil {
					t.Fatal("remote peer without realm.data obtained Realm resource access")
				}
			}
			if _, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressAgentReferenceList); err != nil {
				t.Fatal("declared remote Agent access was unavailable", err)
			}
			if _, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressAgentManagerSnapshotGet); err == nil {
				t.Fatal("agent.local was promoted to agent.configure")
			}
			if _, err := service.WriteLocalAppStorageJson(admitted, &runtimev1.WriteLocalAppStorageJsonRequest{RelativePath: "history.json", JsonValue: []byte(`{"result":"original"}`)}); err != nil {
				t.Fatal(err)
			}
			read, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressStorageJSONRead)
			if err != nil {
				t.Fatal(err)
			}
			stored, err := service.ReadLocalAppStorageJson(read, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "history.json"})
			if err != nil || string(stored.JsonValue) != `{"result":"original"}` {
				t.Fatal("remote storage round trip failed", err)
			}
			assetCtx, err := service.AuthorizeLocalAppIngress(admitted, localappop.IngressStorageAssetWrite)
			if err != nil {
				t.Fatal(err)
			}
			writeAssetThroughService(t, service, assetCtx, "original.bin", []byte("original"), false)
			upload := &localAppAssetWriteTestStream{
				ctx: assetCtx,
				requests: []*runtimev1.WriteLocalAppAssetRequest{
					{Frame: &runtimev1.WriteLocalAppAssetRequest_Metadata{Metadata: &runtimev1.WriteLocalAppAssetMetadata{RelativePath: "original.bin", Overwrite: true}}},
					{Frame: &runtimev1.WriteLocalAppAssetRequest_BodyChunk{BodyChunk: []byte("must not replace")}},
				},
				onEOF: func() {
					switch invalidation {
					case "pause":
						err = kernel.RemoteAccess().SetPaused(ctx, scope, input.ClientID, true)
					case "account":
						account.replace("account-2", "realm-1")
					case "binding":
						scope.BindingID = "binding-2"
						err = kernel.RemoteAccess().SetEnabled(ctx, scope, true)
					case "peer":
						close(peer.done)
					case "declaration":
						input.ExistingRegistrationHandle = access.RegistrationHandle
						input.SourceRevision++
						input.RawDeclaration = nil
						_, err = kernel.Registrations().RegisterRemote(ctx, input)
					}
					if err != nil {
						t.Fatal(err)
					}
				},
			}
			if err := service.WriteLocalAppAsset(upload); err == nil || upload.response != nil {
				t.Fatal("stale upload committed", err)
			}
			store, err := service.localAppAssets()
			if err != nil {
				t.Fatal(err)
			}
			record, err := store.Stat(ctx, appstorage.ManagedOwner{AccountID: "account-1", RegisteredAppSubject: registration.RegisteredAppSubject}, "original.bin")
			if err != nil || record.SizeBytes != int64(len("original")) {
				t.Fatal("rejected upload replaced committed asset", err)
			}

			if _, err = service.AuthorizeLocalAppIngress(admitted, localappop.IngressStorageJSONRead); err == nil {
				t.Fatal("stale remote context revalidated")
			}
			committed := false
			if err = service.CommitLocalAppIngress(admitted, localappop.IngressStorageJSONWrite, func(context.Context) error { committed = true; return nil }); err == nil || committed {
				t.Fatal("stale remote context published a mutation", err)
			}
		})
	}
}
