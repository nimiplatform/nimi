package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeAIGenerateJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		generateResponse: &runtimev1.GenerateResponse{
			Output: &structpb.Struct{Fields: map[string]*structpb.Value{
				"text": structpb.NewStringValue("hello from runtime"),
			}},
			FinishReason:  runtimev1.FinishReason_FINISH_REASON_STOP,
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "qwen2.5",
			TraceId:       "trace-resp-generate",
			Usage: &runtimev1.UsageStats{
				InputTokens:  2,
				OutputTokens: 4,
				ComputeMs:    5,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"generate",
			"--grpc-addr", addr,
			"--prompt", "hello",
			"--json",
			"--caller-kind", "third-party-app",
			"--caller-id", "app:writer",
			"--surface-id", "chat-screen",
			"--trace-id", "trace-cli-generate",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI generate: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal generate output: %v output=%q", unmarshalErr, output)
	}
	if got := strings.TrimSpace(asString(payload["text"])); got != "hello from runtime" {
		t.Fatalf("text mismatch: %q", got)
	}

	md := service.lastGenerateMetadata()
	if got := firstMD(md, "x-nimi-caller-kind"); got != "third-party-app" {
		t.Fatalf("caller-kind mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-caller-id"); got != "app:writer" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-surface-id"); got != "chat-screen" {
		t.Fatalf("surface-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-trace-id"); got != "trace-cli-generate" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
}

func TestRunRuntimeAIEmbedJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		embedResponse: &runtimev1.EmbedResponse{
			Vectors: []*structpb.ListValue{
				{
					Values: []*structpb.Value{
						structpb.NewNumberValue(1),
						structpb.NewNumberValue(2),
					},
				},
				{
					Values: []*structpb.Value{
						structpb.NewNumberValue(3),
						structpb.NewNumberValue(4),
					},
				},
			},
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "text-embedding-3-small",
			TraceId:       "trace-resp-embed",
			Usage: &runtimev1.UsageStats{
				InputTokens:  6,
				OutputTokens: 2,
				ComputeMs:    4,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"embed",
			"--grpc-addr", addr,
			"--input", "first input",
			"--input", "second input",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI embed: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal embed output: %v output=%q", unmarshalErr, output)
	}
	if got := int(asFloat(payload["vector_count"])); got != 2 {
		t.Fatalf("vector_count mismatch: %d", got)
	}
	embedReq := service.lastEmbedRequest()
	if len(embedReq.GetInputs()) != 2 {
		t.Fatalf("embed input count mismatch: %d", len(embedReq.GetInputs()))
	}
}

func TestRunRuntimeAIStreamJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
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
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"stream",
			"--grpc-addr", addr,
			"--prompt", "hello",
			"--json",
			"--caller-id", "svc:streamer",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI stream: %v", err)
	}

	lines := splitNonEmptyLines(output)
	if len(lines) != 3 {
		t.Fatalf("stream event line count mismatch: got=%d output=%q", len(lines), output)
	}
	var event map[string]any
	if unmarshalErr := json.Unmarshal([]byte(lines[1]), &event); unmarshalErr != nil {
		t.Fatalf("unmarshal stream delta line: %v", unmarshalErr)
	}
	if asString(event["event_type"]) != runtimev1.StreamEventType_STREAM_EVENT_DELTA.String() {
		t.Fatalf("event type mismatch: %v", event["event_type"])
	}

	md := service.lastStreamMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "svc:streamer" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestRunRuntimeAIImageJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		imageChunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "img-1",
				MimeType:      "image/png",
				Chunk:         []byte("hel"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "sd3",
				TraceId:       "trace-image-1",
			},
			{
				ArtifactId:    "img-1",
				MimeType:      "image/png",
				Chunk:         []byte("lo"),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "sd3",
				TraceId:       "trace-image-1",
				Usage: &runtimev1.UsageStats{
					InputTokens:  8,
					OutputTokens: 5,
					ComputeMs:    12,
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"image",
			"--grpc-addr", addr,
			"--prompt", "a cat",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI image: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal image output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["artifact_id"]) != "img-1" {
		t.Fatalf("artifact id mismatch: %v", payload["artifact_id"])
	}
	raw := asString(payload["artifact_base64"])
	decoded, decodeErr := base64.StdEncoding.DecodeString(raw)
	if decodeErr != nil {
		t.Fatalf("decode artifact base64: %v", decodeErr)
	}
	if string(decoded) != "hello" {
		t.Fatalf("artifact payload mismatch: %q", string(decoded))
	}
}

func TestRunRuntimeAIVideoJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		videoChunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "video-1",
				MimeType:      "video/mp4",
				Chunk:         []byte("abc"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
				ModelResolved: "video-gen",
				TraceId:       "trace-video-1",
			},
			{
				ArtifactId:    "video-1",
				MimeType:      "video/mp4",
				Chunk:         []byte("def"),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
				ModelResolved: "video-gen",
				TraceId:       "trace-video-1",
				Usage: &runtimev1.UsageStats{
					InputTokens:  12,
					OutputTokens: 20,
					ComputeMs:    35,
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"video",
			"--grpc-addr", addr,
			"--prompt", "flying car",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI video: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal video output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["artifact_id"]) != "video-1" {
		t.Fatalf("artifact id mismatch: %v", payload["artifact_id"])
	}
	raw := asString(payload["artifact_base64"])
	decoded, decodeErr := base64.StdEncoding.DecodeString(raw)
	if decodeErr != nil {
		t.Fatalf("decode artifact base64: %v", decodeErr)
	}
	if string(decoded) != "abcdef" {
		t.Fatalf("artifact payload mismatch: %q", string(decoded))
	}
}

func TestRunRuntimeAITTSJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		ttsChunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "tts-1",
				MimeType:      "audio/mpeg",
				Chunk:         []byte("mp"),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "tts-model",
				TraceId:       "trace-tts-1",
			},
			{
				ArtifactId:    "tts-1",
				MimeType:      "audio/mpeg",
				Chunk:         []byte("3"),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: "tts-model",
				TraceId:       "trace-tts-1",
				Usage: &runtimev1.UsageStats{
					InputTokens:  5,
					OutputTokens: 6,
					ComputeMs:    10,
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"tts",
			"--grpc-addr", addr,
			"--text", "hello",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI tts: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal tts output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["artifact_id"]) != "tts-1" {
		t.Fatalf("artifact id mismatch: %v", payload["artifact_id"])
	}
	raw := asString(payload["artifact_base64"])
	decoded, decodeErr := base64.StdEncoding.DecodeString(raw)
	if decodeErr != nil {
		t.Fatalf("decode artifact base64: %v", decodeErr)
	}
	if string(decoded) != "mp3" {
		t.Fatalf("artifact payload mismatch: %q", string(decoded))
	}
}

func TestRunRuntimeAISTTJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		sttText: "transcribed text",
	}
	addr, shutdown := startCmdTestRuntimeAIServer(t, service)
	defer shutdown()

	audioFile := createTempFile(t, []byte("fake wav bytes"))

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeAI([]string{
			"stt",
			"--grpc-addr", addr,
			"--audio-file", audioFile,
			"--mime-type", "audio/wav",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeAI stt: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal stt output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["text"]) != "transcribed text" {
		t.Fatalf("stt text mismatch: %v", payload["text"])
	}
	req := service.lastSTTSubmitRequest()
	if req == nil {
		t.Fatalf("stt submit request not captured")
	}
	spec, ok := req.GetSpec().(*runtimev1.SubmitMediaJobRequest_TranscriptionSpec)
	if !ok {
		t.Fatalf("stt transcription spec missing")
	}
	if string(spec.TranscriptionSpec.GetAudioBytes()) != "fake wav bytes" {
		t.Fatalf("audio bytes mismatch")
	}
}

func startCmdTestRuntimeAIServer(t *testing.T, service runtimev1.RuntimeAiServiceServer) (string, func()) {
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

type cmdTestRuntimeAIService struct {
	runtimev1.UnimplementedRuntimeAiServiceServer

	mu sync.Mutex

	generateMD      metadata.MD
	streamMD        metadata.MD
	mediaSubmitMD   metadata.MD
	embedRequest    *runtimev1.EmbedRequest
	lastMediaReq    *runtimev1.SubmitMediaJobRequest
	lastMediaJob    *runtimev1.MediaJob
	lastMediaRecord []*runtimev1.MediaArtifact

	generateResponse   *runtimev1.GenerateResponse
	embedResponse      *runtimev1.EmbedResponse
	streamEvents       []*runtimev1.StreamGenerateEvent
	imageChunks        []*runtimev1.ArtifactChunk
	videoChunks        []*runtimev1.ArtifactChunk
	ttsChunks          []*runtimev1.ArtifactChunk
	sttText            string
}

func (s *cmdTestRuntimeAIService) Generate(ctx context.Context, _ *runtimev1.GenerateRequest) (*runtimev1.GenerateResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.generateMD = cloneIncomingMetadata(ctx)
	if s.generateResponse != nil {
		return s.generateResponse, nil
	}
	return nil, errors.New("generate response not configured")
}

func (s *cmdTestRuntimeAIService) StreamGenerate(req *runtimev1.StreamGenerateRequest, stream grpc.ServerStreamingServer[runtimev1.StreamGenerateEvent]) error {
	s.mu.Lock()
	s.streamMD = cloneIncomingMetadata(stream.Context())
	events := append([]*runtimev1.StreamGenerateEvent(nil), s.streamEvents...)
	_ = req
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

func (s *cmdTestRuntimeAIService) Embed(ctx context.Context, req *runtimev1.EmbedRequest) (*runtimev1.EmbedResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.embedRequest = req
	_ = cloneIncomingMetadata(ctx)
	if s.embedResponse != nil {
		return s.embedResponse, nil
	}
	return nil, errors.New("embed response not configured")
}

func (s *cmdTestRuntimeAIService) SubmitMediaJob(ctx context.Context, req *runtimev1.SubmitMediaJobRequest) (*runtimev1.SubmitMediaJobResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.mediaSubmitMD = cloneIncomingMetadata(ctx)
	s.lastMediaReq = req

	var chunks []*runtimev1.ArtifactChunk
	switch req.GetModal() {
	case runtimev1.Modal_MODAL_IMAGE:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.imageChunks...)
	case runtimev1.Modal_MODAL_VIDEO:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.videoChunks...)
	case runtimev1.Modal_MODAL_TTS:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.ttsChunks...)
	case runtimev1.Modal_MODAL_STT:
		chunks = []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "stt-1",
				MimeType:      "text/plain",
				Chunk:         []byte(s.sttText),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: req.GetModelId(),
				TraceId:       "trace-stt-1",
			},
		}
	default:
		return nil, errors.New("unsupported media modal in test service")
	}

	artifact, routeDecision, modelResolved, traceID, usage := assembleArtifactFromChunks(chunks)
	job := &runtimev1.MediaJob{
		JobId:         "job-1",
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       traceID,
		Usage:         usage,
		Artifacts:     []*runtimev1.MediaArtifact{artifact},
	}

	s.lastMediaJob = job
	s.lastMediaRecord = []*runtimev1.MediaArtifact{artifact}
	return &runtimev1.SubmitMediaJobResponse{Job: job}, nil
}

func (s *cmdTestRuntimeAIService) GetMediaJob(context.Context, *runtimev1.GetMediaJobRequest) (*runtimev1.GetMediaJobResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastMediaJob == nil {
		return &runtimev1.GetMediaJobResponse{
			Job: &runtimev1.MediaJob{
				JobId:      "job-1",
				Status:     runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED,
				ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			},
		}, nil
	}
	return &runtimev1.GetMediaJobResponse{
		Job: cloneMediaJob(s.lastMediaJob),
	}, nil
}

func (s *cmdTestRuntimeAIService) GetMediaArtifacts(_ context.Context, req *runtimev1.GetMediaArtifactsRequest) (*runtimev1.GetMediaArtifactsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	artifacts := append([]*runtimev1.MediaArtifact(nil), s.lastMediaRecord...)
	traceID := ""
	if s.lastMediaJob != nil {
		traceID = s.lastMediaJob.GetTraceId()
	}
	return &runtimev1.GetMediaArtifactsResponse{
		JobId:     req.GetJobId(),
		Artifacts: artifacts,
		TraceId:   traceID,
	}, nil
}

func (s *cmdTestRuntimeAIService) lastGenerateMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generateMD.Copy()
}

func (s *cmdTestRuntimeAIService) lastStreamMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.streamMD.Copy()
}

func (s *cmdTestRuntimeAIService) lastEmbedRequest() *runtimev1.EmbedRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.embedRequest == nil {
		return &runtimev1.EmbedRequest{}
	}
	return s.embedRequest
}

func (s *cmdTestRuntimeAIService) lastSTTSubmitRequest() *runtimev1.SubmitMediaJobRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastMediaReq == nil || s.lastMediaReq.GetModal() != runtimev1.Modal_MODAL_STT {
		return nil
	}
	return s.lastMediaReq
}

func assembleArtifactFromChunks(chunks []*runtimev1.ArtifactChunk) (*runtimev1.MediaArtifact, runtimev1.RoutePolicy, string, string, *runtimev1.UsageStats) {
	artifactID := "artifact-1"
	mimeType := "application/octet-stream"
	routeDecision := runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
	modelResolved := ""
	traceID := ""
	var usage *runtimev1.UsageStats
	payload := make([]byte, 0)

	for _, chunk := range chunks {
		if chunk == nil {
			continue
		}
		if chunk.GetArtifactId() != "" {
			artifactID = chunk.GetArtifactId()
		}
		if chunk.GetMimeType() != "" {
			mimeType = chunk.GetMimeType()
		}
		if len(chunk.GetChunk()) > 0 {
			payload = append(payload, chunk.GetChunk()...)
		}
		if chunk.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			routeDecision = chunk.GetRouteDecision()
		}
		if chunk.GetModelResolved() != "" {
			modelResolved = chunk.GetModelResolved()
		}
		if chunk.GetTraceId() != "" {
			traceID = chunk.GetTraceId()
		}
		if chunk.GetUsage() != nil {
			usage = chunk.GetUsage()
		}
	}

	return &runtimev1.MediaArtifact{
		ArtifactId: artifactID,
		MimeType:   mimeType,
		Bytes:      payload,
	}, routeDecision, modelResolved, traceID, usage
}

func cloneMediaJob(job *runtimev1.MediaJob) *runtimev1.MediaJob {
	if job == nil {
		return nil
	}
	cloned, ok := proto.Clone(job).(*runtimev1.MediaJob)
	if !ok {
		return nil
	}
	return cloned
}

func captureStdoutFromRun(run func() error) (string, error) {
	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		return "", err
	}
	defer reader.Close()
	os.Stdout = writer

	outputCh := make(chan string, 1)
	go func() {
		data, _ := io.ReadAll(reader)
		outputCh <- string(data)
	}()

	runErr := run()
	_ = writer.Close()
	os.Stdout = original
	output := <-outputCh
	return strings.TrimSpace(output), runErr
}

func createTempFile(t *testing.T, content []byte) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "audio-*")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	if _, err := file.Write(content); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close temp file: %v", err)
	}
	return file.Name()
}

func cloneIncomingMetadata(ctx context.Context) metadata.MD {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return metadata.MD{}
	}
	return md.Copy()
}

func firstMD(md metadata.MD, key string) string {
	values := md.Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func asString(value any) string {
	switch item := value.(type) {
	case string:
		return item
	default:
		return ""
	}
}

func asFloat(value any) float64 {
	switch item := value.(type) {
	case float64:
		return item
	case float32:
		return float64(item)
	default:
		return 0
	}
}

func splitNonEmptyLines(input string) []string {
	parts := strings.Split(strings.TrimSpace(input), "\n")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}
