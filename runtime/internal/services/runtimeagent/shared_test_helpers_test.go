package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func newRuntimeAgentTestService(t *testing.T) *Service {
	t.Helper()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, closeFn := openRuntimeAgentTestComposition(t, localStatePath)
	t.Cleanup(closeFn)
	return svc
}

func retainedAgentEventsForTest(
	t *testing.T,
	svc *Service,
	agentID string,
	afterSequence uint64,
	filters ...runtimev1.AgentEventType,
) []*runtimev1.AgentEvent {
	t.Helper()
	filterSet := make(map[runtimev1.AgentEventType]struct{}, len(filters))
	for _, filter := range filters {
		filterSet[filter] = struct{}{}
	}
	svc.mu.RLock()
	defer svc.mu.RUnlock()
	events := make([]*runtimev1.AgentEvent, 0)
	for _, event := range svc.events {
		if event.GetSequence() <= afterSequence || event.GetAgentId() != testRuntimeAgentLocalRef(agentID) {
			continue
		}
		if len(filterSet) > 0 {
			if _, ok := filterSet[event.GetEventType()]; !ok {
				continue
			}
		}
		events = append(events, proto.Clone(event).(*runtimev1.AgentEvent))
	}
	return events
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
