package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

type managedCloudScenarioTestFixture struct {
	service          *Service
	connectorService *connector.Service
	context          context.Context
	connectorID      string
	descriptor       *runtimev1.ConnectorModelDescriptor
	targetRef        *runtimeidentity.Target
}

func cloudScenarioTargetRef(connectorID string, remoteModelCatalogID string, providerModelID string, provider string) *runtimeidentity.Target {
	return &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID:          connectorID,
		RemoteModelCatalogID: remoteModelCatalogID,
		ProviderModelID:      providerModelID,
		Provider:             provider,
	}}
}

func cloudScenarioTargetRefForDescriptor(connectorID string, descriptor *runtimev1.ConnectorModelDescriptor) *runtimeidentity.Target {
	return cloudScenarioTargetRef(
		connectorID,
		descriptor.GetRemoteModelCatalogId(),
		descriptor.GetProviderModelId(),
		descriptor.GetProvider(),
	)
}

func withCloudScenarioTestIntent(ctx context.Context, capabilityContract string, target *runtimeidentity.Target) context.Context {
	var cloud *runtimeidentity.CloudTarget
	if target != nil {
		cloud = target.GetCloud().Clone()
	}
	intent := executionintent.Intent{
		CapabilityContract: capabilityContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
	}
	providerTarget := &structpb.Struct{}
	providerID := "missing"
	if cloud != nil {
		providerTarget, _ = structpb.NewStruct(map[string]any{
			"provider":             cloud.Provider,
			"providerModelId":      cloud.ProviderModelID,
			"remoteModelCatalogId": cloud.RemoteModelCatalogID,
		})
		providerID = cloud.Provider
	}
	dialect := "provider/media-v1"
	if capabilityContract == "text.generate" {
		dialect = "provider/text-v1"
	}
	intent.CloudImplementation = &runtimev1.CapabilityImplementationIdentity{
		ImplementationId: "cloud." + capabilityContract + "." + providerID,
		DriverId:         "nimi.runtime.driver." + providerID,
		DriverDialect:    dialect,
	}
	intent.ProviderModelTarget = providerTarget
	return executionintent.WithIntent(ctx, intent)
}

func withLocalScenarioTestIntent(ctx context.Context, capabilityContract string) context.Context {
	return executionintent.WithIntent(ctx, executionintent.Intent{
		CapabilityContract: capabilityContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
}

func newManagedCloudScenarioTestFixture(t *testing.T, providerID string, providerModelID string, endpoint string, cfg Config) managedCloudScenarioTestFixture {
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
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-001",
		Provider:    providerID,
		Endpoint:    endpoint,
		Label:       providerID + " Managed",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, creds.APIKey)
	if err != nil {
		t.Fatalf("create managed connector: %v", err)
	}
	connectorSvc := connector.New(logger, store, nil)
	ctx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, created.ConnectorID, providerModelID)
	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, cfg, 8, 2)
	if err != nil {
		t.Fatalf("new managed cloud ai service: %v", err)
	}
	targetRef := cloudScenarioTargetRefForDescriptor(created.ConnectorID, descriptor)
	return managedCloudScenarioTestFixture{
		service:          svc,
		connectorService: connectorSvc,
		context:          ctx,
		connectorID:      created.ConnectorID,
		descriptor:       descriptor,
		targetRef:        targetRef,
	}
}

func connectorModelDescriptorForAITest(
	t *testing.T,
	svc *connector.Service,
	ctx context.Context,
	connectorID string,
	providerModelID string,
) *runtimev1.ConnectorModelDescriptor {
	t.Helper()
	resp, err := svc.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{
		ConnectorId: connectorID,
		PageSize:    200,
	})
	if err != nil {
		t.Fatalf("ListConnectorModels: %v", err)
	}
	for _, model := range resp.GetModels() {
		if model.GetProviderModelId() == providerModelID {
			return model
		}
	}
	t.Fatalf("provider model %q not found", providerModelID)
	return nil
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
