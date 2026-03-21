package ai

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestUploadArtifactStoresArtifact(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{
		ctx: context.Background(),
		reqs: []*runtimev1.UploadArtifactRequest{
			{
				Payload: &runtimev1.UploadArtifactRequest_Metadata{
					Metadata: &runtimev1.UploadArtifactMetadata{
						AppId:         "nimi.desktop",
						SubjectUserId: "user-001",
						MimeType:      "audio/wav",
						DisplayName:   "prompt.wav",
					},
				},
			},
			{
				Payload: &runtimev1.UploadArtifactRequest_Chunk{
					Chunk: &runtimev1.UploadArtifactChunk{
						Sequence: 0,
						Bytes:    []byte("wave-bytes"),
					},
				},
			},
		},
	}

	if err := svc.UploadArtifact(stream); err != nil {
		t.Fatalf("upload artifact: %v", err)
	}
	if stream.resp == nil || stream.resp.GetArtifact() == nil {
		t.Fatal("expected upload response artifact")
	}
	artifact := stream.resp.GetArtifact()
	if artifact.GetArtifactId() == "" {
		t.Fatal("expected artifact id")
	}
	if string(artifact.GetBytes()) != "wave-bytes" {
		t.Fatalf("unexpected artifact bytes: %q", string(artifact.GetBytes()))
	}
	stored, _, ok := svc.scenarioJobs.findArtifact("nimi.desktop", "user-001", artifact.GetArtifactId())
	if !ok || stored == nil {
		t.Fatal("expected uploaded artifact to be discoverable")
	}
	if string(stored.GetBytes()) != "wave-bytes" {
		t.Fatalf("unexpected stored bytes: %q", string(stored.GetBytes()))
	}
}

func TestUploadArtifactRejectsInvalidMime(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{
		ctx: context.Background(),
		reqs: []*runtimev1.UploadArtifactRequest{
			{
				Payload: &runtimev1.UploadArtifactRequest_Metadata{
					Metadata: &runtimev1.UploadArtifactMetadata{
						AppId:         "nimi.desktop",
						SubjectUserId: "user-001",
						MimeType:      "text/plain",
					},
				},
			},
			{
				Payload: &runtimev1.UploadArtifactRequest_Chunk{
					Chunk: &runtimev1.UploadArtifactChunk{
						Sequence: 0,
						Bytes:    []byte("bad"),
					},
				},
			},
		},
	}

	err := svc.UploadArtifact(stream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), codes.InvalidArgument, err)
	}
}

func TestUploadArtifactStoresNormalizedMimeType(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockUploadArtifactStream{
		ctx: context.Background(),
		reqs: []*runtimev1.UploadArtifactRequest{
			{
				Payload: &runtimev1.UploadArtifactRequest_Metadata{
					Metadata: &runtimev1.UploadArtifactMetadata{
						AppId:         "nimi.desktop",
						SubjectUserId: "user-001",
						MimeType:      "Audio/WAV",
					},
				},
			},
			{
				Payload: &runtimev1.UploadArtifactRequest_Chunk{
					Chunk: &runtimev1.UploadArtifactChunk{
						Sequence: 0,
						Bytes:    []byte("wave-bytes"),
					},
				},
			},
		},
	}

	if err := svc.UploadArtifact(stream); err != nil {
		t.Fatalf("upload artifact: %v", err)
	}
	if stream.resp == nil || stream.resp.GetArtifact() == nil {
		t.Fatal("expected upload response artifact")
	}
	if got := stream.resp.GetArtifact().GetMimeType(); got != "audio/wav" {
		t.Fatalf("unexpected normalized mime type: %q", got)
	}
}

func TestRealtimeSessionLifecycle(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger, Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: "http://127.0.0.1:18080"},
		},
	})

	fakeConn := newFakeRealtimeConn()
	restore := swapRealtimeDialer(func(context.Context, *nimillm.Backend, string) (realtimeConn, error) {
		return fakeConn, nil
	})
	defer restore()

	openResp, err := svc.OpenRealtimeSession(context.Background(), &runtimev1.OpenRealtimeSessionRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/realtime-model",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		SystemPrompt: "speak tersely",
	})
	if err != nil {
		t.Fatalf("open realtime session: %v", err)
	}
	if openResp.GetSessionId() == "" {
		t.Fatal("expected session id")
	}
	if got := fakeConn.sentTypes(); len(got) == 0 || got[0] != "session.update" {
		t.Fatalf("expected session.update envelope, got=%v", got)
	}

	appendResp, err := svc.AppendRealtimeInput(context.Background(), &runtimev1.AppendRealtimeInputRequest{
		SessionId: openResp.GetSessionId(),
		Items: []*runtimev1.RealtimeInputItem{
			{
				Item: &runtimev1.RealtimeInputItem_Message{
					Message: &runtimev1.ChatMessage{
						Role: "user",
						Parts: []*runtimev1.ChatContentPart{
							{
								Type: runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT,
								Text: "hello realtime",
							},
						},
					},
				},
			},
			{
				Item: &runtimev1.RealtimeInputItem_Audio{
					Audio: &runtimev1.RealtimeAudioInput{
						Source:    &runtimev1.RealtimeAudioInput_AudioBytes{AudioBytes: []byte("pcm")},
						EndOfTurn: true,
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("append realtime input: %v", err)
	}
	if appendResp.GetAck() == nil || !appendResp.GetAck().GetOk() {
		t.Fatal("expected append ack")
	}

	gotTypes := fakeConn.sentTypes()
	wantTypes := []string{
		"session.update",
		"conversation.item.create",
		"input_audio_buffer.append",
		"input_audio_buffer.commit",
		"response.create",
	}
	for i, want := range wantTypes {
		if i >= len(gotTypes) || gotTypes[i] != want {
			t.Fatalf("unexpected envelope sequence: got=%v want-prefix=%v", gotTypes, wantTypes)
		}
	}

	fakeConn.pushReceive(map[string]any{"type": "response.output_text.delta", "delta": "hello"})
	fakeConn.pushReceive(map[string]any{
		"type":  "response.output_audio.delta",
		"delta": base64.StdEncoding.EncodeToString([]byte("audio")),
	})
	fakeConn.pushReceive(map[string]any{"type": "response.done"})

	waitForRealtimeEvents(t, svc, openResp.GetSessionId(), 4)

	readCtx, cancelRead := context.WithCancel(context.Background())
	stream := &mockRealtimeEventStream{
		ctx: readCtx,
		onSend: func(event *runtimev1.RealtimeEvent) {
			if event.GetEventType() == runtimev1.RealtimeEventType_REALTIME_EVENT_COMPLETED {
				cancelRead()
			}
		},
	}
	readErr := svc.ReadRealtimeEvents(&runtimev1.ReadRealtimeEventsRequest{
		SessionId: openResp.GetSessionId(),
	}, stream)
	if readErr != nil && readCtx.Err() == nil {
		t.Fatalf("read realtime events: %v", readErr)
	}
	if len(stream.events) < 4 {
		t.Fatalf("expected backlog of realtime events, got=%d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.RealtimeEventType_REALTIME_EVENT_OPENED {
		t.Fatalf("expected opened event first, got=%v", stream.events[0].GetEventType())
	}

	if _, err := svc.CloseRealtimeSession(context.Background(), &runtimev1.CloseRealtimeSessionRequest{
		SessionId: openResp.GetSessionId(),
	}); err != nil {
		t.Fatalf("close realtime session: %v", err)
	}
	if !fakeConn.isClosed() {
		t.Fatal("expected upstream realtime connection to be closed")
	}
}

func TestReadRealtimeEventsRejectsSecondReader(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	record := svc.realtimeSessions.create(&realtimeSessionRecord{
		sessionID: "rt_conflict",
		traceID:   "trace-1",
		events:    []*runtimev1.RealtimeEvent{},
	})
	if record == nil {
		t.Fatal("expected session record")
	}
	backlog, ch, _, conflict := svc.realtimeSessions.claimReader("rt_conflict", 0)
	if conflict || ch == nil || len(backlog) != 0 {
		t.Fatalf("unexpected first reader claim result: backlog=%d ch=%v conflict=%v", len(backlog), ch != nil, conflict)
	}
	defer svc.realtimeSessions.releaseReader("rt_conflict")

	err := svc.ReadRealtimeEvents(&runtimev1.ReadRealtimeEventsRequest{SessionId: "rt_conflict"}, &mockRealtimeEventStream{ctx: context.Background()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), codes.FailedPrecondition, err)
	}
}

type mockUploadArtifactStream struct {
	ctx   context.Context
	reqs  []*runtimev1.UploadArtifactRequest
	resp  *runtimev1.UploadArtifactResponse
	index int
}

func (m *mockUploadArtifactStream) Recv() (*runtimev1.UploadArtifactRequest, error) {
	if m.index >= len(m.reqs) {
		return nil, io.EOF
	}
	req := m.reqs[m.index]
	m.index++
	return req, nil
}

func (m *mockUploadArtifactStream) SendAndClose(resp *runtimev1.UploadArtifactResponse) error {
	m.resp = resp
	return nil
}

func (m *mockUploadArtifactStream) Context() context.Context {
	return m.ctx
}

func (m *mockUploadArtifactStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockUploadArtifactStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockUploadArtifactStream) SetTrailer(_ metadata.MD)       {}
func (m *mockUploadArtifactStream) SendMsg(any) error              { return nil }
func (m *mockUploadArtifactStream) RecvMsg(any) error              { return nil }

type mockRealtimeEventStream struct {
	ctx    context.Context
	events []*runtimev1.RealtimeEvent
	onSend func(*runtimev1.RealtimeEvent)
}

func (m *mockRealtimeEventStream) Send(event *runtimev1.RealtimeEvent) error {
	m.events = append(m.events, event)
	if m.onSend != nil {
		m.onSend(event)
	}
	return nil
}

func (m *mockRealtimeEventStream) Context() context.Context {
	return m.ctx
}

func (m *mockRealtimeEventStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockRealtimeEventStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockRealtimeEventStream) SetTrailer(_ metadata.MD)       {}
func (m *mockRealtimeEventStream) SendMsg(any) error              { return nil }
func (m *mockRealtimeEventStream) RecvMsg(any) error              { return nil }

type fakeRealtimeConn struct {
	mu     sync.Mutex
	sent   []map[string]any
	recv   chan map[string]any
	closed bool
}

func newFakeRealtimeConn() *fakeRealtimeConn {
	return &fakeRealtimeConn{
		recv: make(chan map[string]any, 16),
		sent: make([]map[string]any, 0, 8),
	}
}

func (f *fakeRealtimeConn) Send(v any) error {
	payload, _ := v.(map[string]any)
	f.mu.Lock()
	f.sent = append(f.sent, payload)
	f.mu.Unlock()
	return nil
}

func (f *fakeRealtimeConn) Receive(v any) error {
	payload, ok := <-f.recv
	if !ok {
		return io.EOF
	}
	target, ok := v.(*map[string]any)
	if !ok {
		return io.ErrUnexpectedEOF
	}
	*target = payload
	return nil
}

func (f *fakeRealtimeConn) Close() error {
	f.mu.Lock()
	if !f.closed {
		f.closed = true
		close(f.recv)
	}
	f.mu.Unlock()
	return nil
}

func (f *fakeRealtimeConn) pushReceive(payload map[string]any) {
	f.recv <- payload
}

func (f *fakeRealtimeConn) sentTypes() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.sent))
	for _, payload := range f.sent {
		if payload == nil {
			out = append(out, "")
			continue
		}
		value, _ := payload["type"].(string)
		out = append(out, value)
	}
	return out
}

func (f *fakeRealtimeConn) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

func waitForRealtimeEvents(t *testing.T, svc *Service, sessionID string, minCount int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		record, ok := svc.realtimeSessions.get(sessionID)
		if ok {
			record.mu.Lock()
			count := len(record.events)
			record.mu.Unlock()
			if count >= minCount {
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d realtime events", minCount)
}

func swapRealtimeDialer(fn func(context.Context, *nimillm.Backend, string) (realtimeConn, error)) func() {
	prev := realtimeDialer
	realtimeDialer = fn
	return func() {
		realtimeDialer = prev
	}
}
