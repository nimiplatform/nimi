package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRetiredQwenDesignOptionsAndSavedConfigFailClosed(t *testing.T) {
	for _, model := range []string{"qwen3-tts-vd-2026-01-26", "qwen3-tts-vd-realtime-2026-01-15"} {
		t.Run(model, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.WriteHeader(http.StatusGone)
			}))
			defer server.Close()
			fixture := newManagedCloudScenarioTestFixture(t, "dashscope", model, server.URL, Config{AllowLoopbackEndpoint: true})
			const appID = "app.retired-design"
			options, err := fixture.service.ListAppAIConfigOptions(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigOptionsList), &runtimev1.ListAppAIConfigOptionsRequest{
				Query: &runtimev1.ListAppAIConfigOptionsRequest_CloudTargets{CloudTargets: &runtimev1.AIConfigCloudTargetOptionsQuery{CapabilityContract: "voice.create", ConnectorRef: fixture.connectorID}},
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, option := range options.GetCloudTargets().GetOptions() {
				if option.GetProviderModelTarget().GetFields()["providerModelId"].GetStringValue() == model {
					t.Fatal("retired design is still offered by public AIConfig")
				}
			}
			// Restore an already saved selection to exercise retirement after catalog update.
			intent := cloudVoiceAIConfigIntent(t, fixture.connectorID, fixture.descriptor)
			if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", appAIConfig(appID, intent)); err != nil {
				t.Fatal(err)
			}
			read, err := fixture.service.GetAppAIConfig(localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead), &runtimev1.GetAppAIConfigRequest{})
			if err != nil || len(read.GetEffectiveSelections()) != 1 || read.GetEffectiveSelections()[0].GetState() == runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
				t.Fatalf("retired saved selection must not be ready: %v %v", read, err)
			}
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
				AccountID: "user-001", AppID: appID, RegisteredAppSubject: "retired-design-principal", Operation: accountservice.LocalAppOperationScenarioJobSubmit,
				AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioJobSubmit,
			})
			response, err := fixture.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{
				Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
					Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator", PreviewText: "Hello from Nimi."}},
				}},
			})
			assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
			if response != nil || calls.Load() != 0 {
				t.Fatalf("retired selection published a job or reached provider: %v calls=%d", response, calls.Load())
			}
		})
	}
}

func TestRetiredQwenDesignAssetSurvivesReopenForSynthesis(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", "https://provider.example.test", Config{})
	svc := fixture.service
	statePath := filepath.Join(t.TempDir(), "state.json")
	store, err := newVoiceAssetStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	// An existing provider-persistent asset retains its original creation identity.
	asset := testActiveProviderPersistentVoiceAsset("existing-qwen-design")
	asset.AppId, asset.SubjectUserId = "app.retired-design", "user-001"
	asset.Provider, asset.ModelId, asset.TargetModelId = "dashscope", "qwen3-tts-vd-2026-01-26", "qwen3-tts-vd-2026-01-26"
	asset.Metadata, err = structpb.NewStruct(map[string]any{"workflow_model_id": "qwen-voice-design", "workflow_family": "dashscope"})
	if err != nil {
		t.Fatal(err)
	}
	store.assets[asset.GetVoiceAssetId()] = asset
	store.targets[asset.GetVoiceAssetId()] = fixture.targetRef.Clone()
	store.cloudBindings[asset.GetVoiceAssetId()] = testVoiceAssetCloudBinding(fixture.targetRef)
	if err := store.persistDurableAssetsLocked(); err != nil {
		t.Fatal(err)
	}
	svc.voiceAssets, err = newVoiceAssetStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	stored, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !ok || !proto.Equal(stored, asset) {
		t.Fatalf("existing asset changed on reopen: %v", stored)
	}
	listed, err := svc.ListVoiceAssets(scenarioJobUserContext(asset.GetAppId(), asset.GetSubjectUserId()), &runtimev1.ListVoiceAssetsRequest{AppId: asset.GetAppId(), SubjectUserId: asset.GetSubjectUserId()})
	if err != nil || len(listed.GetAssets()) != 1 || !proto.Equal(listed.GetAssets()[0], asset) {
		t.Fatalf("existing asset missing from list: %v %v", listed, err)
	}
	spec, err := svc.resolveSynthesizeSpeechSpecVoiceRefForTarget(context.Background(), &runtimev1.ScenarioRequestHead{AppId: asset.GetAppId(), SubjectUserId: asset.GetSubjectUserId()}, fixture.targetRef, runtimeAgentVoiceAssetTestSpec(asset.GetVoiceAssetId()))
	if err != nil || spec.GetVoiceRef().GetProviderVoiceRef() != asset.GetProviderVoiceRef() {
		t.Fatalf("existing synthesis reference lost: %v %v", spec, err)
	}
}
