package grpcserver

import (
	"context"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
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
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, reasonCode)
		}
		return handler(ctx, req)
	}
}

func newStreamAuthzInterceptor(authorizer protectedCapabilityAuthorizer) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if authorizer == nil {
			return handler(srv, ss)
		}
		capability, required := protectedCapabilityForStream(info.FullMethod)
		if !required {
			return handler(srv, ss)
		}
		tokenID, secret, _ := envelope.ParseAccessTokenFromContext(ss.Context())
		wrapped := &authzStream{
			ServerStream:  ss,
			authorizer:    authorizer,
			tokenID:       tokenID,
			secret:        secret,
			capability:    capability,
			metadataAppID: appIDFromMetadata(ss.Context()),
		}
		return handler(srv, wrapped)
	}
}

type authzStream struct {
	grpc.ServerStream
	authorizer    protectedCapabilityAuthorizer
	tokenID       string
	secret        string
	capability    string
	metadataAppID string
	checked       bool
	mu            sync.Mutex
}

func (s *authzStream) RecvMsg(m any) error {
	if err := s.ServerStream.RecvMsg(m); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.checked {
		return nil
	}
	s.checked = true
	appID := strings.TrimSpace(s.metadataAppID)
	if appID == "" {
		appID = appIDFromRequest(m)
	}
	if reasonCode, _, ok := s.authorizer.ValidateProtectedCapability(appID, s.tokenID, s.secret, s.capability); !ok {
		return grpcerr.WithReasonCode(codes.PermissionDenied, reasonCode)
	}
	return nil
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

func protectedCapabilityForStream(fullMethod string) (string, bool) {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return "runtime.audit.export", true
	default:
		return "", false
	}
}
