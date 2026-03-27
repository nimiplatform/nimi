package grpcserver

import (
	"context"
	"io"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func mustListAuditEvents(t *testing.T, store *auditlog.Store, req *runtimev1.ListAuditEventsRequest) *runtimev1.ListAuditEventsResponse {
	t.Helper()
	resp, err := store.ListEvents(req)
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	return resp
}

func mustListUsageStats(t *testing.T, store *auditlog.Store, req *runtimev1.ListUsageStatsRequest) *runtimev1.ListUsageStatsResponse {
	t.Helper()
	resp, err := store.ListUsage(req)
	if err != nil {
		t.Fatalf("ListUsage: %v", err)
	}
	return resp
}

func TestUnaryAuditInterceptorCapturesCallerMetadataForAI(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-caller-kind", "third-party-app",
		"x-nimi-caller-id", "app:novelizer",
		"x-nimi-surface-id", "chat-export",
		"x-nimi-trace-id", "trace-unary-001",
	))
	req := scenarioExecuteTextRequest("nimi.desktop", "user-001", "local/qwen2.5")
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
	}
	resp, err := interceptor(ctx, req, info, func(context.Context, any) (any, error) {
		return &runtimev1.ExecuteScenarioResponse{
			ModelResolved: "qwen2.5",
			Usage: &runtimev1.UsageStats{
				InputTokens:  12,
				OutputTokens: 6,
				ComputeMs:    21,
			},
		}, nil
	})
	if err != nil {
		t.Fatalf("unary interceptor returned error: %v", err)
	}
	if resp == nil {
		t.Fatalf("unary response must not be nil")
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 audit event, got=%d", len(events.GetEvents()))
	}
	event := events.GetEvents()[0]
	if event.GetOperation() != "execute_scenario" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP {
		t.Fatalf("caller kind mismatch: %v", event.GetCallerKind())
	}
	if event.GetCallerId() != "app:novelizer" {
		t.Fatalf("caller id mismatch: %s", event.GetCallerId())
	}
	if event.GetSurfaceId() != "chat-export" {
		t.Fatalf("surface id mismatch: %s", event.GetSurfaceId())
	}
	if event.GetTraceId() != "trace-unary-001" {
		t.Fatalf("trace id mismatch: %s", event.GetTraceId())
	}

	usage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{Capability: "runtime.ai.execute_scenario"})
	if len(usage.GetRecords()) != 1 {
		t.Fatalf("expected 1 usage record, got=%d", len(usage.GetRecords()))
	}
	record := usage.GetRecords()[0]
	if record.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP {
		t.Fatalf("usage caller kind mismatch: %v", record.GetCallerKind())
	}
	if record.GetCallerId() != "app:novelizer" {
		t.Fatalf("usage caller id mismatch: %s", record.GetCallerId())
	}
	if record.GetInputTokens() != 12 || record.GetOutputTokens() != 6 || record.GetComputeMs() != 21 {
		t.Fatalf("usage token mismatch: in=%d out=%d ms=%d", record.GetInputTokens(), record.GetOutputTokens(), record.GetComputeMs())
	}
}

func TestStreamAuditInterceptorCapturesCallerMetadataForAI(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newStreamAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "svc:orchestrator",
		"x-nimi-surface-id", "background-job",
		"x-nimi-trace-id", "trace-stream-001",
	))
	req := scenarioStreamTextRequest("nimi.desktop", "user-001", "local/qwen2.5")
	stream := &auditInterceptorTestStream{
		ctx:      ctx,
		requests: []*runtimev1.StreamScenarioRequest{req},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		IsServerStream: true,
	}
	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.StreamScenarioRequest
		if recvErr := ss.RecvMsg(&got); recvErr != nil {
			return recvErr
		}
		if got.GetHead().GetModelId() != "local/qwen2.5" {
			t.Fatalf("request model mismatch: %s", got.GetHead().GetModelId())
		}
		if sendErr := ss.SendMsg(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
			TraceId:   "trace-stream-001",
			Payload: &runtimev1.StreamScenarioEvent_Started{
				Started: &runtimev1.ScenarioStreamStarted{
					ModelResolved: "qwen2.5",
					RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				},
			},
		}); sendErr != nil {
			return sendErr
		}
		if sendErr := ss.SendMsg(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
			TraceId:   "trace-stream-001",
			Payload: &runtimev1.StreamScenarioEvent_Usage{
				Usage: &runtimev1.UsageStats{
					InputTokens:  8,
					OutputTokens: 5,
					ComputeMs:    19,
				},
			},
		}); sendErr != nil {
			return sendErr
		}
		return ss.SendMsg(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
			TraceId:   "trace-stream-001",
			Payload: &runtimev1.StreamScenarioEvent_Completed{
				Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				},
			},
		})
	})
	if err != nil {
		t.Fatalf("stream interceptor returned error: %v", err)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 audit event, got=%d", len(events.GetEvents()))
	}
	event := events.GetEvents()[0]
	if event.GetOperation() != "stream_scenario" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_SERVICE {
		t.Fatalf("caller kind mismatch: %v", event.GetCallerKind())
	}
	if event.GetCallerId() != "svc:orchestrator" {
		t.Fatalf("caller id mismatch: %s", event.GetCallerId())
	}
	if event.GetSurfaceId() != "background-job" {
		t.Fatalf("surface id mismatch: %s", event.GetSurfaceId())
	}
	if event.GetTraceId() != "trace-stream-001" {
		t.Fatalf("trace id mismatch: %s", event.GetTraceId())
	}

	usage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{Capability: "runtime.ai.stream_scenario"})
	if len(usage.GetRecords()) != 1 {
		t.Fatalf("expected 1 usage record, got=%d", len(usage.GetRecords()))
	}
	record := usage.GetRecords()[0]
	if record.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_SERVICE {
		t.Fatalf("usage caller kind mismatch: %v", record.GetCallerKind())
	}
	if record.GetCallerId() != "svc:orchestrator" {
		t.Fatalf("usage caller id mismatch: %s", record.GetCallerId())
	}
	if record.GetInputTokens() != 8 || record.GetOutputTokens() != 5 || record.GetComputeMs() != 19 {
		t.Fatalf("usage token mismatch: in=%d out=%d ms=%d", record.GetInputTokens(), record.GetOutputTokens(), record.GetComputeMs())
	}
}

func TestUnaryAuditInterceptorRejectsMetadataAppIDConflict(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-trace-id", "trace-conflict-unary",
	))
	req := scenarioExecuteTextRequest("other.app", "user-001", "local/qwen2.5")
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
	}

	_, err := interceptor(ctx, req, info, func(context.Context, any) (any, error) {
		t.Fatalf("handler should not run on app id conflict")
		return nil, nil
	})
	if err == nil {
		t.Fatalf("expected conflict error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 audit event, got=%d", len(events.GetEvents()))
	}
	if events.GetEvents()[0].GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_DOMAIN_FIELD_CONFLICT {
		t.Fatalf("unexpected audit reason: %v", events.GetEvents()[0].GetReasonCode())
	}
}

func TestStreamAuditInterceptorDoesNotDuplicateMetadataAppIDConflictValidation(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newStreamAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-app-id", "nimi.desktop",
		"x-nimi-trace-id", "trace-conflict-stream",
	))
	req := scenarioStreamTextRequest("other.app", "user-001", "local/qwen2.5")
	stream := &auditInterceptorTestStream{
		ctx:      ctx,
		requests: []*runtimev1.StreamScenarioRequest{req},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		IsServerStream: true,
	}
	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.StreamScenarioRequest
		return ss.RecvMsg(&got)
	})
	if err != nil {
		t.Fatalf("audit interceptor should not re-run app id conflict validation: %v", err)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 audit event, got=%d", len(events.GetEvents()))
	}
	event := events.GetEvents()[0]
	if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("unexpected audit reason: %v", event.GetReasonCode())
	}
	if !strings.Contains(event.GetOperation(), "stream_scenario") {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
}

func TestUnaryAuditInterceptorUsesRecordedQueueWaitMs(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-caller-kind", "third-party-app",
		"x-nimi-caller-id", "app:novelizer",
	))
	req := scenarioExecuteTextRequest("nimi.desktop", "user-001", "local/qwen2.5")
	info := &grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario"}
	_, err := interceptor(ctx, req, info, func(handlerCtx context.Context, _ any) (any, error) {
		usagemetrics.SetQueueWaitMS(handlerCtx, 37)
		return &runtimev1.ExecuteScenarioResponse{}, nil
	})
	if err != nil {
		t.Fatalf("unary interceptor returned error: %v", err)
	}

	usage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{Capability: "runtime.ai.execute_scenario"})
	if len(usage.GetRecords()) != 1 {
		t.Fatalf("expected 1 usage record, got=%d", len(usage.GetRecords()))
	}
	if usage.GetRecords()[0].GetQueueWaitMs() != 37 {
		t.Fatalf("queue wait mismatch: got=%d want=37", usage.GetRecords()[0].GetQueueWaitMs())
	}
}

func TestStreamAuditInterceptorUsesRecordedQueueWaitMs(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newStreamAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "svc:orchestrator",
	))
	req := scenarioStreamTextRequest("nimi.desktop", "user-001", "local/qwen2.5")
	stream := &auditInterceptorTestStream{
		ctx:      ctx,
		requests: []*runtimev1.StreamScenarioRequest{req},
	}
	info := &grpc.StreamServerInfo{
		FullMethod:     "/nimi.runtime.v1.RuntimeAiService/StreamScenario",
		IsServerStream: true,
	}
	err := interceptor(nil, stream, info, func(_ any, ss grpc.ServerStream) error {
		var got runtimev1.StreamScenarioRequest
		if recvErr := ss.RecvMsg(&got); recvErr != nil {
			return recvErr
		}
		usagemetrics.SetQueueWaitMS(ss.Context(), 91)
		return ss.SendMsg(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		})
	})
	if err != nil {
		t.Fatalf("stream interceptor returned error: %v", err)
	}

	usage := mustListUsageStats(t, store, &runtimev1.ListUsageStatsRequest{Capability: "runtime.ai.stream_scenario"})
	if len(usage.GetRecords()) != 1 {
		t.Fatalf("expected 1 usage record, got=%d", len(usage.GetRecords()))
	}
	if usage.GetRecords()[0].GetQueueWaitMs() != 91 {
		t.Fatalf("queue wait mismatch: got=%d want=91", usage.GetRecords()[0].GetQueueWaitMs())
	}
}

func TestUnaryAuditInterceptorCapturesGrantAuditFields(t *testing.T) {
	store := auditlog.New(128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-caller-kind", "third-party-service",
		"x-nimi-caller-id", "svc:grant-runner",
		"x-nimi-surface-id", "grant-ui",
		"x-nimi-trace-id", "trace-grant-001",
	))
	req := &runtimev1.AuthorizeExternalPrincipalRequest{
		Domain:                "app-auth",
		AppId:                 "nimi.desktop",
		ExternalPrincipalId:   "agent-openclaw",
		ExternalPrincipalType: runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT,
		SubjectUserId:         "user-001",
		ConsentId:             "consent-001",
		ConsentVersion:        "v1",
		PolicyVersion:         "policy-v1",
		ScopeCatalogVersion:   "sdk-v1",
		ResourceSelectors: &runtimev1.ResourceSelectors{
			ConversationIds: []string{"conv-1"},
		},
	}
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeGrantService/AuthorizeExternalPrincipal",
	}
	_, err := interceptor(ctx, req, info, func(context.Context, any) (any, error) {
		return &runtimev1.AuthorizeExternalPrincipalResponse{
			TokenId:                   "tok-001",
			AppId:                     "nimi.desktop",
			SubjectUserId:             "user-001",
			ExternalPrincipalId:       "agent-openclaw",
			PolicyVersion:             "policy-v1",
			IssuedScopeCatalogVersion: "sdk-v1",
		}, nil
	})
	if err != nil {
		t.Fatalf("unary interceptor returned error: %v", err)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.grant"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 grant audit event, got=%d", len(events.GetEvents()))
	}
	event := events.GetEvents()[0]
	if event.GetCapability() == "" || event.GetPrincipalId() == "" || event.GetPrincipalType() == "" {
		t.Fatalf("expected core attribution fields set: %+v", event)
	}
	if event.GetTokenId() != "tok-001" {
		t.Fatalf("token_id mismatch: %s", event.GetTokenId())
	}
	if event.GetConsentId() != "consent-001" || event.GetConsentVersion() != "v1" {
		t.Fatalf("consent fields mismatch: id=%s version=%s", event.GetConsentId(), event.GetConsentVersion())
	}
	if event.GetPolicyVersion() != "policy-v1" {
		t.Fatalf("policy version mismatch: %s", event.GetPolicyVersion())
	}
	if event.GetScopeCatalogVersion() != "sdk-v1" {
		t.Fatalf("scope catalog version mismatch: %s", event.GetScopeCatalogVersion())
	}
	if event.GetExternalPrincipalType() != runtimev1.ExternalPrincipalType_EXTERNAL_PRINCIPAL_TYPE_AGENT.String() {
		t.Fatalf("external principal type mismatch: %s", event.GetExternalPrincipalType())
	}
	if event.GetResourceSelectorHash() == "" {
		t.Fatalf("resource selector hash must be set")
	}
}

type auditInterceptorTestStream struct {
	grpc.ServerStream
	ctx      context.Context
	requests []*runtimev1.StreamScenarioRequest
}

func (s *auditInterceptorTestStream) SetHeader(metadata.MD) error  { return nil }
func (s *auditInterceptorTestStream) SendHeader(metadata.MD) error { return nil }
func (s *auditInterceptorTestStream) SetTrailer(metadata.MD)       {}
func (s *auditInterceptorTestStream) Context() context.Context     { return s.ctx }
func (s *auditInterceptorTestStream) SendMsg(any) error            { return nil }

func (s *auditInterceptorTestStream) RecvMsg(m any) error {
	if len(s.requests) == 0 {
		return io.EOF
	}
	request := s.requests[0]
	s.requests = s.requests[1:]

	target, ok := m.(*runtimev1.StreamScenarioRequest)
	if !ok {
		return io.EOF
	}
	payload, err := proto.Marshal(request)
	if err != nil {
		return err
	}
	if err := proto.Unmarshal(payload, target); err != nil {
		return err
	}
	return nil
}

func TestAuditEventMandatoryFieldsCompleteness(t *testing.T) {
	// K-AUDIT-001: every audit event MUST have 6 mandatory fields:
	// trace_id, app_id, domain, operation, reason_code, timestamp.
	store := auditlog.New(128, 128)
	interceptor := newUnaryAuditInterceptor(store)

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-trace-id", "trace-mandatory-001",
	))
	req := scenarioExecuteTextRequest("nimi.desktop", "user-001", "local/qwen2.5")
	info := &grpc.UnaryServerInfo{
		FullMethod: "/nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
	}
	_, _ = interceptor(ctx, req, info, func(context.Context, any) (any, error) {
		return &runtimev1.ExecuteScenarioResponse{
			ModelResolved: "qwen2.5",
			Usage:         &runtimev1.UsageStats{InputTokens: 5, OutputTokens: 3},
		}, nil
	})

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{})
	if len(events.GetEvents()) == 0 {
		t.Fatal("expected at least one audit event")
	}
	event := events.GetEvents()[0]

	// Verify all 6 mandatory fields
	if strings.TrimSpace(event.GetTraceId()) == "" {
		t.Error("mandatory field trace_id is empty")
	}
	if strings.TrimSpace(event.GetAppId()) == "" {
		t.Error("mandatory field app_id is empty")
	}
	if strings.TrimSpace(event.GetDomain()) == "" {
		t.Error("mandatory field domain is empty")
	}
	if strings.TrimSpace(event.GetOperation()) == "" {
		t.Error("mandatory field operation is empty")
	}
	if event.GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Error("mandatory field reason_code is UNSPECIFIED")
	}
	if event.GetTimestamp() == nil {
		t.Error("mandatory field timestamp is nil")
	}
}

func TestAppendAuditEventFallsBackWhenPayloadCannotBeEncoded(t *testing.T) {
	store := auditlog.New(16, 16)

	appendAuditEvent(store, auditEventInput{
		AppID:      "nimi.desktop",
		Domain:     "runtime.ai",
		Operation:  "execute_scenario",
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceID:    "trace-payload-fallback",
		Payload: map[string]any{
			"bad": func() {},
		},
	})

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{Domain: "runtime.ai"})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 event, got=%d", len(events.GetEvents()))
	}
	payload := events.GetEvents()[0].GetPayload()
	if payload == nil {
		t.Fatal("expected fallback payload")
	}
	if payload.GetFields()["payload_encode_error"].GetStringValue() == "" {
		t.Fatalf("expected payload encode error field, got=%v", payload.GetFields())
	}
}

func scenarioExecuteTextRequest(appID string, subjectUserID string, modelID string) *runtimev1.ExecuteScenarioRequest {
	return &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         appID,
			SubjectUserId: subjectUserID,
			ModelId:       modelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello"},
					},
				},
			},
		},
	}
}

func scenarioStreamTextRequest(appID string, subjectUserID string, modelID string) *runtimev1.StreamScenarioRequest {
	return &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         appID,
			SubjectUserId: subjectUserID,
			ModelId:       modelID,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello"},
					},
				},
			},
		},
	}
}
