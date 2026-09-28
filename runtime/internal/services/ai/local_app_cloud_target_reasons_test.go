package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/types/known/structpb"
)

// A protected App that runs a committed Cloud target which can no longer
// execute receives the exact typed Runtime reason for the Connector or catalog
// state, never an unclassified failure, and nothing reaches the provider.
func TestProtectedLocalAppCloudTargetFailuresKeepTypedReasons(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	const provider, model = "volcengine", "doubao-seed-2-1-turbo-260628"
	fixture := newManagedCloudScenarioTestFixture(t, provider, model, server.URL, Config{
		AllowLoopbackEndpoint: true,
		CloudProviders:        map[string]nimillm.ProviderCredentials{provider: {BaseURL: server.URL, APIKey: "test-key"}},
	})
	store := fixture.service.connStore
	implementation := &runtimev1.CapabilityImplementationIdentity{ImplementationId: provider, DriverId: "nimillm", DriverDialect: provider}
	commit := func(t *testing.T, capability string, connectorRef string, target map[string]any, impl *runtimev1.CapabilityImplementationIdentity) {
		t.Helper()
		providerTarget, err := structpb.NewStruct(target)
		if err != nil {
			t.Fatal(err)
		}
		config := appAIConfig("app.reasons", &runtimev1.AIConfigCapabilityIntent{
			CapabilityContract: capability, Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
				Implementation: impl, ConnectorRef: connectorRef, ProviderModelTarget: providerTarget,
			}},
		})
		if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
			t.Fatal(err)
		}
	}
	decision := func(op accountservice.LocalAppOperation, id string) context.Context {
		return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
			AccountID: "user-001", AppID: "app.reasons", RegisteredAppSubject: "app-subject-reasons",
			Operation: op, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: id,
		})
	}
	runText := func() error {
		_, err := fixture.service.ExecuteLocalAppScenario(
			decision(accountservice.LocalAppOperationScenarioExecute, localappop.AppOperationIDScenarioExecute),
			&runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextGenerate{TextGenerate: &runtimev1.StreamLocalAppTextTurnRequest{
				Messages: []*runtimev1.LocalAppTextCandidateMessage{{Role: "user", Text: "hello"}},
			}}},
		)
		return err
	}
	runImage := func() error {
		_, err := fixture.service.SubmitLocalAppScenarioJob(
			decision(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
			&runtimev1.SubmitLocalAppScenarioJobRequest{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
				ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "A harbor at dawn."},
			}},
		)
		return err
	}
	expect := func(t *testing.T, err error, want runtimev1.ReasonCode) {
		t.Helper()
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != want {
			t.Fatalf("reason=%v ok=%v err=%v, want %v", reason, ok, err, want)
		}
	}
	currentTarget := map[string]any{"provider": provider, "providerModelId": model, "remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId()}

	t.Run("catalog changed after the target was committed", func(t *testing.T) {
		commit(t, "text.generate", fixture.connectorID, map[string]any{
			"provider": provider, "providerModelId": model, "remoteModelCatalogId": "remote-model-catalog-before-catalog-change",
		}, implementation)
		expect(t, runText(), runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE)
	})

	t.Run("connector disabled", func(t *testing.T) {
		commit(t, "text.generate", fixture.connectorID, currentTarget, implementation)
		disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
		if _, err := store.Update(fixture.connectorID, connector.ConnectorMutations{Status: &disabled}); err != nil {
			t.Fatal(err)
		}
		defer func() {
			active := runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE
			if _, err := store.Update(fixture.connectorID, connector.ConnectorMutations{Status: &active}); err != nil {
				t.Fatal(err)
			}
		}()
		expect(t, runText(), runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
	})

	t.Run("connector has no credential", func(t *testing.T) {
		keyless, err := store.Create(connector.ConnectorRecord{
			ConnectorID: "connector-volcengine-keyless", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
			Provider: provider, Endpoint: server.URL, Label: "keyless", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}, "")
		if err != nil {
			t.Fatal(err)
		}
		descriptor := connectorModelDescriptorForAITest(t, fixture.connectorService, fixture.context, keyless.ConnectorID, model)
		commit(t, "text.generate", keyless.ConnectorID, map[string]any{
			"provider": provider, "providerModelId": model, "remoteModelCatalogId": descriptor.GetRemoteModelCatalogId(),
		}, implementation)
		expect(t, runText(), runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	})

	t.Run("provider retired after the target was committed", func(t *testing.T) {
		retired, err := store.Create(connector.ConnectorRecord{
			ConnectorID: "connector-hunyuan-retired", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-001",
			Provider: "hunyuan", Endpoint: server.URL, Label: "hunyuan", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}, "legacy-key")
		if err != nil {
			t.Fatal(err)
		}
		retiredImpl := &runtimev1.CapabilityImplementationIdentity{ImplementationId: "hunyuan", DriverId: "nimillm", DriverDialect: "hunyuan"}
		commit(t, "image.generate", retired.ConnectorID, map[string]any{
			"provider": "hunyuan", "providerModelId": "hunyuan-dit", "remoteModelCatalogId": "remote-model-catalog-before-retirement",
		}, retiredImpl)
		// The retired provider has no Driver, so admission rejects the committed
		// implementation before any Connector or catalog binding is attempted.
		expect(t, runImage(), runtimev1.ReasonCode_AI_CONFIG_INVALID)
	})

	if got := requests.Load(); got != 0 {
		t.Fatalf("blocked Cloud targets dispatched %d provider requests", got)
	}
}

func TestProtectedLocalAppCommittedCloudEmbeddingWithoutFixedDimensionFailsBeforeDispatch(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	fixture := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-embedding", server.URL, Config{AllowLoopbackEndpoint: true})
	target, err := structpb.NewStruct(map[string]any{
		"provider": "volcengine", "providerModelId": fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	const appID = "app.embed-width"
	config := appAIConfig(appID, &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.embed",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "volcengine", DriverId: "nimillm", DriverDialect: "volcengine"},
			ConnectorRef:   fixture.connectorID, ProviderModelTarget: target,
		}},
	})
	if err := overwriteAIConfigStoreForTest(context.Background(), fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	read, err := fixture.service.GetAppAIConfig(
		localAppAIConfigContext("user-001", appID, accountservice.LocalAppOperationAppAIConfigRead),
		&runtimev1.GetAppAIConfigRequest{},
	)
	if err != nil || len(read.GetEffectiveSelections()) != 1 {
		t.Fatalf("committed Cloud embedding selection = %+v, %v", read, err)
	}
	selection := read.GetEffectiveSelections()[0]
	if selection.GetState() != runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED ||
		len(selection.GetReasons()) != 1 || selection.GetReasons()[0] != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH.String() {
		t.Fatalf("unverified-width committed selection = %+v", selection)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "user-001", AppID: appID, RegisteredAppSubject: "app-subject-embed-width",
		Operation:      accountservice.LocalAppOperationScenarioExecute,
		AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioExecute,
	})
	_, err = fixture.service.ExecuteLocalAppScenario(ctx, &runtimev1.ExecuteLocalAppScenarioRequest{
		Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"hello"}}},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH {
		t.Fatalf("committed Cloud embedding reason=%v present=%v err=%v", reason, ok, err)
	}
	if requests.Load() != 0 {
		t.Fatalf("unverified-width Cloud embedding dispatched %d provider requests", requests.Load())
	}
}
