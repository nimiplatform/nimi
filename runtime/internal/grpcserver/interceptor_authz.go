package grpcserver

import (
	"context"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

type protectedCapabilityAuthorizer interface {
	ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool)
}

// protectedCarrierOnlyCapabilityAuthorizer is installed on the ordinary gRPC
// stack of a protected Runtime. That stack is never a production transport,
// but it must remain fail-closed if a listener is wired incorrectly before the
// carrier-specific evaluator is attached to an admitted native surface.
type protectedCarrierOnlyCapabilityAuthorizer struct{}

func (protectedCarrierOnlyCapabilityAuthorizer) ValidateProtectedCapability(string, string, string, string) (runtimev1.ReasonCode, string, bool) {
	return runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH, "use_protected_desktop_carrier", false
}

type protectedCapabilityIdentityAuthorizer interface {
	ValidateProtectedCapabilityIdentity(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, string, bool)
}

const deferredStreamCapability = "__deferred__"

func newUnaryAuthzInterceptor(authorizer protectedCapabilityAuthorizer) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		if info != nil && info.FullMethod == "/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents" {
			return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH)
		}
		capability, required := protectedCapabilityForUnary(info.FullMethod, req)
		if !required {
			return handler(ctx, req)
		}
		if info.FullMethod == "/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile" {
			if err := validateAgentPresentationRealmIdentity(ctx, req); err != nil {
				return nil, err
			}
		}
		if authorizer == nil {
			return nil, protectedCapabilityAuthorizerUnavailableError()
		}
		tokenID, secret, _ := envelope.ParseAccessTokenFromContext(ctx)
		appID := appIDFromMetadata(ctx)
		if appID == "" {
			appID = appIDFromRequest(req)
		}
		var reasonCode runtimev1.ReasonCode
		var actionHint string
		var ok bool
		validatedSubjectUserID := ""
		if identityAuthorizer, supportsIdentity := authorizer.(protectedCapabilityIdentityAuthorizer); supportsIdentity {
			reasonCode, actionHint, validatedSubjectUserID, ok = identityAuthorizer.ValidateProtectedCapabilityIdentity(appID, tokenID, secret, capability)
		} else {
			reasonCode, actionHint, ok = authorizer.ValidateProtectedCapability(appID, tokenID, secret, capability)
		}
		if !ok {
			return nil, grpcerr.WithReasonCodeOptions(codes.PermissionDenied, reasonCode, grpcerr.ReasonOptions{
				ActionHint: actionHint,
			})
		}
		if isSourceMaterializationMethod(info.FullMethod) && authn.IdentityFromContext(ctx) == nil && strings.TrimSpace(validatedSubjectUserID) != "" {
			ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: strings.TrimSpace(validatedSubjectUserID)})
		}
		ctx = envelope.WithValidatedProtectedCapability(ctx, appID, capability)
		return handler(ctx, req)
	}
}

func isSourceMaterializationMethod(methodID string) bool {
	return methodID == "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource"
}

func validateAgentPresentationRealmIdentity(ctx context.Context, req any) error {
	request, ok := req.(*runtimev1.SetAgentPresentationProfileRequest)
	identity := authn.IdentityFromContext(ctx)
	if !ok || request.GetContext() == nil || identity == nil {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	ownerUserID := strings.TrimSpace(request.GetContext().GetOwnerUserId())
	subjectUserID := strings.TrimSpace(identity.SubjectUserID)
	if ownerUserID == "" || subjectUserID == "" || subjectUserID != ownerUserID {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_AUTH_TOKEN_INVALID)
	}
	return nil
}

func newStreamAuthzInterceptor(authorizer protectedCapabilityAuthorizer) grpc.StreamServerInterceptor {
	return func(srv any, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		capability, required := protectedCapabilityForStream(info.FullMethod, nil)
		if !required {
			return handler(srv, ss)
		}
		if authorizer == nil && capability != deferredStreamCapability {
			return protectedCapabilityAuthorizerUnavailableError()
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
	ctx           context.Context
	checked       bool
	mu            sync.Mutex
}

func (s *authzStream) Context() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx != nil {
		return s.ctx
	}
	return s.ServerStream.Context()
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
	capability, required := protectedCapabilityForStream("", m)
	if required {
		s.capability = capability
	}
	if s.capability == deferredStreamCapability {
		return nil
	}
	if s.authorizer == nil {
		return protectedCapabilityAuthorizerUnavailableError()
	}
	appID := strings.TrimSpace(s.metadataAppID)
	if appID == "" {
		appID = appIDFromRequest(m)
	}
	if reasonCode, actionHint, ok := s.authorizer.ValidateProtectedCapability(appID, s.tokenID, s.secret, s.capability); !ok {
		return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, reasonCode, grpcerr.ReasonOptions{
			ActionHint: actionHint,
		})
	}
	s.ctx = envelope.WithValidatedProtectedCapability(s.ServerStream.Context(), appID, s.capability)
	return nil
}

func protectedCapabilityAuthorizerUnavailableError() error {
	return grpcerr.WithReasonCodeOptions(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, grpcerr.ReasonOptions{
		ActionHint: "protected_capability_authorizer_unavailable",
	})
}

func protectedCapabilityForUnary(fullMethod string, req any) (string, bool) {
	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario":
		return "ai.spend.meter", true
	case "/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob":
		return "ai.spend.meter", true
	case "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource":
		return "runtime.agent.admin", true
	case "/nimi.runtime.v1.RuntimeAgentService/TerminateAgent":
		return "runtime.agent.admin", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetAgent":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListAgents":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile":
		return "runtime.agent.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor":
		return "runtime.agent.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/TranscribeAgentVoiceInput":
		return "runtime.agent.turn.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedProviderProfiles":
		return "runtime.agent.delegation.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedApprovalRequests":
		return "runtime.agent.delegation.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/SubmitDelegatedApprovalDecision":
		return "runtime.agent.delegation.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedDiagnostics":
		return "runtime.agent.delegation.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedReplayTrace":
		return "runtime.agent.delegation.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedControlSurfaceSnapshot":
		return "runtime.agent.delegation.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetAgentState":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/UpdateAgentState":
		return "runtime.agent.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/EnableAutonomy":
		return "runtime.agent.autonomy.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/DisableAutonomy":
		return "runtime.agent.autonomy.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/SetAutonomyConfig":
		return "runtime.agent.autonomy.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListPendingHooks":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/CancelHook":
		return "runtime.agent.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetSharedLocalAgentAIConfig":
		return "runtime.agent.ai_config.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/OverwriteSharedLocalAgentAIConfig",
		"/nimi.runtime.v1.RuntimeAgentService/PreviewSharedLocalAgentAIProfile",
		"/nimi.runtime.v1.RuntimeAgentService/ApplySharedLocalAgentAIProfile":
		return "runtime.agent.ai_config.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/ImportPortableAIProfile":
		return "runtime.agent.ai_profile.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListPortableAIProfiles":
		return "runtime.agent.ai_profile.read", true
	case "/nimi.runtime.v1.RuntimeAppService/SendAppMessage":
		message, ok := req.(*runtimev1.SendAppMessageRequest)
		if !ok {
			return "", false
		}
		fromAppID := strings.TrimSpace(message.GetFromAppId())
		toAppID := strings.TrimSpace(message.GetToAppId())
		if fromAppID != "" && toAppID != "" && fromAppID != toAppID {
			if toAppID == runtimeagentservice.PublicChatRuntimeAppID &&
				runtimeagentservice.IsPublicChatIngressMessageType(message.GetMessageType()) {
				return "runtime.agent.turn.write", true
			}
			return "runtime.app.send.cross_app", true
		}
		return "", false
	default:
		return "", false
	}
}

func protectedCapabilityForStream(fullMethod string, req any) (string, bool) {
	if subscribeReq, ok := req.(*runtimev1.SubscribeAppMessagesRequest); ok {
		for _, fromAppID := range subscribeReq.GetFromAppIds() {
			if strings.TrimSpace(fromAppID) == runtimeagentservice.PublicChatRuntimeAppID {
				return "runtime.agent.turn.read", true
			}
		}
		if strings.TrimSpace(subscribeReq.GetAppId()) == runtimeagentservice.PublicChatRuntimeAppID {
			return "runtime.agent.turn.read", true
		}
	}

	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAiService/StreamScenario":
		return "ai.spend.meter", true
	case "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return "runtime.audit.export", true
	case "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages":
		return deferredStreamCapability, true
	default:
		return "", false
	}
}
