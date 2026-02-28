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
	tracker.Mark("cloud-alibaba", false, "timeout")

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
