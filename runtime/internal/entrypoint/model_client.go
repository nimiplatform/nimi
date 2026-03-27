package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/proto"
	"strings"
	"time"
)

func ListModelsGRPC(grpcAddr string, timeout time.Duration, appID string, metadataOverride ...*ClientMetadata) (*runtimev1.ListModelsResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, appID, firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeModelServiceClient(conn)
	resp, err := client.ListModels(ctx, &runtimev1.ListModelsRequest{})
	if err != nil {
		return nil, fmt.Errorf("runtime model list: %w", err)
	}
	return resp, nil
}

// PullModelGRPC calls RuntimeModelService.PullModel over gRPC.
func PullModelGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.PullModelRequest, metadataOverride ...*ClientMetadata) (*runtimev1.PullModelResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("pull model request is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetAppId(), firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeModelServiceClient(conn)
	resp, err := client.PullModel(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime model pull: %w", err)
	}
	return resp, nil
}

// RemoveModelGRPC calls RuntimeModelService.RemoveModel over gRPC.
func RemoveModelGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.RemoveModelRequest, metadataOverride ...*ClientMetadata) (*runtimev1.Ack, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("remove model request is required")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetAppId(), firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeModelServiceClient(conn)
	resp, err := client.RemoveModel(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime model remove: %w", err)
	}
	return resp, nil
}

// CheckModelHealthGRPC calls RuntimeModelService.CheckModelHealth over gRPC.
func CheckModelHealthGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.CheckModelHealthRequest, appID string, metadataOverride ...*ClientMetadata) (*runtimev1.CheckModelHealthResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("check model health request is required")
	}
	trimmedAppID := strings.TrimSpace(appID)
	if req.GetAppId() == "" && trimmedAppID != "" {
		cloned, ok := proto.Clone(req).(*runtimev1.CheckModelHealthRequest)
		if !ok {
			return nil, errors.New("clone check model health request")
		}
		cloned.AppId = trimmedAppID
		req = cloned
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, trimmedAppID, firstMetadataOverride(metadataOverride...))
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeModelServiceClient(conn)
	resp, err := client.CheckModelHealth(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime model health: %w", err)
	}
	return resp, nil
}

// SubmitWorkflowGRPC calls RuntimeWorkflowService.SubmitWorkflow over gRPC.
