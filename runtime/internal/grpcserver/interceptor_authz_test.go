package grpcserver

import (
	"context"
	"io"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
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

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAiService/StreamScenario", nil)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected StreamScenario to require ai.spend.meter, got (%q,%v)", capability, required)
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
	if !required || capability != "runtime.agent.turn.read" {
		t.Fatalf("expected runtime.agent app stream to require runtime.agent.turn.read, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream("/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentVoiceStream", nil)
	if !required || capability != "runtime.agent.turn.read" {
		t.Fatalf("expected Runtime Agent voice stream to require runtime.agent.turn.read, got (%q,%v)", capability, required)
	}
}

func TestRuntimeAgentScopedBindingDefersProtectedAuthzToService(t *testing.T) {
	scopedContext := &runtimev1.AgentRequestContext{
		AppId: "nimi.zhiyu",
		ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{
			BindingId: "binding-zhiyu-agent",
		},
	}

	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot",
		&runtimev1.GetPublicChatSessionSnapshotRequest{Context: scopedContext},
	)
	if required || capability != "" {
		t.Fatalf("scoped public chat snapshot should defer to service binding validation, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAgentService/InterruptAgentVoicePlayback",
		&runtimev1.InterruptAgentVoicePlaybackRequest{Context: scopedContext},
	)
	if required || capability != "" {
		t.Fatalf("scoped voice interrupt should defer to service binding validation, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream(
		"",
		&runtimev1.SubscribeAgentVoiceStreamRequest{Context: scopedContext},
	)
	if !required || capability != deferredStreamCapability {
		t.Fatalf("scoped voice stream should defer to service binding validation, got (%q,%v)", capability, required)
	}

	capability, required = protectedCapabilityForStream(
		"",
		&runtimev1.SubscribeAgentEventsRequest{Context: scopedContext},
	)
	if !required || capability != deferredStreamCapability {
		t.Fatalf("scoped agent events should defer to service binding validation, got (%q,%v)", capability, required)
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
			method:     "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource",
			request:    &runtimev1.MaterializeRealmSourceRequest{},
			capability: "runtime.agent.admin",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
			request: &runtimev1.ExecuteScenarioRequest{
				Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			},
			capability: "ai.spend.meter",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob",
			request: &runtimev1.SubmitScenarioJobRequest{
				Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			},
			capability: "ai.spend.meter",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetAgentState",
			request:    &runtimev1.GetAgentStateRequest{},
			capability: "runtime.agent.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile",
			request:    &runtimev1.SetAgentPresentationProfileRequest{},
			capability: "runtime.agent.write",
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
				MessageType: "runtime.agent.turn.request",
			},
			capability: "runtime.agent.turn.write",
		},
		// K-AGCORE-032 hard cut proof: legacy agent.chat.*.v1 on the primary
		// runtime.agent target must NOT route through the admitted
		// runtime.agent.turn.write seam; it falls back to a generic
		// cross-app capability (and therefore is not silently accepted as a
		// primary public chat ingress carrier).
		{
			method: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
			request: &runtimev1.SendAppMessageRequest{
				FromAppId:   "nimi.desktop",
				ToAppId:     "runtime.agent",
				MessageType: "agent.chat.turn.request.v1",
			},
			capability: "runtime.app.send.cross_app",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
			request: &runtimev1.SendAppMessageRequest{
				FromAppId:   "nimi.desktop",
				ToAppId:     "runtime.agent",
				MessageType: "agent.chat.turn.interrupt.v1",
			},
			capability: "runtime.app.send.cross_app",
		},
		{
			method: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
			request: &runtimev1.SendAppMessageRequest{
				FromAppId:   "nimi.desktop",
				ToAppId:     "runtime.agent",
				MessageType: "agent.chat.session.snapshot.request.v1",
			},
			capability: "runtime.app.send.cross_app",
		},
		// RuntimeAgentService state/admin RPC methods follow K-RPC-004b
		// read/write scopes; admitted live turn data-plane methods use
		// runtime.agent.turn.* because they consume or mutate an active turn.
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor",
			request:    &runtimev1.OpenConversationAnchorRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.write",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot",
			request:    &runtimev1.GetConversationAnchorSnapshotRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetPublicChatSessionSnapshot",
			request:    &runtimev1.GetPublicChatSessionSnapshotRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/InterruptAgentVoicePlayback",
			request:    &runtimev1.InterruptAgentVoicePlaybackRequest{},
			capability: "runtime.agent.turn.write",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedProviderProfiles",
			request:    &runtimev1.ListDelegatedProviderProfilesRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedApprovalRequests",
			request:    &runtimev1.ListDelegatedApprovalRequestsRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/SubmitDelegatedApprovalDecision",
			request:    &runtimev1.SubmitDelegatedApprovalDecisionRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.write",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/ListDelegatedDiagnostics",
			request:    &runtimev1.ListDelegatedDiagnosticsRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedReplayTrace",
			request:    &runtimev1.GetDelegatedReplayTraceRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.read",
		},
		{
			method:     "/nimi.runtime.v1.RuntimeAgentService/GetDelegatedControlSurfaceSnapshot",
			request:    &runtimev1.GetDelegatedControlSurfaceSnapshotRequest{AgentId: "agent-alpha"},
			capability: "runtime.agent.delegation.read",
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

func TestSetAgentPresentationProfileUnaryAuthzInterceptor(t *testing.T) {
	const fullMethod = "/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile"
	tests := []struct {
		name                string
		authorizerAvailable bool
		allow               bool
		realmSubject        string
		scopedBinding       bool
		wantCode            codes.Code
		wantReason          runtimev1.ReasonCode
		wantHandler         bool
		wantCalls           int
	}{
		{
			name:                "allowed write capability",
			authorizerAvailable: true,
			allow:               true,
			realmSubject:        "user-1",
			wantCode:            codes.OK,
			wantHandler:         true,
			wantCalls:           1,
		},
		{
			name:                "anonymous realm identity",
			authorizerAvailable: true,
			allow:               true,
			wantCode:            codes.Unauthenticated,
			wantReason:          runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			wantHandler:         false,
			wantCalls:           0,
		},
		{
			name:                "mismatched realm subject",
			authorizerAvailable: true,
			allow:               true,
			realmSubject:        "other-user",
			wantCode:            codes.Unauthenticated,
			wantReason:          runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			wantHandler:         false,
			wantCalls:           0,
		},
		{
			name:                "anonymous scoped binding cannot defer realm auth",
			authorizerAvailable: true,
			allow:               true,
			scopedBinding:       true,
			wantCode:            codes.Unauthenticated,
			wantReason:          runtimev1.ReasonCode_AUTH_TOKEN_INVALID,
			wantHandler:         false,
			wantCalls:           0,
		},
		{
			name:                "denied write capability",
			authorizerAvailable: true,
			realmSubject:        "user-1",
			wantCode:            codes.PermissionDenied,
			wantHandler:         false,
			wantCalls:           1,
		},
		{
			name:         "authorizer unavailable",
			realmSubject: "user-1",
			wantCode:     codes.PermissionDenied,
			wantHandler:  false,
			wantCalls:    0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var authorizer *authzTestAuthorizer
			var interceptorAuthorizer protectedCapabilityAuthorizer
			if tc.authorizerAvailable {
				authorizer = &authzTestAuthorizer{allow: tc.allow, reason: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED}
				interceptorAuthorizer = authorizer
			}
			interceptor := newUnaryAuthzInterceptor(interceptorAuthorizer)
			called := false
			ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop"))
			if tc.scopedBinding {
				ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
					"x-nimi-app-id", "nimi.desktop",
					"x-nimi-runtime-scoped-binding-id", "binding-agent-presentation",
				))
			}
			if tc.realmSubject != "" {
				ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: tc.realmSubject})
			}
			request := &runtimev1.SetAgentPresentationProfileRequest{Context: &runtimev1.AgentRequestContext{
				AppId:       "nimi.desktop",
				OwnerUserId: "user-1",
			}}
			_, err := interceptor(ctx, request, &grpc.UnaryServerInfo{FullMethod: fullMethod}, func(_ context.Context, request any) (any, error) {
				called = true
				return request, nil
			})
			if status.Code(err) != tc.wantCode {
				t.Fatalf("code = %s, want %s: %v", status.Code(err), tc.wantCode, err)
			}
			if called != tc.wantHandler {
				t.Fatalf("handler called = %v, want %v", called, tc.wantHandler)
			}
			if tc.wantReason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.wantReason {
					t.Fatalf("reason = %s, %v; want %s", reason, ok, tc.wantReason)
				}
			}
			if authorizer != nil {
				if authorizer.calls != tc.wantCalls {
					t.Fatalf("authorizer calls = %d, want %d", authorizer.calls, tc.wantCalls)
				}
				if tc.wantCalls > 0 && authorizer.lastCap != "runtime.agent.write" {
					t.Fatalf("capability = %q, want runtime.agent.write", authorizer.lastCap)
				}
			}
		})
	}
}

func TestProtectedCapabilityForUnaryExemptsRouteDescribeProbe(t *testing.T) {
	tests := []struct {
		name         string
		scenarioType runtimev1.ScenarioType
		namespace    string
	}{
		{
			name:         "text generate",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			namespace:    "nimi.scenario.text_generate.route_describe",
		},
		{
			name:         "text embed",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
			namespace:    "nimi.scenario.text_embed.route_describe",
		},
		{
			name:         "speech synthesize",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			namespace:    "nimi.scenario.speech_synthesize.route_describe",
		},
		{
			name:         "speech transcribe",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			namespace:    "nimi.scenario.speech_transcribe.route_describe",
		},
		{
			name:         "voice clone",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
			namespace:    "nimi.scenario.voice_clone.route_describe",
		},
		{
			name:         "voice design",
			scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN,
			namespace:    "nimi.scenario.voice_design.route_describe",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			capability, required := protectedCapabilityForUnary(
				"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
				&runtimev1.ExecuteScenarioRequest{
					Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
					ScenarioType: tc.scenarioType,
					Extensions: []*runtimev1.ScenarioExtension{
						routeDescribeProbeExtension(t, tc.namespace, "binding-ref"),
					},
				},
			)
			if required || capability != "" {
				t.Fatalf("expected matching route describe probe to bypass spend-meter authz, got (%q,%v)", capability, required)
			}
		})
	}
}

func TestProtectedCapabilityForUnaryExecuteScenarioRequiresSpendMeter(t *testing.T) {
	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		&runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		},
	)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected normal ExecuteScenario to require ai.spend.meter, got (%q,%v)", capability, required)
	}
}

func TestProtectedCapabilityForUnaryMismatchedRouteDescribeNamespaceRequiresSpendMeter(t *testing.T) {
	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		&runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			Extensions: []*runtimev1.ScenarioExtension{
				routeDescribeProbeExtension(t, "nimi.scenario.speech_synthesize.route_describe", "binding-ref"),
			},
		},
	)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected mismatched route describe namespace to require ai.spend.meter, got (%q,%v)", capability, required)
	}
}

func TestProtectedCapabilityForUnaryUnsupportedRouteDescribeScenarioRequiresSpendMeter(t *testing.T) {
	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		&runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Extensions: []*runtimev1.ScenarioExtension{
				routeDescribeProbeExtension(t, "nimi.scenario.text_generate.route_describe", "binding-ref"),
			},
		},
	)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected unsupported route describe scenario to require ai.spend.meter, got (%q,%v)", capability, required)
	}
}

func TestProtectedCapabilityForUnaryMalformedRouteDescribeProbeRequiresSpendMeter(t *testing.T) {
	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		&runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			Extensions: []*runtimev1.ScenarioExtension{
				routeDescribeProbeExtension(t, "nimi.scenario.text_generate.route_describe", ""),
			},
		},
	)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected malformed route describe probe to require ai.spend.meter, got (%q,%v)", capability, required)
	}
}

func TestProtectedCapabilityForUnaryRouteDescribeProbeWithExtraExtensionRequiresSpendMeter(t *testing.T) {
	capability, required := protectedCapabilityForUnary(
		"/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
		&runtimev1.ExecuteScenarioRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop"},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			Extensions: []*runtimev1.ScenarioExtension{
				routeDescribeProbeExtension(t, "nimi.scenario.text_generate.route_describe", "binding-ref"),
				{Namespace: "nimi.scenario.image.request"},
			},
		},
	)
	if !required || capability != "ai.spend.meter" {
		t.Fatalf("expected route describe probe with extra extension to require ai.spend.meter, got (%q,%v)", capability, required)
	}
}

func routeDescribeProbeExtension(t *testing.T, namespace string, resolvedBindingRef string) *runtimev1.ScenarioExtension {
	t.Helper()
	payload, err := structpb.NewStruct(map[string]any{
		"version":            "v1",
		"resolvedBindingRef": resolvedBindingRef,
	})
	if err != nil {
		t.Fatalf("build route describe payload: %v", err)
	}
	return &runtimev1.ScenarioExtension{
		Namespace: namespace,
		Payload:   payload,
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
	actionHint string
}

type authzIdentityTestAuthorizer struct {
	authzTestAuthorizer
	subjectUserID string
}

func (a *authzIdentityTestAuthorizer) ValidateProtectedCapabilityIdentity(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, string, bool) {
	reason, actionHint, ok := a.authzTestAuthorizer.ValidateProtectedCapability(appID, tokenID, secret, capability)
	return reason, actionHint, a.subjectUserID, ok
}

func (a *authzTestAuthorizer) ValidateProtectedCapability(appID string, tokenID string, secret string, capability string) (runtimev1.ReasonCode, string, bool) {
	a.calls++
	a.lastAppID = appID
	a.lastToken = tokenID
	a.lastSecret = secret
	a.lastCap = capability
	return a.reason, a.actionHint, a.allow
}

func TestUnaryAuthzProjectsValidatedProtectedTokenSubjectForSourceMaterialization(t *testing.T) {
	authorizer := &authzIdentityTestAuthorizer{
		authzTestAuthorizer: authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED},
		subjectUserID:       "account-materializer-1",
	}
	interceptor := newUnaryAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-access-token-id", "tok-materializer-1",
		"x-nimi-access-token-secret", "sec-materializer-1",
	))
	request := &runtimev1.MaterializeRealmSourceRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "account-materializer-1",
			OwnerUserId:   "account-materializer-1",
		},
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAgentService/MaterializeRealmSource"}
	_, err := interceptor(ctx, request, info, func(handlerCtx context.Context, _ any) (any, error) {
		identity := authn.IdentityFromContext(handlerCtx)
		if identity == nil || identity.SubjectUserID != "account-materializer-1" {
			t.Fatalf("expected validated protected token subject, got %#v", identity)
		}
		return &runtimev1.MaterializeRealmSourceResponse{}, nil
	})
	if err != nil {
		t.Fatalf("source materialization authz failed: %v", err)
	}
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

func TestUnaryAuthzInterceptorFailsClosedWhenAuthorizerUnavailable(t *testing.T) {
	interceptor := newUnaryAuthzInterceptor(nil)
	called := false
	req := &runtimev1.QueryAgentMemoryRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId: "nimi.desktop",
		},
		AgentId: "agent-1",
	}
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAgentService/QueryAgentMemory",
	}

	_, err := interceptor(context.Background(), req, info, func(_ context.Context, request any) (any, error) {
		called = true
		return request, nil
	})
	if err == nil {
		t.Fatal("expected permission denied")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
	if !strings.Contains(status.Convert(err).Message(), "protected_capability_authorizer_unavailable") {
		t.Fatalf("expected unavailable action hint, got %q", status.Convert(err).Message())
	}
	if called {
		t.Fatal("protected unary handler ran without authorizer")
	}
}

func TestProtectedCarrierOnlyCapabilityAuthorizerRejectsPortableGrant(t *testing.T) {
	interceptor := newUnaryAuthzInterceptor(protectedCarrierOnlyCapabilityAuthorizer{})
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-access-token-id", "portable-token-id",
		"x-nimi-access-token-secret", "portable-token-secret",
	))
	called := false
	_, err := interceptor(
		ctx,
		&runtimev1.RemoveModelRequest{AppId: "nimi.desktop", ModelId: "local/model"},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeModelService/RemoveModel"},
		func(context.Context, any) (any, error) {
			called = true
			return &runtimev1.Ack{}, nil
		},
	)
	if err == nil {
		t.Fatal("carrier-only authorizer unexpectedly accepted portable grant metadata")
	}
	if called {
		t.Fatal("carrier-only authorizer invoked protected handler")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_PROTECTED_ORIGIN_ROLE_MISMATCH {
		t.Fatalf("carrier-only authorizer reason = %v (present=%v), err=%v", reason, ok, err)
	}
}

func TestUnaryAuthzInterceptorAllowsUnprotectedMethodWithoutAuthorizer(t *testing.T) {
	interceptor := newUnaryAuthzInterceptor(nil)
	called := false
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAiService/GetScenario",
	}

	_, err := interceptor(context.Background(), &runtimev1.SendAppMessageRequest{}, info, func(_ context.Context, request any) (any, error) {
		called = true
		return request, nil
	})
	if err != nil {
		t.Fatalf("expected unprotected method to pass, got %v", err)
	}
	if !called {
		t.Fatal("expected unprotected unary handler to run")
	}
}

func TestUnaryAuthzInterceptorDefersVoiceInterruptWithScopedBindingMetadata(t *testing.T) {
	authorizer := &authzTestAuthorizer{
		allow:      false,
		reason:     runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED,
		actionHint: "provide_access_token_credentials",
	}
	interceptor := newUnaryAuthzInterceptor(authorizer)
	called := false
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-runtime-scoped-binding-id",
		"binding-voice-write",
	))
	req := &runtimev1.InterruptAgentVoicePlaybackRequest{
		Context: &runtimev1.AgentRequestContext{
			AppId: "nimi.zhiyu",
		},
		ConversationAnchorId: "agent_anchor_1",
		TurnId:               "agent_turn_1",
		VoiceStreamId:        "voice_stream_1",
	}
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAgentService/InterruptAgentVoicePlayback",
	}

	_, err := interceptor(ctx, req, info, func(_ context.Context, request any) (any, error) {
		called = true
		return request, nil
	})
	if err != nil {
		t.Fatalf("expected scoped binding metadata to defer protected authz, got %v", err)
	}
	if !called {
		t.Fatal("expected voice interrupt handler to run")
	}
	if authorizer.calls != 0 {
		t.Fatalf("scoped binding metadata path must defer to service validation, authorizer calls=%d", authorizer.calls)
	}
}

func TestStreamAuthzInterceptorFailsClosedWhenAuthorizerUnavailable(t *testing.T) {
	interceptor := newStreamAuthzInterceptor(nil)
	stream := &authzTestStream{
		ctx: context.Background(),
		requests: []proto.Message{
			&runtimev1.ExportAuditEventsRequest{AppId: "nimi.desktop"},
		},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAuditService/ExportAuditEvents",
		IsServerStream: true,
	}

	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		t.Fatal("protected stream handler ran without authorizer")
		return nil
	})
	if err == nil {
		t.Fatal("expected permission denied")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
}

func TestDeferredStreamAuthzInterceptorFailsClosedForProtectedRequestWithoutAuthorizer(t *testing.T) {
	interceptor := newStreamAuthzInterceptor(nil)
	stream := &authzTestStream{
		ctx: context.Background(),
		requests: []proto.Message{
			&runtimev1.SubscribeAppMessagesRequest{
				AppId: "runtime.agent",
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
	if err == nil {
		t.Fatal("expected permission denied")
	}
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("unexpected status code: %v", status.Code(err))
	}
}

func TestDeferredStreamAuthzInterceptorAllowsUnprotectedRequestWithoutAuthorizer(t *testing.T) {
	interceptor := newStreamAuthzInterceptor(nil)
	stream := &authzTestStream{
		ctx: context.Background(),
		requests: []proto.Message{
			&runtimev1.SubscribeAppMessagesRequest{
				AppId: "nimi.desktop",
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
		t.Fatalf("expected unprotected deferred stream request to pass, got %v", err)
	}
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
	authorizer := &authzTestAuthorizer{allow: false, reason: runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED, actionHint: "provide_access_token_credentials"}
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
	if !strings.Contains(status.Convert(err).Message(), "provide_access_token_credentials") {
		t.Fatalf("expected structured action hint, got %q", status.Convert(err).Message())
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

func TestUnaryAuthzInterceptorMarksValidatedProtectedCapability(t *testing.T) {
	authorizer := &authzTestAuthorizer{allow: true, reason: runtimev1.ReasonCode_ACTION_EXECUTED}
	interceptor := newUnaryAuthzInterceptor(authorizer)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-access-token-id", "tok-chat-1",
		"x-nimi-access-token-secret", "sec-chat-1",
	))
	req := &runtimev1.SendAppMessageRequest{
		FromAppId:   "nimi.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
	}
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAppService/SendAppMessage",
	}

	_, err := interceptor(ctx, req, info, func(ctx context.Context, request any) (any, error) {
		if !envelope.HasValidatedProtectedCapability(ctx, "nimi.avatar", "runtime.agent.turn.write") {
			t.Fatal("expected handler context to carry validated protected capability")
		}
		return request, nil
	})
	if err != nil {
		t.Fatalf("expected unary authz to allow request, got %v", err)
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
	if authorizer.lastCap != "runtime.agent.turn.read" {
		t.Fatalf("unexpected capability: %q", authorizer.lastCap)
	}
}

func TestStreamAuthzInterceptorMarksValidatedProtectedCapability(t *testing.T) {
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
				AppId:      "nimi.avatar",
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
		if err := ss.RecvMsg(&got); err != nil {
			return err
		}
		if !envelope.HasValidatedProtectedCapability(ss.Context(), "nimi.avatar", "runtime.agent.turn.read") {
			t.Fatal("expected stream context to carry validated protected capability")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected stream authz to allow runtime.agent app stream, got %v", err)
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
