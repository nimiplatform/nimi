package ai

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

// A Cloud target committed before its provider shut the model down keeps the
// retired model and its old catalog identity. After the catalog row is removed
// it projects as a typed blocked selection and fails admission before dispatch,
// without substituting another model.
func TestCommittedRetiredCloudMediaTargetsFailTypedWithoutDispatch(t *testing.T) {
	videoSpec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: "A harbor at dawn.",
		}},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(8)},
	}}}
	imageSpec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A harbor at dawn."}}}
	for _, tc := range []struct {
		name         string
		provider     string
		activeModel  string
		retiredModel string
		capability   string
		scenarioType runtimev1.ScenarioType
		spec         *runtimev1.ScenarioSpec
		submitReason runtimev1.ReasonCode
		activeListed bool
	}{
		// OpenAI keeps no video row, so its Driver no longer implements video.generate.
		{name: "openai sora-2", provider: "openai", activeModel: "gpt-image-1.5", retiredModel: "sora-2", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_CONFIG_INVALID, activeListed: false},
		{name: "google veo 3.0", provider: "google_veo", activeModel: "veo-3.1-generate-preview", retiredModel: "veo-3.0-generate-001", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "google veo 3.0 fast", provider: "google_veo", activeModel: "veo-3.1-generate-preview", retiredModel: "veo-3.0-fast-generate-001", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "gemini image preview", provider: "gemini", activeModel: "gemini-3.1-flash-image", retiredModel: "gemini-3.1-flash-image-preview", capability: "image.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: imageSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		// Removed with its stable successor ahead of the announced 2026-10-02 shutdown.
		{name: "gemini 2.5 flash image", provider: "gemini", activeModel: "gemini-3.1-flash-image", retiredModel: "gemini-2.5-flash-image", capability: "image.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: imageSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newManagedCloudScenarioTestFixture(t, tc.provider, tc.activeModel, "https://provider.example.test/v1", Config{})
			host := newControlledRemoteMediaHost(false)
			fixture.service.SetRemoteMediaExecutionHost(host)
			const committedCatalogID = "remote-model-catalog-committed-before-retirement"

			options, _, err := connector.ListAIConfigCloudTargetOptions(fixture.service.connStore, fixture.service.speechCatalog, "user-001", tc.capability, fixture.connectorID, "", 500)
			if err != nil {
				t.Fatalf("ListAIConfigCloudTargetOptions: %v", err)
			}
			var activeOption *connector.AIConfigCloudTargetOption
			for index, option := range options {
				providerModelID := option.ProviderTarget.GetFields()["providerModelId"].GetStringValue()
				if providerModelID == tc.retiredModel || option.Label == tc.retiredModel {
					t.Fatalf("retired model is still selectable: %+v", option)
				}
				if providerModelID == tc.activeModel {
					activeOption = &options[index]
				}
			}
			if (activeOption != nil) != tc.activeListed {
				t.Fatalf("active %s listed=%v, want %v among %d %s options", tc.activeModel, activeOption != nil, tc.activeListed, len(options), tc.capability)
			}
			if activeOption != nil {
				// Re-selecting the listed successor commits its current catalog identity.
				reselected := fixture.service.projectCloudEffectiveSelection("user-001", tc.capability, &runtimev1.AIConfigCloudIntent{
					ConnectorRef:        activeOption.ConnectorRef,
					Implementation:      activeOption.Implementation,
					ProviderModelTarget: activeOption.ProviderTarget,
				})
				if reselected.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY || reselected.GetResource() == nil {
					t.Fatalf("re-selected successor %s projection = %+v", tc.activeModel, reselected)
				}
			}

			providerTarget, err := structpb.NewStruct(map[string]any{
				"provider": tc.provider, "providerModelId": tc.retiredModel, "remoteModelCatalogId": committedCatalogID,
			})
			if err != nil {
				t.Fatal(err)
			}
			selection := fixture.service.projectCloudEffectiveSelection("user-001", tc.capability, &runtimev1.AIConfigCloudIntent{
				ConnectorRef: fixture.connectorID,
				Implementation: &runtimev1.CapabilityImplementationIdentity{
					ImplementationId: tc.provider, DriverId: "nimillm", DriverDialect: tc.provider,
				},
				ProviderModelTarget: providerTarget,
			})
			if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
				!slices.Equal(selection.GetReasons(), []string{runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE.String()}) ||
				selection.GetResource() != nil {
				t.Fatalf("retired committed target projection = %+v", selection)
			}

			ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), tc.capability,
				cloudScenarioTargetRef(fixture.connectorID, committedCatalogID, tc.retiredModel, tc.provider))
			_, err = fixture.service.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
				ScenarioType: tc.scenarioType,
				Spec:         tc.spec,
			})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != tc.submitReason {
				t.Fatalf("retired committed target admission: reason=%v ok=%v err=%v", reason, ok, err)
			}
			select {
			case record := <-host.started:
				t.Fatalf("retired target dispatched through Connector %+v", record)
			default:
			}
		})
	}
}

// Hunyuan's legacy text models went offline on 2026-06-22 and their rows were
// removed. A committed text target projects as blocked and fails admission
// because Hunyuan no longer declares text.generate; nothing reaches the
// provider endpoint and no other provider is substituted.
func TestCommittedRetiredHunyuanTextTargetFailsTypedWithoutDispatch(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "hunyuan", "hunyuan-embedding", server.URL, Config{AllowLoopbackEndpoint: true})
	const retiredModel = "hunyuan-2.0-instruct-20251111"
	const committedCatalogID = "remote-model-catalog-committed-before-retirement"

	options, _, err := connector.ListAIConfigCloudTargetOptions(fixture.service.connStore, fixture.service.speechCatalog, "user-001", "text.generate", fixture.connectorID, "", 500)
	if err != nil {
		t.Fatalf("ListAIConfigCloudTargetOptions: %v", err)
	}
	if len(options) != 0 {
		t.Fatalf("Hunyuan still offers text targets: %+v", options)
	}

	providerTarget, err := structpb.NewStruct(map[string]any{
		"provider": "hunyuan", "providerModelId": retiredModel, "remoteModelCatalogId": committedCatalogID,
	})
	if err != nil {
		t.Fatal(err)
	}
	selection := fixture.service.projectCloudEffectiveSelection("user-001", "text.generate", &runtimev1.AIConfigCloudIntent{
		ConnectorRef:        fixture.connectorID,
		Implementation:      &runtimev1.CapabilityImplementationIdentity{ImplementationId: "hunyuan", DriverId: "nimillm", DriverDialect: "hunyuan"},
		ProviderModelTarget: providerTarget,
	})
	if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
		!slices.Equal(selection.GetReasons(), []string{runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE.String()}) ||
		selection.GetResource() != nil {
		t.Fatalf("retired Hunyuan text projection = %+v", selection)
	}

	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "text.generate",
		cloudScenarioTargetRef(fixture.connectorID, committedCatalogID, retiredModel, "hunyuan"))
	_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001", TimeoutMs: 30_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		}}},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("retired Hunyuan text admission: reason=%v ok=%v err=%v", reason, ok, err)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("retired Hunyuan text target dispatched %d provider requests", got)
	}
}
