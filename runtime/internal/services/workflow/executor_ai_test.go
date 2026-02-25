package workflow

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
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
	if client.imageReq == nil || client.imageReq.GetPrompt() != "image-prompt" {
		t.Fatalf("image request mapping mismatch: %+v", client.imageReq)
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
	if client.videoReq == nil || client.videoReq.GetPrompt() != "video-prompt" {
		t.Fatalf("video request mapping mismatch: %+v", client.videoReq)
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
	if client.ttsReq == nil || client.ttsReq.GetText() != "tts-input" {
		t.Fatalf("tts request mapping mismatch: %+v", client.ttsReq)
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
	if client.sttReq == nil || client.sttReq.GetModelId() != "m-stt" || client.sttReq.GetMimeType() != "audio/wav" {
		t.Fatalf("stt request mapping mismatch: %+v", client.sttReq)
	}
	if sttOutputs["text"].AsMap()["value"] != "transcribed-audio" {
		t.Fatalf("stt output mapping mismatch: %v", sttOutputs["text"].AsMap())
	}
}

type recordingRuntimeAIClient struct {
	generateReq *runtimev1.GenerateRequest
	streamReq   *runtimev1.StreamGenerateRequest
	embedReq    *runtimev1.EmbedRequest
	imageReq    *runtimev1.GenerateImageRequest
	videoReq    *runtimev1.GenerateVideoRequest
	ttsReq      *runtimev1.SynthesizeSpeechRequest
	sttReq      *runtimev1.TranscribeAudioRequest
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

func (c *recordingRuntimeAIClient) GenerateImage(ctx context.Context, req *runtimev1.GenerateImageRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ArtifactChunk], error) {
	c.imageReq = cloneGenerateImageRequest(req)
	return &fakeArtifactChunkClient{
		ctx: ctx,
		chunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId: "image-1",
				MimeType:   "image/png",
				Chunk:      []byte("image-content"),
				Eof:        true,
			},
		},
	}, nil
}

func (c *recordingRuntimeAIClient) GenerateVideo(ctx context.Context, req *runtimev1.GenerateVideoRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ArtifactChunk], error) {
	c.videoReq = cloneGenerateVideoRequest(req)
	return &fakeArtifactChunkClient{
		ctx: ctx,
		chunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId: "video-1",
				MimeType:   "video/mp4",
				Chunk:      []byte("video-content"),
				Eof:        true,
			},
		},
	}, nil
}

func (c *recordingRuntimeAIClient) SynthesizeSpeech(ctx context.Context, req *runtimev1.SynthesizeSpeechRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ArtifactChunk], error) {
	c.ttsReq = cloneSynthesizeSpeechRequest(req)
	return &fakeArtifactChunkClient{
		ctx: ctx,
		chunks: []*runtimev1.ArtifactChunk{
			{
				ArtifactId: "tts-1",
				MimeType:   "audio/wav",
				Chunk:      []byte("audio-content"),
				Eof:        true,
			},
		},
	}, nil
}

func (c *recordingRuntimeAIClient) TranscribeAudio(_ context.Context, req *runtimev1.TranscribeAudioRequest, _ ...grpc.CallOption) (*runtimev1.TranscribeAudioResponse, error) {
	c.sttReq = cloneTranscribeAudioRequest(req)
	return &runtimev1.TranscribeAudioResponse{Text: "transcribed-audio"}, nil
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

type fakeArtifactChunkClient struct {
	ctx    context.Context
	chunks []*runtimev1.ArtifactChunk
	index  int
}

func (f *fakeArtifactChunkClient) Recv() (*runtimev1.ArtifactChunk, error) {
	if f.index >= len(f.chunks) {
		return nil, io.EOF
	}
	chunk := f.chunks[f.index]
	f.index++
	return chunk, nil
}

func (f *fakeArtifactChunkClient) Header() (metadata.MD, error) { return metadata.MD{}, nil }
func (f *fakeArtifactChunkClient) Trailer() metadata.MD         { return metadata.MD{} }
func (f *fakeArtifactChunkClient) CloseSend() error             { return nil }
func (f *fakeArtifactChunkClient) Context() context.Context     { return f.ctx }
func (f *fakeArtifactChunkClient) SendMsg(any) error            { return nil }
func (f *fakeArtifactChunkClient) RecvMsg(any) error            { return nil }

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

func cloneGenerateImageRequest(req *runtimev1.GenerateImageRequest) *runtimev1.GenerateImageRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.GenerateImageRequest)
	if !ok {
		return &runtimev1.GenerateImageRequest{}
	}
	return copied
}

func cloneGenerateVideoRequest(req *runtimev1.GenerateVideoRequest) *runtimev1.GenerateVideoRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.GenerateVideoRequest)
	if !ok {
		return &runtimev1.GenerateVideoRequest{}
	}
	return copied
}

func cloneSynthesizeSpeechRequest(req *runtimev1.SynthesizeSpeechRequest) *runtimev1.SynthesizeSpeechRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.SynthesizeSpeechRequest)
	if !ok {
		return &runtimev1.SynthesizeSpeechRequest{}
	}
	return copied
}

func cloneTranscribeAudioRequest(req *runtimev1.TranscribeAudioRequest) *runtimev1.TranscribeAudioRequest {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.TranscribeAudioRequest)
	if !ok {
		return &runtimev1.TranscribeAudioRequest{}
	}
	return copied
}
