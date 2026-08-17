package entrypoint

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func withAuditReadMetadata(ctx context.Context) context.Context {
	return withNimiOutgoingMetadata(ctx, "nimi.desktop", &ClientMetadata{
		Domain: "runtime.audit",
	})
}

// FetchPublicGRPCHealth checks only the standard public gRPC serving state.
func FetchPublicGRPCHealth(grpcAddr string, timeout time.Duration) (map[string]any, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer func() { _ = conn.Close() }()

	client := healthpb.NewHealthClient(conn)
	healthResp, err := client.Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil {
		return nil, fmt.Errorf("check public grpc health: %w", err)
	}

	return map[string]any{
		"status": healthResp.GetStatus().String(),
	}, nil
}

// ListAuditEventsGRPC calls RuntimeAuditService.ListAuditEvents over gRPC.
func ListAuditEventsGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListAuditEventsRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListAuditEventsResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list audit events request is required")
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	meta := firstMetadataOverride(metadataOverride...)
	if meta == nil {
		meta = &ClientMetadata{}
	}
	if strings.TrimSpace(meta.Domain) == "" {
		meta.Domain = strings.TrimSpace(req.GetDomain())
	}
	preparedCtx, err := prepareInsecureOutgoingContext(ctx, addr, req.GetAppId(), meta)
	if err != nil {
		return nil, err
	}
	ctx = preparedCtx

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer func() { _ = conn.Close() }()

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	resp, err := client.ListAuditEvents(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime audit list events: %w", err)
	}
	return resp, nil
}

// ListUsageStatsGRPC calls RuntimeAuditService.ListUsageStats over gRPC.
func ListUsageStatsGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ListUsageStatsRequest, metadataOverride ...*ClientMetadata) (*runtimev1.ListUsageStatsResponse, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("list usage stats request is required")
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

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	resp, err := client.ListUsageStats(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime audit list usage stats: %w", err)
	}
	return resp, nil
}

// ExportAuditEventsGRPC calls RuntimeAuditService.ExportAuditEvents and collects chunk payload.
func ExportAuditEventsGRPC(grpcAddr string, timeout time.Duration, req *runtimev1.ExportAuditEventsRequest, metadataOverride ...*ClientMetadata) (*AuditExportResult, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if req == nil {
		return nil, errors.New("export audit events request is required")
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
	defer func() { _ = conn.Close() }()

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	stream, err := client.ExportAuditEvents(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime audit export events: %w", err)
	}
	return collectAuditExportStream(stream)
}
