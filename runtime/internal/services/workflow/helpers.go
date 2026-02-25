package workflow

import (
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type edgeBinding struct {
	FromNodeID string
	FromOutput string
}

type workflowGraph struct {
	Order        []string
	NodeByID     map[string]*runtimev1.WorkflowNode
	Upstream     map[string][]string
	Downstream   map[string][]string
	Incoming     map[string][]*runtimev1.WorkflowEdge
	Outgoing     map[string][]*runtimev1.WorkflowEdge
	InputBinding map[string]map[string]edgeBinding
}

func validateDefinition(def *runtimev1.WorkflowDefinition) (*workflowGraph, runtimev1.ReasonCode) {
	if def == nil {
		return nil, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	}
	if strings.TrimSpace(def.GetWorkflowType()) == "" {
		return nil, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	}
	if len(def.GetNodes()) == 0 {
		return nil, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID
	}

	graph := &workflowGraph{
		Order:        make([]string, 0, len(def.GetNodes())),
		NodeByID:     make(map[string]*runtimev1.WorkflowNode, len(def.GetNodes())),
		Upstream:     make(map[string][]string, len(def.GetNodes())),
		Downstream:   make(map[string][]string, len(def.GetNodes())),
		Incoming:     make(map[string][]*runtimev1.WorkflowEdge, len(def.GetNodes())),
		Outgoing:     make(map[string][]*runtimev1.WorkflowEdge, len(def.GetNodes())),
		InputBinding: make(map[string]map[string]edgeBinding, len(def.GetNodes())),
	}

	dependencies := make(map[string]map[string]struct{}, len(def.GetNodes()))

	for _, node := range def.GetNodes() {
		nodeID := strings.TrimSpace(node.GetNodeId())
		if nodeID == "" {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if _, exists := graph.NodeByID[nodeID]; exists {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if node.GetNodeType() == runtimev1.WorkflowNodeType_WORKFLOW_NODE_TYPE_UNSPECIFIED {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		graph.NodeByID[nodeID] = node
		dependencies[nodeID] = map[string]struct{}{}
		graph.Upstream[nodeID] = []string{}
		graph.Downstream[nodeID] = []string{}
		graph.Incoming[nodeID] = []*runtimev1.WorkflowEdge{}
		graph.Outgoing[nodeID] = []*runtimev1.WorkflowEdge{}
		graph.InputBinding[nodeID] = map[string]edgeBinding{}
	}

	for _, node := range def.GetNodes() {
		nodeID := strings.TrimSpace(node.GetNodeId())
		seen := map[string]bool{}
		for _, rawDep := range node.GetDependsOn() {
			depID := strings.TrimSpace(rawDep)
			if depID == "" || depID == nodeID {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if _, exists := graph.NodeByID[depID]; !exists {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if seen[depID] {
				continue
			}
			seen[depID] = true
			dependencies[nodeID][depID] = struct{}{}
		}
	}

	for _, rawEdge := range def.GetEdges() {
		edge := &runtimev1.WorkflowEdge{
			FromNodeId: strings.TrimSpace(rawEdge.GetFromNodeId()),
			FromOutput: strings.TrimSpace(rawEdge.GetFromOutput()),
			ToNodeId:   strings.TrimSpace(rawEdge.GetToNodeId()),
			ToInput:    strings.TrimSpace(rawEdge.GetToInput()),
		}
		if edge.GetFromNodeId() == "" || edge.GetToNodeId() == "" || edge.GetFromOutput() == "" || edge.GetToInput() == "" {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if edge.GetFromNodeId() == edge.GetToNodeId() {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if _, exists := graph.NodeByID[edge.GetFromNodeId()]; !exists {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if _, exists := graph.NodeByID[edge.GetToNodeId()]; !exists {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		if _, exists := graph.InputBinding[edge.GetToNodeId()][edge.GetToInput()]; exists {
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
		graph.InputBinding[edge.GetToNodeId()][edge.GetToInput()] = edgeBinding{FromNodeID: edge.GetFromNodeId(), FromOutput: edge.GetFromOutput()}
		graph.Incoming[edge.GetToNodeId()] = append(graph.Incoming[edge.GetToNodeId()], edge)
		graph.Outgoing[edge.GetFromNodeId()] = append(graph.Outgoing[edge.GetFromNodeId()], edge)
		dependencies[edge.GetToNodeId()][edge.GetFromNodeId()] = struct{}{}
	}

	for nodeID, deps := range dependencies {
		preds := make([]string, 0, len(deps))
		for depID := range deps {
			preds = append(preds, depID)
			graph.Downstream[depID] = append(graph.Downstream[depID], nodeID)
		}
		sort.Strings(preds)
		graph.Upstream[nodeID] = preds
	}
	for nodeID := range graph.Downstream {
		sort.Strings(graph.Downstream[nodeID])
	}
	for nodeID := range graph.Incoming {
		sort.Slice(graph.Incoming[nodeID], func(i, j int) bool {
			left := graph.Incoming[nodeID][i]
			right := graph.Incoming[nodeID][j]
			if left.GetToInput() == right.GetToInput() {
				if left.GetFromNodeId() == right.GetFromNodeId() {
					return left.GetFromOutput() < right.GetFromOutput()
				}
				return left.GetFromNodeId() < right.GetFromNodeId()
			}
			return left.GetToInput() < right.GetToInput()
		})
	}

	inDegree := make(map[string]int, len(graph.NodeByID))
	queue := make([]string, 0, len(graph.NodeByID))
	for nodeID, deps := range graph.Upstream {
		inDegree[nodeID] = len(deps)
		if len(deps) == 0 {
			queue = append(queue, nodeID)
		}
	}
	sort.Strings(queue)

	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		graph.Order = append(graph.Order, nodeID)
		for _, next := range graph.Downstream[nodeID] {
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
		}
		sort.Strings(queue)
	}
	if len(graph.Order) != len(graph.NodeByID) {
		return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
	}

	for _, nodeID := range graph.Order {
		node := graph.NodeByID[nodeID]
		bindings := graph.InputBinding[nodeID]
		switch node.GetNodeType() {
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE:
			if node.GetAiGenerateConfig() == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STREAM:
			if node.GetAiStreamConfig() == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_EMBED:
			cfg := node.GetAiEmbedConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if len(cfg.GetInputs()) == 0 && !hasAnySlot(bindings, "inputs", "input", "text") {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE:
			cfg := node.GetAiImageConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if strings.TrimSpace(cfg.GetPrompt()) == "" && !hasAnySlot(bindings, "prompt", "text") {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO:
			cfg := node.GetAiVideoConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if strings.TrimSpace(cfg.GetPrompt()) == "" && !hasAnySlot(bindings, "prompt", "text") {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
			cfg := node.GetAiTtsConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if strings.TrimSpace(cfg.GetText()) == "" && !hasAnySlot(bindings, "text", "prompt") {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
			cfg := node.GetAiSttConfig()
			if cfg == nil || strings.TrimSpace(cfg.GetMimeType()) == "" {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT:
			cfg := node.GetExtractConfig()
			if cfg == nil || strings.TrimSpace(cfg.GetJsonPath()) == "" || strings.TrimSpace(cfg.GetSourceInput()) == "" {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if _, exists := bindings[strings.TrimSpace(cfg.GetSourceInput())]; !exists {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE:
			cfg := node.GetTemplateConfig()
			if cfg == nil || strings.TrimSpace(cfg.GetTemplate()) == "" {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_SCRIPT:
			cfg := node.GetScriptConfig()
			if cfg == nil || strings.TrimSpace(cfg.GetRuntime()) == "" || strings.TrimSpace(cfg.GetCode()) == "" {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH:
			cfg := node.GetBranchConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			trueTarget := strings.TrimSpace(cfg.GetTrueTarget())
			falseTarget := strings.TrimSpace(cfg.GetFalseTarget())
			if strings.TrimSpace(cfg.GetCondition()) == "" || trueTarget == "" || falseTarget == "" {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if _, exists := graph.NodeByID[trueTarget]; !exists {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if _, exists := graph.NodeByID[falseTarget]; !exists {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			if !containsString(graph.Downstream[nodeID], trueTarget) || !containsString(graph.Downstream[nodeID], falseTarget) {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE:
			cfg := node.GetMergeConfig()
			if cfg == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			upstreamCount := len(graph.Upstream[nodeID])
			if upstreamCount == 0 {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
			switch cfg.GetStrategy() {
			case runtimev1.MergeStrategy_MERGE_STRATEGY_UNSPECIFIED, runtimev1.MergeStrategy_MERGE_STRATEGY_ALL, runtimev1.MergeStrategy_MERGE_STRATEGY_ANY:
				// valid
			case runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M:
				minCompleted := int(cfg.GetMinCompleted())
				if minCompleted <= 0 || minCompleted > upstreamCount {
					return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
				}
			default:
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_NOOP:
			if node.GetNoopConfig() == nil {
				return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
			}
		default:
			return nil, runtimev1.ReasonCode_AI_INPUT_INVALID
		}
	}

	return graph, runtimev1.ReasonCode_ACTION_EXECUTED
}

func hasAnySlot(bindings map[string]edgeBinding, slots ...string) bool {
	if len(bindings) == 0 {
		return false
	}
	for _, slot := range slots {
		if _, ok := bindings[strings.TrimSpace(slot)]; ok {
			return true
		}
	}
	return false
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func resolveWorkflowTimeout(timeoutMs int32) time.Duration {
	if timeoutMs <= 0 {
		return 0
	}
	return time.Duration(timeoutMs) * time.Millisecond
}

func cloneTask(task *taskRecord) *taskRecord {
	if task == nil {
		return nil
	}
	nodes := make(map[string]*runtimev1.WorkflowNodeStatus, len(task.Nodes))
	for id, node := range task.Nodes {
		nodes[id] = cloneNodeStatus(node)
	}
	return &taskRecord{
		TaskID:           task.TaskID,
		AppID:            task.AppID,
		SubjectUserID:    task.SubjectUserID,
		TraceID:          task.TraceID,
		Status:           task.Status,
		NodeOrder:        append([]string(nil), task.NodeOrder...),
		Nodes:            nodes,
		Output:           cloneStruct(task.Output),
		ReasonCode:       task.ReasonCode,
		CancelRequested:  task.CancelRequested,
		Definition:       cloneDefinition(task.Definition),
		Graph:            task.Graph,
		RequestedTimeout: task.RequestedTimeout,
		UpdatedAt:        task.UpdatedAt,
	}
}

func cloneDefinition(input *runtimev1.WorkflowDefinition) *runtimev1.WorkflowDefinition {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.WorkflowDefinition)
	if !ok {
		return nil
	}
	return copied
}

func cloneStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*structpb.Struct)
	if !ok {
		return nil
	}
	return copied
}

func cloneNodeStatus(input *runtimev1.WorkflowNodeStatus) *runtimev1.WorkflowNodeStatus {
	if input == nil {
		return nil
	}
	return &runtimev1.WorkflowNodeStatus{
		NodeId:  input.GetNodeId(),
		Status:  input.GetStatus(),
		Attempt: input.GetAttempt(),
		Reason:  input.GetReason(),
	}
}

func cloneEvent(input *runtimev1.WorkflowEvent) *runtimev1.WorkflowEvent {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copied, ok := cloned.(*runtimev1.WorkflowEvent)
	if !ok {
		return nil
	}
	return copied
}

func isTerminalStatus(statusValue runtimev1.WorkflowStatus) bool {
	switch statusValue {
	case runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED,
		runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED,
		runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED:
		return true
	default:
		return false
	}
}

func isTerminalEvent(eventType runtimev1.WorkflowEventType) bool {
	switch eventType {
	case runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED,
		runtimev1.WorkflowEventType_WORKFLOW_EVENT_FAILED,
		runtimev1.WorkflowEventType_WORKFLOW_EVENT_CANCELED:
		return true
	default:
		return false
	}
}

func structFromMap(values map[string]any) *structpb.Struct {
	if values == nil {
		values = map[string]any{}
	}
	built, err := structpb.NewStruct(values)
	if err != nil {
		fallback, _ := structpb.NewStruct(map[string]any{})
		return fallback
	}
	return built
}

func structFromValue(value any) *structpb.Struct {
	if value == nil {
		return structFromMap(map[string]any{"value": nil})
	}
	if asStruct, ok := value.(*structpb.Struct); ok {
		return cloneStruct(asStruct)
	}
	if asMap, ok := value.(map[string]any); ok {
		return structFromMap(asMap)
	}
	return structFromMap(map[string]any{"value": value})
}

func coerceStructMap(input *structpb.Struct) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	return input.AsMap()
}

func coerceString(input *structpb.Struct) string {
	if input == nil {
		return ""
	}
	mapped := input.AsMap()
	if value, ok := mapped["text"]; ok {
		if cast, ok := value.(string); ok {
			return cast
		}
	}
	if value, ok := mapped["value"]; ok {
		if cast, ok := value.(string); ok {
			return cast
		}
	}
	if len(mapped) == 1 {
		for _, value := range mapped {
			if cast, ok := value.(string); ok {
				return cast
			}
		}
	}
	return ""
}
