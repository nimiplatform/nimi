package workflow

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
)

func workflowContext(appID string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", appID))
}

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

	stream := &workflowEventCollector{ctx: workflowContext("nimi.desktop")}
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

	stream := &workflowEventCollector{ctx: workflowContext("nimi.desktop")}
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

	stream := &workflowEventCollector{ctx: workflowContext("nimi.desktop")}
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

	stream := &workflowEventCollector{ctx: workflowContext("nimi.desktop")}
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
