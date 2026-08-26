package grpcserver

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
)

const (
	protectedLocalAppRealmResourcePrefix = "realm-channel:"
	protectedLocalAppAIResourcePrefix    = "ai-realtime:"
	protectedLocalAppAgentResourcePrefix = "agent-realtime:"
)

type protectedLocalAppRealmRealtimeRevoker interface {
	RevokeProtectedLocalAppRealmRealtimeChannel(string)
}

type protectedLocalAppAIRealtimeRevoker interface {
	RevokeProtectedLocalAppAIRealtimeSession(string)
}

type protectedLocalAppAgentRealtimeRevoker interface {
	RevokeProtectedLocalAppAgentRealtimeSession(string)
}

func authorizeProtectedLocalAppRealtimeResource(ctx context.Context, connection *protectedlocal.LocalAppConnection, method string, request any) error {
	key := protectedLocalAppRealtimeResourceKey(method, request)
	if key == "" || protectedLocalAppRealtimeOpenMethod(method) {
		return nil
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.SessionInvalidated == nil {
		return nil
	}
	handle := protectedlocal.LocalAppSessionHandle{SessionID: decision.SessionID}
	current, currentOK := connection.Session()
	if !currentOK || current.SessionID != handle.SessionID || !connection.SessionOwnsResource(current, key) {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	return nil
}

func updateProtectedLocalAppRealtimeResource(
	ctx context.Context,
	connection *protectedlocal.LocalAppConnection,
	method string,
	request any,
	response any,
	server any,
) error {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	if !ok || decision.SessionInvalidated == nil || connection == nil {
		return nil
	}
	handle, current := connection.Session()
	open := protectedLocalAppRealtimeOpenMethod(method)
	key := ""
	var cleanup func()
	if open {
		key = protectedLocalAppRealtimeResourceKey(method, response)
		cleanup = protectedLocalAppRealtimeCleanup(server, key)
	}
	if !current || handle.SessionID != decision.SessionID {
		if cleanup != nil {
			cleanup()
		}
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	if protectedLocalAppRealtimeCloseMethod(method) {
		if key := protectedLocalAppRealtimeResourceKey(method, request); key != "" {
			connection.ReleaseSessionResource(handle, key)
		}
		return nil
	}
	if !open {
		return nil
	}
	if key == "" || cleanup == nil || !connection.BindSessionResource(handle, key, cleanup) {
		if cleanup != nil {
			cleanup()
		}
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	}
	return nil
}

func protectedLocalAppRealtimeCleanup(server any, key string) func() {
	switch {
	case strings.HasPrefix(key, protectedLocalAppRealmResourcePrefix):
		owner, ok := server.(protectedLocalAppRealmRealtimeRevoker)
		if !ok {
			return nil
		}
		id := strings.TrimPrefix(key, protectedLocalAppRealmResourcePrefix)
		return func() { owner.RevokeProtectedLocalAppRealmRealtimeChannel(id) }
	case strings.HasPrefix(key, protectedLocalAppAIResourcePrefix):
		owner, ok := server.(protectedLocalAppAIRealtimeRevoker)
		if !ok {
			return nil
		}
		id := strings.TrimPrefix(key, protectedLocalAppAIResourcePrefix)
		return func() { owner.RevokeProtectedLocalAppAIRealtimeSession(id) }
	case strings.HasPrefix(key, protectedLocalAppAgentResourcePrefix):
		owner, ok := server.(protectedLocalAppAgentRealtimeRevoker)
		if !ok {
			return nil
		}
		id := strings.TrimPrefix(key, protectedLocalAppAgentResourcePrefix)
		return func() { owner.RevokeProtectedLocalAppAgentRealtimeSession(id) }
	default:
		return nil
	}
}

func protectedLocalAppRealtimeOpenMethod(method string) bool {
	return method == protectedOpenRealmRealtimeChannelMethod || method == protectedOpenAIRealtimeMethod || method == protectedOpenAgentRealtimeMethod
}

func protectedLocalAppRealtimeCloseMethod(method string) bool {
	return method == protectedCloseRealmRealtimeChannelMethod || method == protectedCloseAIRealtimeMethod || method == protectedCloseAgentRealtimeMethod
}

func protectedLocalAppRealtimeResourceKey(method string, message any) string {
	switch method {
	case protectedOpenRealmRealtimeChannelMethod:
		if response, ok := message.(*runtimev1.OpenRealmRealtimeChannelResponse); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppRealmResourcePrefix, response.GetChannelId())
		}
	case protectedSubscribeRealmRealtimeEventsMethod:
		if request, ok := message.(*runtimev1.SubscribeRealmRealtimeEventsRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppRealmResourcePrefix, request.GetChannelId())
		}
	case protectedAckRealmRealtimeEventsMethod:
		if request, ok := message.(*runtimev1.AckRealmRealtimeEventsRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppRealmResourcePrefix, request.GetChannelId())
		}
	case protectedCloseRealmRealtimeSubscriptionMethod:
		if request, ok := message.(*runtimev1.CloseRealmRealtimeSubscriptionRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppRealmResourcePrefix, request.GetChannelId())
		}
	case protectedCloseRealmRealtimeChannelMethod:
		if request, ok := message.(*runtimev1.CloseRealmRealtimeChannelRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppRealmResourcePrefix, request.GetChannelId())
		}
	case protectedOpenAIRealtimeMethod:
		if response, ok := message.(*runtimev1.OpenRealtimeSessionResponse); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, response.GetRealtimeSessionId())
		}
	case protectedAppendAIRealtimeInputMethod:
		if request, ok := message.(*runtimev1.AppendRealtimeInputRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedSubmitAIRealtimeOwnerControlMethod:
		if request, ok := message.(*runtimev1.SubmitRealtimeOwnerControlRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedReadAIRealtimeEventsMethod:
		if request, ok := message.(*runtimev1.ReadRealtimeEventsRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedInterruptAIRealtimeOutputMethod:
		if request, ok := message.(*runtimev1.InterruptRealtimeOutputRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedCloseAIRealtimeMethod:
		if request, ok := message.(*runtimev1.CloseRealtimeSessionRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAIResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedOpenAgentRealtimeMethod:
		if response, ok := message.(*runtimev1.OpenLocalAppAgentRealtimeResponse); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, response.GetRealtimeSessionId())
		}
	case protectedAppendAgentRealtimeInputMethod:
		if request, ok := message.(*runtimev1.AppendLocalAppAgentRealtimeInputRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedSubscribeAgentRealtimeEventsMethod:
		if request, ok := message.(*runtimev1.SubscribeLocalAppAgentRealtimeEventsRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedGetAgentRealtimeStatusMethod:
		if request, ok := message.(*runtimev1.GetLocalAppAgentRealtimeStatusRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedInterruptAgentRealtimeOutputMethod:
		if request, ok := message.(*runtimev1.InterruptLocalAppAgentRealtimeOutputRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, request.GetRealtimeSessionId())
		}
	case protectedCloseAgentRealtimeMethod:
		if request, ok := message.(*runtimev1.CloseLocalAppAgentRealtimeRequest); ok {
			return protectedLocalAppRealtimeKey(protectedLocalAppAgentResourcePrefix, request.GetRealtimeSessionId())
		}
	}
	return ""
}

func protectedLocalAppRealtimeKey(prefix, id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return ""
	}
	return prefix + id
}
