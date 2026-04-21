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
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

type protectedCapabilityAuthorizer interface {
	ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool)
}

const deferredStreamCapability = "__deferred__"

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
		capability, required := protectedCapabilityForStream(info.FullMethod, nil)
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
	capability, required := protectedCapabilityForStream("", m)
	if required {
		s.capability = capability
	}
	if s.capability == deferredStreamCapability {
		return nil
	}
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
	case "/nimi.runtime.v1.RuntimeCognitionService/CreateBank":
		return "runtime.memory.admin", true
	case "/nimi.runtime.v1.RuntimeCognitionService/GetBank":
		return "runtime.memory.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/ListBanks":
		return "runtime.memory.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/DeleteBank":
		return "runtime.memory.admin", true
	case "/nimi.runtime.v1.RuntimeCognitionService/Retain":
		return "runtime.memory.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/Recall":
		return "runtime.memory.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/History":
		return "runtime.memory.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/DeleteMemory":
		return "runtime.memory.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/CreateKnowledgeBank":
		return "runtime.knowledge.admin", true
	case "/nimi.runtime.v1.RuntimeCognitionService/GetKnowledgeBank":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/ListKnowledgeBanks":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/DeleteKnowledgeBank":
		return "runtime.knowledge.admin", true
	case "/nimi.runtime.v1.RuntimeCognitionService/PutPage":
		return "runtime.knowledge.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/GetPage":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/ListPages":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/DeletePage":
		return "runtime.knowledge.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/SearchKeyword":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/SearchHybrid":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/AddLink":
		return "runtime.knowledge.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/RemoveLink":
		return "runtime.knowledge.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/ListLinks":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/ListBacklinks":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/TraverseGraph":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeCognitionService/IngestDocument":
		return "runtime.knowledge.write", true
	case "/nimi.runtime.v1.RuntimeCognitionService/GetIngestTask":
		return "runtime.knowledge.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/InitializeAgent":
		return "runtime.agent.admin", true
	case "/nimi.runtime.v1.RuntimeAgentService/TerminateAgent":
		return "runtime.agent.admin", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetAgent":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/ListAgents":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor":
		return "runtime.agent.chat.write", true
	case "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot":
		return "runtime.agent.chat.read", true
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
	case "/nimi.runtime.v1.RuntimeAgentService/QueryAgentMemory":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/WriteAgentMemory":
		return "runtime.agent.write", true
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
				return "runtime.agent.chat.write", true
			}
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

func protectedCapabilityForStream(fullMethod string, req any) (string, bool) {
	if subscribeReq, ok := req.(*runtimev1.SubscribeAppMessagesRequest); ok {
		for _, fromAppID := range subscribeReq.GetFromAppIds() {
			if strings.TrimSpace(fromAppID) == runtimeagentservice.PublicChatRuntimeAppID {
				return "runtime.agent.chat.read", true
			}
		}
		if strings.TrimSpace(subscribeReq.GetAppId()) == runtimeagentservice.PublicChatRuntimeAppID {
			return "runtime.agent.chat.read", true
		}
	}

	switch fullMethod {
	case "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents":
		return "runtime.audit.export", true
	case "/nimi.runtime.v1.RuntimeCognitionService/SubscribeMemoryEvents":
		return "runtime.memory.read", true
	case "/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentEvents":
		return "runtime.agent.read", true
	case "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages":
		return deferredStreamCapability, true
	default:
		return "", false
	}
}
