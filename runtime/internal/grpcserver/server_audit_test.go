package grpcserver

import (
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/test/bufconn"
)

type capturedPeerRejections struct {
	observer protectedlocal.PeerRejectionObserver
}

func (source *capturedPeerRejections) SetPeerRejectionObserver(observer protectedlocal.PeerRejectionObserver) {
	source.observer = observer
}

func newProtectedAuditServerForTest(t *testing.T, serviceStateRoot string, productControlRoot string, consentStorePath string, source PeerRejectionSource) (*Server, protectedAuthoritiesForServerTest) {
	t.Helper()
	cfg := config.Config{
		GRPCAddr: "127.0.0.1:0", HTTPAddr: "127.0.0.1:0", ShutdownTimeout: 2 * time.Second,
		AuditRingBufferSize: 64, UsageStatsBufferSize: 64, IdempotencyCapacity: 32,
	}
	authorities := newProtectedAuthoritiesForServerTest(t)
	server, err := NewProtectedService(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test", ProtectedServiceBindings{
		ServiceStateRoot:                 serviceStateRoot,
		ProductControlRoot:               productControlRoot,
		RuntimeServiceSID:                protectedlocal.WindowsProductionServiceSID,
		RuntimeServiceUID:                450,
		LocalDevelopmentConsentStorePath: consentStorePath,
		AccountCustody:                   emptyProtectedAccountCustody{},
		AccountPartition:                 "verified-user-and-logon-session",
		LocalOSUserIdentity:              verifiedServerTestIdentity(t),
		ConnectorSecrets:                 emptyProtectedConnectorSecrets{},
		DesktopSessions:                  authorities.desktop,
		LocalAppLaunches:                 authorities.localApps,
		LocalDevelopmentVerifier:         serverTestLocalDevelopmentVerifier{},
		RuntimeRestartRequester:          func() bool { return true },
		PeerRejections:                   source,
	})
	if err != nil {
		t.Fatalf("construct protected Runtime: %v", err)
	}
	return server, authorities
}

// TestProtectedCompositionRecordsTransportRefusalsDurably drives the composed
// production protected Desktop chain and listener observer, then restarts the
// Runtime over the same service state and reads the records back.
func TestProtectedCompositionRecordsTransportRefusalsDurably(t *testing.T) {
	serviceStateRoot := t.TempDir()
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	consentStorePath := filepath.Join(t.TempDir(), "local-development.db")
	source := &capturedPeerRejections{}
	server, authorities := newProtectedAuditServerForTest(t, serviceStateRoot, productControlRoot, consentStorePath, source)
	stopped := false
	t.Cleanup(func() {
		if !stopped {
			_ = server.Stop(context.Background())
		}
	})
	if source.observer == nil {
		t.Fatal("protected composition did not install the listener refusal observer")
	}

	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), protectedRPCFixtureVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 7401, CreationMarker: "audit-composition-desktop", OSLoginSession: "audit-composition-logon",
			SecurityPrincipal: "audit-composition-user", CanonicalExecutableIdentity: "audit-composition-desktop-file",
			ExecutableDigest: protectedTestIdentifier(0xd3), ExecutableTrustSetID: "nimi-desktop-audit-composition-test-v1",
		},
		Server: protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 8401, CreationMarker: "audit-composition-runtime", OSLoginSession: "service-session-0",
			SecurityPrincipal: "NT SERVICE/NimiRuntimeAuditCompositionTest", CanonicalExecutableIdentity: "audit-composition-runtime-file",
			ExecutableDigest: protectedTestIdentifier(0xd4), ExecutableTrustSetID: "nimi-runtime-audit-composition-test-v1",
		},
		ClientLiveness:     &protectedRPCFixtureLiveness{revoked: make(chan struct{})},
		RuntimeBootEpoch:   authorities.desktop.BootEpoch(),
		EndpointInstanceID: protectedTestIdentifier(0xd5),
		TranscriptNonce:    protectedTestIdentifier(0xd6),
	}}, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	baseListener := bufconn.Listen(1024 * 1024)
	clientConn := dialTestTransport(t, server.protectedServer, &protectedDesktopTestListener{Listener: baseListener, connection: connection}, baseListener.Dial)
	if _, err := runtimev1.NewRuntimeAccountServiceClient(clientConn).GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{}); err == nil {
		t.Fatal("session-less protected call was admitted")
	} else if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("session-less protected call = %v", err)
	}
	source.observer(protectedlocal.PeerRejection{Transport: protectedlocal.PeerRejectionTransportDesktop, Stage: "desktop-process", Reason: protectedlocal.ReasonDesktopExecutableTrustFailed})
	source.observer(protectedlocal.PeerRejection{Transport: protectedlocal.PeerRejectionTransportLocalApp, Stage: "launch-lease"})

	stopped = true
	_ = server.Stop(context.Background())
	restarted, _ := newProtectedAuditServerForTest(t, serviceStateRoot, productControlRoot, consentStorePath, &capturedPeerRejections{})
	t.Cleanup(func() { _ = restarted.Stop(context.Background()) })
	response, err := restarted.AuditStore().ListEvents(&runtimev1.ListAuditEventsRequest{Domain: transportRefusalDomain, PageSize: 50})
	if err != nil {
		t.Fatal(err)
	}
	byOperation := map[string]*runtimev1.AuditEventRecord{}
	for _, event := range response.GetEvents() {
		byOperation[event.GetOperation()] = event
	}
	if len(byOperation) != 3 {
		t.Fatalf("restarted Runtime transport records = %v", response.GetEvents())
	}
	chain := byOperation["/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus"]
	if chain == nil || chain.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE || chain.GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("composed chain refusal = %v", chain)
	}
	desktopPeer := byOperation["connection:desktop-process"]
	if desktopPeer == nil || desktopPeer.GetReasonCode() != runtimev1.ReasonCode_DESKTOP_EXECUTABLE_TRUST_FAILED ||
		desktopPeer.GetAppId() != "" || desktopPeer.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED ||
		desktopPeer.GetPayload().GetFields()["stage"].GetStringValue() != transportRefusalStagePeer {
		t.Fatalf("Desktop listener refusal = %v", desktopPeer)
	}
	appPeer := byOperation["connection:launch-lease"]
	if appPeer == nil || appPeer.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH ||
		appPeer.GetPayload().GetFields()["transport"].GetStringValue() != transportLocalApp {
		t.Fatalf("local-app listener refusal = %v", appPeer)
	}
}
