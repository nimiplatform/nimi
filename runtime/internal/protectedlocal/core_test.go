package protectedlocal

import (
	"bytes"
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"
)

type fixedDesktopVerifier struct {
	peers VerifiedDesktopPeers
	err   error
}

func (v fixedDesktopVerifier) VerifyDesktopPeers(context.Context) (VerifiedDesktopPeers, error) {
	return v.peers, v.err
}

func TestDesktopSessionIsConnectionBoundAndNotReconstructable(t *testing.T) {
	t.Parallel()

	_, boot := startedTestLedger(t)
	peer := desktopPeers(boot)
	random := distinctIdentifierReader(0x51, 6)
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: peer}, random)
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}

	manager, err := NewDesktopSessionManager(boot, random)
	if err != nil {
		t.Fatalf("new session manager: %v", err)
	}
	connectionContext := ContextWithDesktopConnection(context.Background(), connection)
	projection, err := manager.Open(connectionContext)
	if err != nil {
		t.Fatalf("open desktop session: %v", err)
	}
	if len(projection.DesktopSessionID) != IdentifierBytes || len(projection.RuntimeBootEpoch) != IdentifierBytes {
		t.Fatalf("unexpected projection lengths: session=%d epoch=%d", len(projection.DesktopSessionID), len(projection.RuntimeBootEpoch))
	}
	if err := manager.AuthorizeContext(connectionContext, RoleDesktopAccountHost); err != nil {
		t.Fatalf("authorize bound account role: %v", err)
	}
	if _, ok := DesktopConnectionFromContext(context.Background()); ok {
		t.Fatal("plain context unexpectedly carried a protected desktop connection")
	}
	forgedMetadata := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"desktop-session-id", string(projection.DesktopSessionID),
		"runtime-boot-epoch", string(projection.RuntimeBootEpoch),
	))
	if _, ok := DesktopConnectionFromContext(forgedMetadata); ok {
		t.Fatal("metadata unexpectedly reconstructed a protected desktop connection")
	}
	if err := manager.AuthorizeContext(forgedMetadata, RoleDesktopAccountHost); !IsReason(err, ReasonDesktopControlTransportRequired) {
		t.Fatalf("expected metadata reconstruction to be non-authorizing, got %v", err)
	}

	otherPeer := desktopPeers(boot)
	otherPeer.Client.CreationMarker = "desktop-start-2"
	other, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: otherPeer}, random)
	if err != nil {
		t.Fatalf("establish second connection: %v", err)
	}
	if err := manager.AuthorizeContext(ContextWithDesktopConnection(context.Background(), other), RoleDesktopAccountHost); !IsReason(err, ReasonProtectedOriginRoleMismatch) {
		t.Fatalf("expected connection-bound rejection, got %v", err)
	}

	connection.Revoke()
	if err := manager.AuthorizeContext(connectionContext, RoleDesktopAccountHost); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("expected revoked process rejection, got %v", err)
	}
}

func TestZeroValueDesktopConnectionRevokeDoesNotBlock(t *testing.T) {
	done := make(chan struct{})
	go func() {
		(&Connection{}).Revoke()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("zero-value connection revoke blocked")
	}
}

func TestBoundRevocationHookReplacesExactBindingAndUnbindsCompletedWork(t *testing.T) {
	boot := identifierFilled(0xc1)
	connection, err := EstablishDesktopConnection(
		context.Background(),
		fixedDesktopVerifier{peers: desktopPeers(boot)},
		distinctIdentifierReader(0xc2, 1),
	)
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}
	binding := identifierFilled(0xc3)
	removedBinding := identifierFilled(0xc4)
	firstCalls := 0
	replacementCalls := 0
	removedCalls := 0
	if err := connection.BindRevocationHook(binding, func() { firstCalls++ }); err != nil {
		t.Fatalf("bind first revocation hook: %v", err)
	}
	if err := connection.BindRevocationHook(binding, func() { replacementCalls++ }); err != nil {
		t.Fatalf("replace revocation hook: %v", err)
	}
	if err := connection.BindRevocationHook(removedBinding, func() { removedCalls++ }); err != nil {
		t.Fatalf("bind removable revocation hook: %v", err)
	}
	connection.UnbindRevocationHook(removedBinding)

	connection.Revoke()
	if firstCalls != 0 || replacementCalls != 1 || removedCalls != 0 {
		t.Fatalf("unexpected bound revocation calls: first=%d replacement=%d removed=%d", firstCalls, replacementCalls, removedCalls)
	}

	lateCalls := 0
	if err := connection.BindRevocationHook(identifierFilled(0xc5), func() { lateCalls++ }); err != nil {
		t.Fatalf("bind hook after revocation: %v", err)
	}
	if lateCalls != 1 {
		t.Fatalf("hook bound after revocation must run synchronously, got %d", lateCalls)
	}
}

func TestDesktopSessionManagerValidationIsIndependentOfDurableLedger(t *testing.T) {
	if err := (&DesktopSessionManager{}).Validate(context.Background()); !IsReason(err, ReasonProtectedLocalLedgerUnavailable) {
		t.Fatalf("zero manager validation error = %v", err)
	}

	ledger, boot := startedTestLedger(t)
	manager, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0xb4, 2))
	if err != nil {
		t.Fatalf("new session manager: %v", err)
	}
	if err := manager.Validate(context.Background()); err != nil {
		t.Fatalf("validate anchored manager: %v", err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatalf("close ledger: %v", err)
	}
	if err := manager.Validate(context.Background()); err != nil {
		t.Fatalf("ordinary session authority depended on closed ledger: %v", err)
	}
}

func TestBootEpochRequiresExactlyThirtyTwoNonzeroRandomBytes(t *testing.T) {
	t.Parallel()

	if _, err := NewBootEpoch(bytes.NewReader(make([]byte, IdentifierBytes))); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("expected all-zero epoch rejection, got %v", err)
	}
	if _, err := NewBootEpoch(bytes.NewReader(make([]byte, IdentifierBytes-1))); !IsReason(err, ReasonProtectedLocalCustodyBoundaryUnavailable) {
		t.Fatalf("expected short entropy rejection, got %v", err)
	}
}

func TestDesktopSessionIsLimitedToOnePerCanonicalProcessTuple(t *testing.T) {
	t.Parallel()

	_, boot := startedTestLedger(t)
	random := distinctIdentifierReader(0x71, 5)
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: desktopPeers(boot)}, random)
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}
	manager, err := NewDesktopSessionManager(boot, random)
	if err != nil {
		t.Fatalf("new session manager: %v", err)
	}
	connectionContext := ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(connectionContext); err != nil {
		t.Fatalf("first open: %v", err)
	}
	if _, err := manager.Open(connectionContext); !IsReason(err, ReasonProtectedOriginRoleMismatch) {
		t.Fatalf("expected one-session limit rejection, got %v", err)
	}
}

func TestTransportAndRolesAreDerivedBeforeRequests(t *testing.T) {
	t.Parallel()

	boot := identifierFilled(0x21)
	random := bytes.NewReader(bytes.Repeat([]byte{0x31}, IdentifierBytes))
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: desktopPeers(boot)}, random)
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}
	origin := connection.Origin()
	if origin.TransportClass != TransportDesktopControl {
		t.Fatalf("unexpected transport: %q", origin.TransportClass)
	}
	for _, role := range []OriginRole{RoleVerifiedDesktopProcess, RoleDesktopAccountHost, RoleLocalAppControl} {
		if !origin.HasRole(role) {
			t.Fatalf("missing derived role %q", role)
		}
	}
	if origin.HasRole(RoleBindingOnly) {
		t.Fatal("desktop connection must not inherit binding-only as privilege")
	}
}

func TestVerifiedDesktopConnectionsHaveDistinctOpaqueTransportIdentities(t *testing.T) {
	t.Parallel()

	boot := identifierFilled(0x21)
	windowsConnection, err := EstablishDesktopConnection(
		context.Background(),
		fixedDesktopVerifier{peers: desktopPeers(boot)},
		bytes.NewReader(bytes.Repeat([]byte{0x41}, IdentifierBytes)),
	)
	if err != nil {
		t.Fatalf("establish Windows Desktop connection: %v", err)
	}
	t.Cleanup(windowsConnection.Revoke)

	macOSConnection, err := newDirectDesktopConnection(DesktopPeerIdentity{
		OS: OSMacOS, PID: 4201, UID: 501, AuditSession: 77,
	}, nil)
	if err != nil {
		t.Fatalf("establish direct macOS Desktop connection: %v", err)
	}
	t.Cleanup(macOSConnection.Revoke)

	windowsID, ok := VerifiedDesktopConnectionIDFromContext(
		ContextWithDesktopConnection(context.Background(), windowsConnection),
	)
	if !ok || windowsID == (Identifier{}) {
		t.Fatal("Windows Desktop connection has no opaque transport identity")
	}
	macOSID, ok := VerifiedDesktopConnectionIDFromContext(
		ContextWithDesktopConnection(context.Background(), macOSConnection),
	)
	if !ok || macOSID == (Identifier{}) {
		t.Fatal("direct macOS Desktop connection has no opaque transport identity")
	}
	if windowsID == macOSID {
		t.Fatal("distinct verified Desktop connections share one transport identity")
	}
	if _, ok := VerifiedDesktopConnectionIDFromContext(context.Background()); ok {
		t.Fatal("plain context unexpectedly has a verified Desktop connection identity")
	}
	windowsConnection.Revoke()
	if _, ok := VerifiedDesktopConnectionIDFromContext(
		ContextWithDesktopConnection(context.Background(), windowsConnection),
	); ok {
		t.Fatal("revoked Desktop connection retained an owner-session identity")
	}
}

func TestDesktopSessionOwnershipIsBootScopedPerManager(t *testing.T) {
	t.Parallel()

	_, boot := startedTestLedger(t)
	if _, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0x91, 1)); err != nil {
		t.Fatalf("ordinary session manager required durable ledger: %v", err)
	}
	firstConnection, err := EstablishDesktopConnection(
		context.Background(),
		fixedDesktopVerifier{peers: desktopPeers(boot)},
		distinctIdentifierReader(0x92, 1),
	)
	if err != nil {
		t.Fatalf("establish first connection: %v", err)
	}
	t.Cleanup(firstConnection.Revoke)
	secondConnection, err := EstablishDesktopConnection(
		context.Background(),
		fixedDesktopVerifier{peers: desktopPeers(boot)},
		distinctIdentifierReader(0x93, 1),
	)
	if err != nil {
		t.Fatalf("establish second connection: %v", err)
	}
	t.Cleanup(secondConnection.Revoke)
	firstManager, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0x94, 2))
	if err != nil {
		t.Fatalf("new first session manager: %v", err)
	}
	secondManager, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0x95, 2))
	if err != nil {
		t.Fatalf("new second session manager: %v", err)
	}
	if _, err := firstManager.Open(ContextWithDesktopConnection(context.Background(), firstConnection)); err != nil {
		t.Fatalf("open first boot-scoped session: %v", err)
	}
	if _, err := secondManager.Open(ContextWithDesktopConnection(context.Background(), secondConnection)); err != nil {
		t.Fatalf("independent manager could not own its distinct connection: %v", err)
	}
}

func TestDesktopSessionLivenessRevocationImmediatelyRemovesContextAuthority(t *testing.T) {
	t.Parallel()

	_, boot := startedTestLedger(t)
	peers := desktopPeers(boot)
	liveness := peers.ClientLiveness.(*manualDesktopLiveness)
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: peers}, distinctIdentifierReader(0xb1, 1))
	if err != nil {
		t.Fatalf("establish desktop connection: %v", err)
	}
	manager, err := NewDesktopSessionManager(boot, distinctIdentifierReader(0xb2, 2))
	if err != nil {
		t.Fatalf("new session manager: %v", err)
	}
	connectionContext := ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(connectionContext); err != nil {
		t.Fatalf("open desktop session: %v", err)
	}
	if err := manager.AuthorizeContext(connectionContext, RoleLocalAppControl); err != nil {
		t.Fatalf("authorize live lifecycle role: %v", err)
	}

	liveness.revoke()
	deadline := time.Now().Add(time.Second)
	for {
		err = manager.AuthorizeContext(connectionContext, RoleLocalAppControl)
		if IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("liveness revocation did not remove authority: %v", err)
		}
		time.Sleep(time.Millisecond)
	}
	connection.Revoke()
}

func TestDesktopConnectionRequiresCanonicalPrincipalAndRetainedLiveness(t *testing.T) {
	t.Parallel()

	boot := identifierFilled(0xa1)
	missingLiveness := desktopPeers(boot)
	missingLiveness.ClientLiveness = nil
	if _, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: missingLiveness}, distinctIdentifierReader(0xa2, 1)); !IsReason(err, ReasonDesktopProcessVerificationUnavailable) {
		t.Fatalf("expected retained liveness rejection, got %v", err)
	}

	nonCanonicalPrincipal := desktopPeers(boot)
	nonCanonicalPrincipal.Server.SecurityPrincipal = " interactive-user "
	if _, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: nonCanonicalPrincipal}, distinctIdentifierReader(0xa3, 1)); !IsReason(err, ReasonProtectedLocalRuntimePrincipalRequired) {
		t.Fatalf("expected non-canonical principal rejection, got %v", err)
	}

	peers := desktopPeers(boot)
	liveness := peers.ClientLiveness.(*manualDesktopLiveness)
	connection, err := EstablishDesktopConnection(context.Background(), fixedDesktopVerifier{peers: peers}, distinctIdentifierReader(0xa4, 1))
	if err != nil {
		t.Fatalf("establish live connection: %v", err)
	}
	liveness.revoke()
	deadline := time.Now().Add(time.Second)
	for connection.live.Load() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if connection.live.Load() {
		t.Fatal("retained liveness revocation did not revoke connection")
	}
}

func TestDirectDesktopConnectionRetainsProcessLivenessUntilRevocation(t *testing.T) {
	t.Parallel()

	liveness := newManualDesktopLiveness()
	connection, err := newDirectDesktopConnection(DesktopPeerIdentity{
		OS: OSWindows, PID: 4101, UID: 9, AuditSession: 9,
	}, liveness)
	if err != nil {
		t.Fatalf("establish direct Desktop connection: %v", err)
	}
	transportClosed := make(chan struct{})
	connection.onRevoke(func() { close(transportClosed) })

	liveness.revoke()
	select {
	case <-connection.Done():
	case <-time.After(time.Second):
		t.Fatal("Desktop process exit did not revoke the direct connection")
	}
	select {
	case <-transportClosed:
	case <-time.After(time.Second):
		t.Fatal("Desktop process exit did not revoke the direct transport")
	}
	if connection.VerifiedDesktopTransport() {
		t.Fatal("revoked direct Desktop connection retained authority")
	}
}

func TestDirectDesktopConnectionRetainsVerifiedClientProcessForFormalAppAdmission(t *testing.T) {
	t.Parallel()

	process := ProcessTuple{
		OS: OSMacOS, PID: 4201,
		CreationMarker: "macos-start:100:200:pidversion:9",
		OSLoginSession: "macos-audit-session:77", SecurityPrincipal: "macos-uid:501",
		CanonicalExecutableIdentity: "macos-code:ai.nimi.apps.nimi.desktop:0123456789abcdef",
		CanonicalExecutablePath:     "/Applications/Nimi.app/Contents/MacOS/Nimi",
		ExecutableDigest:            identifierFilled(0x44), ExecutableTrustSetID: "macos-desktop-signed-code-v1",
	}
	connection, err := newDirectDesktopConnectionWithClient(DesktopPeerIdentity{
		OS: OSMacOS, PID: process.PID, UID: 501, AuditSession: 77,
	}, process, nil)
	if err != nil {
		t.Fatalf("establish direct Desktop connection with process evidence: %v", err)
	}
	t.Cleanup(connection.Revoke)

	retained, ok := connection.ClientProcess()
	if !ok || retained != process {
		t.Fatalf("direct Desktop process evidence = %+v ok=%v", retained, ok)
	}
}

func desktopPeers(boot Identifier) VerifiedDesktopPeers {
	return VerifiedDesktopPeers{
		Client: ProcessTuple{
			OS:                          OSWindows,
			PID:                         4101,
			CreationMarker:              "desktop-start-1",
			OSLoginSession:              "logon-9",
			SecurityPrincipal:           "interactive-user",
			CanonicalExecutableIdentity: "desktop-file-identity",
			ExecutableDigest:            identifierFilled(0x11),
			ExecutableTrustSetID:        "synthetic-desktop-test-trust-set",
		},
		Server: ProcessTuple{
			OS:                          OSWindows,
			PID:                         5101,
			CreationMarker:              "runtime-start-1",
			OSLoginSession:              "service-session",
			SecurityPrincipal:           "synthetic-runtime-test-principal",
			CanonicalExecutableIdentity: "runtime-file-identity",
			ExecutableDigest:            identifierFilled(0x12),
			ExecutableTrustSetID:        "synthetic-runtime-test-trust-set",
		},
		ClientLiveness:     newManualDesktopLiveness(),
		RuntimeBootEpoch:   boot,
		EndpointInstanceID: identifierFilled(0x13),
		TranscriptNonce:    identifierFilled(0x14),
	}
}

type manualDesktopLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newManualDesktopLiveness() *manualDesktopLiveness {
	return &manualDesktopLiveness{revoked: make(chan struct{})}
}

func (liveness *manualDesktopLiveness) Revoked() <-chan struct{} { return liveness.revoked }

func (liveness *manualDesktopLiveness) Close() error {
	liveness.revoke()
	return nil
}

func (liveness *manualDesktopLiveness) revoke() {
	liveness.once.Do(func() { close(liveness.revoked) })
}

func startedTestLedger(t *testing.T) (*Ledger, Identifier) {
	t.Helper()
	directory := t.TempDir()
	ledger, err := OpenLedger(context.Background(), testLedgerOptions(directory, newTestAnchorStore()))
	if err != nil {
		t.Fatalf("open anchored test ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	boot, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start anchored test runtime: %v", err)
	}
	return ledger, boot
}

func distinctIdentifierReader(first byte, count int) *bytes.Reader {
	blocks := make([][]byte, 0, count)
	for index := 0; index < count; index++ {
		blocks = append(blocks, bytes.Repeat([]byte{first + byte(index)}, IdentifierBytes))
	}
	return bytes.NewReader(bytes.Join(blocks, nil))
}

func identifierFilled(value byte) Identifier {
	var identifier Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}
