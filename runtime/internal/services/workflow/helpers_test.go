package workflow

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestValidateDefinitionRejectsDuplicateInputSlot(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "slot.dup",
		Nodes: []*runtimev1.WorkflowNode{
			templateNode("source"),
			templateNode("target"),
		},
		Edges: []*runtimev1.WorkflowEdge{
			{FromNodeId: "source", FromOutput: "output", ToNodeId: "target", ToInput: "input"},
			{FromNodeId: "source", FromOutput: "text", ToNodeId: "target", ToInput: "input"},
		},
	}

	graph, reason := validateDefinition(def)
	if graph != nil {
		t.Fatalf("expected nil graph for duplicate slot bindings")
	}
	if reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got=%v", reason)
	}
}

func TestValidateDefinitionRejectsCycle(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "cycle.invalid",
		Nodes: []*runtimev1.WorkflowNode{
			templateNode("a"),
			templateNode("b"),
		},
		Edges: []*runtimev1.WorkflowEdge{
			{FromNodeId: "a", FromOutput: "output", ToNodeId: "b", ToInput: "input"},
			{FromNodeId: "b", FromOutput: "output", ToNodeId: "a", ToInput: "input"},
		},
	}

	graph, reason := validateDefinition(def)
	if graph != nil {
		t.Fatalf("expected nil graph for cyclic definition")
	}
	if reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got=%v", reason)
	}
}

func TestValidateDefinitionRejectsMergeNOfMOutOfRange(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "merge.invalid",
		Nodes: []*runtimev1.WorkflowNode{
			templateNode("left"),
			templateNode("right"),
			{
				NodeId:    "merge",
				NodeType:  runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE,
				DependsOn: []string{"left", "right"},
				TypeConfig: &runtimev1.WorkflowNode_MergeConfig{
					MergeConfig: &runtimev1.MergeNodeConfig{
						Strategy:     runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M,
						MinCompleted: 3,
					},
				},
			},
		},
		Edges: []*runtimev1.WorkflowEdge{
			{FromNodeId: "left", FromOutput: "output", ToNodeId: "merge", ToInput: "left"},
			{FromNodeId: "right", FromOutput: "output", ToNodeId: "merge", ToInput: "right"},
		},
	}

	graph, reason := validateDefinition(def)
	if graph != nil {
		t.Fatalf("expected nil graph for invalid n-of-m definition")
	}
	if reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
		t.Fatalf("expected AI_INPUT_INVALID, got=%v", reason)
	}
}

func TestValidateDefinitionAcceptsExtractEdgeBinding(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "extract.valid",
		Nodes: []*runtimev1.WorkflowNode{
			templateNode("source"),
			{
				NodeId:   "extract",
				NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT,
				TypeConfig: &runtimev1.WorkflowNode_ExtractConfig{
					ExtractConfig: &runtimev1.ExtractNodeConfig{
						SourceInput: "payload",
						JsonPath:    "$.text",
					},
				},
			},
		},
		Edges: []*runtimev1.WorkflowEdge{
			{FromNodeId: "source", FromOutput: "output", ToNodeId: "extract", ToInput: "payload"},
		},
	}

	graph, reason := validateDefinition(def)
	if reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected valid definition, got=%v", reason)
	}
	if graph == nil {
		t.Fatalf("graph must not be nil")
	}
	binding, ok := graph.InputBinding["extract"]["payload"]
	if !ok {
		t.Fatalf("extract payload binding missing")
	}
	if binding.FromNodeID != "source" || binding.FromOutput != "output" {
		t.Fatalf("unexpected extract binding: %+v", binding)
	}
}

func templateNode(nodeID string) *runtimev1.WorkflowNode {
	return &runtimev1.WorkflowNode{
		NodeId:   nodeID,
		NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
		TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
			TemplateConfig: &runtimev1.TemplateNodeConfig{
				Template: nodeID,
			},
		},
	}
}
