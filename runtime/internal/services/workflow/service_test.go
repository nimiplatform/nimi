package workflow

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func TestWorkflowSubmitGetSubscribe(t *testing.T) {
	aiClient := &fakeRuntimeAIClient{
		executeScenarioFn: func(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
			return &runtimev1.ExecuteScenarioResponse{
				Output: &runtimev1.ScenarioOutput{
					Output: &runtimev1.ScenarioOutput_TextGenerate{
						TextGenerate: &runtimev1.TextGenerateOutput{Text: "generated"},
					},
				},
			}, nil
		},
	}
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), WithAIClient(aiClient))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "image.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "n1",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "hello world"},
					},
				},
				{
					NodeId:   "n2",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE,
					TypeConfig: &runtimev1.WorkflowNode_AiGenerateConfig{
						AiGenerateConfig: &runtimev1.AiGenerateNodeConfig{Prompt: ""},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "n1", FromOutput: "text", ToNodeId: "n2", ToInput: "prompt"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	if !submitResp.GetAccepted() || submitResp.GetTaskId() == "" {
		t.Fatalf("submit response invalid: %+v", submitResp)
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("workflow must complete, got %v", statusResp.GetStatus())
	}
	if len(statusResp.GetNodes()) != 2 {
		t.Fatalf("expected 2 nodes")
	}
	for _, node := range statusResp.GetNodes() {
		if node.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
			t.Fatalf("node must be completed: %+v", node)
		}
	}

	stream := &workflowEventCollector{ctx: context.Background()}
	if err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{
		TaskId: submitResp.GetTaskId(),
	}, stream); err != nil {
		t.Fatalf("subscribe workflow events: %v", err)
	}
	if len(stream.events) < 3 {
		t.Fatalf("expected >= 3 events, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.WorkflowEventType_WORKFLOW_EVENT_STARTED {
		t.Fatalf("first event must be started")
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED {
		t.Fatalf("last event must be completed, got %v", last.GetEventType())
	}
	for idx, event := range stream.events {
		expected := uint64(idx + 1)
		if event.GetSequence() != expected {
			t.Fatalf("event sequence must be contiguous: got=%d expected=%d", event.GetSequence(), expected)
		}
	}
}

func TestWorkflowBranchSkipAndMergeAny(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "branch.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "20"},
					},
				},
				{
					NodeId:   "branch",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH,
					TypeConfig: &runtimev1.WorkflowNode_BranchConfig{
						BranchConfig: &runtimev1.BranchNodeConfig{
							Condition:   "$.text > 10",
							TrueTarget:  "fast",
							FalseTarget: "slow",
						},
					},
				},
				{
					NodeId:    "fast",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "fast lane"},
					},
				},
				{
					NodeId:    "slow",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "slow lane"},
					},
				},
				{
					NodeId:    "merge",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
					DependsOn: []string{"fast", "slow"},
					TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
						MergeConfig: &runtimev1.MergeNodeConfig{Strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ANY},
					},
				},
				{
					NodeId:    "final",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT,
					DependsOn: []string{"merge"},
					TypeConfig: &runtimev1.WorkflowNode_ExtractConfig{
						ExtractConfig: &runtimev1.ExtractNodeConfig{SourceInput: "fast", JsonPath: "$.text"},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "output", ToNodeId: "branch", ToInput: "data"},
				{FromNodeId: "fast", FromOutput: "output", ToNodeId: "merge", ToInput: "fast"},
				{FromNodeId: "slow", FromOutput: "output", ToNodeId: "merge", ToInput: "slow"},
				{FromNodeId: "merge", FromOutput: "fast", ToNodeId: "final", ToInput: "fast"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	if !submitResp.GetAccepted() {
		t.Fatalf("workflow must be accepted")
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("workflow must be completed, got=%v", statusResp.GetStatus())
	}
	statusByNode := map[string]runtimev1.WorkflowStatus{}
	for _, node := range statusResp.GetNodes() {
		statusByNode[node.GetNodeId()] = node.GetStatus()
	}
	if statusByNode["slow"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		t.Fatalf("slow node should be skipped, got=%v", statusByNode["slow"])
	}
	if statusByNode["merge"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("merge node should complete, got=%v", statusByNode["merge"])
	}
	if statusByNode["final"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("final node should complete, got=%v", statusByNode["final"])
	}

	stream := &workflowEventCollector{ctx: context.Background()}
	if err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{TaskId: submitResp.GetTaskId()}, stream); err != nil {
		t.Fatalf("subscribe workflow events: %v", err)
	}
	hasSkippedEvent := false
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_SKIPPED && event.GetNodeId() == "slow" {
			hasSkippedEvent = true
			break
		}
	}
	if !hasSkippedEvent {
		t.Fatalf("expected skipped event for slow node")
	}
}

func TestWorkflowBranchFalseSkipAndMergeAny(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "branch.false.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "2"},
					},
				},
				{
					NodeId:   "branch",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH,
					TypeConfig: &runtimev1.WorkflowNode_BranchConfig{
						BranchConfig: &runtimev1.BranchNodeConfig{
							Condition:   "$.text > 10",
							TrueTarget:  "fast",
							FalseTarget: "slow",
						},
					},
				},
				{
					NodeId:    "fast",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "fast lane"},
					},
				},
				{
					NodeId:    "slow",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "slow lane"},
					},
				},
				{
					NodeId:    "merge",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
					DependsOn: []string{"fast", "slow"},
					TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
						MergeConfig: &runtimev1.MergeNodeConfig{Strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ANY},
					},
				},
				{
					NodeId:    "final",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_NOOP,
					DependsOn: []string{"merge"},
					TypeConfig: &runtimev1.WorkflowNode_NoopConfig{
						NoopConfig: &runtimev1.NoopNodeConfig{},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "output", ToNodeId: "branch", ToInput: "data"},
				{FromNodeId: "fast", FromOutput: "output", ToNodeId: "merge", ToInput: "fast"},
				{FromNodeId: "slow", FromOutput: "output", ToNodeId: "merge", ToInput: "slow"},
				{FromNodeId: "merge", FromOutput: "output", ToNodeId: "final", ToInput: "input"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	if !submitResp.GetAccepted() {
		t.Fatalf("workflow must be accepted")
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	statusByNode := map[string]runtimev1.WorkflowStatus{}
	for _, node := range statusResp.GetNodes() {
		statusByNode[node.GetNodeId()] = node.GetStatus()
	}
	if statusByNode["fast"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		t.Fatalf("fast node should be skipped, got=%v", statusByNode["fast"])
	}
	if statusByNode["slow"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("slow node should be completed, got=%v", statusByNode["slow"])
	}
	if statusByNode["merge"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("merge node should be completed, got=%v", statusByNode["merge"])
	}

	stream := &workflowEventCollector{ctx: context.Background()}
	if err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{TaskId: submitResp.GetTaskId()}, stream); err != nil {
		t.Fatalf("subscribe workflow events: %v", err)
	}
	hasSkippedFast := false
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_SKIPPED && event.GetNodeId() == "fast" {
			hasSkippedFast = true
			break
		}
	}
	if !hasSkippedFast {
		t.Fatalf("expected skipped event for fast node")
	}
}

func TestWorkflowMergeAllFailsWhenBranchSkipsPath(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "merge.all.fail.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "20"},
					},
				},
				{
					NodeId:   "branch",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH,
					TypeConfig: &runtimev1.WorkflowNode_BranchConfig{
						BranchConfig: &runtimev1.BranchNodeConfig{
							Condition:   "$.text > 10",
							TrueTarget:  "fast",
							FalseTarget: "slow",
						},
					},
				},
				{
					NodeId:    "fast",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "fast lane"},
					},
				},
				{
					NodeId:    "slow",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "slow lane"},
					},
				},
				{
					NodeId:    "merge",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
					DependsOn: []string{"fast", "slow"},
					TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
						MergeConfig: &runtimev1.MergeNodeConfig{Strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ALL},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "output", ToNodeId: "branch", ToInput: "data"},
				{FromNodeId: "fast", FromOutput: "output", ToNodeId: "merge", ToInput: "fast"},
				{FromNodeId: "slow", FromOutput: "output", ToNodeId: "merge", ToInput: "slow"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED, 3*time.Second)
	statusByNode := map[string]runtimev1.WorkflowStatus{}
	for _, node := range statusResp.GetNodes() {
		statusByNode[node.GetNodeId()] = node.GetStatus()
	}
	if statusByNode["slow"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		t.Fatalf("slow node should be skipped, got=%v", statusByNode["slow"])
	}
	if statusByNode["merge"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED {
		t.Fatalf("merge node should fail under ALL strategy, got=%v", statusByNode["merge"])
	}

	stream := &workflowEventCollector{ctx: context.Background()}
	if err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{TaskId: submitResp.GetTaskId()}, stream); err != nil {
		t.Fatalf("subscribe workflow events: %v", err)
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.WorkflowEventType_WORKFLOW_EVENT_FAILED {
		t.Fatalf("last event should be failed, got=%v", last.GetEventType())
	}
}

func TestWorkflowMergeNOfMSucceeds(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "merge.nofm.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "source",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "20"},
					},
				},
				{
					NodeId:   "branch",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH,
					TypeConfig: &runtimev1.WorkflowNode_BranchConfig{
						BranchConfig: &runtimev1.BranchNodeConfig{
							Condition:   "$.text > 10",
							TrueTarget:  "fast",
							FalseTarget: "slow",
						},
					},
				},
				{
					NodeId:    "fast",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "fast lane"},
					},
				},
				{
					NodeId:    "slow",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "slow lane"},
					},
				},
				{
					NodeId:    "extra",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"branch"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "extra lane"},
					},
				},
				{
					NodeId:    "merge",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
					DependsOn: []string{"fast", "slow", "extra"},
					TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
						MergeConfig: &runtimev1.MergeNodeConfig{
							Strategy:     runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M,
							MinCompleted: 2,
						},
					},
				},
				{
					NodeId:    "final",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT,
					DependsOn: []string{"merge"},
					TypeConfig: &runtimev1.WorkflowNode_ExtractConfig{
						ExtractConfig: &runtimev1.ExtractNodeConfig{
							SourceInput: "fast",
							JsonPath:    "$.text",
						},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{
				{FromNodeId: "source", FromOutput: "output", ToNodeId: "branch", ToInput: "data"},
				{FromNodeId: "fast", FromOutput: "output", ToNodeId: "merge", ToInput: "fast"},
				{FromNodeId: "slow", FromOutput: "output", ToNodeId: "merge", ToInput: "slow"},
				{FromNodeId: "extra", FromOutput: "output", ToNodeId: "merge", ToInput: "extra"},
				{FromNodeId: "merge", FromOutput: "fast", ToNodeId: "final", ToInput: "fast"},
			},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	if !submitResp.GetAccepted() {
		t.Fatalf("workflow must be accepted")
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	statusByNode := map[string]runtimev1.WorkflowStatus{}
	for _, node := range statusResp.GetNodes() {
		statusByNode[node.GetNodeId()] = node.GetStatus()
	}
	if statusByNode["slow"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		t.Fatalf("slow node should be skipped, got=%v", statusByNode["slow"])
	}
	if statusByNode["merge"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("merge node should complete under N_OF_M, got=%v", statusByNode["merge"])
	}
	if statusByNode["final"] != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
		t.Fatalf("final node should complete, got=%v", statusByNode["final"])
	}
}

func TestWorkflowCancel(t *testing.T) {
	aiClient := &fakeRuntimeAIClient{
		executeScenarioFn: func(ctx context.Context, _ *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(400 * time.Millisecond):
				return &runtimev1.ExecuteScenarioResponse{
					Output: &runtimev1.ScenarioOutput{
						Output: &runtimev1.ScenarioOutput_TextGenerate{
							TextGenerate: &runtimev1.TextGenerateOutput{Text: "ok"},
						},
					},
				}, nil
			}
		},
	}
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), WithAIClient(aiClient))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition: &runtimev1.WorkflowDefinition{
			WorkflowType: "cancel.pipeline",
			Nodes: []*runtimev1.WorkflowNode{
				{
					NodeId:   "n1",
					NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE,
					TypeConfig: &runtimev1.WorkflowNode_AiGenerateConfig{
						AiGenerateConfig: &runtimev1.AiGenerateNodeConfig{Prompt: "sleep"},
					},
				},
				{
					NodeId:    "n2",
					NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
					DependsOn: []string{"n1"},
					TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
						TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "done"},
					},
				},
			},
			Edges: []*runtimev1.WorkflowEdge{{FromNodeId: "n1", FromOutput: "text", ToNodeId: "n2", ToInput: "text"}},
		},
		TimeoutMs: 30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}
	if !submitResp.GetAccepted() {
		t.Fatalf("workflow must be accepted")
	}

	_ = waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING, 2*time.Second)
	cancelResp, err := svc.CancelWorkflow(ctx, &runtimev1.CancelWorkflowRequest{TaskId: submitResp.GetTaskId()})
	if err != nil {
		t.Fatalf("cancel workflow: %v", err)
	}
	if !cancelResp.GetOk() {
		t.Fatalf("cancel must return ok")
	}

	statusResp := waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED, 3*time.Second)
	if statusResp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED {
		t.Fatalf("workflow must be canceled, got %v", statusResp.GetStatus())
	}
}

func waitWorkflowStatus(t *testing.T, svc *Service, taskID string, want runtimev1.WorkflowStatus, timeout time.Duration) *runtimev1.GetWorkflowResponse {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetWorkflow(context.Background(), &runtimev1.GetWorkflowRequest{TaskId: taskID})
		if err != nil {
			t.Fatalf("get workflow: %v", err)
		}
		if resp.GetStatus() == want {
			return resp
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetWorkflow(context.Background(), &runtimev1.GetWorkflowRequest{TaskId: taskID})
	if err != nil {
		t.Fatalf("get workflow: %v", err)
	}
	t.Fatalf("workflow status timeout, want=%v got=%v", want, resp.GetStatus())
	return nil
}

type workflowEventCollector struct {
	ctx    context.Context
	events []*runtimev1.WorkflowEvent
}

func (s *workflowEventCollector) Send(event *runtimev1.WorkflowEvent) error {
	cloned := proto.Clone(event)
	copy, ok := cloned.(*runtimev1.WorkflowEvent)
	if !ok {
		copy = &runtimev1.WorkflowEvent{}
	}
	s.events = append(s.events, copy)
	return nil
}

func (s *workflowEventCollector) SetHeader(metadata.MD) error  { return nil }
func (s *workflowEventCollector) SendHeader(metadata.MD) error { return nil }
func (s *workflowEventCollector) SetTrailer(metadata.MD)       {}
func (s *workflowEventCollector) Context() context.Context     { return s.ctx }
func (s *workflowEventCollector) SendMsg(any) error            { return nil }
func (s *workflowEventCollector) RecvMsg(any) error            { return nil }

type blockingWorkflowEventCollector struct {
	ctx    context.Context
	gate   chan struct{}
	once   sync.Once
	mu     sync.Mutex
	events []*runtimev1.WorkflowEvent
}

func (s *blockingWorkflowEventCollector) Send(event *runtimev1.WorkflowEvent) error {
	s.once.Do(func() {
		<-s.gate
	})
	cloned := proto.Clone(event)
	copy, ok := cloned.(*runtimev1.WorkflowEvent)
	if !ok {
		copy = &runtimev1.WorkflowEvent{}
	}
	s.mu.Lock()
	s.events = append(s.events, copy)
	s.mu.Unlock()
	return nil
}

func (s *blockingWorkflowEventCollector) SetHeader(metadata.MD) error  { return nil }
func (s *blockingWorkflowEventCollector) SendHeader(metadata.MD) error { return nil }
func (s *blockingWorkflowEventCollector) SetTrailer(metadata.MD)       {}
func (s *blockingWorkflowEventCollector) Context() context.Context     { return s.ctx }
func (s *blockingWorkflowEventCollector) SendMsg(any) error            { return nil }
func (s *blockingWorkflowEventCollector) RecvMsg(any) error            { return nil }

func TestGetWorkflowNotFoundReasonCode(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.GetWorkflow(context.Background(), &runtimev1.GetWorkflowRequest{TaskId: "nonexistent"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_WF_TASK_NOT_FOUND {
		t.Fatalf("expected WF_TASK_NOT_FOUND, got %v", resp.GetReasonCode())
	}
	if resp.GetStatus() != runtimev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED {
		t.Fatalf("expected UNSPECIFIED status, got %v", resp.GetStatus())
	}
}

func TestCancelWorkflowNotFoundReasonCode(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.CancelWorkflow(context.Background(), &runtimev1.CancelWorkflowRequest{TaskId: "nonexistent"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_WF_TASK_NOT_FOUND {
		t.Fatalf("expected WF_TASK_NOT_FOUND, got %v", resp.GetReasonCode())
	}
	if resp.GetOk() {
		t.Fatal("expected ok=false for not found task")
	}
}

func TestSubscribeWorkflowEventsNotFoundReasonCode(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &workflowEventCollector{ctx: context.Background()}
	err := svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{TaskId: "nonexistent"}, stream)
	if err == nil {
		t.Fatal("expected error for nonexistent task")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %v", st.Code())
	}
}

func TestSubscribeWorkflowEventsTerminalEventPriority(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	submitResp, err := svc.SubmitWorkflow(ctx, &runtimev1.SubmitWorkflowRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		Definition:    longWorkflowDefinition(20),
		TimeoutMs:     30_000,
	})
	if err != nil {
		t.Fatalf("submit workflow: %v", err)
	}

	stream := &blockingWorkflowEventCollector{
		ctx:  context.Background(),
		gate: make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeWorkflowEvents(&runtimev1.SubscribeWorkflowEventsRequest{TaskId: submitResp.GetTaskId()}, stream)
	}()

	waitWorkflowStatus(t, svc, submitResp.GetTaskId(), runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 3*time.Second)
	close(stream.gate)

	err = <-done
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected resource exhausted, got %v", err)
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()
	if len(stream.events) == 0 {
		t.Fatal("expected delivered events before close")
	}
	hasTerminal := false
	for _, event := range stream.events {
		if isTerminalEvent(event.GetEventType()) {
			hasTerminal = true
			break
		}
	}
	if !hasTerminal {
		t.Fatal("expected terminal event to be retained under backpressure")
	}
}

type fakeRuntimeAIClient struct {
	executeScenarioFn func(context.Context, *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error)
}

func (f *fakeRuntimeAIClient) ExecuteScenario(ctx context.Context, req *runtimev1.ExecuteScenarioRequest, _ ...grpc.CallOption) (*runtimev1.ExecuteScenarioResponse, error) {
	if f.executeScenarioFn == nil {
		return nil, errors.New("execute scenario not configured")
	}
	return f.executeScenarioFn(ctx, req)
}

func (f *fakeRuntimeAIClient) StreamScenario(context.Context, *runtimev1.StreamScenarioRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.StreamScenarioEvent], error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest, ...grpc.CallOption) (*runtimev1.SubmitScenarioJobResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest, ...grpc.CallOption) (*runtimev1.GetScenarioJobResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) CancelScenarioJob(context.Context, *runtimev1.CancelScenarioJobRequest, ...grpc.CallOption) (*runtimev1.CancelScenarioJobResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) SubscribeScenarioJobEvents(context.Context, *runtimev1.SubscribeScenarioJobEventsRequest, ...grpc.CallOption) (grpc.ServerStreamingClient[runtimev1.ScenarioJobEvent], error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest, ...grpc.CallOption) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) ListScenarioProfiles(context.Context, *runtimev1.ListScenarioProfilesRequest, ...grpc.CallOption) (*runtimev1.ListScenarioProfilesResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) GetVoiceAsset(context.Context, *runtimev1.GetVoiceAssetRequest, ...grpc.CallOption) (*runtimev1.GetVoiceAssetResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) ListVoiceAssets(context.Context, *runtimev1.ListVoiceAssetsRequest, ...grpc.CallOption) (*runtimev1.ListVoiceAssetsResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) DeleteVoiceAsset(context.Context, *runtimev1.DeleteVoiceAssetRequest, ...grpc.CallOption) (*runtimev1.DeleteVoiceAssetResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) ListPresetVoices(context.Context, *runtimev1.ListPresetVoicesRequest, ...grpc.CallOption) (*runtimev1.ListPresetVoicesResponse, error) {
	return nil, status.Error(12, "unimplemented")
}

func (f *fakeRuntimeAIClient) UploadArtifact(context.Context, ...grpc.CallOption) (grpc.ClientStreamingClient[runtimev1.UploadArtifactRequest, runtimev1.UploadArtifactResponse], error) {
	return nil, status.Error(12, "unimplemented")
}

func longWorkflowDefinition(nodes int) *runtimev1.WorkflowDefinition {
	definition := &runtimev1.WorkflowDefinition{
		WorkflowType: "long.pipeline",
		Nodes:        make([]*runtimev1.WorkflowNode, 0, nodes),
	}
	for i := 0; i < nodes; i++ {
		nodeID := fmt.Sprintf("n%d", i)
		node := &runtimev1.WorkflowNode{
			NodeId:   nodeID,
			NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
			TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
				TemplateConfig: &runtimev1.TemplateNodeConfig{Template: nodeID},
			},
		}
		if i > 0 {
			node.DependsOn = []string{fmt.Sprintf("n%d", i-1)}
		}
		definition.Nodes = append(definition.Nodes, node)
	}
	return definition
}
