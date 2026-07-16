package grpcserver

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	protectedOpenLocalAppSessionMethod          = "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession"
	protectedGetLocalAppGrantStatusMethod       = "/nimi.runtime.v1.RuntimeAccountService/GetLocalAppGrantStatus"
	protectedRequestLocalAppGrantMethod         = "/nimi.runtime.v1.RuntimeAccountService/RequestLocalAppGrant"
	protectedReadArtifactBytesMethod            = "/nimi.runtime.v1.RuntimeArtifactService/ReadArtifactBytes"
	protectedListLocalAppAgentInventoryMethod   = "/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentInventory"
	protectedOpenConversationAnchorMethod       = "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor"
	protectedGetPublicChatSnapshotMethod        = "/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot"
	protectedSendAppMessageMethod               = "/nimi.runtime.v1.RuntimeAppService/SendAppMessage"
	protectedReadLocalAppStorageJSONMethod      = "/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson"
	protectedWriteLocalAppStorageJSONMethod     = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson"
	protectedRemoveLocalAppStorageJSONMethod    = "/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson"
	protectedTranscribeLocalAppAgentAudioMethod = "/nimi.runtime.v1.RuntimeAgentService/TranscribeLocalAppAgentAudio"
	protectedSubscribeAppMessagesMethod         = "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages"
	protectedSubscribeAgentVoiceStreamMethod    = "/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentVoiceStream"
)

type protectedLocalAppMethodPolicy struct {
	transport         protectedlocal.TransportClass
	role              protectedlocal.OriginRole
	missingRoleReason runtimev1.ReasonCode
}

type protectedLocalAppOperationAuthorizer interface {
	AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error)
}

type protectedLocalAppCallerAuthorizer interface {
	AuthorizeLocalAppCaller(context.Context) (accountservice.LocalAppCallerDecision, error)
}

var protectedLocalAppUnaryMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedOpenLocalAppSessionMethod: {
		transport:         protectedlocal.TransportLocalAppBootstrap,
		role:              protectedlocal.RoleLocalAppProcess,
		missingRoleReason: runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
	},
	protectedGetLocalAppGrantStatusMethod:       localAppSessionMethodPolicy(),
	protectedRequestLocalAppGrantMethod:         localAppSessionMethodPolicy(),
	protectedReadArtifactBytesMethod:            localAppSessionMethodPolicy(),
	protectedListLocalAppAgentInventoryMethod:   localAppSessionMethodPolicy(),
	protectedOpenConversationAnchorMethod:       localAppSessionMethodPolicy(),
	protectedGetPublicChatSnapshotMethod:        localAppSessionMethodPolicy(),
	protectedSendAppMessageMethod:               localAppSessionMethodPolicy(),
	protectedReadLocalAppStorageJSONMethod:      localAppSessionMethodPolicy(),
	protectedWriteLocalAppStorageJSONMethod:     localAppSessionMethodPolicy(),
	protectedRemoveLocalAppStorageJSONMethod:    localAppSessionMethodPolicy(),
	protectedTranscribeLocalAppAgentAudioMethod: localAppSessionMethodPolicy(),
}

var protectedLocalAppStreamMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedSubscribeAppMessagesMethod:      localAppSessionMethodPolicy(),
	protectedSubscribeAgentVoiceStreamMethod: localAppSessionMethodPolicy(),
}

func localAppSessionMethodPolicy() protectedLocalAppMethodPolicy {
	return protectedLocalAppMethodPolicy{
		transport:         protectedlocal.TransportLocalAppHost,
		role:              protectedlocal.RoleLocalAppSession,
		missingRoleReason: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED,
	}
}

func protectedLocalAppUnaryMethodAllowed(method string) bool {
	_, allowed := protectedLocalAppUnaryMethodPolicies[method]
	return allowed
}

func protectedLocalAppStreamMethodAllowed(method string) bool {
	_, allowed := protectedLocalAppStreamMethodPolicies[method]
	return allowed
}

type protectedLocalAppNetConn struct {
	net.Conn
	connection *protectedlocal.LocalAppConnection
	closeOnce  sync.Once
	closeErr   error
}

func (connection *protectedLocalAppNetConn) Close() error {
	if connection == nil {
		return nil
	}
	connection.closeOnce.Do(func() {
		if connection.Conn != nil {
			connection.closeErr = connection.Conn.Close()
		}
		if connection.connection != nil {
			connection.connection.Revoke()
		}
	})
	return connection.closeErr
}

type nativeVerifiedLocalAppListener struct{ net.Listener }

func (listener *nativeVerifiedLocalAppListener) Accept() (net.Conn, error) {
	if listener == nil || listener.Listener == nil {
		return nil, fmt.Errorf("verified native local-app listener is required")
	}
	raw, err := listener.Listener.Accept()
	if err != nil {
		return nil, err
	}
	connection, ok := protectedlocal.NativeLocalAppConnectionFromNetConn(raw)
	if !ok {
		_ = raw.Close()
		return nil, fmt.Errorf("native local-app listener returned an unverified connection")
	}
	return &protectedLocalAppNetConn{Conn: raw, connection: connection}, nil
}

type protectedLocalAppAuthInfo struct {
	connection *protectedlocal.LocalAppConnection
}

func (*protectedLocalAppAuthInfo) AuthType() string { return "nimi-protected-local-app-v1" }

type protectedLocalAppTransportCredentials struct{}

func (protectedLocalAppTransportCredentials) ClientHandshake(context.Context, string, net.Conn) (net.Conn, credentials.AuthInfo, error) {
	return nil, nil, fmt.Errorf("protected local-app transport credentials are server-only")
}

func (protectedLocalAppTransportCredentials) ServerHandshake(raw net.Conn) (net.Conn, credentials.AuthInfo, error) {
	connection, ok := raw.(*protectedLocalAppNetConn)
	if !ok || connection == nil || connection.Conn == nil || connection.connection == nil || !connection.connection.Live() {
		return nil, nil, fmt.Errorf("protected local-app transport requires a live native verified connection")
	}
	return raw, &protectedLocalAppAuthInfo{connection: connection.connection}, nil
}

func (protectedLocalAppTransportCredentials) Info() credentials.ProtocolInfo {
	return credentials.ProtocolInfo{SecurityProtocol: "nimi-protected-local-app", SecurityVersion: "1"}
}

func (protectedLocalAppTransportCredentials) Clone() credentials.TransportCredentials {
	return protectedLocalAppTransportCredentials{}
}

func (protectedLocalAppTransportCredentials) OverrideServerName(string) error {
	return fmt.Errorf("protected local-app transport has no portable server name")
}

func newProtectedLocalAppRPCServer(
	runtimeControlService runtimev1.RuntimeServiceControlServiceServer,
	authService runtimev1.RuntimeAuthServiceServer,
	accountService runtimev1.RuntimeAccountServiceServer,
	appService runtimev1.RuntimeAppServiceServer,
	artifactService runtimev1.RuntimeArtifactServiceServer,
	agentService runtimev1.RuntimeAgentServiceServer,
) *grpc.Server {
	server := grpc.NewServer(
		grpc.Creds(protectedLocalAppTransportCredentials{}),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.UnaryInterceptor(newUnaryProtectedLocalAppTransportInterceptor(accountService)),
		grpc.StreamInterceptor(newStreamProtectedLocalAppTransportInterceptor(accountService)),
	)
	runtimev1.RegisterRuntimeServiceControlServiceServer(server, runtimeControlService)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountService)
	runtimev1.RegisterRuntimeAppServiceServer(server, appService)
	runtimev1.RegisterRuntimeArtifactServiceServer(server, artifactService)
	runtimev1.RegisterRuntimeAgentServiceServer(server, agentService)
	return server
}

func newUnaryProtectedLocalAppTransportInterceptor(authorizers ...any) grpc.UnaryServerInterceptor {
	var operationAuthorizer protectedLocalAppOperationAuthorizer
	var callerAuthorizer protectedLocalAppCallerAuthorizer
	if len(authorizers) > 0 {
		operationAuthorizer, _ = authorizers[0].(protectedLocalAppOperationAuthorizer)
		callerAuthorizer, _ = authorizers[0].(protectedLocalAppCallerAuthorizer)
	}
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if immutablePackageTransportDenied(info.FullMethod) {
			return nil, immutablePackageTransportUnavailable()
		}
		policy, allowed := protectedLocalAppUnaryMethodPolicies[info.FullMethod]
		if !allowed {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedLocalAppConnectionFromPeer(ctx)
		if err != nil {
			return nil, err
		}
		if !protectedLocalAppPolicyAllows(connection.Origin(), policy) {
			return nil, protectedLocalAppRoleError(policy.missingRoleReason)
		}
		protectedContext := protectedlocal.ContextWithLocalAppConnection(ctx, connection)
		if info.FullMethod == protectedListLocalAppAgentInventoryMethod {
			if callerAuthorizer == nil {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			decision, authorizeErr := callerAuthorizer.AuthorizeLocalAppCaller(protectedContext)
			if authorizeErr != nil {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, accountservice.LocalAppCallerAuthorizationReason(authorizeErr))
			}
			protectedContext = accountservice.ContextWithAuthorizedLocalAppDecision(protectedContext, decision)
		}
		if operation, selector, selected := selectedLocalAppUnaryOperation(info.FullMethod, req); selected {
			if operationAuthorizer == nil {
				return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			decision, authorizeErr := operationAuthorizer.AuthorizeLocalAppProtectedOperation(protectedContext, operation, selector)
			if authorizeErr != nil {
				reason := accountservice.LocalAppOperationAuthorizationReason(authorizeErr)
				return nil, protectedLocalAppOperationFailure(reason)
			}
			protectedContext = accountservice.ContextWithAuthorizedLocalAppDecision(protectedContext, decision)
		}
		return handler(protectedContext, req)
	}
}

type protectedLocalAppServerStream struct {
	grpc.ServerStream
	ctx                 context.Context
	method              string
	operationAuthorizer protectedLocalAppOperationAuthorizer
	authorizeOnce       sync.Once
	authorizeErr        error
}

func (stream *protectedLocalAppServerStream) Context() context.Context { return stream.ctx }

func (stream *protectedLocalAppServerStream) RecvMsg(message any) error {
	if err := stream.ServerStream.RecvMsg(message); err != nil {
		return err
	}
	stream.authorizeOnce.Do(func() {
		if stream.operationAuthorizer == nil {
			stream.authorizeErr = grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			return
		}
		var operation accountservice.LocalAppOperation
		var selector localappop.Selector
		switch stream.method {
		case protectedSubscribeAppMessagesMethod:
			request, ok := message.(*runtimev1.SubscribeAppMessagesRequest)
			if !ok {
				stream.authorizeErr = grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
				return
			}
			operation = accountservice.LocalAppOperationSubscribeConversation
			selector = localappop.Selector{AgentID: strings.TrimSpace(request.GetLocalAgentRef()), ConversationAnchorID: strings.TrimSpace(request.GetConversationAnchorId())}
		case protectedSubscribeAgentVoiceStreamMethod:
			request, ok := message.(*runtimev1.SubscribeAgentVoiceStreamRequest)
			if !ok {
				stream.authorizeErr = grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
				return
			}
			operation = accountservice.LocalAppOperationVoiceStreamSubscribe
			selector = localappop.Selector{
				AgentID: strings.TrimSpace(request.GetAgentId()), ConversationAnchorID: strings.TrimSpace(request.GetConversationAnchorId()),
				TurnID: strings.TrimSpace(request.GetTurnId()), VoiceStreamID: strings.TrimSpace(request.GetVoiceStreamId()),
			}
		default:
			stream.authorizeErr = grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			return
		}
		decision, err := stream.operationAuthorizer.AuthorizeLocalAppProtectedOperation(stream.ctx, operation, selector)
		if err != nil {
			reason := accountservice.LocalAppOperationAuthorizationReason(err)
			stream.authorizeErr = grpcerr.WithReasonCode(codes.PermissionDenied, reason)
			return
		}
		stream.ctx = accountservice.ContextWithAuthorizedLocalAppDecision(stream.ctx, decision)
	})
	return stream.authorizeErr
}

func newStreamProtectedLocalAppTransportInterceptor(authorizers ...any) grpc.StreamServerInterceptor {
	var operationAuthorizer protectedLocalAppOperationAuthorizer
	if len(authorizers) > 0 {
		operationAuthorizer, _ = authorizers[0].(protectedLocalAppOperationAuthorizer)
	}
	return func(srv any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if info == nil {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		if immutablePackageTransportDenied(info.FullMethod) {
			return immutablePackageTransportUnavailable()
		}
		policy, allowed := protectedLocalAppStreamMethodPolicies[info.FullMethod]
		if !allowed {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		connection, err := protectedLocalAppConnectionFromPeer(stream.Context())
		if err != nil {
			return err
		}
		if !protectedLocalAppPolicyAllows(connection.Origin(), policy) {
			return protectedLocalAppRoleError(policy.missingRoleReason)
		}
		ctx := protectedlocal.ContextWithLocalAppConnection(stream.Context(), connection)
		return handler(srv, &protectedLocalAppServerStream{ServerStream: stream, ctx: ctx, method: info.FullMethod, operationAuthorizer: operationAuthorizer})
	}
}

func selectedLocalAppUnaryOperation(method string, request any) (accountservice.LocalAppOperation, localappop.Selector, bool) {
	switch method {
	case protectedReadArtifactBytesMethod:
		req, ok := request.(*runtimev1.ReadArtifactBytesRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationReadArtifactBytes, localappop.Selector{ArtifactID: strings.TrimSpace(req.GetArtifactId())}, true
	case protectedOpenConversationAnchorMethod:
		req, ok := request.(*runtimev1.OpenConversationAnchorRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationOpenConversation, localappop.Selector{AgentID: strings.TrimSpace(req.GetAgentId())}, true
	case protectedGetPublicChatSnapshotMethod:
		req, ok := request.(*runtimev1.GetPublicChatSessionSnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationConversationSnapshot, localappop.Selector{AgentID: strings.TrimSpace(req.GetAgentId()), ConversationAnchorID: strings.TrimSpace(req.GetConversationAnchorId())}, true
	case protectedSendAppMessageMethod:
		req, ok := request.(*runtimev1.SendAppMessageRequest)
		if !ok || req.GetPayload() == nil {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationSendConversationTurn, localappop.Selector{
			AgentID:              localAppStructString(req.GetPayload(), "local_agent_ref"),
			ConversationAnchorID: localAppStructString(req.GetPayload(), "conversation_anchor_id"),
			TurnID:               localAppStructString(req.GetPayload(), "request_id"),
		}, true
	case protectedReadLocalAppStorageJSONMethod:
		req, ok := request.(*runtimev1.ReadLocalAppStorageJsonRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationStorageJSONRead, localappop.Selector{StorageRelativePath: req.GetRelativePath()}, true
	case protectedWriteLocalAppStorageJSONMethod:
		req, ok := request.(*runtimev1.WriteLocalAppStorageJsonRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationStorageJSONWrite, localappop.Selector{StorageRelativePath: req.GetRelativePath()}, true
	case protectedRemoveLocalAppStorageJSONMethod:
		req, ok := request.(*runtimev1.RemoveLocalAppStorageJsonRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationStorageJSONRemove, localappop.Selector{StorageRelativePath: req.GetRelativePath()}, true
	case protectedTranscribeLocalAppAgentAudioMethod:
		req, ok := request.(*runtimev1.TranscribeLocalAppAgentAudioRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationVoiceTranscribe, localappop.Selector{AgentID: strings.TrimSpace(req.GetAgentId())}, true
	default:
		return "", localappop.Selector{}, false
	}
}

func protectedLocalAppOperationFailure(reason runtimev1.ReasonCode) error {
	if reason == runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID {
		return grpcerr.WithReasonCode(codes.InvalidArgument, reason)
	}
	return grpcerr.WithReasonCode(codes.PermissionDenied, reason)
}

func localAppStructString(value *structpb.Struct, key string) string {
	if value == nil {
		return ""
	}
	field := value.GetFields()[key]
	if field == nil {
		return ""
	}
	return strings.TrimSpace(field.GetStringValue())
}

func protectedLocalAppConnectionFromPeer(ctx context.Context) (*protectedlocal.LocalAppConnection, error) {
	peerInfo, ok := peer.FromContext(ctx)
	if !ok || peerInfo == nil {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
	}
	authInfo, ok := peerInfo.AuthInfo.(*protectedLocalAppAuthInfo)
	if !ok || authInfo == nil || authInfo.connection == nil || !authInfo.connection.Live() {
		return nil, grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH)
	}
	return authInfo.connection, nil
}

func protectedLocalAppPolicyAllows(origin protectedlocal.OriginContext, policy protectedLocalAppMethodPolicy) bool {
	return origin.TransportClass == policy.transport && origin.HasRole(policy.role)
}

func protectedLocalAppRoleError(reason runtimev1.ReasonCode) error {
	code := codes.PermissionDenied
	if reason == runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		code = codes.Unauthenticated
	}
	return grpcerr.WithReasonCode(code, reason)
}

var _ credentials.AuthInfo = (*protectedLocalAppAuthInfo)(nil)
var _ credentials.TransportCredentials = protectedLocalAppTransportCredentials{}
