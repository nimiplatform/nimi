package entrypoint

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestGenerateTextGRPC_MetadataOverride(t *testing.T) {
	service := &testRuntimeAIService{
		generateResponse: &runtimev1.GenerateResponse{
			Output: &structpb.Struct{Fields: map[string]*structpb.Value{
				"text": structpb.NewStringValue("hello"),
			}},
			FinishReason:  runtimev1.FinishReason_FINISH_REASON_STOP,
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "qwen2.5",
			TraceId:       "trace-gen-1",
			Usage: &runtimev1.UsageStats{
				InputTokens:  2,
				OutputTokens: 1,
				ComputeMs:    4,
			},
		},
	}
	addr, shutdown := startTestRuntimeAIServer(t, service)
	defer shutdown()

	resp, err := GenerateTextGRPC(addr, 3*time.Second, &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   30000,
	}, &ClientMetadata{
		CallerKind: "third-party-app",
		CallerID:   "app:novelizer",
		SurfaceID:  "chat-export",
		TraceID:    "trace-gen-md",
	})
	if err != nil {
		t.Fatalf("GenerateTextGRPC: %v", err)
	}
	if resp.GetTraceId() != "trace-gen-1" {
		t.Fatalf("trace mismatch: %s", resp.GetTraceId())
	}

	md := service.lastGenerateMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-kind"); got != "third-party-app" {
		t.Fatalf("caller-kind mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "app:novelizer" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-surface-id"); got != "chat-export" {
		t.Fatalf("surface-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-trace-id"); got != "trace-gen-md" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestStreamGenerateTextGRPC_MetadataAndEvents(t *testing.T) {
	service := &testRuntimeAIService{
		streamEvents: []*runtimev1.StreamGenerateEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Sequence:  1,
				TraceId:   "trace-stream-1",
				Timestamp: timestamppb.Now(),
				Payload: &runtimev1.StreamGenerateEvent_Started{
					Started: &runtimev1.StreamStarted{
						ModelResolved: "qwen2.5",
						RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
					},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Sequence:  2,
				TraceId:   "trace-stream-1",
				Timestamp: timestamppb.Now(),
				Payload: &runtimev1.StreamGenerateEvent_Delta{
					Delta: &runtimev1.StreamDelta{Text: "hello"},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Sequence:  3,
				TraceId:   "trace-stream-1",
				Timestamp: timestamppb.Now(),
				Payload: &runtimev1.StreamGenerateEvent_Completed{
					Completed: &runtimev1.StreamCompleted{
						FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
					},
				},
			},
		},
	}
	addr, shutdown := startTestRuntimeAIServer(t, service)
	defer shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events, errCh, err := StreamGenerateTextGRPC(ctx, addr, &runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120000,
	}, &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:worker",
		SurfaceID:  "job-runner",
		TraceID:    "trace-stream-md",
	})
	if err != nil {
		t.Fatalf("StreamGenerateTextGRPC: %v", err)
	}

	collected := make([]*runtimev1.StreamGenerateEvent, 0, 3)
	for events != nil || errCh != nil {
		select {
		case streamErr, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if streamErr != nil {
				t.Fatalf("stream error: %v", streamErr)
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			collected = append(collected, event)
		}
	}
	if len(collected) != 3 {
		t.Fatalf("event count mismatch: got=%d want=3", len(collected))
	}
	if collected[1].GetDelta().GetText() != "hello" {
		t.Fatalf("delta mismatch: %q", collected[1].GetDelta().GetText())
	}

	md := service.lastStreamMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-kind"); got != "third-party-service" {
		t.Fatalf("caller-kind mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:worker" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-surface-id"); got != "job-runner" {
		t.Fatalf("surface-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-trace-id"); got != "trace-stream-md" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
}

func TestGenerateImageGRPCCollectsChunks(t *testing.T) {
	service := &testRuntimeAIService{
		imageChunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "artifact-1",
				MimeType:      "image/png",
				Sequence:      1,
				Chunk:         []byte("hel"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "sd3",
				TraceId:       "trace-img-1",
			},
			{
				ArtifactId:    "artifact-1",
				MimeType:      "image/png",
				Sequence:      2,
				Chunk:         []byte("lo"),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "sd3",
				TraceId:       "trace-img-1",
				Usage: &runtimev1.UsageStats{
					InputTokens:  9,
					OutputTokens: 5,
					ComputeMs:    15,
				},
			},
		},
	}
	addr, shutdown := startTestRuntimeAIServer(t, service)
	defer shutdown()

	result, err := GenerateImageGRPC(addr, 3*time.Second, &runtimev1.GenerateImageRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Prompt:        "a cat",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     120000,
	}, &ClientMetadata{
		CallerKind: "third-party-app",
		CallerID:   "app:editor",
		SurfaceID:  "image-gen",
		TraceID:    "trace-image-md",
	})
	if err != nil {
		t.Fatalf("GenerateImageGRPC: %v", err)
	}
	if string(result.Payload) != "hello" {
		t.Fatalf("payload mismatch: %q", string(result.Payload))
	}
	if result.Usage.GetInputTokens() != 9 || result.Usage.GetOutputTokens() != 5 {
		t.Fatalf("usage mismatch: in=%d out=%d", result.Usage.GetInputTokens(), result.Usage.GetOutputTokens())
	}

	md := service.lastImageMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "app:editor" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-trace-id"); got != "trace-image-md" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
}

func startTestRuntimeAIServer(t *testing.T, service runtimev1.RuntimeAiServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeAiServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()

	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type testRuntimeAIService struct {
	runtimev1.UnimplementedRuntimeAiServiceServer

	mu sync.Mutex

	generateMD metadata.MD
	streamMD   metadata.MD
	imageMD    metadata.MD

	generateResponse *runtimev1.GenerateResponse
	streamEvents     []*runtimev1.StreamGenerateEvent
	imageChunks      []*runtimev1.ArtifactChunk
}

func (s *testRuntimeAIService) Generate(ctx context.Context, _ *runtimev1.GenerateRequest) (*runtimev1.GenerateResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.generateMD = cloneMetadata(ctx)
	if s.generateResponse != nil {
		return s.generateResponse, nil
	}
	return &runtimev1.GenerateResponse{
		Output: &structpb.Struct{Fields: map[string]*structpb.Value{
			"text": structpb.NewStringValue("ok"),
		}},
		FinishReason:  runtimev1.FinishReason_FINISH_REASON_STOP,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		ModelResolved: "test-model",
		TraceId:       "trace-default",
		Usage: &runtimev1.UsageStats{
			InputTokens:  1,
			OutputTokens: 1,
			ComputeMs:    1,
		},
	}, nil
}

func (s *testRuntimeAIService) StreamGenerate(_ *runtimev1.StreamGenerateRequest, stream grpc.ServerStreamingServer[runtimev1.StreamGenerateEvent]) error {
	s.mu.Lock()
	s.streamMD = cloneMetadata(stream.Context())
	events := append([]*runtimev1.StreamGenerateEvent(nil), s.streamEvents...)
	s.mu.Unlock()
	for _, event := range events {
		if event == nil {
			continue
		}
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	return nil
}

func (s *testRuntimeAIService) Embed(context.Context, *runtimev1.EmbedRequest) (*runtimev1.EmbedResponse, error) {
	return nil, errors.New("not implemented in test service")
}

func (s *testRuntimeAIService) GenerateImage(_ *runtimev1.GenerateImageRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	s.mu.Lock()
	s.imageMD = cloneMetadata(stream.Context())
	chunks := append([]*runtimev1.ArtifactChunk(nil), s.imageChunks...)
	s.mu.Unlock()
	for _, chunk := range chunks {
		if chunk == nil {
			continue
		}
		if err := stream.Send(chunk); err != nil {
			return err
		}
	}
	return nil
}

func (s *testRuntimeAIService) GenerateVideo(*runtimev1.GenerateVideoRequest, grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	return errors.New("not implemented in test service")
}

func (s *testRuntimeAIService) SynthesizeSpeech(*runtimev1.SynthesizeSpeechRequest, grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	return errors.New("not implemented in test service")
}

func (s *testRuntimeAIService) TranscribeAudio(context.Context, *runtimev1.TranscribeAudioRequest) (*runtimev1.TranscribeAudioResponse, error) {
	return nil, errors.New("not implemented in test service")
}

func (s *testRuntimeAIService) lastGenerateMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generateMD.Copy()
}

func (s *testRuntimeAIService) lastStreamMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamMD.Copy()
}

func (s *testRuntimeAIService) lastImageMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.imageMD.Copy()
}

func cloneMetadata(ctx context.Context) metadata.MD {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return metadata.MD{}
	}
	return md.Copy()
}

func firstMetadataValue(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
