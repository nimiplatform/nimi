package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	runtimeartifact "github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func realtimeContext(appID string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

func TestUploadArtifactStoresArtifact(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	artifactStore := runtimeartifact.NewMemoryStore()
	svc.SetRuntimeArtifactStore(artifactStore)
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
	record, ok := artifactStore.Get(artifact.GetArtifactId())
	if !ok {
		t.Fatal("expected uploaded artifact to be available through runtime artifact store")
	}
	if string(record.Bytes) != "wave-bytes" || record.MimeType != "audio/wav" {
		t.Fatalf("unexpected runtime artifact record: bytes=%q mime=%q", string(record.Bytes), record.MimeType)
	}
}

func TestLooksLikeLocalFilePathOnlyMatchesLocalPrefixes(t *testing.T) {
	cases := map[string]bool{
		"/tmp/file.wav":         true,
		"../tmp/file.wav":       true,
		".\\tmp\\file.wav":      true,
		"C:/tmp/file.wav":       true,
		"~/tmp/file.wav":        true,
		"folder/file.wav":       false,
		"folder\\\\file.wav":    false,
		"https://cdn.nimi.ai/a": false,
		"artifact://voice/ref":  false,
	}
	for input, want := range cases {
		if got := looksLikeLocalFilePath(input); got != want {
			t.Fatalf("looksLikeLocalFilePath(%q) = %v, want %v", input, got, want)
		}
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

func TestUploadArtifactRejectsOversizedChunk(t *testing.T) {
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
					},
				},
			},
			{
				Payload: &runtimev1.UploadArtifactRequest_Chunk{
					Chunk: &runtimev1.UploadArtifactChunk{
						Sequence: 0,
						Bytes:    make([]byte, maxUploadedArtifactChunkBytes+1),
					},
				},
			},
		},
	}

	err := svc.UploadArtifact(stream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), codes.InvalidArgument, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE {
		t.Fatalf("unexpected reason: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
}

func TestOpenRealtimeSessionFailsClosedWithoutDriverContract(t *testing.T) {
	svc := newTestService(nil)
	response, err := svc.OpenRealtimeSession(context.Background(), &runtimev1.OpenRealtimeSessionRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"},
	})
	if response != nil {
		t.Fatalf("response = %+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("error = %v, reason=%v ok=%v", err, reason, ok)
	}
}

func TestOpenRealtimeSessionPreservesCloudUnsupportedContract(t *testing.T) {
	svc := newTestService(nil)
	_, err := svc.OpenRealtimeSession(context.Background(), &runtimev1.OpenRealtimeSessionRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId: "app", SubjectUserId: "user", ModelId: "openai/gpt-test",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("status = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("error = %v, reason=%v ok=%v", err, reason, ok)
	}
}

func TestSendRealtimeEnvelopePreservesCauseWithoutExposingIt(t *testing.T) {
	cause := &realtimeSendTestError{detail: "dial tcp 127.0.0.1:58001: private upstream detail"}
	record := &realtimeSessionRecord{
		conn: &fakeRealtimeConn{sendErr: cause},
	}

	err := sendRealtimeEnvelope(record, map[string]any{"type": "response.create"})
	if !errors.Is(err, cause) {
		t.Fatalf("expected wrapped cause, got %v", err)
	}
	var typedCause *realtimeSendTestError
	if !errors.As(err, &typedCause) || typedCause != cause {
		t.Fatalf("expected typed wrapped cause, got %T: %v", err, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("unexpected reason: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if wireMessage := status.Convert(err).Message(); strings.Contains(wireMessage, cause.Error()) {
		t.Fatalf("wire message leaked private cause: %q", wireMessage)
	}
}

type realtimeSendTestError struct {
	detail string
}

func (e *realtimeSendTestError) Error() string {
	return e.detail
}

func TestReadRealtimeEventsRejectsSecondReader(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	record := svc.realtimeSessions.create(&realtimeSessionRecord{
		sessionID:     "rt_conflict",
		appID:         "nimi.desktop",
		subjectUserID: "user-001",
		traceID:       "trace-1",
		events:        []*runtimev1.RealtimeEvent{},
	})
	if record == nil {
		t.Fatal("expected session record")
	}
	backlog, ch, _, conflict := svc.realtimeSessions.claimReader("rt_conflict", 0)
	if conflict || ch == nil || len(backlog) != 0 {
		t.Fatalf("unexpected first reader claim result: backlog=%d ch=%v conflict=%v", len(backlog), ch != nil, conflict)
	}
	defer svc.realtimeSessions.releaseReader("rt_conflict")

	err := svc.ReadRealtimeEvents(&runtimev1.ReadRealtimeEventsRequest{SessionId: "rt_conflict"}, &mockRealtimeEventStream{ctx: realtimeContext("nimi.desktop")})
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
	mu      sync.Mutex
	sent    []map[string]any
	recv    chan map[string]any
	closed  bool
	sendErr error
}

func newFakeRealtimeConn() *fakeRealtimeConn {
	return &fakeRealtimeConn{
		recv: make(chan map[string]any, 16),
		sent: make([]map[string]any, 0, 8),
	}
}

func (f *fakeRealtimeConn) Send(v any) error {
	if f.sendErr != nil {
		return f.sendErr
	}
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
