package grpcserver

import (
	"context"
	"io"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestProtectedCapabilityForStream(t *testing.T) {
	capability, required := protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents", nil)
	if !required {
		t.Fatal("expected audit export stream to require authz")
	}
	if capability != "runtime.audit.export" {
		t.Fatalf("capability mismatch: %q", capability)
	}

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAiService/StreamScenarioEvents", nil)
	if required || capability != "" {
		t.Fatalf("expected unrelated stream to be unprotected, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeCognitionService/SubscribeMemoryEvents", nil)
	if !required || capability != "runtime.memory.read" {
		t.Fatalf("expected memory events stream to require runtime.memory.read, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentEvents", nil)
	if !required || capability != "runtime.agent.read" {
		t.Fatalf("expected agent events stream to require runtime.agent.read, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream(
		"/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		&runtimev1.SubscribeAppMessagesRequest{
			AppId:      "nimi.desktop",
			FromAppIds: []string{"runtime.agent"},
		},
	)
	if !required || capability != "runtime.agent.chat.read" {
		t.Fatalf("expected runtime.agent app stream to require runtime.agent.chat.read, got (%q,%v)", capability, required)
	}
}

func TestProtectedCapabilityForUnaryMemoryAndRuntimeAgent(t *testing.T) {
	tests := []struct {
		method     string
		request    any
		capability string
	}{
		{
			method:     "/nimi.runtime.v1.RuntimeCognitionService/CreateBank",
			request:    &runtimev1.CreateBankRequest{},
			capability: "runtime.memory.admin",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeCognitionService/Recall",
			request:    &runtimev1.RecallRequest{},
			capability: "runtime.memory.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeCognitionService/DeleteMemory",
			request:    &runtimev1.DeleteMemoryRequest{},
			capability: "runtime.memory.write",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/InitializeAgent",
			request:    &runtimev1.InitializeAgentRequest{},
			capability: "runtime.agent.admin",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetAgentState",
			request:    &runtimev1.GetAgentStateRequest{},
			capability: "runtime.agent.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/WriteAgentMemory",
			request:    &runtimev1.WriteAgentMemoryRequest{},
			capability: "runtime.agent.write",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/SetAutonomyConfig",
			request:    &runtimev1.SetAutonomyConfigRequest{},
			capability: "runtime.agent.autonomy.write",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
			request: &runtimev1.SendAppMessageRequest{
				FromAppId:   "nimi.desktop",
				ToAppId:     "runtime.agent",
				MessageType: "agent.chat.turn.request.v1",
			},
			capability: "runtime.agent.chat.write",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
			request: &runtimev1.SendAppMessageRequest{
				FromAppId:   "nimi.desktop",
				ToAppId:     "nimi.other",
				MessageType: "custom.cross.app",
			},
			capability: "runtime.app.send.cross_app",
		},
	}

	for _, tc := range tests {
		capability, required := protectedCapabilityForUnary(tc.method, tc.request)
		if !required || capability != tc.capability {
			t.Fatalf("%s: expected (%q,true), got (%q,%v)", tc.method, tc.capability, capability, required)
		}
	}
}

func TestProtectedCapabilityForUnaryGenericAppMessageStaysUnprotectedWhenNotCrossApp(t *testing.T) {
	capability, required := protectedCapabilityForUnary("/nimi.runtime.v1.RuntimeAppService/SendAppMessage", &runtimev1.SendAppMessageRequest{
		FromAppId: "nimi.desktop",
		ToAppId:   "nimi.desktop",
	})
	if required || capability != "" {
		t.Fatalf("expected same-app send to stay unprotected, got (%q,%v)", capability, required)
	}
}

type authzTestAuthorizer struct {
	calls      int
	lastAppID  string
	lastToken  string
	lastSecret string
	lastCap    string
	allow      bool
	reason     runtimev1.ReasonCode
}

func (a *authzTestAuthorizer) ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool) {
	a.calls++
	a.lastAppID = appID
	a.lastToken = tokenID
	a.lastSecret = secret
	a.lastCap = capability
	return a.reason, "", a.allow
}

type authzTestStream struct {
	grpc.ServerStream
	ctx      context.Context
	requests []proto.Message
}

func (s *authzTestStream) SetHeader(metadata.MD) error  { return nil }
func (s *authzTestStream) SendHeader(metadata.MD) error { return nil }
func (s *authzTestStream) SetTrailer(metadata.MD)       {}
func (s *authzTestStream) Context() context.Context     { return s.ctx }
func (s *authzTestStream) SendMsg(any) error            { return nil }

func (s *authzTestStream) RecvMsg(m any) error {
	if len(s.requests) == 0 {
		return io.EOF
	}
	request := s.requests[0]
	s.requests = s.requests[1:]
	target, ok := m.(proto.Message)
	if !ok {
		return io.EOF
	}
	payload, err := proto.Marshal(request)
	if err != nil {
		return err
	}
	return proto.Unmarshal(payload, target)
}

func TestStreamAuthzInterceptorUsesFirstRequestAppID(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newStreamAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-1",
		"x-nimi-access-token-secret", "sec-1",
	))
	stream := &authzTestStream{
		ctx: ctx,
		requests: []proto.Message{
			&runtimev1.ExportAuditEventsRequest{AppId: "nimi.desktop"},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.ExportAuditEventsRequest
		return ss.RecvMsg(&got)
	})
	if err != nil {
		t.Fatalf("expected stream authz to allow request, got %v", err)
	}
	if authorizer.calls != 1 {
		t.Fatalf("expected exactly one authz call, got %d", authorizer.calls)
	}
	if authorizer.lastAppID != "nimi.desktop" || authorizer.lastToken != "tok-1" || authorizer.lastSecret != "sec-1" {
		t.Fatalf("unexpected authz inputs: app=%q token=%q secret=%q", authorizer.lastAppID, authorizer.lastToken, authorizer.lastSecret)
	}
	if authorizer.lastCap != "runtime.audit.export" {
		t.Fatalf("unexpected capability: %q", authorizer.lastCap)
	}
}

func TestStreamAuthzInterceptorRejectsUnauthorizedFirstRequest(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: false, reason: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED}
	interceptor := newStreamAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-1",
		"x-nimi-access-token-secret", "sec-1",
	))
	stream := &authzTestStream{
		ctx: ctx,
		requests: []proto.Message{
			&runtimev1.ExportAuditEventsRequest{AppId: "nimi.desktop"},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.ExportAuditEventsRequest
		return ss.RecvMsg(&got)
	})
	if err == nil {
		t.Fatal("expected permission denied")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
}

func TestUnaryAuthzInterceptorUsesNestedContextAppID(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newUnaryAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-memory-1",
		"x-nimi-access-token-secret", "sec-memory-1",
	))
	req := &runtimev1.QueryAgentMemoryRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		AgentId: "agent-1",
	}
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAgentService/QueryAgentMemory",
	}

	_, err := interceptor(ctx, req, info, func(_ context.Context, request any) (any, error) {
		return request, nil
	})
	if err != nil {
		t.Fatalf("expected unary authz to allow request, got %v", err)
	}
	if authorizer.lastAppID != "nimi.desktop" {
		t.Fatalf("expected nested context app id nimi.desktop, got %q", authorizer.lastAppID)
	}
	if authorizer.lastCap != "runtime.agent.read" {
		t.Fatalf("unexpected capability: %q", authorizer.lastCap)
	}
}

func TestStreamAuthzInterceptorUsesNestedMemoryContextAppID(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newStreamAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-memory-1",
		"x-nimi-access-token-secret", "sec-memory-1",
	))
	stream := &authzTestStream{
		ctx: ctx,
		requests: []proto.Message{
			&runtimev1.SubscribeMemoryEventsRequest{
				Context: &runtimev1.MemoryRequestContext{
					AppId:         "nimi.desktop",
					SubjectUserId: "user-1",
				},
			},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeCognitionService/SubscribeMemoryEvents",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.SubscribeMemoryEventsRequest
		return ss.RecvMsg(&got)
	})
	if err != nil {
		t.Fatalf("expected stream authz to allow request, got %v", err)
	}
	if authorizer.lastAppID != "nimi.desktop" {
		t.Fatalf("expected nested context app id nimi.desktop, got %q", authorizer.lastAppID)
	}
	if authorizer.lastCap != "runtime.memory.read" {
		t.Fatalf("unexpected capability: %q", authorizer.lastCap)
	}
}

func TestStreamAuthzInterceptorUsesRuntimeAgentChatCapabilityForAppSubscriptions(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newStreamAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-chat-1",
		"x-nimi-access-token-secret", "sec-chat-1",
	))
	stream := &authzTestStream{
		ctx: ctx,
		requests: []proto.Message{
			&runtimev1.SubscribeAppMessagesRequest{
				AppId:      "nimi.desktop",
				FromAppIds: []string{"runtime.agent"},
			},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.SubscribeAppMessagesRequest
		return ss.RecvMsg(&got)
	})
	if err != nil {
		t.Fatalf("expected stream authz to allow runtime.agent app stream, got %v", err)
	}
	if authorizer.lastAppID != "nimi.desktop" {
		t.Fatalf("expected app id nimi.desktop, got %q", authorizer.lastAppID)
	}
	if authorizer.lastCap != "runtime.agent.chat.read" {
		t.Fatalf("unexpected capability: %q", authorizer.lastCap)
	}
}

func TestStreamAuthzInterceptorSkipsGenericAppSubscriptions(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newStreamAuthzInterceptor(authorizer)
	stream := &authzTestStream{
		ctx: context.Background(),
		requests: []proto.Message{
			&runtimev1.SubscribeAppMessagesRequest{
				AppId:      "nimi.desktop",
				FromAppIds: []string{"nimi.other"},
			},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.SubscribeAppMessagesRequest
		return ss.RecvMsg(&got)
	})
	if err != nil {
		t.Fatalf("expected generic app subscription to bypass chat authz, got %v", err)
	}
	if authorizer.calls != 0 {
		t.Fatalf("expected no authz call for generic app subscription, got %d", authorizer.calls)
	}
}
