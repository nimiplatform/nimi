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
	service     *Service
	context     context.Context
	connectorID string
	descriptor  *runtimev1.ConnectorModelDescriptor
	targetRef   *runtimev1.RuntimeDurableTargetRef
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
		service:     svc,
		context:     ctx,
		connectorID: created.ConnectorID,
		descriptor:  descriptor,
		targetRef:   cloudScenarioTargetRefForDescriptor(created.ConnectorID, descriptor),
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
