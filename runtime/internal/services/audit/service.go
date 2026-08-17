package audit

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/streamutil"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
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
	if s.store != nil {
		resp, err := s.store.ListEvents(req)
		if err != nil {
			return nil, err
		}
		if len(resp.GetEvents()) > 0 || req.GetPageToken() != "" {
			return resp, nil
		}
	}

	events := s.syntheticAuditEvents()
	filtered := make([]*runtimev1.AuditEventRecord, 0, len(events))
	for _, event := range events {
		if !matchesAuditFilter(event, req) {
			continue
		}
		filtered = append(filtered, event)
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	} else if pageSize > 200 {
		pageSize = 200
	}

	filterDigest := auditEventsPageDigest(req)
	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	if start > len(filtered) {
		start = 0
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	nextToken := ""
	if end < len(filtered) {
		nextToken = formatPageToken(end, filterDigest)
	}

	return &runtimev1.ListAuditEventsResponse{
		Events:        filtered[start:end],
		NextPageToken: nextToken,
	}, nil
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
	if s.store != nil {
		resp, err := s.store.ListUsage(req)
		if err != nil {
			return nil, err
		}
		if len(resp.GetRecords()) > 0 || req.GetPageToken() != "" {
			return resp, nil
		}
	}

	snapshot := s.state.Snapshot()
	now := snapshot.SampledAt
	if now.IsZero() {
		now = time.Now().UTC()
	}

	record := &runtimev1.UsageStatRecord{
		AppId:         "runtime",
		SubjectUserId: "",
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:      "runtime-daemon",
		Capability:    "runtime.health",
		ModelId:       "",
		Window:        normalizeWindow(req.GetWindow()),
		BucketStart:   timestamppb.New(now.Truncate(time.Minute)),
		RequestCount:  int64(maxInt32(snapshot.ActiveInferenceJobs, 1)),
		SuccessCount:  int64(maxInt32(snapshot.ActiveInferenceJobs, 1)),
		ErrorCount:    0,
		InputTokens:   0,
		OutputTokens:  0,
		ComputeMs:     int64(maxInt32(snapshot.QueueDepth, 0)),
		QueueWaitMs:   int64(maxInt32(snapshot.QueueDepth*5, 0)),
	}

	if req.GetCapability() != "" && req.GetCapability() != record.GetCapability() {
		return &runtimev1.ListUsageStatsResponse{Records: []*runtimev1.UsageStatRecord{}}, nil
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED && req.GetCallerKind() != record.GetCallerKind() {
		return &runtimev1.ListUsageStatsResponse{Records: []*runtimev1.UsageStatRecord{}}, nil
	}
	if req.GetCallerId() != "" && req.GetCallerId() != record.GetCallerId() {
		return &runtimev1.ListUsageStatsResponse{Records: []*runtimev1.UsageStatRecord{}}, nil
	}

	filtered := []*runtimev1.UsageStatRecord{record}
	filterDigest := usageStatsPageDigest(req, record.GetWindow())
	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	if start > len(filtered) {
		start = 0
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	} else if pageSize > 200 {
		pageSize = 200
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	nextToken := ""
	if end < len(filtered) {
		nextToken = formatPageToken(end, filterDigest)
	}

	return &runtimev1.ListUsageStatsResponse{
		Records:       filtered[start:end],
		NextPageToken: nextToken,
	}, nil
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

func (s *Service) syntheticAuditEvents() []*runtimev1.AuditEventRecord {
	snapshot := s.state.Snapshot()
	now := snapshot.SampledAt
	if now.IsZero() {
		now = time.Now().UTC()
	}

	payload, _ := structpb.NewStruct(map[string]any{
		"status":                mapStatus(snapshot.Status).String(),
		"queue_depth":           snapshot.QueueDepth,
		"active_inference_jobs": snapshot.ActiveInferenceJobs,
		"cpu_milli":             snapshot.CPUMilli,
		"memory_bytes":          snapshot.MemoryBytes,
		"vram_bytes":            snapshot.VRAMBytes,
	})

	record := &runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         "runtime",
		SubjectUserId: "",
		Domain:        "runtime.health",
		Operation:     "health.snapshot",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(now),
		Payload:       payload,
		CallerKind:    runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
		CallerId:      "runtime-daemon",
		SurfaceId:     "health",
	}
	return []*runtimev1.AuditEventRecord{record}
}

func matchesAuditFilter(event *runtimev1.AuditEventRecord, req *runtimev1.ListAuditEventsRequest) bool {
	if req.GetAppId() != "" && req.GetAppId() != event.GetAppId() {
		return false
	}
	if req.GetSubjectUserId() != "" && req.GetSubjectUserId() != event.GetSubjectUserId() {
		return false
	}
	if req.GetDomain() != "" && req.GetDomain() != event.GetDomain() {
		return false
	}
	if req.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && req.GetReasonCode() != event.GetReasonCode() {
		return false
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED && req.GetCallerKind() != event.GetCallerKind() {
		return false
	}
	if req.GetCallerId() != "" && req.GetCallerId() != event.GetCallerId() {
		return false
	}
	if req.GetFromTime() != nil && event.GetTimestamp().AsTime().Before(req.GetFromTime().AsTime()) {
		return false
	}
	if req.GetToTime() != nil && event.GetTimestamp().AsTime().After(req.GetToTime().AsTime()) {
		return false
	}
	return true
}

func parsePageToken(token string, filterDigest string) (int, error) {
	if strings.TrimSpace(token) == "" {
		return 0, nil
	}
	cursor, err := pagination.ValidatePageToken(token, filterDigest)
	if err != nil {
		return 0, err
	}
	value, convErr := strconv.Atoi(cursor)
	if convErr != nil {
		return 0, grpcerr.WrapWithReasonCode(
			codes.InvalidArgument,
			runtimev1.ReasonCode_PAGE_TOKEN_INVALID,
			convErr,
			grpcerr.ReasonOptions{
				ActionHint: "provide_valid_page_token",
				Message:    "audit page token cursor is invalid",
			},
		)
	}
	if value < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID)
	}
	return value, nil
}

func formatPageToken(offset int, filterDigest string) string {
	if offset <= 0 {
		return ""
	}
	return pagination.Encode(strconv.Itoa(offset), filterDigest)
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

func auditEventsPageDigest(req *runtimev1.ListAuditEventsRequest) string {
	if req == nil {
		return pagination.FilterDigest()
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		strings.TrimSpace(req.GetDomain()),
		req.GetReasonCode().String(),
		req.GetCallerKind().String(),
		strings.TrimSpace(req.GetCallerId()),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
	)
}

func usageStatsPageDigest(req *runtimev1.ListUsageStatsRequest, window runtimev1.UsageWindow) string {
	if req == nil {
		return pagination.FilterDigest(window.String())
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetSubjectUserId()),
		req.GetCallerKind().String(),
		strings.TrimSpace(req.GetCallerId()),
		strings.TrimSpace(req.GetCapability()),
		strings.TrimSpace(req.GetModelId()),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
		window.String(),
	)
}

func formatPageTime(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().UTC().Format(time.RFC3339Nano)
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

func normalizeWindow(window runtimev1.UsageWindow) runtimev1.UsageWindow {
	if window == runtimev1.UsageWindow_USAGE_WINDOW_UNSPECIFIED {
		return runtimev1.UsageWindow_USAGE_WINDOW_MINUTE
	}
	return window
}

func maxInt32(value int32, fallback int32) int32 {
	if value > fallback {
		return value
	}
	return fallback
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
