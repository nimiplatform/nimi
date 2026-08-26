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
	protectedOpenLocalAppSessionMethod            = "/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession"
	protectedRenewLocalAppSessionMethod           = "/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession"
	protectedReadLocalAppStorageJSONMethod        = "/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson"
	protectedWriteLocalAppStorageJSONMethod       = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson"
	protectedRemoveLocalAppStorageJSONMethod      = "/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson"
	protectedStatLocalAppAssetMethod              = "/nimi.runtime.v1.RuntimeAppService/StatLocalAppAsset"
	protectedListLocalAppAssetsMethod             = "/nimi.runtime.v1.RuntimeAppService/ListLocalAppAssets"
	protectedWriteLocalAppAssetMethod             = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset"
	protectedReadLocalAppAssetMethod              = "/nimi.runtime.v1.RuntimeAppService/ReadLocalAppAsset"
	protectedRemoveLocalAppAssetMethod            = "/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppAsset"
	protectedMoveLocalAppAssetMethod              = "/nimi.runtime.v1.RuntimeAppService/MoveLocalAppAsset"
	protectedRevealLocalAppAssetMethod            = "/nimi.runtime.v1.RuntimeAppService/RevealLocalAppAsset"
	protectedAdoptLocalAppArtifactMethod          = "/nimi.runtime.v1.RuntimeAppService/AdoptLocalAppArtifact"
	protectedAgentReferenceListMethod             = "/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences"
	protectedOpenConversationMethod               = "/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppConversation"
	protectedSendConversationTurnMethod           = "/nimi.runtime.v1.RuntimeAgentService/SendLocalAppConversationTurn"
	protectedUploadConversationAttachmentMethod   = "/nimi.runtime.v1.RuntimeAgentService/UploadLocalAppConversationAttachment"
	protectedReadConversationArtifactMethod       = "/nimi.runtime.v1.RuntimeAgentService/ReadLocalAppConversationArtifact"
	protectedTranscribeConversationVoiceMethod    = "/nimi.runtime.v1.RuntimeAgentService/TranscribeLocalAppConversationVoice"
	protectedInterruptConversationTurnMethod      = "/nimi.runtime.v1.RuntimeAgentService/InterruptLocalAppConversationTurn"
	protectedSubscribeConversationMethod          = "/nimi.runtime.v1.RuntimeAgentService/SubscribeLocalAppConversationEvents"
	protectedConversationSnapshotMethod           = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppConversationSnapshot"
	protectedGetSharedAIConfigMethod              = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppSharedLocalAgentAIConfig"
	protectedOverwriteSharedAIConfigMethod        = "/nimi.runtime.v1.RuntimeAgentService/OverwriteLocalAppSharedLocalAgentAIConfig"
	protectedListSharedAIConfigOptionsMethod      = "/nimi.runtime.v1.RuntimeAgentService/ListLocalAppSharedLocalAgentAIConfigOptions"
	protectedAutonomySnapshotMethod               = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentAutonomySnapshot"
	protectedUpdateAutonomyMethod                 = "/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentAutonomy"
	protectedPresentationSnapshotMethod           = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentPresentationSnapshot"
	protectedCommitPresentationMethod             = "/nimi.runtime.v1.RuntimeAgentService/CommitLocalAppAgentPresentation"
	protectedGenerateTextCandidateMethod          = "/nimi.runtime.v1.RuntimeAiService/GenerateLocalAppTextCandidate"
	protectedStreamTextTurnMethod                 = "/nimi.runtime.v1.RuntimeAiService/StreamLocalAppTextTurn"
	protectedExecuteLocalAppScenarioMethod        = "/nimi.runtime.v1.RuntimeAiService/ExecuteLocalAppScenario"
	protectedSubmitScenarioJobMethod              = "/nimi.runtime.v1.RuntimeAiService/SubmitLocalAppScenarioJob"
	protectedGetScenarioJobMethod                 = "/nimi.runtime.v1.RuntimeAiService/GetLocalAppScenarioJob"
	protectedSubscribeScenarioJobMethod           = "/nimi.runtime.v1.RuntimeAiService/SubscribeLocalAppScenarioJobEvents"
	protectedCancelScenarioJobMethod              = "/nimi.runtime.v1.RuntimeAiService/CancelLocalAppScenarioJob"
	protectedReadLocalAppArtifactMethod           = "/nimi.runtime.v1.RuntimeAiService/ReadLocalAppArtifact"
	protectedUploadLocalAppArtifactMethod         = "/nimi.runtime.v1.RuntimeAiService/UploadLocalAppArtifact"
	protectedListLocalAppVoiceAssetsMethod        = "/nimi.runtime.v1.RuntimeAiService/ListLocalAppVoiceAssets"
	protectedGetAppAIConfigMethod                 = "/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig"
	protectedOverwriteAppAIConfigMethod           = "/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig"
	protectedListAppAIConfigOptionsMethod         = "/nimi.runtime.v1.RuntimeAiService/ListAppAIConfigOptions"
	protectedInvokeRealmUnaryMethod               = "/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary"
	protectedListRealmChatsMethod                 = "/nimi.runtime.v1.RuntimeRealmRealtimeService/ListRealmChats"
	protectedOpenRealmRealtimeChannelMethod       = "/nimi.runtime.v1.RuntimeRealmRealtimeService/OpenRealmRealtimeChannel"
	protectedSubscribeRealmRealtimeEventsMethod   = "/nimi.runtime.v1.RuntimeRealmRealtimeService/SubscribeRealmRealtimeEvents"
	protectedAckRealmRealtimeEventsMethod         = "/nimi.runtime.v1.RuntimeRealmRealtimeService/AckRealmRealtimeEvents"
	protectedCloseRealmRealtimeSubscriptionMethod = "/nimi.runtime.v1.RuntimeRealmRealtimeService/CloseRealmRealtimeSubscription"
	protectedCloseRealmRealtimeChannelMethod      = "/nimi.runtime.v1.RuntimeRealmRealtimeService/CloseRealmRealtimeChannel"
	protectedOpenAIRealtimeMethod                 = "/nimi.runtime.v1.RuntimeAiRealtimeService/OpenRealtimeSession"
	protectedAppendAIRealtimeInputMethod          = "/nimi.runtime.v1.RuntimeAiRealtimeService/AppendRealtimeInput"
	protectedSubmitAIRealtimeOwnerControlMethod   = "/nimi.runtime.v1.RuntimeAiRealtimeService/SubmitRealtimeOwnerControl"
	protectedReadAIRealtimeEventsMethod           = "/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents"
	protectedInterruptAIRealtimeOutputMethod      = "/nimi.runtime.v1.RuntimeAiRealtimeService/InterruptRealtimeOutput"
	protectedCloseAIRealtimeMethod                = "/nimi.runtime.v1.RuntimeAiRealtimeService/CloseRealtimeSession"
	protectedOpenAgentRealtimeMethod              = "/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppAgentRealtime"
	protectedAppendAgentRealtimeInputMethod       = "/nimi.runtime.v1.RuntimeAgentService/AppendLocalAppAgentRealtimeInput"
	protectedSubscribeAgentRealtimeEventsMethod   = "/nimi.runtime.v1.RuntimeAgentService/SubscribeLocalAppAgentRealtimeEvents"
	protectedGetAgentRealtimeStatusMethod         = "/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentRealtimeStatus"
	protectedInterruptAgentRealtimeOutputMethod   = "/nimi.runtime.v1.RuntimeAgentService/InterruptLocalAppAgentRealtimeOutput"
	protectedCloseAgentRealtimeMethod             = "/nimi.runtime.v1.RuntimeAgentService/CloseLocalAppAgentRealtime"
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
	protectedRenewLocalAppSessionMethod:           localAppSessionMethodPolicy(),
	protectedReadLocalAppStorageJSONMethod:        localAppSessionMethodPolicy(),
	protectedWriteLocalAppStorageJSONMethod:       localAppSessionMethodPolicy(),
	protectedRemoveLocalAppStorageJSONMethod:      localAppSessionMethodPolicy(),
	protectedStatLocalAppAssetMethod:              localAppSessionMethodPolicy(),
	protectedListLocalAppAssetsMethod:             localAppSessionMethodPolicy(),
	protectedRemoveLocalAppAssetMethod:            localAppSessionMethodPolicy(),
	protectedMoveLocalAppAssetMethod:              localAppSessionMethodPolicy(),
	protectedRevealLocalAppAssetMethod:            localAppSessionMethodPolicy(),
	protectedAdoptLocalAppArtifactMethod:          localAppSessionMethodPolicy(),
	protectedAgentReferenceListMethod:             localAppSessionMethodPolicy(),
	protectedOpenConversationMethod:               localAppSessionMethodPolicy(),
	protectedSendConversationTurnMethod:           localAppSessionMethodPolicy(),
	protectedUploadConversationAttachmentMethod:   localAppSessionMethodPolicy(),
	protectedReadConversationArtifactMethod:       localAppSessionMethodPolicy(),
	protectedTranscribeConversationVoiceMethod:    localAppSessionMethodPolicy(),
	protectedInterruptConversationTurnMethod:      localAppSessionMethodPolicy(),
	protectedConversationSnapshotMethod:           localAppSessionMethodPolicy(),
	protectedGetSharedAIConfigMethod:              localAppSessionMethodPolicy(),
	protectedOverwriteSharedAIConfigMethod:        localAppSessionMethodPolicy(),
	protectedListSharedAIConfigOptionsMethod:      localAppSessionMethodPolicy(),
	protectedAutonomySnapshotMethod:               localAppSessionMethodPolicy(),
	protectedUpdateAutonomyMethod:                 localAppSessionMethodPolicy(),
	protectedPresentationSnapshotMethod:           localAppSessionMethodPolicy(),
	protectedCommitPresentationMethod:             localAppSessionMethodPolicy(),
	protectedGenerateTextCandidateMethod:          localAppSessionMethodPolicy(),
	protectedExecuteLocalAppScenarioMethod:        localAppSessionMethodPolicy(),
	protectedSubmitScenarioJobMethod:              localAppSessionMethodPolicy(),
	protectedGetScenarioJobMethod:                 localAppSessionMethodPolicy(),
	protectedCancelScenarioJobMethod:              localAppSessionMethodPolicy(),
	protectedReadLocalAppArtifactMethod:           localAppSessionMethodPolicy(),
	protectedUploadLocalAppArtifactMethod:         localAppSessionMethodPolicy(),
	protectedListLocalAppVoiceAssetsMethod:        localAppSessionMethodPolicy(),
	protectedGetAppAIConfigMethod:                 localAppSessionMethodPolicy(),
	protectedOverwriteAppAIConfigMethod:           localAppSessionMethodPolicy(),
	protectedListAppAIConfigOptionsMethod:         localAppSessionMethodPolicy(),
	protectedInvokeRealmUnaryMethod:               localAppSessionMethodPolicy(),
	protectedListRealmChatsMethod:                 localAppSessionMethodPolicy(),
	protectedOpenRealmRealtimeChannelMethod:       localAppSessionMethodPolicy(),
	protectedAckRealmRealtimeEventsMethod:         localAppSessionMethodPolicy(),
	protectedCloseRealmRealtimeSubscriptionMethod: localAppSessionMethodPolicy(),
	protectedCloseRealmRealtimeChannelMethod:      localAppSessionMethodPolicy(),
	protectedOpenAIRealtimeMethod:                 localAppSessionMethodPolicy(),
	protectedAppendAIRealtimeInputMethod:          localAppSessionMethodPolicy(),
	protectedSubmitAIRealtimeOwnerControlMethod:   localAppSessionMethodPolicy(),
	protectedInterruptAIRealtimeOutputMethod:      localAppSessionMethodPolicy(),
	protectedCloseAIRealtimeMethod:                localAppSessionMethodPolicy(),
	protectedOpenAgentRealtimeMethod:              localAppSessionMethodPolicy(),
	protectedAppendAgentRealtimeInputMethod:       localAppSessionMethodPolicy(),
	protectedGetAgentRealtimeStatusMethod:         localAppSessionMethodPolicy(),
	protectedInterruptAgentRealtimeOutputMethod:   localAppSessionMethodPolicy(),
	protectedCloseAgentRealtimeMethod:             localAppSessionMethodPolicy(),
}

var protectedLocalAppStreamMethodPolicies = map[string]protectedLocalAppMethodPolicy{
	protectedSubscribeConversationMethod:        localAppSessionMethodPolicy(),
	protectedStreamTextTurnMethod:               localAppSessionMethodPolicy(),
	protectedSubscribeScenarioJobMethod:         localAppSessionMethodPolicy(),
	protectedWriteLocalAppAssetMethod:           localAppSessionMethodPolicy(),
	protectedReadLocalAppAssetMethod:            localAppSessionMethodPolicy(),
	protectedSubscribeRealmRealtimeEventsMethod: localAppSessionMethodPolicy(),
	protectedReadAIRealtimeEventsMethod:         localAppSessionMethodPolicy(),
	protectedSubscribeAgentRealtimeEventsMethod: localAppSessionMethodPolicy(),
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

func newProtectedLocalAppRPCServer(runtimeControlService runtimev1.RuntimeServiceControlServiceServer, authService runtimev1.RuntimeAuthServiceServer, accountService runtimev1.RuntimeAccountServiceServer, realmRealtimeService runtimev1.RuntimeRealmRealtimeServiceServer, localService runtimev1.RuntimeLocalServiceServer, aiService runtimev1.RuntimeAiServiceServer, agentService runtimev1.RuntimeAgentServiceServer, appService runtimev1.RuntimeAppServiceServer) *grpc.Server {
	admission, _ := appService.(protectedLocalAppAdmission)
	server := grpc.NewServer(
		grpc.Creds(protectedLocalAppTransportCredentials{}),
		grpc.KeepaliveEnforcementPolicy(protectedGRPCKeepalivePolicy()),
		grpc.MaxRecvMsgSize(maxProtectedLocalAppRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes), grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.UnaryInterceptor(newUnaryProtectedLocalAppTransportInterceptor(admission)),
		grpc.StreamInterceptor(newStreamProtectedLocalAppTransportInterceptor(admission)),
	)
	runtimev1.RegisterRuntimeServiceControlServiceServer(server, runtimeControlService)
	runtimev1.RegisterRuntimeAuthServiceServer(server, authService)
	runtimev1.RegisterRuntimeAccountServiceServer(server, accountService)
	runtimev1.RegisterRuntimeRealmRealtimeServiceServer(server, realmRealtimeService)
	runtimev1.RegisterRuntimeLocalServiceServer(server, localService)
	runtimev1.RegisterRuntimeAiServiceServer(server, aiService)
	if realtimeService, ok := aiService.(runtimev1.RuntimeAiRealtimeServiceServer); ok {
		runtimev1.RegisterRuntimeAiRealtimeServiceServer(server, realtimeService)
	}
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
			if protectedLocalAppRequestHasCallerAssertionForMethod(protectedContext, req, info.FullMethod) {
				return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
			}
			return handler(protectedContext, req)
		}
		if protectedLocalAppRequestHasCallerAssertionForMethod(protectedContext, req, info.FullMethod) {
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
		if err := authorizeProtectedLocalAppRealtimeResource(authorizedContext, connection, info.FullMethod, req); err != nil {
			return nil, err
		}
		if protectedLocalAppOwnerEnabled(info.FullMethod, req, ingress) {
			response, handlerErr := handler(authorizedContext, req)
			if handlerErr != nil {
				return nil, handlerErr
			}
			if err := updateProtectedLocalAppRealtimeResource(authorizedContext, connection, info.FullMethod, req, response, info.Server); err != nil {
				return nil, err
			}
			return response, nil
		}
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
}

type protectedLocalAppServerStream struct {
	grpc.ServerStream
	ctx                     context.Context
	allowRealtimeGeneration bool
	connection              *protectedlocal.LocalAppConnection
	method                  string
}

func (stream *protectedLocalAppServerStream) Context() context.Context { return stream.ctx }

func (stream *protectedLocalAppServerStream) RecvMsg(message any) error {
	if err := stream.ServerStream.RecvMsg(message); err != nil {
		return err
	}
	if protectedLocalAppRequestHasCallerAssertionWithGeneration(stream.ctx, message, stream.allowRealtimeGeneration) {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
	}
	if err := authorizeProtectedLocalAppRealtimeResource(stream.ctx, stream.connection, stream.method, message); err != nil {
		return err
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
		return handler(service, &protectedLocalAppServerStream{
			ServerStream:            stream,
			ctx:                     authorizedContext,
			allowRealtimeGeneration: protectedLocalAppMethodAllowsRealtimeGeneration(info.FullMethod),
			connection:              connection,
			method:                  info.FullMethod,
		})
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
	case protectedStatLocalAppAssetMethod:
		return localappop.IngressStorageAssetStat
	case protectedRevealLocalAppAssetMethod:
		return localappop.IngressStorageAssetReveal
	case protectedListLocalAppAssetsMethod:
		return localappop.IngressStorageAssetList
	case protectedRemoveLocalAppAssetMethod:
		return localappop.IngressStorageAssetRemove
	case protectedMoveLocalAppAssetMethod:
		return localappop.IngressStorageAssetMove
	case protectedAdoptLocalAppArtifactMethod:
		return localappop.IngressArtifactAdoptToStorage
	case protectedGetAppAIConfigMethod:
		return localappop.IngressAppAIConfigGet
	case protectedOverwriteAppAIConfigMethod:
		return localappop.IngressAppAIConfigOverwrite
	case protectedListAppAIConfigOptionsMethod:
		return localappop.IngressAppAIConfigOptionsList
	case protectedGenerateTextCandidateMethod:
		return localappop.IngressTextCandidateGenerate
	case protectedExecuteLocalAppScenarioMethod:
		return localappop.IngressScenarioExecute
	case protectedSubmitScenarioJobMethod:
		return localappop.IngressScenarioJobSubmit
	case protectedGetScenarioJobMethod:
		return localappop.IngressScenarioJobGet
	case protectedCancelScenarioJobMethod:
		return localappop.IngressScenarioJobCancel
	case protectedReadLocalAppArtifactMethod:
		return localappop.IngressArtifactRead
	case protectedUploadLocalAppArtifactMethod:
		return localappop.IngressArtifactUpload
	case protectedListLocalAppVoiceAssetsMethod:
		return localappop.IngressVoiceAssetsList
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
		case "WorldCoreController_listPersonaCharacters":
			return localappop.IngressRealmPersonaCharacterListOwned
		case "WorldCoreController_getPersonaCharacter":
			return localappop.IngressRealmPersonaCharacterGetOwned
		case "WorldCoreController_createPersonaCharacter":
			return localappop.IngressRealmPersonaCharacterCreate
		case "WorldCoreController_replacePersonaCharacter":
			return localappop.IngressRealmPersonaCharacterReplace
		case "WorldCoreController_deletePersonaCharacter":
			return localappop.IngressRealmPersonaCharacterDelete
		default:
			return localappop.IngressUnknown
		}
	case protectedOpenRealmRealtimeChannelMethod:
		return localappop.IngressRealmRealtimeChannelOpen
	case protectedListRealmChatsMethod:
		return localappop.IngressRealmChatList
	case protectedAckRealmRealtimeEventsMethod:
		return localappop.IngressRealmRealtimeEventsAck
	case protectedCloseRealmRealtimeSubscriptionMethod:
		return localappop.IngressRealmRealtimeSubscriptionClose
	case protectedCloseRealmRealtimeChannelMethod:
		return localappop.IngressRealmRealtimeChannelClose
	case protectedOpenAIRealtimeMethod:
		return localappop.IngressAIRealtimeOpen
	case protectedAppendAIRealtimeInputMethod:
		return localappop.IngressAIRealtimeInputAppend
	case protectedSubmitAIRealtimeOwnerControlMethod:
		return localappop.IngressAIRealtimeOwnerControlSubmit
	case protectedInterruptAIRealtimeOutputMethod:
		return localappop.IngressAIRealtimeOutputInterrupt
	case protectedCloseAIRealtimeMethod:
		return localappop.IngressAIRealtimeClose
	case protectedOpenAgentRealtimeMethod:
		return localappop.IngressAgentRealtimeOpen
	case protectedAppendAgentRealtimeInputMethod:
		return localappop.IngressAgentRealtimeInputAppend
	case protectedGetAgentRealtimeStatusMethod:
		return localappop.IngressAgentRealtimeStatusGet
	case protectedInterruptAgentRealtimeOutputMethod:
		return localappop.IngressAgentRealtimeOutputInterrupt
	case protectedCloseAgentRealtimeMethod:
		return localappop.IngressAgentRealtimeClose
	case protectedOpenConversationMethod:
		return localappop.IngressConversationOpen
	case protectedSendConversationTurnMethod:
		return localappop.IngressConversationTurnSend
	case protectedUploadConversationAttachmentMethod:
		return localappop.IngressConversationAttachmentUpload
	case protectedReadConversationArtifactMethod:
		return localappop.IngressConversationArtifactRead
	case protectedTranscribeConversationVoiceMethod:
		return localappop.IngressConversationVoiceTranscribe
	case protectedInterruptConversationTurnMethod:
		return localappop.IngressConversationTurnInterrupt
	case protectedConversationSnapshotMethod:
		return localappop.IngressConversationSnapshotGet
	case protectedGetSharedAIConfigMethod:
		return localappop.IngressAgentAIConfigGet
	case protectedOverwriteSharedAIConfigMethod:
		return localappop.IngressAgentAIConfigOverwrite
	case protectedListSharedAIConfigOptionsMethod:
		return localappop.IngressAgentAIConfigOptionsList
	case protectedAutonomySnapshotMethod:
		return localappop.IngressAgentAutonomySnapshotGet
	case protectedUpdateAutonomyMethod:
		return localappop.IngressAgentAutonomyUpdate
	case protectedPresentationSnapshotMethod:
		return localappop.IngressAgentPresentationSnapshotGet
	case protectedCommitPresentationMethod:
		return localappop.IngressAgentPresentationCommit
	default:
		return localappop.IngressUnknown
	}
}

func protectedLocalAppOwnerEnabled(method string, request any, ingress localappop.Ingress) bool {
	switch method {
	case protectedReadLocalAppStorageJSONMethod, protectedWriteLocalAppStorageJSONMethod, protectedRemoveLocalAppStorageJSONMethod,
		protectedStatLocalAppAssetMethod, protectedListLocalAppAssetsMethod, protectedRemoveLocalAppAssetMethod, protectedMoveLocalAppAssetMethod, protectedRevealLocalAppAssetMethod,
		protectedAdoptLocalAppArtifactMethod,
		protectedGetAppAIConfigMethod, protectedOverwriteAppAIConfigMethod,
		protectedListAppAIConfigOptionsMethod, protectedGenerateTextCandidateMethod,
		protectedExecuteLocalAppScenarioMethod, protectedSubmitScenarioJobMethod, protectedGetScenarioJobMethod, protectedCancelScenarioJobMethod,
		protectedReadLocalAppArtifactMethod, protectedUploadLocalAppArtifactMethod, protectedListLocalAppVoiceAssetsMethod,
		protectedAgentReferenceListMethod, protectedOpenConversationMethod, protectedSendConversationTurnMethod,
		protectedUploadConversationAttachmentMethod, protectedReadConversationArtifactMethod, protectedTranscribeConversationVoiceMethod,
		protectedInterruptConversationTurnMethod, protectedConversationSnapshotMethod,
		protectedGetSharedAIConfigMethod, protectedOverwriteSharedAIConfigMethod, protectedListSharedAIConfigOptionsMethod,
		protectedAutonomySnapshotMethod, protectedUpdateAutonomyMethod,
		protectedPresentationSnapshotMethod, protectedCommitPresentationMethod:
		return true
	case protectedListRealmChatsMethod, protectedOpenRealmRealtimeChannelMethod, protectedAckRealmRealtimeEventsMethod,
		protectedCloseRealmRealtimeSubscriptionMethod, protectedCloseRealmRealtimeChannelMethod:
		return true
	case protectedOpenAIRealtimeMethod, protectedAppendAIRealtimeInputMethod,
		protectedSubmitAIRealtimeOwnerControlMethod, protectedInterruptAIRealtimeOutputMethod,
		protectedCloseAIRealtimeMethod:
		return true
	case protectedOpenAgentRealtimeMethod, protectedAppendAgentRealtimeInputMethod,
		protectedGetAgentRealtimeStatusMethod, protectedInterruptAgentRealtimeOutputMethod,
		protectedCloseAgentRealtimeMethod:
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
		case localappop.IngressRealmPersonaCharacterListOwned:
			return realmRequest.GetMethodId() == "WorldCoreController_listPersonaCharacters"
		case localappop.IngressRealmPersonaCharacterGetOwned:
			return realmRequest.GetMethodId() == "WorldCoreController_getPersonaCharacter"
		case localappop.IngressRealmPersonaCharacterCreate:
			return realmRequest.GetMethodId() == "WorldCoreController_createPersonaCharacter"
		case localappop.IngressRealmPersonaCharacterReplace:
			return realmRequest.GetMethodId() == "WorldCoreController_replacePersonaCharacter"
		case localappop.IngressRealmPersonaCharacterDelete:
			return realmRequest.GetMethodId() == "WorldCoreController_deletePersonaCharacter"
		default:
			return false
		}
	default:
		return false
	}
}

func protectedLocalAppStreamIngress(method string) localappop.Ingress {
	switch method {
	case protectedSubscribeConversationMethod:
		return localappop.IngressConversationEventsSubscribe
	case protectedStreamTextTurnMethod:
		return localappop.IngressTextTurnStream
	case protectedSubscribeScenarioJobMethod:
		return localappop.IngressScenarioJobSubscribe
	case protectedWriteLocalAppAssetMethod:
		return localappop.IngressStorageAssetWrite
	case protectedReadLocalAppAssetMethod:
		return localappop.IngressStorageAssetRead
	case protectedSubscribeRealmRealtimeEventsMethod:
		return localappop.IngressRealmRealtimeEventsSubscribe
	case protectedReadAIRealtimeEventsMethod:
		return localappop.IngressAIRealtimeEventsRead
	case protectedSubscribeAgentRealtimeEventsMethod:
		return localappop.IngressAgentRealtimeEventsSubscribe
	default:
		return localappop.IngressUnknown
	}
}

func protectedLocalAppRequestHasCallerAssertion(ctx context.Context, request any) bool {
	return protectedLocalAppRequestHasCallerAssertionWithGeneration(ctx, request, false)
}

func protectedLocalAppRequestHasCallerAssertionForMethod(ctx context.Context, request any, method string) bool {
	return protectedLocalAppRequestHasCallerAssertionWithGeneration(ctx, request, protectedLocalAppMethodAllowsRealtimeGeneration(method))
}

func protectedLocalAppRequestHasCallerAssertionWithGeneration(ctx context.Context, request any, allowRealtimeGeneration bool) bool {
	if protectedLocalAppMetadataHasCallerAssertion(ctx) {
		return true
	}
	message, ok := request.(proto.Message)
	return !ok || protectedLocalAppMessageHasCallerAssertion(message.ProtoReflect(), allowRealtimeGeneration)
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

func protectedLocalAppMessageHasCallerAssertion(message protoreflect.Message, allowRealtimeGeneration bool) bool {
	if !message.IsValid() || len(message.GetUnknown()) != 0 {
		return true
	}
	found := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if protectedLocalAppCallerAssertionFieldExceptRealtimeGeneration(string(field.Name()), allowRealtimeGeneration) ||
			protectedLocalAppCallerAssertionFieldExceptRealtimeGeneration(field.JSONName(), allowRealtimeGeneration) {
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
				if protectedLocalAppMessageHasCallerAssertion(list.Get(index).Message(), allowRealtimeGeneration) {
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
				if field.MapValue().Message() != nil && protectedLocalAppMessageHasCallerAssertion(entry.Message(), allowRealtimeGeneration) {
					found = true
					return false
				}
				return true
			})
		case field.Message() != nil:
			if protectedLocalAppMessageHasCallerAssertion(value.Message(), allowRealtimeGeneration) {
				found = true
			}
		}
		return !found
	})
	return found
}

func protectedLocalAppCallerAssertionFieldExceptRealtimeGeneration(value string, allowRealtimeGeneration bool) bool {
	normalized := strings.NewReplacer("-", "", "_", "", ".", "").Replace(strings.ToLower(strings.TrimSpace(value)))
	return !(allowRealtimeGeneration && normalized == "generation") && protectedLocalAppCallerAssertionField(value)
}

func protectedLocalAppMethodAllowsRealtimeGeneration(method string) bool {
	switch method {
	case protectedAppendAIRealtimeInputMethod,
		protectedSubmitAIRealtimeOwnerControlMethod,
		protectedReadAIRealtimeEventsMethod,
		protectedInterruptAIRealtimeOutputMethod,
		protectedCloseAIRealtimeMethod,
		protectedAppendAgentRealtimeInputMethod,
		protectedSubscribeAgentRealtimeEventsMethod,
		protectedGetAgentRealtimeStatusMethod,
		protectedInterruptAgentRealtimeOutputMethod,
		protectedCloseAgentRealtimeMethod:
		return true
	default:
		return false
	}
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
