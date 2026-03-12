package audit

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
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
	state         *health.State
	logger        *slog.Logger
	store         *auditlog.Store
	providerTrack *providerhealth.Tracker
}

func New(state *health.State, logger *slog.Logger, providerTrack *providerhealth.Tracker, store ...*auditlog.Store) *Service {
	var auditStore *auditlog.Store
	if len(store) > 0 {
		auditStore = store[0]
	}
	return &Service{
		state:         state,
		logger:        logger,
		store:         auditStore,
		providerTrack: providerTrack,
	}
}

func (s *Service) ListAuditEvents(_ context.Context, req *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	if s.store != nil {
		resp := s.store.ListEvents(req)
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
	}

	start := parsePageToken(req.GetPageToken())
	if start < 0 || start > len(filtered) {
		start = 0
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}

	nextToken := ""
	if end < len(filtered) {
		nextToken = formatPageToken(end)
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
	filterAppId := strings.TrimSpace(req.GetAppId())
	if filterAppId == "" {
		filterAppId = appIDFromContext(stream.Context())
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
	if len(payload) == 0 {
		payload = []byte("{}\n")
	}
	if req.GetCompress() {
		payload, err = gzipCompress(payload)
		if err != nil {
			return err
		}
	}

	const chunkSize = 1024
	chunks := splitChunks(payload, chunkSize)
	for i, part := range chunks {
		eof := i == len(chunks)-1
		if err := stream.Send(&runtimev1.AuditExportChunk{
			ExportId: exportID,
			Sequence: uint64(i + 1),
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
		resp := s.store.ListUsage(req)
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
	return &runtimev1.ListUsageStatsResponse{Records: []*runtimev1.UsageStatRecord{record}}, nil
}

func (s *Service) GetRuntimeHealth(context.Context, *runtimev1.GetRuntimeHealthRequest) (*runtimev1.GetRuntimeHealthResponse, error) {
	snapshot := s.state.Snapshot()
	return &runtimev1.GetRuntimeHealthResponse{
		Status:              mapStatus(snapshot.Status),
		Reason:              snapshot.Reason,
		QueueDepth:          snapshot.QueueDepth,
		ActiveWorkflows:     snapshot.ActiveWorkflows,
		ActiveInferenceJobs: snapshot.ActiveInferenceJobs,
		CpuMilli:            snapshot.CPUMilli,
		MemoryBytes:         snapshot.MemoryBytes,
		VramBytes:           snapshot.VRAMBytes,
		SampledAt:           timestamppb.New(snapshot.SampledAt),
	}, nil
}

func (s *Service) ListAIProviderHealth(context.Context, *runtimev1.ListAIProviderHealthRequest) (*runtimev1.ListAIProviderHealthResponse, error) {
	if s.providerTrack == nil {
		return &runtimev1.ListAIProviderHealthResponse{Providers: []*runtimev1.AIProviderHealthSnapshot{}}, nil
	}
	items := s.providerTrack.List()
	providers := make([]*runtimev1.AIProviderHealthSnapshot, 0, len(items)+1)
	for _, item := range projectProviderHealthSnapshots(items) {
		providers = append(providers, providerProjectionToSnapshot(item))
	}
	return &runtimev1.ListAIProviderHealthResponse{Providers: providers}, nil
}

func (s *Service) SubscribeAIProviderHealthEvents(_ *runtimev1.SubscribeAIProviderHealthEventsRequest, stream grpc.ServerStreamingServer[runtimev1.AIProviderHealthEvent]) error {
	if s.providerTrack == nil {
		return nil
	}

	var sequence uint64
	for _, item := range projectProviderHealthSnapshots(s.providerTrack.List()) {
		sequence++
		if err := stream.Send(providerProjectionToEvent(sequence, item)); err != nil {
			return err
		}
	}

	updates, cancel := s.providerTrack.Subscribe(16)
	defer cancel()

	for {
		select {
		case <-stream.Context().Done():
			if errors.Is(stream.Context().Err(), context.Canceled) {
				return nil
			}
			return stream.Context().Err()
		case item, ok := <-updates:
			if !ok {
				return nil
			}
			projections := []providerHealthProjection{providerHealthProjectionFromSnapshot(item)}
			if isCloudProviderName(item.Name) {
				cloudProjection, hasCloud := buildCloudAggregateProjection(collectCloudSnapshots(s.providerTrack.List()))
				if hasCloud {
					projections = []providerHealthProjection{cloudProjection}
				}
			}
			for _, projection := range projections {
				sequence++
				if err := stream.Send(providerProjectionToEvent(sequence, projection)); err != nil {
					return err
				}
			}
		}
	}
}

func (s *Service) SubscribeRuntimeHealthEvents(_ *runtimev1.SubscribeRuntimeHealthEventsRequest, stream grpc.ServerStreamingServer[runtimev1.RuntimeHealthEvent]) error {
	updates, cancel := s.state.Subscribe(8)
	defer cancel()

	var seq uint64
	for {
		select {
		case <-stream.Context().Done():
			if errors.Is(stream.Context().Err(), context.Canceled) {
				return nil
			}
			return stream.Context().Err()
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
				ActiveWorkflows:     snapshot.ActiveWorkflows,
				ActiveInferenceJobs: snapshot.ActiveInferenceJobs,
				CpuMilli:            snapshot.CPUMilli,
				MemoryBytes:         snapshot.MemoryBytes,
				VramBytes:           snapshot.VRAMBytes,
				SampledAt:           timestamppb.New(snapshot.SampledAt),
			}
			if err := stream.Send(event); err != nil {
				return err
			}
			if snapshot.Status == health.StatusStopping {
				return status.Error(codes.Canceled, "runtime stopping")
			}
		}
	}
}

func providerProjectionToEvent(sequence uint64, item providerHealthProjection) *runtimev1.AIProviderHealthEvent {
	event := &runtimev1.AIProviderHealthEvent{
		Sequence:            sequence,
		ProviderName:        strings.TrimSpace(item.Name),
		State:               strings.TrimSpace(item.State),
		Reason:              strings.TrimSpace(item.Reason),
		ConsecutiveFailures: int32(item.ConsecutiveFailures),
		SubHealth:           providerSubHealthToProto(item.SubHealth),
	}
	if !item.LastChangedAt.IsZero() {
		event.LastChangedAt = timestamppb.New(item.LastChangedAt.UTC())
	}
	if !item.LastCheckedAt.IsZero() {
		event.LastCheckedAt = timestamppb.New(item.LastCheckedAt.UTC())
	}
	return event
}

func providerProjectionToSnapshot(item providerHealthProjection) *runtimev1.AIProviderHealthSnapshot {
	record := &runtimev1.AIProviderHealthSnapshot{
		ProviderName:        strings.TrimSpace(item.Name),
		State:               strings.TrimSpace(item.State),
		Reason:              strings.TrimSpace(item.Reason),
		ConsecutiveFailures: int32(item.ConsecutiveFailures),
		SubHealth:           providerSubHealthToProto(item.SubHealth),
	}
	if !item.LastChangedAt.IsZero() {
		record.LastChangedAt = timestamppb.New(item.LastChangedAt.UTC())
	}
	if !item.LastCheckedAt.IsZero() {
		record.LastCheckedAt = timestamppb.New(item.LastCheckedAt.UTC())
	}
	return record
}

type providerHealthProjection struct {
	Name                string
	State               string
	Reason              string
	ConsecutiveFailures int
	LastChangedAt       time.Time
	LastCheckedAt       time.Time
	SubHealth           []providerhealth.Snapshot
}

func projectProviderHealthSnapshots(items []providerhealth.Snapshot) []providerHealthProjection {
	out := make([]providerHealthProjection, 0, len(items)+1)
	cloudItems := make([]providerhealth.Snapshot, 0, len(items))
	for _, item := range items {
		if isCloudProviderName(item.Name) {
			cloudItems = append(cloudItems, item)
			continue
		}
		out = append(out, providerHealthProjectionFromSnapshot(item))
	}
	if cloudProjection, ok := buildCloudAggregateProjection(cloudItems); ok {
		out = append(out, cloudProjection)
	}
	return out
}

func buildCloudAggregateProjection(items []providerhealth.Snapshot) (providerHealthProjection, bool) {
	if len(items) == 0 {
		return providerHealthProjection{}, false
	}

	aggregated := providerHealthProjection{
		Name:      "cloud-nimillm",
		State:     string(providerhealth.StateHealthy),
		SubHealth: append([]providerhealth.Snapshot(nil), items...),
	}
	for _, item := range items {
		if item.State == providerhealth.StateUnhealthy {
			aggregated.State = string(providerhealth.StateUnhealthy)
			if aggregated.Reason == "" {
				aggregated.Reason = strings.TrimSpace(item.LastReason)
			}
		}
		if item.ConsecutiveFailures > aggregated.ConsecutiveFailures {
			aggregated.ConsecutiveFailures = item.ConsecutiveFailures
		}
		if item.LastChangedAt.After(aggregated.LastChangedAt) {
			aggregated.LastChangedAt = item.LastChangedAt
		}
		if item.LastCheckedAt.After(aggregated.LastCheckedAt) {
			aggregated.LastCheckedAt = item.LastCheckedAt
		}
	}
	if aggregated.Reason == "" {
		for _, item := range items {
			if reason := strings.TrimSpace(item.LastReason); reason != "" {
				aggregated.Reason = reason
				break
			}
		}
	}
	return aggregated, true
}

func collectCloudSnapshots(items []providerhealth.Snapshot) []providerhealth.Snapshot {
	out := make([]providerhealth.Snapshot, 0, len(items))
	for _, item := range items {
		if isCloudProviderName(item.Name) {
			out = append(out, item)
		}
	}
	return out
}

func providerHealthProjectionFromSnapshot(item providerhealth.Snapshot) providerHealthProjection {
	return providerHealthProjection{
		Name:                strings.TrimSpace(item.Name),
		State:               string(item.State),
		Reason:              strings.TrimSpace(item.LastReason),
		ConsecutiveFailures: item.ConsecutiveFailures,
		LastChangedAt:       item.LastChangedAt,
		LastCheckedAt:       item.LastCheckedAt,
		SubHealth:           nil,
	}
}

func providerSubHealthToProto(items []providerhealth.Snapshot) []*runtimev1.AIProviderSubHealth {
	if len(items) == 0 {
		return nil
	}
	out := make([]*runtimev1.AIProviderSubHealth, 0, len(items))
	for _, item := range items {
		record := &runtimev1.AIProviderSubHealth{
			ProviderName:        strings.TrimSpace(item.Name),
			State:               string(item.State),
			Reason:              strings.TrimSpace(item.LastReason),
			ConsecutiveFailures: int32(item.ConsecutiveFailures),
		}
		if !item.LastChangedAt.IsZero() {
			record.LastChangedAt = timestamppb.New(item.LastChangedAt.UTC())
		}
		if !item.LastCheckedAt.IsZero() {
			record.LastCheckedAt = timestamppb.New(item.LastCheckedAt.UTC())
		}
		out = append(out, record)
	}
	return out
}

func isCloudProviderName(name string) bool {
	return strings.HasPrefix(strings.TrimSpace(strings.ToLower(name)), "cloud-")
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
		"status":               mapStatus(snapshot.Status).String(),
		"queue_depth":          snapshot.QueueDepth,
		"active_workflows":     snapshot.ActiveWorkflows,
		"active_inferenceJobs": snapshot.ActiveInferenceJobs,
		"cpu_milli":            snapshot.CPUMilli,
		"memory_bytes":         snapshot.MemoryBytes,
		"vram_bytes":           snapshot.VRAMBytes,
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

func parsePageToken(token string) int {
	if strings.TrimSpace(token) == "" {
		return 0
	}
	cursor, _, err := pagination.Decode(token)
	if err != nil {
		return 0
	}
	value, convErr := strconv.Atoi(cursor)
	if convErr != nil || value < 0 {
		return 0
	}
	return value
}

func formatPageToken(offset int) string {
	if offset <= 0 {
		return ""
	}
	return pagination.Encode(strconv.Itoa(offset), "")
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
		return [][]byte{{}}
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
