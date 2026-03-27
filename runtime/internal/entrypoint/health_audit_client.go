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

func withAuditReadMetadata(ctx context.Context) context.Context {
	return withNimiOutgoingMetadata(ctx, "nimi.desktop", &ClientMetadata{
		Domain: "runtime.audit",
	})
}

func FetchAIProviderHealthGRPC(grpcAddr string, timeout time.Duration) ([]ProviderHealthSnapshot, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withAuditReadMetadata(ctx)

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	resp, err := client.ListAIProviderHealth(ctx, &runtimev1.ListAIProviderHealthRequest{})
	if err != nil {
		return nil, fmt.Errorf("list ai provider health: %w", err)
	}

	out := make([]ProviderHealthSnapshot, 0, len(resp.GetProviders()))
	for _, item := range resp.GetProviders() {
		snapshot := ProviderHealthSnapshot{
			Name:                strings.TrimSpace(item.GetProviderName()),
			State:               strings.TrimSpace(item.GetState()),
			Reason:              strings.TrimSpace(item.GetReason()),
			ConsecutiveFailures: item.GetConsecutiveFailures(),
		}
		if ts := item.GetLastChangedAt(); ts != nil {
			snapshot.LastChangedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		if ts := item.GetLastCheckedAt(); ts != nil {
			snapshot.LastCheckedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		out = append(out, snapshot)
	}
	return out, nil
}

// SubscribeAIProviderHealthGRPC subscribes to provider health stream from RuntimeAuditService.
func SubscribeAIProviderHealthGRPC(ctx context.Context, grpcAddr string) (<-chan ProviderHealthEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	ctx = withAuditReadMetadata(ctx)

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	stream, err := client.SubscribeAIProviderHealthEvents(ctx, &runtimev1.SubscribeAIProviderHealthEventsRequest{})
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("subscribe ai provider health events: %w", err)
	}

	events := make(chan ProviderHealthEvent, 32)
	errCh := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errCh)
		defer conn.Close()

		for {
			item, recvErr := stream.Recv()
			if recvErr != nil {
				if errors.Is(recvErr, io.EOF) || status.Code(recvErr) == codes.Canceled || ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("recv ai provider health event: %w", recvErr)
				return
			}
			event := ProviderHealthEvent{
				Sequence: item.GetSequence(),
				Snapshot: ProviderHealthSnapshot{
					Name:                strings.TrimSpace(item.GetProviderName()),
					State:               strings.TrimSpace(item.GetState()),
					Reason:              strings.TrimSpace(item.GetReason()),
					ConsecutiveFailures: item.GetConsecutiveFailures(),
				},
			}
			if ts := item.GetLastChangedAt(); ts != nil {
				event.Snapshot.LastChangedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
			}
			if ts := item.GetLastCheckedAt(); ts != nil {
				event.Snapshot.LastCheckedAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
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

// SubscribeRuntimeHealthGRPC subscribes to runtime health stream from RuntimeAuditService.
func SubscribeRuntimeHealthGRPC(ctx context.Context, grpcAddr string) (<-chan RuntimeHealthEvent, <-chan error, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, nil, errors.New("grpc address is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	ctx = withAuditReadMetadata(ctx)

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	stream, err := client.SubscribeRuntimeHealthEvents(ctx, &runtimev1.SubscribeRuntimeHealthEventsRequest{})
	if err != nil {
		conn.Close()
		return nil, nil, fmt.Errorf("subscribe runtime health events: %w", err)
	}

	events := make(chan RuntimeHealthEvent, 32)
	errCh := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(errCh)
		defer conn.Close()

		for {
			item, recvErr := stream.Recv()
			if recvErr != nil {
				if errors.Is(recvErr, io.EOF) || status.Code(recvErr) == codes.Canceled || ctx.Err() != nil {
					return
				}
				errCh <- fmt.Errorf("recv runtime health event: %w", recvErr)
				return
			}
			event := RuntimeHealthEvent{
				Sequence: item.GetSequence(),
				Snapshot: RuntimeHealthSnapshot{
					Status:              item.GetStatus().String(),
					StatusCode:          int32(item.GetStatus()),
					Reason:              strings.TrimSpace(item.GetReason()),
					QueueDepth:          item.GetQueueDepth(),
					ActiveWorkflows:     item.GetActiveWorkflows(),
					ActiveInferenceJobs: item.GetActiveInferenceJobs(),
					CPUMilli:            item.GetCpuMilli(),
					MemoryBytes:         item.GetMemoryBytes(),
					VRAMBytes:           item.GetVramBytes(),
				},
			}
			if ts := item.GetSampledAt(); ts != nil {
				event.Snapshot.SampledAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
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

// FetchRuntimeHealthGRPC requests GetRuntimeHealth from RuntimeAuditService and returns JSON-ready payload.
func FetchRuntimeHealthGRPC(grpcAddr string, timeout time.Duration) (map[string]any, error) {
	addr := strings.TrimSpace(grpcAddr)
	if addr == "" {
		return nil, errors.New("grpc address is required")
	}
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx = withAuditReadMetadata(ctx)

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial grpc %s: %w", addr, err)
	}
	defer conn.Close()

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	healthResp, err := client.GetRuntimeHealth(ctx, &runtimev1.GetRuntimeHealthRequest{})
	if err != nil {
		return nil, fmt.Errorf("get runtime health: %w", err)
	}
	providersResp, err := client.ListAIProviderHealth(ctx, &runtimev1.ListAIProviderHealthRequest{})
	if err != nil {
		return nil, fmt.Errorf("list ai provider health: %w", err)
	}

	providers := make([]map[string]any, 0, len(providersResp.GetProviders()))
	for _, item := range providersResp.GetProviders() {
		provider := map[string]any{
			"name":                 strings.TrimSpace(item.GetProviderName()),
			"state":                strings.TrimSpace(item.GetState()),
			"reason":               strings.TrimSpace(item.GetReason()),
			"consecutive_failures": item.GetConsecutiveFailures(),
			"last_changed_at":      "",
			"last_checked_at":      "",
		}
		if ts := item.GetLastChangedAt(); ts != nil {
			provider["last_changed_at"] = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		if ts := item.GetLastCheckedAt(); ts != nil {
			provider["last_checked_at"] = ts.AsTime().UTC().Format(time.RFC3339Nano)
		}
		providers = append(providers, provider)
	}

	sampledAt := ""
	if ts := healthResp.GetSampledAt(); ts != nil {
		sampledAt = ts.AsTime().UTC().Format(time.RFC3339Nano)
	}

	return map[string]any{
		"status":                healthResp.GetStatus().String(),
		"status_code":           int32(healthResp.GetStatus()),
		"reason":                healthResp.GetReason(),
		"queue_depth":           healthResp.GetQueueDepth(),
		"active_workflows":      healthResp.GetActiveWorkflows(),
		"active_inference_jobs": healthResp.GetActiveInferenceJobs(),
		"cpu_milli":             healthResp.GetCpuMilli(),
		"memory_bytes":          healthResp.GetMemoryBytes(),
		"vram_bytes":            healthResp.GetVramBytes(),
		"sampled_at":            sampledAt,
		"ai_providers":          providers,
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
	defer conn.Close()

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
	defer conn.Close()

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
	defer conn.Close()

	client := runtimev1.NewRuntimeAuditServiceClient(conn)
	stream, err := client.ExportAuditEvents(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("runtime audit export events: %w", err)
	}
	return collectAuditExportStream(stream)
}
