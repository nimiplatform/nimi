package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
)

type managedCloudScenarioTestFixture struct {
	service          *Service
	connectorService *connector.Service
	context          context.Context
	connectorID      string
	descriptor       *runtimev1.ConnectorModelDescriptor
	targetRef        *runtimev1.RuntimeDurableTargetRef
}

func localScenarioTargetRef(ref string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref:     &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: ref},
			},
		},
	}
}

func localScenarioTargetRefForModel(modelID string) *runtimev1.RuntimeDurableTargetRef {
	if modelID == "" {
		modelID = "local/test"
	}
	return localScenarioTargetRef("local-runtime:" + modelID)
}

// setExactLocalScenarioTargetForTest installs the exact v2 target resolver that
// scenario execution now requires. Callers may pass their complete ACTIVE (or
// intentionally non-ACTIVE) asset fixture; otherwise a minimal ACTIVE asset is
// created for the requested capability.
func setExactLocalScenarioTargetForTest(
	t *testing.T,
	svc *Service,
	modelID string,
	capability string,
	assets ...*runtimev1.LocalAssetRecord,
) *runtimev1.RuntimeDurableTargetRef {
	t.Helper()
	modelID = strings.TrimSpace(modelID)
	capability = strings.TrimSpace(capability)
	if svc == nil || modelID == "" || capability == "" || len(assets) > 1 {
		t.Fatal("exact local scenario target fixture is incomplete")
	}

	var asset *runtimev1.LocalAssetRecord
	if len(assets) == 1 {
		asset = assets[0]
	}
	if asset == nil {
		engine := "llama"
		switch {
		case strings.HasPrefix(capability, "image."):
			engine = "media"
		case strings.HasPrefix(capability, "audio."), strings.HasPrefix(capability, "voice_workflow."):
			engine = "speech"
		}
		asset = &runtimev1.LocalAssetRecord{
			LocalAssetId:        "exact-target:" + modelID,
			AssetId:             modelID,
			LogicalModelId:      modelID,
			Engine:              engine,
			Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities:        []string{capability},
		}
	}
	if strings.TrimSpace(asset.GetLocalAssetId()) == "" {
		t.Fatal("exact local scenario target asset has no local_asset_id")
	}
	if strings.TrimSpace(asset.GetLogicalModelId()) == "" {
		asset.LogicalModelId = modelID
	}
	if asset.GetDurableTargetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNSPECIFIED {
		asset.DurableTargetStatus = asset.GetStatus()
	}
	if len(asset.GetCapabilities()) == 0 {
		asset.Capabilities = []string{capability}
	}

	base, _ := svc.localModel.(*fakeLocalModelLister)
	if existing, ok := svc.localModel.(*exactTargetLocalModelLister); ok {
		base = existing.fakeLocalModelLister
	}
	if base == nil {
		base = &fakeLocalModelLister{}
	}
	if base.managedNames == nil {
		base.managedNames = map[string]string{}
	}
	if strings.EqualFold(strings.TrimSpace(asset.GetEngine()), "llama") {
		providerModelID := strings.TrimSpace(asset.GetAssetId())
		if providerModelID == "" {
			providerModelID = modelID
		}
		base.managedNames[asset.GetLocalAssetId()] = providerModelID
	}

	binding := &runtimev1.RuntimeResolvedLocalExecutionBinding{
		LocalAssetId:    asset.GetLocalAssetId(),
		ResolvedModelId: modelID,
	}
	localTarget := &runtimev1.RuntimeDurableLocalTargetRef{Version: "v2"}
	if strings.HasPrefix(capability, "image.") {
		binding.ProfileBindingId = "test_workflow_binding:v2:" + asset.GetLocalAssetId()
		localTarget.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ProfileBindingId{ProfileBindingId: binding.GetProfileBindingId()}
	} else {
		// Route-describe metadata still identifies the already-resolved asset from
		// this opaque readiness ref; the durable resolver itself remains exact.
		binding.ReadinessRef = "local-runtime:" + asset.GetLocalAssetId()
		localTarget.Ref = &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{ReadinessRef: binding.GetReadinessRef()}
	}
	svc.SetLocalModelLister(&exactTargetLocalModelLister{
		fakeLocalModelLister: base,
		binding:              binding,
		asset:                asset,
	})
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{LocalRuntime: localTarget},
	}
}

func cloudScenarioTargetRef(connectorID string, remoteModelCatalogID string, providerModelID string, provider string) *runtimev1.RuntimeDurableTargetRef {
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
			Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
				Version:              "v2",
				ConnectorId:          connectorID,
				RemoteModelCatalogId: remoteModelCatalogID,
				ProviderModelId:      providerModelID,
				Provider:             provider,
			},
		},
	}
}

func cloudScenarioTargetRefForDescriptor(connectorID string, descriptor *runtimev1.ConnectorModelDescriptor) *runtimev1.RuntimeDurableTargetRef {
	return cloudScenarioTargetRef(
		connectorID,
		descriptor.GetRemoteModelCatalogId(),
		descriptor.GetProviderModelId(),
		descriptor.GetProvider(),
	)
}

func newManagedCloudScenarioTestFixture(t *testing.T, providerID string, modelID string, endpoint string, cfg Config) managedCloudScenarioTestFixture {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	if cfg.CloudProviders == nil {
		cfg.CloudProviders = map[string]nimillm.ProviderCredentials{}
	}
	creds := cfg.CloudProviders[providerID]
	if strings.TrimSpace(creds.BaseURL) == "" {
		creds.BaseURL = endpoint
	}
	if strings.TrimSpace(creds.APIKey) == "" {
		creds.APIKey = "test-key"
	}
	cfg.CloudProviders[providerID] = creds
	created, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "connector-" + strings.ReplaceAll(providerID, "_", "-") + "-managed",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:     "machine",
		Provider:    providerID,
		Endpoint:    endpoint,
		Label:       providerID + " Managed",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, creds.APIKey)
	if err != nil {
		t.Fatalf("create managed connector: %v", err)
	}
	connectorSvc := connector.New(logger, store, nil)
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-key-source", "managed"))
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, created.ConnectorID, modelID)
	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, cfg, 8, 2)
	if err != nil {
		t.Fatalf("new managed cloud ai service: %v", err)
	}
	return managedCloudScenarioTestFixture{
		service:          svc,
		connectorService: connectorSvc,
		context:          ctx,
		connectorID:      created.ConnectorID,
		descriptor:       descriptor,
		targetRef:        cloudScenarioTargetRefForDescriptor(created.ConnectorID, descriptor),
	}
}

func writeOpenAITTSModelsIfRequested(w http.ResponseWriter, r *http.Request) bool {
	if r.URL.Path != "/v1/models" && r.URL.Path != "/models" {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"data":[{"id":"tts-1"}]}`))
	return true
}

func outputText(output *runtimev1.ScenarioOutput) string {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextGenerate); ok {
		return value.TextGenerate.GetText()
	}
	return ""
}

func outputVectorCount(output *runtimev1.ScenarioOutput) int {
	if value, ok := output.GetOutput().(*runtimev1.ScenarioOutput_TextEmbed); ok {
		return len(value.TextEmbed.GetVectors())
	}
	return 0
}

func deltaArtifactChunk(delta *runtimev1.ScenarioStreamDelta) []byte {
	if value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Artifact); ok {
		return value.Artifact.GetChunk()
	}
	return nil
}

func deltaArtifactMimeType(delta *runtimev1.ScenarioStreamDelta) string {
	if value, ok := delta.GetDelta().(*runtimev1.ScenarioStreamDelta_Artifact); ok {
		return value.Artifact.GetMimeType()
	}
	return ""
}

func describeScenarioStreamEvents(events []*runtimev1.StreamScenarioEvent) string {
	parts := make([]string, 0, len(events))
	for _, event := range events {
		if event == nil {
			parts = append(parts, "<nil>")
			continue
		}
		part := event.GetEventType().String()
		if started := event.GetStarted(); started != nil {
			part += ":" + started.GetVoiceOutputMode().String()
		}
		if failed := event.GetFailed(); failed != nil {
			part += ":" + failed.GetReasonCode().String() + ":" + failed.GetActionHint()
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, ",")
}
