package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudTextExecutionResolvesCurrentAccountConnectorAndPreservesConfigurationOnProviderFailure(t *testing.T) {
	var failAuth atomic.Bool
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if failAuth.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"from committed AIConfig"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	cloudTarget, _ := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	config := appAIConfig("app.cloud", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Defaults:           mustCloudDefaults(t, map[string]any{"maxTokens": 32}),
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
			},
			ProviderModelTarget: cloudTarget,
		}},
	})
	if err := overwriteAIConfigStoreForTest(scenarioJobUserContext("app.cloud", "user-001"), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	request := &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
			Input: []*runtimev1.ChatMessage{{Role: "user", Content: "use committed route"}},
		}}},
	}
	ctx := scenarioJobUserContext("app.cloud", "user-001")
	response, err := fixture.service.ExecuteScenario(ctx, request)
	if err != nil || outputText(response.GetOutput()) != "from committed AIConfig" {
		t.Fatalf("ExecuteScenario = %+v, %v", response, err)
	}

	failAuth.Store(true)
	_, err = fixture.service.ExecuteScenario(ctx, request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("provider auth reason = %v present=%v err=%v", reason, ok, err)
	}
	stored, _, found, err := fixture.service.aiConfigStore.Get(ctx, "user-001", appAIConfigOwner("app.cloud"))
	if err != nil || !found || stored.GetCapabilities()[0].GetCloud() == nil {
		t.Fatalf("provider failure mutated AIConfig: found=%v config=%+v err=%v", found, stored, err)
	}
	connectorRecord, found, err := fixture.service.connStore.Get(fixture.connectorID)
	if err != nil || !found || connectorRecord.Status != runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE {
		t.Fatalf("provider failure mutated Connector: found=%v Connector=%+v err=%v", found, connectorRecord, err)
	}
	if calls.Load() != 2 {
		t.Fatalf("provider calls = %d, want no fallback calls", calls.Load())
	}
}

func TestCloudTextExecutionDoesNotInferSoleConnectorWithoutExactCatalogTarget(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"must not execute"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-4o-mini", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	cloudTarget, _ := structpb.NewStruct(map[string]any{
		"provider":        "openai",
		"providerModelId": fixture.descriptor.GetProviderModelId(),
	})
	config := appAIConfig("app.cloud", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/chat-completions/v1",
			},
			ProviderModelTarget: cloudTarget,
		}},
	})
	if _, err := aiconfig.Canonicalize(config); err == nil {
		t.Fatal("durable AIConfig accepted a Cloud target without remoteModelCatalogId")
	}

	if calls.Load() != 0 {
		t.Fatalf("provider calls = %d, want zero", calls.Load())
	}
}

func mustCloudDefaults(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	result, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
