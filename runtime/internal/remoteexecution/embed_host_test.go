package remoteexecution

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestProviderEmbedHostConfinesCredentialToOneAuditedDispatch(t *testing.T) {
	const secret = "embed-host-secret"
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":1,"total_tokens":1}}`))
	}))
	defer server.Close()

	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID: "account-a", Provider: "openai", Endpoint: server.URL, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := store.CreateGrant("account-a", record.ConnectorID)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.ValidateGrantBinding("account-a", grant.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	secrets.mu.Lock()
	secrets.reads = 0
	secrets.mu.Unlock()

	rawTarget, _ := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "text-embedding-3-small", "remoteModelCatalogId": "catalog-1",
	})
	driver, target, err := capabilitydriver.NewProductionCloudEmbedRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: "cloud.text.embed.openai", DriverID: "driver.openai", DriverDialect: "openai/embeddings/v1",
	}, rawTarget)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	audit := auditlog.New(16, 16)
	host := NewProviderEmbedHost(
		store,
		nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}, nil, nil),
		audit,
		true,
	)
	response, err := host.ExecuteEmbed(context.Background(), snapshot, target, mapped, EmbedDispatchAudit{
		AppID: "app", AccountID: "account-a", TraceID: "trace", CapabilityContract: "text.embed",
		ImplementationID: "cloud.text.embed.openai", DriverID: "driver.openai", DriverDialect: "openai/embeddings/v1",
		ConnectorGrantID: grant.GrantID, Provider: "openai", ProviderModelID: "text-embedding-3-small", RemoteModelCatalogID: "catalog-1",
	})
	if err != nil {
		t.Fatalf("ExecuteEmbed: %v", err)
	}
	result, err := driver.NormalizeResponse(mapped, response)
	if err != nil || len(result.Vectors) != 1 {
		t.Fatalf("NormalizeResponse = %+v, %v", result, err)
	}
	if authorization != "Bearer "+secret {
		t.Fatalf("provider authorization = %q", authorization)
	}
	secrets.mu.Lock()
	reads := secrets.reads
	secrets.mu.Unlock()
	if reads != 1 {
		t.Fatalf("credential reads = %d, want one", reads)
	}
	events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil || len(events.GetEvents()) != 2 {
		t.Fatalf("dispatch audits = %+v, %v", events, err)
	}
	for _, event := range events.GetEvents() {
		raw, _ := protojson.Marshal(event)
		if strings.Contains(string(raw), secret) {
			t.Fatalf("credential leaked to audit: %s", raw)
		}
	}
}
