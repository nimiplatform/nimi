package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

const (
	runtimeAgentAIConfigTestOwner      = "user-ai-config"
	runtimeAgentAIConfigTestSource     = "runtime-source-ai-config"
	runtimeAgentAIConfigTestLocalRef   = "local-agent:runtime-6b7ec37dccd1b515d333027d5a639723"
	runtimeAgentAIConfigSecondSource   = "runtime-source-ai-config-second"
	runtimeAgentAIConfigSecondLocalRef = "local-agent:runtime-8164585e6e9c32cbf090dd24f1571f2a"
)

func agentAIConfigTestContext(appID string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:            appID,
		SubjectUserId:    runtimeAgentAIConfigTestOwner,
		OwnerUserId:      runtimeAgentAIConfigTestOwner,
		RuntimeSourceRef: testRuntimeAgentSourceRef(runtimeAgentAIConfigTestSource),
		LocalAgentRef:    runtimeAgentAIConfigTestLocalRef,
	}
}

func agentAIConfigTestContextFor(appID string, sourceRef string, localRef string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{
		AppId:            appID,
		SubjectUserId:    runtimeAgentAIConfigTestOwner,
		OwnerUserId:      runtimeAgentAIConfigTestOwner,
		RuntimeSourceRef: testRuntimeAgentSourceRef(sourceRef),
		LocalAgentRef:    localRef,
	}
}

func newAgentAIConfigTestServiceWithClose(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	var svc *Service
	closeFn := func() {
		if svc != nil {
			svc.Close()
		}
		_ = memorySvc.Close()
	}
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		closeFn()
		t.Fatalf("runtimeagent.New: %v", err)
	}
	materializeAgentAIConfigTestAgent(t, svc, agentAIConfigTestContext("runtime-agent-ai-config-test"))
	return svc, closeFn
}

func newAgentAIConfigTestService(t *testing.T) *Service {
	t.Helper()
	svc, closeFn := newAgentAIConfigTestServiceWithClose(t, filepath.Join(t.TempDir(), "local-state.json"))
	t.Cleanup(closeFn)
	return svc
}

func materializeAgentAIConfigTestAgent(t *testing.T, svc *Service, ctx *runtimev1.AgentRequestContext) {
	t.Helper()
	if _, err := materializeRealmSourceTestAgent(t, svc, context.Background(), &realmSourceTestAgentInput{
		Context:          ctx,
		LocalAgentRef:    ctx.GetLocalAgentRef(),
		OwnerUserId:      ctx.GetOwnerUserId(),
		RuntimeSourceRef: ctx.GetRuntimeSourceRef(),
	}); err != nil {
		t.Fatalf("RealmSourceMaterialization(%s): %v", ctx.GetLocalAgentRef(), err)
	}
}

func requireAgentAIConfigIntent(t *testing.T, config *runtimev1.RuntimeAgentAIConfig, capability string) *runtimev1.RuntimeAgentAIConfigIntent {
	t.Helper()
	for _, intent := range config.GetIntents() {
		if intent.GetCapability() == capability {
			return intent
		}
	}
	t.Fatalf("expected %q intent in config %+v", capability, config)
	return nil
}

func requiredRuntimeAgentAIConfigTestIntents(extra ...*runtimev1.RuntimeAgentAIConfigIntent) []*runtimev1.RuntimeAgentAIConfigIntent {
	intents := []*runtimev1.RuntimeAgentAIConfigIntent{
		{
			Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
			ModelId:     "local/default",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			Capability:  runtimeAgentAIConfigCapabilityTextEmbed,
			ModelId:     runtimeAgentAIConfigDefaultEmbeddingModelID,
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	}
	return append(intents, extra...)
}

func runtimeAgentAIConfigTestLocalTarget(localAssetID string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
					ProfileBindingId: "local-runtime:" + localAssetID,
				},
			},
		},
	}
}

func runtimeAgentAIConfigTestCloudTarget(connectorID, provider, modelID string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          connectorID,
				RemoteModelCatalogId: provider + "/" + modelID,
				ProviderModelId:      modelID,
				Provider:             provider,
			},
		},
	}
}

func TestRuntimeAgentAIConfigSeedOnInitializeAndGet(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	resp, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{
		Context: agentAIConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig: %v", err)
	}
	config := resp.GetConfig()
	if config.GetAgentInstanceId() != runtimeAgentAIConfigTestLocalRef {
		t.Fatalf("agent_instance_id = %q, want %q", config.GetAgentInstanceId(), runtimeAgentAIConfigTestLocalRef)
	}
	if config.GetRevision() != 1 {
		t.Fatalf("expected seeded revision 1, got %d", config.GetRevision())
	}
	if config.GetUpdatedByAppId() != runtimeAgentAIConfigSeedAppID {
		t.Fatalf("expected seed updated_by_app_id %q, got %q", runtimeAgentAIConfigSeedAppID, config.GetUpdatedByAppId())
	}
	if len(config.GetIntents()) != 2 {
		t.Fatalf("expected text.generate and text.embed seed intents, got %d", len(config.GetIntents()))
	}
	text := requireAgentAIConfigIntent(t, config, runtimeAgentAIConfigCapabilityTextGenerate)
	if text.GetModelId() != texttarget.InternalDefaultLocalTextModelAlias {
		t.Fatalf("expected seeded text model %q, got %q", texttarget.InternalDefaultLocalTextModelAlias, text.GetModelId())
	}
	embed := requireAgentAIConfigIntent(t, config, runtimeAgentAIConfigCapabilityTextEmbed)
	if embed.GetModelId() != runtimeAgentAIConfigDefaultEmbeddingModelID {
		t.Fatalf("expected seeded embed model %q, got %q", runtimeAgentAIConfigDefaultEmbeddingModelID, embed.GetModelId())
	}
}

func TestRuntimeAgentAIConfigPerAgentIsolation(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	secondCtx := agentAIConfigTestContextFor("runtime-agent-ai-config-test", runtimeAgentAIConfigSecondSource, runtimeAgentAIConfigSecondLocalRef)
	materializeAgentAIConfigTestAgent(t, svc, secondCtx)

	resp, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
			ModelId:     "openai/gpt-image-1",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ConnectorId: "cloud-openai",
			TargetRef:   runtimeAgentAIConfigTestCloudTarget("cloud-openai", "openai", "gpt-image-1"),
		}),
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig(agent A): %v", err)
	}
	if resp.GetConfig().GetAgentInstanceId() != runtimeAgentAIConfigTestLocalRef {
		t.Fatalf("mutated wrong agent config: %q", resp.GetConfig().GetAgentInstanceId())
	}

	second, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{Context: secondCtx})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig(agent B): %v", err)
	}
	if second.GetConfig().GetRevision() != 1 {
		t.Fatalf("agent B revision changed, got %d", second.GetConfig().GetRevision())
	}
	for _, intent := range second.GetConfig().GetIntents() {
		if intent.GetCapability() == runtimeAgentAIConfigCapabilityImageGenerate {
			t.Fatalf("agent B observed agent A image intent")
		}
	}
}

func TestRuntimeAgentAIConfigUpsertRequiresTextGenerateAndTextEmbed(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: []*runtimev1.RuntimeAgentAIConfigIntent{
			{
				Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument when text.embed is removed, got %v", err)
	}
}

func TestRuntimeAgentAIConfigUpsertBumpsRevision(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	resp, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
			ModelId:     "speech/qwen3tts",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef:   runtimeAgentAIConfigTestLocalTarget("speech-qwen3tts"),
		}),
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}
	if resp.GetConfig().GetRevision() != 2 {
		t.Fatalf("expected revision 2 after mutation, got %d", resp.GetConfig().GetRevision())
	}
	if resp.GetConfig().GetUpdatedByAppId() != "nimi.desktop" {
		t.Fatalf("expected updated_by_app_id nimi.desktop, got %q", resp.GetConfig().GetUpdatedByAppId())
	}
}

func TestRuntimeAgentAIConfigMaterializesBoundVoiceAssetTarget(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	const voiceAssetID = "voice-asset-agent-ai-config"
	asset := bindableVoiceAsset(voiceAssetID)
	asset.AppId = "nimi.voice-demo"
	asset.SubjectUserId = runtimeAgentAIConfigTestOwner
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, requestedID string) (*runtimev1.VoiceAsset, error) {
		if requestedID != voiceAssetID {
			t.Fatalf("voice asset id = %q, want %q", requestedID, voiceAssetID)
		}
		return proto.Clone(asset).(*runtimev1.VoiceAsset), nil
	}))
	if _, err := setPresentationVoiceReference(
		context.Background(),
		svc,
		agentAIConfigTestContext("nimi.voice-demo"),
		0,
		"voice_asset_id:"+voiceAssetID,
	); err != nil {
		t.Fatalf("bind presentation voice asset: %v", err)
	}

	response, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
			Provider:    "provider-1",
			ModelId:     "provider-model-1",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		}),
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}
	audio := requireAgentAIConfigIntent(t, response.GetConfig(), runtimeAgentAIConfigCapabilityAudioSynthesize)
	if audio.GetConnectorId() != "connector-1" {
		t.Fatalf("audio connector = %q, want VoiceAsset connector", audio.GetConnectorId())
	}
	if !proto.Equal(audio.GetTargetRef(), asset.GetVoiceAssetTargetRef()) {
		t.Fatalf("audio target = %v, want exact VoiceAsset target %v", audio.GetTargetRef(), asset.GetVoiceAssetTargetRef())
	}
}

func TestRuntimeAgentAIConfigRejectsBoundVoiceAssetTargetMismatch(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	const voiceAssetID = "voice-asset-agent-ai-config-mismatch"
	asset := bindableVoiceAsset(voiceAssetID)
	asset.AppId = "nimi.voice-demo"
	asset.SubjectUserId = runtimeAgentAIConfigTestOwner
	svc.SetVoiceAssetResolver(testVoiceAssetResolver(func(_ context.Context, _ string) (*runtimev1.VoiceAsset, error) {
		return proto.Clone(asset).(*runtimev1.VoiceAsset), nil
	}))
	if _, err := setPresentationVoiceReference(
		context.Background(),
		svc,
		agentAIConfigTestContext("nimi.voice-demo"),
		0,
		"voice_asset_id:"+voiceAssetID,
	); err != nil {
		t.Fatalf("bind presentation voice asset: %v", err)
	}

	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityAudioSynthesize,
			Provider:    "provider-1",
			ModelId:     "other-provider-model",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH {
		t.Fatalf("reason = %s, %v; want AI_VOICE_TARGET_MODEL_MISMATCH", reason, ok)
	}
}

func TestRuntimeAgentAIConfigAdmitsAudioTranscribeIntent(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	resp, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityAudioTranscribe,
			ModelId:     "speech/qwen3-asr",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ConnectorId: "cloud-speech",
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          "cloud-speech",
						RemoteModelCatalogId: "dashscope/qwen3-asr",
						ProviderModelId:      "qwen3-asr",
						Provider:             "dashscope",
					},
				},
			},
		}),
	})
	if err != nil {
		t.Fatalf("audio.transcribe must be admitted by Runtime Agent AI Config: %v", err)
	}
	transcribe := requireAgentAIConfigIntent(t, resp.GetConfig(), runtimeAgentAIConfigCapabilityAudioTranscribe)
	if transcribe.GetConnectorId() != "cloud-speech" {
		t.Fatalf("expected committed audio.transcribe connector, got %q", transcribe.GetConnectorId())
	}
}

func TestRuntimeAgentAIConfigUpsertStaleRevisionAborted(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 7,
		Intents:          requiredRuntimeAgentAIConfigTestIntents(),
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("expected Aborted for stale expected_revision, got %v", err)
	}
}

func TestRuntimeAgentAIConfigSurvivesRestartWithoutReseed(t *testing.T) {
	t.Parallel()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")

	svc, closeFirst := newAgentAIConfigTestServiceWithClose(t, localStatePath)
	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
			ModelId:     "openai/gpt-image-1",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			ConnectorId: "cloud-openai",
			TargetRef:   runtimeAgentAIConfigTestCloudTarget("cloud-openai", "openai", "gpt-image-1"),
		}),
	})
	if err != nil {
		closeFirst()
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}
	closeFirst()

	restarted, closeRestarted := newAgentAIConfigTestServiceWithClose(t, localStatePath)
	defer closeRestarted()
	resp, err := restarted.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{
		Context: agentAIConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig after restart: %v", err)
	}
	if resp.GetConfig().GetRevision() != 2 {
		t.Fatalf("expected committed revision 2 to survive restart, got %d", resp.GetConfig().GetRevision())
	}
	image := requireAgentAIConfigIntent(t, resp.GetConfig(), runtimeAgentAIConfigCapabilityImageGenerate)
	if image.GetConnectorId() != "cloud-openai" {
		t.Fatalf("expected committed image connector to survive restart, got %q", image.GetConnectorId())
	}
}

func TestRuntimeAgentAIConfigMissingRowAfterSeedFailsClosed(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	if _, err := svc.backend.DB().Exec(`DELETE FROM runtime_agent_ai_config WHERE agent_instance_id = ?`, runtimeAgentAIConfigTestLocalRef); err != nil {
		t.Fatalf("delete runtime agent ai config row: %v", err)
	}
	_, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{
		Context: agentAIConfigTestContext("nimi.desktop"),
	})
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected Internal for missing committed row after seed, got %v", err)
	}
}
