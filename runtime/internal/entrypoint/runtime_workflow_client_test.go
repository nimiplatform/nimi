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
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestSubmitWorkflowGRPC_MetadataOverride(t *testing.T) {
	service := &testRuntimeWorkflowService{
		submitResponse: &runtimev1.SubmitWorkflowResponse{
			TaskId:     "task-submit-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	resp, err := SubmitWorkflowGRPC(addr, 3*time.Second, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "image.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "n1",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "hello"},
					},
				},
			},
		},
		TimeoutMs: 120000,
	}, &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:workflow",
		SurfaceID:  "runtime-cli",
		TraceID:    "trace-workflow-submit",
	})
	if err != nil {
		t.Fatalf("SubmitWorkflowGRPC: %v", err)
	}
	if resp.GetTaskId() != "task-submit-1" {
		t.Fatalf("task id mismatch: %s", resp.GetTaskId())
	}

	md := service.lastSubmitMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:workflow" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-trace-id"); got != "trace-workflow-submit" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestGetWorkflowGRPC_MetadataAndRequest(t *testing.T) {
	service := &testRuntimeWorkflowService{
		getResponse: &runtimev1.GetWorkflowResponse{
			TaskId: "task-get-1",
			Status: runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
			Nodes: []*runtimev1.WorkflowNodeStatus{
				{
					NodeId:  "n1",
					Status:  runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
					Attempt: 1,
				},
			},
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	resp, err := GetWorkflowGRPC(addr, 3*time.Second, &runtimev1.GetWorkflowRequest{
		TaskId: "task-get-1",
	}, "nimi.desktop", &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:getter",
		SurfaceID:  "runtime-cli",
		TraceID:    "trace-workflow-get",
	})
	if err != nil {
		t.Fatalf("GetWorkflowGRPC: %v", err)
	}
	if resp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("workflow status mismatch: %v", resp.GetStatus())
	}

	md := service.lastGetMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:getter" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestSubscribeWorkflowEventsGRPC_MetadataAndEvents(t *testing.T) {
	service := &testRuntimeWorkflowService{
		watchEvents: []*runtimev1.WorkflowEvent{
			{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_STARTED,
				Sequence:   1,
				TaskId:     "task-watch-1",
				TraceId:    "trace-watch-1",
				Timestamp:  timestamppb.Now(),
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
			{
				EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_PROGRESS,
				Sequence:        2,
				TaskId:          "task-watch-1",
				TraceId:         "trace-watch-1",
				Timestamp:       timestamppb.Now(),
				NodeId:          "n1",
				ProgressPercent: 50,
				ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			},
			{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED,
				Sequence:   3,
				TaskId:     "task-watch-1",
				TraceId:    "trace-watch-1",
				Timestamp:  timestamppb.Now(),
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events, errCh, err := SubscribeWorkflowEventsGRPC(ctx, addr, &runtimev1.SubscribeWorkflowEventsRequest{
		TaskId: "task-watch-1",
	}, "nimi.desktop", &ClientMetadata{
		CallerKind: "third-party-service",
		CallerID:   "svc:watcher",
		SurfaceID:  "runtime-cli",
		TraceID:    "trace-workflow-watch",
	})
	if err != nil {
		t.Fatalf("SubscribeWorkflowEventsGRPC: %v", err)
	}

	collected := make([]*runtimev1.WorkflowEvent, 0, 3)
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
	if collected[1].GetProgressPercent() != 50 {
		t.Fatalf("progress mismatch: %d", collected[1].GetProgressPercent())
	}

	md := service.lastWatchMetadata()
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:watcher" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-trace-id"); got != "trace-workflow-watch" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
}

func startTestRuntimeWorkflowServer(t *testing.T, service runtimev1.RuntimeWorkflowServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeWorkflowServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type testRuntimeWorkflowService struct {
	runtimev1.UnimplementedRuntimeWorkflowServiceServer

	mu sync.Mutex

	submitMD metadata.MD
	getMD    metadata.MD
	watchMD  metadata.MD

	submitResponse *runtimev1.SubmitWorkflowResponse
	getResponse    *runtimev1.GetWorkflowResponse
	cancelResponse *runtimev1.Ack
	watchEvents    []*runtimev1.WorkflowEvent
}

func (s *testRuntimeWorkflowService) SubmitWorkflow(ctx context.Context, _ *runtimev1.SubmitWorkflowRequest) (*runtimev1.SubmitWorkflowResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.submitMD = cloneMetadata(ctx)
	if s.submitResponse != nil {
		return s.submitResponse, nil
	}
	return nil, errors.New("submit response not configured")
}

func (s *testRuntimeWorkflowService) GetWorkflow(ctx context.Context, _ *runtimev1.GetWorkflowRequest) (*runtimev1.GetWorkflowResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getMD = cloneMetadata(ctx)
	if s.getResponse != nil {
		return s.getResponse, nil
	}
	return nil, errors.New("get response not configured")
}

func (s *testRuntimeWorkflowService) CancelWorkflow(context.Context, *runtimev1.CancelWorkflowRequest) (*runtimev1.Ack, error) {
	if s.cancelResponse != nil {
		return s.cancelResponse, nil
	}
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *testRuntimeWorkflowService) SubscribeWorkflowEvents(_ *runtimev1.SubscribeWorkflowEventsRequest, stream grpc.ServerStreamingServer[runtimev1.WorkflowEvent]) error {
	s.mu.Lock()
	s.watchMD = cloneMetadata(stream.Context())
	events := append([]*runtimev1.WorkflowEvent(nil), s.watchEvents...)
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

func (s *testRuntimeWorkflowService) lastSubmitMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.submitMD.Copy()
}

func (s *testRuntimeWorkflowService) lastGetMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getMD.Copy()
}

func (s *testRuntimeWorkflowService) lastWatchMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.watchMD.Copy()
}
