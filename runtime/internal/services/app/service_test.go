package app

import (
	"context"
	"io"
	"log/slog"
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

func TestSendRuntimeAgentMessageRequiresProtectedCapability(t *testing.T) {
	svc := newTestService()
	_, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:   "desktop.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
	})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied without protected capability, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestSendRuntimeAgentMessageAcceptsProtectedCapability(t *testing.T) {
	svc := newTestService()
	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "nimi.avatar", "runtime.agent.turn.write")
	resp, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:   "nimi.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.turn.request",
	})
	if err != nil {
		t.Fatalf("protected capability without binding should use first-party path: %v", err)
	}
	if !resp.GetAccepted() {
		t.Fatalf("expected accepted response: %+v", resp)
	}
}

func TestSendRuntimeAgentSnapshotRequestIsNotAdmittedAppMessageIngress(t *testing.T) {
	svc := newTestService()
	ctx := envelope.WithValidatedProtectedCapability(context.Background(), "nimi.avatar", "runtime.agent.turn.write")
	_, err := svc.SendAppMessage(ctx, &runtimev1.SendAppMessageRequest{
		FromAppId:   "nimi.avatar",
		ToAppId:     "runtime.agent",
		MessageType: "runtime.agent.session.snapshot.request",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for snapshot app-message ingress, got %v", err)
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

func TestSendAppMessageLoopDetectorAllowsHighCardinalityOneWayProjection(t *testing.T) {
	now := time.Date(2026, 3, 13, 1, 2, 3, 0, time.UTC)
	svc := newTestService(WithClock(func() time.Time { return now }))

	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId: "app-a",
		ToAppId:   "app-b",
	}); err != nil {
		t.Fatalf("request unexpectedly failed: %v", err)
	}
	for i := 0; i < loopLimitPerSecond+5; i++ {
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId: "app-b",
			ToAppId:   "app-a",
		}); err != nil {
			t.Fatalf("streaming projection %d unexpectedly failed: %v", i, err)
		}
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

func TestRuntimeAgentConversationBroadcastReachesAuthorizedCrossAppSubscribers(t *testing.T) {
	svc := newTestService()
	type activeSubscription struct {
		stream *appMessageStreamCollector
		cancel context.CancelFunc
		done   chan error
	}
	subscribe := func(appID string, subjectUserID string) activeSubscription {
		t.Helper()
		ctx := envelope.WithValidatedProtectedCapability(appContext(appID), appID, "runtime.agent.turn.read")
		ctx, cancel := context.WithCancel(ctx)
		stream := &appMessageStreamCollector{ctx: ctx}
		done := make(chan error, 1)
		go func() {
			done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
				AppId: appID, SubjectUserId: subjectUserID, FromAppIds: []string{"runtime.agent"},
			}, stream)
		}()
		return activeSubscription{stream: stream, cancel: cancel, done: done}
	}

	desktop := subscribe("nimi.desktop", "user-1")
	avatar := subscribe("nimi.avatar", "user-1")
	foreign := subscribe("foreign.app", "user-2")
	defer desktop.cancel()
	defer avatar.cancel()
	defer foreign.cancel()
	deadline := time.Now().Add(time.Second)
	for {
		svc.mu.RLock()
		ready := len(svc.subscribers) == 3
		svc.mu.RUnlock()
		if ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("conversation subscribers were not registered")
		}
		time.Sleep(time.Millisecond)
	}

	payload, err := structpb.NewStruct(map[string]any{
		"conversation_anchor_id": "anchor-shared", "turn_id": "turn-shared",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendAppMessage(WithTrustedInternalCaller(context.Background(), "runtime.agent"), &runtimev1.SendAppMessageRequest{
		FromAppId: "runtime.agent", ToAppId: "", SubjectUserId: "user-1",
		MessageType: "runtime.agent.turn.message_committed", Payload: payload,
	}); err != nil {
		t.Fatalf("SendAppMessage(conversation broadcast): %v", err)
	}
	if !waitForAppEvents(desktop.stream, 1, time.Second) || !waitForAppEvents(avatar.stream, 1, time.Second) {
		t.Fatal("shared conversation event did not reach both authorized app subscribers")
	}
	time.Sleep(20 * time.Millisecond)
	foreign.stream.mu.Lock()
	foreignCount := len(foreign.stream.events)
	foreign.stream.mu.Unlock()
	if foreignCount != 0 {
		t.Fatalf("foreign subject received %d conversation events", foreignCount)
	}
	for _, stream := range []*appMessageStreamCollector{desktop.stream, avatar.stream} {
		stream.mu.Lock()
		event := stream.events[0]
		stream.mu.Unlock()
		if event.GetToAppId() != "" || event.GetPayload().GetFields()["conversation_anchor_id"].GetStringValue() != "anchor-shared" {
			t.Fatalf("unexpected conversation broadcast envelope: %+v", event)
		}
	}
	if matches(subscriber{
		subjectUserID: "user-1", conversationAnchorID: "other-anchor",
		fromAppFilter: map[string]bool{"runtime.agent": true},
	}, desktop.stream.events[0]) {
		t.Fatal("subscriber authorized for a different anchor matched conversation broadcast")
	}

	for _, subscription := range []activeSubscription{desktop, avatar, foreign} {
		subscription.cancel()
		select {
		case err := <-subscription.done:
			if err != nil {
				t.Fatalf("subscription close: %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("subscription did not close")
		}
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

func TestSubscribeRuntimeAgentMessagesRequiresProtectedCapability(t *testing.T) {
	svc := newTestService()
	err := svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
		AppId:      "desktop.avatar",
		FromAppIds: []string{"runtime.agent"},
	}, &appMessageStreamCollector{ctx: appContext("desktop.avatar")})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("expected permission denied without protected capability, got %v", err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("unexpected reason: %v ok=%v err=%v", reason, ok, err)
	}
}

func TestSubscribeRuntimeAgentMessagesAcceptsProtectedCapability(t *testing.T) {
	svc := newTestService()
	ctx := envelope.WithValidatedProtectedCapability(
		appContext("nimi.avatar"),
		"nimi.avatar",
		"runtime.agent.turn.read",
	)
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	err := svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{
		AppId:      "nimi.avatar",
		FromAppIds: []string{"runtime.agent"},
	}, &appMessageStreamCollector{ctx: ctx})
	if err != nil {
		t.Fatalf("protected capability should use first-party subscribe path: %v", err)
	}
}
