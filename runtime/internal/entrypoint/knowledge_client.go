package entrypoint

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"strings"
	"time"
)

func BuildKnowledgeIndexGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.BuildIndexRequest, metadataOverride ...*ClientMetadata) (*runtimev1.BuildIndexResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("build index request is required")
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

	client := runtimev1.NewRuntimeKnowledgeServiceClient(conn)
	resp, err := client.BuildIndex(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime knowledge build index: %w", err)
	}
	return resp, nil
}

// SearchKnowledgeIndexGRPC calls RuntimeKnowledgeService.SearchIndex over gRPC.
func SearchKnowledgeIndexGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.SearchIndexRequest, metadataOverride ...*ClientMetadata) (*runtimev1.SearchIndexResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("search index request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeKnowledgeServiceClient(conn)
	resp, err := client.SearchIndex(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime knowledge search index: %w", err)
	}
	return resp, nil
}

// DeleteKnowledgeIndexGRPC calls RuntimeKnowledgeService.DeleteIndex over gRPC.
func DeleteKnowledgeIndexGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.DeleteIndexRequest, metadataOverride ...*ClientMetadata) (*runtimev1.Ack, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("delete index request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withNimiOutgoingMetadata(ctx, req.GetAppId(), firstMetadataOverride(metadataOverride...))

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeKnowledgeServiceClient(conn)
	resp, err := client.DeleteIndex(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime knowledge delete index: %w", err)
	}
	return resp, nil
}

// SendAppMessageGRPC calls RuntimeAppService.SendAppMessage over gRPC.
