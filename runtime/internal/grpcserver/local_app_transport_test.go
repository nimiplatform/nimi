package grpcserver

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProtectedLocalAppTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer func() { _ = serverSide.Close() }()
	defer func() { _ = clientSide.Close() }()
	if _, _, err := (protectedLocalAppTransportCredentials{}).ServerHandshake(serverSide); err == nil {
		t.Fatal("ordinary net.Conn passed protected local-app handshake")
	}
	listener := &nativeVerifiedLocalAppListener{Listener: &protectedDesktopOneShotListener{connection: serverSide}}
	if accepted, err := listener.Accept(); err == nil || accepted != nil {
		if accepted != nil {
			_ = accepted.Close()
		}
		t.Fatal("ordinary listener connection was promoted to local-app authority")
	}
}

func TestProtectedLocalAppNativeCarrierConversationOperationsRemainTypedUnavailable(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0x91)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0x92), SessionProof: grpcLocalAppIdentifier(0x93)}); err != nil {
		t.Fatal(err)
	}
	accountService := &reservedLocalAppAccountTestService{}
	server := newProtectedLocalAppRPCServer(
		&runtimev1.UnimplementedRuntimeServiceControlServiceServer{},
		&runtimev1.UnimplementedRuntimeAuthServiceServer{},
		accountService,
		&runtimev1.UnimplementedRuntimeAiServiceServer{},
		&runtimev1.UnimplementedRuntimeAgentServiceServer{},
		&runtimev1.UnimplementedRuntimeAppServiceServer{},
	)
	if _, registered := server.GetServiceInfo()["nimi.runtime.v1.RuntimeAgentService"]; !registered {
		t.Fatal("local-app carrier did not register RuntimeAgentService")
	}
	baseListener := bufconn.Listen(1024 * 1024)
	listener := &protectedLocalAppTestListener{Listener: baseListener, connection: connection}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		_ = baseListener.Close()
		<-serveDone
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientConn, err := grpc.DialContext(
		ctx,
		"passthrough:///protected-local-app-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		t.Fatalf("dial protected local-app carrier: %v", err)
	}
	defer func() { _ = clientConn.Close() }()

	payload, err := structpb.NewStruct(map[string]any{
		"local_agent_ref": "opaque-agent-handle", "conversation_anchor_id": "anchor-a", "request_id": "request-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	agentClient := runtimev1.NewRuntimeAgentServiceClient(clientConn)
	appClient := runtimev1.NewRuntimeAppServiceClient(clientConn)
	calls := []struct {
		name string
		call func() error
	}{
		{"open", func() error {
			_, callErr := agentClient.OpenConversationAnchor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "opaque-agent-handle"})
			return callErr
		}},
		{"send", func() error {
			_, callErr := appClient.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{Payload: payload})
			return callErr
		}},
		{"snapshot", func() error {
			_, callErr := agentClient.GetPublicChatSessionSnapshot(ctx, &runtimev1.GetPublicChatSessionSnapshotRequest{AgentId: "opaque-agent-handle", ConversationAnchorId: "anchor-a"})
			return callErr
		}},
		{"subscribe", func() error {
			stream, callErr := appClient.SubscribeAppMessages(ctx, &runtimev1.SubscribeAppMessagesRequest{LocalAgentRef: "opaque-agent-handle", ConversationAnchorId: "anchor-a"})
			if callErr != nil {
				return callErr
			}
			_, callErr = stream.Recv()
			return callErr
		}},
	}
	for _, test := range calls {
		if reason := localAppTransportReason(test.call()); reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
			t.Fatalf("%s reserved carrier reason = %s", test.name, reason)
		}
	}

	authClient := runtimev1.NewRuntimeAuthServiceClient(clientConn)
	_, err = authClient.RegisterApp(ctx, &runtimev1.RegisterAppRequest{})
	if reason := localAppTransportReason(err); reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("forbidden auth method reason = %s, err=%v", reason, err)
	}
}

func TestProtectedLocalAppUnaryPolicyRequiresAtomicBootstrapPromotion(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xa1)
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})

	handlerCalled := false
	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedGetLocalAppPermissionStatusMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached host operation: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedRenewLocalAppSessionMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached renewal: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenLocalAppSessionMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerCtx)
		if !ok || bound != connection {
			t.Fatal("bootstrap handler did not receive the verified native connection")
		}
		return nil, connection.BindSession(protectedlocal.LocalAppSessionHandle{
			SessionID:    grpcLocalAppIdentifier(0xa2),
			SessionProof: grpcLocalAppIdentifier(0xa3),
		})
	})
	if err != nil || !handlerCalled {
		t.Fatalf("bootstrap did not reach session handler: called=%v err=%v", handlerCalled, err)
	}
	if origin := connection.Origin(); origin.TransportClass != protectedlocal.TransportLocalAppHost || !origin.HasRole(protectedlocal.RoleLocalAppSession) || origin.HasRole(protectedlocal.RoleLocalAppProcess) {
		t.Fatalf("session creation did not atomically promote the connection: %+v", origin)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenLocalAppSessionMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("promoted host reopened bootstrap: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedRenewLocalAppSessionMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerCtx)
		if !ok || bound != connection {
			t.Fatal("renewal handler did not receive the verified session connection")
		}
		previous, ok := connection.Session()
		if !ok {
			t.Fatal("renewal handler did not receive the current private session")
		}
		return nil, connection.RotateSession(previous, protectedlocal.LocalAppSessionHandle{
			SessionID: grpcLocalAppIdentifier(0xa4), SessionProof: grpcLocalAppIdentifier(0xa5),
		})
	})
	if err != nil || !handlerCalled {
		t.Fatalf("promoted host did not reach renewal: called=%v err=%v", handlerCalled, err)
	}

	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedGetLocalAppPermissionStatusMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerCtx)
		if !ok || bound != connection {
			t.Fatal("host handler did not receive the verified session connection")
		}
		return nil, nil
	})
	if err != nil || !handlerCalled {
		t.Fatalf("promoted host did not reach admitted operation: called=%v err=%v", handlerCalled, err)
	}

	connection.Revoke()
	handlerCalled = false
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedGetLocalAppPermissionStatusMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("revoked native process reached handler: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
}

func TestLocalAppPermissionPreflightDistinguishesRawUncarriedFromStaleProcess(t *testing.T) {
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	invoke := func(ctx context.Context) runtimev1.ReasonCode {
		_, err := interceptor(ctx, &runtimev1.GetLocalAppPermissionStatusRequest{PermissionId: "agents.interact"}, &grpc.UnaryServerInfo{FullMethod: protectedGetLocalAppPermissionStatusMethod}, func(context.Context, any) (any, error) {
			t.Fatal("untrusted process reached permission posture")
			return nil, nil
		})
		return localAppTransportReason(err)
	}
	if got := invoke(context.Background()); got != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("raw uncarried reason = %s", got)
	}

	stale := newGRPCLocalAppConnection(t, 0xa7)
	if err := stale.BindSession(protectedlocal.LocalAppSessionHandle{
		SessionID: grpcLocalAppIdentifier(0xa8), SessionProof: grpcLocalAppIdentifier(0xa9),
	}); err != nil {
		t.Fatal(err)
	}
	stale.Revoke()
	staleCtx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: stale}})
	if got := invoke(staleCtx); got != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("stale supervised process reason = %s", got)
	}
}

func TestProtectedLocalAppPoliciesExposeOnlyNamedLocalAppOperations(t *testing.T) {
	for _, method := range []string{
		protectedOpenLocalAppSessionMethod,
		protectedRenewLocalAppSessionMethod,
		protectedGetLocalAppPermissionStatusMethod,
		protectedRequestLocalAppPermissionMethod,
		protectedReadLocalAppStorageJSONMethod,
		protectedWriteLocalAppStorageJSONMethod,
		protectedRemoveLocalAppStorageJSONMethod,
		protectedOpenConversationMethod,
		protectedSendConversationTurnMethod,
		protectedConversationSnapshotMethod,
		protectedConfigurationSnapshotMethod,
		protectedUpdateConfigurationMethod,
		protectedReadinessSnapshotMethod,
		protectedAutonomySnapshotMethod,
		protectedUpdateAutonomyMethod,
		protectedPresentationSnapshotMethod,
		protectedCommitPresentationMethod,
		protectedGetAppAIConfigMethod,
		protectedOverwriteAppAIConfigMethod,
		protectedInvokeRealmUnaryMethod,
	} {
		if !protectedLocalAppUnaryMethodAllowed(method) {
			t.Fatalf("admitted local-app unary operation is missing: %s", method)
		}
	}
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes",
		"/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentInventory",
		"/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot",
		"/nimi.runtime.v1.RuntimeAgentService/TranscribeLocalAppAgentAudio",
		"/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentVoiceStream",
		"/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
	} {
		if protectedLocalAppUnaryMethodAllowed(method) || protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("unadmitted Runtime method reached local-app transport: %s", method)
		}
	}
	if !protectedLocalAppStreamMethodAllowed(protectedSubscribeConversationMethod) {
		t.Fatalf("admitted local-app stream operation is missing: %s", protectedSubscribeConversationMethod)
	}
}

func TestSelectedProtectedLocalAppAIConfigOperationsAreSelectorFree(t *testing.T) {
	for _, test := range []struct {
		method    string
		request   any
		operation accountservice.LocalAppOperation
	}{
		{protectedGetAppAIConfigMethod, &runtimev1.GetAppAIConfigRequest{}, accountservice.LocalAppOperationAppAIConfigRead},
		{protectedOverwriteAppAIConfigMethod, &runtimev1.OverwriteAppAIConfigRequest{}, accountservice.LocalAppOperationAppAIConfigOverwrite},
	} {
		operation, selector, selected := selectedLocalAppUnaryOperation(test.method, test.request)
		if !selected || operation != test.operation || selector != (localappop.Selector{}) {
			t.Fatalf("selected App AIConfig operation = (%q, %+v, %v), want (%q, empty, true)", operation, selector, selected, test.operation)
		}
	}
}

func TestSelectedProtectedLocalAppRealmOperationsAreExactAndSelectorFree(t *testing.T) {
	for _, test := range []struct {
		methodID  string
		operation accountservice.LocalAppOperation
	}{
		{"WorldCoreController_listWorldCores", accountservice.LocalAppOperationRealmWorldCoreList},
		{"WorldCoreController_createWorldCore", accountservice.LocalAppOperationRealmWorldCoreCreate},
	} {
		operation, selector, selected := selectedLocalAppUnaryOperation(
			protectedInvokeRealmUnaryMethod,
			&runtimev1.InvokeRealmUnaryRequest{MethodId: test.methodID},
		)
		if !selected || operation != test.operation || selector != (localappop.Selector{}) {
			t.Fatalf("%s selection = (%q, %+v, %v)", test.methodID, operation, selector, selected)
		}
	}
	operation, selector, selected := selectedLocalAppUnaryOperation(
		protectedInvokeRealmUnaryMethod,
		&runtimev1.InvokeRealmUnaryRequest{MethodId: "WorldCoreController_replaceWorldCore"},
	)
	if !selected || operation != "" || selector != (localappop.Selector{}) {
		t.Fatalf("unknown Realm operation selection = (%q, %+v, %v)", operation, selector, selected)
	}
}

func TestSelectedProtectedLocalAppStorageOperationsCarryOnlyExactPath(t *testing.T) {
	for _, test := range []struct {
		method    string
		request   any
		operation accountservice.LocalAppOperation
	}{
		{protectedReadLocalAppStorageJSONMethod, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state/read.json"}, accountservice.LocalAppOperationStorageJSONRead},
		{protectedWriteLocalAppStorageJSONMethod, &runtimev1.WriteLocalAppStorageJsonRequest{RelativePath: "state/write.json", JsonValue: []byte(`true`)}, accountservice.LocalAppOperationStorageJSONWrite},
		{protectedRemoveLocalAppStorageJSONMethod, &runtimev1.RemoveLocalAppStorageJsonRequest{RelativePath: "state/remove.json"}, accountservice.LocalAppOperationStorageJSONRemove},
	} {
		operation, selector, selected := selectedLocalAppUnaryOperation(test.method, test.request)
		if !selected || operation != test.operation || selector.StorageRelativePath == "" || selector.ArtifactID != "" || selector.AgentID != "" || selector.ConversationAnchorID != "" || selector.TurnID != "" {
			t.Fatalf("selected storage operation = (%q, %+v, %v)", operation, selector, selected)
		}
	}

	connection := newGRPCLocalAppConnection(t, 0xc1)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0xc2), SessionProof: grpcLocalAppIdentifier(0xc3)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: localAppTransportReasonError{reason: runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID}})
	handlerCalled := false
	_, err := interceptor(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "../secret.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || status.Code(err) != codes.InvalidArgument || localAppTransportReason(err) != runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID {
		t.Fatalf("invalid storage path transport = called=%v code=%s reason=%s err=%v", handlerCalled, status.Code(err), localAppTransportReason(err), err)
	}
}

func TestProtectedLocalAppConfigureOperationsRemainReservedWithPermissionMetadata(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xcf)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0xd0), SessionProof: grpcLocalAppIdentifier(0xd1)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: localAppTransportReasonError{reason: runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED}})
	tests := []struct {
		method    string
		request   any
		operation accountservice.LocalAppOperation
	}{
		{protectedConfigurationSnapshotMethod, &runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationConfigurationSnapshot},
		{protectedUpdateConfigurationMethod, &runtimev1.UpdateLocalAppAgentConfigurationRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationUpdateConfiguration},
		{protectedReadinessSnapshotMethod, &runtimev1.GetLocalAppAgentReadinessSnapshotRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationReadinessSnapshot},
		{protectedAutonomySnapshotMethod, &runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationAutonomySnapshot},
		{protectedUpdateAutonomyMethod, &runtimev1.UpdateLocalAppAgentAutonomyRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationUpdateAutonomy},
		{protectedPresentationSnapshotMethod, &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationPresentationSnapshot},
		{protectedCommitPresentationMethod, &runtimev1.CommitLocalAppAgentPresentationRequest{AgentHandle: "lah_v1_opaque"}, accountservice.LocalAppOperationCommitPresentation},
	}
	for _, test := range tests {
		operation, selector, selected := selectedLocalAppUnaryOperation(test.method, test.request)
		if !selected || operation != test.operation || selector != (localappop.Selector{AgentID: "lah_v1_opaque"}) {
			t.Fatalf("configure selector for %s = (%q, %+v, %v)", test.method, operation, selector, selected)
		}
		handlerCalled := false
		_, err := interceptor(ctx, test.request, &grpc.UnaryServerInfo{FullMethod: test.method}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return nil, nil
		})
		if handlerCalled || status.Code(err) != codes.Unavailable || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED {
			t.Fatalf("reserved configure transport %s = called:%v code:%s reason:%s err:%v", test.method, handlerCalled, status.Code(err), localAppTransportReason(err), err)
		}
		metadata, ok := grpcerr.ExtractReasonMetadata(err)
		if !ok || metadata["permission_id"] != "agents.configure" || metadata["permission_reason"] != "reserved_not_admitted" {
			t.Fatalf("reserved configure metadata for %s = %#v, %v", test.method, metadata, ok)
		}
	}
	for _, test := range []struct {
		reason runtimev1.ReasonCode
		label  string
	}{
		{runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED, "not_granted"},
		{runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED, "denied"},
		{runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED, "revoked"},
	} {
		interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: localAppTransportReasonError{reason: test.reason}})
		_, err := interceptor(ctx, &runtimev1.GetLocalAppAgentConfigurationSnapshotRequest{AgentHandle: "lah_v1_opaque"}, &grpc.UnaryServerInfo{FullMethod: protectedConfigurationSnapshotMethod}, func(context.Context, any) (any, error) {
			t.Fatal("non-granted configure operation reached handler")
			return nil, nil
		})
		metadata, ok := grpcerr.ExtractReasonMetadata(err)
		if !ok || localAppTransportReason(err) != test.reason || metadata["permission_id"] != "agents.configure" || metadata["permission_reason"] != test.label {
			t.Fatalf("configure failure %s metadata = %#v, reason=%s", test.reason, metadata, localAppTransportReason(err))
		}
	}
}

func TestSelectedProtectedLocalAppConversationOperationsCarryOnlyExactSelectors(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]any{
		"local_agent_ref": "agent-handle", "conversation_anchor_id": "anchor-a", "request_id": "request-a", "text": "private payload",
	})
	if err != nil {
		t.Fatal(err)
	}
	interruptPayload, err := structpb.NewStruct(map[string]any{
		"local_agent_ref": "agent-handle", "conversation_anchor_id": "anchor-a", "reason": "user_cancel",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		method    string
		request   any
		operation accountservice.LocalAppOperation
		selector  localappop.Selector
	}{
		{protectedOpenConversationMethod, &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-handle"}, accountservice.LocalAppOperationOpenConversation, localappop.Selector{AgentID: "agent-handle"}},
		{protectedSendConversationTurnMethod, &runtimev1.SendAppMessageRequest{MessageType: "runtime.agent.turn.request", Payload: payload}, accountservice.LocalAppOperationSendConversationTurn, localappop.Selector{AgentID: "agent-handle", ConversationAnchorID: "anchor-a", TurnID: "request-a"}},
		{protectedSendConversationTurnMethod, &runtimev1.SendAppMessageRequest{MessageType: "runtime.agent.turn.interrupt", Payload: interruptPayload}, accountservice.LocalAppOperationInterruptConversation, localappop.Selector{AgentID: "agent-handle", ConversationAnchorID: "anchor-a"}},
		{protectedConversationSnapshotMethod, &runtimev1.GetPublicChatSessionSnapshotRequest{AgentId: "agent-handle", ConversationAnchorId: "anchor-a"}, accountservice.LocalAppOperationConversationSnapshot, localappop.Selector{AgentID: "agent-handle", ConversationAnchorID: "anchor-a"}},
	} {
		operation, selector, selected := selectedLocalAppUnaryOperation(test.method, test.request)
		if !selected || operation != test.operation || selector != test.selector {
			t.Fatalf("selected conversation operation = (%q, %+v, %v), want (%q, %+v, true)", operation, selector, selected, test.operation, test.selector)
		}
	}
	operation, selector, selected := selectedLocalAppStreamOperation(protectedSubscribeConversationMethod, &runtimev1.SubscribeAppMessagesRequest{LocalAgentRef: "agent-handle", ConversationAnchorId: "anchor-a"})
	if !selected || operation != accountservice.LocalAppOperationSubscribeConversation || selector != (localappop.Selector{AgentID: "agent-handle", ConversationAnchorID: "anchor-a"}) {
		t.Fatalf("selected subscription operation = (%q, %+v, %v)", operation, selector, selected)
	}
}

func TestProtectedLocalAppTransportRejectsUnadmittedStreams(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xb1)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0xb2), SessionProof: grpcLocalAppIdentifier(0xb3)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newStreamProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentVoiceStream",
	} {
		handlerCalled := false
		err := interceptor(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: method}, func(_ any, _ grpc.ServerStream) error {
			handlerCalled = true
			return nil
		})
		if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
			t.Fatalf("unadmitted local-app stream %s: called=%v reason=%v err=%v", method, handlerCalled, localAppTransportReason(err), err)
		}
	}
}

func TestProtectedLocalAppSubscriptionChecksReservedAdmissionBeforeHandler(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xb4)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0xb5), SessionProof: grpcLocalAppIdentifier(0xb6)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newStreamProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: localAppTransportReasonError{reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE}})
	handlerCalled := false
	err := interceptor(nil, &localAppTransportTestStream{ctx: ctx}, &grpc.StreamServerInfo{FullMethod: protectedSubscribeConversationMethod}, func(_ any, stream grpc.ServerStream) error {
		handlerCalled = true
		return stream.RecvMsg(&runtimev1.SubscribeAppMessagesRequest{})
	})
	if !handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("reserved subscription admission = called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
}

func TestProtectedLocalAppTransportPreservesClosedAuthorizationReasons(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xc1)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
		SessionID: grpcLocalAppIdentifier(0xc2), SessionProof: grpcLocalAppIdentifier(0xc3),
	}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	for _, reason := range []runtimev1.ReasonCode{
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED,
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED,
		runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED,
		runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED,
		runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
		runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED,
		runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED,
	} {
		authorizer := localAppTransportAuthorizer{err: localAppTransportReasonError{reason: reason}}
		interceptor := newUnaryProtectedLocalAppTransportInterceptor(authorizer)
		handlerCalled := false
		_, err := interceptor(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return nil, nil
		})
		if handlerCalled || localAppTransportReason(err) != reason {
			t.Fatalf("reason %s collapsed: called=%v got=%s err=%v", reason, handlerCalled, localAppTransportReason(err), err)
		}
	}

	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: errors.New("private failure")})
	_, err := interceptor(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		t.Fatal("arbitrary authorization error reached handler")
		return nil, nil
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("arbitrary error projected as %s", got)
	}

}

func TestProtectedLocalAppSelectedOperationsFailClosedWithoutAuthorizer(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xd1)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
		SessionID: grpcLocalAppIdentifier(0xd2), SessionProof: grpcLocalAppIdentifier(0xd3),
	}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newUnaryProtectedLocalAppTransportInterceptor()
	_, err := interceptor(ctx, &runtimev1.ReadLocalAppStorageJsonRequest{RelativePath: "state.json"}, &grpc.UnaryServerInfo{FullMethod: protectedReadLocalAppStorageJSONMethod}, func(context.Context, any) (any, error) {
		t.Fatal("missing operation authorizer reached handler")
		return nil, nil
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("missing authorizer reason = %s", got)
	}
}

type reservedLocalAppAccountTestService struct {
	runtimev1.UnimplementedRuntimeAccountServiceServer
}

func (*reservedLocalAppAccountTestService) AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error) {
	return accountservice.LocalAppCallerDecision{}, localAppTransportReasonError{reason: runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE}
}

type protectedLocalAppTestListener struct {
	*bufconn.Listener
	connection *protectedlocal.LocalAppConnection
}

func (listener *protectedLocalAppTestListener) Accept() (net.Conn, error) {
	connection, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &protectedLocalAppNetConn{Conn: connection, connection: listener.connection}, nil
}

type localAppTransportReasonError struct{ reason runtimev1.ReasonCode }

func (err localAppTransportReasonError) Error() string { return "local-app operation denied" }
func (err localAppTransportReasonError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return err.reason
}

type localAppTransportAuthorizer struct{ err error }

func (authorizer localAppTransportAuthorizer) AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error) {
	if authorizer.err != nil {
		return accountservice.LocalAppCallerDecision{}, authorizer.err
	}
	return accountservice.LocalAppCallerDecision{LocalAppPrincipalID: "principal-a", LocalAppRecordID: "record-a"}, nil
}

type localAppTransportTestStream struct{ ctx context.Context }

func (*localAppTransportTestStream) SetHeader(metadata.MD) error  { return nil }
func (*localAppTransportTestStream) SendHeader(metadata.MD) error { return nil }
func (*localAppTransportTestStream) SetTrailer(metadata.MD)       {}
func (stream *localAppTransportTestStream) Context() context.Context {
	return stream.ctx
}
func (*localAppTransportTestStream) SendMsg(any) error { return nil }
func (*localAppTransportTestStream) RecvMsg(any) error { return nil }

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
		OS:                          protectedlocal.OSWindows,
		PID:                         uint32(seed) + 2000,
		CreationMarker:              "grpc-local-app-start",
		OSLoginSession:              "grpc-local-app-logon",
		SecurityPrincipal:           "grpc-local-app-user",
		CanonicalExecutableIdentity: "grpc-local-app-file",
		ExecutableDigest:            grpcLocalAppIdentifier(seed + 1),
		ExecutableTrustSetID:        "grpc-local-app-trust",
	}
	connection, err := protectedlocal.EstablishLocalAppConnection(context.Background(), grpcLocalAppVerifier{peer: protectedlocal.VerifiedLocalAppLaunchPeer{
		LaunchID:         grpcLocalAppIdentifier(seed),
		Process:          process,
		RuntimeBootEpoch: grpcLocalAppIdentifier(seed + 2),
		ProcessLiveness:  liveness,
		TrustClass:       protectedlocal.LocalAppTrustLocalDevelopment,
	}})
	if err != nil {
		t.Fatalf("establish gRPC local-app connection: %v", err)
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
