package grpcserver

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestProtectedDesktopRPCTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer serverSide.Close()
	defer clientSide.Close()
	if _, _, err := newProtectedDesktopTransportCredentials().ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected Desktop transport handshake")
	}
}

func TestNativeVerifiedDesktopListenerRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer clientSide.Close()
	listener := &nativeVerifiedDesktopListener{Listener: &protectedDesktopOneShotListener{connection: serverSide}}
	accepted, err := listener.Accept()
	if accepted != nil {
		_ = accepted.Close()
		t.Fatal("ordinary net.Conn was promoted to a verified native Desktop connection")
	}
	if err == nil {
		t.Fatal("ordinary net.Conn passed native verified Desktop listener")
	}
}

func TestProtectedDesktopProductControlAdmitsExactDependencyJobControls(t *testing.T) {
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob",
		"/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency",
	} {
		role, allowed := protectedDesktopMethodRole(method)
		if !allowed || role != protectedlocal.RoleVerifiedDesktopProcess {
			t.Fatalf("dependency job method %q role = %q allowed=%v", method, role, allowed)
		}
	}
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeLocalService/ImportLocalAsset",
		"/nimi.runtime.v1.RuntimeLocalService/InstallLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/StartEngine",
	} {
		if _, allowed := protectedDesktopMethodRole(method); allowed {
			t.Fatalf("unrelated RuntimeLocalService method %q escaped the exact protected allowlist", method)
		}
	}
}

func TestProtectedDesktopRuntimeConsumerAdmitsExactUnarySet(t *testing.T) {
	admitted := []string{
		"/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets",
		"/nimi.runtime.v1.RuntimeLocalService/ListNodeCatalog",
		"/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth",
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectors",
		"/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth",
		"/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth",
		"/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents",
		"/nimi.runtime.v1.RuntimeAuditService/ListUsageStats",
		"/nimi.runtime.v1.RuntimeAiService/PeekScheduling",
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAgentService/ListAgents",
	}
	for _, method := range admitted {
		if !protectedDesktopRuntimeConsumerMethod(method) {
			t.Fatalf("Desktop Runtime consumer method %q is missing from the exact classifier", method)
		}
		role, allowed := protectedDesktopMethodRole(method)
		if !allowed || role != protectedlocal.RoleVerifiedDesktopProcess {
			t.Fatalf("Desktop Runtime consumer method %q role = %q allowed=%v", method, role, allowed)
		}
		if !protectedDesktopUnaryMethodAllowed(method) {
			t.Fatalf("Desktop Runtime consumer unary %q was not admitted", method)
		}
	}

	excluded := []string{
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels",
		"/nimi.runtime.v1.RuntimeAuditService/ListAuditEvents",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents",
		"/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord",
	}
	for _, method := range excluded {
		if protectedDesktopRuntimeConsumerMethod(method) {
			t.Fatalf("unadmitted method %q escaped the exact Desktop Runtime consumer classifier", method)
		}
	}
	for _, method := range excluded[2:5] {
		if protectedDesktopStreamMethodAllowed(method) {
			t.Fatalf("unadmitted stream %q escaped the protected Desktop stream allowlist", method)
		}
	}
}

func TestProtectedDesktopRPCTransportBindsVerifiedConnectionAndGatesAdmittedServices(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	authService := authservice.NewWithDependencies(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		60,
		86400,
		authservice.WithDesktopSessionManager(manager),
	)
	accountService := &protectedDesktopAccountTestService{}
	auditService := &protectedDesktopAuditTestService{}
	localService := &protectedDesktopLocalTestService{}
	appService := &protectedDesktopAppTestService{}
	server := newProtectedDesktopRPCServer(
		&runtimev1.UnimplementedRuntimeServiceControlServiceServer{},
		authService,
		accountService,
		auditService,
		localService,
		&runtimev1.UnimplementedRuntimeAiServiceServer{},
		&runtimev1.UnimplementedRuntimeAgentServiceServer{},
		&runtimev1.UnimplementedRuntimeConnectorServiceServer{},
		appService,
		&runtimev1.UnimplementedRuntimeDevelopmentServiceServer{},
		manager,
	)
	for _, serviceName := range []string{
		"nimi.runtime.v1.RuntimeAuditService",
		"nimi.runtime.v1.RuntimeLocalService",
		"nimi.runtime.v1.RuntimeAiService",
		"nimi.runtime.v1.RuntimeAgentService",
		"nimi.runtime.v1.RuntimeConnectorService",
	} {
		if _, registered := server.GetServiceInfo()[serviceName]; !registered {
			t.Fatalf("protected Desktop server did not register %s", serviceName)
		}
	}
	baseListener := bufconn.Listen(1024 * 1024)
	listener := &protectedDesktopTestListener{Listener: baseListener, connection: connection}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = baseListener.Close()
		<-serveDone
	})

	clientConn, err := grpc.DialContext(
		context.Background(),
		"passthrough:///protected-desktop-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial protected Desktop transport: %v", err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })
	client := runtimev1.NewRuntimeAuthServiceClient(clientConn)
	accountClient := runtimev1.NewRuntimeAccountServiceClient(clientConn)
	auditClient := runtimev1.NewRuntimeAuditServiceClient(clientConn)
	localClient := runtimev1.NewRuntimeLocalServiceClient(clientConn)

	_, err = accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("account request without Desktop session reason = %v (present=%v), err=%v", reason, ok, err)
	}
	_, err = localClient.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("product-control request without Desktop session reason = %v (present=%v), err=%v", reason, ok, err)
	}
	_, err = auditClient.ListDesktopAuditEvents(context.Background(), &runtimev1.ListDesktopAuditEventsRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || auditService.projectionCalled {
		t.Fatalf("audit projection without Desktop session reason = %v (present=%v), called=%v err=%v", reason, ok, auditService.projectionCalled, err)
	}
	dependencyJobCallsWithoutSession := []struct {
		name string
		call func() error
	}{
		{name: "StartLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "CancelLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.CancelLocalEnvironmentDependencyJob(context.Background(), &runtimev1.CancelLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "RetryLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "RepairLocalEnvironmentDependency", call: func() error {
			_, callErr := localClient.RepairLocalEnvironmentDependency(context.Background(), &runtimev1.RepairLocalEnvironmentDependencyRequest{})
			return callErr
		}},
	}
	for _, call := range dependencyJobCallsWithoutSession {
		if callErr := call.call(); callErr == nil {
			t.Fatalf("%s without Desktop session unexpectedly succeeded", call.name)
		} else if reason, ok := grpcerr.ExtractReasonCode(callErr); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
			t.Fatalf("%s without Desktop session reason = %v (present=%v), err=%v", call.name, reason, ok, callErr)
		}
	}
	if localService.dependencyJobBound || localService.cancelDependencyJobBound || localService.retryDependencyJobBound || localService.repairDependencyJobBound {
		t.Fatalf("dependency job handler ran before Desktop session: start=%v cancel=%v retry=%v repair=%v", localService.dependencyJobBound, localService.cancelDependencyJobBound, localService.retryDependencyJobBound, localService.repairDependencyJobBound)
	}

	response, err := client.OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{})
	if err != nil {
		t.Fatalf("OpenDesktopSession over protected transport: %v", err)
	}
	if len(response.GetDesktopSessionId()) != protectedlocal.IdentifierBytes || len(response.GetRuntimeBootEpoch()) != protectedlocal.IdentifierBytes {
		t.Fatalf("protected response lengths: session=%d epoch=%d", len(response.GetDesktopSessionId()), len(response.GetRuntimeBootEpoch()))
	}

	_, err = client.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("non-allowlisted protected RPC reason = %v (present=%v), err=%v", reason, ok, err)
	}
	statusResponse, err := accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if err != nil || statusResponse.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !accountService.statusBound {
		t.Fatalf("GetAccountSessionStatus protected carrier = (%+v, %v), bound=%v", statusResponse, err, accountService.statusBound)
	}
	productControlResponse, err := localClient.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	if err != nil || productControlResponse.GetJson() == "" || !localService.productControlBound {
		t.Fatalf("GetProductControlRecord protected carrier = (%+v, %v), bound=%v", productControlResponse, err, localService.productControlBound)
	}
	dependencyJobResponse, err := localClient.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cpu",
		DependencyFamily: "native-engine-package.llama",
		DependencyId:     "llama.cpp.package",
		SourceKind:       "managed",
		Confirmed:        true,
		ConsumerScope:    "llama.cpp.cpu",
	})
	if err != nil || dependencyJobResponse.GetJob().GetJobId() == "" || !localService.dependencyJobBound {
		t.Fatalf("StartLocalEnvironmentDependencyJob protected carrier = (%+v, %v), bound=%v", dependencyJobResponse, err, localService.dependencyJobBound)
	}
	cancelResponse, err := localClient.CancelLocalEnvironmentDependencyJob(context.Background(), &runtimev1.CancelLocalEnvironmentDependencyJobRequest{JobId: "dependency-job-protected"})
	if err != nil || cancelResponse.GetJob().GetJobId() == "" || !localService.cancelDependencyJobBound {
		t.Fatalf("CancelLocalEnvironmentDependencyJob protected carrier = (%+v, %v), bound=%v", cancelResponse, err, localService.cancelDependencyJobBound)
	}
	retryResponse, err := localClient.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{JobId: "dependency-job-protected", Confirmed: true})
	if err != nil || retryResponse.GetJob().GetJobId() == "" || !localService.retryDependencyJobBound {
		t.Fatalf("RetryLocalEnvironmentDependencyJob protected carrier = (%+v, %v), bound=%v", retryResponse, err, localService.retryDependencyJobBound)
	}
	repairResponse, err := localClient.RepairLocalEnvironmentDependency(context.Background(), &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey:   "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cpu",
		DependencyFamily: "native-engine-package.llama",
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
		ConsumerScope:    "llama.cpp.cpu",
	})
	if err != nil || repairResponse.GetJob().GetJobId() == "" || !localService.repairDependencyJobBound {
		t.Fatalf("RepairLocalEnvironmentDependency protected carrier = (%+v, %v), bound=%v", repairResponse, err, localService.repairDependencyJobBound)
	}
	_, err = localClient.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil || !localService.localAssetsCalled {
		t.Fatalf("ListLocalAssets protected carrier: called=%v err=%v", localService.localAssetsCalled, err)
	}
	projection, err := auditClient.ListDesktopAuditEvents(context.Background(), &runtimev1.ListDesktopAuditEventsRequest{})
	if err != nil || projection.GetNextPageToken() != "" || !auditService.projectionCalled {
		t.Fatalf("ListDesktopAuditEvents protected carrier: called=%v response=%+v err=%v", auditService.projectionCalled, projection, err)
	}
	_, err = auditClient.ListAuditEvents(context.Background(), &runtimev1.ListAuditEventsRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || auditService.rawCalled {
		t.Fatalf("raw ListAuditEvents escaped protected deny: reason=%v present=%v called=%v err=%v", reason, ok, auditService.rawCalled, err)
	}
	accountStream, err := accountClient.SubscribeAccountSessionEvents(context.Background(), &runtimev1.SubscribeAccountSessionEventsRequest{})
	if err != nil {
		t.Fatalf("SubscribeAccountSessionEvents protected carrier: %v", err)
	}
	if _, err := accountStream.Recv(); err != nil || !accountService.subscriptionBound {
		t.Fatalf("SubscribeAccountSessionEvents protected carrier = (%v), bound=%v", err, accountService.subscriptionBound)
	}
	_, err = accountClient.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || accountService.workspaceBindingCalled {
		t.Fatalf("workspace binding escaped protected deny-only posture: reason=%v present=%v called=%v err=%v", reason, ok, accountService.workspaceBindingCalled, err)
	}

	appClient := runtimev1.NewRuntimeAppServiceClient(clientConn)
	immutableCalls := []struct {
		name string
		call func() error
	}{
		{name: "PrepareAppLifecycleIntent", call: func() error {
			_, callErr := appClient.PrepareAppLifecycleIntent(context.Background(), &runtimev1.PrepareAppLifecycleIntentRequest{})
			return callErr
		}},
		{name: "GetAppLifecycleIntentStatus", call: func() error {
			_, callErr := appClient.GetAppLifecycleIntentStatus(context.Background(), &runtimev1.GetAppLifecycleIntentStatusRequest{})
			return callErr
		}},
		{name: "InstallApp", call: func() error {
			_, callErr := appClient.InstallApp(context.Background(), &runtimev1.InstallAppRequest{})
			return callErr
		}},
		{name: "UninstallApp", call: func() error {
			_, callErr := appClient.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{})
			return callErr
		}},
		{name: "GetAppInstallJob", call: func() error {
			_, callErr := appClient.GetAppInstallJob(context.Background(), &runtimev1.GetAppInstallJobRequest{})
			return callErr
		}},
		{name: "ListAppInstallJobs", call: func() error {
			_, callErr := appClient.ListAppInstallJobs(context.Background(), &runtimev1.ListAppInstallJobsRequest{})
			return callErr
		}},
		{name: "UpdateApp", call: func() error {
			_, callErr := appClient.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{})
			return callErr
		}},
		{name: "HealthRepairApp", call: func() error {
			_, callErr := appClient.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{})
			return callErr
		}},
	}
	for _, call := range immutableCalls {
		err := call.call()
		if status.Code(err) != codes.Unimplemented {
			t.Fatalf("%s protected carrier code = %v, want Unimplemented: %v", call.name, status.Code(err), err)
		}
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
			t.Fatalf("%s protected carrier reason = %v present=%v: %v", call.name, reason, ok, err)
		}
	}
	if appService.prepareBound || appService.statusBound || appService.installBound {
		t.Fatalf("immutable package methods reached handler: prepare=%v status=%v install=%v", appService.prepareBound, appService.statusBound, appService.installBound)
	}
	localAppLaunch, err := appClient.PrepareLocalAppLaunch(context.Background(), &runtimev1.PrepareLocalAppLaunchRequest{})
	if err != nil || localAppLaunch.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED || !appService.localAppLaunchBound {
		t.Fatalf("PrepareLocalAppLaunch protected carrier = (%+v, %v), bound=%v", localAppLaunch, err, appService.localAppLaunchBound)
	}
	if err := clientConn.Close(); err != nil {
		t.Fatalf("close protected Desktop client: %v", err)
	}
	revokedContext := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := manager.AuthorizeContext(revokedContext, protectedlocal.RoleDesktopAccountHost)
		if protectedlocal.IsReason(err, protectedlocal.ReasonDesktopProcessVerificationUnavailable) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("protected connection remained authorized after transport close: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

type protectedDesktopAccountTestService struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer
	statusBound            bool
	subscriptionBound      bool
	workspaceBindingCalled bool
}

type protectedDesktopAuditTestService struct {
	runtimev1.UnimplementedRuntimeAuditServiceServer
	projectionCalled bool
	rawCalled        bool
}

func (s *protectedDesktopAuditTestService) ListDesktopAuditEvents(context.Context, *runtimev1.ListDesktopAuditEventsRequest) (*runtimev1.ListDesktopAuditEventsResponse, error) {
	s.projectionCalled = true
	return &runtimev1.ListDesktopAuditEventsResponse{}, nil
}

func (s *protectedDesktopAuditTestService) ListAuditEvents(context.Context, *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	s.rawCalled = true
	return &runtimev1.ListAuditEventsResponse{}, nil
}

type protectedDesktopLocalTestService struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer
	productControlBound      bool
	dependencyJobBound       bool
	cancelDependencyJobBound bool
	retryDependencyJobBound  bool
	repairDependencyJobBound bool
	localAssetsCalled        bool
}

func (service *protectedDesktopLocalTestService) GetProductControlRecord(ctx context.Context, _ *runtimev1.GetProductControlRecordRequest) (*runtimev1.ProductControlProjectionJson, error) {
	_, service.productControlBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.ProductControlProjectionJson{Json: `{"state":"ready_for_use"}`}, nil
}

func (service *protectedDesktopLocalTestService) StartLocalEnvironmentDependencyJob(ctx context.Context, _ *runtimev1.StartLocalEnvironmentDependencyJobRequest) (*runtimev1.StartLocalEnvironmentDependencyJobResponse, error) {
	_, service.dependencyJobBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.StartLocalEnvironmentDependencyJobResponse{
		Job: &runtimev1.LocalEnvironmentDependencyJob{JobId: "dependency-job-protected"},
	}, nil
}

func (service *protectedDesktopLocalTestService) CancelLocalEnvironmentDependencyJob(ctx context.Context, _ *runtimev1.CancelLocalEnvironmentDependencyJobRequest) (*runtimev1.CancelLocalEnvironmentDependencyJobResponse, error) {
	_, service.cancelDependencyJobBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.CancelLocalEnvironmentDependencyJobResponse{
		Job: &runtimev1.LocalEnvironmentDependencyJob{JobId: "dependency-job-canceled"},
	}, nil
}

func (service *protectedDesktopLocalTestService) RetryLocalEnvironmentDependencyJob(ctx context.Context, _ *runtimev1.RetryLocalEnvironmentDependencyJobRequest) (*runtimev1.RetryLocalEnvironmentDependencyJobResponse, error) {
	_, service.retryDependencyJobBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.RetryLocalEnvironmentDependencyJobResponse{
		Job: &runtimev1.LocalEnvironmentDependencyJob{JobId: "dependency-job-retried"},
	}, nil
}

func (service *protectedDesktopLocalTestService) RepairLocalEnvironmentDependency(ctx context.Context, _ *runtimev1.RepairLocalEnvironmentDependencyRequest) (*runtimev1.RepairLocalEnvironmentDependencyResponse, error) {
	_, service.repairDependencyJobBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.RepairLocalEnvironmentDependencyResponse{
		Job: &runtimev1.LocalEnvironmentDependencyJob{JobId: "dependency-job-repaired"},
	}, nil
}

func (service *protectedDesktopLocalTestService) ListLocalAssets(context.Context, *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error) {
	service.localAssetsCalled = true
	return &runtimev1.ListLocalAssetsResponse{}, nil
}

func (service *protectedDesktopAccountTestService) GetAccountSessionStatus(ctx context.Context, _ *runtimev1.GetAccountSessionStatusRequest) (*runtimev1.GetAccountSessionStatusResponse, error) {
	_, service.statusBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.GetAccountSessionStatusResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAccountTestService) SubscribeAccountSessionEvents(_ *runtimev1.SubscribeAccountSessionEventsRequest, stream runtimev1.RuntimeAccountService_SubscribeAccountSessionEventsServer) error {
	_, service.subscriptionBound = protectedlocal.DesktopConnectionFromContext(stream.Context())
	return stream.Send(&runtimev1.AccountSessionEvent{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED})
}

func (service *protectedDesktopAccountTestService) IssueWorkspaceBinding(context.Context, *runtimev1.IssueWorkspaceBindingRequest) (*runtimev1.IssueWorkspaceBindingResponse, error) {
	service.workspaceBindingCalled = true
	return &runtimev1.IssueWorkspaceBindingResponse{}, nil
}

type protectedDesktopAppTestService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	prepareBound        bool
	statusBound         bool
	installBound        bool
	localAppLaunchBound bool
}

func (service *protectedDesktopAppTestService) PrepareAppLifecycleIntent(ctx context.Context, _ *runtimev1.PrepareAppLifecycleIntentRequest) (*runtimev1.PrepareAppLifecycleIntentResponse, error) {
	_, service.prepareBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.PrepareAppLifecycleIntentResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAppTestService) GetAppLifecycleIntentStatus(ctx context.Context, _ *runtimev1.GetAppLifecycleIntentStatusRequest) (*runtimev1.GetAppLifecycleIntentStatusResponse, error) {
	_, service.statusBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.GetAppLifecycleIntentStatusResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (service *protectedDesktopAppTestService) InstallApp(ctx context.Context, _ *runtimev1.InstallAppRequest) (*runtimev1.InstallAppResponse, error) {
	_, service.installBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.InstallAppResponse{}, nil
}

func (service *protectedDesktopAppTestService) PrepareLocalAppLaunch(ctx context.Context, _ *runtimev1.PrepareLocalAppLaunchRequest) (*runtimev1.PrepareLocalAppLaunchResponse, error) {
	_, service.localAppLaunchBound = protectedlocal.DesktopConnectionFromContext(ctx)
	return &runtimev1.PrepareLocalAppLaunchResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

type protectedDesktopTestListener struct {
	*bufconn.Listener
	connection *protectedlocal.Connection
}

func (listener *protectedDesktopTestListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return wrapProtectedDesktopNetConn(connection, listener.connection), nil
}

type protectedDesktopOneShotListener struct {
	connection net.Conn
	closed     bool
}

func (listener *protectedDesktopOneShotListener) Accept() (net.Conn, error) {
	if listener.closed || listener.connection == nil {
		return nil, net.ErrClosed
	}
	listener.closed = true
	return listener.connection, nil
}

func (listener *protectedDesktopOneShotListener) Close() error {
	listener.closed = true
	if listener.connection == nil {
		return nil
	}
	return listener.connection.Close()
}

func (*protectedDesktopOneShotListener) Addr() net.Addr {
	return protectedDesktopTestAddress("ordinary-test-listener")
}

type protectedDesktopTestAddress string

func (address protectedDesktopTestAddress) Network() string { return "protected-desktop-test" }
func (address protectedDesktopTestAddress) String() string  { return string(address) }

type protectedRPCFixtureLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *protectedRPCFixtureLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *protectedRPCFixtureLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

type protectedRPCFixtureVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier protectedRPCFixtureVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

func newProtectedRPCFixture(t *testing.T) (*protectedlocal.DesktopSessionManager, *protectedlocal.Connection) {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(
		filepath.Join(directory, "protected_local.anchor"),
		bytes.Repeat([]byte{0xc1}, protectedlocal.IdentifierBytes),
	)
	if err != nil {
		t.Fatalf("new protected transport anchor: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0xc2}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open protected transport ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	bootEpoch, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start protected transport Runtime: %v", err)
	}
	manager, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader)
	if err != nil {
		t.Fatalf("new protected transport session manager: %v", err)
	}
	liveness := &protectedRPCFixtureLiveness{revoked: make(chan struct{})}
	connection, err := protectedlocal.EstablishDesktopConnection(context.Background(), protectedRPCFixtureVerifier{peers: protectedlocal.VerifiedDesktopPeers{
		Client: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         7301,
			CreationMarker:              "protected-transport-desktop",
			OSLoginSession:              "protected-transport-logon",
			SecurityPrincipal:           "protected-transport-user",
			CanonicalExecutableIdentity: "protected-transport-desktop-file",
			ExecutableDigest:            protectedTestIdentifier(0xc3),
			ExecutableTrustSetID:        "nimi-desktop-protected-transport-test-v1",
		},
		Server: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         8301,
			CreationMarker:              "protected-transport-runtime",
			OSLoginSession:              "service-session-0",
			SecurityPrincipal:           "NT SERVICE/NimiRuntimeProtectedTransportTest",
			CanonicalExecutableIdentity: "protected-transport-runtime-file",
			ExecutableDigest:            protectedTestIdentifier(0xc4),
			ExecutableTrustSetID:        "nimi-runtime-protected-transport-test-v1",
		},
		ClientLiveness:     liveness,
		RuntimeBootEpoch:   bootEpoch,
		EndpointInstanceID: protectedTestIdentifier(0xc5),
		TranscriptNonce:    protectedTestIdentifier(0xc6),
	}}, rand.Reader)
	if err != nil {
		t.Fatalf("establish protected transport connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return manager, connection
}

func protectedTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

var _ net.Listener = (*protectedDesktopTestListener)(nil)
