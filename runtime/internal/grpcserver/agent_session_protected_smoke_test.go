package grpcserver

import (
	"context"
	"net"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	agentsessionservice "github.com/nimiplatform/nimi/runtime/internal/services/agentsession"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

type smokeLocalAppAppService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	appID          string
	accountID      string
	trustClass     accountservice.LocalAppTrustClass
	allowedDomains map[localappop.Domain]bool
}

func (a *smokeLocalAppAppService) AdmitLocalAppIngress(_ context.Context, ingress localappop.Ingress) error {
	spec, err := localappop.ClassifyIngress(ingress)
	if err != nil || !a.allowedDomains[spec.Domain] {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	return nil
}

func (a *smokeLocalAppAppService) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	spec, err := localappop.ClassifyIngress(ingress)
	if err != nil || !a.allowedDomains[spec.Domain] {
		return ctx, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	decision := accountservice.LocalAppCallerDecision{
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		Operation:            spec.Operation,
		OperationCapability:  string(spec.Domain),
		AppID:                a.appID,
		TrustClass:           a.trustClass,
		AccountID:            a.accountID,
		RegisteredAppSubject: "subject-" + a.appID,
		ExpiresAt:            time.Now().UTC().Add(time.Hour),
	}
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
}

func TestProtectedLocalAppAgentSessionCoreHarnessAndOrdinaryAppRejection(t *testing.T) {
	agentSessionSvc := agentsessionservice.New(agentsessionservice.Options{})

	dialProtected := func(t *testing.T, appSvc *smokeLocalAppAppService, seed byte) runtimev1.AgentSessionServiceClient {
		t.Helper()
		connection := newGRPCLocalAppConnection(t, seed)
		if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
			SessionID:    grpcLocalAppIdentifier(seed + 1),
			SessionProof: grpcLocalAppIdentifier(seed + 2),
		}); err != nil {
			t.Fatal(err)
		}
		server := newProtectedLocalAppRPCServer(
			&runtimev1.UnimplementedRuntimeServiceControlServiceServer{},
			&runtimev1.UnimplementedRuntimeAuthServiceServer{},
			&runtimev1.UnimplementedRuntimeAccountServiceServer{},
			&runtimev1.UnimplementedRuntimeRealmRealtimeServiceServer{},
			&runtimev1.UnimplementedRuntimeLocalServiceServer{},
			&runtimev1.UnimplementedRuntimeAiServiceServer{},
			&runtimev1.UnimplementedRuntimeAgentServiceServer{},
			appSvc,
			newActiveRPCRegistry(nil),
			nil,
		)
		runtimev1.RegisterAgentSessionServiceServer(server, agentSessionSvc)

		baseListener := bufconn.Listen(1024 * 1024)
		listener := &protectedLocalAppTestListener{Listener: baseListener, connection: connection}
		serveDone := make(chan error, 1)
		go func() { serveDone <- server.Serve(listener) }()
		t.Cleanup(func() {
			server.Stop()
			_ = baseListener.Close()
			_ = <-serveDone
		})
		conn, err := grpc.DialContext(
			context.Background(),
			"passthrough:///protected-agent-session-smoke",
			grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		if err != nil {
			t.Fatalf("dial protected local-app server: %v", err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		return runtimev1.NewAgentSessionServiceClient(conn)
	}

	// 1. Core Harness (BuiltIn) with agent.body.pc registers os.pc.workspace and subscribes to outbox.
	harnessClient := dialProtected(t, &smokeLocalAppAppService{
		appID:      "nimi.harness",
		accountID:  "acct-stage1",
		trustClass: accountservice.LocalAppTrustClassBuiltIn,
		allowedDomains: map[localappop.Domain]bool{
			localappop.Domain("agent.local"):   true,
			localappop.Domain("agent.body.pc"): true,
		},
	}, 0x40)

	regResp, err := harnessClient.RegisterBodyCarrier(context.Background(), &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "harness-proc-1",
	})
	if err != nil {
		t.Fatalf("core harness RegisterBodyCarrier failed: %v", err)
	}
	if regResp.GetLeaseEpoch() < 1 || regResp.GetCapabilityNamespace() != "os.pc.workspace" {
		t.Fatalf("unexpected RegisterBodyCarrier response: %+v", regResp)
	}

	streamCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	outboxStream, err := harnessClient.SubscribeBodyOutbox(streamCtx, &runtimev1.SubscribeBodyOutboxRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "os.pc.workspace",
		LeaseEpoch:          regResp.GetLeaseEpoch(),
	})
	if err != nil {
		t.Fatalf("core harness SubscribeBodyOutbox failed: %v", err)
	}
	go func() {
		time.Sleep(40 * time.Millisecond)
		agentSessionSvc.EnqueueBodyOutbox("acct-stage1", "win-dev-1", "os.pc.workspace", &runtimev1.BodyOutboxEnvelope{
			OutboxId:            "outbox-smoke-1",
			DeviceId:            "win-dev-1",
			CapabilityNamespace: "os.pc.workspace",
			WorkSessionRef:      "ws-smoke-1",
			CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT,
			PayloadJson:         `{"text":"hello harness"}`,
		})
	}()
	env, err := outboxStream.Recv()
	if err != nil {
		t.Fatalf("core harness SubscribeBodyOutbox Recv failed: %v", err)
	}
	if env.GetOutboxId() != "outbox-smoke-1" {
		t.Fatalf("unexpected outbox envelope: %+v", env)
	}

	// 2. Ordinary App WITHOUT agent.body.pc is rejected with LOCAL_APP_ACCESS_DENIED.
	ordinaryClient := dialProtected(t, &smokeLocalAppAppService{
		appID:     "com.thirdparty.notes",
		accountID: "acct-stage1",
		allowedDomains: map[localappop.Domain]bool{
			localappop.Domain("agent.local"): true,
		},
	}, 0x50)
	if _, err := ordinaryClient.RegisterBodyCarrier(context.Background(), &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "evil-1",
	}); localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("ordinary app RegisterBodyCarrier(os.pc.*) reason=%v err=%v", localAppTransportReason(err), err)
	}
	ordStream, err := ordinaryClient.SubscribeBodyOutbox(context.Background(), &runtimev1.SubscribeBodyOutboxRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "os.pc.workspace",
		LeaseEpoch:          1,
	})
	if err == nil {
		_, err = ordStream.Recv()
	}
	if localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("ordinary app SubscribeBodyOutbox(os.pc.*) reason=%v err=%v", localAppTransportReason(err), err)
	}

	// 3. Ordinary App WITH agent.body.app can bind app.<own_app_id>.*, but cannot hijack another app or os.pc.*.
	appBodyClient := dialProtected(t, &smokeLocalAppAppService{
		appID:     "com.thirdparty.notes",
		accountID: "acct-stage1",
		allowedDomains: map[localappop.Domain]bool{
			localappop.Domain("agent.body.app"): true,
		},
	}, 0x60)
	ownResp, err := appBodyClient.RegisterBodyCarrier(context.Background(), &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "app.com.thirdparty.notes.editor",
		InstanceId:          "notes-1",
	})
	if err != nil || ownResp.GetLeaseEpoch() < 1 {
		t.Fatalf("app.body own prefix failed: resp=%+v err=%v", ownResp, err)
	}
	if _, err := appBodyClient.RegisterBodyCarrier(context.Background(), &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "app.com.other.app.editor",
		InstanceId:          "notes-hijack",
	}); localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("app.body cross-app hijack must be denied: reason=%v err=%v", localAppTransportReason(err), err)
	}

	// 4. UserImported App spoofing app_id=nimi.harness MUST be rejected from os.pc.*!
	spoofHarnessClient := dialProtected(t, &smokeLocalAppAppService{
		appID:      "nimi.harness",
		accountID:  "acct-stage1",
		trustClass: accountservice.LocalAppTrustClassUserImported,
		allowedDomains: map[localappop.Domain]bool{
			localappop.Domain("agent.body.pc"): true,
		},
	}, 0x70)
	if _, err := spoofHarnessClient.RegisterBodyCarrier(context.Background(), &runtimev1.RegisterBodyCarrierRequest{
		DeviceId:            "win-dev-1",
		CapabilityNamespace: "os.pc.workspace",
		InstanceId:          "spoof-1",
	}); localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("user_imported app spoofing nimi.harness must be denied: reason=%v err=%v", localAppTransportReason(err), err)
	}
}
