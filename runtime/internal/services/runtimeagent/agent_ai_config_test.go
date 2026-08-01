package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	runtimeAgentAIConfigTestOwner      = "user-ai-config"
	runtimeAgentAIConfigTestSource     = "runtime-source-ai-config"
	runtimeAgentAIConfigTestLocalRef   = "local-agent:runtime-6b7ec37dccd1b515d333027d5a639723"
	runtimeAgentAIConfigSecondSource   = "runtime-source-ai-config-second"
	runtimeAgentAIConfigSecondLocalRef = "local-agent:runtime-8164585e6e9c32cbf090dd24f1571f2a"
	runtimeAgentAIConfigTestEmbedModel = "local/test-embedding"
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
	svc.SetLocalAppRouteOptionInventory(runtimeAgentAIConfigTestRouteInventory())
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

func runtimeAgentAIConfigTestIntents(extra ...*runtimev1.RuntimeAgentAIConfigIntent) []*runtimev1.RuntimeAgentAIConfigIntent {
	intents := []*runtimev1.RuntimeAgentAIConfigIntent{
		{
			Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
			ModelId:     "local/default",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef:   runtimeAgentAIConfigTestLocalTarget("default-text"),
		},
		{
			Capability:  runtimeAgentAIConfigCapabilityTextEmbed,
			ModelId:     runtimeAgentAIConfigTestEmbedModel,
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef:   runtimeAgentAIConfigTestLocalTarget("default-embed"),
		},
	}
	return append(intents, extra...)
}

func configureRuntimeAgentTestAIConfig(
	t *testing.T,
	svc *Service,
	ctx *runtimev1.AgentRequestContext,
	intents ...*runtimev1.RuntimeAgentAIConfigIntent,
) *runtimev1.RuntimeAgentAIConfig {
	t.Helper()
	svc.SetLocalAppRouteOptionInventory(runtimeAgentAIConfigTestRouteInventory())
	current, err := svc.GetRuntimeAgentAIConfig(context.Background(), &runtimev1.GetRuntimeAgentAIConfigRequest{
		Context: ctx,
	})
	if err != nil {
		t.Fatalf("GetRuntimeAgentAIConfig: %v", err)
	}
	if len(intents) == 0 {
		intents = runtimeAgentAIConfigTestIntents()
	}
	response, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          ctx,
		ExpectedRevision: current.GetConfig().GetRevision(),
		Intents:          intents,
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig: %v", err)
	}
	return response.GetConfig()
}

func runtimeAgentAIConfigTestLocalTarget(localAssetID string) *runtimev1.RuntimeDurableTargetRef {
	ref := &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
		ReadinessRef: "test_runtime_readiness:v2:" + localAssetID,
	}
	if localAssetID == "image" || localAssetID == "z-image-turbo" {
		ref = nil
	}
	localTarget := &runtimev1.RuntimeDurableLocalTargetRef{Version: "v2"}
	if ref != nil {
		localTarget.Ref = ref
	} else {
		localTarget.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
			ProfileBindingId: "test_workflow_binding:v2:" + localAssetID,
		}
	}
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: localTarget,
		},
	}
}

func runtimeAgentAIConfigTestRouteInventory() localAppRouteOptionInventoryStub {
	testAsset := func(
		localAssetID string,
		logicalModelID string,
		capability string,
	) *runtimev1.LocalAssetRecord {
		return &runtimev1.LocalAssetRecord{
			LocalAssetId:        "private-" + localAssetID,
			LogicalModelId:      logicalModelID,
			DisplayName:         logicalModelID,
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{capability},
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetRef:    proto.Clone(runtimeAgentAIConfigTestLocalTarget(localAssetID).GetLocalRuntime()).(*runtimev1.RuntimeDurableLocalTargetRef),
		}
	}
	return localAppRouteOptionInventoryStub{assets: []*runtimev1.LocalAssetRecord{
		testAsset("default-text", "local/default", runtimeAgentAIConfigCapabilityTextGenerate),
		testAsset("qwen3-chat", "local/qwen3-chat", runtimeAgentAIConfigCapabilityTextGenerate),
		testAsset("default-embed", runtimeAgentAIConfigTestEmbedModel, runtimeAgentAIConfigCapabilityTextEmbed),
		testAsset("speech-qwen3tts", "speech/qwen3tts", runtimeAgentAIConfigCapabilityAudioSynthesize),
		testAsset("voice-clone", "voice/clone", runtimeAgentAIConfigCapabilityVoiceWorkflowClone),
		testAsset("voice-design", "voice/design", runtimeAgentAIConfigCapabilityVoiceWorkflowDesign),
		testAsset("image", "local/image", runtimeAgentAIConfigCapabilityImageGenerate),
		testAsset("z-image-turbo", "local/z-image-turbo", runtimeAgentAIConfigCapabilityImageGenerate),
	}}
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
	if len(config.GetIntents()) != 0 {
		t.Fatalf("initial AIConfig must not embed model defaults, got %+v", config.GetIntents())
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
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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

func TestRuntimeAgentAIConfigUpsertAllowsDynamicCapabilitySet(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	resp, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: []*runtimev1.RuntimeAgentAIConfigIntent{
			{
				Capability:  runtimeAgentAIConfigCapabilityTextGenerate,
				ModelId:     "local/default",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				TargetRef:   runtimeAgentAIConfigTestLocalTarget("default-text"),
			},
		},
	})
	if err != nil {
		t.Fatalf("dynamic single-capability AIConfig: %v", err)
	}
	if resp.GetConfig().GetRevision() != 2 || len(resp.GetConfig().GetIntents()) != 1 {
		t.Fatalf("dynamic AIConfig = %+v", resp.GetConfig())
	}
	if got := resp.GetConfig().GetIntents()[0].GetCapability(); got != runtimeAgentAIConfigCapabilityTextGenerate {
		t.Fatalf("configured capability = %q", got)
	}
}

func TestRuntimeAgentAIConfigTargetRequiredIsTypedAndCapabilityBounded(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
			ModelId:     "image/z-image-turbo",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_REQUIRED {
		t.Fatalf("reason = %s, %v; want AGENT_AI_CONFIG_TARGET_REQUIRED", reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["capability"] != runtimeAgentAIConfigCapabilityImageGenerate {
		t.Fatalf("metadata = %v, %v; want public image.generate capability", metadata, ok)
	}
	if _, leaked := metadata["local_asset_id"]; leaked {
		t.Fatalf("private local_asset_id leaked in metadata: %v", metadata)
	}
}

func TestRuntimeAgentAIConfigUpsertBumpsRevision(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)

	resp, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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

func TestRuntimeAgentAIConfigRejectsWorkflowDefinitionsInSelectedParamsWithoutRevisionAdvance(t *testing.T) {
	for _, reservedKey := range runtimeAgentAIConfigReservedSelectedParamKeys {
		t.Run(reservedKey, func(t *testing.T) {
			svc := newAgentAIConfigTestService(t)
			selectedParams, err := structpb.NewStruct(map[string]any{reservedKey: map[string]any{"caller": "workflow"}})
			if err != nil {
				t.Fatalf("selected params: %v", err)
			}
			_, err = svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
				Context:          agentAIConfigTestContext("nimi.desktop"),
				ExpectedRevision: 1,
				Intents: []*runtimev1.RuntimeAgentAIConfigIntent{{
					Capability:     runtimeAgentAIConfigCapabilityTextGenerate,
					ModelId:        "local/default",
					RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef:      runtimeAgentAIConfigTestLocalTarget("default-text"),
					SelectedParams: selectedParams,
				}},
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_INVALID {
				t.Fatalf("reason = %s, present=%v; want AGENT_AI_CONFIG_INVALID", reason, ok)
			}
			committed, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
			if loadErr != nil || committed.GetRevision() != 1 || len(committed.GetIntents()) != 0 {
				t.Fatalf("rejected selected params advanced config: config=%+v err=%v", committed, loadErr)
			}
		})
	}
}

func TestRuntimeAgentAIConfigRejectsPrivateIdentityInSelectedParamsWithoutRevisionAdvance(t *testing.T) {
	for _, privateKey := range []string{"localAssetId", "assetId", "profileBindingId", "logicalModelId", "local.asset.id", "profile entries", "apiKey", "secret", "token", "credential", "provider.secret", "access_token", "clientSecret", "providerCredential"} {
		t.Run(privateKey, func(t *testing.T) {
			svc := newAgentAIConfigTestService(t)
			selectedParams, err := structpb.NewStruct(map[string]any{privateKey: "private-identity"})
			if err != nil {
				t.Fatalf("selected params: %v", err)
			}
			_, err = svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
				Context:          agentAIConfigTestContext("nimi.desktop"),
				ExpectedRevision: 1,
				Intents: []*runtimev1.RuntimeAgentAIConfigIntent{{
					Capability:     runtimeAgentAIConfigCapabilityTextGenerate,
					ModelId:        "local/default",
					RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef:      runtimeAgentAIConfigTestLocalTarget("default-text"),
					SelectedParams: selectedParams,
				}},
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("code = %s, want InvalidArgument: %v", status.Code(err), err)
			}
			committed, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
			if loadErr != nil || committed.GetRevision() != 1 || len(committed.GetIntents()) != 0 {
				t.Fatalf("rejected selected params advanced config: config=%+v err=%v", committed, loadErr)
			}
		})
	}
}

func TestRuntimeAgentAIConfigNormalizesSelectedParamsAndRejectsNormalizedCollisions(t *testing.T) {
	params, err := structpb.NewStruct(map[string]any{"c.f.g.scale": 7})
	if err != nil {
		t.Fatalf("selected params: %v", err)
	}
	normalized, ok := normalizeRuntimeAgentAIConfigSelectedParams(runtimeAgentAIConfigCapabilityImageGenerate, params)
	if !ok || normalized.GetFields()["cfgScale"].GetNumberValue() != 7 {
		t.Fatalf("normalized cfgScale = %+v, valid=%v", normalized, ok)
	}
	collisionParams, err := structpb.NewStruct(map[string]any{"cfgScale": 1, "cfg_scale": 2})
	if err != nil {
		t.Fatalf("collision params: %v", err)
	}
	if _, collision := normalizeRuntimeAgentAIConfigSelectedParams(runtimeAgentAIConfigCapabilityImageGenerate, collisionParams); collision {
		t.Fatal("equivalent selected parameter keys must be rejected as a collision")
	}
}

func TestRuntimeAgentAIConfigRejectsCredentialComponentOptions(t *testing.T) {
	for _, key := range []string{
		"apiKey", "secret", "token", "credential", "provider.secret",
		"accessKeyId", "endpoint", "providerEndpoint", "credentialsEndpoint",
	} {
		t.Run(key, func(t *testing.T) {
			options, err := structpb.NewStruct(map[string]any{key: "private"})
			if err != nil {
				t.Fatalf("credential options: %v", err)
			}
			_, err = normalizeRuntimeAgentAIConfigComponentSelections(
				runtimeAgentAIConfigCapabilityImageGenerate,
				[]*runtimev1.RuntimeAgentAIConfigComponentSelection{{
					OccurrenceId:   "vae-1",
					Order:          0,
					Role:           "vae",
					ComponentKind:  "vae",
					LogicalModelId: "image/vae",
					TargetRef:      runtimeAgentAIConfigTestLocalTarget("image"),
					Options:        options,
				}},
			)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("credential option %q code = %s, want InvalidArgument: %v", key, status.Code(err), err)
			}
		})
	}
}

func TestRuntimeAgentAIConfigRejectsUnknownCapabilitySelectedParams(t *testing.T) {
	svc := newAgentAIConfigTestService(t)
	selectedParams, err := structpb.NewStruct(map[string]any{"engine_mode": "private"})
	if err != nil {
		t.Fatalf("selected params: %v", err)
	}
	_, err = svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: []*runtimev1.RuntimeAgentAIConfigIntent{{
			Capability:     runtimeAgentAIConfigCapabilityImageGenerate,
			ModelId:        "local/image",
			RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			TargetRef:      runtimeAgentAIConfigTestLocalTarget("image"),
			SelectedParams: selectedParams,
		}},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unknown capability parameter code = %s, err=%v", status.Code(err), err)
	}
	committed, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
	if loadErr != nil || committed.GetRevision() != 1 || len(committed.GetIntents()) != 0 {
		t.Fatalf("unknown capability parameter advanced config: config=%+v err=%v", committed, loadErr)
	}
}

func TestRuntimeAgentAIConfigRejectsCloudImageWithLocalComponents(t *testing.T) {
	svc := newAgentAIConfigTestService(t)
	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
			ModelId:     "gpt-image-1",
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			TargetRef:   runtimeAgentAIConfigTestCloudTarget("cloud-openai", "openai", "gpt-image-1"),
			SelectedComponents: []*runtimev1.RuntimeAgentAIConfigComponentSelection{{
				OccurrenceId:   "vae-1",
				Order:          0,
				Role:           "vae",
				ComponentKind:  "vae",
				LogicalModelId: "local/vae",
				TargetRef:      runtimeAgentAIConfigTestLocalTarget("image"),
				Required:       true,
			}},
		}),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("cloud image with local components code = %s, want InvalidArgument: %v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_CAPABILITY_MISMATCH {
		t.Fatalf("cloud image with local components reason = %s, present=%v; want AGENT_AI_CONFIG_CAPABILITY_MISMATCH", reason, ok)
	}
	committed, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
	if loadErr != nil || committed.GetRevision() != 1 || len(committed.GetIntents()) != 0 {
		t.Fatalf("rejected cloud image with local components advanced config: config=%+v err=%v", committed, loadErr)
	}
}

func TestRuntimeAgentAIConfigExactImageTargetDegradesAndRecoversWithoutRebinding(t *testing.T) {
	svc := newAgentAIConfigTestService(t)
	const bindingID = "test_workflow_binding:v2:degrading-image"
	target := &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{
					ProfileBindingId: bindingID,
				},
			},
		},
	}
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "private-degrading-image",
		LogicalModelId:      "local/image/degrading",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		Capabilities:        []string{runtimeAgentAIConfigCapabilityImageGenerate},
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		DurableTargetRef:    proto.Clone(target.GetLocalRuntime()).(*runtimev1.RuntimeDurableLocalTargetRef),
	}
	components := []localservice.DurableLocalComponentSelection{
		{
			OccurrenceID: "encoder-primary", Order: 0, Role: "text_encoder", ComponentKind: "llm",
			LogicalModelID: "local/qwen3-4b", TargetRef: proto.Clone(runtimeAgentAIConfigTestLocalTarget("degrading-encoder").GetLocalRuntime()).(*runtimev1.RuntimeDurableLocalTargetRef),
			Required: true,
		},
		{
			OccurrenceID: "vae-primary", Order: 1, Role: "vae", ComponentKind: "vae",
			LogicalModelID: "local/z-image-vae", TargetRef: proto.Clone(runtimeAgentAIConfigTestLocalTarget("degrading-vae").GetLocalRuntime()).(*runtimev1.RuntimeDurableLocalTargetRef),
			Required: true,
		},
	}
	inventory := runtimeAgentAIConfigTestRouteInventory()
	inventory.imageComponents = map[string][]localservice.DurableLocalComponentSelection{bindingID: components}
	inventory.componentKinds = map[string]string{}
	for _, component := range components {
		componentAsset := &runtimev1.LocalAssetRecord{
			LocalAssetId:        "private-" + component.OccurrenceID,
			AssetId:             "private-asset-" + component.OccurrenceID,
			LogicalModelId:      component.LogicalModelID,
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			DurableTargetRef:    proto.Clone(component.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
		}
		inventory.assets = append(inventory.assets, componentAsset)
		inventory.componentKinds[componentAsset.GetLocalAssetId()] = component.ComponentKind
	}
	inventory.assets = append(inventory.assets, asset)
	svc.SetLocalAppRouteOptionInventory(inventory)
	imageIntent := &runtimev1.RuntimeAgentAIConfigIntent{
		Capability:  runtimeAgentAIConfigCapabilityImageGenerate,
		ModelId:     asset.GetLogicalModelId(),
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		TargetRef:   proto.Clone(target).(*runtimev1.RuntimeDurableTargetRef),
	}
	for _, component := range components {
		options, optionsErr := structpb.NewStruct(component.Options)
		if optionsErr != nil {
			t.Fatal(optionsErr)
		}
		imageIntent.SelectedComponents = append(imageIntent.SelectedComponents, &runtimev1.RuntimeAgentAIConfigComponentSelection{
			OccurrenceId: component.OccurrenceID, Order: uint32(component.Order), Role: component.Role,
			ComponentKind: component.ComponentKind, LogicalModelId: component.LogicalModelID,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
				LocalRuntime: proto.Clone(component.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
			}},
			Required: component.Required, Weight: component.Weight, Options: options,
		})
	}

	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents:          runtimeAgentAIConfigTestIntents(imageIntent),
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("new unhealthy image target code = %s, err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AI_CONFIG_TARGET_UNAVAILABLE {
		t.Fatalf("new unhealthy image target reason = %s, %v", reason, ok)
	}
	afterRejected, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
	rejectedImagePresent := false
	for _, intent := range afterRejected.GetIntents() {
		rejectedImagePresent = rejectedImagePresent || intent.GetCapability() == runtimeAgentAIConfigCapabilityImageGenerate
	}
	if loadErr != nil || afterRejected.GetRevision() != 1 || rejectedImagePresent {
		t.Fatalf("rejected unhealthy exact composition mutated config: config=%+v err=%v", afterRejected, loadErr)
	}

	asset.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
	asset.DurableTargetStatus = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
	committed, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents:          runtimeAgentAIConfigTestIntents(imageIntent),
	})
	if err != nil {
		t.Fatalf("commit installed exact image target: %v", err)
	}
	if committed.GetConfig().GetRevision() != 2 {
		t.Fatalf("installed image commit revision = %d", committed.GetConfig().GetRevision())
	}
	configuredUnverified := requireExecutionCapabilityReadiness(
		t,
		agentAIConfigReadinessSnapshot(t, svc),
		runtimeAgentAIConfigCapabilityImageGenerate,
	)
	if configuredUnverified.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_CONFIGURED_UNVERIFIED ||
		configuredUnverified.GetReasonCode() != agentAIConfigReadinessReasonImageConfiguredUnverified ||
		configuredUnverified.GetProbedAt() != nil {
		t.Fatalf("installed exact image readiness = %+v", configuredUnverified)
	}
	committedImageBeforeFailure := proto.Clone(
		requireAgentAIConfigIntent(t, committed.GetConfig(), runtimeAgentAIConfigCapabilityImageGenerate),
	).(*runtimev1.RuntimeAgentAIConfigIntent)

	asset.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	asset.DurableTargetStatus = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	degraded := requireExecutionCapabilityReadiness(
		t,
		agentAIConfigReadinessSnapshot(t, svc),
		runtimeAgentAIConfigCapabilityImageGenerate,
	)
	if degraded.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE ||
		degraded.GetReasonCode() != agentAIConfigReadinessReasonImageRouteUnavailable {
		t.Fatalf("degraded exact image readiness = %+v", degraded)
	}
	degradedConfig, loadErr := svc.committedRuntimeAgentAIConfigByAgentInstanceID(runtimeAgentAIConfigTestLocalRef)
	if loadErr != nil || degradedConfig.GetRevision() != 2 ||
		!proto.Equal(requireAgentAIConfigIntent(t, degradedConfig, runtimeAgentAIConfigCapabilityImageGenerate), committedImageBeforeFailure) {
		t.Fatalf("exact execution degradation mutated committed composition: config=%+v err=%v", degradedConfig, loadErr)
	}

	current := committed.GetConfig()
	next := make([]*runtimev1.RuntimeAgentAIConfigIntent, 0, len(current.GetIntents()))
	for _, intent := range current.GetIntents() {
		cloned := proto.Clone(intent).(*runtimev1.RuntimeAgentAIConfigIntent)
		if cloned.GetCapability() == runtimeAgentAIConfigCapabilityTextGenerate {
			cloned.SelectedParams, _ = structpb.NewStruct(map[string]any{"temperature": 0.3})
		}
		next = append(next, cloned)
	}
	preserved, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: current.GetRevision(),
		Intents:          next,
	})
	if err != nil {
		t.Fatalf("save unrelated capability while image target degraded: %v", err)
	}
	if preserved.GetConfig().GetRevision() != 3 {
		t.Fatalf("unrelated save revision = %d", preserved.GetConfig().GetRevision())
	}
	preservedImage := requireAgentAIConfigIntent(t, preserved.GetConfig(), runtimeAgentAIConfigCapabilityImageGenerate)
	if preservedImage.GetModelId() != imageIntent.GetModelId() ||
		!proto.Equal(preservedImage.GetTargetRef(), imageIntent.GetTargetRef()) ||
		!runtimeAgentAIConfigComponentsEqual(preservedImage.GetSelectedComponents(), committedImageBeforeFailure.GetSelectedComponents()) {
		t.Fatalf("degraded image target was rebound: %+v", preservedImage)
	}

	asset.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	asset.DurableTargetStatus = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE
	recoveredSnapshot := agentAIConfigReadinessSnapshot(t, svc)
	recovered := requireExecutionCapabilityReadiness(t, recoveredSnapshot, runtimeAgentAIConfigCapabilityImageGenerate)
	if recoveredSnapshot.GetConfigRevision() != 3 ||
		recovered.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY {
		t.Fatalf("same-revision recovered exact image readiness = %+v", recoveredSnapshot)
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
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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
		Intents:          runtimeAgentAIConfigTestIntents(),
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
		Intents: runtimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
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
