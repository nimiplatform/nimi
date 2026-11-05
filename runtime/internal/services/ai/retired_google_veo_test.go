package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRetiredGoogleVeoKeepsConnectionAndRejectsExecution(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); http.Error(w, "must not dispatch", 500) }))
	defer server.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := store.Create(connector.ConnectorRecord{ConnectorID: "old-veo", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001", Provider: "google_veo", Endpoint: server.URL, Label: "My old Veo", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "old-key")
	if err != nil {
		t.Fatal(err)
	}
	conn := connector.New(logger, store, nil)
	ctx := scenarioJobUserContext("nimi.desktop", "user-001")
	if _, err := conn.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: "google_veo", Endpoint: server.URL, ApiKey: "new-key"}); err == nil {
		t.Fatal("retired provider can be newly connected")
	}
	if _, err := conn.ListConnectorModels(ctx, &runtimev1.ListConnectorModelsRequest{ConnectorId: record.ConnectorID}); err == nil {
		t.Fatal("retired provider still has executable inventory")
	}
	svc, err := newFromProviderConfig(logger, nil, store, Config{AllowLoopbackEndpoint: true}, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	for _, model := range []string{"veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"} {
		t.Run(model, func(t *testing.T) {
			target, _ := structpb.NewStruct(map[string]any{"provider": "google_veo", "providerModelId": model, "remoteModelCatalogId": "old-catalog"})
			selection := svc.projectCloudEffectiveSelection(context.Background(), "user-001", "video.generate", &runtimev1.AIConfigCloudIntent{ConnectorRef: record.ConnectorID, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "google_veo", DriverId: "nimillm", DriverDialect: "google_veo"}, ProviderModelTarget: target}, nil)
			if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED || selection.GetResource() != nil {
				t.Fatalf("retired selection: %+v", selection)
			}
			callCtx := withCloudScenarioTestIntent(ctx, "video.generate", cloudScenarioTargetRef(record.ConnectorID, "old-catalog", model, "google_veo"))
			_, err := svc.SubmitScenarioJob(callCtx, &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Options: &runtimev1.VideoGenerationOptions{DurationSec: testInt32(4)}, Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A toy boat."}}}}}})
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONFIG_INVALID {
				t.Fatalf("retired dispatch: %v", err)
			}
		})
	}
	listed, err := conn.ListConnectors(ctx, &runtimev1.ListConnectorsRequest{})
	if err != nil || len(listed.GetConnectors()) != 1 || listed.GetConnectors()[0].GetProvider() != "google_veo" || listed.GetConnectors()[0].GetConnectorId() != record.ConnectorID {
		t.Fatalf("old connection was changed: %+v %v", listed, err)
	}
	if calls.Load() != 0 {
		t.Fatalf("retired requests dispatched: %d", calls.Load())
	}
}
