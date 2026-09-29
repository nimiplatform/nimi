package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func transportRefusalRecords(t *testing.T, store *auditlog.Store) []*runtimev1.AuditEventRecord {
	t.Helper()
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: transportRefusalDomain, PageSize: 200})
	if err != nil {
		t.Fatal(err)
	}
	return response.GetEvents()
}

func dialTestTransport(t *testing.T, server *grpc.Server, listener net.Listener, dial func() (net.Conn, error)) *grpc.ClientConn {
	t.Helper()
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = listener.Close()
		<-serveDone
	})
	clientConn, err := grpc.NewClient("passthrough:///protected-refusal-audit-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })
	return clientConn
}

func TestProtectedDesktopChainRecordsOnlyTransportRefusals(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	audit := auditlog.New(256, 16)
	authService := authservice.NewWithDependencies(slog.New(slog.NewTextHandler(io.Discard, nil)), audit, 60, 86400, authservice.WithDesktopSessionManager(manager))
	accountService := &protectedDesktopAccountTestService{}
	server := newProtectedDesktopRPCServer(
		&protectedDesktopRuntimeControlTestService{}, authService, accountService,
		&runtimev1.UnimplementedRuntimeRealmRealtimeServiceServer{}, &protectedDesktopAuditTestService{},
		&protectedDesktopLocalTestService{}, &protectedDesktopVideoAITestService{},
		&runtimev1.UnimplementedRuntimeAgentServiceServer{}, &runtimev1.UnimplementedRuntimeConnectorServiceServer{},
		&runtimev1.UnimplementedRuntimeExternalAgentServiceServer{}, &protectedDesktopAppTestService{},
		&runtimev1.UnimplementedRuntimeDevelopmentServiceServer{}, &runtimev1.UnimplementedRuntimeArtifactServiceServer{},
		manager, accountService, nil, &recordingFormalAppAdmission{}, newActiveRPCRegistry(nil), newTransportRefusalAudit(audit, transportDesktop),
	)
	baseListener := bufconn.Listen(1024 * 1024)
	clientConn := dialTestTransport(t, server, &protectedDesktopTestListener{Listener: baseListener, connection: connection}, baseListener.Dial)
	accountClient := runtimev1.NewRuntimeAccountServiceClient(clientConn)

	// A session-less call is refused by the chain; repeats within the window
	// are counted into one record rather than logged per RPC.
	for attempt := 0; attempt < 3; attempt++ {
		_, err := accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
			t.Fatalf("session-less call = %v", err)
		}
	}
	records := transportRefusalRecords(t, audit)
	if len(records) != 1 {
		t.Fatalf("transport refusal records = %v", records)
	}
	refusal := records[0]
	fields := refusal.GetPayload().GetFields()
	if refusal.GetOperation() != "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus" ||
		refusal.GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH ||
		refusal.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE || refusal.GetAppId() != "nimi.desktop" ||
		fields["transport"].GetStringValue() != transportDesktop || fields["stage"].GetStringValue() != transportRefusalStageRPC {
		t.Fatalf("Desktop refusal record = %v", refusal)
	}

	// Admitted calls are recorded only by their owners.
	if _, err := runtimev1.NewRuntimeAuthServiceClient(clientConn).OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{}); err != nil {
		t.Fatal(err)
	}
	if records := transportRefusalRecords(t, audit); len(records) != 1 {
		t.Fatalf("admitted calls produced transport records: %v", records)
	}
	owner, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.auth", PageSize: 10})
	if err != nil || len(owner.GetEvents()) != 1 || owner.GetEvents()[0].GetOperation() != "OpenDesktopSession" {
		t.Fatalf("owner session records = %v err=%v", owner, err)
	}
}

func TestProtectedLocalAppChainRecordsOnlyTransportRefusals(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x5a)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x5b), SessionProof: grpcLocalAppIdentifier(0x5c)}); err != nil {
		t.Fatal(err)
	}
	audit := auditlog.New(256, 16)
	appService := &protectedLocalAppAdmissionServer{}
	server := newProtectedLocalAppRPCServer(
		&runtimev1.UnimplementedRuntimeServiceControlServiceServer{}, &protectedLocalAppRootHandoffAuthService{},
		&runtimev1.UnimplementedRuntimeAccountServiceServer{}, &runtimev1.UnimplementedRuntimeRealmRealtimeServiceServer{},
		&runtimev1.UnimplementedRuntimeLocalServiceServer{}, &runtimev1.UnimplementedRuntimeAiServiceServer{},
		&runtimev1.UnimplementedRuntimeAgentServiceServer{}, appService, newActiveRPCRegistry(nil), newTransportRefusalAudit(audit, transportLocalApp),
	)
	baseListener := bufconn.Listen(1024 * 1024)
	clientConn := dialTestTransport(t, server, &protectedLocalAppTestListener{Listener: baseListener, connection: connection}, baseListener.Dial)
	appClient := runtimev1.NewRuntimeAppServiceClient(clientConn)

	// An admitted call reaches its owner and is not a transport record.
	if _, err := appClient.ReadLocalAppStorageJson(context.Background(), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}); grpcCode(err) != codes.Unimplemented {
		t.Fatalf("admitted call = %v", err)
	}
	if records := transportRefusalRecords(t, audit); len(records) != 0 {
		t.Fatalf("admitted call produced transport records: %v", records)
	}

	appService.err = grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	for attempt := 0; attempt < 4; attempt++ {
		if _, err := appClient.ReadLocalAppStorageJson(context.Background(), &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}); grpcCode(err) != codes.PermissionDenied {
			t.Fatalf("denied call = %v", err)
		}
	}
	// A method outside the chain's policy is refused before admission.
	if _, err := appClient.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{}); grpcCode(err) != codes.PermissionDenied {
		t.Fatalf("unadmitted method = %v", err)
	}
	records := transportRefusalRecords(t, audit)
	if len(records) != 2 {
		t.Fatalf("local-app refusal records = %v", records)
	}
	byOperation := map[string]*runtimev1.AuditEventRecord{}
	for _, record := range records {
		byOperation[record.GetOperation()] = record
	}
	denied := byOperation[protectedReadLocalAppStorageJSONMethod]
	if denied == nil || denied.GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED ||
		denied.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP ||
		denied.GetPayload().GetFields()["trust_class"].GetStringValue() != string(protectedlocal.LocalAppTrustLocalDevelopment) {
		t.Fatalf("admission refusal record = %v", denied)
	}
	if outside := byOperation["/nimi.runtime.v1.RuntimeAppService/SendAppMessage"]; outside == nil || outside.GetReasonCode() != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("policy refusal record = %v", outside)
	}
}

func TestTransportRefusalAuditIgnoresCancellation(t *testing.T) {
	audit := newTransportRefusalAudit(auditlog.New(64, 16), transportLocalApp)
	audit.record(context.Background(), "/nimi.runtime.v1.RuntimeAppService/Canceled", transportRefusalStageRPC, context.Canceled)
	audit.record(context.Background(), "/nimi.runtime.v1.RuntimeAppService/Deadline", transportRefusalStageRPC, grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE))
	if records := transportRefusalRecords(t, audit.store); len(records) != 0 {
		t.Fatalf("cancellation was recorded as a refusal: %v", records)
	}
	// A caller-chosen method name stays inside the audit filter alphabet.
	if got := boundedMethod("/pkg.Service/Bad Method\x00"); got != "invalid:24" {
		t.Fatalf("bounded method = %q", got)
	}
	if got := boundedMethod("/" + strings.Repeat("a", 300)); len(got) != 128 {
		t.Fatalf("bounded method length = %d", len(got))
	}
}

func TestTransportHandshakeRefusalIsRecordedUnattributed(t *testing.T) {
	audit := auditlog.New(64, 16)
	refusals := newTransportRefusalAudit(audit, transportLocalApp)
	serverSide, clientSide := net.Pipe()
	t.Cleanup(func() { _ = serverSide.Close(); _ = clientSide.Close() })
	if _, _, err := (protectedLocalAppTransportCredentials{refusals: refusals}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary connection passed the protected local-app handshake")
	}
	records := transportRefusalRecords(t, audit)
	if len(records) != 1 || records[0].GetOperation() != "connection" || records[0].GetAppId() != "" ||
		records[0].GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED ||
		records[0].GetReasonCode() != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH ||
		records[0].GetPayload().GetFields()["stage"].GetStringValue() != transportRefusalStageHandshake {
		t.Fatalf("handshake refusal records = %v", records)
	}
}

func grpcCode(err error) codes.Code {
	return status.Code(err)
}
