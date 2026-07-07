package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/metadata"
)

func requireExecutionCapabilityReadiness(t *testing.T, snapshot *runtimev1.AgentExecutionReadinessSnapshot, capability string) *runtimev1.RuntimeAgentExecutionCapabilityReadiness {
	t.Helper()
	for _, entry := range snapshot.GetCapabilities() {
		if entry.GetCapability() == capability {
			return entry
		}
	}
	t.Fatalf("expected %q capability in readiness snapshot %+v", capability, snapshot)
	return nil
}

func executionReadinessSnapshot(t *testing.T, svc *Service) *runtimev1.AgentExecutionReadinessSnapshot {
	t.Helper()
	resp, err := svc.GetAgentExecutionReadiness(context.Background(), &runtimev1.GetAgentExecutionReadinessRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionReadiness: %v", err)
	}
	return resp.GetSnapshot()
}

func waitForExecutionReadinessState(t *testing.T, svc *Service, capability string, want runtimev1.AgentExecutionReadinessState) *runtimev1.RuntimeAgentExecutionCapabilityReadiness {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var last *runtimev1.RuntimeAgentExecutionCapabilityReadiness
	for time.Now().Before(deadline) {
		last = requireExecutionCapabilityReadiness(t, executionReadinessSnapshot(t, svc), capability)
		if last.GetState() == want {
			return last
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %q readiness %v, last=%+v", capability, want, last)
	return nil
}

func TestExecutionReadinessSeededProjection(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	snapshot := executionReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 1 {
		t.Fatalf("expected readiness config_revision 1, got %d", snapshot.GetConfigRevision())
	}
	if len(snapshot.GetCapabilities()) != len(admittedExecutionCapabilities) {
		t.Fatalf("expected %d admitted capabilities in projection, got %d", len(admittedExecutionCapabilities), len(snapshot.GetCapabilities()))
	}
	text := requireExecutionCapabilityReadiness(t, snapshot, executionCapabilityTextGenerate)
	if text.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY {
		t.Fatalf("expected seeded text.generate READY, got %v (%q)", text.GetState(), text.GetReasonCode())
	}
	if text.GetProbedAt() == nil {
		t.Fatal("expected text.generate probed_at timestamp")
	}
	image := requireExecutionCapabilityReadiness(t, snapshot, executionCapabilityImageGenerate)
	if image.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_NOT_CONFIGURED {
		t.Fatalf("expected absent image.generate NOT_CONFIGURED, got %v (%q)", image.GetState(), image.GetReasonCode())
	}
	audio := requireExecutionCapabilityReadiness(t, snapshot, executionCapabilityAudioSynthesize)
	if audio.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_NOT_CONFIGURED {
		t.Fatalf("expected absent audio.synthesize NOT_CONFIGURED, got %v (%q)", audio.GetState(), audio.GetReasonCode())
	}
}

func TestExecutionReadinessTransitionsOnImageBindingUpsert(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	// Cloud binding without any connector selector: committed but unusable.
	if _, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/default",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  executionCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			},
		},
	}); err != nil {
		t.Fatalf("UpsertAgentExecutionConfig(no connector): %v", err)
	}
	snapshot := executionReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 2 {
		t.Fatalf("expected readiness config_revision 2, got %d", snapshot.GetConfigRevision())
	}
	image := requireExecutionCapabilityReadiness(t, snapshot, executionCapabilityImageGenerate)
	if image.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected connector-less cloud image binding UNAVAILABLE, got %v", image.GetState())
	}
	if image.GetReasonCode() != executionReadinessReasonConnectorMissing {
		t.Fatalf("expected reason connector_missing, got %q", image.GetReasonCode())
	}

	// Adding the connector selector transitions the capability to READY.
	if _, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 2,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/default",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  executionCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		},
	}); err != nil {
		t.Fatalf("UpsertAgentExecutionConfig(with connector): %v", err)
	}
	snapshot = executionReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 3 {
		t.Fatalf("expected readiness config_revision 3, got %d", snapshot.GetConfigRevision())
	}
	image = requireExecutionCapabilityReadiness(t, snapshot, executionCapabilityImageGenerate)
	if image.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY {
		t.Fatalf("expected committed cloud image binding READY, got %v (%q)", image.GetState(), image.GetReasonCode())
	}
}

func TestExecutionReadinessTargetRefMissingIsUnavailable(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	state, reason := svc.evaluateExecutionCapabilityReadiness(&runtimev1.RuntimeAgentExecutionCapabilityBinding{
		Capability:  executionCapabilityTextGenerate,
		ModelId:     "local/default",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   &runtimev1.RuntimeDurableTargetRef{},
	})
	if state != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected empty target_ref to be unavailable, got %v", state)
	}
	if reason != executionReadinessReasonTargetMissing {
		t.Fatalf("expected reason target_missing, got %q", reason)
	}
}

func TestExecutionReadinessRecomputesOnProviderHealthChange(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)
	tracker := providerhealth.New()
	svc.SetProviderHealthTracker(tracker)

	text := requireExecutionCapabilityReadiness(t, executionReadinessSnapshot(t, svc), executionCapabilityTextGenerate)
	if text.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY {
		t.Fatalf("expected text.generate READY with unknown local health, got %v", text.GetState())
	}

	if err := tracker.Mark(localProviderHealthKey, false, "engine crashed"); err != nil {
		t.Fatalf("tracker.Mark(unhealthy): %v", err)
	}
	unhealthy := waitForExecutionReadinessState(t, svc, executionCapabilityTextGenerate, runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_UNAVAILABLE)
	if unhealthy.GetReasonCode() != executionReadinessReasonRouteUnhealthy {
		t.Fatalf("expected reason route_unhealthy, got %q", unhealthy.GetReasonCode())
	}

	if err := tracker.Mark(localProviderHealthKey, true, "engine recovered"); err != nil {
		t.Fatalf("tracker.Mark(healthy): %v", err)
	}
	waitForExecutionReadinessState(t, svc, executionCapabilityTextGenerate, runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY)
}

type fakeExecutionReadinessStream struct {
	ctx  context.Context
	sent chan *runtimev1.AgentExecutionReadinessSnapshot
}

func newFakeExecutionReadinessStream(ctx context.Context) *fakeExecutionReadinessStream {
	return &fakeExecutionReadinessStream{
		ctx:  ctx,
		sent: make(chan *runtimev1.AgentExecutionReadinessSnapshot, 16),
	}
}

func (f *fakeExecutionReadinessStream) Send(snapshot *runtimev1.AgentExecutionReadinessSnapshot) error {
	f.sent <- snapshot
	return nil
}

func (f *fakeExecutionReadinessStream) SetHeader(metadata.MD) error  { return nil }
func (f *fakeExecutionReadinessStream) SendHeader(metadata.MD) error { return nil }
func (f *fakeExecutionReadinessStream) SetTrailer(metadata.MD)       {}
func (f *fakeExecutionReadinessStream) Context() context.Context     { return f.ctx }
func (f *fakeExecutionReadinessStream) SendMsg(any) error            { return nil }
func (f *fakeExecutionReadinessStream) RecvMsg(any) error            { return nil }

func (f *fakeExecutionReadinessStream) waitForSnapshot(t *testing.T) *runtimev1.AgentExecutionReadinessSnapshot {
	t.Helper()
	select {
	case snapshot := <-f.sent:
		return snapshot
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for readiness snapshot on stream")
		return nil
	}
}

func TestSubscribeAgentExecutionReadinessInitialAndMutationSnapshots(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := newFakeExecutionReadinessStream(ctx)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- svc.SubscribeAgentExecutionReadiness(&runtimev1.SubscribeAgentExecutionReadinessRequest{
			Context: executionConfigTestContext("nimi.desktop"),
		}, stream)
	}()

	initial := stream.waitForSnapshot(t)
	if initial.GetConfigRevision() != 1 {
		t.Fatalf("expected initial snapshot config_revision 1, got %d", initial.GetConfigRevision())
	}
	text := requireExecutionCapabilityReadiness(t, initial, executionCapabilityTextGenerate)
	if text.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY {
		t.Fatalf("expected initial text.generate READY, got %v", text.GetState())
	}

	if _, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/default",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  executionCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		},
	}); err != nil {
		t.Fatalf("UpsertAgentExecutionConfig: %v", err)
	}

	mutated := stream.waitForSnapshot(t)
	if mutated.GetConfigRevision() != 2 {
		t.Fatalf("expected post-mutation snapshot config_revision 2, got %d", mutated.GetConfigRevision())
	}
	image := requireExecutionCapabilityReadiness(t, mutated, executionCapabilityImageGenerate)
	if image.GetState() != runtimev1.AgentExecutionReadinessState_AGENT_EXECUTION_READINESS_STATE_READY {
		t.Fatalf("expected post-mutation image.generate READY, got %v (%q)", image.GetState(), image.GetReasonCode())
	}

	cancel()
	select {
	case err := <-streamDone:
		if err == nil || err != context.Canceled {
			// Context cancellation surfaces as context.Canceled from the loop.
			if err == nil {
				t.Fatal("expected stream to end with context error")
			}
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for stream to close on context cancellation")
	}
}
