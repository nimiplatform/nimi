package workerproxy

import (
	"context"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const workflowWorkerRole = "workflow"

// WorkflowProxy forwards RuntimeWorkflowService requests to the workflow worker process.
type WorkflowProxy struct {
	runtimev1.UnimplementedRuntimeWorkflowServiceServer
	pool *ConnPool
}

func NewWorkflowProxy(pool *ConnPool) *WorkflowProxy {
	return &WorkflowProxy{pool: pool}
}

func (s *WorkflowProxy) SubmitWorkflow(ctx context.Context, req *runtimev1.SubmitWorkflowRequest) (*runtimev1.SubmitWorkflowResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(workflowWorkerRole, err)
	}
	return client.SubmitWorkflow(ctx, req)
}

func (s *WorkflowProxy) GetWorkflow(ctx context.Context, req *runtimev1.GetWorkflowRequest) (*runtimev1.GetWorkflowResponse, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(workflowWorkerRole, err)
	}
	return client.GetWorkflow(ctx, req)
}

func (s *WorkflowProxy) CancelWorkflow(ctx context.Context, req *runtimev1.CancelWorkflowRequest) (*runtimev1.Ack, error) {
	client, err := s.client()
	if err != nil {
		return nil, unavailableWorker(workflowWorkerRole, err)
	}
	return client.CancelWorkflow(ctx, req)
}

func (s *WorkflowProxy) SubscribeWorkflowEvents(req *runtimev1.SubscribeWorkflowEventsRequest, stream grpc.ServerStreamingServer[runtimev1.WorkflowEvent]) error {
	client, err := s.client()
	if err != nil {
		return unavailableWorker(workflowWorkerRole, err)
	}
	remote, err := client.SubscribeWorkflowEvents(stream.Context(), req)
	if err != nil {
		return err
	}
	return forwardServerStream(remote.Recv, stream.Send)
}

func (s *WorkflowProxy) client() (runtimev1.RuntimeWorkflowServiceClient, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "worker_workflow_unavailable")
	}
	conn, err := s.pool.Conn(workflowWorkerRole)
	if err != nil {
		return nil, err
	}
	return runtimev1.NewRuntimeWorkflowServiceClient(conn), nil
}

func unavailableWorker(role string, err error) error {
	return status.Error(codes.Unavailable, fmt.Sprintf("worker_%s_unavailable: %v", role, err))
}
