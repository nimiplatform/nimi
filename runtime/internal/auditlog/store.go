package auditlog

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditredaction"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/pagination"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultMaxEvents = 20000
	defaultMaxUsage  = 50000
)

// UsageInput is a write contract for runtime usage accounting.
type UsageInput struct {
	Timestamp     time.Time
	AppID         string
	SubjectUserID string
	CallerKind    runtimev1.CallerKind
	CallerID      string
	Capability    string
	ModelID       string
	Success       bool
	Usage         *runtimev1.UsageStats
	QueueWaitMs   int64
}

// Store is an in-memory audit and usage sink.
type Store struct {
	mu        sync.RWMutex
	maxEvents int
	maxUsage  int
	events    []*runtimev1.AuditEventRecord
	eventHead int
	usage     []UsageInput
}

func New(maxEvents int, maxUsage int) *Store {
	if maxEvents <= 0 {
		maxEvents = defaultMaxEvents
	}
	if maxUsage <= 0 {
		maxUsage = defaultMaxUsage
	}
	return &Store{
		maxEvents: maxEvents,
		maxUsage:  maxUsage,
		events:    make([]*runtimev1.AuditEventRecord, 0, maxEvents),
		usage:     make([]UsageInput, 0, maxUsage),
	}
}

// AppendEventChecked is the fail-closed write contract used by security
// decision planes. Legacy best-effort emitters may continue to use AppendEvent.
func (s *Store) AppendEventChecked(event *runtimev1.AuditEventRecord) error {
	if s == nil {
		return fmt.Errorf("audit store is unavailable")
	}
	if event == nil || event.GetTimestamp() == nil {
		return fmt.Errorf("audit event and timestamp are required")
	}
	if err := event.GetTimestamp().CheckValid(); err != nil {
		return fmt.Errorf("audit event timestamp: %w", err)
	}
	s.AppendEvent(event)
	return nil
}

func (s *Store) AppendEvent(event *runtimev1.AuditEventRecord) {
	if event == nil {
		return
	}
	eventCopy := cloneAuditEvent(event)
	if eventCopy.GetAuditId() == "" {
		eventCopy.AuditId = ulid.Make().String()
	}
	if eventCopy.GetTimestamp() == nil {
		eventCopy.Timestamp = timestamppb.New(time.Now().UTC())
	}
	if eventCopy.GetTraceId() == "" {
		eventCopy.TraceId = ulid.Make().String()
	}
	// K-AUDIT-017: mask sensitive fields in payload before storage.
	if eventCopy.Payload != nil {
		maskSensitiveFields(eventCopy.Payload.GetFields())
	}

	s.mu.Lock()
	if len(s.events) == s.maxEvents {
		s.events[s.eventHead] = eventCopy
		s.eventHead = (s.eventHead + 1) % s.maxEvents
	} else {
		s.events = append(s.events, eventCopy)
	}
	s.mu.Unlock()
}

func (s *Store) RecordUsage(input UsageInput) {
	if strings.TrimSpace(input.Capability) == "" {
		return
	}
	ts := input.Timestamp.UTC()
	if ts.IsZero() {
		ts = time.Now().UTC()
	}

	item := UsageInput{
		Timestamp:     ts,
		AppID:         strings.TrimSpace(input.AppID),
		SubjectUserID: strings.TrimSpace(input.SubjectUserID),
		CallerKind:    input.CallerKind,
		CallerID:      strings.TrimSpace(input.CallerID),
		Capability:    strings.TrimSpace(input.Capability),
		ModelID:       strings.TrimSpace(input.ModelID),
		Success:       input.Success,
		Usage:         cloneUsage(input.Usage),
		QueueWaitMs:   input.QueueWaitMs,
	}

	s.mu.Lock()
	if len(s.usage) == s.maxUsage {
		copy(s.usage, s.usage[1:])
		s.usage[len(s.usage)-1] = item
	} else {
		s.usage = append(s.usage, item)
	}
	s.mu.Unlock()
}

func (s *Store) ListEvents(req *runtimev1.ListAuditEventsRequest) (*runtimev1.ListAuditEventsResponse, error) {
	filterDigest := eventFilterDigest(req)
	s.mu.RLock()
	ordered := s.snapshotEventsLocked()
	filtered := make([]*runtimev1.AuditEventRecord, 0, len(ordered))
	for _, event := range ordered {
		if !matchesEventFilter(event, req) {
			continue
		}
		filtered = append(filtered, cloneAuditEvent(event))
	}
	s.mu.RUnlock()

	sort.Slice(filtered, func(i, j int) bool {
		left := filtered[i].GetTimestamp().AsTime()
		right := filtered[j].GetTimestamp().AsTime()
		if left.Equal(right) {
			return filtered[i].GetAuditId() > filtered[j].GetAuditId()
		}
		return left.After(right)
	})

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
	}
	if pageSize > 200 {
		pageSize = 200
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	nextToken := ""
	if end < len(filtered) {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}

	return &runtimev1.ListAuditEventsResponse{
		Events:        filtered[start:end],
		NextPageToken: nextToken,
	}, nil
}

// ListDesktopEvents applies the K-AUDIT-024 filter set and projects the exact
// Desktop-safe wire shape before any event leaves the canonical audit store.
func (s *Store) ListDesktopEvents(req *runtimev1.ListDesktopAuditEventsRequest) (*runtimev1.ListDesktopAuditEventsResponse, error) {
	filterDigest := desktopEventFilterDigest(req)
	s.mu.RLock()
	ordered := s.snapshotEventsLocked()
	filtered := make([]*runtimev1.DesktopAuditEventProjection, 0, len(ordered))
	for _, event := range ordered {
		if !matchesDesktopEventFilter(event, req) {
			continue
		}
		filtered = append(filtered, projectDesktopAuditEvent(event))
	}
	s.mu.RUnlock()

	sort.Slice(filtered, func(i, j int) bool {
		left := filtered[i].GetTimestamp().AsTime()
		right := filtered[j].GetTimestamp().AsTime()
		if left.Equal(right) {
			return filtered[i].GetAuditId() > filtered[j].GetAuditId()
		}
		return left.After(right)
	})

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
	}
	if pageSize > 100 {
		pageSize = 100
	}
	end := start + pageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	nextToken := ""
	if end < len(filtered) {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}

	return &runtimev1.ListDesktopAuditEventsResponse{
		Events:        filtered[start:end],
		NextPageToken: nextToken,
	}, nil
}

func (s *Store) snapshotEventsLocked() []*runtimev1.AuditEventRecord {
	if len(s.events) == 0 {
		return nil
	}
	if len(s.events) < s.maxEvents || s.eventHead == 0 {
		return s.events
	}
	ordered := make([]*runtimev1.AuditEventRecord, 0, len(s.events))
	ordered = append(ordered, s.events[s.eventHead:]...)
	ordered = append(ordered, s.events[:s.eventHead]...)
	return ordered
}

func (s *Store) ListUsage(req *runtimev1.ListUsageStatsRequest) (*runtimev1.ListUsageStatsResponse, error) {
	window := normalizeWindow(req.GetWindow())
	filterDigest := usageFilterDigest(req, window)
	type usageKey struct {
		AppID         string
		SubjectUserID string
		CallerKind    runtimev1.CallerKind
		CallerID      string
		Capability    string
		ModelID       string
		Window        runtimev1.UsageWindow
		BucketStart   time.Time
	}

	agg := make(map[usageKey]*runtimev1.UsageStatRecord)
	s.mu.RLock()
	for _, sample := range s.usage {
		if !matchesUsageFilter(sample, req) {
			continue
		}
		bucket := truncateByWindow(sample.Timestamp, window)
		key := usageKey{
			AppID:         sample.AppID,
			SubjectUserID: sample.SubjectUserID,
			CallerKind:    sample.CallerKind,
			CallerID:      sample.CallerID,
			Capability:    sample.Capability,
			ModelID:       sample.ModelID,
			Window:        window,
			BucketStart:   bucket,
		}
		item, exists := agg[key]
		if !exists {
			item = &runtimev1.UsageStatRecord{
				AppId:         sample.AppID,
				SubjectUserId: sample.SubjectUserID,
				CallerKind:    sample.CallerKind,
				CallerId:      sample.CallerID,
				Capability:    sample.Capability,
				ModelId:       sample.ModelID,
				Window:        window,
				BucketStart:   timestamppb.New(bucket),
			}
			agg[key] = item
		}
		item.RequestCount++
		if sample.Success {
			item.SuccessCount++
		} else {
			item.ErrorCount++
		}
		item.QueueWaitMs += sample.QueueWaitMs
		if sample.Usage != nil {
			item.InputTokens += sample.Usage.GetInputTokens()
			item.OutputTokens += sample.Usage.GetOutputTokens()
			item.ComputeMs += sample.Usage.GetComputeMs()
		}
	}
	s.mu.RUnlock()

	records := make([]*runtimev1.UsageStatRecord, 0, len(agg))
	for _, item := range agg {
		records = append(records, item)
	}
	sort.Slice(records, func(i, j int) bool {
		left := records[i].GetBucketStart().AsTime()
		right := records[j].GetBucketStart().AsTime()
		if left.Equal(right) {
			if records[i].GetCapability() == records[j].GetCapability() {
				return records[i].GetCallerId() < records[j].GetCallerId()
			}
			return records[i].GetCapability() < records[j].GetCapability()
		}
		return left.After(right)
	})

	start, err := parsePageToken(req.GetPageToken(), filterDigest)
	if err != nil {
		return nil, err
	}
	if start > len(records) {
		start = 0
	}

	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	end := start + pageSize
	if end > len(records) {
		end = len(records)
	}
	nextToken := ""
	if end < len(records) {
		nextToken = pagination.Encode(strconv.Itoa(end), filterDigest)
	}

	return &runtimev1.ListUsageStatsResponse{
		Records:       records[start:end],
		NextPageToken: nextToken,
	}, nil
}

func matchesEventFilter(event *runtimev1.AuditEventRecord, req *runtimev1.ListAuditEventsRequest) bool {
	if req == nil {
		return true
	}
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

func matchesDesktopEventFilter(event *runtimev1.AuditEventRecord, req *runtimev1.ListDesktopAuditEventsRequest) bool {
	if req == nil {
		return false
	}
	if req.GetTraceId() != "" && req.GetTraceId() != event.GetTraceId() {
		return false
	}
	if req.GetRequestId() != "" && req.GetRequestId() != event.GetRequestId() {
		return false
	}
	if req.GetAppId() != "" && req.GetAppId() != event.GetAppId() {
		return false
	}
	if req.GetDomain() != "" && req.GetDomain() != event.GetDomain() {
		return false
	}
	if req.GetOperation() != "" && req.GetOperation() != event.GetOperation() {
		return false
	}
	if req.GetReasonCode() != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED && req.GetReasonCode() != event.GetReasonCode() {
		return false
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED && req.GetCallerKind() != event.GetCallerKind() {
		return false
	}
	if event.GetTimestamp() == nil {
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

func projectDesktopAuditEvent(event *runtimev1.AuditEventRecord) *runtimev1.DesktopAuditEventProjection {
	var timestamp *timestamppb.Timestamp
	if event.GetTimestamp() != nil {
		timestamp = timestamppb.New(event.GetTimestamp().AsTime())
	}
	return &runtimev1.DesktopAuditEventProjection{
		AuditId:    event.GetAuditId(),
		RequestId:  event.GetRequestId(),
		AppId:      event.GetAppId(),
		Domain:     event.GetDomain(),
		Operation:  event.GetOperation(),
		ReasonCode: event.GetReasonCode(),
		TraceId:    event.GetTraceId(),
		Timestamp:  timestamp,
		CallerKind: event.GetCallerKind(),
	}
}

func matchesUsageFilter(sample UsageInput, req *runtimev1.ListUsageStatsRequest) bool {
	if req == nil {
		return true
	}
	if req.GetAppId() != "" && req.GetAppId() != sample.AppID {
		return false
	}
	if req.GetSubjectUserId() != "" && req.GetSubjectUserId() != sample.SubjectUserID {
		return false
	}
	if req.GetCallerKind() != runtimev1.CallerKind_CALLER_KIND_UNSPECIFIED && req.GetCallerKind() != sample.CallerKind {
		return false
	}
	if req.GetCallerId() != "" && req.GetCallerId() != sample.CallerID {
		return false
	}
	if req.GetCapability() != "" && req.GetCapability() != sample.Capability {
		return false
	}
	if req.GetModelId() != "" && req.GetModelId() != sample.ModelID {
		return false
	}
	if req.GetFromTime() != nil && sample.Timestamp.Before(req.GetFromTime().AsTime()) {
		return false
	}
	if req.GetToTime() != nil && sample.Timestamp.After(req.GetToTime().AsTime()) {
		return false
	}
	return true
}

func normalizeWindow(window runtimev1.UsageWindow) runtimev1.UsageWindow {
	if window == runtimev1.UsageWindow_USAGE_WINDOW_UNSPECIFIED {
		return runtimev1.UsageWindow_USAGE_WINDOW_MINUTE
	}
	return window
}

func truncateByWindow(ts time.Time, window runtimev1.UsageWindow) time.Time {
	switch window {
	case runtimev1.UsageWindow_USAGE_WINDOW_DAY:
		y, m, d := ts.UTC().Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	case runtimev1.UsageWindow_USAGE_WINDOW_HOUR:
		return ts.UTC().Truncate(time.Hour)
	default:
		return ts.UTC().Truncate(time.Minute)
	}
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
	if convErr != nil || value < 0 {
		return 0, fmt.Errorf(
			"auditlog.parsePageToken: %w",
			grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PAGE_TOKEN_INVALID),
		)
	}
	return value, nil
}

func cloneAuditEvent(input *runtimev1.AuditEventRecord) *runtimev1.AuditEventRecord {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	recordCopy, ok := cloned.(*runtimev1.AuditEventRecord)
	if !ok {
		return nil
	}
	return recordCopy
}

func cloneUsage(input *runtimev1.UsageStats) *runtimev1.UsageStats {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	statsCopy, ok := cloned.(*runtimev1.UsageStats)
	if !ok {
		return nil
	}
	return statsCopy
}

func isSensitiveKey(key string) bool {
	return auditredaction.IsSensitiveKey(key)
}

func maskValue(value string) string {
	return auditredaction.MaskValue(value)
}

func maskSensitiveFields(fields map[string]*structpb.Value) {
	auditredaction.MaskSensitiveFields(fields)
}

func eventFilterDigest(req *runtimev1.ListAuditEventsRequest) string {
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

func desktopEventFilterDigest(req *runtimev1.ListDesktopAuditEventsRequest) string {
	if req == nil {
		return pagination.FilterDigest()
	}
	return pagination.FilterDigest(
		strings.TrimSpace(req.GetTraceId()),
		strings.TrimSpace(req.GetRequestId()),
		strings.TrimSpace(req.GetAppId()),
		strings.TrimSpace(req.GetDomain()),
		strings.TrimSpace(req.GetOperation()),
		req.GetReasonCode().String(),
		req.GetCallerKind().String(),
		formatPageTime(req.GetFromTime()),
		formatPageTime(req.GetToTime()),
	)
}

func usageFilterDigest(req *runtimev1.ListUsageStatsRequest, window runtimev1.UsageWindow) string {
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
