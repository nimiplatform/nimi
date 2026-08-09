package grpcserver

import (
	"context"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/protobuf/proto"
)

func TestProtectedLocalAppRPCServerRegistersBoundedMachineLocalConfigurationOwner(t *testing.T) {
	server := newProtectedLocalAppRPCServer(
		&runtimev1.UnimplementedRuntimeServiceControlServiceServer{},
		&runtimev1.UnimplementedRuntimeAuthServiceServer{},
		&runtimev1.UnimplementedRuntimeAccountServiceServer{},
		&runtimev1.UnimplementedRuntimeLocalServiceServer{},
		&runtimev1.UnimplementedRuntimeAiServiceServer{},
		&runtimev1.UnimplementedRuntimeAgentServiceServer{},
		&runtimev1.UnimplementedRuntimeAppServiceServer{},
	)
	if _, registered := server.GetServiceInfo()["nimi.runtime.v1.RuntimeLocalService"]; !registered {
		t.Fatal("protected Local App server did not register RuntimeLocalService")
	}
}

func TestProtectedLocalAppTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = serverSide.Close() }()
	defer func() { _ = clientSide.Close() }()
	if _, _, err := (protectedLocalAppTransportCredentials{}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected local-app handshake")
	}
}

func TestProtectedLocalAppOperationsFailClosedBeforeOwnerDispatch(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x31)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x32), SessionProof: grpcLocalAppIdentifier(0x33)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor()(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{}, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("protected operation = called:%v reason:%v", handlerCalled, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppAdmissionDenialNeverDispatchesOwner(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x35)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x36), SessionProof: grpcLocalAppIdentifier(0x37)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{err: grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{}, nil
	})
	if handlerCalled || admission.calls != 1 || admission.ingress != localappop.IngressStorageJSONRead || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("denied operation = handler:%v admission:%+v reason:%v", handlerCalled, admission, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppAdmittedImplementedOwnerDispatches(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x38)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x39), SessionProof: grpcLocalAppIdentifier(0x3a)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	response, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.ReadLocalAppStorageJsonResponse{ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	})
	if err != nil || !handlerCalled || admission.calls != 1 || response.(*runtimev1.ReadLocalAppStorageJsonResponse).GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("admitted operation = handler:%v admission:%+v response:%+v error:%v", handlerCalled, admission, response, err)
	}
}

func TestProtectedLocalAppAIConfigOwnersDispatchAfterAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x4a)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x4b), SessionProof: grpcLocalAppIdentifier(0x4c)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	tests := []struct {
		method  string
		request any
		ingress localappop.Ingress
	}{
		{method: protectedGetAppAIConfigMethod, request: &runtimev1.GetAppAIConfigRequest{}, ingress: localappop.IngressAppAIConfigGet},
		{method: protectedGetMachineLocalAIConfigMethod, request: &runtimev1.GetMachineLocalAIConfigurationRequest{}, ingress: localappop.IngressAppAIConfigGet},
		{method: protectedOverwriteAppAIConfigMethod, request: &runtimev1.OverwriteAppAIConfigRequest{Config: &runtimev1.AIConfig{}}, ingress: localappop.IngressAppAIConfigOverwrite},
	}
	for _, test := range tests {
		handlerCalled := false
		_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, test.request, &grpc.UnaryServerInfo{FullMethod: test.method}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return &runtimev1.GetAppAIConfigResponse{}, nil
		})
		if err != nil || !handlerCalled || admission.ingress != test.ingress {
			t.Fatalf("AIConfig %s = handler:%v ingress:%v error:%v", test.method, handlerCalled, admission.ingress, err)
		}
	}
}

func TestProtectedLocalAppAdmittedTextCandidateDispatchesOwner(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x3e)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x3f), SessionProof: grpcLocalAppIdentifier(0x40)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.GenerateLocalAppTextCandidateRequest{}, &grpc.UnaryServerInfo{FullMethod: protectedGenerateTextCandidateMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.GenerateLocalAppTextCandidateResponse{}, nil
	})
	if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != localappop.IngressTextCandidateGenerate {
		t.Fatalf("text owner = handler:%v admission:%+v error:%v", handlerCalled, admission, err)
	}
}

func TestProtectedLocalAppRealmListAndCreateDispatchToExactOwners(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x51)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x52), SessionProof: grpcLocalAppIdentifier(0x53)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	listCalled := false
	listRequest := &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_listWorldCores", RequestJson: `{"path":{},"query":{}}`}
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, listRequest, &grpc.UnaryServerInfo{FullMethod: protectedInvokeRealmUnaryMethod}, func(context.Context, any) (any, error) {
		listCalled = true
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: true}, nil
	})
	if err != nil || !listCalled || admission.ingress != localappop.IngressRealmWorldCoreList {
		t.Fatalf("Realm list = called:%v admission:%+v error:%v", listCalled, admission, err)
	}

	createCalled := false
	createRequest := &runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_createWorldCore", RequestJson: `{"path":{},"query":{},"body":{}}`}
	_, err = newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, createRequest, &grpc.UnaryServerInfo{FullMethod: protectedInvokeRealmUnaryMethod}, func(context.Context, any) (any, error) {
		createCalled = true
		return &runtimev1.InvokeRealmUnaryResponse{Accepted: true}, nil
	})
	if err != nil || !createCalled || admission.ingress != localappop.IngressRealmWorldCoreCreate {
		t.Fatalf("Realm create = called:%v admission:%+v error:%v", createCalled, admission, err)
	}
}

func TestProtectedLocalAppCallerAssertionScannerHandlesRepeatedMessages(t *testing.T) {
	request := &runtimev1.GenerateLocalAppTextCandidateRequest{
		Messages:    []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "deny before dispatch"}},
		Temperature: proto.Float32(0),
		TopP:        proto.Float32(1),
		MaxTokens:   proto.Int32(1),
	}
	if protectedLocalAppRequestHasCallerAssertion(context.Background(), request) {
		t.Fatal("ordinary repeated message content was treated as a caller assertion")
	}
}

func TestProtectedLocalAppCallerAssertionRejectedBeforeAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x3b)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x3c), SessionProof: grpcLocalAppIdentifier(0x3d)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "handle-1", SubjectUserId: "forged-account"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return &runtimev1.OpenConversationAnchorResponse{}, nil
	})
	if handlerCalled || admission.calls != 0 || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED {
		t.Fatalf("caller assertion = handler:%v admission:%+v reason:%v", handlerCalled, admission, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppTypedConversationStreamDispatchesAfterExactAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x3e)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x3f), SessionProof: grpcLocalAppIdentifier(0x40)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	handlerCalled := false
	err := newStreamProtectedLocalAppTransportInterceptor(admission)(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: protectedSubscribeConversationMethod}, func(_ any, stream grpc.ServerStream) error {
		handlerCalled = true
		if _, ok := protectedlocal.LocalAppConnectionFromContext(stream.Context()); !ok {
			t.Fatal("authorized stream context lost protected connection")
		}
		return nil
	})
	if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != localappop.IngressConversationEventsSubscribe {
		t.Fatalf("typed stream = called:%v admission:%+v error:%v", handlerCalled, admission, err)
	}
}

func TestProtectedLocalAppStreamFailsClosedBeforeOwnerDispatch(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x41)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x42), SessionProof: grpcLocalAppIdentifier(0x43)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	handlerCalled := false
	err := newStreamProtectedLocalAppTransportInterceptor()(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: protectedSubscribeConversationMethod}, func(any, grpc.ServerStream) error {
		handlerCalled = true
		return nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("protected stream = called:%v reason:%v", handlerCalled, localAppTransportReason(err))
	}
}

func TestProtectedLocalAppScenarioConsumptionUnaryDispatchesAfterAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x61)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x62), SessionProof: grpcLocalAppIdentifier(0x63)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	tests := []struct {
		method  string
		request any
		ingress localappop.Ingress
	}{
		{method: protectedExecuteLocalAppScenarioMethod, request: &runtimev1.ExecuteLocalAppScenarioRequest{}, ingress: localappop.IngressScenarioExecute},
		{method: protectedSubmitScenarioJobMethod, request: &runtimev1.SubmitLocalAppScenarioJobRequest{}, ingress: localappop.IngressScenarioJobSubmit},
		{method: protectedGetScenarioJobMethod, request: &runtimev1.GetLocalAppScenarioJobRequest{}, ingress: localappop.IngressScenarioJobGet},
		{method: protectedCancelScenarioJobMethod, request: &runtimev1.CancelLocalAppScenarioJobRequest{}, ingress: localappop.IngressScenarioJobCancel},
		{method: protectedReadLocalAppArtifactMethod, request: &runtimev1.ReadLocalAppArtifactRequest{}, ingress: localappop.IngressArtifactRead},
		{method: protectedUploadLocalAppArtifactMethod, request: &runtimev1.UploadLocalAppArtifactRequest{}, ingress: localappop.IngressArtifactUpload},
		{method: protectedListLocalAppVoiceAssetsMethod, request: &runtimev1.ListLocalAppVoiceAssetsRequest{}, ingress: localappop.IngressVoiceAssetsList},
	}
	for _, test := range tests {
		admission.calls = 0
		admission.ingress = localappop.IngressUnknown
		handlerCalled := false
		_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, test.request, &grpc.UnaryServerInfo{FullMethod: test.method}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return &runtimev1.GetLocalAppScenarioJobResponse{}, nil
		})
		if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != test.ingress {
			t.Fatalf("scenario operation %s = handler:%v admission:%+v error:%v", test.method, handlerCalled, admission, err)
		}
	}
}

func TestProtectedLocalAppAssetCRUDDispatchesOnlyExactIngress(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x67)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x68), SessionProof: grpcLocalAppIdentifier(0x69)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	unary := []struct {
		method  string
		request any
		ingress localappop.Ingress
	}{
		{protectedStatLocalAppAssetMethod, &runtimev1.StatLocalAppAssetRequest{}, localappop.IngressStorageAssetStat},
		{protectedListLocalAppAssetsMethod, &runtimev1.ListLocalAppAssetsRequest{}, localappop.IngressStorageAssetList},
		{protectedRemoveLocalAppAssetMethod, &runtimev1.RemoveLocalAppAssetRequest{}, localappop.IngressStorageAssetRemove},
		{protectedMoveLocalAppAssetMethod, &runtimev1.MoveLocalAppAssetRequest{}, localappop.IngressStorageAssetMove},
		{protectedAdoptLocalAppArtifactMethod, &runtimev1.AdoptLocalAppArtifactRequest{}, localappop.IngressArtifactAdoptToStorage},
	}
	for _, test := range unary {
		admission.calls = 0
		handlerCalled := false
		_, err := newUnaryProtectedLocalAppTransportInterceptor(admission)(ctx, test.request, &grpc.UnaryServerInfo{FullMethod: test.method}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return &runtimev1.StatLocalAppAssetResponse{}, nil
		})
		if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != test.ingress {
			t.Fatalf("asset unary %s handler=%v admission=%+v err=%v", test.method, handlerCalled, admission, err)
		}
	}
	for _, test := range []struct {
		method  string
		ingress localappop.Ingress
	}{{protectedWriteLocalAppAssetMethod, localappop.IngressStorageAssetWrite}, {protectedReadLocalAppAssetMethod, localappop.IngressStorageAssetRead}} {
		admission.calls = 0
		handlerCalled := false
		err := newStreamProtectedLocalAppTransportInterceptor(admission)(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: test.method}, func(any, grpc.ServerStream) error {
			handlerCalled = true
			return nil
		})
		if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != test.ingress {
			t.Fatalf("asset stream %s handler=%v admission=%+v err=%v", test.method, handlerCalled, admission, err)
		}
	}
}

func TestProtectedLocalAppScenarioConsumptionStreamsDispatchAfterAdmission(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x64)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x65), SessionProof: grpcLocalAppIdentifier(0x66)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	admission := &localAppAdmissionStub{}
	tests := []struct {
		method  string
		ingress localappop.Ingress
	}{
		{method: protectedStreamTextTurnMethod, ingress: localappop.IngressTextTurnStream},
		{method: protectedSubscribeScenarioJobMethod, ingress: localappop.IngressScenarioJobSubscribe},
	}
	for _, test := range tests {
		admission.calls = 0
		admission.ingress = localappop.IngressUnknown
		handlerCalled := false
		err := newStreamProtectedLocalAppTransportInterceptor(admission)(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: test.method}, func(_ any, stream grpc.ServerStream) error {
			handlerCalled = true
			return nil
		})
		if err != nil || !handlerCalled || admission.calls != 1 || admission.ingress != test.ingress {
			t.Fatalf("scenario stream %s = handler:%v admission:%+v error:%v", test.method, handlerCalled, admission, err)
		}
	}
}

func TestProtectedLocalAppScenarioConsumptionOwnerSurfacesStayUnadmitted(t *testing.T) {
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		"/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob",
		"/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents",
		"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts",
		"/nimi.runtime.v1.RuntimeAiService/ListVoiceAssets",
		"/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes",
	} {
		if protectedLocalAppUnaryMethodAllowed(method) || protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("owner method %s leaked onto the local-app transport", method)
		}
	}
}

type localAppAdmissionStub struct {
	ingress localappop.Ingress
	calls   int
	err     error
}

func (stub *localAppAdmissionStub) AdmitLocalAppIngress(_ context.Context, ingress localappop.Ingress) error {
	stub.calls++
	stub.ingress = ingress
	return stub.err
}

func (stub *localAppAdmissionStub) AuthorizeLocalAppIngress(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
	stub.calls++
	stub.ingress = ingress
	return ctx, stub.err
}

type localAppTransportTestStream struct{ ctx context.Context }

func (*localAppTransportTestStream) SetHeader(metadata.MD) error     { return nil }
func (*localAppTransportTestStream) SendHeader(metadata.MD) error    { return nil }
func (*localAppTransportTestStream) SetTrailer(metadata.MD)          {}
func (stream *localAppTransportTestStream) Context() context.Context { return stream.ctx }
func (*localAppTransportTestStream) SendMsg(any) error               { return nil }
func (*localAppTransportTestStream) RecvMsg(any) error               { return nil }

type grpcLocalAppVerifier struct {
	peer protectedlocal.VerifiedLocalAppLaunchPeer
}

func (verifier grpcLocalAppVerifier) VerifyLocalAppLaunchPeer(context.Context) (protectedlocal.VerifiedLocalAppLaunchPeer, error) {
	return verifier.peer, nil
}

type grpcLocalAppLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func (liveness *grpcLocalAppLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *grpcLocalAppLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func newGRPCLocalAppConnection(t testing.TB, seed byte) *protectedlocal.LocalAppConnection {
	t.Helper()
	liveness := &grpcLocalAppLiveness{revoked: make(chan struct{})}
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: uint32(seed) + 2000, CreationMarker: "grpc-local-app-start",
		OSLoginSession: "grpc-local-app-logon", SecurityPrincipal: "grpc-local-app-user",
		CanonicalExecutableIdentity: "grpc-local-app-file", ExecutableDigest: grpcLocalAppIdentifier(seed + 1),
		ExecutableTrustSetID: "grpc-local-app-trust",
	}
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), grpcLocalAppVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID: grpcLocalAppIdentifier(seed), Process: process, RuntimeBootEpoch: grpcLocalAppIdentifier(seed + 2),
		ProcessLiveness: liveness, TrustClass: protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}

func grpcLocalAppIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func localAppTransportReason(err error) runtimev1.ReasonCode {
	reason, _ := grpcerr.ExtractReasonCode(err)
	return reason
}
