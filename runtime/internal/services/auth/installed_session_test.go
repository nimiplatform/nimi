package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type installedSessionAccount struct {
	generation uint64
	ready      bool
}

func (account installedSessionAccount) AuthenticatedRuntimeSecurityContext(context.Context) (*runtimev1.AccountProjection, uint64, bool) {
	if !account.ready {
		return nil, account.generation, false
	}
	return &runtimev1.AccountProjection{AccountId: "account-1", RealmEnvironmentId: "realm-1"}, account.generation, true
}

type installedSessionVerifier struct {
	peer protectedlocal.VerifiedInstalledLaunchPeer
}

func (verifier installedSessionVerifier) VerifyInstalledLaunchPeer(context.Context) (protectedlocal.VerifiedInstalledLaunchPeer, error) {
	return verifier.peer, nil
}

func TestOpenDesktopLaunchedAppSessionConsumesOnlyVerifiedNativeConnection(t *testing.T) {
	fixture := newInstalledSessionFixture(t, installedIdentifier(0x41), 7)
	if fields := (&runtimev1.OpenDesktopLaunchedAppSessionRequest{}).ProtoReflect().Descriptor().Fields().Len(); fields != 0 {
		t.Fatalf("request authority fields = %d, want empty", fields)
	}

	if _, err := fixture.service.OpenDesktopLaunchedAppSession(context.Background(), &runtimev1.OpenDesktopLaunchedAppSessionRequest{}); installedSessionReason(err) != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("ordinary context reason = %v, err=%v", installedSessionReason(err), err)
	}

	response, err := fixture.service.OpenDesktopLaunchedAppSession(fixture.context, &runtimev1.OpenDesktopLaunchedAppSessionRequest{})
	if err != nil {
		t.Fatalf("open installed session: %v", err)
	}
	if response.GetAppId() != "world.nimi.app" || response.GetAccountGeneration() != 7 || len(response.GetInstalledSessionId()) != protectedlocal.IdentifierBytes || len(response.GetInstalledSessionProof()) != protectedlocal.IdentifierBytes {
		t.Fatalf("unexpected response: %+v", response)
	}
	if _, err := fixture.service.OpenDesktopLaunchedAppSession(fixture.context, &runtimev1.OpenDesktopLaunchedAppSessionRequest{}); installedSessionReason(err) != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("replay reason = %v, err=%v", installedSessionReason(err), err)
	}

	binding := fixture.bindingFromResponse(response)
	if err := fixture.store.ValidateSession(context.Background(), binding); err != nil {
		t.Fatalf("validate installed session: %v", err)
	}
	fixture.liveness.Revoke()
	deadline := time.Now().Add(time.Second)
	for {
		err = fixture.store.ValidateSession(context.Background(), binding)
		if errors.Is(err, ErrInstalledSessionRevoked) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("process exit did not revoke installed session: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestOpenDesktopLaunchedAppSessionRejectsAuthorityMismatch(t *testing.T) {
	tests := []struct {
		name       string
		storeBoot  protectedlocal.Identifier
		peerBoot   protectedlocal.Identifier
		ticketGen  uint64
		accountGen uint64
		ticketHash protectedlocal.Identifier
		peerHash   protectedlocal.Identifier
		want       runtimev1.ReasonCode
	}{
		{name: "release", storeBoot: installedIdentifier(0x51), peerBoot: installedIdentifier(0x51), ticketGen: 9, accountGen: 9, ticketHash: installedIdentifier(0x61), peerHash: installedIdentifier(0x62), want: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{name: "account generation", storeBoot: installedIdentifier(0x52), peerBoot: installedIdentifier(0x52), ticketGen: 9, accountGen: 10, ticketHash: installedIdentifier(0x63), peerHash: installedIdentifier(0x63), want: runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH},
		{name: "runtime boot", storeBoot: installedIdentifier(0x53), peerBoot: installedIdentifier(0x54), ticketGen: 9, accountGen: 9, ticketHash: installedIdentifier(0x64), peerHash: installedIdentifier(0x64), want: runtimev1.ReasonCode_PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newInstalledSessionFixtureWithAuthority(t, test.storeBoot, test.peerBoot, test.ticketGen, test.accountGen, test.ticketHash, test.peerHash)
			_, err := fixture.service.OpenDesktopLaunchedAppSession(fixture.context, &runtimev1.OpenDesktopLaunchedAppSessionRequest{})
			if got := installedSessionReason(err); got != test.want {
				t.Fatalf("reason = %v, want %v; err=%v", got, test.want, err)
			}
		})
	}
}

type installedSessionFixture struct {
	service    *Service
	store      *InstalledLaunchStore
	connection *protectedlocal.InstalledLaunchConnection
	liveness   *desktopSessionTestLiveness
	context    context.Context
	process    protectedlocal.ProcessTuple
}

func newInstalledSessionFixture(t *testing.T, release protectedlocal.Identifier, generation uint64) installedSessionFixture {
	t.Helper()
	boot := installedIdentifier(0x31)
	return newInstalledSessionFixtureWithAuthority(t, boot, boot, generation, generation, release, release)
}

func newInstalledSessionFixtureWithAuthority(t *testing.T, storeBoot, peerBoot protectedlocal.Identifier, ticketGeneration, accountGeneration uint64, ticketRelease, peerRelease protectedlocal.Identifier) installedSessionFixture {
	t.Helper()
	store, err := OpenInstalledLaunchStore(filepath.Join(t.TempDir(), "installed-launch.db"), storeBoot)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	ticket, err := store.Issue(context.Background(), InstalledLaunchIssue{AppID: "world.nimi.app", ReleaseDigest: ticketRelease, AccountGeneration: ticketGeneration})
	if err != nil {
		t.Fatal(err)
	}
	process := protectedlocal.ProcessTuple{
		OS:                          protectedlocal.OSWindows,
		PID:                         4401,
		CreationMarker:              "installed-process-start-1",
		OSLoginSession:              "interactive-session-1",
		SecurityPrincipal:           "interactive-user-1",
		CanonicalExecutableIdentity: "installed-executable-file-1",
		ExecutableDigest:            peerRelease,
		ExecutableTrustSetID:        "installed-release-v1",
	}
	if _, err := store.BindProcess(context.Background(), InstalledLaunchProcess{LaunchID: ticket.LaunchID, PID: process.PID, CreationMarker: process.CreationMarker, ReleaseDigest: ticketRelease, AccountGeneration: ticketGeneration}); err != nil {
		t.Fatalf("bind installed process: %v", err)
	}
	liveness := newDesktopSessionTestLiveness()
	connection, err := protectedlocal.EstablishInstalledLaunchConnection(context.Background(), installedSessionVerifier{peer: protectedlocal.VerifiedInstalledLaunchPeer{
		LaunchID: ticket.LaunchID, Process: process, RuntimeBootEpoch: peerBoot, ProcessLiveness: liveness,
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	service := NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, 60, 86400, WithInstalledLaunchStore(store))
	service.SetRuntimeAccountSecurityContextProvider(installedSessionAccount{generation: accountGeneration, ready: true})
	return installedSessionFixture{service: service, store: store, connection: connection, liveness: liveness, context: protectedlocal.ContextWithInstalledLaunchConnection(context.Background(), connection), process: process}
}

func (fixture installedSessionFixture) bindingFromResponse(response *runtimev1.OpenDesktopLaunchedAppSessionResponse) InstalledSessionBinding {
	var sessionID, proof, release, boot protectedlocal.Identifier
	copy(sessionID[:], response.GetInstalledSessionId())
	copy(proof[:], response.GetInstalledSessionProof())
	copy(release[:], response.GetReleaseDigest())
	copy(boot[:], response.GetRuntimeBootEpoch())
	return InstalledSessionBinding{SessionID: sessionID, SessionProof: proof, AppID: response.GetAppId(), ReleaseDigest: release, PID: fixture.process.PID, CreationMarker: fixture.process.CreationMarker, AccountGeneration: response.GetAccountGeneration(), RuntimeBootEpoch: boot}
}

func installedSessionReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
