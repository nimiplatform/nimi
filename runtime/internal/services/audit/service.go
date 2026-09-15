package audit

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Service implements RuntimeAuditService with runtime health first.
type Service struct {
	runtimev1.UnimplementedRuntimeAuditServiceServer
	state  *health.State
	logger *slog.Logger
	store  *auditlog.Store
}

func New(state *health.State, logger *slog.Logger, store ...*auditlog.Store) *Service {
	var auditStore *auditlog.Store
	if len(store) > 0 {
		auditStore = store[0]
	}
	return &Service{
		state:  state,
		logger: logger,
		store:  auditStore,
	}
}

func (s *Service) ListAuditEvents(_ context.Context, req *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	if s.store == nil {
		return &runtimev1.ListAuditEventsResponse{}, nil
	}
	return s.store.ListEvents(req)
}

func appIDFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get("x-nimi-app-id")
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func (s *Service) ExportAuditEvents(req *runtimev1.ExportAuditEventsRequest, stream grpc.ServerStreamingServer[runtimev1.AuditExportChunk]) error {
	requestAppID := strings.TrimSpace(req.GetAppId())
	contextAppID := appIDFromContext(stream.Context())
	if requestAppID != "" && contextAppID != "" && requestAppID != contextAppID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	filterAppId := requestAppID
	if filterAppId == "" {
		filterAppId = contextAppID
	}
	if filterAppId == "" {
		return grpcerr.WithReasonCode(codes.Unauthenticated, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
	}
	listResp, err := s.ListAuditEvents(stream.Context(), &runtimev1.ListAuditEventsRequest{
		AppId:         filterAppId,
		SubjectUserId: req.GetSubjectUserId(),
		FromTime:      req.GetFromTime(),
		ToTime:        req.GetToTime(),
		PageSize:      500,
	})
	if err != nil {
		return err
	}

	exportID := ulid.Make().String()
	payload, err := marshalAuditPayload(req.GetFormat(), listResp.GetEvents())
	if err != nil {
		return err
	}
	if req.GetCompress() {
		payload, err = gzipCompress(payload)
		if err != nil {
			return err
		}
	}

	const chunkSize = 1024
	chunks := splitChunks(payload, chunkSize)
	if len(chunks) == 0 {
		return stream.Send(&runtimev1.AuditExportChunk{
			ExportId: exportID,
			Sequence: 0,
			Chunk:    nil,
			Eof:      true,
			MimeType: exportMimeType(req.GetFormat(), req.GetCompress()),
		})
	}
	for i, part := range chunks {
		eof := i == len(chunks)-1
		if err := stream.Send(&runtimev1.AuditExportChunk{
			ExportId: exportID,
			Sequence: uint64(i),
			Chunk:    part,
			Eof:      eof,
			MimeType: exportMimeType(req.GetFormat(), req.GetCompress()),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ListUsageStats(_ context.Context, req *runtimev1.ListUsageStatsRequest) (*runtimev1.ListUsageStatsResponse, error) {
	if s.store == nil {
		return &runtimev1.ListUsageStatsResponse{}, nil
	}
	return s.store.ListUsage(req)
}

func (s *Service) GetRuntimeHealth(context.Context, *runtimev1.GetRuntimeHealthRequest) (*runtimev1.GetRuntimeHealthResponse, error) {
	snapshot := s.state.Snapshot()
	return &runtimev1.GetRuntimeHealthResponse{
		Status:              mapStatus(snapshot.Status),
		Reason:              snapshot.Reason,
		QueueDepth:          snapshot.QueueDepth,
		ActiveInferenceJobs: snapshot.ActiveInferenceJobs,
		CpuMilli:            snapshot.CPUMilli,
		MemoryBytes:         snapshot.MemoryBytes,
		VramBytes:           snapshot.VRAMBytes,
		SampledAt:           timestamppb.New(snapshot.SampledAt),
	}, nil
}

func (s *Service) SubscribeRuntimeHealthEvents(_ *runtimev1.SubscribeRuntimeHealthEventsRequest, stream grpc.ServerStreamingServer[runtimev1.RuntimeHealthEvent]) error {
	updates, cancel := s.state.Subscribe(8)
	defer cancel()

	relay := streamutil.NewRelay(streamutil.RelayOptions[*runtimev1.RuntimeHealthEvent]{
		Budget:              8,
		MaxConsecutiveDrops: 3,
		CloseErr:            status.Error(codes.ResourceExhausted, "slow consumer"),
	})
	defer func() { relay.Close() }()

	done := make(chan error, 1)
	go func() {
		done <- relay.Run(stream.Context(), func(event *runtimev1.RuntimeHealthEvent) error {
			return stream.Send(event)
		})
	}()

	var seq uint64
	for {
		select {
		case <-stream.Context().Done():
			if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
				return nil
			}
			return rpcctx.ContextDoneError(stream.Context())
		case snapshot, ok := <-updates:
			if !ok {
				return nil
			}
			seq++
			event := &runtimev1.RuntimeHealthEvent{
				Sequence:            seq,
				Status:              mapStatus(snapshot.Status),
				Reason:              snapshot.Reason,
				QueueDepth:          snapshot.QueueDepth,
				ActiveInferenceJobs: snapshot.ActiveInferenceJobs,
				CpuMilli:            snapshot.CPUMilli,
				MemoryBytes:         snapshot.MemoryBytes,
				VramBytes:           snapshot.VRAMBytes,
				SampledAt:           timestamppb.New(snapshot.SampledAt),
			}
			if err := relay.Enqueue(event); err != nil {
				return err
			}
			if snapshot.Status == health.StatusStopping {
				relay.Close()
				if err := <-done; err != nil {
					return err
				}
				return status.Error(codes.Canceled, "runtime stopping")
			}
		}
	}
}

func mapStatus(statusValue health.Status) runtimev1.RuntimeHealthStatus {
	switch statusValue {
	case health.StatusStopped:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STOPPED
	case health.StatusStarting:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STARTING
	case health.StatusReady:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY
	case health.StatusDegraded:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_DEGRADED
	case health.StatusStopping:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_STOPPING
	default:
		return runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_UNSPECIFIED
	}
}

func marshalAuditEvents(events []*runtimev1.AuditEventRecord) ([]byte, error) {
	lines := make([][]byte, 0, len(events))
	for _, event := range events {
		payload, err := json.Marshal(event)
		if err != nil {
			return nil, err
		}
		lines = append(lines, append(payload, '\n'))
	}
	return joinBytes(lines), nil
}

func marshalAuditPayload(format string, events []*runtimev1.AuditEventRecord) ([]byte, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "ndjson", "jsonl":
		return marshalAuditEvents(events)
	case "json":
		return json.MarshalIndent(events, "", "  ")
	default:
		return nil, fmt.Errorf("unsupported export format %q", format)
	}
}

func gzipCompress(payload []byte) ([]byte, error) {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(payload); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func splitChunks(data []byte, chunkSize int) [][]byte {
	if chunkSize <= 0 {
		chunkSize = len(data)
	}
	if len(data) == 0 {
		return nil
	}

	out := make([][]byte, 0, (len(data)+chunkSize-1)/chunkSize)
	for start := 0; start < len(data); start += chunkSize {
		end := start + chunkSize
		if end > len(data) {
			end = len(data)
		}
		out = append(out, append([]byte(nil), data[start:end]...))
	}
	return out
}

func exportMimeType(format string, compressed bool) string {
	mime := "application/json"
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "", "ndjson", "jsonl":
		mime = "application/x-ndjson"
	case "json":
		mime = "application/json"
	}
	if compressed {
		return mime + "+gzip"
	}
	return mime
}

func joinBytes(parts [][]byte) []byte {
	total := 0
	for _, part := range parts {
		total += len(part)
	}
	out := make([]byte, 0, total)
	for _, part := range parts {
		out = append(out, part...)
	}
	return out
}
