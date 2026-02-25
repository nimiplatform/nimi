package workflow

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteExtractNodeJSONPath(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	node := &runtimev1.WorkflowNode{
		NodeId:   "extract",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT,
		TypeConfig: &runtimev1.WorkflowNode_ExtractConfig{
			ExtractConfig: &runtimev1.ExtractNodeConfig{
				SourceInput: "payload",
				JsonPath:    "$.items[0].name",
			},
		},
	}

	outputs, err := svc.executeExtractNode(node, map[string]*structpb.Struct{
		"payload": structFromMap(map[string]any{
			"items": []any{
				map[string]any{"name": "nimi"},
			},
		}),
	})
	if err != nil {
		t.Fatalf("execute extract: %v", err)
	}
	if outputs["output"].AsMap()["value"] != "nimi" {
		t.Fatalf("unexpected extract output: %v", outputs["output"].AsMap())
	}
	if outputs["text"].AsMap()["value"] != "nimi" {
		t.Fatalf("unexpected extract text output: %v", outputs["text"].AsMap())
	}
}

func TestExecuteTemplateNodeRendering(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	node := &runtimev1.WorkflowNode{
		NodeId:   "template",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
		TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
			TemplateConfig: &runtimev1.TemplateNodeConfig{
				Template:       "hello {{profile.name}} from {{meta.region}}",
				OutputMimeType: "text/plain",
			},
		},
	}

	outputs, err := svc.executeTemplateNode(node, map[string]*structpb.Struct{
		"profile": structFromMap(map[string]any{"name": "nimi"}),
		"meta":    structFromMap(map[string]any{"region": "cn"}),
	})
	if err != nil {
		t.Fatalf("execute template: %v", err)
	}
	if outputs["text"].AsMap()["value"] != "hello nimi from cn" {
		t.Fatalf("template rendered output mismatch: %v", outputs["text"].AsMap())
	}
}

func TestExecuteScriptNodeUsesWorkerProtocol(t *testing.T) {
	fake := &fakeScriptWorkerClient{
		resp: &runtimev1.ExecuteResponse{
			Success: true,
			Output:  structFromMap(map[string]any{"text": "script-ok"}),
		},
	}
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithScriptWorkerClient(fake),
	)

	record := &taskRecord{
		TaskID:        "task-script-1",
		AppID:         "nimi.desktop",
		SubjectUserID: "user-001",
	}
	node := &runtimev1.WorkflowNode{
		NodeId:   "script",
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_SCRIPT,
		TypeConfig: &runtimev1.WorkflowNode_ScriptConfig{
			ScriptConfig: &runtimev1.ScriptNodeConfig{
				Runtime:          "expr",
				Code:             "1 + 1",
				TimeoutMs:        1200,
				MemoryLimitBytes: 1024,
			},
		},
	}
	inputs := map[string]*structpb.Struct{
		"data": structFromMap(map[string]any{"value": "hello"}),
	}

	outputs, err := svc.executeScriptNode(context.Background(), record, node, inputs)
	if err != nil {
		t.Fatalf("execute script node: %v", err)
	}
	if fake.lastReq == nil {
		t.Fatalf("script worker execute request was not captured")
	}
	if fake.lastReq.GetTaskId() != record.TaskID || fake.lastReq.GetNodeId() != node.GetNodeId() {
		t.Fatalf("script worker request task/node mismatch: %+v", fake.lastReq)
	}
	if fake.lastReq.GetRuntime() != "expr" || fake.lastReq.GetCode() != "1 + 1" {
		t.Fatalf("script worker request runtime/code mismatch: %+v", fake.lastReq)
	}
	if got := outputs["text"].AsMap()["value"]; got != "script-ok" {
		t.Fatalf("script output mismatch: %v", got)
	}
}

func TestExecuteMergeNodeStrategies(t *testing.T) {
	testCases := []struct {
		name       string
		strategy   runtimev1.MergeStrategy
		minDone    int32
		statusByID map[string]runtimev1.WorkflowStatus
		wantErr    bool
	}{
		{
			name:     "all-success",
			strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ALL,
			statusByID: map[string]runtimev1.WorkflowStatus{
				"a": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"b": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"c": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
			},
		},
		{
			name:     "all-fail",
			strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ALL,
			statusByID: map[string]runtimev1.WorkflowStatus{
				"a": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"b": runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED,
				"c": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
			},
			wantErr: true,
		},
		{
			name:     "any-success",
			strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_ANY,
			statusByID: map[string]runtimev1.WorkflowStatus{
				"a": runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED,
				"b": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"c": runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED,
			},
		},
		{
			name:     "n-of-m-success",
			strategy: runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M,
			minDone:  2,
			statusByID: map[string]runtimev1.WorkflowStatus{
				"a": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"b": runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
				"c": runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
			taskID := "task-" + tc.name

			nodes := map[string]*runtimev1.WorkflowNodeStatus{
				"merge": {NodeId: "merge", Status: runtimev1.WorkflowStatus_WORKFLOW_STATUS_QUEUED},
			}
			for nodeID, statusValue := range tc.statusByID {
				nodes[nodeID] = &runtimev1.WorkflowNodeStatus{
					NodeId: nodeID,
					Status: statusValue,
				}
			}
			graph := &workflowGraph{
				Upstream: map[string][]string{
					"merge": {"a", "b", "c"},
				},
			}
			record := &taskRecord{
				TaskID: taskID,
				Graph:  graph,
				Nodes:  nodes,
			}

			svc.tasks[taskID] = record
			node := &runtimev1.WorkflowNode{
				NodeId:   "merge",
				NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
				TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
					MergeConfig: &runtimev1.MergeNodeConfig{
						Strategy:     tc.strategy,
						MinCompleted: tc.minDone,
					},
				},
			}

			outputs, err := svc.executeMergeNode(record, node, map[string]*structpb.Struct{
				"a": structFromMap(map[string]any{"value": "A"}),
				"b": structFromMap(map[string]any{"value": "B"}),
				"c": structFromMap(map[string]any{"value": "C"}),
			})
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected merge error for strategy=%v", tc.strategy)
				}
				return
			}
			if err != nil {
				t.Fatalf("execute merge: %v", err)
			}
			if outputs["output"] == nil {
				t.Fatalf("merge output missing")
			}
		})
	}
}

type fakeScriptWorkerClient struct {
	lastReq *runtimev1.ExecuteRequest
	resp    *runtimev1.ExecuteResponse
	err     error
}

func (f *fakeScriptWorkerClient) Execute(_ context.Context, req *runtimev1.ExecuteRequest, _ ...grpc.CallOption) (*runtimev1.ExecuteResponse, error) {
	cloned := proto.Clone(req)
	copied, ok := cloned.(*runtimev1.ExecuteRequest)
	if !ok {
		copied = &runtimev1.ExecuteRequest{}
	}
	f.lastReq = copied
	if f.err != nil {
		return nil, f.err
	}
	if f.resp != nil {
		return f.resp, nil
	}
	return &runtimev1.ExecuteResponse{
		Success: true,
		Output:  structFromMap(map[string]any{}),
	}, nil
}
