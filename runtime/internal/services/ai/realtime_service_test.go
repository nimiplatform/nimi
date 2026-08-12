package ai

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
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
	if len(artifact.GetBytes()) != 0 || artifact.GetSizeBytes() != int64(len("wave-bytes")) {
		t.Fatalf("unexpected artifact projection: %+v", artifact)
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
	if string(record.Bytes) != "wave-bytes" || record.MimeType != "audio/wav" || record.Owner == nil ||
		record.Owner.SubjectUserID != "user-001" || record.Owner.AppID != "nimi.desktop" {
		t.Fatalf("unexpected runtime artifact record: bytes=%q mime=%q owner=%+v", string(record.Bytes), record.MimeType, record.Owner)
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

func TestOpenRealtimeSessionAuthorizedCallerAlwaysFailsRouteUnsupported(t *testing.T) {
	for _, route := range []runtimev1.RoutePolicy{
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
	} {
		t.Run(route.String(), func(t *testing.T) {
			var logs bytes.Buffer
			svc := newTestService(slog.New(slog.NewTextHandler(&logs, nil)))
			ctx := executionintent.WithIntent(realtimeAuthorizedContext("account-a", "app.a"), executionintent.Intent{
				CapabilityContract: "text.generate",
				Route:              route,
			})
			response, err := svc.OpenRealtimeSession(ctx, &runtimev1.OpenRealtimeSessionRequest{
				Head: &runtimev1.ScenarioRequestHead{AppId: "app.a", SubjectUserId: "account-a"},
			})
			if response != nil {
				t.Fatalf("response = %+v", response)
			}
			assertRealtimeFailure(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
			for _, publicText := range []string{status.Convert(err).Message(), logs.String()} {
				normalized := strings.ToLower(publicText)
				if strings.Contains(normalized, "provider") || strings.Contains(normalized, "engine") {
					t.Fatalf("public failure leaked execution identity: %q", publicText)
				}
			}
		})
	}
}

func TestOpenRealtimeSessionDoesNotRequireAIConfig(t *testing.T) {
	svc := newTestService(nil)
	response, err := svc.OpenRealtimeSession(
		realtimeAuthorizedContext("account-a", "app.a"),
		&runtimev1.OpenRealtimeSessionRequest{
			Head: &runtimev1.ScenarioRequestHead{AppId: "app.a", SubjectUserId: "account-a"},
		},
	)
	if response != nil {
		t.Fatalf("response = %+v", response)
	}
	assertRealtimeFailure(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func TestOpenRealtimeSessionPreservesProtocolAndAuthorizationFailures(t *testing.T) {
	svc := newTestService(nil)
	for _, req := range []*runtimev1.OpenRealtimeSessionRequest{nil, {}} {
		response, err := svc.OpenRealtimeSession(realtimeAuthorizedContext("account-a", "app.a"), req)
		if response != nil {
			t.Fatalf("response = %+v", response)
		}
		assertRealtimeFailure(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: "text.generate",
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	response, err := svc.OpenRealtimeSession(ctx, &runtimev1.OpenRealtimeSessionRequest{
		Head: &runtimev1.ScenarioRequestHead{AppId: "app.a", SubjectUserId: "account-a"},
	})
	if response != nil {
		t.Fatalf("response = %+v", response)
	}
	assertRealtimeFailure(t, err, codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func TestRealtimeSessionRPCsReturnNotFoundWithoutOpenSession(t *testing.T) {
	svc := newTestService(nil)

	appendResponse, err := svc.AppendRealtimeInput(context.Background(), &runtimev1.AppendRealtimeInputRequest{SessionId: "missing"})
	if appendResponse != nil {
		t.Fatalf("append response = %+v", appendResponse)
	}
	assertRealtimeFailure(t, err, codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)

	err = svc.ReadRealtimeEvents(
		&runtimev1.ReadRealtimeEventsRequest{SessionId: "missing"},
		&mockRealtimeEventStream{ctx: context.Background()},
	)
	assertRealtimeFailure(t, err, codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)

	closeResponse, err := svc.CloseRealtimeSession(context.Background(), &runtimev1.CloseRealtimeSessionRequest{SessionId: "missing"})
	if closeResponse != nil {
		t.Fatalf("close response = %+v", closeResponse)
	}
	assertRealtimeFailure(t, err, codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
}

func realtimeAuthorizedContext(accountID string, appID string) context.Context {
	principal := protectedprincipal.New(
		appID, "test-realtime.v1", "test-realtime.v1",
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, make(chan struct{}),
	)
	return protectedprincipal.With(context.Background(), principal)
}

func assertRealtimeFailure(t *testing.T, err error, wantCode codes.Code, wantReason runtimev1.ReasonCode) {
	t.Helper()
	if status.Code(err) != wantCode {
		t.Fatalf("status code mismatch: got=%s want=%s err=%v", status.Code(err), wantCode, err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != wantReason {
		t.Fatalf("reason mismatch: got=%v present=%v want=%v err=%v", reason, ok, wantReason, err)
	}
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
