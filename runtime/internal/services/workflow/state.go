package workflow

import (
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
)

func (s *Service) addSubscriber(taskID string) (subscriber, []*runtimev1.WorkflowEvent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, exists := s.tasks[taskID]
	if !exists {
		return subscriber{}, nil, false, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID)
	}

	s.nextSubID++
	sub := subscriber{
		ID:     s.nextSubID,
		TaskID: taskID,
		Relay: streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.WorkflowEvent]{
			Budget:              32,
			MaxConsecutiveDrops: 3,
			CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
			IsTerminal: func(event *runtimev1.WorkflowEvent) bool {
				return isTerminalEvent(event.GetEventType())
			},
		}),
	}
	s.subscribers[sub.ID] = sub

	backlog := make([]*runtimev1.WorkflowEvent, 0, len(s.eventLog[taskID]))
	for _, item := range s.eventLog[taskID] {
		backlog = append(backlog, cloneEvent(item))
	}

	return sub, backlog, isTerminalStatus(record.Status), nil
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.subscribers[id]
	if !exists {
		return
	}
	delete(s.subscribers, id)
	sub.Relay.Close()
}

func (s *Service) getTask(taskID string) (*taskRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, exists := s.tasks[taskID]
	if !exists {
		return nil, false
	}
	return cloneTask(record), true
}

func (s *Service) isCancelRequested(taskID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, exists := s.tasks[taskID]
	if !exists {
		return true
	}
	return record.CancelRequested
}

func (s *Service) setTaskStatus(taskID string, statusValue runtimev1.WorkflowStatus, reason runtimev1.ReasonCode, output *structpb.Struct) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, exists := s.tasks[taskID]
	if !exists {
		return false
	}
	record.Status = statusValue
	record.ReasonCode = reason
	if output != nil {
		record.Output = cloneStruct(output)
	}
	record.UpdatedAt = time.Now().UTC()
	return true
}

func (s *Service) setNodeStatus(taskID string, nodeID string, statusValue runtimev1.WorkflowStatus, attempt int32, reason string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, exists := s.tasks[taskID]
	if !exists {
		return false
	}
	node, exists := record.Nodes[nodeID]
	if !exists {
		return false
	}
	node.Status = statusValue
	node.Attempt = attempt
	node.Reason = reason
	if statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_FAILED ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_CANCELED ||
		statusValue == runtimev1.WorkflowStatus_WORKFLOW_STATUS_SKIPPED {
		node.NextPollAt = nil
	}
	record.UpdatedAt = time.Now().UTC()
	return true
}

func (s *Service) setNodeExternalStatus(taskID string, nodeID string, providerJobID string, nextPollAt *timestamppb.Timestamp, retryCount int32, lastError string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, exists := s.tasks[taskID]
	if !exists {
		return false
	}
	node, exists := record.Nodes[nodeID]
	if !exists {
		return false
	}
	node.ProviderJobId = providerJobID
	node.NextPollAt = nextPollAt
	node.RetryCount = retryCount
	node.LastError = lastError
	record.UpdatedAt = time.Now().UTC()
	return true
}

func (s *Service) getNodeStatus(taskID string, nodeID string) runtimev1.WorkflowStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record := s.tasks[taskID]
	if record == nil {
		return runtimev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED
	}
	node := record.Nodes[nodeID]
	if node == nil {
		return runtimev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED
	}
	return node.GetStatus()
}
