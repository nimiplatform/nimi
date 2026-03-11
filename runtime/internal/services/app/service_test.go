package app

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func newTestService() *Service {
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)))
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
		{"missing from", &runtimev1.SendAppMessageRequest{ToAppId: "b", SubjectUserId: "u", MessageType: "t"}},
		{"missing to", &runtimev1.SendAppMessageRequest{FromAppId: "a", SubjectUserId: "u", MessageType: "t"}},
		{"missing user", &runtimev1.SendAppMessageRequest{FromAppId: "a", ToAppId: "b", MessageType: "t"}},
		{"missing type", &runtimev1.SendAppMessageRequest{FromAppId: "a", ToAppId: "b", SubjectUserId: "u"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp, err := svc.SendAppMessage(context.Background(), tt.req)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if resp.GetAccepted() {
				t.Fatal("should not be accepted")
			}
			if resp.GetReasonCode() != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID {
				t.Fatalf("reason code: got=%v", resp.GetReasonCode())
			}
		})
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

	// Allow subscriber registration.
	time.Sleep(20 * time.Millisecond)

	// This message should match.
	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "greeting",
	}); err != nil {
		t.Fatalf("SendAppMessage match: %v", err)
	}
	// This message should NOT match (different user).
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
	case <-done:
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

	// From app-a — should not match filter.
	if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
		FromAppId:     "app-a",
		ToAppId:       "app-b",
		SubjectUserId: "user-1",
		MessageType:   "msg",
	}); err != nil {
		t.Fatalf("SendAppMessage filtered non-match: %v", err)
	}
	// From app-x — should match filter.
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
	time.Sleep(50 * time.Millisecond)

	stream.mu.Lock()
	count := len(stream.events)
	stream.mu.Unlock()
	if count != 1 {
		t.Fatalf("expected exactly 1 event from app-x, got=%d", count)
	}

	cancel()
	<-done
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

	// Should receive both RECEIVED and ACKED events.
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
}

func TestSlowConsumerDropsOldest(t *testing.T) {
	svc := newTestService()

	// Manually add a subscriber with a small buffer to simulate slow consumer.
	svc.mu.Lock()
	svc.nextSubID++
	sub := subscriber{
		id:    svc.nextSubID,
		appID: "app-slow",
		ch:    make(chan *runtimev1.AppMessageEvent, 1),
	}
	svc.subscribers[sub.id] = sub
	svc.mu.Unlock()

	// Send many messages to overflow.
	for i := 0; i < 10; i++ {
		if _, err := svc.SendAppMessage(context.Background(), &runtimev1.SendAppMessageRequest{
			FromAppId:     "app-sender",
			ToAppId:       "app-slow",
			SubjectUserId: "user-1",
			MessageType:   "msg",
		}); err != nil {
			t.Fatalf("SendAppMessage slow consumer %d: %v", i, err)
		}
	}

	// Drain whatever is in the channel.
	var last *runtimev1.AppMessageEvent
	for {
		select {
		case event := <-sub.ch:
			last = event
		default:
			goto done
		}
	}
done:
	if last == nil {
		t.Fatal("should have received at least one event")
	}
	// Last event should have the highest sequence.
	if last.GetSequence() == 0 {
		t.Fatal("last event sequence should be non-zero")
	}
}

func TestSequenceMonotonicallyIncreases(t *testing.T) {
	svc := newTestService()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream := &appMessageStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAppMessages(&runtimev1.SubscribeAppMessagesRequest{}, stream)
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

// --- test helpers ---

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
