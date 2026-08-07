package grpcserver

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

var publicTransportBlockedMethods = map[string]runtimev1.ReasonCode{
	"/nimi.runtime.v1.RuntimeServiceControlService/RequestRuntimeRestart":            runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAccountService/IssueWorkspaceBinding":                   runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAccountService/RevokeWorkspaceBinding":                  runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession":                         runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAuthService/OpenLocalAppSession":                        runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAuthService/RenewLocalAppSession":                       runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAppService/PrepareLocalAppLaunch":                       runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/BindLocalAppProcess":                         runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/RebindLocalAppProcess":                       runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/SendAppMessage":                              runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages":                        runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAppService/ReadLocalAppStorageJson":                     runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson":                    runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppStorageJson":                   runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/ListLocalAppAgentReferences":               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/OpenLocalAppConversation":                  runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/SendLocalAppConversationTurn":              runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/InterruptLocalAppConversationTurn":         runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/SubscribeLocalAppConversationEvents":       runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/GetLocalAppConversationSnapshot":           runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/GetLocalAppSharedLocalAgentAIConfig":       runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/OverwriteLocalAppSharedLocalAgentAIConfig": runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentAutonomySnapshot":          runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/UpdateLocalAppAgentAutonomy":               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/GetLocalAppAgentPresentationSnapshot":      runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/CommitLocalAppAgentPresentation":           runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor":                    runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot":              runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig":                               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig":                         runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/StreamScenario":                               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob":                            runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob":                               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob":                            runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents":                   runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts":                         runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetVoiceAsset":                                runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/ListVoiceAssets":                              runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset":                             runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/UploadArtifact":                               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
}

func newUnaryPublicTransportInterceptor() grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if reason, blocked := publicTransportDenial(info.FullMethod); blocked {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, reason)
		}
		return handler(ctx, req)
	}
}

func newStreamPublicTransportInterceptor() grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if reason, blocked := publicTransportDenial(info.FullMethod); blocked {
			return grpcerr.WithReasonCode(codes.PermissionDenied, reason)
		}
		return handler(srv, ss)
	}
}

func publicTransportDenial(fullMethod string) (runtimev1.ReasonCode, bool) {
	if _, bundledAvatarMethod := bundledavatar.Method(fullMethod); bundledAvatarMethod {
		return runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED, true
	}
	if protectedlocal.IsFirstPartyProtectedProfileMethod(fullMethod) {
		return runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED, true
	}
	if reason, blocked := publicTransportBlockedMethods[fullMethod]; blocked {
		return reason, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeAccountService/") {
		return runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeDevelopmentService/") {
		return runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeAiRealtimeService/") ||
		strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeArtifactService/") {
		return runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH, true
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
}
