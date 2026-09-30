package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// A Cloud target committed before its provider shut the model down keeps the
// retired model and its old catalog identity. After the catalog row is removed
// it projects as a typed blocked selection and fails admission before dispatch,
// without substituting another model.
func TestCommittedRetiredCloudTextTargetsFailBeforeDispatch(t *testing.T) {
	for _, tc := range []struct {
		provider string
		active   string
		retired  []string
	}{
		{"qianfan", "ernie-5.1", []string{"ernie-x1.1", "ernie-x1.1-preview"}},
		{"stepfun", "step-3.7-flash", []string{"step-1-8k", "step-1-32k", "step-1v-8k", "step-1v-32k", "step-2-mini", "step-1o-vision-32k", "step-2-16k", "step-3"}},
		{"dashscope", "qwen3-vl-plus", []string{"qwen-vl-max-latest"}},
	} {
		t.Run(tc.provider, func(t *testing.T) { assertRetiredTextTargetsFailBeforeDispatch(t, tc.provider, tc.active, tc.retired) })
	}
}

func assertRetiredTextTargetsFailBeforeDispatch(t *testing.T, providerID, activeModel string, retiredModels []string) {
	var requests atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, "retired target must never dispatch", http.StatusInternalServerError)
	}))
	defer provider.Close()
	fixture := newManagedCloudScenarioTestFixture(t, providerID, activeModel, provider.URL, Config{AllowLoopbackEndpoint: true})
	options, _, err := connector.ListAIConfigCloudTargetOptions(context.Background(), fixture.service.connStore, fixture.service.speechCatalog, "user-001", "text.generate", fixture.connectorID, "", 500)
	if err != nil {
		t.Fatal(err)
	}
	activeListed := false
	for _, option := range options {
		model := option.ProviderTarget.GetFields()["providerModelId"].GetStringValue()
		if slices.Contains(retiredModels, model) {
			t.Fatalf("retired target remains selectable: %s", model)
		}
		if model == activeModel {
			activeListed = true
			selected := fixture.service.projectCloudEffectiveSelection(context.Background(), "user-001", "text.generate", &runtimev1.AIConfigCloudIntent{
				ConnectorRef: option.ConnectorRef, Implementation: option.Implementation, ProviderModelTarget: option.ProviderTarget,
			})
			if selected.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_READY {
				t.Fatalf("explicitly reselected successor is not ready: %+v", selected)
			}
		}
	}
	if !activeListed {
		t.Fatal("successor missing from text options")
	}
	for _, model := range retiredModels {
		t.Run(model, func(t *testing.T) {
			const oldCatalogID = "remote-model-catalog-before-2026-09-29-retirement"
			target, err := structpb.NewStruct(map[string]any{
				"provider": providerID, "providerModelId": model, "remoteModelCatalogId": oldCatalogID,
			})
			if err != nil {
				t.Fatal(err)
			}
			selection := fixture.service.projectCloudEffectiveSelection(context.Background(), "user-001", "text.generate", &runtimev1.AIConfigCloudIntent{
				ConnectorRef:        fixture.connectorID,
				Implementation:      &runtimev1.CapabilityImplementationIdentity{ImplementationId: providerID, DriverId: "nimillm", DriverDialect: providerID},
				ProviderModelTarget: target,
			})
			if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
				!slices.Equal(selection.GetReasons(), []string{runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE.String()}) {
				t.Fatalf("retired text target is not blocked/stale: %+v", selection)
			}
			ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "text.generate",
				cloudScenarioTargetRef(fixture.connectorID, oldCatalogID, model, providerID))
			_, err = fixture.service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
				}}},
			})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE {
				t.Fatalf("retired text execution reason=%v ok=%v err=%v", reason, ok, err)
			}
		})
	}
	if requests.Load() != 0 {
		t.Fatalf("retired targets dispatched %d requests", requests.Load())
	}
}

func TestCommittedRetiredCloudMediaTargetsFailTypedWithoutDispatch(t *testing.T) {
	videoSpec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: "A harbor at dawn.",
		}},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4)},
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
		{name: "google veo 3.0", provider: "google_veo", activeModel: "veo-3.1-fast-generate-preview", retiredModel: "veo-3.0-generate-001", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "google veo 3.0 fast", provider: "google_veo", activeModel: "veo-3.1-fast-generate-preview", retiredModel: "veo-3.0-fast-generate-001", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "gemini image preview", provider: "gemini", activeModel: "gemini-3.1-flash-image", retiredModel: "gemini-3.1-flash-image-preview", capability: "image.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: imageSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "stepfun retired image", provider: "stepfun", activeModel: "step-2x-large", retiredModel: "step-1x-medium", capability: "image.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: imageSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		{name: "volcengine seedance 1.5", provider: "volcengine", activeModel: "doubao-seedance-2-0-260128", retiredModel: "seedance-1-5-pro", capability: "video.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, spec: videoSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
		// Removed with its stable successor ahead of the announced 2026-10-02 shutdown.
		{name: "gemini 2.5 flash image", provider: "gemini", activeModel: "gemini-3.1-flash-image", retiredModel: "gemini-2.5-flash-image", capability: "image.generate", scenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, spec: imageSpec, submitReason: runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE, activeListed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newManagedCloudScenarioTestFixture(t, tc.provider, tc.activeModel, "https://provider.example.test/v1", Config{})
			host := newControlledRemoteMediaHost(false)
			fixture.service.SetRemoteMediaExecutionHost(host)
			const committedCatalogID = "remote-model-catalog-committed-before-retirement"

			options, _, err := connector.ListAIConfigCloudTargetOptions(context.Background(), fixture.service.connStore, fixture.service.speechCatalog, "user-001", tc.capability, fixture.connectorID, "", 500)
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
				reselected := fixture.service.projectCloudEffectiveSelection(context.Background(), "user-001", tc.capability, &runtimev1.AIConfigCloudIntent{
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
			selection := fixture.service.projectCloudEffectiveSelection(context.Background(), "user-001", tc.capability, &runtimev1.AIConfigCloudIntent{
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

// Tencent stopped legacy Hunyuan sales on 2026-06-30 and shuts its API down on
// 2026-09-30, so the hunyuan provider left the source catalog. A Connector
// stored before the retirement stays listed and deletable, but Test Connector
// and List Connector Models reject it before credential or provider access, it
// offers no AIConfig target, and each committed target fails typed without
// dispatch or substitution.
func TestRetiredHunyuanProviderFailsTypedWithoutDispatch(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-hunyuan-managed",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-001",
		Provider:    "hunyuan",
		Endpoint:    server.URL,
		Label:       "Hunyuan",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "legacy-hunyuan-key")
	if err != nil {
		t.Fatalf("store legacy Hunyuan connector: %v", err)
	}
	auditBackend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "audit-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer auditBackend.Close()
	audit, err := auditlog.Open(auditBackend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	connectorSvc := connector.New(logger, store, audit)
	ctx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)

	_, err = connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "hunyuan", ApiKey: "new-key"})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("create retired Hunyuan connector: reason=%v ok=%v err=%v", reason, ok, err)
	}
	listed, err := connectorSvc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{})
	if err != nil || len(listed.GetConnectors()) != 1 || listed.GetConnectors()[0].GetConnectorId() != created.ConnectorID {
		t.Fatalf("retired Hunyuan connector must stay listed for cleanup: %+v err=%v", listed, err)
	}
	tested, err := connectorSvc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: created.ConnectorID})
	if err != nil || tested.GetAck().GetOk() || tested.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("test retired Hunyuan connector: %+v err=%v", tested, err)
	}
	_, err = connectorSvc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: created.ConnectorID})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("list retired Hunyuan connector models: reason=%v ok=%v err=%v", reason, ok, err)
	}

	svc, err := newFromProviderConfig(logger, nil, store, Config{AllowLoopbackEndpoint: true}, 8, 2)
	if err != nil {
		t.Fatalf("new ai service: %v", err)
	}
	const committedCatalogID = "remote-model-catalog-committed-before-retirement"
	for _, tc := range []struct {
		capability string
		model      string
		submit     func(context.Context) error
	}{
		{capability: "text.generate", model: "hunyuan-2.0-instruct-20251111", submit: func(ctx context.Context) error {
			_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001", TimeoutMs: 30_000},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
				}}},
			})
			return err
		}},
		{capability: "text.embed", model: "hunyuan-embedding", submit: func(ctx context.Context) error {
			_, err := svc.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001", TimeoutMs: 30_000},
				ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
					Inputs: []string{"hello"},
				}}},
			})
			return err
		}},
		{capability: "image.generate", model: "hunyuan-dit", submit: func(ctx context.Context) error {
			_, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head:         &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"},
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
				Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A harbor at dawn."}}},
			})
			return err
		}},
	} {
		t.Run(tc.capability, func(t *testing.T) {
			connectors, _, err := connector.ListAIConfigCloudConnectorOptions(svc.connStore, svc.speechCatalog, "user-001", tc.capability, "", 500)
			if err != nil {
				t.Fatalf("ListAIConfigCloudConnectorOptions: %v", err)
			}
			for _, option := range connectors {
				if option.ConnectorRef == created.ConnectorID {
					t.Fatalf("retired Hunyuan connector is still offered for %s: %+v", tc.capability, option)
				}
			}
			_, _, err = connector.ListAIConfigCloudTargetOptions(context.Background(), svc.connStore, svc.speechCatalog, "user-001", tc.capability, created.ConnectorID, "", 500)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
				t.Fatalf("retired Hunyuan target options: reason=%v ok=%v err=%v", reason, ok, err)
			}

			providerTarget, err := structpb.NewStruct(map[string]any{
				"provider": "hunyuan", "providerModelId": tc.model, "remoteModelCatalogId": committedCatalogID,
			})
			if err != nil {
				t.Fatal(err)
			}
			selection := svc.projectCloudEffectiveSelection(context.Background(), "user-001", tc.capability, &runtimev1.AIConfigCloudIntent{
				ConnectorRef:        created.ConnectorID,
				Implementation:      &runtimev1.CapabilityImplementationIdentity{ImplementationId: "hunyuan", DriverId: "nimillm", DriverDialect: "hunyuan"},
				ProviderModelTarget: providerTarget,
			})
			if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
				!slices.Equal(selection.GetReasons(), []string{runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE.String()}) ||
				selection.GetResource() != nil {
				t.Fatalf("retired Hunyuan %s projection = %+v", tc.capability, selection)
			}

			submitCtx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), tc.capability,
				cloudScenarioTargetRef(created.ConnectorID, committedCatalogID, tc.model, "hunyuan"))
			err = tc.submit(submitCtx)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
				t.Fatalf("retired Hunyuan %s admission: reason=%v ok=%v err=%v", tc.capability, reason, ok, err)
			}
		})
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("retired Hunyuan provider dispatched %d provider requests", got)
	}

	deleted, err := connectorSvc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: created.ConnectorID})
	if err != nil || !deleted.GetAck().GetOk() {
		t.Fatalf("retired Hunyuan connector must stay deletable: %+v err=%v", deleted, err)
	}
}

// The private ChatGPT backend route left the source catalog when the public
// SIWC ChatGPT-plan provider replaced it. A legacy Codex Connector stays listed
// and deletable, but it is never tested, listed for models, offered, converted
// or dispatched, and its committed text target fails typed.
func TestRetiredOpenAICodexProviderFailsTypedWithoutDispatch(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-openai-codex-legacy", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
		Provider: "openai_codex", Endpoint: server.URL + "/backend-api/codex", Label: "OpenAI Codex",
		Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_codex",
	}, `{"access_token":"legacy-codex-token","refresh_token":"legacy-refresh"}`)
	if err != nil {
		t.Fatalf("store legacy Codex connector: %v", err)
	}
	auditBackend, err := runtimepersistence.Open(logger, filepath.Join(t.TempDir(), "audit-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer auditBackend.Close()
	audit, err := auditlog.Open(auditBackend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	connectorSvc := connector.New(logger, store, audit)
	ctx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)
	_, err = connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai_codex", AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: "openai_codex", CredentialJson: `{"access_token":"x"}`,
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("create retired Codex connector: reason=%v ok=%v err=%v", reason, ok, err)
	}
	_, err = connectorSvc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{
		ConnectorId: created.ConnectorID, ProviderAuthProfile: proto.String("openai_chatgpt_plan"),
		CredentialJson: proto.String(`{"access_token":"x"}`),
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("convert retired Codex connector: reason=%v ok=%v err=%v", reason, ok, err)
	}
	listed, err := connectorSvc.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{})
	if err != nil || len(listed.GetConnectors()) != 1 || listed.GetConnectors()[0].GetConnectorId() != created.ConnectorID {
		t.Fatalf("retired Codex connector must stay listed for cleanup: %+v err=%v", listed, err)
	}
	tested, err := connectorSvc.TestConnector(ctx, &runtimev1.TestConnectorRequest{ConnectorId: created.ConnectorID})
	if err != nil || tested.GetAck().GetOk() || tested.GetAck().GetReasonCode() != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("test retired Codex connector: %+v err=%v", tested, err)
	}
	_, err = connectorSvc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: created.ConnectorID})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_INVALID {
		t.Fatalf("list retired Codex models: reason=%v ok=%v err=%v", reason, ok, err)
	}
	svc, err := newFromProviderConfig(logger, nil, store, Config{AllowLoopbackEndpoint: true}, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	options, _, err := connector.ListAIConfigCloudConnectorOptions(svc.connStore, svc.speechCatalog, "user-001", "text.generate", "", 500)
	if err != nil {
		t.Fatal(err)
	}
	for _, option := range options {
		if option.ConnectorRef == created.ConnectorID {
			t.Fatalf("retired Codex connector is still offered: %+v", option)
		}
	}
	providerTarget, _ := structpb.NewStruct(map[string]any{"provider": "openai_codex", "providerModelId": "gpt-6-astra", "remoteModelCatalogId": "remote-model-catalog-before-siwc"})
	selection := svc.projectCloudEffectiveSelection(context.Background(), "user-001", "text.generate", &runtimev1.AIConfigCloudIntent{
		ConnectorRef: created.ConnectorID, ProviderModelTarget: providerTarget,
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "openai_codex", DriverId: "nimillm", DriverDialect: "openai_codex"},
	})
	if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED || selection.GetResource() != nil {
		t.Fatalf("retired Codex projection = %+v", selection)
	}
	submitCtx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), "text.generate",
		cloudScenarioTargetRef(created.ConnectorID, "remote-model-catalog-before-siwc", "gpt-6-astra", "openai_codex"))
	_, err = svc.ExecuteScenario(submitCtx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001", TimeoutMs: 30_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		}}},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
		t.Fatalf("retired Codex admission: reason=%v ok=%v err=%v", reason, ok, err)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("retired Codex provider dispatched %d requests", got)
	}
	deleted, err := connectorSvc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: created.ConnectorID})
	if err != nil || !deleted.GetAck().GetOk() {
		t.Fatalf("retired Codex connector must stay deletable: %+v err=%v", deleted, err)
	}
}
