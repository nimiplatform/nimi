package workflow

import (
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
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
	if reason != runtimev1.ReasonCode_WF_DAG_INVALID {
		t.Fatalf("expected WF_DAG_INVALID, got=%v", reason)
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
	if reason != runtimev1.ReasonCode_WF_DAG_INVALID {
		t.Fatalf("expected WF_DAG_INVALID, got=%v", reason)
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
	if reason != runtimev1.ReasonCode_WF_NODE_CONFIG_MISMATCH {
		t.Fatalf("expected WF_NODE_CONFIG_MISMATCH, got=%v", reason)
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

func TestValidateDefinitionRejectsRetryConfigUntilImplemented(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "retry.unimplemented",
		Nodes: []*runtimev1.WorkflowNode{
			{
				NodeId:           "template",
				NodeType:         runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE,
				RetryMaxAttempts: 3,
				RetryBackoff:     "2s",
				TypeConfig: &runtimev1.WorkflowNode_TemplateConfig{
					TemplateConfig: &runtimev1.TemplateNodeConfig{Template: "hello"},
				},
			},
		},
	}

	graph, reason := validateDefinition(def)
	if graph != nil {
		t.Fatalf("expected retry-config workflow to be rejected")
	}
	if reason != runtimev1.ReasonCode_WF_NODE_CONFIG_MISMATCH {
		t.Fatalf("expected WF_NODE_CONFIG_MISMATCH, got=%v", reason)
	}
}

func TestValidateDefinitionRejectsTransformScriptUntilImplemented(t *testing.T) {
	def := &runtimev1.WorkflowDefinition{
		WorkflowType: "script.unimplemented",
		Nodes: []*runtimev1.WorkflowNode{
			{
				NodeId:   "script",
				NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_SCRIPT,
				TypeConfig: &runtimev1.WorkflowNode_ScriptConfig{
					ScriptConfig: &runtimev1.ScriptNodeConfig{
						Runtime: "expr",
						Code:    "1+1",
					},
				},
			},
		},
	}

	graph, reason := validateDefinition(def)
	if graph != nil {
		t.Fatalf("expected transform-script workflow to be rejected")
	}
	if reason != runtimev1.ReasonCode_WF_NODE_CONFIG_MISMATCH {
		t.Fatalf("expected WF_NODE_CONFIG_MISMATCH, got=%v", reason)
	}
}

func TestValidateDefinitionRejectsVoiceWorkflowNodesUntilImplemented(t *testing.T) {
	testCases := []*runtimev1.WorkflowNode{
		{
			NodeId:   "clone-voice",
			NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS_CREATE_VOICE,
			TypeConfig: &runtimev1.WorkflowNode_AiTtsCreateVoiceConfig{
				AiTtsCreateVoiceConfig: &runtimev1.AiTtsCreateVoiceNodeConfig{
					ModelId:       "speech/qwen3-tts",
					WorkflowType:  runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_TTS_V2V,
					TargetModelId: "speech/qwen3-tts",
				},
			},
		},
		{
			NodeId:   "synthesize-voice",
			NodeType: runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS_SYNTHESIZE,
			TypeConfig: &runtimev1.WorkflowNode_AiTtsSynthesizeConfig{
				AiTtsSynthesizeConfig: &runtimev1.AiTtsSynthesizeNodeConfig{
					ModelId: "speech/qwen3-tts",
					Text:    "hello",
				},
			},
		},
	}

	for _, node := range testCases {
		t.Run(node.GetNodeType().String(), func(t *testing.T) {
			graph, reason := validateDefinition(&runtimev1.WorkflowDefinition{
				WorkflowType: "voice.workflow.unimplemented",
				Nodes:        []*runtimev1.WorkflowNode{node},
			})
			if graph != nil {
				t.Fatalf("expected %s workflow to be rejected", node.GetNodeType())
			}
			if reason != runtimev1.ReasonCode_WF_NODE_CONFIG_MISMATCH {
				t.Fatalf("expected WF_NODE_CONFIG_MISMATCH, got=%v", reason)
			}
		})
	}
}

func TestStructFromMapReturnsObservableSentinelForInvalidValues(t *testing.T) {
	value := structFromMap(map[string]any{"invalid": make(chan int)})
	if value == nil {
		t.Fatal("expected non-nil struct")
	}
	if got := value.GetFields()["payload_encode_error"]; got == nil || got.GetStringValue() == "" {
		t.Fatalf("expected payload_encode_error sentinel, got %#v", value.AsMap())
	}
}

func TestFirstInputFallbacksAreDeterministic(t *testing.T) {
	inputs := map[string]*structpb.Struct{
		"z-last":  structFromMap(map[string]any{"value": "zeta"}),
		"a-first": structFromMap(map[string]any{"value": "alpha"}),
	}
	if got := firstInputString(inputs); got != "alpha" {
		t.Fatalf("firstInputString() = %q, want alpha", got)
	}

	listInputs := map[string]*structpb.Struct{
		"z-last":  structFromMap(map[string]any{"values": []any{"zeta"}}),
		"a-first": structFromMap(map[string]any{"values": []any{"alpha"}}),
	}
	got := firstInputStrings(listInputs)
	if len(got) != 1 || got[0] != "alpha" {
		t.Fatalf("firstInputStrings() = %#v, want [alpha]", got)
	}
}

func TestWriteArtifactRejectsEmptyContent(t *testing.T) {
	svc := New(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		WithArtifactRoot(t.TempDir()),
	)
	record := &taskRecord{TaskID: "task-1"}
	node := &runtimev1.WorkflowNode{NodeId: "node-1"}

	if _, err := svc.writeArtifact(record, node, "artifact", "text/plain", nil); err == nil {
		t.Fatal("expected empty artifact content to fail")
	}
}

func TestCloneTaskDeepClonesWorkflowGraph(t *testing.T) {
	original := &taskRecord{
		TaskID: "task-graph",
		Graph: &workflowGraph{
			Order: []string{"a"},
			NodeByID: map[string]*runtimev1.WorkflowNode{
				"a": templateNode("a"),
			},
			Upstream:   map[string][]string{"a": {}},
			Downstream: map[string][]string{"a": {"b"}},
			Incoming: map[string][]*runtimev1.WorkflowEdge{
				"a": {
					{FromNodeId: "root", FromOutput: "output", ToNodeId: "a", ToInput: "input"},
				},
			},
			Outgoing: map[string][]*runtimev1.WorkflowEdge{
				"a": {
					{FromNodeId: "a", FromOutput: "output", ToNodeId: "b", ToInput: "input"},
				},
			},
			InputBinding: map[string]map[string]edgeBinding{
				"a": {"input": {FromNodeID: "root", FromOutput: "output"}},
			},
		},
	}

	cloned := cloneTask(original)
	if cloned == nil || cloned.Graph == nil {
		t.Fatal("expected cloned task graph")
	}
	if cloned.Graph == original.Graph {
		t.Fatal("expected workflow graph to be deep cloned")
	}
	cloned.Graph.Order[0] = "mutated"
	cloned.Graph.NodeByID["a"].NodeId = "mutated"
	cloned.Graph.Incoming["a"][0].FromNodeId = "mutated"
	cloned.Graph.InputBinding["a"]["input"] = edgeBinding{FromNodeID: "mutated", FromOutput: "mutated"}

	if original.Graph.Order[0] != "a" {
		t.Fatalf("original graph order was mutated: %#v", original.Graph.Order)
	}
	if original.Graph.NodeByID["a"].GetNodeId() != "a" {
		t.Fatalf("original graph node was mutated: %#v", original.Graph.NodeByID["a"])
	}
	if original.Graph.Incoming["a"][0].GetFromNodeId() != "root" {
		t.Fatalf("original graph edge was mutated: %#v", original.Graph.Incoming["a"][0])
	}
	if binding := original.Graph.InputBinding["a"]["input"]; binding.FromNodeID != "root" || binding.FromOutput != "output" {
		t.Fatalf("original graph input binding was mutated: %#v", binding)
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
