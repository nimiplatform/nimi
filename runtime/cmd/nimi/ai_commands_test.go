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
		textGenerateResponse: &runtimev1.ExecuteScenarioResponse{
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
			"text-generate",
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
		textEmbedResponse: &runtimev1.ExecuteScenarioResponse{
			Output: mustStructPB(t, map[string]any{
				"vectors": []any{
					[]any{1.0, 2.0},
					[]any{3.0, 4.0},
				},
			}),
			FinishReason:  runtimev1.FinishReason_FINISH_REASON_STOP,
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
			"text-embed",
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
	embedReq := service.lastEmbedScenarioRequest()
	if len(embedReq.GetSpec().GetTextEmbed().GetInputs()) != 2 {
		t.Fatalf("embed input count mismatch: %d", len(embedReq.GetSpec().GetTextEmbed().GetInputs()))
	}
}

func TestRunRuntimeAIStreamJSON(t *testing.T) {
	service := &cmdTestRuntimeAIService{
		streamScenarioEvents: []*runtimev1.StreamScenarioEvent{
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
				Sequence:  1,
				TraceId:   "trace-stream-1",
				Timestamp: timestamppb.Now(),
				Payload: &runtimev1.StreamScenarioEvent_Started{
					Started: &runtimev1.ScenarioStreamStarted{
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
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{Text: "hello"},
				},
			},
			{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Sequence:  3,
				TraceId:   "trace-stream-1",
				Timestamp: timestamppb.Now(),
				Payload: &runtimev1.StreamScenarioEvent_Completed{
					Completed: &runtimev1.ScenarioStreamCompleted{
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
	audioSource := req.GetSpec().GetSpeechTranscribe().GetAudioSource()
	if audioSource == nil {
		t.Fatalf("stt audio source missing")
	}
	if string(audioSource.GetAudioBytes()) != "fake wav bytes" {
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

	generateMD    metadata.MD
	streamMD      metadata.MD
	mediaSubmitMD metadata.MD

	lastEmbedReq      *runtimev1.ExecuteScenarioRequest
	lastScenarioReq   *runtimev1.SubmitScenarioJobRequest
	lastScenarioJob   *runtimev1.ScenarioJob
	lastScenarioParts []*runtimev1.ScenarioArtifact

	textGenerateResponse *runtimev1.ExecuteScenarioResponse
	textEmbedResponse    *runtimev1.ExecuteScenarioResponse
	streamScenarioEvents []*runtimev1.StreamScenarioEvent
	imageChunks          []*runtimev1.ArtifactChunk
	videoChunks          []*runtimev1.ArtifactChunk
	ttsChunks            []*runtimev1.ArtifactChunk
	sttText              string
}

func (s *cmdTestRuntimeAIService) ExecuteScenario(ctx context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, errors.New("scenario request is required")
	}
	s.mu.Lock()
	s.generateMD = cloneIncomingMetadata(ctx)
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED {
		s.lastEmbedReq = cloneExecuteScenarioRequest(req)
	}
	var resp *runtimev1.ExecuteScenarioResponse
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		resp = cloneExecuteScenarioResponse(s.textGenerateResponse)
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		resp = cloneExecuteScenarioResponse(s.textEmbedResponse)
	default:
		s.mu.Unlock()
		return nil, errors.New("unsupported scenario type in test service")
	}
	s.mu.Unlock()
	if resp == nil {
		return nil, errors.New("execute scenario response not configured")
	}
	return resp, nil
}

func (s *cmdTestRuntimeAIService) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	if req == nil {
		return errors.New("stream scenario request is required")
	}
	if req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE {
		return errors.New("unsupported stream scenario type in test service")
	}
	s.mu.Lock()
	s.streamMD = cloneIncomingMetadata(stream.Context())
	events := append([]*runtimev1.StreamScenarioEvent(nil), s.streamScenarioEvents...)
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

func (s *cmdTestRuntimeAIService) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return nil, errors.New("scenario submit request is required")
	}
	s.mu.Lock()
	s.mediaSubmitMD = cloneIncomingMetadata(ctx)
	s.lastScenarioReq = cloneSubmitScenarioJobRequest(req)

	var chunks []*runtimev1.ArtifactChunk
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.imageChunks...)
	case runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.videoChunks...)
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		chunks = append([]*runtimev1.ArtifactChunk(nil), s.ttsChunks...)
	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE:
		chunks = []*runtimev1.ArtifactChunk{
			{
				ArtifactId:    "stt-1",
				MimeType:      "text/plain",
				Chunk:         []byte(s.sttText),
				Eof:           true,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				ModelResolved: req.GetHead().GetModelId(),
				TraceId:       "trace-stt-1",
			},
		}
	default:
		s.mu.Unlock()
		return nil, errors.New("unsupported media modal in test service")
	}

	artifact, routeDecision, modelResolved, traceID, usage := assembleScenarioArtifactFromChunks(chunks)
	job := &runtimev1.ScenarioJob{
		JobId:         "job-1",
		Head:          cloneScenarioRequestHead(req.GetHead()),
		ScenarioType:  req.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       traceID,
		Usage:         usage,
		Artifacts:     []*runtimev1.ScenarioArtifact{artifact},
	}
	s.lastScenarioJob = cloneScenarioJob(job)
	s.lastScenarioParts = []*runtimev1.ScenarioArtifact{cloneScenarioArtifact(artifact)}
	s.mu.Unlock()
	return &runtimev1.SubmitScenarioJobResponse{
		Job: cloneScenarioJob(job),
	}, nil
}

func (s *cmdTestRuntimeAIService) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, errors.New("job id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastScenarioJob == nil {
		return &runtimev1.GetScenarioJobResponse{
			Job: &runtimev1.ScenarioJob{
				JobId:      req.GetJobId(),
				Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
				ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			},
		}, nil
	}
	return &runtimev1.GetScenarioJobResponse{
		Job: cloneScenarioJob(s.lastScenarioJob),
	}, nil
}

func (s *cmdTestRuntimeAIService) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	if req == nil || strings.TrimSpace(req.GetJobId()) == "" {
		return nil, errors.New("job id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	artifacts := make([]*runtimev1.ScenarioArtifact, 0, len(s.lastScenarioParts))
	for _, artifact := range s.lastScenarioParts {
		artifacts = append(artifacts, cloneScenarioArtifact(artifact))
	}
	traceID := ""
	if s.lastScenarioJob != nil {
		traceID = s.lastScenarioJob.GetTraceId()
	}
	return &runtimev1.GetScenarioArtifactsResponse{
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

func (s *cmdTestRuntimeAIService) lastEmbedScenarioRequest() *runtimev1.ExecuteScenarioRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastEmbedReq == nil {
		return &runtimev1.ExecuteScenarioRequest{}
	}
	return cloneExecuteScenarioRequest(s.lastEmbedReq)
}

func (s *cmdTestRuntimeAIService) lastSTTSubmitRequest() *runtimev1.SubmitScenarioJobRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastScenarioReq == nil || s.lastScenarioReq.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE {
		return nil
	}
	return cloneSubmitScenarioJobRequest(s.lastScenarioReq)
}

func assembleScenarioArtifactFromChunks(chunks []*runtimev1.ArtifactChunk) (*runtimev1.ScenarioArtifact, runtimev1.RoutePolicy, string, string, *runtimev1.UsageStats) {
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

	return &runtimev1.ScenarioArtifact{
		ArtifactId: artifactID,
		MimeType:   mimeType,
		Bytes:      payload,
	}, routeDecision, modelResolved, traceID, usage
}

func cloneExecuteScenarioRequest(req *runtimev1.ExecuteScenarioRequest) *runtimev1.ExecuteScenarioRequest {
	if req == nil {
		return nil
	}
	cloned, ok := proto.Clone(req).(*runtimev1.ExecuteScenarioRequest)
	if !ok {
		return nil
	}
	return cloned
}

func cloneExecuteScenarioResponse(resp *runtimev1.ExecuteScenarioResponse) *runtimev1.ExecuteScenarioResponse {
	if resp == nil {
		return nil
	}
	cloned, ok := proto.Clone(resp).(*runtimev1.ExecuteScenarioResponse)
	if !ok {
		return nil
	}
	return cloned
}

func cloneSubmitScenarioJobRequest(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.SubmitScenarioJobRequest {
	if req == nil {
		return nil
	}
	cloned, ok := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
	if !ok {
		return nil
	}
	return cloned
}

func cloneScenarioJob(job *runtimev1.ScenarioJob) *runtimev1.ScenarioJob {
	if job == nil {
		return nil
	}
	cloned, ok := proto.Clone(job).(*runtimev1.ScenarioJob)
	if !ok {
		return nil
	}
	return cloned
}

func cloneScenarioArtifact(input *runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.ScenarioArtifact)
	if !ok {
		return nil
	}
	return cloned
}

func cloneScenarioRequestHead(input *runtimev1.ScenarioRequestHead) *runtimev1.ScenarioRequestHead {
	if input == nil {
		return nil
	}
	cloned, ok := proto.Clone(input).(*runtimev1.ScenarioRequestHead)
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

func mustStructPB(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("build structpb: %v", err)
	}
	return out
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
