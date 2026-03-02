package workflow

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	if client.generateReq == nil || client.generateReq.GetModelId() != "m-generate" {
		t.Fatalf("generate request not captured: %+v", client.generateReq)
	}
	if len(client.generateReq.GetInput()) == 0 || client.generateReq.GetInput()[0].GetContent() != "prompt-generate" {
		t.Fatalf("generate prompt mapping mismatch: %+v", client.generateReq.GetInput())
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
	if client.streamReq == nil || client.streamReq.GetModelId() != "m-stream" {
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
	if client.embedReq == nil || len(client.embedReq.GetInputs()) != 2 {
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
	imageReq := client.findMediaReqByModal(runtimev1.Modal_MODAL_IMAGE)
	if imageReq == nil {
		t.Fatalf("image media request not captured")
	}
	imageSpec, ok := imageReq.GetSpec().(*runtimev1.SubmitMediaJobRequest_ImageSpec)
	if !ok || imageSpec.ImageSpec.GetPrompt() != "image-prompt" {
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
	videoReq := client.findMediaReqByModal(runtimev1.Modal_MODAL_VIDEO)
	if videoReq == nil {
		t.Fatalf("video media request not captured")
	}
	videoSpec, ok := videoReq.GetSpec().(*runtimev1.SubmitMediaJobRequest_VideoSpec)
	if !ok || videoSpec.VideoSpec.GetPrompt() != "video-prompt" {
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
	ttsReq := client.findMediaReqByModal(runtimev1.Modal_MODAL_TTS)
	if ttsReq == nil {
		t.Fatalf("tts media request not captured")
	}
	speechSpec, ok := ttsReq.GetSpec().(*runtimev1.SubmitMediaJobRequest_SpeechSpec)
	if !ok || speechSpec.SpeechSpec.GetText() != "tts-input" {
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
	sttReq := client.findMediaReqByModal(runtimev1.Modal_MODAL_STT)
	if sttReq == nil {
		t.Fatalf("stt media request not captured")
	}
	transcriptionSpec, ok := sttReq.GetSpec().(*runtimev1.SubmitMediaJobRequest_TranscriptionSpec)
	if sttReq.GetModelId() != "m-stt" || !ok || transcriptionSpec.TranscriptionSpec.GetMimeType() != "audio/wav" {
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
	if client.mediaReq == nil {
		t.Fatalf("submitMediaJob request not captured")
	}
	if client.mediaReq.GetModal() != runtimev1.Modal_MODAL_IMAGE {
		t.Fatalf("external async modal mismatch: %v", client.mediaReq.GetModal())
	}
	if client.mediaReq.GetRequestId() == "" || client.mediaReq.GetIdempotencyKey() == "" {
		t.Fatalf("external async request_id/idempotency_key must be populated")
	}
	if client.mediaReq.GetLabels()["workflow_task_id"] == "" || client.mediaReq.GetLabels()["workflow_node_id"] == "" {
		t.Fatalf("external async labels must include workflow_task_id/workflow_node_id")
	}

	stream := &workflowEventCollector{ctx: context.Background()}
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

func TestWorkflowExternalAsyncCancelPropagatesToMediaJob(t *testing.T) {
	client := &recordingRuntimeAIClient{
		mediaPollStatuses: []runtimev1.MediaJobStatus{
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING,
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
	for client.mediaReq == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if client.mediaReq == nil {
		t.Fatalf("media submit request was not issued")
	}
	if _, cancelErr := svc.CancelWorkflow(ctx, &runtimev1.CancelWorkflowRequest{
		TaskId: submitResp.GetTaskId(),
	}); cancelErr != nil {
		t.Fatalf("cancel workflow: %v", cancelErr)
	}
	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED {
		t.Fatalf("workflow status mismatch: %v", statusResp.GetStatus())
	}
	if client.cancelReq == nil || client.cancelReq.GetJobId() == "" {
		t.Fatalf("cancel media job request must be forwarded")
	}
}

type recordingRuntimeAIClient struct {
	generateReq       *runtimev1.GenerateRequest
	streamReq         *runtimev1.StreamGenerateRequest
	embedReq          *runtimev1.EmbedRequest
	mediaReq          *runtimev1.SubmitMediaJobRequest
	mediaReqs         []*runtimev1.SubmitMediaJobRequest
	mediaJobs         map[string]*runtimev1.MediaJob
	mediaPollStatuses []runtimev1.MediaJobStatus
	mediaPollIndex    int
	cancelReq         *runtimev1.CancelMediaJobRequest
}

func (c *recordingRuntimeAIClient) Generate(_ context.Context, req *runtimev1.GenerateRequest, _ ...grpc.CallOption) (*runtimev1.GenerateResponse, error) {
	c.generateReq = cloneGenerateRequest(req)
	return &runtimev1.GenerateResponse{
		Output: structFromMap(map[string]any{"text": "generated"}),
	}, nil
}

func (c *recordingRuntimeAIClient) StreamGenerate(ctx context.Context, req *runtimev1.StreamGenerateRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.StreamGenerateEvent], error) {
	c.streamReq = cloneStreamGenerateRequest(req)
	return &fakeStreamGenerateClient{
		ctx: ctx,
		events: []*runtimev1.StreamGenerateEvent{
			{
				Payload: &runtimev1.StreamGenerateEvent_Delta{
					Delta: &runtimev1.StreamDelta{Text: "hello"},
				},
			},
			{
				Payload: &runtimev1.StreamGenerateEvent_Delta{
					Delta: &runtimev1.StreamDelta{Text: " world"},
				},
			},
		},
	}, nil
}

func (c *recordingRuntimeAIClient) Embed(_ context.Context, req *runtimev1.EmbedRequest, _ ...grpc.CallOption) (*runtimev1.EmbedResponse, error) {
	c.embedReq = cloneEmbedRequest(req)
	vector, err := structpb.NewList([]any{1.0, 2.0})
	if err != nil {
		return nil, err
	}
	return &runtimev1.EmbedResponse{
		Vectors: []*structpb.ListValue{vector},
	}, nil
}

func (c *recordingRuntimeAIClient) SubmitMediaJob(_ context.Context, req *runtimev1.SubmitMediaJobRequest, _ ...grpc.CallOption) (*runtimev1.SubmitMediaJobResponse, error) {
	c.mediaReq = cloneSubmitMediaJobRequest(req)
	c.mediaReqs = append(c.mediaReqs, cloneSubmitMediaJobRequest(req))
	if c.mediaJobs == nil {
		c.mediaJobs = make(map[string]*runtimev1.MediaJob)
	}
	jobID := "job-1"
	artifact := &runtimev1.MediaArtifact{
		ArtifactId: "artifact-1",
		MimeType:   "image/png",
		Bytes:      []byte("artifact-content"),
	}
	if req.GetModal() == runtimev1.Modal_MODAL_VIDEO {
		artifact.MimeType = "video/mp4"
	}
	if req.GetModal() == runtimev1.Modal_MODAL_TTS {
		artifact.MimeType = "audio/wav"
	}
	if req.GetModal() == runtimev1.Modal_MODAL_STT {
		artifact.MimeType = "text/plain"
		artifact.Bytes = []byte("transcribed-audio")
	}
	job := &runtimev1.MediaJob{
		JobId:         jobID,
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
		Artifacts:     []*runtimev1.MediaArtifact{artifact},
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		RouteDecision: req.GetRoutePolicy(),
		ModelResolved: req.GetModelId(),
	}
	c.mediaJobs[jobID] = job
	return &runtimev1.SubmitMediaJobResponse{Job: job}, nil
}

func (c *recordingRuntimeAIClient) GetMediaJob(_ context.Context, req *runtimev1.GetMediaJobRequest, _ ...grpc.CallOption) (*runtimev1.GetMediaJobResponse, error) {
	if c.mediaJobs == nil {
		c.mediaJobs = map[string]*runtimev1.MediaJob{}
	}
	job := c.mediaJobs[req.GetJobId()]
	if job == nil {
		job = &runtimev1.MediaJob{
			JobId:      req.GetJobId(),
			Status:     runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED,
			ReasonCode: runtimev1.ReasonCode_AI_OUTPUT_INVALID,
		}
	} else if len(c.mediaPollStatuses) > 0 {
		statusIndex := c.mediaPollIndex
		if statusIndex >= len(c.mediaPollStatuses) {
			statusIndex = len(c.mediaPollStatuses) - 1
		}
		c.mediaPollIndex++
		job.Status = c.mediaPollStatuses[statusIndex]
		if job.Status == runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED {
			job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			job.ReasonDetail = "poll failed"
		}
		if job.Status == runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING || job.Status == runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_QUEUED {
			job.RetryCount = int32(c.mediaPollIndex)
		}
	}
	return &runtimev1.GetMediaJobResponse{Job: job}, nil
}

func (c *recordingRuntimeAIClient) CancelMediaJob(_ context.Context, req *runtimev1.CancelMediaJobRequest, _ ...grpc.CallOption) (*runtimev1.CancelMediaJobResponse, error) {
	c.cancelReq = cloneCancelMediaJobRequest(req)
	if c.mediaJobs == nil {
		c.mediaJobs = map[string]*runtimev1.MediaJob{}
	}
	job := c.mediaJobs[req.GetJobId()]
	if job == nil {
		job = &runtimev1.MediaJob{JobId: req.GetJobId()}
	}
	job.Status = runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED
	c.mediaJobs[req.GetJobId()] = job
	return &runtimev1.CancelMediaJobResponse{Job: job}, nil
}

func (c *recordingRuntimeAIClient) SubscribeMediaJobEvents(ctx context.Context, req *runtimev1.SubscribeMediaJobEventsRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.MediaJobEvent], error) {
	event := &runtimev1.MediaJobEvent{
		EventType: runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED,
		Job: &runtimev1.MediaJob{
			JobId:      req.GetJobId(),
			Status:     runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	return &fakeMediaJobEventClient{
		ctx:    ctx,
		events: []*runtimev1.MediaJobEvent{event},
	}, nil
}

func (c *recordingRuntimeAIClient) GetMediaArtifacts(_ context.Context, req *runtimev1.GetMediaArtifactsRequest, _ ...grpc.CallOption) (*runtimev1.GetMediaArtifactsResponse, error) {
	if c.mediaJobs == nil {
		c.mediaJobs = map[string]*runtimev1.MediaJob{}
	}
	job := c.mediaJobs[req.GetJobId()]
	if job == nil {
		return &runtimev1.GetMediaArtifactsResponse{JobId: req.GetJobId()}, nil
	}
	return &runtimev1.GetMediaArtifactsResponse{
		JobId:     req.GetJobId(),
		Artifacts: job.GetArtifacts(),
		TraceId:   job.GetTraceId(),
	}, nil
}

func (c *recordingRuntimeAIClient) GetSpeechVoices(_ context.Context, _ *runtimev1.GetSpeechVoicesRequest, _ ...grpc.CallOption) (*runtimev1.GetSpeechVoicesResponse, error) {
	return &runtimev1.GetSpeechVoicesResponse{}, nil
}

func (c *recordingRuntimeAIClient) StreamSpeechSynthesis(_ context.Context, _ *runtimev1.StreamSpeechSynthesisRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ArtifactChunk], error) {
	return nil, status.Error(codes.Unimplemented, "unimplemented")
}

func (c *recordingRuntimeAIClient) findMediaReqByModal(modal runtimev1.Modal) *runtimev1.SubmitMediaJobRequest {
	for _, req := range c.mediaReqs {
		if req.GetModal() == modal {
			return req
		}
	}
	return nil
}

type fakeStreamGenerateClient struct {
	ctx    context.Context
	events []*runtimev1.StreamGenerateEvent
	index  int
}

func (f *fakeStreamGenerateClient) Recv() (*runtimev1.StreamGenerateEvent, error) {
	if f.index >= len(f.events) {
		return nil, io.EOF
	}
	event := f.events[f.index]
	f.index++
	return event, nil
}

func (f *fakeStreamGenerateClient) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeStreamGenerateClient) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeStreamGenerateClient) CloseSend() error             { return nil }
func (f *fakeStreamGenerateClient) Context() context.Context     { return f.ctx }
func (f *fakeStreamGenerateClient) SendMsg(any) error            { return nil }
func (f *fakeStreamGenerateClient) RecvMsg(any) error            { return nil }

type fakeMediaJobEventClient struct {
	ctx    context.Context
	events []*runtimev1.MediaJobEvent
	index  int
}

func (f *fakeMediaJobEventClient) Recv() (*runtimev1.MediaJobEvent, error) {
	if f.index >= len(f.events) {
		return nil, io.EOF
	}
	item := f.events[f.index]
	f.index++
	return item, nil
}

func (f *fakeMediaJobEventClient) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeMediaJobEventClient) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeMediaJobEventClient) CloseSend() error             { return nil }
func (f *fakeMediaJobEventClient) Context() context.Context     { return f.ctx }
func (f *fakeMediaJobEventClient) SendMsg(any) error            { return nil }
func (f *fakeMediaJobEventClient) RecvMsg(any) error            { return nil }

func cloneGenerateRequest(req *runtimev1.GenerateRequest) *runtimev1.GenerateRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.GenerateRequest)
	if !ok {
		return &runtimev1.GenerateRequest{}
	}
	return copied
}

func cloneStreamGenerateRequest(req *runtimev1.StreamGenerateRequest) *runtimev1.StreamGenerateRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.StreamGenerateRequest)
	if !ok {
		return &runtimev1.StreamGenerateRequest{}
	}
	return copied
}

func cloneEmbedRequest(req *runtimev1.EmbedRequest) *runtimev1.EmbedRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.EmbedRequest)
	if !ok {
		return &runtimev1.EmbedRequest{}
	}
	return copied
}

func cloneSubmitMediaJobRequest(req *runtimev1.SubmitMediaJobRequest) *runtimev1.SubmitMediaJobRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.SubmitMediaJobRequest)
	if !ok {
		return &runtimev1.SubmitMediaJobRequest{}
	}
	return copied
}

func cloneCancelMediaJobRequest(req *runtimev1.CancelMediaJobRequest) *runtimev1.CancelMediaJobRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.CancelMediaJobRequest)
	if !ok {
		return &runtimev1.CancelMediaJobRequest{}
	}
	return copied
}
