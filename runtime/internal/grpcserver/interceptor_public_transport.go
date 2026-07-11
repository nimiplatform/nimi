package grpcserver

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

var publicTransportBlockedMethods = map[string]runtimev1.ReasonCode{
	"/nimi.runtime.v1.RuntimeAccountService/IssueWorkspaceBinding":      runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAccountService/RevokeWorkspaceBinding":     runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAuthService/OpenDesktopSession":            runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAuthService/OpenDesktopLaunchedAppSession": runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/PrepareAppLifecycleIntent":      runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/GetAppLifecycleIntentStatus":    runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/InstallApp":                     runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/UninstallApp":                   runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/UpdateApp":                      runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/HealthRepairApp":                runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/AdoptLocalApp":                  runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/RemoveLocalAppAdoption":         runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/OpenApp":                        runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAppService/AcquireInstalledLaunchLease":    runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED,
	"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario":                 runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/StreamScenario":                  runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob":               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioJob":                  runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/CancelScenarioJob":               runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/SubscribeScenarioJobEvents":      runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetScenarioArtifacts":            runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/GetVoiceAsset":                   runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/ListVoiceAssets":                 runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/DeleteVoiceAsset":                runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
	"/nimi.runtime.v1.RuntimeAiService/UploadArtifact":                  runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH,
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
	if reason, blocked := publicTransportBlockedMethods[fullMethod]; blocked {
		return reason, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeGrantService/") {
		return runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeAccountService/") {
		return runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED, true
	}
	if strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeAiRealtimeService/") ||
		strings.HasPrefix(fullMethod, "/nimi.runtime.v1.RuntimeArtifactService/") {
		return runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH, true
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, false
}
