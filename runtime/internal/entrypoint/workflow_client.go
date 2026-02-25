package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"io"
	"strings"
	"time"
)

func SubmitWorkflowGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SubmitWorkflowRequest, metadataOverride ...*ClientMetadata) (*runtimev1.SubmitWorkflowResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("submit workflow request is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeWorkflowServiceClient(conn)
	resp, err := client.SubmitWorkflow(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime workflow submit: %w", err)
	}
	return resp, nil
}

// GetWorkflowGRPC calls RuntimeWorkflowService.GetWorkflow over gRPC.
func GetWorkflowGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.GetWorkflowRequest, appID string, metadataOverride ...*ClientMetadata) (*runtimev1.GetWorkflowResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("get workflow request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, appID, firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeWorkflowServiceClient(conn)
	resp, err := client.GetWorkflow(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime workflow get: %w", err)
	}
	return resp, nil
}

// CancelWorkflowGRPC calls RuntimeWorkflowService.CancelWorkflow over gRPC.
func CancelWorkflowGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.CancelWorkflowRequest, appID string, metadataOverride ...*ClientMetadata) (*runtimev1.Ack, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("cancel workflow request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, appID, firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeWorkflowServiceClient(conn)
	resp, err := client.CancelWorkflow(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime workflow cancel: %w", err)
	}
	return resp, nil
}

// SubscribeWorkflowEventsGRPC subscribes workflow events over gRPC.
func SubscribeWorkflowEventsGRPC(ctx context.Context, grpcAddr string, req *runtimev1.SubscribeWorkflowEventsRequest, appID string, metadataOverride ...*ClientMetadata) (<-chan *runtimev1.WorkflowEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, nil, errors.New("subscribe workflow events request is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx = withNimiOutgoingMetadata(ctx, appID, firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeWorkflowServiceClient(conn)
	stream, err := client.SubscribeWorkflowEvents(ctx, req)
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("runtime workflow subscribe events: %w", err)
	}

	events := make(chan *runtimev1.WorkflowEvent, 64)
	errCh := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errCh)
		defer conn.Close()

		for {
			event, recvErr := stream.Recv()
			if recvErr != nil {
				if errors.Is(recvErr, io.EOF) || status.Code(recvErr) == codes.Canceled || ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("recv workflow event: %w", recvErr)
				return
			}
			select {
			case <-ctx.Done():
				return
			case events <- event:
			}
		}
	}()

	return events, errCh, nil
}

// RegisterAppGRPC calls RuntimeAuthService.RegisterApp over gRPC.
