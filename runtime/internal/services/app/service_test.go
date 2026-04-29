package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func newTestService(opts ...Option) *Service {
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), opts...)
}

func appContext(appID string) context.Context {
	if appID == "" {
		return metadata.NewIncomingContext(context.Background(), metadata.Pairs())
	}
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

type testScopedBindingValidator struct {
	t            *testing.T
	wantID       string
	wantScope    string
	wantRelation *runtimev1.ScopedAppBindingRelation
	reason       runtimev1.AccountReasonCode
	ok           bool
	calls        int
}

func (v *testScopedBindingValidator) ValidateScopedBinding(bindingID string, actual *runtimev1.ScopedAppBindingRelation, requiredScope string) (runtimev1.AccountReasonCode, bool) {
	v.calls++
	if v.wantID != "" && bindingID != v.wantID {
		v.t.Fatalf("binding id: got=%q want=%q", bindingID, v.wantID)
	}
	if v.wantScope != "" && requiredScope != v.wantScope {
		v.t.Fatalf("required scope: got=%q want=%q", requiredScope, v.wantScope)
	}
	if v.wantRelation != nil {
		if actual.GetRuntimeAppId() != v.wantRelation.GetRuntimeAppId() ||
			actual.GetAvatarInstanceId() != v.wantRelation.GetAvatarInstanceId() ||
			actual.GetAgentId() != v.wantRelation.GetAgentId() ||
			actual.GetConversationAnchorId() != v.wantRelation.GetConversationAnchorId() ||
			actual.GetWorldId() != v.wantRelation.GetWorldId() {
			v.t.Fatalf("relation mismatch: got=%+v want=%+v", actual, v.wantRelation)
		}
	}
	if v.reason == runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_UNSPECIFIED {
		v.reason = runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED
	}
	return v.reason, v.ok
}

func TestSendAppMessageSuccess(t *testing.T) {
	svc := newTestService()
	resp, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "greeting",
	})
	if err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatal("message should be accepted")
	}
	if resp.GetMessageId() == "" {
		t.Fatal("message_id should be set")
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason code: got=%v", resp.GetReasonCode())
	}
}

func TestSendAppMessageMissingFields(t *testing.T) {
	svc := newTestService()
	tests := []struct {
		name string
		req  *runtimev1.SendAppMessageRequest
	}{
		{"missing from", &runtimev1.SendAppMessageRequest{ToAppId: "b"}},
		{"missing to", &runtimev1.SendAppMessageRequest{FromAppId: "a"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.SendAppMessage(context.Background(), tt.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("expected invalid argument, got %v", err)
			}
			if status.Convert(err).Message() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String() {
				t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
			}
		})
	}
}

func TestSendAppMessageOptionalFields(t *testing.T) {
	svc := newTestService()
	resp, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response: %+v", resp)
	}
}

func TestSendRuntimeAgentMessageRequiresScopedBinding(t *testing.T) {
	svc := newTestService(WithScopedBindingValidator(&testScopedBindingValidator{t: t, ok: true}))
	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:   "desktop.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument for missing binding, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestSendRuntimeAgentMessageAllowsValidatedProtectedCapabilityWithoutScopedBinding(t *testing.T) {
	validator := &testScopedBindingValidator{t: t, ok: false}
	svc := newTestService(WithScopedBindingValidator(validator))
	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "nimi.avatar", "runtime.agent.turn.write")
	resp, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:   "nimi.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
	})
	if err != nil {
		t.Fatalf("SendAppMessage with protected capability: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response: %#v", resp)
	}
	if validator.calls != 0 {
		t.Fatalf("scoped binding validator must not be called for protected capability, got %d", validator.calls)
	}
}

func TestSendRuntimeAgentSnapshotRequestIsNotAdmittedAppMessageIngress(t *testing.T) {
	validator := &testScopedBindingValidator{t: t, ok: false}
	svc := newTestService(WithScopedBindingValidator(validator))
	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "nimi.avatar", "runtime.agent.turn.write")
	_, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:   "nimi.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.session.snapshot.request",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for snapshot app-message ingress, got %v", err)
	}
	if validator.calls != 0 {
		t.Fatalf("scoped binding validator must not be called for non-admitted message, got %d", validator.calls)
	}
}

func TestSendRuntimeAgentMessageValidatesScopedBinding(t *testing.T) {
	validator := &testScopedBindingValidator{
		t:         t,
		wantID:    "binding-1",
		wantScope: "runtime.agent.turn.write",
		wantRelation: &runtimev1.ScopedAppBindingRelation{
			RuntimeAppId:         "desktop.avatar",
			AvatarInstanceId:     "avatar-instance-1",
			AgentId:              "agent-1",
			ConversationAnchorId: "anchor-1",
			WorldId:              "world-1",
		},
		ok: true,
	}
	svc := newTestService(WithScopedBindingValidator(validator))
	resp, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:   "desktop.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
		ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{
			BindingId:            "binding-1",
			RuntimeAppId:         "desktop.avatar",
			AvatarInstanceId:     "avatar-instance-1",
			AgentId:              "agent-1",
			ConversationAnchorId: "anchor-1",
			WorldId:              "world-1",
		},
	})
	if err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response: %#v", resp)
	}
	if validator.calls != 1 {
		t.Fatalf("expected validator called once, got %d", validator.calls)
	}
}

func TestSendRuntimeAgentMessageRejectsBindingMismatch(t *testing.T) {
	svc := newTestService(WithScopedBindingValidator(&testScopedBindingValidator{
		t:      t,
		reason: runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BINDING_REPLAY,
		ok:     false,
	}))
	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:   "desktop.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
		ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{
			BindingId: "binding-1",
			AgentId:   "wrong-agent",
		},
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestSendAppMessageRejectsOversizedPayload(t *testing.T) {
	svc := newTestService()
	payload := &structpb.Struct{Fields: map[string]*structpb.Value{
		"blob": structpb.NewStringValue(string(make([]byte, maxPayloadBytes+1))),
	}}
	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
		Payload:   payload,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
	if stReason := status.Convert(err).Message(); stReason != runtimev1.ReasonCode_APP_MESSAGE_PAYLOAD_TOO_LARGE.String() {
		t.Fatalf("unexpected reason message: %s", stReason)
	}
}

func TestSendAppMessageRateLimitEnforced(t *testing.T) {
	now := time.Date(2026, 3, 13, 1, 2, 3, 100_000_000, time.UTC)
	svc := newTestService(WithClock(func() time.Time { return now }))

	for i := 0; i < rateLimitPerSecond; i++ {
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId: "app-a",
			ToAppId:   "app-b",
		}); err != nil {
			t.Fatalf("request %d unexpectedly failed: %v", i, err)
		}
	}
	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected resource exhausted, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_MESSAGE_RATE_LIMITED.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}
}

func TestSendAppMessageLoopDetected(t *testing.T) {
	now := time.Date(2026, 3, 13, 1, 2, 3, 0, time.UTC)
	svc := newTestService(WithClock(func() time.Time { return now }))

	for i := 0; i < loopLimitPerSecond; i++ {
		from, to := "app-a", "app-b"
		if i%2 == 1 {
			from, to = to, from
		}
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId: from,
			ToAppId:   to,
		}); err != nil {
			t.Fatalf("message %d unexpectedly failed: %v", i, err)
		}
	}

	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_MESSAGE_LOOP_DETECTED.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}
}

func TestSendAppMessageRequiresRegisteredAppSession(t *testing.T) {
	authSvc := authservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc := newTestService(WithSessionValidator(authSvc))

	_, err := svc.SendAppMessage(metadata.NewIncomingContext(context.Background(), metadata.Pairs()), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for unregistered app, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_NOT_REGISTERED.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}

	registerResp, err := authSvc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
		AppId:    "app-a",
		DeviceId: "device-1",
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		},
	})
	if err != nil {
		t.Fatalf("RegisterApp: %v", err)
	}
	openResp, err := authSvc.OpenSession(context.Background(), &runtimev1.OpenSessionRequest{
		AppId:         "app-a",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "device-1",
		SubjectUserId: "user-1",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}

	missingSessionCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs())
	_, err = svc.SendAppMessage(missingSessionCtx, &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if status.Code(err) != codes.Unauthenticated || status.Convert(err).Message() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED.String() {
		t.Fatalf("expected principal unauthorized, got %v", err)
	}

	validCtx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-session-id", openResp.GetSessionId(),
		"x-nimi-session-token", openResp.GetSessionToken(),
	))
	if _, err := svc.SendAppMessage(validCtx, &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	}); err != nil {
		t.Fatalf("expected valid session accepted, got %v", err)
	}
}

func TestSubscribeAppMessagesFiltering(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
			AppId:         "app-b",
			SubjectUserId: "user-1",
		}, stream)
	}()

	time.Sleep(20 * time.Millisecond)

	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "greeting",
	}); err != nil {
		t.Fatalf("SendAppMessage match: %v", err)
	}
	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-2",
		MessageType:   "greeting",
	}); err != nil {
		t.Fatalf("SendAppMessage non-match: %v", err)
	}

	if !waitForAppEvents(stream, 1, 300*time.Millisecond) {
		t.Fatal("expected at least one matching event")
	}
	time.Sleep(50 * time.Millisecond)

	stream.mu.Lock()
	count := len(stream.events)
	stream.mu.Unlock()
	if count != 1 {
		t.Fatalf("expected exactly 1 event for user-1, got=%d", count)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("subscribe returned error: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("subscribe did not exit after cancel")
	}
}

func TestSubscribeAppMessagesFromAppFilter(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
			AppId:      "app-b",
			FromAppIds: []string{"app-x"},
		}, stream)
	}()

	time.Sleep(20 * time.Millisecond)

	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "msg",
	}); err != nil {
		t.Fatalf("SendAppMessage filtered non-match: %v", err)
	}
	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-x",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "msg",
	}); err != nil {
		t.Fatalf("SendAppMessage filtered match: %v", err)
	}

	if !waitForAppEvents(stream, 1, 300*time.Millisecond) {
		t.Fatal("expected at least one event from app-x")
	}

	cancel()
	<-done
}

func TestSubscribeRuntimeAgentMessagesRequiresScopedBinding(t *testing.T) {
	svc := newTestService(WithScopedBindingValidator(&testScopedBindingValidator{t: t, ok: true}))
	err := svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
		AppId:      "desktop.avatar",
		FromAppIds: []string{"runtime.agent"},
	}, &appMessageStreamCollector{ctx: appContext("desktop.avatar")})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument for missing binding, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestSubscribeRuntimeAgentMessagesAllowsValidatedProtectedCapabilityWithoutScopedBinding(t *testing.T) {
	validator := &testScopedBindingValidator{t: t, ok: false}
	svc := newTestService(WithScopedBindingValidator(validator))
	ctx, cancel := context.WithCancel(envelope.WithValidatedProtectedCapability(
		appContext("nimi.avatar"),
		"nimi.avatar",
		"runtime.agent.turn.read",
	))
	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
			AppId:      "nimi.avatar",
			FromAppIds: []string{"runtime.agent"},
		}, stream)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("SubscribeAppMessages returned unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SubscribeAppMessages did not stop after cancel")
	}
	if validator.calls != 0 {
		t.Fatalf("scoped binding validator must not be called for protected capability, got %d", validator.calls)
	}
}

func TestSubscribeRuntimeAgentMessagesValidatesScopedBinding(t *testing.T) {
	validator := &testScopedBindingValidator{
		t:         t,
		wantID:    "binding-1",
		wantScope: "runtime.agent.turn.read",
		wantRelation: &runtimev1.ScopedAppBindingRelation{
			RuntimeAppId:         "desktop.avatar",
			AvatarInstanceId:     "avatar-instance-1",
			AgentId:              "agent-1",
			ConversationAnchorId: "anchor-1",
			WorldId:              "world-1",
		},
		ok: true,
	}
	svc := newTestService(WithScopedBindingValidator(validator))
	ctx, cancel := context.WithCancel(appContext("desktop.avatar"))
	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
			AppId:      "desktop.avatar",
			FromAppIds: []string{"runtime.agent"},
			ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{
				BindingId:            "binding-1",
				RuntimeAppId:         "desktop.avatar",
				AvatarInstanceId:     "avatar-instance-1",
				AgentId:              "agent-1",
				ConversationAnchorId: "anchor-1",
				WorldId:              "world-1",
			},
		}, stream)
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("SubscribeAppMessages returned unexpected error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SubscribeAppMessages did not stop after cancel")
	}
	if validator.calls != 1 {
		t.Fatalf("expected validator called once, got %d", validator.calls)
	}
}

func TestSendAppMessageWithAck(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
			AppId: "app-b",
		}, stream)
	}()

	time.Sleep(20 * time.Millisecond)

	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "msg",
		RequireAck:    true,
	}); err != nil {
		t.Fatalf("SendAppMessage ack flow: %v", err)
	}

	if !waitForAppEvents(stream, 2, 300*time.Millisecond) {
		t.Fatal("expected RECEIVED and ACKED events")
	}

	stream.mu.Lock()
	first := stream.events[0]
	second := stream.events[1]
	stream.mu.Unlock()

	if first.GetEventType() != runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED {
		t.Fatalf("first event type: got=%v", first.GetEventType())
	}
	if second.GetEventType() != runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_ACKED {
		t.Fatalf("second event type: got=%v", second.GetEventType())
	}

	cancel()
	<-done
}

func TestSubscribeAppMessagesSlowConsumerClosed(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &blockingAppMessageStream{
		ctx:  ctx,
		gate: make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-b"}, stream)
	}()

	time.Sleep(20 * time.Millisecond)
	for i := 0; i < 64; i++ {
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId:   "app-a",
			ToAppId:     "app-b",
			MessageType: "msg",
		}); err != nil {
			t.Fatalf("SendAppMessage %d: %v", i, err)
		}
	}

	close(stream.gate)
	select {
	case err := <-done:
		if status.Code(err) != codes.ResourceExhausted {
			t.Fatalf("expected resource exhausted, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("subscribe did not close on slow consumer")
	}
}

func TestSequenceMonotonicallyIncreases(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-b"}, stream)
	}()

	time.Sleep(20 * time.Millisecond)

	for i := 0; i < 5; i++ {
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId:     "app-a",
			ToAppId:       "app-b",
			SubjectUserId: "user-1",
			MessageType:   "msg",
		}); err != nil {
			t.Fatalf("SendAppMessage monotonic %d: %v", i, err)
		}
	}

	if !waitForAppEvents(stream, 5, 500*time.Millisecond) {
		t.Fatal("expected 5 events")
	}

	stream.mu.Lock()
	for i := 1; i < len(stream.events); i++ {
		if stream.events[i].GetSequence() <= stream.events[i-1].GetSequence() {
			t.Fatalf("sequence not monotonic at index %d: %d <= %d", i, stream.events[i].GetSequence(), stream.events[i-1].GetSequence())
		}
	}
	stream.mu.Unlock()

	cancel()
	<-done
}

func TestSubscribeAppMessagesRequiresRegisteredAppSession(t *testing.T) {
	authSvc := authservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc := newTestService(WithSessionValidator(authSvc))

	stream := &appMessageStreamCollector{ctx: context.Background()}
	err := svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-a"}, stream)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for unregistered app, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_NOT_REGISTERED.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}

	registerResp, err := authSvc.RegisterApp(context.Background(), &runtimev1.RegisterAppRequest{
		AppId:    "app-a",
		DeviceId: "device-1",
		ModeManifest: &runtimev1.AppModeManifest{
			AppMode:         runtimev1.AppMode_APP_MODE_FULL,
			RuntimeRequired: true,
			RealmRequired:   true,
			WorldRelation:   runtimev1.WorldRelation_WORLD_RELATION_NONE,
		},
	})
	if err != nil {
		t.Fatalf("RegisterApp: %v", err)
	}
	openResp, err := authSvc.OpenSession(context.Background(), &runtimev1.OpenSessionRequest{
		AppId:         "app-a",
		AppInstanceId: registerResp.GetAppInstanceId(),
		DeviceId:      "device-1",
		SubjectUserId: "user-1",
		TtlSeconds:    600,
	})
	if err != nil {
		t.Fatalf("OpenSession: %v", err)
	}

	missingSessionStream := &appMessageStreamCollector{ctx: metadata.NewIncomingContext(context.Background(), metadata.Pairs())}
	err = svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-a"}, missingSessionStream)
	if status.Code(err) != codes.Unauthenticated || status.Convert(err).Message() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED.String() {
		t.Fatalf("expected principal unauthorized, got %v", err)
	}

	validCtx, cancel := context.WithCancel(metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-session-id", openResp.GetSessionId(),
		"x-nimi-session-token", openResp.GetSessionToken(),
	)))
	validStream := &appMessageStreamCollector{ctx: validCtx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-a"}, validStream)
	}()

	time.Sleep(20 * time.Millisecond)
	if _, err := svc.SendAppMessage(validCtx, &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-a",
	}); err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if !waitForAppEvents(validStream, 1, 300*time.Millisecond) {
		t.Fatalf("expected subscribed app to receive event")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("subscribe returned error: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("subscribe did not exit after cancel")
	}
}

func TestSendAppMessageRejectsContextAppMismatch(t *testing.T) {
	svc := newTestService()
	_, err := svc.SendAppMessage(appContext("app-b"), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}
}

func TestSendAppMessageDispatchesRegisteredInternalConsumer(t *testing.T) {
	svc := newTestService()
	var received *runtimev1.AppMessageEvent
	svc.RegisterInternalConsumer("runtime.agent.internal.chat_track_sidecar", func(_ context.Context, event *runtimev1.AppMessageEvent) error {
		received = event
		return nil
	})

	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "desktop.core",
		ToAppId:       "runtime.agent.internal.chat_track_sidecar",
		SubjectUserId: "user-1",
		MessageType:   "agent.chat_track.sidecar_input.v1",
		Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
			"agent_id": structpb.NewStringValue("agent-1"),
		}},
	})
	if err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if received == nil {
		t.Fatal("expected internal consumer to receive event")
	}
	if received.GetToAppId() != "runtime.agent.internal.chat_track_sidecar" || received.GetMessageType() != "agent.chat_track.sidecar_input.v1" {
		t.Fatalf("unexpected consumer event: %#v", received)
	}
	if !svc.HasInternalConsumer("runtime.agent.internal.chat_track_sidecar") {
		t.Fatal("expected registered internal consumer")
	}
}

func TestSendAppMessageWithoutInternalConsumerKeepsAcceptedBehavior(t *testing.T) {
	svc := newTestService()

	resp, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "desktop.core",
		ToAppId:   "runtime.unbound",
	})
	if err != nil {
		t.Fatalf("SendAppMessage: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response: %#v", resp)
	}
	if svc.HasInternalConsumer("runtime.unbound") {
		t.Fatal("expected runtime.unbound to remain unregistered")
	}
}

func TestSendAppMessageFailsClosedWhenInternalConsumerReturnsError(t *testing.T) {
	svc := newTestService()
	wantErr := status.Error(codes.InvalidArgument, "consumer rejected payload")
	svc.RegisterInternalConsumer("runtime.agent.internal.chat_track_sidecar", func(_ context.Context, _ *runtimev1.AppMessageEvent) error {
		return wantErr
	})

	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "desktop.core",
		ToAppId:   "runtime.agent.internal.chat_track_sidecar",
	})
	if !errors.Is(err, wantErr) && status.Convert(err).Message() != status.Convert(wantErr).Message() {
		t.Fatalf("expected consumer error, got %v", err)
	}
}

type appMessageStreamCollector struct {
	ctx    context.Context
	mu     sync.Mutex
	events []*runtimev1.AppMessageEvent
}

func (s *appMessageStreamCollector) Send(event *runtimev1.AppMessageEvent) error {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
	return nil
}

func (s *appMessageStreamCollector) SetHeader(metadata.MD) error  { return nil }
func (s *appMessageStreamCollector) SendHeader(metadata.MD) error { return nil }
func (s *appMessageStreamCollector) SetTrailer(metadata.MD)       {}
func (s *appMessageStreamCollector) Context() context.Context     { return s.ctx }
func (s *appMessageStreamCollector) SendMsg(any) error            { return nil }
func (s *appMessageStreamCollector) RecvMsg(any) error            { return nil }

type blockingAppMessageStream struct {
	ctx  context.Context
	gate chan struct{}
	once sync.Once
}

func (s *blockingAppMessageStream) Send(*runtimev1.AppMessageEvent) error {
	s.once.Do(func() {
		<-s.gate
	})
	return nil
}

func (s *blockingAppMessageStream) SetHeader(metadata.MD) error  { return nil }
func (s *blockingAppMessageStream) SendHeader(metadata.MD) error { return nil }
func (s *blockingAppMessageStream) SetTrailer(metadata.MD)       {}
func (s *blockingAppMessageStream) Context() context.Context     { return s.ctx }
func (s *blockingAppMessageStream) SendMsg(any) error            { return nil }
func (s *blockingAppMessageStream) RecvMsg(any) error            { return nil }

type headerTrackingAppMessageStream struct {
	ctx        context.Context
	headerSent chan struct{}
}

func (s *headerTrackingAppMessageStream) Send(*runtimev1.AppMessageEvent) error { return nil }
func (s *headerTrackingAppMessageStream) SetHeader(metadata.MD) error           { return nil }
func (s *headerTrackingAppMessageStream) SendHeader(metadata.MD) error {
	select {
	case s.headerSent <- struct{}{}:
	default:
	}
	return nil
}
func (s *headerTrackingAppMessageStream) SetTrailer(metadata.MD)   {}
func (s *headerTrackingAppMessageStream) Context() context.Context { return s.ctx }
func (s *headerTrackingAppMessageStream) SendMsg(any) error        { return nil }
func (s *headerTrackingAppMessageStream) RecvMsg(any) error        { return nil }

func waitForAppEvents(stream *appMessageStreamCollector, target int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		stream.mu.Lock()
		count := len(stream.events)
		stream.mu.Unlock()
		if count >= target {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return len(stream.events) >= target
}

func TestSubscribeAppMessagesSendsHeadersBeforeFirstEvent(t *testing.T) {
	svc := newTestService()
	ctx, cancel := context.WithCancel(appContext("app-a"))
	defer cancel()

	stream := &headerTrackingAppMessageStream{
		ctx:        ctx,
		headerSent: make(chan struct{}, 1),
	}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{AppId: "app-a"}, stream)
	}()

	select {
	case <-stream.headerSent:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected subscribe app messages to send headers before first event")
	}

	cancel()

	select {
	case err := <-done:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("SubscribeAppMessages returned unexpected error after cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("SubscribeAppMessages did not stop after context cancellation")
	}
}

func TestSendAppMessageTrustedInternalCallerBypassesSessionValidation(t *testing.T) {
	authSvc := authservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc := newTestService(WithSessionValidator(authSvc))

	ctx := WithTrustedInternalCaller(context.Background(), "runtime.agent")
	resp, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:     "runtime.agent",
		ToAppId:       "nimi.desktop",
		SubjectUserId: "user-1",
		MessageType:   "runtime.agent.turn.accepted",
	})
	if err != nil {
		t.Fatalf("SendAppMessage trusted internal caller: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response, got %#v", resp)
	}
}

func TestSendAppMessageTrustedInternalCallerRequiresMatchingAppID(t *testing.T) {
	authSvc := authservice.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc := newTestService(WithSessionValidator(authSvc))

	ctx := WithTrustedInternalCaller(context.Background(), "runtime.agent")
	_, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:     "runtime.agent.other",
		ToAppId:       "nimi.desktop",
		SubjectUserId: "user-1",
		MessageType:   "runtime.agent.turn.accepted",
	})
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("expected unauthenticated for mismatched trusted caller, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_APP_NOT_REGISTERED.String() {
		t.Fatalf("unexpected reason for mismatched trusted caller: %s", status.Convert(err).Message())
	}
}
