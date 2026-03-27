package workflow

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteAINodesMapToRuntimeAIService(t *testing.T) {
	client := &recordingRuntimeAIClient{}
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithAIClient(client),
		WithArtifactRoot(t.TempDir()),
	)
	record := &taskRecord{
		TaskID:        "task-ai-1",
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
	}
	ctx := context.Background()

	_, err := svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "generate",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE,
		TypeConfig: &runtimev1.WorkflowNode_AiGenerateConfig{
			AiGenerateConfig: &runtimev1.AiGenerateNodeConfig{ModelId: "m-generate"},
		},
	}, map[string]*structpb.Struct{
		"text": structFromMap(map[string]any{"value": "prompt-generate"}),
	})
	if err != nil {
		t.Fatalf("execute ai generate: %v", err)
	}
	if client.generateReq == nil || client.generateReq.GetHead().GetModelId() != "m-generate" {
		t.Fatalf("generate request not captured: %+v", client.generateReq)
	}
	if len(client.generateReq.GetSpec().GetTextGenerate().GetInput()) == 0 || client.generateReq.GetSpec().GetTextGenerate().GetInput()[0].GetContent() != "prompt-generate" {
		t.Fatalf("generate prompt mapping mismatch: %+v", client.generateReq.GetSpec().GetTextGenerate().GetInput())
	}

	_, err = svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "stream",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STREAM,
		TypeConfig: &runtimev1.WorkflowNode_AiStreamConfig{
			AiStreamConfig: &runtimev1.AiStreamNodeConfig{ModelId: "m-stream"},
		},
	}, map[string]*structpb.Struct{
		"prompt": structFromMap(map[string]any{"value": "prompt-stream"}),
	})
	if err != nil {
		t.Fatalf("execute ai stream: %v", err)
	}
	if client.streamReq == nil || client.streamReq.GetHead().GetModelId() != "m-stream" {
		t.Fatalf("stream request not captured: %+v", client.streamReq)
	}

	_, err = svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "embed",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_EMBED,
		TypeConfig: &runtimev1.WorkflowNode_AiEmbedConfig{
			AiEmbedConfig: &runtimev1.AiEmbedNodeConfig{ModelId: "m-embed"},
		},
	}, map[string]*structpb.Struct{
		"inputs": structFromMap(map[string]any{"values": []any{"a", "b"}}),
	})
	if err != nil {
		t.Fatalf("execute ai embed: %v", err)
	}
	if client.embedReq == nil || len(client.embedReq.GetSpec().GetTextEmbed().GetInputs()) != 2 {
		t.Fatalf("embed request mapping mismatch: %+v", client.embedReq)
	}

	imageOutputs, err := svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "image",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
		TypeConfig: &runtimev1.WorkflowNode_AiImageConfig{
			AiImageConfig: &runtimev1.AiImageNodeConfig{ModelId: "m-image"},
		},
	}, map[string]*structpb.Struct{
		"prompt": structFromMap(map[string]any{"value": "image-prompt"}),
	})
	if err != nil {
		t.Fatalf("execute ai image: %v", err)
	}
	imageReq := client.findScenarioReqByType(runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE)
	if imageReq == nil {
		t.Fatalf("image scenario request not captured")
	}
	if imageReq.GetSpec().GetImageGenerate().GetPrompt() != "image-prompt" {
		t.Fatalf("image request mapping mismatch: %+v", imageReq)
	}
	if imageOutputs["artifact"] == nil {
		t.Fatalf("image artifact output missing")
	}

	videoOutputs, err := svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "video",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO,
		TypeConfig: &runtimev1.WorkflowNode_AiVideoConfig{
			AiVideoConfig: &runtimev1.AiVideoNodeConfig{ModelId: "m-video"},
		},
	}, map[string]*structpb.Struct{
		"prompt": structFromMap(map[string]any{"value": "video-prompt"}),
	})
	if err != nil {
		t.Fatalf("execute ai video: %v", err)
	}
	videoReq := client.findScenarioReqByType(runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE)
	if videoReq == nil {
		t.Fatalf("video scenario request not captured")
	}
	if videoReq.GetSpec().GetVideoGenerate().GetPrompt() != "video-prompt" {
		t.Fatalf("video request mapping mismatch: %+v", videoReq)
	}
	if videoOutputs["artifact"] == nil {
		t.Fatalf("video artifact output missing")
	}

	ttsOutputs, err := svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "tts",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS,
		TypeConfig: &runtimev1.WorkflowNode_AiTtsConfig{
			AiTtsConfig: &runtimev1.AiTtsNodeConfig{ModelId: "m-tts"},
		},
	}, map[string]*structpb.Struct{
		"text": structFromMap(map[string]any{"value": "tts-input"}),
	})
	if err != nil {
		t.Fatalf("execute ai tts: %v", err)
	}
	ttsReq := client.findScenarioReqByType(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE)
	if ttsReq == nil {
		t.Fatalf("tts scenario request not captured")
	}
	if ttsReq.GetSpec().GetSpeechSynthesize().GetText() != "tts-input" {
		t.Fatalf("tts request mapping mismatch: %+v", ttsReq)
	}
	if ttsOutputs["artifact"] == nil {
		t.Fatalf("tts artifact output missing")
	}

	sttOutputs, err := svc.executeNode(ctx, record, &runtimev1.WorkflowNode{
		NodeId:   "stt",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT,
		TypeConfig: &runtimev1.WorkflowNode_AiSttConfig{
			AiSttConfig: &runtimev1.AiSttNodeConfig{
				ModelId:    "m-stt",
				MimeType:   "audio/wav",
				AudioBytes: []byte("audio-bytes"),
			},
		},
	}, map[string]*structpb.Struct{})
	if err != nil {
		t.Fatalf("execute ai stt: %v", err)
	}
	sttReq := client.findScenarioReqByType(runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE)
	if sttReq == nil {
		t.Fatalf("stt scenario request not captured")
	}
	if sttReq.GetHead().GetModelId() != "m-stt" || sttReq.GetSpec().GetSpeechTranscribe().GetMimeType() != "audio/wav" {
		t.Fatalf("stt request mapping mismatch: %+v", sttReq)
	}
	if sttOutputs["text"].AsMap()["value"] != "transcribed-audio" {
		t.Fatalf("stt output mapping mismatch: %v", sttOutputs["text"].AsMap())
	}
}

func TestWorkflowExternalAsyncMediaNode(t *testing.T) {
	client := &recordingRuntimeAIClient{}
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithAIClient(client),
		WithArtifactRoot(t.TempDir()),
	)
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "external.async.image",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "city skyline"},
					},
				},
				{
					NodeId:        "image",
					NodeType:      runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
					ExecutionMode: runtimev1.WorkflowExecutionMode_WORKFLOW_EXECUTION_MODE_EXTERNAL_ASYNC,
					DependsOn:     []string{"source"},
					TypeConfig: &runtimev1.WorkflowNode_AiImageConfig{
						AiImageConfig: &runtimev1.AiImageNodeConfig{
							ModelId: "m-image",
						},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "text", ToNodeId: "image", ToInput: "prompt"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("workflow status mismatch: %v", statusResp.GetStatus())
	}
	if client.scenarioSubmitReq == nil {
		t.Fatalf("submitScenarioJob request not captured")
	}
	if client.scenarioSubmitReq.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE {
		t.Fatalf("external async scenario type mismatch: %v", client.scenarioSubmitReq.GetScenarioType())
	}
	if client.scenarioSubmitReq.GetRequestId() == "" || client.scenarioSubmitReq.GetIdempotencyKey() == "" {
		t.Fatalf("external async request_id/idempotency_key must be populated")
	}
	if client.scenarioSubmitReq.GetLabels()["workflow_task_id"] == "" || client.scenarioSubmitReq.GetLabels()["workflow_node_id"] == "" {
		t.Fatalf("external async labels must include workflow_task_id/workflow_node_id")
	}

	stream := &workflowEventCollector{ctx: workflowContext("nimi.desktop")}
	if err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{
		TaskId: submitResp.GetTaskId(),
	}, stream); err != nil {
		t.Fatalf("subscribe workflow events: %v", err)
	}
	foundSubmitted := false
	foundCompleted := false
	assertPayloadFields := func(payload *structpb.Struct, fieldName string) {
		if payload == nil {
			t.Fatalf("%s payload must not be nil", fieldName)
		}
		values := payload.AsMap()
		for _, key := range []string{"job_id", "provider_job_id", "status", "retry_count", "reason_code", "reason_detail"} {
			if _, exists := values[key]; !exists {
				t.Fatalf("%s payload missing key %q: %#v", fieldName, key, values)
			}
		}
	}
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_SUBMITTED {
			foundSubmitted = true
			assertPayloadFields(event.GetPayload(), "NODE_EXTERNAL_SUBMITTED")
		}
		if event.GetEventType() == runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_EXTERNAL_COMPLETED {
			foundCompleted = true
			assertPayloadFields(event.GetPayload(), "NODE_EXTERNAL_COMPLETED")
		}
	}
	if !foundSubmitted {
		t.Fatalf("expected NODE_EXTERNAL_SUBMITTED event")
	}
	if !foundCompleted {
		t.Fatalf("expected NODE_EXTERNAL_COMPLETED event")
	}
}

func TestExecuteAINodesFailClosedWithoutRuntimeAIClient(t *testing.T) {
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithArtifactRoot(t.TempDir()),
	)
	record := &taskRecord{
		TaskID:        "task-ai-missing-client",
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
	}

	_, err := svc.executeNode(context.Background(), record, &runtimev1.WorkflowNode{
		NodeId:   "generate",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE,
		TypeConfig: &runtimev1.WorkflowNode_AiGenerateConfig{
			AiGenerateConfig: &runtimev1.AiGenerateNodeConfig{ModelId: "m-generate"},
		},
	}, map[string]*structpb.Struct{
		"text": structFromMap(map[string]any{"value": "prompt"}),
	})
	if err == nil || !strings.Contains(err.Error(), "runtime ai client is unavailable") {
		t.Fatalf("expected fail-closed error, got %v", err)
	}
}

func TestWorkflowReasonCodeFromErrorPrefersStructuredErrorInfo(t *testing.T) {
	err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	if got := workflowReasonCodeFromError(err); got != runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED {
		t.Fatalf("workflowReasonCodeFromError() = %v, want %v", got, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED)
	}
}

func TestWorkflowExternalAsyncCancelPropagatesToScenarioJob(t *testing.T) {
	client := &recordingRuntimeAIClient{
		scenarioPollStatuses: []runtimev1.ScenarioJobStatus{
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		},
	}
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithAIClient(client),
		WithArtifactRoot(t.TempDir()),
	)
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "external.async.cancel",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "city skyline"},
					},
				},
				{
					NodeId:        "image",
					NodeType:      runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE,
					ExecutionMode: runtimev1.WorkflowExecutionMode_WORKFLOW_EXECUTION_MODE_EXTERNAL_ASYNC,
					DependsOn:     []string{"source"},
					TypeConfig: &runtimev1.WorkflowNode_AiImageConfig{
						AiImageConfig: &runtimev1.AiImageNodeConfig{
							ModelId: "m-image",
						},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "text", ToNodeId: "image", ToInput: "prompt"},
			},
		},
		TimeoutMs: 5_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for client.submittedScenarioRequest() == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if client.submittedScenarioRequest() == nil {
		t.Fatalf("scenario submit request was not issued")
	}
	if _, cancelErr := svc.CancelWorkflow(workflowContext("nimi.desktop"), &runtimev1.CancelWorkflowRequest{
		TaskId: submitResp.GetTaskId(),
	}); cancelErr != nil {
		t.Fatalf("cancel workflow: %v", cancelErr)
	}
	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED {
		t.Fatalf("workflow status mismatch: %v", statusResp.GetStatus())
	}
	if cancelReq := client.cancelScenarioRequest(); cancelReq == nil || cancelReq.GetJobId() == "" {
		t.Fatalf("cancel scenario job request must be forwarded")
	}
}

type recordingRuntimeAIClient struct {
	mu                   sync.Mutex
	generateReq          *runtimev1.ExecuteScenarioRequest
	streamReq            *runtimev1.StreamScenarioRequest
	embedReq             *runtimev1.ExecuteScenarioRequest
	scenarioSubmitReq    *runtimev1.SubmitScenarioJobRequest
	scenarioSubmitReqs   []*runtimev1.SubmitScenarioJobRequest
	scenarioJobs         map[string]*runtimev1.ScenarioJob
	scenarioPollStatuses []runtimev1.ScenarioJobStatus
	scenarioPollIndex    int
	cancelReq            *runtimev1.CancelScenarioJobRequest
}

func (c *recordingRuntimeAIClient) ExecuteScenario(_ context.Context, req *runtimev1.ExecuteScenarioRequest, _ ...grpc.CallOption) (*runtimev1.ExecuteScenarioResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		c.generateReq = cloneExecuteScenarioRequest(req)
		return &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: "generated"},
				},
			},
		}, nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED:
		c.embedReq = cloneExecuteScenarioRequest(req)
		return &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextEmbed{
					TextEmbed: &runtimev1.TextEmbedOutput{
						Vectors: []*runtimev1.EmbeddingVector{
							{Values: []float64{1.0, 2.0}},
						},
					},
				},
			},
		}, nil
	default:
		return nil, status.Error(codes.Unimplemented, "unimplemented")
	}
}

func (c *recordingRuntimeAIClient) StreamScenario(ctx context.Context, req *runtimev1.StreamScenarioRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.StreamScenarioEvent], error) {
	c.mu.Lock()
	c.streamReq = cloneStreamScenarioRequest(req)
	c.mu.Unlock()
	return &fakeStreamScenarioClient{
		ctx: ctx,
		events: []*runtimev1.StreamScenarioEvent{
			{
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: "hello"},
						},
					},
				},
			},
			{
				Payload: &runtimev1.StreamScenarioEvent_Delta{
					Delta: &runtimev1.ScenarioStreamDelta{
						Delta: &runtimev1.ScenarioStreamDelta_Text{
							Text: &runtimev1.TextStreamDelta{Text: " world"},
						},
					},
				},
			},
		},
	}, nil
}

func (c *recordingRuntimeAIClient) SubmitScenarioJob(_ context.Context, req *runtimev1.SubmitScenarioJobRequest, _ ...grpc.CallOption) (*runtimev1.SubmitScenarioJobResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.scenarioSubmitReq = cloneSubmitScenarioJobRequest(req)
	c.scenarioSubmitReqs = append(c.scenarioSubmitReqs, cloneSubmitScenarioJobRequest(req))
	if c.scenarioJobs == nil {
		c.scenarioJobs = make(map[string]*runtimev1.ScenarioJob)
	}
	jobID := "job-1"
	scenarioArtifact := &runtimev1.ScenarioArtifact{
		ArtifactId: "artifact-1",
		MimeType:   "image/png",
		Bytes:      []byte("artifact-content"),
	}
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE {
		scenarioArtifact.MimeType = "video/mp4"
	}
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		scenarioArtifact.MimeType = "audio/wav"
	}
	if req.GetScenarioType() == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE {
		scenarioArtifact.MimeType = "text/plain"
		scenarioArtifact.Bytes = []byte("transcribed-audio")
	}
	scenarioJob := &runtimev1.ScenarioJob{
		JobId:         jobID,
		Head:          cloneScenarioHead(req.GetHead()),
		ScenarioType:  req.GetScenarioType(),
		ExecutionMode: req.GetExecutionMode(),
		Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		Artifacts:     []*runtimev1.ScenarioArtifact{scenarioArtifact},
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		RouteDecision: req.GetHead().GetRoutePolicy(),
		ModelResolved: req.GetHead().GetModelId(),
	}
	c.scenarioJobs[jobID] = scenarioJob
	return &runtimev1.SubmitScenarioJobResponse{Job: cloneScenarioJob(scenarioJob)}, nil
}

func (c *recordingRuntimeAIClient) GetScenarioJob(_ context.Context, req *runtimev1.GetScenarioJobRequest, _ ...grpc.CallOption) (*runtimev1.GetScenarioJobResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.scenarioJobs == nil {
		c.scenarioJobs = map[string]*runtimev1.ScenarioJob{}
	}
	job := c.scenarioJobs[req.GetJobId()]
	if job == nil {
		job = &runtimev1.ScenarioJob{
			JobId:      req.GetJobId(),
			Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			ReasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		}
	} else if len(c.scenarioPollStatuses) > 0 {
		statusIndex := c.scenarioPollIndex
		if statusIndex >= len(c.scenarioPollStatuses) {
			statusIndex = len(c.scenarioPollStatuses) - 1
		}
		c.scenarioPollIndex++
		job.Status = c.scenarioPollStatuses[statusIndex]
		if job.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
			job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			job.ReasonDetail = "poll failed"
		}
		if job.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING || job.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
			job.RetryCount = int32(c.scenarioPollIndex)
		}
	}
	c.scenarioJobs[req.GetJobId()] = job
	return &runtimev1.GetScenarioJobResponse{Job: cloneScenarioJob(job)}, nil
}

func (c *recordingRuntimeAIClient) CancelScenarioJob(_ context.Context, req *runtimev1.CancelScenarioJobRequest, _ ...grpc.CallOption) (*runtimev1.CancelScenarioJobResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cancelReq = cloneCancelScenarioJobRequest(req)
	if c.scenarioJobs == nil {
		c.scenarioJobs = map[string]*runtimev1.ScenarioJob{}
	}
	job := c.scenarioJobs[req.GetJobId()]
	if job == nil {
		job = &runtimev1.ScenarioJob{JobId: req.GetJobId()}
	}
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
	c.scenarioJobs[req.GetJobId()] = job
	return &runtimev1.CancelScenarioJobResponse{Job: cloneScenarioJob(job)}, nil
}

func (c *recordingRuntimeAIClient) SubscribeScenarioJobEvents(ctx context.Context, req *runtimev1.SubscribeScenarioJobEventsRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ScenarioJobEvent], error) {
	event := &runtimev1.ScenarioJobEvent{
		EventType: runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		Job: &runtimev1.ScenarioJob{
			JobId:      req.GetJobId(),
			Status:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	return &fakeScenarioJobEventClient{
		ctx:    ctx,
		events: []*runtimev1.ScenarioJobEvent{event},
	}, nil
}

func (c *recordingRuntimeAIClient) GetScenarioArtifacts(_ context.Context, req *runtimev1.GetScenarioArtifactsRequest, _ ...grpc.CallOption) (*runtimev1.GetScenarioArtifactsResponse, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.scenarioJobs == nil {
		c.scenarioJobs = map[string]*runtimev1.ScenarioJob{}
	}
	job := c.scenarioJobs[req.GetJobId()]
	if job == nil {
		return &runtimev1.GetScenarioArtifactsResponse{JobId: req.GetJobId()}, nil
	}
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:     req.GetJobId(),
		Artifacts: job.GetArtifacts(),
		TraceId:   job.GetTraceId(),
	}, nil
}

func (c *recordingRuntimeAIClient) ListScenarioProfiles(_ context.Context, _ *runtimev1.ListScenarioProfilesRequest, _ ...grpc.CallOption) (*runtimev1.ListScenarioProfilesResponse, error) {
	return &runtimev1.ListScenarioProfilesResponse{}, nil
}

func (c *recordingRuntimeAIClient) submittedScenarioRequest() *runtimev1.SubmitScenarioJobRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneSubmitScenarioJobRequest(c.scenarioSubmitReq)
}

func (c *recordingRuntimeAIClient) cancelScenarioRequest() *runtimev1.CancelScenarioJobRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneCancelScenarioJobRequest(c.cancelReq)
}

func (c *recordingRuntimeAIClient) GetVoiceAsset(_ context.Context, _ *runtimev1.GetVoiceAssetRequest, _ ...grpc.CallOption) (*runtimev1.GetVoiceAssetResponse, error) {
	return nil, status.Error(codes.Unimplemented, "unimplemented")
}

func (c *recordingRuntimeAIClient) ListVoiceAssets(_ context.Context, _ *runtimev1.ListVoiceAssetsRequest, _ ...grpc.CallOption) (*runtimev1.ListVoiceAssetsResponse, error) {
	return &runtimev1.ListVoiceAssetsResponse{}, nil
}

func (c *recordingRuntimeAIClient) DeleteVoiceAsset(_ context.Context, _ *runtimev1.DeleteVoiceAssetRequest, _ ...grpc.CallOption) (*runtimev1.DeleteVoiceAssetResponse, error) {
	return &runtimev1.DeleteVoiceAssetResponse{}, nil
}

func (c *recordingRuntimeAIClient) ListPresetVoices(_ context.Context, _ *runtimev1.ListPresetVoicesRequest, _ ...grpc.CallOption) (*runtimev1.ListPresetVoicesResponse, error) {
	return &runtimev1.ListPresetVoicesResponse{}, nil
}

func (c *recordingRuntimeAIClient) UploadArtifact(_ context.Context, _ ...grpc.CallOption) (grpc.ClientStreamingClient[runtimev1.UploadArtifactRequest, runtimev1.UploadArtifactResponse], error) {
	return nil, status.Error(codes.Unimplemented, "unimplemented")
}

func (c *recordingRuntimeAIClient) findScenarioReqByType(scenarioType runtimev1.ScenarioType) *runtimev1.SubmitScenarioJobRequest {
	for _, req := range c.scenarioSubmitReqs {
		if req.GetScenarioType() == scenarioType {
			return req
		}
	}
	return nil
}

type fakeStreamScenarioClient struct {
	ctx    context.Context
	events []*runtimev1.StreamScenarioEvent
	index  int
}

func (f *fakeStreamScenarioClient) Recv() (*runtimev1.StreamScenarioEvent, error) {
	if f.index >= len(f.events) {
		return nil, io.EOF
	}
	event := f.events[f.index]
	f.index++
	return event, nil
}

func (f *fakeStreamScenarioClient) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeStreamScenarioClient) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeStreamScenarioClient) CloseSend() error             { return nil }
func (f *fakeStreamScenarioClient) Context() context.Context     { return f.ctx }
func (f *fakeStreamScenarioClient) SendMsg(any) error            { return nil }
func (f *fakeStreamScenarioClient) RecvMsg(any) error            { return nil }

type fakeScenarioJobEventClient struct {
	ctx    context.Context
	events []*runtimev1.ScenarioJobEvent
	index  int
}

func (f *fakeScenarioJobEventClient) Recv() (*runtimev1.ScenarioJobEvent, error) {
	if f.index >= len(f.events) {
		return nil, io.EOF
	}
	item := f.events[f.index]
	f.index++
	return item, nil
}

func (f *fakeScenarioJobEventClient) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeScenarioJobEventClient) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeScenarioJobEventClient) CloseSend() error             { return nil }
func (f *fakeScenarioJobEventClient) Context() context.Context     { return f.ctx }
func (f *fakeScenarioJobEventClient) SendMsg(any) error            { return nil }
func (f *fakeScenarioJobEventClient) RecvMsg(any) error            { return nil }

func cloneScenarioHead(head *runtimev1.ScenarioRequestHead) *runtimev1.ScenarioRequestHead {
	if head == nil {
		return &runtimev1.ScenarioRequestHead{}
	}
	cloned := proto.Clone(head)
	copied, ok := cloned.(*runtimev1.ScenarioRequestHead)
	if !ok {
		return &runtimev1.ScenarioRequestHead{}
	}
	return copied
}

func cloneScenarioJob(job *runtimev1.ScenarioJob) *runtimev1.ScenarioJob {
	if job == nil {
		return &runtimev1.ScenarioJob{}
	}
	cloned := proto.Clone(job)
	copied, ok := cloned.(*runtimev1.ScenarioJob)
	if !ok {
		return &runtimev1.ScenarioJob{}
	}
	return copied
}

func cloneExecuteScenarioRequest(req *runtimev1.ExecuteScenarioRequest) *runtimev1.ExecuteScenarioRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.ExecuteScenarioRequest)
	if !ok {
		return &runtimev1.ExecuteScenarioRequest{}
	}
	return copied
}

func cloneStreamScenarioRequest(req *runtimev1.StreamScenarioRequest) *runtimev1.StreamScenarioRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.StreamScenarioRequest)
	if !ok {
		return &runtimev1.StreamScenarioRequest{}
	}
	return copied
}

func cloneSubmitScenarioJobRequest(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.SubmitScenarioJobRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.SubmitScenarioJobRequest)
	if !ok {
		return &runtimev1.SubmitScenarioJobRequest{}
	}
	return copied
}

func cloneCancelScenarioJobRequest(req *runtimev1.CancelScenarioJobRequest) *runtimev1.CancelScenarioJobRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.CancelScenarioJobRequest)
	if !ok {
		return &runtimev1.CancelScenarioJobRequest{}
	}
	return copied
}
