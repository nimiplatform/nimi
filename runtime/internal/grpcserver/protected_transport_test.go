package grpcserver

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"log/slog"
	"net"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestProtectedDesktopRPCTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = serverSide.Close() }()
	defer func() { _ = clientSide.Close() }()
	if _, _, err := newProtectedDesktopTransportCredentials().ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected Desktop transport handshake")
	}
}

func TestNativeVerifiedDesktopListenerRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = clientSide.Close() }()
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
		"/nimi.runtime.v1.RuntimeLocalService/InstallLocalService",
		"/nimi.runtime.v1.RuntimeLocalService/StartEngine",
	} {
		if _, allowed := protectedDesktopMethodRole(method); allowed {
			t.Fatalf("unrelated RuntimeLocalService method %q escaped the exact protected allowlist", method)
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
		&runtimev1.UnimplementedRuntimeExternalAgentServiceServer{},
		appService,
		&runtimev1.UnimplementedRuntimeDevelopmentServiceServer{},
		&runtimev1.UnimplementedRuntimeArtifactServiceServer{},
		manager,
		accountService,
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
	machineContext := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		protectedFirstPartyProfileMetadata, protectedlocal.DesktopMachineProductNativeMarker,
		"x-nimi-app-id", envelope.ProtectedDesktopAppID,
	))

	_, err = accountClient.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("account request without Desktop session reason = %v (present=%v), err=%v", reason, ok, err)
	}
	_, err = localClient.GetProductControlRecord(machineContext, &runtimev1.GetProductControlRecordRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("product-control request without Desktop session reason = %v (present=%v), err=%v", reason, ok, err)
	}
	_, err = auditClient.ListDesktopAuditEvents(machineContext, &runtimev1.ListDesktopAuditEventsRequest{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH || auditService.projectionCalled {
		t.Fatalf("audit projection without Desktop session reason = %v (present=%v), called=%v err=%v", reason, ok, auditService.projectionCalled, err)
	}
	dependencyJobCallsWithoutSession := []struct {
		name string
		call func() error
	}{
		{name: "StartLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.StartLocalEnvironmentDependencyJob(machineContext, &runtimev1.StartLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "CancelLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.CancelLocalEnvironmentDependencyJob(machineContext, &runtimev1.CancelLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "RetryLocalEnvironmentDependencyJob", call: func() error {
			_, callErr := localClient.RetryLocalEnvironmentDependencyJob(machineContext, &runtimev1.RetryLocalEnvironmentDependencyJobRequest{})
			return callErr
		}},
		{name: "RepairLocalEnvironmentDependency", call: func() error {
			_, callErr := localClient.RepairLocalEnvironmentDependency(machineContext, &runtimev1.RepairLocalEnvironmentDependencyRequest{})
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
	productControlResponse, err := localClient.GetProductControlRecord(machineContext, &runtimev1.GetProductControlRecordRequest{})
	if err != nil || productControlResponse.GetJson() == "" || !localService.productControlBound {
		t.Fatalf("GetProductControlRecord protected carrier = (%+v, %v), bound=%v", productControlResponse, err, localService.productControlBound)
	}
	dependencyJobResponse, err := localClient.StartLocalEnvironmentDependencyJob(machineContext, &runtimev1.StartLocalEnvironmentDependencyJobRequest{
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
	cancelResponse, err := localClient.CancelLocalEnvironmentDependencyJob(machineContext, &runtimev1.CancelLocalEnvironmentDependencyJobRequest{JobId: "dependency-job-protected"})
	if err != nil || cancelResponse.GetJob().GetJobId() == "" || !localService.cancelDependencyJobBound {
		t.Fatalf("CancelLocalEnvironmentDependencyJob protected carrier = (%+v, %v), bound=%v", cancelResponse, err, localService.cancelDependencyJobBound)
	}
	retryResponse, err := localClient.RetryLocalEnvironmentDependencyJob(machineContext, &runtimev1.RetryLocalEnvironmentDependencyJobRequest{JobId: "dependency-job-protected", Confirmed: true})
	if err != nil || retryResponse.GetJob().GetJobId() == "" || !localService.retryDependencyJobBound {
		t.Fatalf("RetryLocalEnvironmentDependencyJob protected carrier = (%+v, %v), bound=%v", retryResponse, err, localService.retryDependencyJobBound)
	}
	repairResponse, err := localClient.RepairLocalEnvironmentDependency(machineContext, &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey:   "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cpu",
		DependencyFamily: "native-engine-package.llama",
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
		ConsumerScope:    "llama.cpp.cpu",
	})
	if err != nil || repairResponse.GetJob().GetJobId() == "" || !localService.repairDependencyJobBound {
		t.Fatalf("RepairLocalEnvironmentDependency protected carrier = (%+v, %v), bound=%v", repairResponse, err, localService.repairDependencyJobBound)
	}
	_, err = localClient.ListLocalAssets(machineContext, &runtimev1.ListLocalAssetsRequest{})
	if err != nil || !localService.localAssetsCalled {
		t.Fatalf("ListLocalAssets protected carrier: called=%v err=%v", localService.localAssetsCalled, err)
	}
	projection, err := auditClient.ListDesktopAuditEvents(machineContext, &runtimev1.ListDesktopAuditEventsRequest{})
	if err != nil || projection.GetNextPageToken() != "" || !auditService.projectionCalled || !auditService.authorizationDecisionBound {
		t.Fatalf("ListDesktopAuditEvents protected carrier: called=%v decision=%v response=%+v err=%v", auditService.projectionCalled, auditService.authorizationDecisionBound, projection, err)
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

type finalM1ProfileAdmissionCase struct {
	id        string
	method    string
	profileID string
	marker    string
	kind      protectedlocal.FirstPartyMethodKind
}

var finalM1ProfileAdmissionCases = []finalM1ProfileAdmissionCase{
	{"M01", "/nimi.runtime.v1.RuntimeLocalService/RemoveLocalAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M02", "/nimi.runtime.v1.RuntimeLocalService/StartLocalAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M03", "/nimi.runtime.v1.RuntimeLocalService/StopLocalAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M04", "/nimi.runtime.v1.RuntimeLocalService/ListVerifiedAssets", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M05", "/nimi.runtime.v1.RuntimeLocalService/SearchCatalogModels", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M06", "/nimi.runtime.v1.RuntimeLocalService/ListCatalogVariants", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M07", "/nimi.runtime.v1.RuntimeLocalService/GetRecommendationFeed", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M08", "/nimi.runtime.v1.RuntimeLocalService/ResolveModelInstallPlan", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M09", "/nimi.runtime.v1.RuntimeLocalService/InstallModelFromPlan", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M10", "/nimi.runtime.v1.RuntimeLocalService/InstallVerifiedAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M11", "/nimi.runtime.v1.RuntimeLocalService/ImportLocalAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M12", "/nimi.runtime.v1.RuntimeLocalService/ImportLocalAssetFile", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M13", "/nimi.runtime.v1.RuntimeLocalService/ImportLocalAssetBundle", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M14", "/nimi.runtime.v1.RuntimeLocalService/RescanLocalAssetBundle", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M15", "/nimi.runtime.v1.RuntimeLocalService/ListLocalTransfers", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M16", "/nimi.runtime.v1.RuntimeLocalService/PauseLocalTransfer", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M17", "/nimi.runtime.v1.RuntimeLocalService/ResumeLocalTransfer", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M18", "/nimi.runtime.v1.RuntimeLocalService/CancelLocalTransfer", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M19", "/nimi.runtime.v1.RuntimeLocalService/WatchLocalTransfers", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodServerStream},
	{"M20", "/nimi.runtime.v1.RuntimeLocalService/ScanUnregisteredAssets", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M21", "/nimi.runtime.v1.RuntimeLocalService/ScaffoldOrphanAsset", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M22", "/nimi.runtime.v1.RuntimeLocalService/ResolveProfile", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M23", "/nimi.runtime.v1.RuntimeLocalService/ApplyProfile", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M24", "/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M25", "/nimi.runtime.v1.RuntimeLocalService/ListLocalAudits", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M26", "/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodServerStream},
	{"M27", "/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodServerStream},
	{"M28", "/nimi.runtime.v1.RuntimeExternalAgentService/GetExternalAgentGatewayStatus", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M29", "/nimi.runtime.v1.RuntimeExternalAgentService/IssueExternalAgentToken", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M30", "/nimi.runtime.v1.RuntimeExternalAgentService/RevokeExternalAgentToken", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"M31", "/nimi.runtime.v1.RuntimeExternalAgentService/ListExternalAgentTokens", protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A01", "/nimi.runtime.v1.RuntimeAppService/GetAccountAppInventory", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A02", "/nimi.runtime.v1.RuntimeAppService/GetAppPackageReadiness", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A06", "/nimi.runtime.v1.RuntimeConnectorService/ListModelCatalogProviders", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A07", "/nimi.runtime.v1.RuntimeConnectorService/ListCatalogProviderModels", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A08", "/nimi.runtime.v1.RuntimeConnectorService/GetCatalogModelDetail", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A09", "/nimi.runtime.v1.RuntimeConnectorService/UpsertModelCatalogProvider", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A10", "/nimi.runtime.v1.RuntimeConnectorService/DeleteModelCatalogProvider", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A11", "/nimi.runtime.v1.RuntimeConnectorService/UpsertCatalogModelOverlay", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A12", "/nimi.runtime.v1.RuntimeConnectorService/DeleteCatalogModelOverlay", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A13", "/nimi.runtime.v1.RuntimeConnectorService/ListConnectors", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A14", "/nimi.runtime.v1.RuntimeConnectorService/CreateConnector", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A15", "/nimi.runtime.v1.RuntimeConnectorService/UpdateConnector", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A16", "/nimi.runtime.v1.RuntimeConnectorService/DeleteConnector", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A17", "/nimi.runtime.v1.RuntimeConnectorService/TestConnector", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A18", "/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A19", "/nimi.runtime.v1.RuntimeAgentService/GetAgentState", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A20", "/nimi.runtime.v1.RuntimeAgentService/ListPendingHooks", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A21", "/nimi.runtime.v1.RuntimeAgentService/QueryAgentMemory", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A22", "/nimi.runtime.v1.RuntimeAgentService/UpdateAgentState", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A23", "/nimi.runtime.v1.RuntimeAgentService/EnableAutonomy", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A24", "/nimi.runtime.v1.RuntimeAgentService/DisableAutonomy", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A25", "/nimi.runtime.v1.RuntimeAgentService/SetAutonomyConfig", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A26", "/nimi.runtime.v1.RuntimeAgentService/CancelHook", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A27", "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedControlSurfaceSnapshot", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A28", "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedReplayTrace", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A29", "/nimi.runtime.v1.RuntimeAgentService/UpsertDelegatedProviderProfile", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A30", "/nimi.runtime.v1.RuntimeAgentService/SetDelegatedProviderState", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
	{"A31", "/nimi.runtime.v1.RuntimeAgentService/SubmitDelegatedApprovalDecision", protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.FirstPartyMethodUnary},
}

func TestM1ExactProfileAdmission(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	if _, err := manager.Open(protectedlocal.ContextWithDesktopConnection(context.Background(), connection)); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	provider := &protectedAccountPrincipalTestProvider{invalidated: make(chan struct{})}
	unary := newUnaryProtectedDesktopTransportInterceptor(manager, provider)
	streaming := newStreamProtectedDesktopTransportInterceptor(manager, provider)
	for _, tc := range finalM1ProfileAdmissionCases {
		t.Run(tc.profileID+"/"+tc.id+"/"+tc.method, func(t *testing.T) {
			kind, admitted := protectedlocal.FirstPartyProfileMethod(tc.profileID, tc.method)
			if !admitted || kind != tc.kind {
				t.Fatalf("generated membership = (%s, %v), want (%s, true)", kind, admitted, tc.kind)
			}
			ctx := protectedFirstPartyProfileTestContext(context.Background(), connection, tc.marker)
			assertHandlerContext := func(callContext context.Context) error {
				principal, hasPrincipal := protectedprincipal.FromContext(callContext)
				identity := authn.IdentityFromContext(callContext)
				if tc.profileID == protectedlocal.DesktopAccountProductProfileID {
					if !hasPrincipal || principal.AccountID != "account-protected" || identity == nil || identity.SubjectUserID != principal.AccountID {
						return status.Error(codes.Internal, "Runtime-minted account principal was not projected exactly")
					}
				} else if hasPrincipal || identity != nil {
					return status.Error(codes.Internal, "machine profile received account identity")
				}
				return nil
			}
			if tc.kind == protectedlocal.FirstPartyMethodUnary {
				reached := false
				_, err := unary(ctx, nil, &grpc.UnaryServerInfo{FullMethod: tc.method}, func(callContext context.Context, _ any) (any, error) {
					reached = true
					return struct{}{}, assertHandlerContext(callContext)
				})
				if err != nil || !reached {
					t.Fatalf("unary admission reached=%v err=%v", reached, err)
				}
				return
			}
			reached := false
			err := streaming(nil, &recordingServerStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: tc.method, IsServerStream: true}, func(_ any, protectedStream grpc.ServerStream) error {
				reached = true
				return assertHandlerContext(protectedStream.Context())
			})
			if err != nil || !reached {
				t.Fatalf("stream admission reached=%v err=%v", reached, err)
			}
		})
	}
}

func TestM1ExactProfileNegativeMatrix(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	if _, err := manager.Open(protectedlocal.ContextWithDesktopConnection(context.Background(), connection)); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	provider := &protectedAccountPrincipalTestProvider{invalidated: make(chan struct{})}
	unary := newUnaryProtectedDesktopTransportInterceptor(manager, provider)
	streaming := newStreamProtectedDesktopTransportInterceptor(manager, provider)
	for _, tc := range finalM1ProfileAdmissionCases {
		t.Run(tc.profileID+"/"+tc.id+"/"+tc.method, func(t *testing.T) {
			wrongKind := protectedlocal.FirstPartyMethodUnary
			if tc.kind == protectedlocal.FirstPartyMethodUnary {
				wrongKind = protectedlocal.FirstPartyMethodServerStream
			}
			valid := protectedFirstPartyProfileTestContext(context.Background(), connection, tc.marker)
			if _, _, err := resolveProtectedFirstPartyProfile(valid, tc.method, wrongKind); status.Code(err) != codes.PermissionDenied {
				t.Fatalf("wrong kind was not denied: %v", err)
			}
			wrongApp := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
				protectedFirstPartyProfileMetadata, tc.marker, "x-nimi-app-id", "renderer-selected",
			))
			if _, _, err := resolveProtectedFirstPartyProfile(wrongApp, tc.method, tc.kind); status.Code(err) != codes.PermissionDenied {
				t.Fatalf("renderer-selected app was not denied: %v", err)
			}
			noProfile := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedDesktopAuthInfo{connection: connection}})
			reached := false
			if tc.kind == protectedlocal.FirstPartyMethodUnary {
				_, err := unary(noProfile, nil, &grpc.UnaryServerInfo{FullMethod: tc.method}, func(context.Context, any) (any, error) { reached = true; return struct{}{}, nil })
				if status.Code(err) != codes.PermissionDenied || reached {
					t.Fatalf("missing profile result reached=%v err=%v", reached, err)
				}
			} else {
				err := streaming(nil, &recordingServerStream{ctx: noProfile}, &grpc.StreamServerInfo{FullMethod: tc.method, IsServerStream: true}, func(any, grpc.ServerStream) error { reached = true; return nil })
				if status.Code(err) != codes.PermissionDenied || reached {
					t.Fatalf("missing profile stream result reached=%v err=%v", reached, err)
				}
			}
			conflictingBase := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "renderer-selected-account"})
			conflicting := protectedFirstPartyProfileTestContext(conflictingBase, connection, tc.marker)
			reached = false
			if tc.kind == protectedlocal.FirstPartyMethodUnary {
				_, err := unary(conflicting, nil, &grpc.UnaryServerInfo{FullMethod: tc.method}, func(context.Context, any) (any, error) { reached = true; return struct{}{}, nil })
				if status.Code(err) != codes.PermissionDenied || reached {
					t.Fatalf("conflicting identity result reached=%v err=%v", reached, err)
				}
			} else {
				err := streaming(nil, &recordingServerStream{ctx: conflicting}, &grpc.StreamServerInfo{FullMethod: tc.method, IsServerStream: true}, func(any, grpc.ServerStream) error { reached = true; return nil })
				if status.Code(err) != codes.PermissionDenied || reached {
					t.Fatalf("conflicting identity stream result reached=%v err=%v", reached, err)
				}
			}
		})
	}
}

func TestM1ExactProfilePostStateCounts(t *testing.T) {
	machine := protectedlocal.FirstPartyProfileMethods(protectedlocal.DesktopMachineProductProfileID)
	account := protectedlocal.FirstPartyProfileMethods(protectedlocal.DesktopAccountProductProfileID)
	if len(machine) != 64 || len(account) != 49 {
		t.Fatalf("profile counts machine=%d account=%d", len(machine), len(account))
	}
	union := map[string]struct{}{}
	for _, method := range append(append([]protectedlocal.FirstPartyProfileMethodEntry(nil), machine...), account...) {
		union[method.MethodID] = struct{}{}
	}
	if len(machine)+len(account) != 113 || len(union) != 112 {
		t.Fatalf("post-state memberships=%d union=%d", len(machine)+len(account), len(union))
	}
}

func protectedFirstPartyProfileTestContext(base context.Context, connection *protectedlocal.Connection, marker string) context.Context {
	ctx := metadata.NewIncomingContext(base, metadata.Pairs(
		protectedFirstPartyProfileMetadata, marker,
		"x-nimi-app-id", envelope.ProtectedDesktopAppID,
	))
	return peer.NewContext(ctx, &peer.Peer{AuthInfo: &protectedDesktopAuthInfo{connection: connection}})
}

func TestGeneratedFirstPartyProfilesResolveExactMarkerMethodAndKind(t *testing.T) {
	profiles := []struct {
		profileID string
		marker    string
		role      protectedlocal.OriginRole
		account   bool
	}{
		{protectedlocal.DesktopMachineProductProfileID, protectedlocal.DesktopMachineProductNativeMarker, protectedlocal.RoleVerifiedDesktopProcess, false},
		{protectedlocal.DesktopAccountProductProfileID, protectedlocal.DesktopAccountProductNativeMarker, protectedlocal.RoleDesktopAccountHost, true},
	}
	for _, profile := range profiles {
		for _, method := range protectedlocal.FirstPartyProfileMethods(profile.profileID) {
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
				protectedFirstPartyProfileMetadata, profile.marker,
				"x-nimi-app-id", envelope.ProtectedDesktopAppID,
			))
			resolved, ok, err := resolveProtectedFirstPartyProfile(ctx, method.MethodID, method.Kind)
			if err != nil || !ok || resolved.profileID != profile.profileID || resolved.role != profile.role || resolved.account != profile.account {
				t.Fatalf("resolve %s %s = (%+v, %v, %v)", profile.profileID, method.MethodID, resolved, ok, err)
			}
			wrongKind := protectedlocal.FirstPartyMethodUnary
			if method.Kind == protectedlocal.FirstPartyMethodUnary {
				wrongKind = protectedlocal.FirstPartyMethodServerStream
			}
			if _, _, err := resolveProtectedFirstPartyProfile(ctx, method.MethodID, wrongKind); status.Code(err) != codes.PermissionDenied {
				t.Fatalf("kind drift for %s was not denied: %v", method.MethodID, err)
			}
		}
	}
	wrongApp := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		protectedFirstPartyProfileMetadata, protectedlocal.DesktopMachineProductNativeMarker,
		"x-nimi-app-id", "renderer-selected",
	))
	if _, _, err := resolveProtectedFirstPartyProfile(wrongApp, "/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets", protectedlocal.FirstPartyMethodUnary); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("wrong app marker was not denied: %v", err)
	}
}

func TestDesktopMachineProfileStreamReachesHandler(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	if _, err := manager.Open(protectedlocal.ContextWithDesktopConnection(context.Background(), connection)); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		protectedFirstPartyProfileMetadata, protectedlocal.DesktopMachineProductNativeMarker,
		"x-nimi-app-id", envelope.ProtectedDesktopAppID,
	))
	ctx = peer.NewContext(ctx, &peer.Peer{AuthInfo: &protectedDesktopAuthInfo{connection: connection}})
	reached := false
	err := newStreamProtectedDesktopTransportInterceptor(manager, nil)(nil, &recordingServerStream{ctx: ctx}, &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		IsServerStream: true,
	}, func(_ any, protectedStream grpc.ServerStream) error {
		reached = true
		if _, ok := protectedprincipal.FromContext(protectedStream.Context()); ok {
			return status.Error(codes.Internal, "machine profile must not receive account principal")
		}
		return nil
	})
	if err != nil || !reached {
		t.Fatalf("machine stream handler result = reached=%v error=%v", reached, err)
	}
}

func TestDesktopAccountProfileInvalidationCancelsUnaryBeforeLaterMutation(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	connectionContext := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(connectionContext); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	invalidated := make(chan struct{})
	provider := &protectedAccountPrincipalTestProvider{invalidated: invalidated}
	ctx := protectedAccountProfileTestContext(connection)
	started := make(chan struct{})
	result := make(chan error, 1)
	interceptor := newUnaryProtectedDesktopTransportInterceptor(manager, provider)
	go func() {
		_, err := interceptor(ctx, &runtimev1.ListAgentsRequest{}, &grpc.UnaryServerInfo{
			FullMethod: "/nimi.runtime.v1.RuntimeAgentService/ListAgents",
		}, func(callContext context.Context, _ any) (any, error) {
			principal, ok := protectedprincipal.FromContext(callContext)
			if !ok || principal.ProfileID != protectedlocal.DesktopAccountProductProfileID || principal.AccountID != "account-protected" {
				return nil, status.Error(codes.Internal, "account principal missing")
			}
			close(started)
			<-callContext.Done()
			return nil, callContext.Err()
		})
		result <- err
	}()
	<-started
	close(invalidated)
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("account invalidation result = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("account invalidation did not cancel in-flight unary")
	}
}

func TestDesktopAccountProfileInvalidationCancelsStreamBeforeLaterEvent(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	if _, err := manager.Open(protectedlocal.ContextWithDesktopConnection(context.Background(), connection)); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	invalidated := make(chan struct{})
	provider := &protectedAccountPrincipalTestProvider{invalidated: invalidated}
	stream := &recordingServerStream{ctx: protectedAccountProfileTestContext(connection)}
	started := make(chan struct{})
	result := make(chan error, 1)
	interceptor := newStreamProtectedDesktopTransportInterceptor(manager, provider)
	go func() {
		result <- interceptor(nil, stream, &grpc.StreamServerInfo{
			FullMethod:     "/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentEvents",
			IsServerStream: true,
		}, func(_ any, protectedStream grpc.ServerStream) error {
			principal, ok := protectedprincipal.FromContext(protectedStream.Context())
			if !ok || principal.ProfileID != protectedlocal.DesktopAccountProductProfileID || principal.AccountID != "account-protected" {
				return status.Error(codes.Internal, "account principal missing")
			}
			close(started)
			<-protectedStream.Context().Done()
			return protectedStream.Context().Err()
		})
	}()
	<-started
	close(invalidated)
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("account stream invalidation result = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("account invalidation did not cancel in-flight stream")
	}
}

func protectedAccountProfileTestContext(connection *protectedlocal.Connection) context.Context {
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		protectedFirstPartyProfileMetadata, protectedlocal.DesktopAccountProductNativeMarker,
		"x-nimi-app-id", envelope.ProtectedDesktopAppID,
	))
	return peer.NewContext(ctx, &peer.Peer{AuthInfo: &protectedDesktopAuthInfo{connection: connection}})
}

type protectedAccountPrincipalTestProvider struct {
	invalidated <-chan struct{}
}

func (provider *protectedAccountPrincipalTestProvider) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	return &runtimev1.AccountProjection{AccountId: "account-protected", RealmEnvironmentId: "realm-test"}, 7, provider.invalidated, true
}

type protectedDesktopAccountTestService struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer
	statusBound            bool
	subscriptionBound      bool
	workspaceBindingCalled bool
}

func (*protectedDesktopAccountTestService) BindAuthenticatedRuntimeGeneration(context.Context) (*runtimev1.AccountProjection, uint64, <-chan struct{}, bool) {
	return &runtimev1.AccountProjection{AccountId: "account-protected", RealmEnvironmentId: "realm-test"}, 1, make(chan struct{}), true
}

type protectedDesktopAuditTestService struct {
	runtimev1.UnimplementedRuntimeAuditServiceServer
	projectionCalled           bool
	authorizationDecisionBound bool
	rawCalled                  bool
}

func (s *protectedDesktopAuditTestService) ListDesktopAuditEvents(ctx context.Context, _ *runtimev1.ListDesktopAuditEventsRequest) (*runtimev1.ListDesktopAuditEventsResponse, error) {
	s.projectionCalled = true
	s.authorizationDecisionBound = envelope.HasValidatedProtectedCapability(
		ctx,
		envelope.ProtectedDesktopAppID,
		envelope.ProtectedDesktopAuditReadCapability,
	)
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
	return stream.Send(&runtimev1.AccountSessionEvent{
		DeliveryKind: runtimev1.AccountSessionDeliveryKind_ACCOUNT_SESSION_DELIVERY_KIND_SNAPSHOT,
		Snapshot: &runtimev1.AccountSessionSnapshot{
			ReasonCode:        runtimev1.ReasonCode_ACTION_EXECUTED,
			AccountReasonCode: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED,
		},
	})
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
