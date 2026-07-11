package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/metadata"
)

type desktopSessionTestVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier desktopSessionTestVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

type desktopSessionTestLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newDesktopSessionTestLiveness() *desktopSessionTestLiveness {
	return &desktopSessionTestLiveness{revoked: make(chan struct{})}
}

func (liveness *desktopSessionTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }

func (liveness *desktopSessionTestLiveness) Close() error {
	liveness.Revoke()
	return nil
}

func (liveness *desktopSessionTestLiveness) Revoke() {
	liveness.once.Do(func() { close(liveness.revoked) })
}

type desktopSessionFixture struct {
	manager    *protectedlocal.DesktopSessionManager
	connection *protectedlocal.Connection
	liveness   *desktopSessionTestLiveness
	ledger     *protectedlocal.Ledger
	bootEpoch  protectedlocal.Identifier
}

func newDesktopSessionFixture(t *testing.T) desktopSessionFixture {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(
		filepath.Join(directory, "protected_local.anchor"),
		bytes.Repeat([]byte{0x81}, protectedlocal.IdentifierBytes),
	)
	if err != nil {
		t.Fatalf("new anchor store: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0x82}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open protected-local ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	bootEpoch, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start protected-local runtime: %v", err)
	}
	manager, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader)
	if err != nil {
		t.Fatalf("new desktop session manager: %v", err)
	}
	connection, liveness := establishDesktopSessionConnection(t, bootEpoch)
	return desktopSessionFixture{
		manager:    manager,
		connection: connection,
		liveness:   liveness,
		ledger:     ledger,
		bootEpoch:  bootEpoch,
	}
}

func establishDesktopSessionConnection(t *testing.T, bootEpoch protectedlocal.Identifier) (*protectedlocal.Connection, *desktopSessionTestLiveness) {
	t.Helper()
	liveness := newDesktopSessionTestLiveness()
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), desktopSessionTestVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         7201,
			CreationMarker:              "auth-desktop-start",
			OSLoginSession:              "auth-logon-session",
			SecurityPrincipal:           "auth-interactive-user",
			CanonicalExecutableIdentity: "auth-desktop-file-identity",
			ExecutableDigest:            filledProtectedIdentifier(0x91),
			ExecutableTrustSetID:        "nimi-desktop-auth-fixture-v1",
		},
		Server: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         8201,
			CreationMarker:              "auth-runtime-start",
			OSLoginSession:              "service-session-0",
			SecurityPrincipal:           "NT SERVICE/NimiRuntimeAuthFixture",
			CanonicalExecutableIdentity: "auth-runtime-file-identity",
			ExecutableDigest:            filledProtectedIdentifier(0x92),
			ExecutableTrustSetID:        "nimi-runtime-auth-fixture-v1",
		},
		ClientLiveness:     liveness,
		RuntimeBootEpoch:   bootEpoch,
		EndpointInstanceID: filledProtectedIdentifier(0x93),
		TranscriptNonce:    filledProtectedIdentifier(0x94),
	}}, rand.Reader)
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return connection, liveness
}

func filledProtectedIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func newDesktopSessionService(manager *protectedlocal.DesktopSessionManager) *Service {
	options := []Option{}
	if manager != nil {
		options = append(options, WithDesktopSessionManager(manager))
	}
	return NewWithDependencies(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		60,
		86400,
		options...,
	)
}

func assertDesktopSessionReason(t *testing.T, err error, want runtimev1.ReasonCode) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s error", want)
	}
	got, ok := grpcerr.ExtractReasonCode(err)
	if !ok || got != want {
		t.Fatalf("reason = %v (present=%v), want %v; err=%v", got, ok, want, err)
	}
}

func TestOpenDesktopSessionRejectsPlainAndMetadataForgedContexts(t *testing.T) {
	fixture := newDesktopSessionFixture(t)
	service := newDesktopSessionService(fixture.manager)

	if requestFields := (&runtimev1.OpenDesktopSessionRequest{}).ProtoReflect().Descriptor().Fields().Len(); requestFields != 0 {
		t.Fatalf("OpenDesktopSession request has %d fields, want empty", requestFields)
	}
	contexts := []context.Context{
		context.Background(),
		metadata.NewIncomingContext(context.Background(), metadata.Pairs(
			"x-nimi-desktop-connection", "forged",
			"desktop-session-id", string(bytes.Repeat([]byte{0xa1}, protectedlocal.IdentifierBytes)),
			"runtime-boot-epoch", string(fixture.bootEpoch[:]),
		)),
	}
	for index, callContext := range contexts {
		_, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
		if err == nil {
			t.Fatalf("context %d unexpectedly opened a desktop session", index)
		}
		assertDesktopSessionReason(t, err, runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED)
	}
}

func TestOpenDesktopSessionRequiresInjectedManager(t *testing.T) {
	fixture := newDesktopSessionFixture(t)
	service := newDesktopSessionService(nil)
	callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), fixture.connection)

	_, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
	assertDesktopSessionReason(t, err, runtimev1.ReasonCode_PROTECTED_LOCAL_LEDGER_UNAVAILABLE)
}

func TestOpenDesktopSessionProjectsExactIdentifiersAndRejectsDuplicate(t *testing.T) {
	fixture := newDesktopSessionFixture(t)
	service := newDesktopSessionService(fixture.manager)
	callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), fixture.connection)

	response, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
	if err != nil {
		t.Fatalf("open desktop session: %v", err)
	}
	if len(response.GetDesktopSessionId()) != protectedlocal.IdentifierBytes {
		t.Fatalf("desktop_session_id length = %d, want %d", len(response.GetDesktopSessionId()), protectedlocal.IdentifierBytes)
	}
	if !bytes.Equal(response.GetRuntimeBootEpoch(), fixture.bootEpoch[:]) || len(response.GetRuntimeBootEpoch()) != protectedlocal.IdentifierBytes {
		t.Fatalf("runtime_boot_epoch = %x, want %x", response.GetRuntimeBootEpoch(), fixture.bootEpoch)
	}

	_, err = service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
	assertDesktopSessionReason(t, err, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
}

func TestOpenDesktopSessionRejectsStaleAndRevokedConnections(t *testing.T) {
	t.Run("stale boot epoch", func(t *testing.T) {
		fixture := newDesktopSessionFixture(t)
		staleConnection, _ := establishDesktopSessionConnection(t, filledProtectedIdentifier(0xa5))
		service := newDesktopSessionService(fixture.manager)
		callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), staleConnection)

		_, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
		assertDesktopSessionReason(t, err, runtimev1.ReasonCode_PROTECTED_LOCAL_BOOT_EPOCH_MISMATCH)
	})

	t.Run("liveness revoked", func(t *testing.T) {
		fixture := newDesktopSessionFixture(t)
		service := newDesktopSessionService(fixture.manager)
		callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), fixture.connection)
		if _, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{}); err != nil {
			t.Fatalf("open live desktop session: %v", err)
		}

		fixture.liveness.Revoke()
		deadline := time.Now().Add(time.Second)
		for {
			_, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{})
			if reason, ok := grpcerr.ExtractReasonCode(err); ok && reason == runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE {
				break
			}
			if time.Now().After(deadline) {
				assertDesktopSessionReason(t, err, runtimev1.ReasonCode_DESKTOP_PROCESS_VERIFICATION_UNAVAILABLE)
			}
			time.Sleep(time.Millisecond)
		}
		fixture.connection.Revoke()
	})

	t.Run("durable ledger is not session truth", func(t *testing.T) {
		fixture := newDesktopSessionFixture(t)
		service := newDesktopSessionService(fixture.manager)
		callContext := protectedlocal.ContextWithDesktopConnection(context.Background(), fixture.connection)
		if err := fixture.ledger.Close(); err != nil {
			t.Fatalf("close ledger: %v", err)
		}

		if _, err := service.OpenDesktopSession(callContext, &runtimev1.OpenDesktopSessionRequest{}); err != nil {
			t.Fatalf("ordinary session depended on durable ledger: %v", err)
		}
	})
}
