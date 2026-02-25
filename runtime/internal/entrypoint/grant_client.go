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

func AuthorizeExternalPrincipalGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.AuthorizeExternalPrincipalRequest, metadataOverride ...*ClientMetadata) (*runtimev1.AuthorizeExternalPrincipalResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("authorize external principal request is required")
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

	client := runtimev1.NewRuntimeGrantServiceClient(conn)
	resp, err := client.AuthorizeExternalPrincipal(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime grant authorize external principal: %w", err)
	}
	return resp, nil
}

// ValidateAppAccessTokenGRPC calls RuntimeGrantService.ValidateAppAccessToken over gRPC.
func ValidateAppAccessTokenGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ValidateAppAccessTokenRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ValidateAppAccessTokenResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("validate app access token request is required")
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

	client := runtimev1.NewRuntimeGrantServiceClient(conn)
	resp, err := client.ValidateAppAccessToken(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime grant validate app access token: %w", err)
	}
	return resp, nil
}

// RevokeAppAccessTokenGRPC calls RuntimeGrantService.RevokeAppAccessToken over gRPC.
func RevokeAppAccessTokenGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.RevokeAppAccessTokenRequest, metadataOverride ...*ClientMetadata) (*runtimev1.Ack, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("revoke app access token request is required")
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

	client := runtimev1.NewRuntimeGrantServiceClient(conn)
	resp, err := client.RevokeAppAccessToken(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime grant revoke app access token: %w", err)
	}
	return resp, nil
}

// IssueDelegatedAccessTokenGRPC calls RuntimeGrantService.IssueDelegatedAccessToken over gRPC.
func IssueDelegatedAccessTokenGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.IssueDelegatedAccessTokenRequest, metadataOverride ...*ClientMetadata) (*runtimev1.IssueDelegatedAccessTokenResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("issue delegated access token request is required")
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

	client := runtimev1.NewRuntimeGrantServiceClient(conn)
	resp, err := client.IssueDelegatedAccessToken(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime grant issue delegated access token: %w", err)
	}
	return resp, nil
}

// ListTokenChainGRPC calls RuntimeGrantService.ListTokenChain over gRPC.
func ListTokenChainGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListTokenChainRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListTokenChainResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list token chain request is required")
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

	client := runtimev1.NewRuntimeGrantServiceClient(conn)
	resp, err := client.ListTokenChain(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime grant list token chain: %w", err)
	}
	return resp, nil
}

// BuildKnowledgeIndexGRPC calls RuntimeKnowledgeService.BuildIndex over gRPC.
