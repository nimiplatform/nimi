package workflow

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/workerproxy"
)

const (
	defaultResultStoreTTL   = 30 * time.Minute
	defaultArtifactStoreTTL = 30 * time.Minute
)

type taskRecord struct {
	TaskID           string
	AppID            string
	SubjectUserID    string
	TraceID          string
	Status           runtimev1.WorkflowStatus
	NodeOrder        []string
	Nodes            map[string]*runtimev1.WorkflowNodeStatus
	Output           *structpb.Struct
	ReasonCode       runtimev1.ReasonCode
	CancelRequested  bool
	Definition       *runtimev1.WorkflowDefinition
	Graph            *workflowGraph
	RequestedTimeout time.Duration
	UpdatedAt        time.Time
}

type subscriber struct {
	ID     uint64
	TaskID string
	Ch     chan *runtimev1.WorkflowEvent
}

type Option func(*Service)

func WithAIClient(client runtimev1.RuntimeAiServiceClient) Option {
	return func(s *Service) {
		s.aiClient = client
	}
}

func WithScriptWorkerClient(client runtimev1.ScriptWorkerServiceClient) Option {
	return func(s *Service) {
		s.scriptClient = client
	}
}

func WithArtifactRoot(root string) Option {
	return func(s *Service) {
		trimmed := strings.TrimSpace(root)
		if trimmed == "" {
			return
		}
		store, err := newArtifactStore(trimmed, defaultArtifactStoreTTL, s.logger)
		if err != nil {
			if s.logger != nil {
				s.logger.Warn("workflow artifact store disabled", "root", trimmed, "error", err)
			}
			return
		}
		s.artifactStore = store
	}
}

// Service implements RuntimeWorkflowService with in-memory DAG orchestration.
type Service struct {
	runtimev1.UnimplementedRuntimeWorkflowServiceServer
	logger *slog.Logger

	mu          sync.RWMutex
	tasks       map[string]*taskRecord
	eventLog    map[string][]*runtimev1.WorkflowEvent
	subscribers map[uint64]subscriber
	nextSubID   uint64
	scheduler   *scheduler.Scheduler

	resultStore   *resultStore
	artifactStore *artifactStore

	aiClient     runtimev1.RuntimeAiServiceClient
	scriptClient runtimev1.ScriptWorkerServiceClient
	workerPool   *workerproxy.ConnPool
}

func New(logger *slog.Logger, opts ...Option) *Service {
	svc := &Service{
		logger:      logger,
		tasks:       make(map[string]*taskRecord),
		eventLog:    make(map[string][]*runtimev1.WorkflowEvent),
		subscribers: make(map[uint64]subscriber),
		scheduler: scheduler.New(scheduler.Config{
			GlobalConcurrency:   8,
			PerAppConcurrency:   2,
			StarvationThreshold: 30 * time.Second,
		}),
		resultStore: newResultStore(defaultResultStoreTTL),
	}
	store, err := newArtifactStore(resolveArtifactRoot(), defaultArtifactStoreTTL, logger)
	if err != nil {
		if logger != nil {
			logger.Warn("workflow artifact store disabled", "error", err)
		}
	} else {
		svc.artifactStore = store
	}

	if strings.EqualFold(strings.TrimSpace(os.Getenv("NIMI_RUNTIME_WORKER_ROLE")), "workflow") {
		svc.workerPool = workerproxy.NewConnPool(logger)
	}

	for _, opt := range opts {
		if opt != nil {
			opt(svc)
		}
	}

	return svc
}

func (s *Service) SubmitWorkflow(_ context.Context, req *runtimev1.SubmitWorkflowRequest) (*runtimev1.SubmitWorkflowResponse, error) {
	if req == nil {
		return &runtimev1.SubmitWorkflowResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	if appID == "" || subjectUserID == "" || req.GetDefinition() == nil {
		return &runtimev1.SubmitWorkflowResponse{Accepted: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID}, nil
	}

	graph, reason := validateDefinition(req.GetDefinition())
	if reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		return &runtimev1.SubmitWorkflowResponse{Accepted: false, ReasonCode: reason}, nil
	}

	taskID := ulid.Make().String()
	traceID := ulid.Make().String()
	nodeState := make(map[string]*runtimev1.WorkflowNodeStatus, len(graph.Order))
	for _, nodeID := range graph.Order {
		nodeState[nodeID] = &runtimev1.WorkflowNodeStatus{
			NodeId:  nodeID,
			Status:  runtimev1.WorkflowStatus_WORKFLOW_STATUS_QUEUED,
			Attempt: 0,
			Reason:  "",
		}
	}

	record := &taskRecord{
		TaskID:           taskID,
		AppID:            appID,
		SubjectUserID:    subjectUserID,
		TraceID:          traceID,
		Status:           runtimev1.WorkflowStatus_WORKFLOW_STATUS_ACCEPTED,
		NodeOrder:        append([]string(nil), graph.Order...),
		Nodes:            nodeState,
		ReasonCode:       runtimev1.ReasonCode_ACTION_EXECUTED,
		Definition:       cloneDefinition(req.GetDefinition()),
		Graph:            graph,
		RequestedTimeout: resolveWorkflowTimeout(req.GetTimeoutMs()),
		UpdatedAt:        time.Now().UTC(),
	}

	s.mu.Lock()
	s.tasks[taskID] = record
	s.eventLog[taskID] = make([]*runtimev1.WorkflowEvent, 0, len(graph.Order)*4+4)
	s.mu.Unlock()

	if s.logger != nil {
		s.logger.Info("workflow accepted", "task_id", taskID, "workflow_type", req.GetDefinition().GetWorkflowType(), "nodes", len(graph.Order))
	}
	go s.executeTask(taskID)

	return &runtimev1.SubmitWorkflowResponse{
		TaskId:     taskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetWorkflow(_ context.Context, req *runtimev1.GetWorkflowRequest) (*runtimev1.GetWorkflowResponse, error) {
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return &runtimev1.GetWorkflowResponse{
			TaskId:     "",
			Status:     runtimev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED,
			Nodes:      []*runtimev1.WorkflowNodeStatus{},
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}

	s.mu.RLock()
	record, exists := s.tasks[taskID]
	if !exists {
		s.mu.RUnlock()
		return &runtimev1.GetWorkflowResponse{
			TaskId:     taskID,
			Status:     runtimev1.WorkflowStatus_WORKFLOW_STATUS_UNSPECIFIED,
			Nodes:      []*runtimev1.WorkflowNodeStatus{},
			ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID,
		}, nil
	}

	nodes := make([]*runtimev1.WorkflowNodeStatus, 0, len(record.NodeOrder))
	for _, nodeID := range record.NodeOrder {
		item := record.Nodes[nodeID]
		nodes = append(nodes, cloneNodeStatus(item))
	}
	output := cloneStruct(record.Output)
	statusValue := record.Status
	reasonCode := record.ReasonCode
	s.mu.RUnlock()

	return &runtimev1.GetWorkflowResponse{
		TaskId:     taskID,
		Status:     statusValue,
		Nodes:      nodes,
		Output:     output,
		ReasonCode: reasonCode,
	}, nil
}

func (s *Service) CancelWorkflow(_ context.Context, req *runtimev1.CancelWorkflowRequest) (*runtimev1.Ack, error) {
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set task_id"}, nil
	}

	s.mu.Lock()
	record, exists := s.tasks[taskID]
	if !exists {
		s.mu.Unlock()
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_APP_GRANT_INVALID, ActionHint: "unknown task_id"}, nil
	}
	if isTerminalStatus(record.Status) {
		s.mu.Unlock()
		return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, ActionHint: "workflow already terminal"}, nil
	}
	record.CancelRequested = true
	record.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()

	if s.logger != nil {
		s.logger.Info("workflow cancel requested", "task_id", taskID)
	}
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SubscribeWorkflowEvents(req *runtimev1.SubscribeWorkflowEventsRequest, stream grpc.ServerStreamingServer[runtimev1.WorkflowEvent]) error {
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	sub, backlog, terminal, err := s.addSubscriber(taskID)
	if err != nil {
		return err
	}
	defer s.removeSubscriber(sub.ID)

	for _, event := range backlog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	if terminal {
		return nil
	}

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case event, ok := <-sub.Ch:
			if !ok {
				return nil
			}
			if err := stream.Send(event); err != nil {
				return err
			}
			if isTerminalEvent(event.GetEventType()) {
				return nil
			}
		}
	}
}
