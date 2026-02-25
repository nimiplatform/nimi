package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeWorkflowSubmitJSON(t *testing.T) {
	service := &cmdTestRuntimeWorkflowService{
		submitResponse: &runtimev1.SubmitWorkflowResponse{
			TaskId:     "wf-task-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	definitionFile := writeWorkflowDefinitionFile(t, `{
		"workflowType": "image.pipeline",
		"nodes": [
			{
				"nodeId": "n1",
				"nodeType": "WORKFLOW_NODE_TRANSFORM_TEMPLATE",
				"templateConfig": {"template": "hello"}
			},
			{
				"nodeId": "n2",
				"nodeType": "WORKFLOW_NODE_AI_GENERATE",
				"aiGenerateConfig": {"prompt": ""}
			}
		],
		"edges": [
			{"fromNodeId": "n1", "fromOutput": "text", "toNodeId": "n2", "toInput": "prompt"}
		]
	}`)

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeWorkflow([]string{
			"submit",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-001",
			"--definition-file", definitionFile,
			"--json",
			"--caller-id", "cli:workflow",
			"--trace-id", "trace-workflow-submit-cli",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeWorkflow submit: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal submit output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["task_id"]) != "wf-task-1" {
		t.Fatalf("task id mismatch: %v", payload["task_id"])
	}
	req := service.lastSubmitRequest()
	if req.GetDefinition().GetWorkflowType() != "image.pipeline" {
		t.Fatalf("workflow type mismatch: %s", req.GetDefinition().GetWorkflowType())
	}
	md := service.lastSubmitMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:workflow" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-trace-id"); got != "trace-workflow-submit-cli" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
}

func TestRunRuntimeWorkflowGetJSON(t *testing.T) {
	service := &cmdTestRuntimeWorkflowService{
		getResponse: &runtimev1.GetWorkflowResponse{
			TaskId: "wf-task-2",
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
	addr, shutdown := startCmdTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeWorkflow([]string{
			"get",
			"--grpc-addr", addr,
			"--task-id", "wf-task-2",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeWorkflow get: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal get output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["task_id"]) != "wf-task-2" {
		t.Fatalf("task id mismatch: %v", payload["task_id"])
	}
	nodes, ok := payload["nodes"].([]any)
	if !ok || len(nodes) != 1 {
		t.Fatalf("nodes mismatch: %#v", payload["nodes"])
	}
	req := service.lastGetRequest()
	if req.GetTaskId() != "wf-task-2" {
		t.Fatalf("task-id mismatch: %s", req.GetTaskId())
	}
}

func TestRunRuntimeWorkflowCancelJSON(t *testing.T) {
	service := &cmdTestRuntimeWorkflowService{
		cancelResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeWorkflow([]string{
			"cancel",
			"--grpc-addr", addr,
			"--task-id", "wf-task-3",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeWorkflow cancel: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal cancel output: %v output=%q", unmarshalErr, output)
	}
	if !payload["ok"].(bool) {
		t.Fatalf("cancel ok mismatch: %#v", payload["ok"])
	}
	req := service.lastCancelRequest()
	if req.GetTaskId() != "wf-task-3" {
		t.Fatalf("task-id mismatch: %s", req.GetTaskId())
	}
}

func TestRunRuntimeWorkflowWatchJSON(t *testing.T) {
	service := &cmdTestRuntimeWorkflowService{
		watchEvents: []*runtimev1.WorkflowEvent{
			{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_STARTED,
				Sequence:   1,
				TaskId:     "wf-task-4",
				TraceId:    "trace-watch-1",
				Timestamp:  timestamppb.Now(),
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
			{
				EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_PROGRESS,
				Sequence:        2,
				TaskId:          "wf-task-4",
				TraceId:         "trace-watch-1",
				NodeId:          "n1",
				ProgressPercent: 60,
				Timestamp:       timestamppb.Now(),
				ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			},
			{
				EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED,
				Sequence:   3,
				TaskId:     "wf-task-4",
				TraceId:    "trace-watch-1",
				Timestamp:  timestamppb.Now(),
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeWorkflowServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeWorkflow([]string{
			"watch",
			"--grpc-addr", addr,
			"--task-id", "wf-task-4",
			"--json",
			"--caller-id", "cli:watcher",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeWorkflow watch: %v", err)
	}

	lines := splitNonEmptyLines(output)
	if len(lines) != 3 {
		t.Fatalf("event line count mismatch: got=%d output=%q", len(lines), output)
	}
	var event map[string]any
	if unmarshalErr := json.Unmarshal([]byte(lines[1]), &event); unmarshalErr != nil {
		t.Fatalf("unmarshal watch output line: %v", unmarshalErr)
	}
	if asString(event["event_type"]) != runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_PROGRESS.String() {
		t.Fatalf("event_type mismatch: %v", event["event_type"])
	}
	md := service.lastWatchMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:watcher" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func startCmdTestRuntimeWorkflowServer(t *testing.T, service runtimev1.RuntimeWorkflowServiceServer) (string, func()) {
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

type cmdTestRuntimeWorkflowService struct {
	runtimev1.UnimplementedRuntimeWorkflowServiceServer

	mu sync.Mutex

	submitMD metadata.MD
	getMD    metadata.MD
	cancelMD metadata.MD
	watchMD  metadata.MD

	submitReq *runtimev1.SubmitWorkflowRequest
	getReq    *runtimev1.GetWorkflowRequest
	cancelReq *runtimev1.CancelWorkflowRequest

	submitResponse *runtimev1.SubmitWorkflowResponse
	getResponse    *runtimev1.GetWorkflowResponse
	cancelResponse *runtimev1.Ack
	watchEvents    []*runtimev1.WorkflowEvent
}

func (s *cmdTestRuntimeWorkflowService) SubmitWorkflow(ctx context.Context, req *runtimev1.SubmitWorkflowRequest) (*runtimev1.SubmitWorkflowResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.submitMD = cloneIncomingMetadata(ctx)
	s.submitReq = req
	if s.submitResponse != nil {
		return s.submitResponse, nil
	}
	return nil, errors.New("submit response not configured")
}

func (s *cmdTestRuntimeWorkflowService) GetWorkflow(ctx context.Context, req *runtimev1.GetWorkflowRequest) (*runtimev1.GetWorkflowResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getMD = cloneIncomingMetadata(ctx)
	s.getReq = req
	if s.getResponse != nil {
		return s.getResponse, nil
	}
	return nil, errors.New("get response not configured")
}

func (s *cmdTestRuntimeWorkflowService) CancelWorkflow(ctx context.Context, req *runtimev1.CancelWorkflowRequest) (*runtimev1.Ack, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancelMD = cloneIncomingMetadata(ctx)
	s.cancelReq = req
	if s.cancelResponse != nil {
		return s.cancelResponse, nil
	}
	return nil, errors.New("cancel response not configured")
}

func (s *cmdTestRuntimeWorkflowService) SubscribeWorkflowEvents(_ *runtimev1.SubscribeWorkflowEventsRequest, stream grpc.ServerStreamingServer[runtimev1.WorkflowEvent]) error {
	s.mu.Lock()
	s.watchMD = cloneIncomingMetadata(stream.Context())
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

func (s *cmdTestRuntimeWorkflowService) lastSubmitRequest() *runtimev1.SubmitWorkflowRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.submitReq == nil {
		return &runtimev1.SubmitWorkflowRequest{}
	}
	return s.submitReq
}

func (s *cmdTestRuntimeWorkflowService) lastGetRequest() *runtimev1.GetWorkflowRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getReq == nil {
		return &runtimev1.GetWorkflowRequest{}
	}
	return s.getReq
}

func (s *cmdTestRuntimeWorkflowService) lastCancelRequest() *runtimev1.CancelWorkflowRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancelReq == nil {
		return &runtimev1.CancelWorkflowRequest{}
	}
	return s.cancelReq
}

func (s *cmdTestRuntimeWorkflowService) lastSubmitMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.submitMD.Copy()
}

func (s *cmdTestRuntimeWorkflowService) lastWatchMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.watchMD.Copy()
}

func writeWorkflowDefinitionFile(t *testing.T, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "workflow-definition-*.json")
	if err != nil {
		t.Fatalf("create temp definition file: %v", err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatalf("write temp definition file: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close temp definition file: %v", err)
	}
	return file.Name()
}
