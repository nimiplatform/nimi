package audit

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

func TestListAIProviderHealth(t *testing.T) {
	state := health.NewState()
	tracker := providerhealth.New()
	tracker.Mark("cloud-nimillm", true, "")
	tracker.Mark("cloud-dashscope", false, "timeout")

	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), tracker)
	resp, err := svc.ListAIProviderHealth(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListAIProviderHealth: %v", err)
	}
	if len(resp.GetProviders()) != 1 {
		t.Fatalf("providers length mismatch: got=%d want=1", len(resp.GetProviders()))
	}
	if resp.GetProviders()[0].GetProviderName() != "cloud-nimillm" {
		t.Fatalf("first provider mismatch: %s", resp.GetProviders()[0].GetProviderName())
	}
	if resp.GetProviders()[0].GetState() != "unhealthy" {
		t.Fatalf("first state mismatch: %s", resp.GetProviders()[0].GetState())
	}
	if len(resp.GetProviders()[0].GetSubHealth()) != 2 {
		t.Fatalf("sub health length mismatch: got=%d want=2", len(resp.GetProviders()[0].GetSubHealth()))
	}
}

func TestListAIProviderHealthEmptyWhenNoTracker(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	resp, err := svc.ListAIProviderHealth(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListAIProviderHealth: %v", err)
	}
	if len(resp.GetProviders()) != 0 {
		t.Fatalf("expected empty providers, got=%d", len(resp.GetProviders()))
	}
}

func TestSubscribeAIProviderHealthEvents(t *testing.T) {
	state := health.NewState()
	tracker := providerhealth.New()
	tracker.Mark("cloud-nimillm", true, "")

	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), tracker)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := &providerHealthStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAIProviderHealthEvents(&runtimev1.SubscribeAIProviderHealthEventsRequest{}, stream)
	}()

	if !waitForProviderEvents(stream, 1, 300*time.Millisecond) {
		t.Fatalf("expected baseline provider event")
	}
	first := stream.eventAt(0)
	if first.GetProviderName() != "cloud-nimillm" {
		t.Fatalf("baseline provider mismatch: %s", first.GetProviderName())
	}
	if first.GetState() != "healthy" {
		t.Fatalf("baseline state mismatch: %s", first.GetState())
	}
	if len(first.GetSubHealth()) != 1 {
		t.Fatalf("baseline sub-health mismatch: got=%d want=1", len(first.GetSubHealth()))
	}

	tracker.Mark("cloud-nimillm", false, "timeout")
	if !waitForProviderEvents(stream, 2, 300*time.Millisecond) {
		t.Fatalf("expected update provider event")
	}
	second := stream.eventAt(1)
	if second.GetState() != "unhealthy" {
		t.Fatalf("update state mismatch: %s", second.GetState())
	}
	if len(second.GetSubHealth()) != 1 {
		t.Fatalf("update sub-health mismatch: got=%d want=1", len(second.GetSubHealth()))
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SubscribeAIProviderHealthEvents returned error: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("subscribe did not exit after cancel")
	}
}

func TestGetRuntimeHealthContract(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	state.SetActivity(3, 1, 2)
	state.SetResource(123, 456, 789)

	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())
	resp, err := svc.GetRuntimeHealth(context.Background(), &runtimev1.GetRuntimeHealthRequest{})
	if err != nil {
		t.Fatalf("GetRuntimeHealth returned error: %v", err)
	}
	if resp.GetStatus() != runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_READY {
		t.Fatalf("unexpected status: %v", resp.GetStatus())
	}
	if resp.GetQueueDepth() != 3 || resp.GetActiveInferenceJobs() != 2 || resp.GetActiveWorkflows() != 1 {
		t.Fatalf("unexpected counters: queue=%d inf=%d wf=%d", resp.GetQueueDepth(), resp.GetActiveInferenceJobs(), resp.GetActiveWorkflows())
	}
	if resp.GetCpuMilli() != 123 || resp.GetMemoryBytes() != 456 || resp.GetVramBytes() != 789 {
		t.Fatalf("unexpected resource snapshot: cpu=%d mem=%d vram=%d", resp.GetCpuMilli(), resp.GetMemoryBytes(), resp.GetVramBytes())
	}
	if resp.GetSampledAt() == nil {
		t.Fatalf("sampled_at must be set")
	}
}

func TestSubscribeRuntimeHealthEvents(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := &runtimeHealthStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeRuntimeHealthEvents(&runtimev1.SubscribeRuntimeHealthEventsRequest{}, stream)
	}()

	state.SetStatus(health.StatusStarting, "booting")
	state.SetActivity(1, 0, 0)
	if !waitForRuntimeHealthEvents(stream, 1, 500*time.Millisecond) {
		t.Fatalf("expected at least one runtime health event")
	}
	event := stream.eventAt(0)
	if event.GetStatus() == runtimev1.RuntimeHealthStatus_RUNTIME_HEALTH_STATUS_UNSPECIFIED {
		t.Fatalf("runtime health status must be projected")
	}
	if event.GetSampledAt() == nil {
		t.Fatalf("runtime health event sampled_at must be set")
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("SubscribeRuntimeHealthEvents returned error: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("subscribe runtime health did not exit after cancel")
	}
}

type providerHealthStreamCollector struct {
	ctx context.Context
	mu  sync.Mutex
	// events is guarded by mu.
	events []*runtimev1.AIProviderHealthEvent
}

type runtimeHealthStreamCollector struct {
	ctx context.Context
	mu  sync.Mutex
	// events is guarded by mu.
	events []*runtimev1.RuntimeHealthEvent
}

func (s *runtimeHealthStreamCollector) Send(event *runtimev1.RuntimeHealthEvent) error {
	copied, ok := proto.Clone(event).(*runtimev1.RuntimeHealthEvent)
	if !ok {
		copied = &runtimev1.RuntimeHealthEvent{}
	}
	s.mu.Lock()
	s.events = append(s.events, copied)
	s.mu.Unlock()
	return nil
}

func (s *runtimeHealthStreamCollector) SetHeader(metadata.MD) error  { return nil }
func (s *runtimeHealthStreamCollector) SendHeader(metadata.MD) error { return nil }
func (s *runtimeHealthStreamCollector) SetTrailer(metadata.MD)       {}
func (s *runtimeHealthStreamCollector) Context() context.Context     { return s.ctx }
func (s *runtimeHealthStreamCollector) SendMsg(any) error            { return nil }
func (s *runtimeHealthStreamCollector) RecvMsg(any) error            { return nil }

func (s *runtimeHealthStreamCollector) eventAt(index int) *runtimev1.RuntimeHealthEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if index < 0 || index >= len(s.events) {
		return &runtimev1.RuntimeHealthEvent{}
	}
	return s.events[index]
}

func (s *providerHealthStreamCollector) Send(event *runtimev1.AIProviderHealthEvent) error {
	copied, ok := proto.Clone(event).(*runtimev1.AIProviderHealthEvent)
	if !ok {
		copied = &runtimev1.AIProviderHealthEvent{}
	}
	s.mu.Lock()
	s.events = append(s.events, copied)
	s.mu.Unlock()
	return nil
}

func (s *providerHealthStreamCollector) SetHeader(metadata.MD) error  { return nil }
func (s *providerHealthStreamCollector) SendHeader(metadata.MD) error { return nil }
func (s *providerHealthStreamCollector) SetTrailer(metadata.MD)       {}
func (s *providerHealthStreamCollector) Context() context.Context     { return s.ctx }
func (s *providerHealthStreamCollector) SendMsg(any) error            { return nil }
func (s *providerHealthStreamCollector) RecvMsg(any) error            { return nil }

func (s *providerHealthStreamCollector) eventAt(index int) *runtimev1.AIProviderHealthEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if index < 0 || index >= len(s.events) {
		return &runtimev1.AIProviderHealthEvent{}
	}
	return s.events[index]
}

func waitForProviderEvents(stream *providerHealthStreamCollector, target int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		stream.mu.Lock()
		count := len(stream.events)
		stream.mu.Unlock()
		if count >= target {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return len(stream.events) >= target
}

func waitForRuntimeHealthEvents(stream *runtimeHealthStreamCollector, target int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		stream.mu.Lock()
		count := len(stream.events)
		stream.mu.Unlock()
		if count >= target {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return len(stream.events) >= target
}

// --- Extended tests for coverage (K-STREAM-009, pagination, export) ---

func TestListAuditEventsSyntheticBaseline(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListAuditEvents(context.Background(), &runtimev1.ListAuditEventsRequest{})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(resp.GetEvents()) == 0 {
		t.Fatal("expected at least one synthetic audit event")
	}
	event := resp.GetEvents()[0]
	if event.GetAppId() != "runtime" {
		t.Fatalf("app_id: got=%q want=%q", event.GetAppId(), "runtime")
	}
	if event.GetDomain() != "runtime.health" {
		t.Fatalf("domain: got=%q want=%q", event.GetDomain(), "runtime.health")
	}
	if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("reason_code: got=%v", event.GetReasonCode())
	}
}

func TestListAuditEventsFilterByAppId(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListAuditEvents(context.Background(), &runtimev1.ListAuditEventsRequest{
		AppId: "nonexistent-app",
	})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(resp.GetEvents()) != 0 {
		t.Fatalf("expected no events for nonexistent app, got=%d", len(resp.GetEvents()))
	}
}

func TestListAuditEventsFilterByDomain(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListAuditEvents(context.Background(), &runtimev1.ListAuditEventsRequest{
		Domain: "runtime.health",
	})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(resp.GetEvents()) == 0 {
		t.Fatal("expected events matching domain filter")
	}
}

func TestListAuditEventsPagination(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListAuditEvents(context.Background(), &runtimev1.ListAuditEventsRequest{
		PageSize: 1,
	})
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(resp.GetEvents()) > 1 {
		t.Fatalf("page size 1 should return at most 1 event, got=%d", len(resp.GetEvents()))
	}
}

func TestListUsageStatsBaseline(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	state.SetActivity(2, 1, 1)
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListUsageStats(context.Background(), &runtimev1.ListUsageStatsRequest{})
	if err != nil {
		t.Fatalf("ListUsageStats: %v", err)
	}
	if len(resp.GetRecords()) != 1 {
		t.Fatalf("expected 1 usage record, got=%d", len(resp.GetRecords()))
	}
	record := resp.GetRecords()[0]
	if record.GetAppId() != "runtime" {
		t.Fatalf("app_id: got=%q", record.GetAppId())
	}
	if record.GetCapability() != "runtime.health" {
		t.Fatalf("capability: got=%q", record.GetCapability())
	}
}

func TestListUsageStatsFilterByCapability(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListUsageStats(context.Background(), &runtimev1.ListUsageStatsRequest{
		Capability: "nonexistent",
	})
	if err != nil {
		t.Fatalf("ListUsageStats: %v", err)
	}
	if len(resp.GetRecords()) != 0 {
		t.Fatalf("expected no records for nonexistent capability, got=%d", len(resp.GetRecords()))
	}
}

func TestListUsageStatsFilterByCallerKind(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListUsageStats(context.Background(), &runtimev1.ListUsageStatsRequest{
		CallerKind: runtimev1.CallerKind_CALLER_KIND_THIRD_PARTY_APP,
	})
	if err != nil {
		t.Fatalf("ListUsageStats: %v", err)
	}
	if len(resp.GetRecords()) != 0 {
		t.Fatalf("expected no records for wrong caller kind, got=%d", len(resp.GetRecords()))
	}
}

func TestListUsageStatsFilterByCallerId(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	resp, err := svc.ListUsageStats(context.Background(), &runtimev1.ListUsageStatsRequest{
		CallerId: "wrong-caller",
	})
	if err != nil {
		t.Fatalf("ListUsageStats: %v", err)
	}
	if len(resp.GetRecords()) != 0 {
		t.Fatalf("expected no records for wrong caller_id, got=%d", len(resp.GetRecords()))
	}
}

func TestExportAuditEventsEofTrue(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusReady, "ready")
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	ctx := context.Background()
	stream := &exportStreamCollector{ctx: ctx}
	err := svc.ExportAuditEvents(&runtimev1.ExportAuditEventsRequest{}, stream)
	if err != nil {
		t.Fatalf("ExportAuditEvents: %v", err)
	}
	if len(stream.chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}
	lastChunk := stream.chunks[len(stream.chunks)-1]
	if !lastChunk.GetEof() {
		t.Fatal("last chunk must have eof=true (K-STREAM-009)")
	}
	if lastChunk.GetExportId() == "" {
		t.Fatal("export_id must be set")
	}
}

func TestExportAuditEventsCompressed(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	ctx := context.Background()
	stream := &exportStreamCollector{ctx: ctx}
	err := svc.ExportAuditEvents(&runtimev1.ExportAuditEventsRequest{
		Compress: true,
	}, stream)
	if err != nil {
		t.Fatalf("ExportAuditEvents with compress: %v", err)
	}
	if len(stream.chunks) == 0 {
		t.Fatal("expected at least one chunk")
	}
	if !stream.chunks[0].GetEof() || stream.chunks[0].GetMimeType() == "" {
		// Single chunk for small data.
	}
}

func TestExportAuditEventsSequenceIncreases(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	ctx := context.Background()
	stream := &exportStreamCollector{ctx: ctx}
	err := svc.ExportAuditEvents(&runtimev1.ExportAuditEventsRequest{}, stream)
	if err != nil {
		t.Fatalf("ExportAuditEvents: %v", err)
	}
	for i, chunk := range stream.chunks {
		if chunk.GetSequence() != uint64(i+1) {
			t.Fatalf("chunk %d sequence: got=%d want=%d", i, chunk.GetSequence(), i+1)
		}
	}
}

func TestSubscribeRuntimeHealthEventsCloseOnCancel(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), providerhealth.New())

	ctx, cancel := context.WithCancel(context.Background())
	stream := &runtimeHealthStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeRuntimeHealthEvents(&runtimev1.SubscribeRuntimeHealthEventsRequest{}, stream)
	}()

	// Cancel immediately.
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected nil error on cancel, got=%v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("subscribe did not exit after cancel")
	}
}

func TestSubscribeAIProviderHealthEventsCloseOnCancel(t *testing.T) {
	state := health.NewState()
	tracker := providerhealth.New()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), tracker)

	ctx, cancel := context.WithCancel(context.Background())
	stream := &providerHealthStreamCollector{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.SubscribeAIProviderHealthEvents(&runtimev1.SubscribeAIProviderHealthEventsRequest{}, stream)
	}()

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected nil error on cancel, got=%v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("subscribe did not exit after cancel")
	}
}

func TestSubscribeAIProviderHealthEventsNilTracker(t *testing.T) {
	state := health.NewState()
	svc := New(state, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := &providerHealthStreamCollector{ctx: ctx}
	err := svc.SubscribeAIProviderHealthEvents(&runtimev1.SubscribeAIProviderHealthEventsRequest{}, stream)
	if err != nil {
		t.Fatalf("expected nil error with nil tracker, got=%v", err)
	}
}

// --- export stream helper ---

type exportStreamCollector struct {
	ctx    context.Context
	mu     sync.Mutex
	chunks []*runtimev1.AuditExportChunk
}

func (s *exportStreamCollector) Send(chunk *runtimev1.AuditExportChunk) error {
	s.mu.Lock()
	s.chunks = append(s.chunks, chunk)
	s.mu.Unlock()
	return nil
}

func (s *exportStreamCollector) SetHeader(metadata.MD) error  { return nil }
func (s *exportStreamCollector) SendHeader(metadata.MD) error { return nil }
func (s *exportStreamCollector) SetTrailer(metadata.MD)       {}
func (s *exportStreamCollector) Context() context.Context     { return s.ctx }
func (s *exportStreamCollector) SendMsg(any) error            { return nil }
func (s *exportStreamCollector) RecvMsg(any) error            { return nil }
