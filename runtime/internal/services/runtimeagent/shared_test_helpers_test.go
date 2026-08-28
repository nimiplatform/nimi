package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

func newRuntimeAgentTestService(t *testing.T) *Service {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn := openRuntimeAgentTestComposition(t, localStatePath)
	t.Cleanup(closeFn)
	return svc
}

func mustEnableAutonomy(t *testing.T, svc *Service, ctx context.Context, agentID string) {
	t.Helper()
	resp, err := svc.EnableAutonomy(ctx, &runtimev1.EnableAutonomyRequest{Context: testRuntimeAgentIdentityContext(agentID), AgentId: agentID})
	if err != nil {
		t.Fatalf("EnableAutonomy(%s): %v", agentID, err)
	}
	if !resp.GetAutonomy().GetEnabled() {
		t.Fatalf("expected autonomy enabled for %s, got %#v", agentID, resp.GetAutonomy())
	}
}

func mustFindPendingCadenceHook(t *testing.T, svc *Service, ctx context.Context, agentID string) *runtimev1.PendingHook {
	t.Helper()
	resp, err := svc.ListPendingHooks(ctx, &runtimev1.ListPendingHooksRequest{Context: testRuntimeAgentIdentityContext(agentID), AgentId: agentID})
	if err != nil {
		t.Fatalf("ListPendingHooks(%s): %v", agentID, err)
	}
	for _, hook := range resp.GetHooks() {
		if hook != nil && hook.GetIntent() != nil && hook.GetIntent().GetReason() == autonomyCadenceHookReason {
			return hook
		}
	}
	t.Fatalf("expected pending cadence hook for %s, got %#v", agentID, resp.GetHooks())
	return nil
}

type agentEventCaptureStream struct {
	ctx        context.Context
	cancel     context.CancelFunc
	events     []*runtimev1.AgentEvent
	max        int
	headerSent chan struct{}
}

func newAgentEventCaptureStream(parent context.Context) *agentEventCaptureStream {
	return newAgentEventCaptureStreamLimit(parent, 1)
}

func newAgentEventCaptureStreamLimit(parent context.Context, max int) *agentEventCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentEventCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentEventCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *agentEventCaptureStream) SendHeader(metadata.MD) error {
	if s.headerSent != nil {
		select {
		case s.headerSent <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *agentEventCaptureStream) SetTrailer(metadata.MD)   {}
func (s *agentEventCaptureStream) Context() context.Context { return s.ctx }
func (s *agentEventCaptureStream) SendMsg(any) error        { return nil }
func (s *agentEventCaptureStream) RecvMsg(any) error        { return nil }
func (s *agentEventCaptureStream) Send(event *runtimev1.AgentEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.AgentEvent))
	if s.max <= 0 || len(s.events) >= s.max {
		s.cancel()
	}
	return nil
}

type agentVoiceStreamCaptureStream struct {
	ctx        context.Context
	cancel     context.CancelFunc
	events     []*runtimev1.AgentVoiceStreamEvent
	max        int
	headerSent chan struct{}
}

func newAgentVoiceStreamCaptureStreamLimit(parent context.Context, max int) *agentVoiceStreamCaptureStream {
	ctx, cancel := context.WithCancel(parent)
	return &agentVoiceStreamCaptureStream{ctx: ctx, cancel: cancel, max: max}
}

func (s *agentVoiceStreamCaptureStream) SetHeader(metadata.MD) error { return nil }
func (s *agentVoiceStreamCaptureStream) SendHeader(metadata.MD) error {
	if s.headerSent != nil {
		select {
		case s.headerSent <- struct{}{}:
		default:
		}
	}
	return nil
}
func (s *agentVoiceStreamCaptureStream) SetTrailer(metadata.MD)   {}
func (s *agentVoiceStreamCaptureStream) Context() context.Context { return s.ctx }
func (s *agentVoiceStreamCaptureStream) SendMsg(any) error        { return nil }
func (s *agentVoiceStreamCaptureStream) RecvMsg(any) error        { return nil }
func (s *agentVoiceStreamCaptureStream) Send(event *runtimev1.AgentVoiceStreamEvent) error {
	s.events = append(s.events, proto.Clone(event).(*runtimev1.AgentVoiceStreamEvent))
	if s.max > 0 && len(s.events) >= s.max {
		s.cancel()
	}
	return nil
}

type lifeTrackExecutorFunc func(context.Context, *lifeTurnRequest) (*lifeTurnResult, error)

func (f lifeTrackExecutorFunc) ExecuteLifeTrackHook(ctx context.Context, req *lifeTurnRequest) (*lifeTurnResult, error) {
	return f(ctx, req)
}

type fakeLifeTurnAI struct {
	response *runtimev1.ExecuteScenarioResponse
	err      error
	requests []*runtimev1.ExecuteScenarioRequest
	contexts []context.Context
}

func (f *fakeLifeTurnAI) ExecuteScenario(ctx context.Context, req *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	f.requests = append(f.requests, proto.Clone(req).(*runtimev1.ExecuteScenarioRequest))
	f.contexts = append(f.contexts, ctx)
	if f.err != nil {
		return nil, f.err
	}
	if f.response == nil {
		return &runtimev1.ExecuteScenarioResponse{}, nil
	}
	return proto.Clone(f.response).(*runtimev1.ExecuteScenarioResponse), nil
}

func waitForRuntimeAgentCondition(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition not satisfied before timeout")
}
