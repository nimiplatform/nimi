package workflow

import (
	"context"
	"fmt"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultWorkflowTimeout = 2 * time.Minute
)

func (s *Service) executeTask(taskID string) {
	record, exists := s.getTask(taskID)
	if !exists || record.Graph == nil {
		return
	}

	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_QUEUED, runtimev1.ReasonCode_ACTION_EXECUTED, nil) {
		return
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(context.Background(), record.AppID)
	if acquireErr != nil {
		s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, "workflow scheduler unavailable")
		return
	}
	defer release()
	if acquireResult.Waited > 0 && s.logger != nil {
		waitMs := acquireResult.Waited.Milliseconds()
		if acquireResult.Starved {
			s.logger.Warn("workflow scheduler starvation threshold reached", "task_id", taskID, "app_id", record.AppID, "queue_wait_ms", waitMs)
		} else {
			s.logger.Debug("workflow scheduler queue wait", "task_id", taskID, "app_id", record.AppID, "queue_wait_ms", waitMs)
		}
	}

	if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_STARTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}) {
		s.finishCanceled(taskID)
		return
	}

	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING, runtimev1.ReasonCode_ACTION_EXECUTED, nil) {
		return
	}

	timeout := record.RequestedTimeout
	if timeout <= 0 {
		timeout = defaultWorkflowTimeout
	}
	execCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	stopWatch := make(chan struct{})
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopWatch:
				return
			case <-ticker.C:
				if s.isCancelRequested(taskID) {
					cancel()
					return
				}
			}
		}
	}()
	defer close(stopWatch)

	for _, nodeID := range record.NodeOrder {
		if s.isCancelRequested(taskID) {
			s.finishCanceled(taskID)
			return
		}
		if execCtx.Err() != nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "workflow timeout reached")
			return
		}

		nodeStatus := s.getNodeStatus(taskID, nodeID)
		if nodeStatus == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
			continue
		}

		node := record.Graph.NodeByID[nodeID]
		if node == nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_INPUT_INVALID, "workflow node missing")
			return
		}

		inputs, resolveErr := s.resolveNodeInputs(taskID, record.Graph, nodeID)
		if resolveErr != nil {
			s.finishFailed(taskID, runtimev1.ReasonCode_AI_INPUT_INVALID, resolveErr.Error())
			return
		}

		s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING, 1, "")
		if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
			EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_STARTED,
			NodeId:     nodeID,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		}) {
			s.finishCanceled(taskID)
			return
		}

		var (
			nodeOutputs map[string]*structpb.Struct
			executeErr  error
		)
		if shouldExecuteExternalAsync(node) {
			nodeOutputs, executeErr = s.executeNodeExternalAsync(execCtx, record, node, inputs)
		} else {
			nodeOutputs, executeErr = s.executeNode(execCtx, record, node, inputs)
		}
		if executeErr != nil {
			if s.isCancelRequested(taskID) || execCtx.Err() == context.Canceled {
				s.finishCanceled(taskID)
				return
			}
			if execCtx.Err() == context.DeadlineExceeded {
				s.finishFailed(taskID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "workflow timeout reached")
				return
			}
			reasonCode := workflowReasonCodeFromError(executeErr)
			s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED, 1, executeErr.Error())
			if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
				EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_COMPLETED,
				NodeId:          nodeID,
				ProgressPercent: 100,
				ReasonCode:      reasonCode,
				Payload:         structFromMap(map[string]any{"error": executeErr.Error()}),
			}); err != nil {
				s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
			}
			s.finishFailed(taskID, reasonCode, executeErr.Error())
			return
		}

		for slot, value := range nodeOutputs {
			s.resultStore.Write(taskID, nodeID, slot, value)
		}
		s.setNodeStatus(taskID, nodeID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, 1, "")

		payload := nodeOutputs["output"]
		if payload == nil {
			payload = structFromMap(map[string]any{"slots": len(nodeOutputs)})
		}
		if !s.publishIfRunning(taskID, &runtimev1.WorkflowEvent{
			EventType:       runtimev1.WorkflowEventType_WORKFLOW_EVENT_NODE_COMPLETED,
			NodeId:          nodeID,
			ProgressPercent: 100,
			ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			Payload:         payload,
		}) {
			s.finishCanceled(taskID)
			return
		}
	}

	output := s.buildWorkflowOutput(taskID, record)
	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED, runtimev1.ReasonCode_ACTION_EXECUTED, output) {
		return
	}
	if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_COMPLETED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Payload:    output,
	}); err != nil {
		s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
	}
	s.markTaskTerminal(taskID)
}

func (s *Service) resolveNodeInputs(taskID string, graph *workflowGraph, nodeID string) (map[string]*structpb.Struct, error) {
	inputs := make(map[string]*structpb.Struct, len(graph.Incoming[nodeID]))
	for _, edge := range graph.Incoming[nodeID] {
		value, ok := s.resultStore.Read(taskID, edge.GetFromNodeId(), edge.GetFromOutput())
		if !ok {
			if s.getNodeStatus(taskID, edge.GetFromNodeId()) == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
				continue
			}
			return nil, fmt.Errorf("missing edge input: %s.%s -> %s.%s", edge.GetFromNodeId(), edge.GetFromOutput(), edge.GetToNodeId(), edge.GetToInput())
		}
		inputs[edge.GetToInput()] = value
	}
	return inputs, nil
}

func (s *Service) executeNode(ctx context.Context, record *taskRecord, node *runtimev1.WorkflowNode, inputs map[string]*structpb.Struct) (map[string]*structpb.Struct, error) {
	switch node.GetNodeType() {
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_GENERATE:
		return s.executeAIGenerateNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STREAM:
		return s.executeAIStreamNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_EMBED:
		return s.executeAIEmbedNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_IMAGE:
		return s.executeAIImageNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_VIDEO:
		return s.executeAIVideoNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_TTS:
		return s.executeAITTSNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_AI_STT:
		return s.executeAISTTNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_EXTRACT:
		return s.executeExtractNode(node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_TEMPLATE:
		return s.executeTemplateNode(node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_TRANSFORM_SCRIPT:
		return s.executeScriptNode(ctx, record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_BRANCH:
		return s.executeBranchNode(record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_MERGE:
		return s.executeMergeNode(record, node, inputs)
	case runtimev1.WorkflowNodeType_WORKFLOW_NODE_CONTROL_NOOP:
		return s.executeNoopNode(inputs), nil
	default:
		return nil, fmt.Errorf("unsupported workflow node type: %s", node.GetNodeType().String())
	}
}
