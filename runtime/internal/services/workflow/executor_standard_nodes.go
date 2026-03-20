package workflow

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

func (s *Service) executeExtractNode(node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetExtractConfig()
	source := inputs[cfg.GetSourceInput()]
	if source == nil {
		return nil, fmt.Errorf("extract source_input %q missing", cfg.GetSourceInput())
	}
	value, ok := extractJSONPath(source.AsMap(), cfg.GetJsonPath())
	if !ok {
		return nil, fmt.Errorf("extract json_path %q failed", cfg.GetJsonPath())
	}
	output := structFromValue(value)
	text := coerceString(output)
	result := map[string]*structpb.Struct{"output": output}
	if text != "" {
		result["text"] = structFromMap(map[string]any{"value": text})
	}
	return result, nil
}

func (s *Service) executeTemplateNode(node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetTemplateConfig()
	rendered := renderTemplateString(cfg.GetTemplate(), inputs)
	output := structFromMap(map[string]any{
		"text":             rendered,
		"output_mime_type": cfg.GetOutputMimeType(),
	})
	return map[string]*structpb.Struct{
		"output": output,
		"text":   structFromMap(map[string]any{"value": rendered}),
	}, nil
}

func (s *Service) executeScriptNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetScriptConfig()

	output := structFromMap(map[string]any{
		"task_id": record.TaskID,
		"node_id": node.GetNodeId(),
		"runtime": cfg.GetRuntime(),
		"code":    cfg.GetCode(),
		"inputs":  inputsAsMap(inputs),
	})
	return map[string]*structpb.Struct{"output": output}, nil
}

func (s *Service) executeBranchNode(record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetBranchConfig()
	matched, err := evaluateBranchCondition(cfg.GetCondition(), inputs)
	if err != nil {
		return nil, err
	}
	selectedTarget := strings.TrimSpace(cfg.GetFalseTarget())
	deselectedTarget := strings.TrimSpace(cfg.GetTrueTarget())
	if matched {
		selectedTarget = strings.TrimSpace(cfg.GetTrueTarget())
		deselectedTarget = strings.TrimSpace(cfg.GetFalseTarget())
	}
	if deselectedTarget != "" {
		s.skipBranchPath(record.TaskID, record.Graph, node.GetNodeId(), deselectedTarget)
	}
	return map[string]*structpb.Struct{
		"output": structFromMap(map[string]any{
			"condition":       cfg.GetCondition(),
			"matched":         matched,
			"selected_target": selectedTarget,
		}),
	}, nil
}

func (s *Service) executeMergeNode(record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	cfg := node.GetMergeConfig()
	upstreams := record.Graph.Upstream[node.GetNodeId()]
	completed := 0
	for _, predecessor := range upstreams {
		if s.getNodeStatus(record.TaskID, predecessor) == runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
			completed++
		}
	}
	strategy := cfg.GetStrategy()
	if strategy == runtimev1.MergeStrategy_MERGE_STRATEGY_UNSPECIFIED {
		strategy = runtimev1.MergeStrategy_MERGE_STRATEGY_ALL
	}
	valid := false
	switch strategy {
	case runtimev1.MergeStrategy_MERGE_STRATEGY_ALL:
		valid = completed == len(upstreams)
	case runtimev1.MergeStrategy_MERGE_STRATEGY_ANY:
		valid = completed >= 1
	case runtimev1.MergeStrategy_MERGE_STRATEGY_N_OF_M:
		valid = completed >= int(cfg.GetMinCompleted())
	}
	if !valid {
		return nil, fmt.Errorf("merge strategy %s not satisfied", strategy.String())
	}

	aggregated := make(map[string]any, len(inputs))
	for slot, value := range inputs {
		aggregated[slot] = value.AsMap()
	}
	result := map[string]*structpb.Struct{
		"output": structFromMap(aggregated),
	}
	for slot, value := range inputs {
		result[slot] = cloneStruct(value)
	}
	return result, nil
}

func (s *Service) executeNoopNode(inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	for _, value := range inputs {
		if value != nil {
			return map[string]*structpb.Struct{"output": cloneStruct(value)}, nil
		}
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func (s *Service) skipBranchPath(taskID string, graph *workflowGraph, branchNodeID string, startNodeID string) {
	if strings.TrimSpace(startNodeID) == "" {
		return
	}
	queue := []string{startNodeID}
	skipped := map[string]bool{}
	for len(queue) > 0 {
		nodeID := queue[0]
		queue = queue[1:]
		if skipped[nodeID] {
			continue
		}
		if nodeID != startNodeID && !s.canSkipNode(taskID, graph, branchNodeID, nodeID, skipped) {
			continue
		}
		if !s.markNodeSkipped(taskID, nodeID, "branch_not_selected") {
			continue
		}
		skipped[nodeID] = true
		for _, next := range graph.Downstream[nodeID] {
			queue = append(queue, next)
		}
	}
}

func (s *Service) canSkipNode(taskID string, graph *workflowGraph, branchNodeID string, nodeID string, skipped map[string]bool) bool {
	for _, predecessor := range graph.Upstream[nodeID] {
		if predecessor == branchNodeID {
			continue
		}
		if skipped[predecessor] {
			continue
		}
		if s.getNodeStatus(taskID, predecessor) != runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
			return false
		}
	}
	return true
}

func (s *Service) markNodeSkipped(taskID string, nodeID string, reason string) bool {
	statusValue := s.getNodeStatus(taskID, nodeID)
	if statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED {
		return false
	}
	if statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		return true
	}
	if !s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED, 0, reason) {
		return false
	}
	if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_SKIPPED,
		NodeId:     nodeID,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Payload:    structFromMap(map[string]any{"reason": reason}),
	}); err != nil {
		s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
	}
	return true
}
