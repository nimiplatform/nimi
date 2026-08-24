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

// RegisterExternalPrincipalGRPC calls RuntimeAuthService.RegisterExternalPrincipal over gRPC.
func RegisterExternalPrincipalGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.RegisterExternalPrincipalRequest, metadataOverride ...*ClientMetadata) (*runtimev1.RegisterExternalPrincipalResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("register external principal request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
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
	defer func() { _ = conn.Close() }()

	client := runtimev1.NewRuntimeAuthServiceClient(conn)
	resp, err := client.RegisterExternalPrincipal(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime auth register external principal: %w", err)
	}
	return resp, nil
}

// OpenExternalPrincipalSessionGRPC calls RuntimeAuthService.OpenExternalPrincipalSession over gRPC.
func OpenExternalPrincipalSessionGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.OpenExternalPrincipalSessionRequest, metadataOverride ...*ClientMetadata) (*runtimev1.OpenExternalPrincipalSessionResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("open external principal session request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
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
	defer func() { _ = conn.Close() }()

	client := runtimev1.NewRuntimeAuthServiceClient(conn)
	resp, err := client.OpenExternalPrincipalSession(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime auth open external principal session: %w", err)
	}
	return resp, nil
}

// RevokeExternalPrincipalSessionGRPC calls RuntimeAuthService.RevokeExternalPrincipalSession over gRPC.
func RevokeExternalPrincipalSessionGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.RevokeExternalPrincipalSessionRequest, appID string, metadataOverride ...*ClientMetadata) (*runtimev1.Ack, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("revoke external principal session request is required")
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
	defer func() { _ = conn.Close() }()

	client := runtimev1.NewRuntimeAuthServiceClient(conn)
	resp, err := client.RevokeExternalPrincipalSession(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime auth revoke external principal session: %w", err)
	}
	return resp, nil
}
