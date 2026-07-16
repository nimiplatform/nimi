package grpcserver

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestProtectedLocalAppTransportRejectsOrdinaryConnection(t *testing.T) {
	serverSide, clientSide := net.Pipe()
	defer serverSide.Close()
	defer clientSide.Close()
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

func TestProtectedLocalAppUnaryPolicyRequiresAtomicBootstrapPromotion(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xa1)
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})

	handlerCalled := false
	_, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedReadArtifactBytesMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached host operation: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
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
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(handlerCtx context.Context, _ any) (any, error) {
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
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{FullMethod: protectedReadArtifactBytesMethod}, func(context.Context, any) (any, error) {
		handlerCalled = true
		return nil, nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH {
		t.Fatalf("revoked native process reached handler: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
}

func TestLocalAppGrantPreflightDistinguishesRawUncarriedFromStaleProcess(t *testing.T) {
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	invoke := func(ctx context.Context) runtimev1.ReasonCode {
		_, err := interceptor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-a"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(context.Context, any) (any, error) {
			t.Fatal("untrusted process reached selected operation")
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

func TestProtectedLocalAppPoliciesExposeOnlyFinalSelectedOperations(t *testing.T) {
	for _, method := range []string{
		protectedOpenLocalAppSessionMethod,
		protectedGetLocalAppGrantStatusMethod,
		protectedRequestLocalAppGrantMethod,
		protectedReadArtifactBytesMethod,
		protectedListLocalAppAgentInventoryMethod,
		protectedOpenConversationAnchorMethod,
		protectedGetPublicChatSnapshotMethod,
		protectedSendAppMessageMethod,
		protectedReadLocalAppStorageJSONMethod,
		protectedWriteLocalAppStorageJSONMethod,
		protectedRemoveLocalAppStorageJSONMethod,
		protectedTranscribeLocalAppAgentAudioMethod,
	} {
		if !protectedLocalAppUnaryMethodAllowed(method) {
			t.Fatalf("final unary operation is missing: %s", method)
		}
	}
	for _, method := range []string{protectedSubscribeAppMessagesMethod, protectedSubscribeAgentVoiceStreamMethod} {
		if !protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("final selected stream is missing: %s", method)
		}
	}
	for _, method := range []string{
		"/nimi.runtime.v1.RuntimeAuthService/RegisterApp",
		"/nimi.runtime.v1.RuntimeArtifactService/CleanupGeneratedVoiceArtifacts",
		"/nimi.runtime.v1.RuntimeDevelopmentService/EvaluateLocalDevelopmentProject",
	} {
		if protectedLocalAppUnaryMethodAllowed(method) || protectedLocalAppStreamMethodAllowed(method) {
			t.Fatalf("unadmitted method reached local-app transport: %s", method)
		}
	}
}

func TestSelectedProtectedLocalAppVoiceOperationsCarryOnlyExactSelectors(t *testing.T) {
	operation, selector, selected := selectedLocalAppUnaryOperation(protectedTranscribeLocalAppAgentAudioMethod, &runtimev1.TranscribeLocalAppAgentAudioRequest{
		AgentId: "local-agent:voice", ClientRequestId: "request-1", Audio: []byte("private-audio"), MimeType: "audio/wav",
	})
	if !selected || operation != accountservice.LocalAppOperationVoiceTranscribe || selector != (localappop.Selector{AgentID: "local-agent:voice"}) {
		t.Fatalf("selected transcription operation = (%q, %+v, %v)", operation, selector, selected)
	}

	recorder := &localAppTransportRecordingAuthorizer{}
	requestStream := &localAppTransportVoiceRequestStream{
		localAppTransportTestStream: localAppTransportTestStream{ctx: context.Background()},
		request: runtimev1.SubscribeAgentVoiceStreamRequest{
			AgentId: "local-agent:voice", ConversationAnchorId: "anchor-1", TurnId: "turn-1", VoiceStreamId: "voice-1",
		},
	}
	wrapped := &protectedLocalAppServerStream{
		ServerStream: requestStream, ctx: context.Background(), method: protectedSubscribeAgentVoiceStreamMethod, operationAuthorizer: recorder,
	}
	var received runtimev1.SubscribeAgentVoiceStreamRequest
	if err := wrapped.RecvMsg(&received); err != nil {
		t.Fatalf("authorize voice stream request: %v", err)
	}
	want := localappop.Selector{AgentID: "local-agent:voice", ConversationAnchorID: "anchor-1", TurnID: "turn-1", VoiceStreamID: "voice-1"}
	if recorder.operation != accountservice.LocalAppOperationVoiceStreamSubscribe || recorder.selector != want {
		t.Fatalf("selected voice stream operation = (%q, %+v)", recorder.operation, recorder.selector)
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(wrapped.Context())
	if !ok || decision.Operation != accountservice.LocalAppOperationVoiceStreamSubscribe {
		t.Fatalf("voice stream decision handoff = (%+v, %v)", decision, ok)
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

func TestProtectedLocalAppStreamRequiresCurrentSession(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xb1)
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newStreamProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	stream := &localAppTransportTestStream{ctx: ctx}
	handlerCalled := false
	err := interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: protectedSubscribeAppMessagesMethod}, func(_ any, handlerStream grpc.ServerStream) error {
		handlerCalled = true
		_, ok := protectedlocal.LocalAppConnectionFromContext(handlerStream.Context())
		if !ok {
			t.Fatal("stream handler did not receive local-app connection")
		}
		return nil
	})
	if handlerCalled || localAppTransportReason(err) != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("bootstrap reached host stream: called=%v reason=%v err=%v", handlerCalled, localAppTransportReason(err), err)
	}
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{
		SessionID:    grpcLocalAppIdentifier(0xb2),
		SessionProof: grpcLocalAppIdentifier(0xb3),
	}); err != nil {
		t.Fatal(err)
	}
	handlerCalled = false
	err = interceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: protectedSubscribeAppMessagesMethod}, func(_ any, handlerStream grpc.ServerStream) error {
		handlerCalled = true
		bound, ok := protectedlocal.LocalAppConnectionFromContext(handlerStream.Context())
		if !ok || bound != connection {
			t.Fatal("stream handler did not receive exact local-app connection")
		}
		return nil
	})
	if err != nil || !handlerCalled {
		t.Fatalf("current local-app session did not reach admitted stream: called=%v err=%v", handlerCalled, err)
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
		runtimev1.ReasonCode_LOCAL_APP_GRANT_REQUIRED,
		runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED,
		runtimev1.ReasonCode_LOCAL_APP_GRANT_SUPERSEDED,
		runtimev1.ReasonCode_LOCAL_APP_PRESENCE_EXPIRED,
		runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
		runtimev1.ReasonCode_LOCAL_APP_ACCOUNT_CHANGED,
		runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED,
	} {
		authorizer := localAppTransportAuthorizer{err: localAppTransportReasonError{reason: reason}}
		interceptor := newUnaryProtectedLocalAppTransportInterceptor(authorizer)
		handlerCalled := false
		_, err := interceptor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-a"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(context.Context, any) (any, error) {
			handlerCalled = true
			return nil, nil
		})
		if handlerCalled || localAppTransportReason(err) != reason {
			t.Fatalf("reason %s collapsed: called=%v got=%s err=%v", reason, handlerCalled, localAppTransportReason(err), err)
		}
	}

	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{err: errors.New("private failure")})
	_, err := interceptor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-a"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(context.Context, any) (any, error) {
		t.Fatal("arbitrary authorization error reached handler")
		return nil, nil
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("arbitrary error projected as %s", got)
	}

	stream := &localAppTransportTestStream{ctx: ctx}
	streamInterceptor := newStreamProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{
		err: localAppTransportReasonError{reason: runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED},
	})
	err = streamInterceptor(nil, stream, &grpc.StreamServerInfo{FullMethod: protectedSubscribeAppMessagesMethod}, func(_ any, handlerStream grpc.ServerStream) error {
		return handlerStream.RecvMsg(&runtimev1.SubscribeAppMessagesRequest{})
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_GRANT_REVOKED {
		t.Fatalf("stream revoked reason collapsed to %s", got)
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
	_, err := interceptor(ctx, &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-a"}, &grpc.UnaryServerInfo{FullMethod: protectedOpenConversationAnchorMethod}, func(context.Context, any) (any, error) {
		t.Fatal("missing operation authorizer reached handler")
		return nil, nil
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("missing authorizer reason = %s", got)
	}
	_, err = interceptor(ctx, &runtimev1.ListLocalAppAgentInventoryRequest{}, &grpc.UnaryServerInfo{FullMethod: protectedListLocalAppAgentInventoryMethod}, func(context.Context, any) (any, error) {
		t.Fatal("missing inventory caller authorizer reached handler")
		return nil, nil
	})
	if got := localAppTransportReason(err); got != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
		t.Fatalf("missing inventory authorizer reason = %s", got)
	}
}

func TestProtectedLocalAppInventoryBindsFreshZeroGrantCallerDecision(t *testing.T) {
	connection := newGRPCLocalAppConnection(t, 0xe1)
	if err := connection.BindSession(protectedlocal.LocalAppSessionHandle{SessionID: grpcLocalAppIdentifier(0xe2), SessionProof: grpcLocalAppIdentifier(0xe3)}); err != nil {
		t.Fatal(err)
	}
	ctx := peer.NewContext(context.Background(), &peer.Peer{AuthInfo: &protectedLocalAppAuthInfo{connection: connection}})
	interceptor := newUnaryProtectedLocalAppTransportInterceptor(localAppTransportAuthorizer{})
	called := false
	_, err := interceptor(ctx, &runtimev1.ListLocalAppAgentInventoryRequest{}, &grpc.UnaryServerInfo{FullMethod: protectedListLocalAppAgentInventoryMethod}, func(handlerCtx context.Context, _ any) (any, error) {
		called = true
		decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(handlerCtx)
		if !ok || decision.LocalAppPrincipalID != "principal-a" || decision.Operation != "" {
			t.Fatalf("inventory caller decision = %+v, present=%v", decision, ok)
		}
		return nil, nil
	})
	if err != nil || !called {
		t.Fatalf("inventory decision handoff = called=%v err=%v", called, err)
	}
}

type localAppTransportReasonError struct{ reason runtimev1.ReasonCode }

func (err localAppTransportReasonError) Error() string { return "local-app operation denied" }
func (err localAppTransportReasonError) LocalAppOperationReasonCode() runtimev1.ReasonCode {
	return err.reason
}

type localAppTransportAuthorizer struct{ err error }

func (authorizer localAppTransportAuthorizer) AuthorizeLocalAppCaller(context.Context) (accountservice.LocalAppCallerDecision, error) {
	if authorizer.err != nil {
		return accountservice.LocalAppCallerDecision{}, authorizer.err
	}
	return accountservice.LocalAppCallerDecision{LocalAppPrincipalID: "principal-a", LocalAppRecordID: "record-a"}, nil
}

type localAppTransportRecordingAuthorizer struct {
	operation accountservice.LocalAppOperation
	selector  localappop.Selector
}

func (authorizer *localAppTransportRecordingAuthorizer) AuthorizeLocalAppProtectedOperation(_ context.Context, operation accountservice.LocalAppOperation, selector localappop.Selector) (accountservice.LocalAppCallerDecision, error) {
	authorizer.operation = operation
	authorizer.selector = selector
	return accountservice.LocalAppCallerDecision{
		LocalAppPrincipalID: "principal-voice", LocalAppRecordID: "record-voice", Operation: operation,
	}, nil
}

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

type localAppTransportVoiceRequestStream struct {
	localAppTransportTestStream
	request runtimev1.SubscribeAgentVoiceStreamRequest
}

func (stream *localAppTransportVoiceRequestStream) RecvMsg(message any) error {
	target, ok := message.(*runtimev1.SubscribeAgentVoiceStreamRequest)
	if !ok {
		return errors.New("unexpected voice request target")
	}
	proto.Merge(target, &stream.request)
	return nil
}

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
