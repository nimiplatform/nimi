package grpcserver

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type protectedCapabilityAuthorizer interface {
	ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool)
}

func newUnaryAuthzInterceptor(authorizer protectedCapabilityAuthorizer) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if authorizer == nil {
			return handler(ctx, req)
		}
		capability, required := protectedCapabilityForUnary(info.FullMethod, req)
		if !required {
			return handler(ctx, req)
		}
		tokenID, secret, _ := envelope.ParseAccessTokenFromContext(ctx)
		appID := appIDFromMetadata(ctx)
		if appID == "" {
			appID = appIDFromRequest(req)
		}
		if reasonCode, _, ok := authorizer.ValidateProtectedCapability(appID, tokenID, secret, capability); !ok {
			return nil, status.Error(codes.PermissionDenied, reasonCode.String())
		}
		return handler(ctx, req)
	}
}

func newStreamAuthzInterceptor(authorizer protectedCapabilityAuthorizer) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if authorizer == nil {
			return handler(srv, ss)
		}
		if info.FullMethod != "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents" {
			return handler(srv, ss)
		}
		tokenID, secret, _ := envelope.ParseAccessTokenFromContext(ss.Context())
		appID := appIDFromMetadata(ss.Context())
		if reasonCode, _, ok := authorizer.ValidateProtectedCapability(appID, tokenID, secret, "runtime.audit.export"); !ok {
			return status.Error(codes.PermissionDenied, reasonCode.String())
		}
		return handler(srv, ss)
	}
}

func protectedCapabilityForUnary(fullMethod string, req any) (string, bool) {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeModelService/RemoveModel":
		return "runtime.model.remove", true
	case "/nimi.runtime.v1.RuntimeAppService/SendAppMessage":
		message, ok := req.(*runtimev1.SendAppMessageRequest)
		if !ok {
			return "", false
		}
		if strings.TrimSpace(message.GetFromAppId()) != "" &&
			strings.TrimSpace(message.GetToAppId()) != "" &&
			strings.TrimSpace(message.GetFromAppId()) != strings.TrimSpace(message.GetToAppId()) {
			return "runtime.app.send.cross_app", true
		}
		return "", false
	case "/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal":
		grantReq, ok := req.(*runtimev1.AuthorizeExternalPrincipalRequest)
		if !ok {
			return "", false
		}
		if grantReq.GetPolicyOverride() {
			return "runtime.app_auth.policy.override", true
		}
		return "", false
	default:
		return "", false
	}
}
