package grpcserver

import (
	"context"
	"fmt"
	"net"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/apppermission"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

const (
	protectedOpenLocalAppSessionMethod         = "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession"
	protectedRenewLocalAppSessionMethod        = "/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession"
	protectedGetLocalAppPermissionStatusMethod = "/nimi.runtime.v1.RuntimeAccountService/GetLocalAppPermissionStatus"
	protectedRequestLocalAppPermissionMethod   = "/nimi.runtime.v1.RuntimeAccountService/RequestLocalAppPermission"
	protectedReadLocalAppStorageJSONMethod     = "/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson"
	protectedWriteLocalAppStorageJSONMethod    = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson"
	protectedRemoveLocalAppStorageJSONMethod   = "/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson"
	protectedOpenConversationMethod            = "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor"
	protectedSendConversationTurnMethod        = "/nimi.runtime.v1.RuntimeAppService/SendAppMessage"
	protectedSubscribeConversationMethod       = "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages"
	protectedConversationSnapshotMethod        = "/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot"
	protectedConfigurationSnapshotMethod       = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentConfigurationSnapshot"
	protectedUpdateConfigurationMethod         = "/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentConfiguration"
	protectedReadinessSnapshotMethod           = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentReadinessSnapshot"
	protectedAutonomySnapshotMethod            = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentAutonomySnapshot"
	protectedUpdateAutonomyMethod              = "/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentAutonomy"
	protectedPresentationSnapshotMethod        = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentPresentationSnapshot"
	protectedCommitPresentationMethod          = "/nimi.runtime.v1.RuntimeAgentService/CommitLocalAppAgentPresentation"
)

type protectedLocalAppMethodPolicy struct {
	transport         protectedlocal.TransportClass
	role              protectedlocal.OriginRole
	missingRoleReason runtimev1.ReasonCode
}

type protectedLocalAppOperationAuthorizer interface {
	AuthorizeLocalAppProtectedOperation(context.Context, accountservice.LocalAppOperation, localappop.Selector) (accountservice.LocalAppCallerDecision, error)
}

var protectedLocalAppUnaryMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedOpenLocalAppSessionMethod: {
		transport:         protectedlocal.TransportLocalAppBootstrap,
		role:              protectedlocal.RoleLocalAppProcess,
		missingRoleReason: runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
	},
	protectedRenewLocalAppSessionMethod:        localAppSessionMethodPolicy(),
	protectedGetLocalAppPermissionStatusMethod: localAppSessionMethodPolicy(),
	protectedRequestLocalAppPermissionMethod:   localAppSessionMethodPolicy(),
	protectedReadLocalAppStorageJSONMethod:     localAppSessionMethodPolicy(),
	protectedWriteLocalAppStorageJSONMethod:    localAppSessionMethodPolicy(),
	protectedRemoveLocalAppStorageJSONMethod:   localAppSessionMethodPolicy(),
	protectedOpenConversationMethod:            localAppSessionMethodPolicy(),
	protectedSendConversationTurnMethod:        localAppSessionMethodPolicy(),
	protectedConversationSnapshotMethod:        localAppSessionMethodPolicy(),
	protectedConfigurationSnapshotMethod:       localAppSessionMethodPolicy(),
	protectedUpdateConfigurationMethod:         localAppSessionMethodPolicy(),
	protectedReadinessSnapshotMethod:           localAppSessionMethodPolicy(),
	protectedAutonomySnapshotMethod:            localAppSessionMethodPolicy(),
	protectedUpdateAutonomyMethod:              localAppSessionMethodPolicy(),
	protectedPresentationSnapshotMethod:        localAppSessionMethodPolicy(),
	protectedCommitPresentationMethod:          localAppSessionMethodPolicy(),
}

var protectedLocalAppStreamMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedSubscribeConversationMethod: localAppSessionMethodPolicy(),
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
	agentService runtimev1.RuntimeAgentServiceServer,
	appService runtimev1.RuntimeAppServiceServer,
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
	runtimev1.RegisterRuntimeAgentServiceServer(server, agentService)
	runtimev1.RegisterRuntimeAppServiceServer(server, appService)
	return server
}

func newUnaryProtectedLocalAppTransportInterceptor(authorizers ...any) grpc.UnaryServerInterceptor {
	var operationAuthorizer protectedLocalAppOperationAuthorizer
	if len(authorizers) > 0 {
		operationAuthorizer, _ = authorizers[0].(protectedLocalAppOperationAuthorizer)
	}
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info == nil {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
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
		if operation, selector, selected := selectedLocalAppUnaryOperation(info.FullMethod, req); selected {
			if operationAuthorizer == nil {
				return nil, protectedLocalAppOperationFailure(operation, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
			}
			decision, authorizeErr := operationAuthorizer.AuthorizeLocalAppProtectedOperation(protectedContext, operation, selector)
			if authorizeErr != nil {
				reason := accountservice.LocalAppOperationAuthorizationReason(authorizeErr)
				return nil, protectedLocalAppOperationFailure(operation, reason)
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
	authorized          bool
}

func (stream *protectedLocalAppServerStream) Context() context.Context { return stream.ctx }

func (stream *protectedLocalAppServerStream) RecvMsg(message any) error {
	if err := stream.ServerStream.RecvMsg(message); err != nil {
		return err
	}
	if stream.authorized {
		return nil
	}
	operation, selector, selected := selectedLocalAppStreamOperation(stream.method, message)
	if !selected {
		return nil
	}
	if stream.operationAuthorizer == nil {
		return protectedLocalAppOperationFailure(operation, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	}
	decision, err := stream.operationAuthorizer.AuthorizeLocalAppProtectedOperation(stream.ctx, operation, selector)
	if err != nil {
		return protectedLocalAppOperationFailure(operation, accountservice.LocalAppOperationAuthorizationReason(err))
	}
	stream.ctx = accountservice.ContextWithAuthorizedLocalAppDecision(stream.ctx, decision)
	stream.authorized = true
	return nil
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
		return handler(srv, &protectedLocalAppServerStream{
			ServerStream: stream, ctx: ctx, method: info.FullMethod, operationAuthorizer: operationAuthorizer,
		})
	}
}

func selectedLocalAppUnaryOperation(method string, request any) (accountservice.LocalAppOperation, localappop.Selector, bool) {
	switch method {
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
	case protectedOpenConversationMethod:
		req, ok := request.(*runtimev1.OpenConversationAnchorRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationOpenConversation, localappop.Selector{AgentID: req.GetAgentId()}, true
	case protectedSendConversationTurnMethod:
		req, ok := request.(*runtimev1.SendAppMessageRequest)
		if !ok || req.GetPayload() == nil {
			return "", localappop.Selector{}, true
		}
		fields := req.GetPayload().GetFields()
		return accountservice.LocalAppOperationSendConversationTurn, localappop.Selector{
			AgentID: fields["local_agent_ref"].GetStringValue(), ConversationAnchorID: fields["conversation_anchor_id"].GetStringValue(), TurnID: fields["request_id"].GetStringValue(),
		}, true
	case protectedConversationSnapshotMethod:
		req, ok := request.(*runtimev1.GetPublicChatSessionSnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationConversationSnapshot, localappop.Selector{AgentID: req.GetAgentId(), ConversationAnchorID: req.GetConversationAnchorId()}, true
	case protectedConfigurationSnapshotMethod:
		req, ok := request.(*runtimev1.GetLocalAppAgentConfigurationSnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationConfigurationSnapshot, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedUpdateConfigurationMethod:
		req, ok := request.(*runtimev1.UpdateLocalAppAgentConfigurationRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationUpdateConfiguration, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedReadinessSnapshotMethod:
		req, ok := request.(*runtimev1.GetLocalAppAgentReadinessSnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationReadinessSnapshot, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedAutonomySnapshotMethod:
		req, ok := request.(*runtimev1.GetLocalAppAgentAutonomySnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationAutonomySnapshot, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedUpdateAutonomyMethod:
		req, ok := request.(*runtimev1.UpdateLocalAppAgentAutonomyRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationUpdateAutonomy, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedPresentationSnapshotMethod:
		req, ok := request.(*runtimev1.GetLocalAppAgentPresentationSnapshotRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationPresentationSnapshot, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	case protectedCommitPresentationMethod:
		req, ok := request.(*runtimev1.CommitLocalAppAgentPresentationRequest)
		if !ok {
			return "", localappop.Selector{}, true
		}
		return accountservice.LocalAppOperationCommitPresentation, localappop.Selector{AgentID: req.GetAgentHandle()}, true
	default:
		return "", localappop.Selector{}, false
	}
}

func selectedLocalAppStreamOperation(method string, request any) (accountservice.LocalAppOperation, localappop.Selector, bool) {
	if method != protectedSubscribeConversationMethod {
		return "", localappop.Selector{}, false
	}
	req, ok := request.(*runtimev1.SubscribeAppMessagesRequest)
	if !ok {
		return "", localappop.Selector{}, true
	}
	return accountservice.LocalAppOperationSubscribeConversation, localappop.Selector{
		AgentID: req.GetLocalAgentRef(), ConversationAnchorID: req.GetConversationAnchorId(),
	}, true
}

func protectedLocalAppOperationFailure(operation accountservice.LocalAppOperation, reason runtimev1.ReasonCode) error {
	code := codes.PermissionDenied
	if reason == runtimev1.ReasonCode_APP_STORAGE_PATH_INVALID {
		code = codes.InvalidArgument
	} else if reason == runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED || reason == runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN {
		code = codes.Unavailable
	}
	metadata := map[string]string{}
	if permission, ok := apppermission.ForOperation(string(operation)); ok {
		metadata["permission_id"] = permission.ID
	}
	switch reason {
	case runtimev1.ReasonCode_LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED:
		metadata["permission_reason"] = "reserved_not_admitted"
	case runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REQUIRED:
		metadata["permission_reason"] = "not_granted"
	case runtimev1.ReasonCode_LOCAL_APP_PERMISSION_DENIED:
		metadata["permission_reason"] = "denied"
	case runtimev1.ReasonCode_LOCAL_APP_PERMISSION_REVOKED:
		metadata["permission_reason"] = "revoked"
	case runtimev1.ReasonCode_LOCAL_APP_PERMISSION_UNKNOWN:
		metadata["permission_reason"] = "unknown"
	case runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE:
		if metadata["permission_id"] != "" {
			metadata["permission_reason"] = "unavailable"
		}
	}
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Metadata: metadata})
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
