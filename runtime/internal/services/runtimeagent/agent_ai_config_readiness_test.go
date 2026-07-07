package runtimeagent

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/metadata"
)

func requireExecutionCapabilityReadiness(t *testing.T, snapshot *runtimev1.RuntimeAgentAIConfigReadinessSnapshot, capability string) *runtimev1.RuntimeAgentAIConfigCapabilityReadiness {
	t.Helper()
	for _, entry := range snapshot.GetCapabilities() {
		if entry.GetCapability() == capability {
			return entry
		}
	}
	t.Fatalf("expected %q capability in readiness snapshot %+v", capability, snapshot)
	return nil
}

func agentAIConfigReadinessSnapshot(t *testing.T, svc *Service) *runtimev1.RuntimeAgentAIConfigReadinessSnapshot {
	t.Helper()
	resp, err := svc.GetRuntimeAgentAIConfigReadiness(context.Background(), &runtimev1.GetRuntimeAgentAIConfigReadinessRequest{
		Context: agentAIConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfigReadiness: %v", err)
	}
	return resp.GetSnapshot()
}

func waitForAgentAIConfigReadinessState(t *testing.T, svc *Service, capability string, want runtimev1.RuntimeAgentAIConfigReadinessState) *runtimev1.RuntimeAgentAIConfigCapabilityReadiness {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var last *runtimev1.RuntimeAgentAIConfigCapabilityReadiness
	for time.Now().Before(deadline) {
		last = requireExecutionCapabilityReadiness(t, agentAIConfigReadinessSnapshot(t, svc), capability)
		if last.GetState() == want {
			return last
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %q readiness %v, last=%+v", capability, want, last)
	return nil
}

func TestAgentAIConfigReadinessSeededProjection(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	snapshot := agentAIConfigReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 1 {
		t.Fatalf("expected readiness config_revision 1, got %d", snapshot.GetConfigRevision())
	}
	if snapshot.GetAgentInstanceId() != runtimeAgentAIConfigTestLocalRef {
		t.Fatalf("agent_instance_id = %q, want %q", snapshot.GetAgentInstanceId(), runtimeAgentAIConfigTestLocalRef)
	}
	if len(snapshot.GetCapabilities()) != len(admittedRuntimeAgentAIConfigCapabilities) {
		t.Fatalf("expected %d admitted capabilities in projection, got %d", len(admittedRuntimeAgentAIConfigCapabilities), len(snapshot.GetCapabilities()))
	}
	text := requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityTextGenerate)
	if text.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("expected seeded text.generate READY, got %v (%q)", text.GetState(), text.GetReasonCode())
	}
	if text.GetProbedAt() == nil {
		t.Fatal("expected text.generate probed_at timestamp")
	}
	embed := requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityTextEmbed)
	if embed.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("expected seeded text.embed READY, got %v (%q)", embed.GetState(), embed.GetReasonCode())
	}
	image := requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityImageGenerate)
	if image.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED {
		t.Fatalf("expected absent image.generate NOT_CONFIGURED, got %v (%q)", image.GetState(), image.GetReasonCode())
	}
	audio := requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityAudioSynthesize)
	if audio.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED {
		t.Fatalf("expected absent audio.synthesize NOT_CONFIGURED, got %v (%q)", audio.GetState(), audio.GetReasonCode())
	}
}

func TestAgentAIConfigReadinessTransitionsOnImageBindingUpsert(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	// Cloud binding without any connector selector: committed but unusable.
	if _, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(
			&runtimev1.RuntimeAgentAIConfigIntent{
				Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			},
		),
	}); err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig(no connector): %v", err)
	}
	snapshot := agentAIConfigReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 2 {
		t.Fatalf("expected readiness config_revision 2, got %d", snapshot.GetConfigRevision())
	}
	image := requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityImageGenerate)
	if image.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected connector-less cloud image binding UNAVAILABLE, got %v", image.GetState())
	}
	if image.GetReasonCode() != agentAIConfigReadinessReasonConnectorMissing {
		t.Fatalf("expected reason connector_missing, got %q", image.GetReasonCode())
	}

	// Adding the connector selector transitions the capability to READY.
	if _, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 2,
		Intents: requiredRuntimeAgentAIConfigTestIntents(
			&runtimev1.RuntimeAgentAIConfigIntent{
				Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		),
	}); err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig(with connector): %v", err)
	}
	snapshot = agentAIConfigReadinessSnapshot(t, svc)
	if snapshot.GetConfigRevision() != 3 {
		t.Fatalf("expected readiness config_revision 3, got %d", snapshot.GetConfigRevision())
	}
	image = requireExecutionCapabilityReadiness(t, snapshot, runtimeAgentAIConfigCapabilityImageGenerate)
	if image.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("expected committed cloud image binding READY, got %v (%q)", image.GetState(), image.GetReasonCode())
	}
}

func TestAgentAIConfigReadinessTargetRefMissingIsUnavailable(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	state, reason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
		ModelId:     "local/default",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   &runtimev1.RuntimeDurableTargetRef{},
	})
	if state != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected empty target_ref to be unavailable, got %v", state)
	}
	if reason != agentAIConfigReadinessReasonTargetMissing {
		t.Fatalf("expected reason target_missing, got %q", reason)
	}

	audioState, audioReason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
		ModelId:     "voice/qwen3-tts",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ConnectorId: "cloud-voice",
	})
	if audioState != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected audio.synthesize without target_ref to be unavailable, got %v", audioState)
	}
	if audioReason != agentAIConfigReadinessReasonTargetMissing {
		t.Fatalf("expected audio.synthesize missing target_ref reason target_missing, got %q", audioReason)
	}
}

func TestAgentAIConfigReadinessUsesCapabilitySpecificReasons(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	tracker := providerhealth.New()
	svc.SetProviderHealthTracker(tracker)

	embedState, embedReason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityTextEmbed,
		ModelId:     "local/default-embedding",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   &runtimev1.RuntimeDurableTargetRef{},
	})
	if embedState != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected malformed text.embed target_ref unavailable, got %v", embedState)
	}
	if embedReason != agentAIConfigReadinessReasonEmbeddingProfileUnavailable {
		t.Fatalf("expected embedding_profile_unavailable, got %q", embedReason)
	}

	voiceState, voiceReason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityVoiceWorkflowClone,
		ModelId:     "voice/clone",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if voiceState != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected missing voice reference unavailable, got %v", voiceState)
	}
	if voiceReason != agentAIConfigReadinessReasonVoiceReferenceMissing {
		t.Fatalf("expected voice_reference_missing, got %q", voiceReason)
	}

	if err := tracker.Mark(localProviderHealthKey, false, "image engine unavailable"); err != nil {
		t.Fatalf("tracker.Mark(unhealthy): %v", err)
	}
	imageState, imageReason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
		ModelId:     "local/image",
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	if imageState != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected image route unavailable, got %v", imageState)
	}
	if imageReason != agentAIConfigReadinessReasonImageRouteUnavailable {
		t.Fatalf("expected image_route_unavailable, got %q", imageReason)
	}

	voiceRouteState, voiceRouteReason := svc.evaluateRuntimeAgentAIConfigCapabilityReadiness(&runtimev1.RuntimeAgentAIConfigIntent{
		Capability:        runtimeAgentAIConfigCapabilityVoiceWorkflowDesign,
		ModelId:           "voice/design",
		RoutePolicy:       runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		VoiceReferenceRef: "voice-reference:seed",
	})
	if voiceRouteState != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE {
		t.Fatalf("expected voice workflow route unavailable, got %v", voiceRouteState)
	}
	if voiceRouteReason != agentAIConfigReadinessReasonVoiceWorkflowUnavailable {
		t.Fatalf("expected voice_workflow_unavailable, got %q", voiceRouteReason)
	}
}

func TestAgentAIConfigReadinessRecomputesOnProviderHealthChange(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	tracker := providerhealth.New()
	svc.SetProviderHealthTracker(tracker)

	text := requireExecutionCapabilityReadiness(t, agentAIConfigReadinessSnapshot(t, svc), runtimeAgentAIConfigCapabilityTextGenerate)
	if text.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("expected text.generate READY with unknown local health, got %v", text.GetState())
	}

	if err := tracker.Mark(localProviderHealthKey, false, "engine crashed"); err != nil {
		t.Fatalf("tracker.Mark(unhealthy): %v", err)
	}
	unhealthy := waitForAgentAIConfigReadinessState(t, svc, runtimeAgentAIConfigCapabilityTextGenerate, runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE)
	if unhealthy.GetReasonCode() != agentAIConfigReadinessReasonRouteUnhealthy {
		t.Fatalf("expected reason route_unhealthy, got %q", unhealthy.GetReasonCode())
	}

	if err := tracker.Mark(localProviderHealthKey, true, "engine recovered"); err != nil {
		t.Fatalf("tracker.Mark(healthy): %v", err)
	}
	waitForAgentAIConfigReadinessState(t, svc, runtimeAgentAIConfigCapabilityTextGenerate, runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY)
}

type fakeAgentAIConfigReadinessStream struct {
	ctx  context.Context
	sent chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot
}

func newFakeAgentAIConfigReadinessStream(ctx context.Context) *fakeAgentAIConfigReadinessStream {
	return &fakeAgentAIConfigReadinessStream{
		ctx:  ctx,
		sent: make(chan *runtimev1.RuntimeAgentAIConfigReadinessSnapshot, 16),
	}
}

func (f *fakeAgentAIConfigReadinessStream) Send(snapshot *runtimev1.RuntimeAgentAIConfigReadinessSnapshot) error {
	f.sent <- snapshot
	return nil
}

func (f *fakeAgentAIConfigReadinessStream) SetHeader(metadata.MD) error  { return nil }
func (f *fakeAgentAIConfigReadinessStream) SendHeader(metadata.MD) error { return nil }
func (f *fakeAgentAIConfigReadinessStream) SetTrailer(metadata.MD)       {}
func (f *fakeAgentAIConfigReadinessStream) Context() context.Context     { return f.ctx }
func (f *fakeAgentAIConfigReadinessStream) SendMsg(any) error            { return nil }
func (f *fakeAgentAIConfigReadinessStream) RecvMsg(any) error            { return nil }

func (f *fakeAgentAIConfigReadinessStream) waitForSnapshot(t *testing.T) *runtimev1.RuntimeAgentAIConfigReadinessSnapshot {
	t.Helper()
	select {
	case snapshot := <-f.sent:
		return snapshot
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for readiness snapshot on stream")
		return nil
	}
}

func TestSubscribeRuntimeAgentAIConfigReadinessInitialAndMutationSnapshots(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := newFakeAgentAIConfigReadinessStream(ctx)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- svc.SubscribeRuntimeAgentAIConfigReadiness(&runtimev1.SubscribeRuntimeAgentAIConfigReadinessRequest{
			Context: agentAIConfigTestContext("nimi.desktop"),
		}, stream)
	}()

	initial := stream.waitForSnapshot(t)
	if initial.GetConfigRevision() != 1 {
		t.Fatalf("expected initial snapshot config_revision 1, got %d", initial.GetConfigRevision())
	}
	text := requireExecutionCapabilityReadiness(t, initial, runtimeAgentAIConfigCapabilityTextGenerate)
	if text.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("expected initial text.generate READY, got %v", text.GetState())
	}

	if _, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(
			&runtimev1.RuntimeAgentAIConfigIntent{
				Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		),
	}); err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}

	mutated := stream.waitForSnapshot(t)
	if mutated.GetConfigRevision() != 2 {
		t.Fatalf("expected post-mutation snapshot config_revision 2, got %d", mutated.GetConfigRevision())
	}
	image := requireExecutionCapabilityReadiness(t, mutated, runtimeAgentAIConfigCapabilityImageGenerate)
	if image.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
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
