package workflow

import (
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) writeArtifact(record *taskRecord, node *runtimev1.WorkflowNode, slot string, mimeType string, content []byte) (map[string]*structpb.Struct, error) {
	if s.artifactStore == nil {
		return map[string]*structpb.Struct{
			"artifact": structFromMap(map[string]any{
				"artifact_id": "",
				"mime_type":   mimeType,
				"size":        len(content),
			}),
			"output": structFromMap(map[string]any{"mime_type": mimeType, "size": len(content)}),
		}, nil
	}
	meta, err := s.artifactStore.Write(record.TaskID, node.GetNodeId(), slot, mimeType, content)
	if err != nil {
		return nil, err
	}
	artifact := structFromMap(map[string]any{
		"artifact_id": meta.ArtifactID,
		"mime_type":   meta.MimeType,
		"size":        meta.Size,
		"path":        meta.Path,
	})
	return map[string]*structpb.Struct{
		"artifact": artifact,
		"output":   artifact,
	}, nil
}

func (s *Service) buildWorkflowOutput(taskID string, record *taskRecord) *structpb.Struct {
	completed := 0
	skipped := 0
	failed := 0
	for _, nodeID := range record.NodeOrder {
		switch s.getNodeStatus(taskID, nodeID) {
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED:
			completed++
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED:
			skipped++
		case runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED:
			failed++
		}
	}

	lastNode := ""
	lastOutput := map[string]any{}
	for i := len(record.NodeOrder) - 1; i >= 0; i-- {
		nodeID := record.NodeOrder[i]
		if statusValue := s.getNodeStatus(taskID, nodeID); statusValue != runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED {
			continue
		}
		if output, ok := s.resultStore.Read(taskID, nodeID, "output"); ok {
			lastNode = nodeID
			lastOutput = output.AsMap()
			break
		}
	}

	artifactCount := 0
	if s.artifactStore != nil {
		artifactCount = len(s.artifactStore.SnapshotTask(taskID))
	}

	return structFromMap(map[string]any{
		"task_id":         taskID,
		"workflow_type":   record.Definition.GetWorkflowType(),
		"completed_nodes": completed,
		"skipped_nodes":   skipped,
		"failed_nodes":    failed,
		"artifacts":       artifactCount,
		"last_node":       lastNode,
		"output":          lastOutput,
	})
}

func (s *Service) runtimeAIClient() runtimev1.RuntimeAiServiceClient {
	return s.aiClient
}

func promptAsMessages(prompt string) []*runtimev1.ChatMessage {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return []*runtimev1.ChatMessage{}
	}
	return []*runtimev1.ChatMessage{{Role: "user", Content: trimmed}}
}

func firstInputString(inputs map[string]*structpb.Struct, slots ...string) string {
	for _, slot := range slots {
		if value, ok := inputs[slot]; ok {
			if text := coerceString(value); text != "" {
				return text
			}
		}
	}
	for _, value := range inputs {
		if text := coerceString(value); text != "" {
			return text
		}
	}
	return ""
}

func firstInputStrings(inputs map[string]*structpb.Struct, slots ...string) []string {
	for _, slot := range slots {
		if value, ok := inputs[slot]; ok && value != nil {
			if list := stringsFromStruct(value); len(list) > 0 {
				return list
			}
		}
	}
	for _, value := range inputs {
		if list := stringsFromStruct(value); len(list) > 0 {
			return list
		}
	}
	return []string{}
}

func stringsFromStruct(input *structpb.Struct) []string {
	if input == nil {
		return []string{}
	}
	mapped := input.AsMap()
	if values, ok := mapped["values"].([]any); ok {
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	}
	if value, ok := mapped["value"].(string); ok && strings.TrimSpace(value) != "" {
		return []string{value}
	}
	if text := coerceString(input); text != "" {
		return []string{text}
	}
	return []string{}
}

func cloneInputMap(inputs map[string]*structpb.Struct) map[string]*structpb.Struct {
	if len(inputs) == 0 {
		return map[string]*structpb.Struct{}
	}
	copied := make(map[string]*structpb.Struct, len(inputs))
	for key, value := range inputs {
		copied[key] = cloneStruct(value)
	}
	return copied
}

func inputsAsMap(inputs map[string]*structpb.Struct) map[string]any {
	mapped := make(map[string]any, len(inputs))
	for key, value := range inputs {
		if value == nil {
			mapped[key] = map[string]any{}
			continue
		}
		mapped[key] = value.AsMap()
	}
	return mapped
}

func (s *Service) publishIfRunning(taskID string, event *runtimev1.WorkflowEvent) bool {
	if s.isCancelRequested(taskID) {
		return false
	}
	return s.publishEvent(taskID, event) == nil
}

func (s *Service) finishFailed(taskID string, reason runtimev1.ReasonCode, why string) {
	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED, reason, nil) {
		s.logger.Warn("workflow task status update failed", "task_id", taskID)
	}
	payload := structFromMap(map[string]any{"reason": why})
	if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_FAILED,
		ReasonCode: reason,
		Payload:    payload,
	}); err != nil {
		s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
	}
	s.markTaskTerminal(taskID)
}

func (s *Service) finishCanceled(taskID string) {
	if !s.setTaskStatus(taskID, runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED, runtimev1.ReasonCode_ACTION_EXECUTED, nil) {
		s.logger.Warn("workflow task status update failed", "task_id", taskID)
	}
	if err := s.publishEvent(taskID, &runtimev1.WorkflowEvent{
		EventType:  runtimev1.WorkflowEventType_WORKFLOW_EVENT_CANCELED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}); err != nil {
		s.logger.Warn("workflow event publish failed", "task_id", taskID, "error", err)
	}
	s.markTaskTerminal(taskID)
}

func (s *Service) markTaskTerminal(taskID string) {
	if s.resultStore != nil {
		s.resultStore.MarkTaskDone(taskID)
		s.resultStore.CleanupExpired(time.Now().UTC())
	}
	if s.artifactStore != nil {
		s.artifactStore.MarkTaskDone(taskID)
		s.artifactStore.CleanupExpired(time.Now().UTC())
	}
}

func (s *Service) publishEvent(taskID string, event *runtimev1.WorkflowEvent) error {
	s.mu.Lock()
	record, exists := s.tasks[taskID]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("%s", runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}

	logs := s.eventLog[taskID]
	emitted := cloneEvent(event)
	emitted.TaskId = taskID
	emitted.TraceId = record.TraceID
	emitted.Sequence = uint64(len(logs) + 1)
	if emitted.Timestamp == nil {
		emitted.Timestamp = timestamppb.New(time.Now().UTC())
	}
	s.eventLog[taskID] = append(logs, emitted)

	targets := make([]subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		if sub.TaskID == taskID {
			targets = append(targets, sub)
		}
	}
	s.mu.Unlock()

	for _, sub := range targets {
		if err := sub.Relay.Enqueue(cloneEvent(emitted)); err != nil && s.logger != nil {
			s.logger.Warn("workflow subscriber relay closed", "subscriber_id", sub.ID, "task_id", taskID, "error", err)
		}
		if isTerminalEvent(emitted.GetEventType()) {
			sub.Relay.Close()
		}
	}
	return nil
}
