package runtimeagent

import (
	"context"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestLocalAppConversationWireIsExactAndHasNoGenericMessageEnvelope(t *testing.T) {
	send := (&runtimev1.SendLocalAppConversationTurnRequest{}).ProtoReflect().Descriptor()
	if send.Fields().Len() != 4 {
		t.Fatalf("send field count = %d, want handle, anchor, request id, text", send.Fields().Len())
	}
	for _, forbidden := range []string{
		"agent_id", "local_agent_id", "attachments", "message_type", "payload", "context",
		"provider", "model", "credential", "subject_user_id",
	} {
		if send.Fields().ByName(protoreflectName(forbidden)) != nil {
			t.Fatalf("send wire exposes forbidden field %q", forbidden)
		}
	}
	event := (&runtimev1.LocalAppConversationEvent{}).ProtoReflect().Descriptor()
	if event.Fields().Len() != 9 || event.Oneofs().Len() != 1 {
		t.Fatalf("event descriptor fields=%d oneofs=%d", event.Fields().Len(), event.Oneofs().Len())
	}
	for _, forbidden := range []string{
		"message_type", "payload", "agent_id", "local_agent_id", "trace_id", "credential", "private_context",
	} {
		if event.Fields().ByName(protoreflectName(forbidden)) != nil {
			t.Fatalf("event wire exposes forbidden field %q", forbidden)
		}
	}
	snapshot := (&runtimev1.LocalAppConversationSnapshot{}).ProtoReflect().Descriptor()
	if snapshot.Fields().Len() != 4 {
		t.Fatalf("snapshot field count = %d", snapshot.Fields().Len())
	}
}

func TestLocalAppConversationHandleRevalidatesSessionAccountAndLifecycle(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	decision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x21, "user-1")
	handle := mintLocalAppAgentHandle(decision, testRuntimeAgentLocalRef("agent-alpha"))
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision)
	opened, err := svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if err != nil || opened.GetConversationAnchorId() == "" {
		t.Fatalf("OpenLocalAppConversation: response=%+v err=%v", opened, err)
	}

	for name, changed := range map[string]accountservice.LocalAppCallerDecision{
		"session":   localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x31, "user-1"),
		"account":   localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x21, "user-2"),
		"operation": localAppConversationDecision(accountservice.LocalAppOperationConversationSnapshot, 0x21, "user-1"),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.OpenLocalAppConversation(
				accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), changed),
				&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
			)
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("stale handle error = %v", err)
			}
		})
	}

	svc.mu.Lock()
	localAgentID := testRuntimeAgentLocalRef("agent-alpha")
	entry := svc.agents[localAgentID]
	original := entry.Agent.GetLifecycleStatus()
	entry.Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
	svc.mu.Unlock()
	_, err = svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("inactive Agent error = %v", err)
	}
	svc.mu.Lock()
	entry.Agent.LifecycleStatus = original
	delete(svc.agents, localAgentID)
	svc.mu.Unlock()
	_, err = svc.OpenLocalAppConversation(ctx, &runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("deleted Agent error = %v", err)
	}
	svc.mu.Lock()
	svc.agents[localAgentID] = entry
	svc.mu.Unlock()
}

func TestLocalAppReferenceToConversationJourneyUsesTheOwnerEngine(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	capture := newPublicChatEmitCapture()
	svc.SetPublicChatAppEmitter(capture.emit)
	svc.SetChatTrackSidecarExecutor(stubChatTrackSidecarExecutor{})
	svc.SetPublicChatTurnExecutor(stubPublicChatTurnExecutor{
		stream: func(_ context.Context, _ *PublicChatTurnExecutionRequest, emit func(*runtimev1.StreamScenarioEvent) error) error {
			for _, event := range []*runtimev1.StreamScenarioEvent{
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
						ModelResolved: "qwen3-chat", RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					}},
				},
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{
							Text: publicChatStructuredEnvelopeAPML("message-local-app", "hello from Runtime"),
						}},
					}},
				},
				{
					EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
					TraceId:   "trace-local-app",
					Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					}},
				},
			} {
				if err := emit(event); err != nil {
					return err
				}
			}
			return nil
		},
	})

	referenceDecision := localAppConversationDecision(accountservice.LocalAppOperationReferenceList, 0x39, "user-1")
	references, err := svc.ListLocalAppAgentReferences(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), referenceDecision),
		&runtimev1.ListLocalAppAgentReferencesRequest{},
	)
	if err != nil || len(references.GetReferences()) != 1 {
		t.Fatalf("reference list = %+v err=%v", references, err)
	}
	handle := references.GetReferences()[0].GetAgentHandle()

	openDecision := referenceDecision
	openDecision.Operation = accountservice.LocalAppOperationOpenConversation
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()

	subscribeDecision := referenceDecision
	subscribeDecision.Operation = accountservice.LocalAppOperationSubscribeConversation
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, subscribeDecision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), subscribeDecision),
		5,
	)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- svc.SubscribeLocalAppConversationEvents(
			&runtimev1.SubscribeLocalAppConversationEventsRequest{
				AgentHandle: handle, ConversationAnchorId: anchorID,
			},
			stream,
		)
	}()
	waitForLocalAppConversationSubscriber(t, svc)

	sendDecision := referenceDecision
	sendDecision.Operation = accountservice.LocalAppOperationSendConversationTurn
	sent, err := svc.SendLocalAppConversationTurn(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), sendDecision),
		&runtimev1.SendLocalAppConversationTurnRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
			RequestId: "request-local-app", Text: "hello",
		},
	)
	if err != nil || sent.GetTurnId() == "" {
		t.Fatalf("send = %+v err=%v", sent, err)
	}
	select {
	case err := <-streamDone:
		if err != nil {
			t.Fatalf("conversation stream: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("conversation stream did not reach terminal event")
	}
	if len(stream.events) != 5 || stream.events[4].GetTurnCompleted() == nil {
		t.Fatalf("typed conversation events = %+v", stream.events)
	}
	for _, event := range stream.events {
		if event.GetConversationAnchorId() != anchorID {
			t.Fatalf("event escaped anchor scope: %+v", event)
		}
	}

	snapshotDecision := referenceDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{AgentHandle: handle, ConversationAnchorId: anchorID},
	)
	if err != nil || len(snapshot.GetSnapshot().GetMessages()) != 2 ||
		snapshot.GetSnapshot().GetMessages()[1].GetText() != "hello from Runtime" {
		t.Fatalf("journey snapshot = %+v err=%v", snapshot, err)
	}
}

func TestLocalAppConversationSnapshotIsBoundedOwnerProjection(t *testing.T) {
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x41, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	anchorID := opened.GetConversationAnchorId()
	svc.chatSurfaceMu.Lock()
	svc.chatAnchors[anchorID].CommittedTranscript = testPublicChatCommittedTranscript(
		[2]string{"hello", "hi"},
		[2]string{"status", "ready"},
	)
	svc.chatSurfaceMu.Unlock()

	snapshotDecision := openDecision
	snapshotDecision.Operation = accountservice.LocalAppOperationConversationSnapshot
	snapshot, err := svc.GetLocalAppConversationSnapshot(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), snapshotDecision),
		&runtimev1.GetLocalAppConversationSnapshotRequest{
			AgentHandle: handle, ConversationAnchorId: anchorID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	projected := snapshot.GetSnapshot()
	if projected.GetConversationAnchorId() != anchorID || projected.GetTruncatedBefore() || len(projected.GetMessages()) != 4 {
		t.Fatalf("snapshot = %+v", projected)
	}
	for _, message := range projected.GetMessages() {
		if message.GetTurnId() == "" || message.GetText() == "" ||
			(message.GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_USER &&
				message.GetRole() != runtimev1.LocalAppConversationMessageRole_LOCAL_APP_CONVERSATION_MESSAGE_ROLE_ASSISTANT) {
			t.Fatalf("message = %+v", message)
		}
	}
}

func TestLocalAppConversationEventProjectionIsClosedTypedUnion(t *testing.T) {
	base := map[string]any{
		"conversation_anchor_id": "agent_anchor_01J",
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(3)},
	}
	tests := []struct {
		name        string
		messageType string
		detail      map[string]any
		assert      func(*testing.T, *runtimev1.LocalAppConversationEvent)
	}{
		{
			name: "accepted", messageType: publicChatTurnAcceptedType,
			detail: map[string]any{"request_id": "request-1"},
			assert: func(t *testing.T, event *runtimev1.LocalAppConversationEvent) {
				if event.GetTurnAccepted().GetRequestId() != "request-1" {
					t.Fatalf("accepted = %+v", event)
				}
			},
		},
		{
			name: "delta", messageType: publicChatTurnTextDeltaType,
			detail: map[string]any{"text": "hello"},
			assert: func(t *testing.T, event *runtimev1.LocalAppConversationEvent) {
				if event.GetTextDelta().GetText() != "hello" {
					t.Fatalf("delta = %+v", event)
				}
			},
		},
		{
			name: "failed", messageType: publicChatTurnFailedType,
			detail: map[string]any{"reason_code": "AI_OUTPUT_INVALID", "message": "invalid output"},
			assert: func(t *testing.T, event *runtimev1.LocalAppConversationEvent) {
				if event.GetTurnFailed().GetReasonCode() != "AI_OUTPUT_INVALID" {
					t.Fatalf("failed = %+v", event)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := map[string]any{}
			for key, value := range base {
				payload[key] = value
			}
			payload["detail"] = test.detail
			event, supported, err := projectLocalAppConversationEvent(test.messageType, payload)
			if err != nil || !supported || event.GetSequence() != 3 {
				t.Fatalf("projection event=%+v supported=%v err=%v", event, supported, err)
			}
			test.assert(t, event)
		})
	}
	if event, supported, err := projectLocalAppConversationEvent(publicChatTurnReasoningDeltaType, base); err != nil || supported || event != nil {
		t.Fatalf("reasoning event escaped union: event=%+v supported=%v err=%v", event, supported, err)
	}
	malformed := map[string]any{}
	for key, value := range base {
		malformed[key] = value
	}
	malformed["detail"] = map[string]any{"payload": map[string]any{"private": true}}
	if _, supported, err := projectLocalAppConversationEvent(publicChatTurnTextDeltaType, malformed); !supported || err == nil {
		t.Fatalf("generic payload was not rejected: supported=%v err=%v", supported, err)
	}
}

func TestLocalAppConversationStreamDeliversTypedEventAndClosesOnCancel(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, ingress localappop.Ingress) (context.Context, error) {
		if ingress != localappop.IngressConversationEventsSubscribe {
			return nil, status.Error(codes.PermissionDenied, "wrong ingress")
		}
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		1,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{"text": "hello"},
	})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stream returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not close after consumer cancellation")
	}
	if len(stream.events) != 1 || stream.events[0].GetTextDelta().GetText() != "hello" {
		t.Fatalf("stream events = %+v", stream.events)
	}
}

func TestLocalAppConversationStreamSendsHeaderOnEstablishmentBeforeEvents(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		1,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	headerDeadline := time.Now().Add(2 * time.Second)
	for !stream.headerObserved() {
		if time.Now().After(headerDeadline) {
			t.Fatal("subscription established without sending response headers; an idle conversation would block the streaming client indefinitely")
		}
		time.Sleep(5 * time.Millisecond)
	}
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{"text": "hello"},
	})
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("stream returned %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("stream did not close after consumer cancellation")
	}
	if stream.eventBeforeHeader {
		t.Fatal("an event was sent before response headers")
	}
}

func TestLocalAppConversationStreamAdmissionRejectionSendsNoHeader(t *testing.T) {
	svc, req, decision, _ := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	// A stream context without an authorized local-App decision fails admission
	// before subscriber registration.
	stream := newLocalAppConversationCaptureStream(context.Background(), 0)
	err := runLocalAppConversationStreamWithTimeout(t, svc, req, stream)
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("pre-admission rejection error = %v", err)
	}
	if stream.headerObserved() {
		t.Fatal("rejected subscription must not send response headers")
	}
}

func TestLocalAppConversationStreamTerminatesOnAccountAndAgentInvalidation(t *testing.T) {
	t.Run("account change", func(t *testing.T) {
		svc, req, decision, _ := localAppConversationStreamFixture(t)
		changed := decision
		changed.AccountID = "user-2"
		svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
			return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, changed), nil
		}))
		stream := newLocalAppConversationCaptureStream(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			0,
		)
		err := runLocalAppConversationStreamWithTimeout(t, svc, req, stream)
		if status.Code(err) != codes.PermissionDenied {
			t.Fatalf("account invalidation error = %v", err)
		}
	})

	t.Run("inactive Agent", func(t *testing.T) {
		svc, req, decision, _ := localAppConversationStreamFixture(t)
		svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
			return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
		}))
		stream := newLocalAppConversationCaptureStream(
			accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
			0,
		)
		done := make(chan error, 1)
		go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
		waitForLocalAppConversationSubscriber(t, svc)
		svc.mu.Lock()
		svc.agents[testRuntimeAgentLocalRef("agent-alpha")].Agent.LifecycleStatus = runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED
		svc.mu.Unlock()
		select {
		case err := <-done:
			if status.Code(err) != codes.PermissionDenied {
				t.Fatalf("inactive Agent stream error = %v", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("stream survived inactive Agent")
		}
	})
}

func TestLocalAppConversationStreamSurfacesBoundedOwnerTerminalError(t *testing.T) {
	svc, req, decision, anchorID := localAppConversationStreamFixture(t)
	svc.SetLocalAppIngressRevalidator(localAppIngressRevalidatorFunc(func(ctx context.Context, _ localappop.Ingress) (context.Context, error) {
		return accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision), nil
	}))
	stream := newLocalAppConversationCaptureStream(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision),
		0,
	)
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	waitForLocalAppConversationSubscriber(t, svc)
	svc.publishLocalAppConversationEvent("user-1", publicChatTurnTextDeltaType, map[string]any{
		"conversation_anchor_id": anchorID,
		"turn_id":                "agent_turn_01J",
		"timeline":               map[string]any{"sequence": int64(1)},
		"detail":                 map[string]any{"payload": "forbidden"},
	})
	select {
	case err := <-done:
		if status.Code(err) != codes.Unavailable {
			t.Fatalf("terminal owner error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("malformed owner event did not terminate stream")
	}
}

func localAppConversationStreamFixture(
	t *testing.T,
) (*Service, *runtimev1.SubscribeLocalAppConversationEventsRequest, accountservice.LocalAppCallerDecision, string) {
	t.Helper()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	openDecision := localAppConversationDecision(accountservice.LocalAppOperationOpenConversation, 0x51, "user-1")
	handle := mintLocalAppAgentHandle(openDecision, testRuntimeAgentLocalRef("agent-alpha"))
	opened, err := svc.OpenLocalAppConversation(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), openDecision),
		&runtimev1.OpenLocalAppConversationRequest{AgentHandle: handle},
	)
	if err != nil {
		t.Fatal(err)
	}
	decision := openDecision
	decision.Operation = accountservice.LocalAppOperationSubscribeConversation
	return svc, &runtimev1.SubscribeLocalAppConversationEventsRequest{
		AgentHandle: handle, ConversationAnchorId: opened.GetConversationAnchorId(),
	}, decision, opened.GetConversationAnchorId()
}

func localAppConversationDecision(
	operation accountservice.LocalAppOperation,
	seed byte,
	accountID string,
) accountservice.LocalAppCallerDecision {
	decision := accountservice.LocalAppCallerDecision{
		AppID:                "nimi.thirdparty.fixture",
		AccountID:            accountID,
		Operation:            operation,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  "agent.local",
		RegisteredAppSubject: "registered-app-subject",
	}
	for index := range decision.SessionID {
		decision.SessionID[index] = seed + byte(index)
	}
	return decision
}

type localAppIngressRevalidatorFunc func(context.Context, localappop.Ingress) (context.Context, error)

func (function localAppIngressRevalidatorFunc) AuthorizeLocalAppIngress(
	ctx context.Context,
	ingress localappop.Ingress,
) (context.Context, error) {
	return function(ctx, ingress)
}

type localAppConversationCaptureStream struct {
	ctx               context.Context
	cancel            context.CancelFunc
	max               int
	mu                sync.Mutex
	events            []*runtimev1.LocalAppConversationEvent
	headerSent        bool
	eventBeforeHeader bool
}

func newLocalAppConversationCaptureStream(parent context.Context, max int) *localAppConversationCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &localAppConversationCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (stream *localAppConversationCaptureStream) SetHeader(metadata.MD) error { return nil }
func (stream *localAppConversationCaptureStream) SendHeader(metadata.MD) error {
	stream.mu.Lock()
	stream.headerSent = true
	stream.mu.Unlock()
	return nil
}

func (stream *localAppConversationCaptureStream) headerObserved() bool {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.headerSent
}
func (stream *localAppConversationCaptureStream) SetTrailer(metadata.MD)   {}
func (stream *localAppConversationCaptureStream) Context() context.Context { return stream.ctx }
func (stream *localAppConversationCaptureStream) SendMsg(any) error        { return nil }
func (stream *localAppConversationCaptureStream) RecvMsg(any) error        { return nil }
func (stream *localAppConversationCaptureStream) Send(event *runtimev1.LocalAppConversationEvent) error {
	stream.mu.Lock()
	if !stream.headerSent {
		stream.eventBeforeHeader = true
	}
	stream.events = append(stream.events, proto.Clone(event).(*runtimev1.LocalAppConversationEvent))
	shouldCancel := stream.max > 0 && len(stream.events) >= stream.max
	stream.mu.Unlock()
	if shouldCancel {
		stream.cancel()
	}
	return nil
}

func waitForLocalAppConversationSubscriber(t *testing.T, svc *Service) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		svc.localAppConversationMu.Lock()
		count := len(svc.localAppConversationSubscribers)
		svc.localAppConversationMu.Unlock()
		if count > 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("local-app conversation subscriber was not registered")
}

func runLocalAppConversationStreamWithTimeout(
	t *testing.T,
	svc *Service,
	req *runtimev1.SubscribeLocalAppConversationEventsRequest,
	stream *localAppConversationCaptureStream,
) error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- svc.SubscribeLocalAppConversationEvents(req, stream) }()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		stream.cancel()
		t.Fatal("local-app conversation stream did not terminate")
		return nil
	}
}

func protoreflectName(value string) protoreflect.Name {
	return protoreflect.Name(value)
}
