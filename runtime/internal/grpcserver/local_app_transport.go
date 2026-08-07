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
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/peer"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

const (
	protectedOpenLocalAppSessionMethod       = "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession"
	protectedRenewLocalAppSessionMethod      = "/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession"
	protectedReadLocalAppStorageJSONMethod   = "/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson"
	protectedWriteLocalAppStorageJSONMethod  = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson"
	protectedRemoveLocalAppStorageJSONMethod = "/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson"
	protectedAgentReferenceListMethod        = "/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences"
	protectedOpenConversationMethod          = "/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppConversation"
	protectedSendConversationTurnMethod      = "/nimi.runtime.v1.RuntimeAgentService/SendLocalAppConversationTurn"
	protectedInterruptConversationTurnMethod = "/nimi.runtime.v1.RuntimeAgentService/InterruptLocalAppConversationTurn"
	protectedSubscribeConversationMethod     = "/nimi.runtime.v1.RuntimeAgentService/SubscribeLocalAppConversationEvents"
	protectedConversationSnapshotMethod      = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppConversationSnapshot"
	protectedGetSharedAIConfigMethod         = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppSharedLocalAgentAIConfig"
	protectedOverwriteSharedAIConfigMethod   = "/nimi.runtime.v1.RuntimeAgentService/OverwriteLocalAppSharedLocalAgentAIConfig"
	protectedSharedAIProfilePreviewMethod    = "/nimi.runtime.v1.RuntimeAgentService/PreviewLocalAppSharedLocalAgentAIProfile"
	protectedSharedAIProfileApplyMethod      = "/nimi.runtime.v1.RuntimeAgentService/ApplyLocalAppSharedLocalAgentAIProfile"
	protectedAutonomySnapshotMethod          = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentAutonomySnapshot"
	protectedUpdateAutonomyMethod            = "/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentAutonomy"
	protectedPresentationSnapshotMethod      = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentPresentationSnapshot"
	protectedCommitPresentationMethod        = "/nimi.runtime.v1.RuntimeAgentService/CommitLocalAppAgentPresentation"
	protectedGenerateTextCandidateMethod     = "/nimi.runtime.v1.RuntimeAiService/GenerateLocalAppTextCandidate"
	protectedGetAppAIConfigMethod            = "/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig"
	protectedOverwriteAppAIConfigMethod      = "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig"
	protectedInvokeRealmUnaryMethod          = "/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary"
)

type protectedLocalAppAdmission interface {
	AdmitLocalAppIngress(context.Context, localappop.Ingress) error
	AuthorizeLocalAppIngress(context.Context, localappop.Ingress) (context.Context, error)
}

type protectedLocalAppMethodPolicy struct {
	transport         protectedlocal.TransportClass
	role              protectedlocal.OriginRole
	missingRoleReason runtimev1.ReasonCode
}

var protectedLocalAppUnaryMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedOpenLocalAppSessionMethod: {
		transport: protectedlocal.TransportLocalAppBootstrap, role: protectedlocal.RoleLocalAppProcess,
		missingRoleReason: runtimev1.ReasonCode_LOCAL_APP_PROCESS_MISMATCH,
	},
	protectedRenewLocalAppSessionMethod:      localAppSessionMethodPolicy(),
	protectedReadLocalAppStorageJSONMethod:   localAppSessionMethodPolicy(),
	protectedWriteLocalAppStorageJSONMethod:  localAppSessionMethodPolicy(),
	protectedRemoveLocalAppStorageJSONMethod: localAppSessionMethodPolicy(),
	protectedAgentReferenceListMethod:        localAppSessionMethodPolicy(),
	protectedOpenConversationMethod:          localAppSessionMethodPolicy(),
	protectedSendConversationTurnMethod:      localAppSessionMethodPolicy(),
	protectedInterruptConversationTurnMethod: localAppSessionMethodPolicy(),
	protectedConversationSnapshotMethod:      localAppSessionMethodPolicy(),
	protectedGetSharedAIConfigMethod:         localAppSessionMethodPolicy(),
	protectedOverwriteSharedAIConfigMethod:   localAppSessionMethodPolicy(),
	protectedSharedAIProfilePreviewMethod:    localAppSessionMethodPolicy(),
	protectedSharedAIProfileApplyMethod:      localAppSessionMethodPolicy(),
	protectedAutonomySnapshotMethod:          localAppSessionMethodPolicy(),
	protectedUpdateAutonomyMethod:            localAppSessionMethodPolicy(),
	protectedPresentationSnapshotMethod:      localAppSessionMethodPolicy(),
	protectedCommitPresentationMethod:        localAppSessionMethodPolicy(),
	protectedGenerateTextCandidateMethod:     localAppSessionMethodPolicy(),
	protectedGetAppAIConfigMethod:            localAppSessionMethodPolicy(),
	protectedOverwriteAppAIConfigMethod:      localAppSessionMethodPolicy(),
	protectedInvokeRealmUnaryMethod:          localAppSessionMethodPolicy(),
}

var protectedLocalAppStreamMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedSubscribeConversationMethod: localAppSessionMethodPolicy(),
}

func localAppSessionMethodPolicy() protectedLocalAppMethodPolicy {
	return protectedLocalAppMethodPolicy{transport: protectedlocal.TransportLocalAppHost, role: protectedlocal.RoleLocalAppSession, missingRoleReason: runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED}
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

func newProtectedLocalAppRPCServer(runtimeControlService runtimev1.RuntimeServiceControlServiceServer, authService runtimev1.RuntimeAuthServiceServer, accountService runtimev1.RuntimeAccountServiceServer, aiService runtimev1.RuntimeAiServiceServer, agentService runtimev1.RuntimeAgentServiceServer, appService runtimev1.RuntimeAppServiceServer) *grpc.Server {
	admission, _ := appService.(protectedLocalAppAdmission)
	server := grpc.NewServer(
		grpc.Creds(protectedLocalAppTransportCredentials{}), grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes), grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.UnaryInterceptor(newUnaryProtectedLocalAppTransportInterceptor(admission)),
		grpc.StreamInterceptor(newStreamProtectedLocalAppTransportInterceptor(admission)),
	)
	runtimev1.RegisterRuntimeServiceControlServiceServer(server, runtimeControlService)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountService)
	runtimev1.RegisterRuntimeAiServiceServer(server, aiService)
	runtimev1.RegisterRuntimeAgentServiceServer(server, agentService)
	runtimev1.RegisterRuntimeAppServiceServer(server, appService)
	return server
}

func newUnaryProtectedLocalAppTransportInterceptor(admissions ...protectedLocalAppAdmission) grpc.UnaryServerInterceptor {
	var admission protectedLocalAppAdmission
	if len(admissions) == 1 {
		admission = admissions[0]
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
		if !protectedLocalAppPolicyAllows(connection, policy) {
			return nil, protectedLocalAppRoleError(policy.missingRoleReason)
		}
		protectedContext := protectedlocal.ContextWithLocalAppConnection(ctx, connection)
		if info.FullMethod == protectedOpenLocalAppSessionMethod || info.FullMethod == protectedRenewLocalAppSessionMethod {
			if protectedLocalAppRequestHasCallerAssertion(protectedContext, req) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
			}
			return handler(protectedContext, req)
		}
		if protectedLocalAppRequestHasCallerAssertion(protectedContext, req) {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		if admission == nil {
			return nil, protectedLocalAppUnavailable()
		}
		ingress := protectedLocalAppUnaryIngress(info.FullMethod, req)
		authorizedContext, err := admission.AuthorizeLocalAppIngress(protectedContext, ingress)
		if err != nil {
			return nil, err
		}
		if protectedLocalAppOwnerEnabled(info.FullMethod, req, ingress) {
			return handler(authorizedContext, req)
		}
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
}

type protectedLocalAppServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (stream *protectedLocalAppServerStream) Context() context.Context { return stream.ctx }

func (stream *protectedLocalAppServerStream) RecvMsg(message any) error {
	if err := stream.ServerStream.RecvMsg(message); err != nil {
		return err
	}
	if protectedLocalAppRequestHasCallerAssertion(stream.ctx, message) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	return nil
}

func newStreamProtectedLocalAppTransportInterceptor(admissions ...protectedLocalAppAdmission) grpc.StreamServerInterceptor {
	var admission protectedLocalAppAdmission
	if len(admissions) == 1 {
		admission = admissions[0]
	}
	return func(service any, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
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
		if !protectedLocalAppPolicyAllows(connection, policy) {
			return protectedLocalAppRoleError(policy.missingRoleReason)
		}
		if admission == nil {
			return protectedLocalAppUnavailable()
		}
		protectedContext := protectedlocal.ContextWithLocalAppConnection(stream.Context(), connection)
		if protectedLocalAppMetadataHasCallerAssertion(protectedContext) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
		}
		authorizedContext, err := admission.AuthorizeLocalAppIngress(
			protectedContext,
			protectedLocalAppStreamIngress(info.FullMethod),
		)
		if err != nil {
			return err
		}
		return handler(service, &protectedLocalAppServerStream{ServerStream: stream, ctx: authorizedContext})
	}
}

func protectedLocalAppUnaryIngress(method string, request any) localappop.Ingress {
	switch method {
	case protectedReadLocalAppStorageJSONMethod:
		return localappop.IngressStorageJSONRead
	case protectedWriteLocalAppStorageJSONMethod:
		return localappop.IngressStorageJSONWrite
	case protectedRemoveLocalAppStorageJSONMethod:
		return localappop.IngressStorageJSONRemove
	case protectedGetAppAIConfigMethod:
		return localappop.IngressAppAIConfigGet
	case protectedOverwriteAppAIConfigMethod:
		return localappop.IngressAppAIConfigOverwrite
	case protectedGenerateTextCandidateMethod:
		return localappop.IngressTextCandidateGenerate
	case protectedAgentReferenceListMethod:
		return localappop.IngressAgentReferenceList
	case protectedInvokeRealmUnaryMethod:
		realmRequest, ok := request.(*runtimev1.InvokeRealmUnaryRequest)
		if !ok || realmRequest == nil {
			return localappop.IngressUnknown
		}
		switch realmRequest.GetMethodId() {
		case "WorldCoreController_listWorldCores":
			return localappop.IngressRealmWorldCoreList
		case "WorldCoreController_createWorldCore":
			return localappop.IngressRealmWorldCoreCreate
		default:
			return localappop.IngressUnknown
		}
	case protectedOpenConversationMethod:
		return localappop.IngressConversationOpen
	case protectedSendConversationTurnMethod:
		return localappop.IngressConversationTurnSend
	case protectedInterruptConversationTurnMethod:
		return localappop.IngressConversationTurnInterrupt
	case protectedConversationSnapshotMethod:
		return localappop.IngressConversationSnapshotGet
	default:
		return localappop.IngressUnknown
	}
}

func protectedLocalAppOwnerEnabled(method string, request any, ingress localappop.Ingress) bool {
	switch method {
	case protectedReadLocalAppStorageJSONMethod, protectedWriteLocalAppStorageJSONMethod, protectedRemoveLocalAppStorageJSONMethod,
		protectedGetAppAIConfigMethod, protectedOverwriteAppAIConfigMethod, protectedGenerateTextCandidateMethod,
		protectedAgentReferenceListMethod, protectedOpenConversationMethod, protectedSendConversationTurnMethod,
		protectedInterruptConversationTurnMethod, protectedConversationSnapshotMethod:
		return true
	case protectedInvokeRealmUnaryMethod:
		realmRequest, ok := request.(*runtimev1.InvokeRealmUnaryRequest)
		if !ok || realmRequest == nil {
			return false
		}
		switch ingress {
		case localappop.IngressRealmWorldCoreList:
			return realmRequest.GetMethodId() == "WorldCoreController_listWorldCores"
		case localappop.IngressRealmWorldCoreCreate:
			return realmRequest.GetMethodId() == "WorldCoreController_createWorldCore"
		default:
			return false
		}
	default:
		return false
	}
}

func protectedLocalAppStreamIngress(method string) localappop.Ingress {
	if method == protectedSubscribeConversationMethod {
		return localappop.IngressConversationEventsSubscribe
	}
	return localappop.IngressUnknown
}

func protectedLocalAppRequestHasCallerAssertion(ctx context.Context, request any) bool {
	if protectedLocalAppMetadataHasCallerAssertion(ctx) {
		return true
	}
	message, ok := request.(proto.Message)
	return !ok || protectedLocalAppMessageHasCallerAssertion(message.ProtoReflect())
}

func protectedLocalAppMetadataHasCallerAssertion(ctx context.Context) bool {
	values, _ := metadata.FromIncomingContext(ctx)
	for key := range values {
		if protectedLocalAppCallerAssertionField(key) {
			return true
		}
	}
	return false
}

func protectedLocalAppMessageHasCallerAssertion(message protoreflect.Message) bool {
	if !message.IsValid() || len(message.GetUnknown()) != 0 {
		return true
	}
	found := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if protectedLocalAppCallerAssertionField(string(field.Name())) || protectedLocalAppCallerAssertionField(field.JSONName()) {
			found = true
			return false
		}
		switch {
		case field.IsList():
			if field.Message() == nil {
				break
			}
			list := value.List()
			for index := 0; index < list.Len(); index++ {
				if protectedLocalAppMessageHasCallerAssertion(list.Get(index).Message()) {
					found = true
					return false
				}
			}
		case field.IsMap():
			value.Map().Range(func(key protoreflect.MapKey, entry protoreflect.Value) bool {
				if field.MapKey().Kind() == protoreflect.StringKind && protectedLocalAppCallerAssertionField(key.String()) {
					found = true
					return false
				}
				if field.MapValue().Message() != nil && protectedLocalAppMessageHasCallerAssertion(entry.Message()) {
					found = true
					return false
				}
				return true
			})
		case field.Message() != nil:
			if protectedLocalAppMessageHasCallerAssertion(value.Message()) {
				found = true
			}
		}
		return !found
	})
	return found
}

func protectedLocalAppCallerAssertionField(value string) bool {
	normalized := strings.NewReplacer("-", "", "_", "", ".", "").Replace(strings.ToLower(strings.TrimSpace(value)))
	switch normalized {
	case "account", "accountid", "appaccessdomainid", "appoperationid", "classification", "credential",
		"declarationgeneration", "domain", "domainid", "generation", "operation", "operationid",
		"peerproof", "registeredappsubject", "registrationhandle",
		"runtimebootepoch", "session", "sessionid", "sessionproof", "snapshot", "snapshotid",
		"sourcegeneration", "subject", "subjectuserid", "trustclass":
		return true
	default:
		return false
	}
}

func protectedLocalAppUnavailable() error {
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
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

func protectedLocalAppPolicyAllows(connection *protectedlocal.LocalAppConnection, policy protectedLocalAppMethodPolicy) bool {
	if connection == nil {
		return false
	}
	switch policy.transport {
	case protectedlocal.TransportLocalAppBootstrap:
		return policy.role == protectedlocal.RoleLocalAppProcess && connection.BootstrapAllowed()
	case protectedlocal.TransportLocalAppHost:
		return policy.role == protectedlocal.RoleLocalAppSession && connection.ProtectedOperationAllowed()
	default:
		return false
	}
}

func protectedLocalAppRoleError(reason runtimev1.ReasonCode) error {
	code := codes.PermissionDenied
	if reason == runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		code = codes.Unauthenticated
	}
	return grpcerr.WithReasonCode(code, reason)
}
