package app

import (
	"context"
	"crypto/rand"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/remoteaccess"
)

// Real registration and native/remote admission fences. The authenticated peer
// is the existing unit transport fixture, not a product-acceptance substitute.
func TestRemoteConsumerNativeProviderPublication(t *testing.T) {
	for _, invalidation := range []string{"peer", "provider", "account", "source", "declaration"} {
		t.Run(invalidation, func(t *testing.T) {
			f := newLocalAppSessionFixtureWithRandom(t, []string{"integration.provide"}, "", rand.Reader)
			f, _, _ = bindRunAccessFixture(t, f)
			f.service.now = time.Now
			WithRuntimeAccountProjectionProvider(&remoteSessionTestAccount{f.account})(f.service)
			if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm-1", AccountID: "account-1", BindingID: "remote-integration"}
			input := localappkernel.RegisterRemoteInput{AppID: "nimi.test.remote.integration", DisplayName: "Remote integration", RealmEnvironmentID: "realm-1",
				ClientID: "remote.integration", Origin: "https://app.example", RedirectURI: "https://app.example/", Role: "app", SourceRevision: 1,
				RawDeclaration: []string{"integration.consume"}}
			if err := f.kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); err != nil {
				t.Fatal(err)
			}
			if err := f.kernel.RemoteAccess().SetEnabled(ctx, scope, true); err != nil {
				t.Fatal(err)
			}
			access, err := f.kernel.RemoteAccess().Source(ctx, scope, input.ClientID)
			if err != nil {
				t.Fatal(err)
			}
			registration, err := f.kernel.Registrations().GetActiveByHandle(ctx, access.RegistrationHandle)
			if err != nil {
				t.Fatal(err)
			}
			source, err := f.kernel.Registrations().RemoteSource(ctx, access.RegistrationHandle)
			if err != nil {
				t.Fatal(err)
			}
			peer := &remoteSessionTestPeer{done: make(chan struct{}), info: remoteaccess.PeerInfo{Scope: scope, ContextID: "remote-integration", AccountGeneration: 1,
				AccountInvalidated: f.account.invalidated, Registration: registration, Source: source, SessionID: localAppSessionTestIdentifier(0x61),
				RuntimeInstanceID: f.connection.RuntimeBootEpoch(), Deadline: time.Now().Add(time.Minute)}}
			defer func() {
				select {
				case <-peer.done:
				default:
					close(peer.done)
				}
			}()
			consumer, err := f.service.authorizeRemoteAppIngress(ctx, peer, localappop.IngressIntegrationCallInvoke)
			if err != nil {
				t.Fatal(err)
			}
			committed := 0
			publish := func(context.Context, context.Context) error { committed++; return nil }
			if err := f.service.CommitLocalAppProviderCompletion(consumer, f.context, publish); err != nil || committed != 1 {
				t.Fatalf("live remote/native result refused: committed=%d err=%v", committed, err)
			}
			switch invalidation {
			case "peer":
				close(peer.done)
			case "provider":
				f.connection.Revoke()
			case "account":
				f.account.replace("account-2", "realm-1")
			case "source":
				err = f.kernel.RemoteAccess().SetPaused(ctx, scope, input.ClientID, true)
			case "declaration":
				input.ExistingRegistrationHandle = access.RegistrationHandle
				input.SourceRevision++
				input.RawDeclaration = nil
				_, err = f.kernel.Registrations().RegisterRemote(ctx, input)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := f.service.CommitLocalAppProviderCompletion(consumer, f.context, publish); err == nil || committed != 1 {
				t.Fatalf("retired %s participant published: committed=%d err=%v", invalidation, committed, err)
			}
		})
	}
}
