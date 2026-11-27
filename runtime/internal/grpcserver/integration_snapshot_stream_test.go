package grpcserver

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/integration"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

type integrationStreamTestAppService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	appID          string
	subject        string
	accountID      string
	sessionSeed    byte
	allowedDomains map[localappop.Domain]bool
	invalidated    chan struct{}
}

func (a *integrationStreamTestAppService) AdmitLocalAppIngress(_ context.Context, ingress localappop.Ingress) error {
	spec, err := localappop.ClassifyIngress(ingress)
	if err != nil || !a.allowedDomains[spec.Domain] {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	return nil
}

func (a *integrationStreamTestAppService) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	spec, err := localappop.ClassifyIngress(ingress)
	if err != nil || !a.allowedDomains[spec.Domain] {
		return ctx, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	var domains []string
	for d, allowed := range a.allowedDomains {
		if allowed {
			domains = append(domains, string(d))
		}
	}
	var sid accountservice.LocalAppSessionID
	for i := range sid {
		sid[i] = a.sessionSeed + byte(i)
	}
	decision := accountservice.LocalAppCallerDecision{
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		Operation:            spec.Operation,
		OperationCapability:  string(spec.Domain),
		ActivatedDomains:     strings.Join(domains, ","),
		AppID:                a.appID,
		TrustClass:           accountservice.LocalAppTrustClassVerified,
		AccountID:            a.accountID,
		RegisteredAppSubject: a.subject,
		SessionID:            sid,
		SessionInvalidated:   a.invalidated,
		ExpiresAt:            time.Now().UTC().Add(time.Hour),
	}
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
}

type integrationStreamTestRevalidator struct{}

func (integrationStreamTestRevalidator) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	d, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || ctx.Err() != nil || !time.Now().Before(d.ExpiresAt) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	if d.SessionInvalidated != nil {
		select {
		case <-d.SessionInvalidated:
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
		default:
		}
	}
	spec, err := localappop.ClassifyIngress(ingress)
	if err != nil {
		return nil, err
	}
	d.Operation = spec.Operation
	d.OperationCapability = string(spec.Domain)
	return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, d), nil
}

func (r integrationStreamTestRevalidator) CommitLocalAppIngress(ctx context.Context, ingress localappop.Ingress, commit func(context.Context) error) error {
	authorized, err := r.AuthorizeLocalAppIngress(ctx, ingress)
	if err != nil {
		return err
	}
	return commit(authorized)
}

func (r integrationStreamTestRevalidator) CommitLocalAppProviderCompletion(consumer, provider context.Context, commit func(context.Context, context.Context) error) error {
	p, err := r.AuthorizeLocalAppIngress(provider, localappop.IngressIntegrationProviderComplete)
	if err != nil {
		return err
	}
	return r.CommitLocalAppIngress(consumer, localappop.IngressIntegrationCallInvoke, func(c context.Context) error { return commit(c, p) })
}

func TestProtectedLocalAppIntegrationSnapshotStreamAdmissionAndLifecycle(t *testing.T) {
	if !protectedLocalAppStreamMethodAllowed(protectedIntegrationSnapshotsMethod) {
		t.Fatal("SubscribeIntegrationSnapshots must be admitted on the protected local-app stream policy table")
	}
	if protectedLocalAppUnaryMethodAllowed(protectedIntegrationSnapshotsMethod) {
		t.Fatal("SubscribeIntegrationSnapshots must not remain registered on the protected local-app unary policy table")
	}

	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	audit, err := auditlog.Open(backend, nil, 1000, 10)
	if err != nil {
		t.Fatalf("open audit: %v", err)
	}
	integrationSvc, err := integration.New(integration.Options{
		Backend:          backend,
		Audit:            audit,
		Revalidator:      integrationStreamTestRevalidator{},
		DesktopTransport: func(context.Context) bool { return false },
	})
	if err != nil {
		t.Fatalf("new integration service: %v", err)
	}
	t.Cleanup(func() { _ = integrationSvc.Close() })

	dialProtected := func(t *testing.T, appSvc *integrationStreamTestAppService, seed byte, bindSession bool) (runtimev1.RuntimeIntegrationServiceClient, *protectedlocal.LocalAppConnection) {
		t.Helper()
		connection := newGRPCLocalAppConnection(t, seed)
		if bindSession {
			if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
				SessionID:    grpcLocalAppIdentifier(seed + 1),
				SessionProof: grpcLocalAppIdentifier(seed + 2),
			}); err != nil {
				t.Fatal(err)
			}
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
		runtimev1.RegisterRuntimeIntegrationServiceServer(server, integrationSvc)
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
			"passthrough:///protected-integration-snapshot-test",
			grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		if err != nil {
			t.Fatalf("dial protected local-app server: %v", err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		return runtimev1.NewRuntimeIntegrationServiceClient(conn), connection
	}

	const accountID = "acct-snapshot-stream"
	providerClient, _ := dialProtected(t, &integrationStreamTestAppService{
		appID:          "app.provider",
		subject:        "sub-provider",
		accountID:      accountID,
		sessionSeed:    0x20,
		allowedDomains: map[localappop.Domain]bool{"integration.provide": true},
	}, 0x20, true)

	snapshotRead := true
	registered, err := providerClient.RegisterIntegrationProvider(context.Background(), &runtimev1.RegisterIntegrationProviderRequest{
		IntegrationId: "live-progress",
		DisplayName:   "PC Progress Provider",
		Operations: []*runtimev1.IntegrationOperation{{
			Name:             "session.progress",
			Description:      "Observe live progress",
			InputSchemaJson:  `{"type":"object","properties":{"session":{"type":"string"}},"required":["session"]}`,
			OutputSchemaJson: `{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}`,
			Effect:           "read",
			RetryPolicy:      "none",
			SnapshotRead:     &snapshotRead,
		}},
	})
	if err != nil {
		t.Fatalf("RegisterIntegrationProvider: %v", err)
	}
	targetRef := registered.GetTarget().GetTargetRef()

	opsJSON, _ := json.Marshal([]string{"session.progress"})
	if _, err := backend.DB().Exec(
		`INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?)`,
		accountID, "sub-consumer-ok", targetRef, string(opsJSON),
	); err != nil {
		t.Fatalf("grant consumer permission: %v", err)
	}

	// 1. Authorized installed App with integration.consume receives initial snapshot and can cleanly cancel.
	consumerClient, _ := dialProtected(t, &integrationStreamTestAppService{
		appID:          "app.consumer.ok",
		subject:        "sub-consumer-ok",
		accountID:      accountID,
		sessionSeed:    0x40,
		allowedDomains: map[localappop.Domain]bool{"integration.consume": true},
	}, 0x40, true)

	streamCtx, cancelStream := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancelStream()
	stream, err := consumerClient.SubscribeIntegrationSnapshots(streamCtx, &runtimev1.SubscribeIntegrationSnapshotsRequest{
		TargetRef: targetRef,
		Operation: "session.progress",
		InputJson: `{"session":"s1"}`,
	})
	if err != nil {
		t.Fatalf("SubscribeIntegrationSnapshots open: %v", err)
	}

	providerDone := make(chan error, 1)
	go func() {
		polled, pollErr := providerClient.PollIntegrationProvider(context.Background(), &runtimev1.PollIntegrationProviderRequest{WaitMs: 3000})
		if pollErr != nil {
			providerDone <- pollErr
			return
		}
		if len(polled.GetCalls()) != 1 {
			providerDone <- status.Errorf(codes.Internal, "expected 1 snapshot poll call, got %d", len(polled.GetCalls()))
			return
		}
		call := polled.GetCalls()[0]
		_, completeErr := providerClient.CompleteIntegrationProvider(context.Background(), &runtimev1.CompleteIntegrationProviderRequest{
			CallId:     call.GetCallId(),
			ResultJson: `{"text":"initial-frame"}`,
		})
		providerDone <- completeErr
	}()

	frame, err := stream.Recv()
	if err != nil {
		t.Fatalf("authorized consumer Recv failed: %v", err)
	}
	if frame.GetResultJson() != `{"text":"initial-frame"}` || frame.GetCursor() == "" {
		t.Fatalf("unexpected initial snapshot frame: %+v", frame)
	}
	if providerErr := <-providerDone; providerErr != nil {
		t.Fatalf("provider completion failed: %v", providerErr)
	}
	cancelStream()
	if _, recvErr := stream.Recv(); status.Code(recvErr) != codes.Canceled {
		t.Fatalf("expected Canceled after consumer cancel, got: %v", recvErr)
	}

	// 2. Installed App lacking integration.consume is rejected by the stream interceptor.
	unauthorizedClient, _ := dialProtected(t, &integrationStreamTestAppService{
		appID:          "app.consumer.no-scope",
		subject:        "sub-consumer-no-scope",
		accountID:      accountID,
		sessionSeed:    0x60,
		allowedDomains: map[localappop.Domain]bool{"app.storage": true},
	}, 0x60, true)
	unauthStream, err := unauthorizedClient.SubscribeIntegrationSnapshots(context.Background(), &runtimev1.SubscribeIntegrationSnapshotsRequest{
		TargetRef: targetRef,
		Operation: "session.progress",
		InputJson: `{"session":"s1"}`,
	})
	if err == nil {
		_, err = unauthStream.Recv()
	}
	if status.Code(err) != codes.PermissionDenied || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("unauthorized app snapshot stream = code:%s reason:%v err:%v", status.Code(err), localAppTransportReason(err), err)
	}

	// 3. Revoked / unbound local-app session is rejected by the stream interceptor.
	revokedClient, _ := dialProtected(t, &integrationStreamTestAppService{
		appID:          "app.consumer.revoked",
		subject:        "sub-consumer-ok",
		accountID:      accountID,
		sessionSeed:    0x80,
		allowedDomains: map[localappop.Domain]bool{"integration.consume": true},
	}, 0x80, false)
	revokedStream, err := revokedClient.SubscribeIntegrationSnapshots(context.Background(), &runtimev1.SubscribeIntegrationSnapshotsRequest{
		TargetRef: targetRef,
		Operation: "session.progress",
		InputJson: `{"session":"s1"}`,
	})
	if err == nil {
		_, err = revokedStream.Recv()
	}
	if status.Code(err) != codes.Unauthenticated || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("revoked session snapshot stream = code:%s reason:%v err:%v", status.Code(err), localAppTransportReason(err), err)
	}
}
