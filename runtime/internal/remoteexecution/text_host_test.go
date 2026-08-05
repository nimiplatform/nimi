package remoteexecution

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

type trackingSecretStore struct {
	mu     sync.Mutex
	values map[string]string
	reads  int
}

func (s *trackingSecretStore) WriteSecret(id string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[id] = value
	return nil
}

func (s *trackingSecretStore) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	value, ok := s.values[id]
	return value, ok, nil
}

func (s *trackingSecretStore) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}

func TestProviderTextHostOpensCredentialOnlyForDispatchAndAuditsSafely(t *testing.T) {
	const secret = "host-scope-secret-value"
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": "remote ok"}, "finish_reason": "stop"}},
		})
	}))
	defer server.Close()

	secrets := &trackingSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "account-a", Provider: "openai", Endpoint: server.URL,
		Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
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

	driver, target, mapped := remoteHostDriverInput(t)
	audit := auditlog.New(16, 16)
	transport := nimillm.NewCloudProvider(nimillm.CloudConfig{HTTPTimeout: time.Second, AllowLoopbackEndpoint: true}, nil, nil)
	host := NewProviderTextHost(store, transport, audit, true)
	response, err := host.ExecuteText(context.Background(), snapshot, target, mapped, TextDispatchAudit{
		AppID: "app", AccountID: "account-a", TraceID: "trace", CapabilityContract: "text.generate",
		ImplementationID: "cloud.text.openai", DriverID: "driver.openai", DriverDialect: "openai/chat-completions/v1",
		ConnectorGrantID: grant.GrantID, Provider: "openai", ProviderModelID: "gpt-4o-mini",
	})
	if err != nil {
		t.Fatalf("ExecuteText: %v", err)
	}
	result, err := driver.NormalizeResponse(response)
	if err != nil || result.Text != "remote ok" {
		t.Fatalf("NormalizeResponse = %+v, %v", result, err)
	}
	if authorization != "Bearer "+secret {
		t.Fatalf("provider authorization header = %q", authorization)
	}
	secrets.mu.Lock()
	reads := secrets.reads
	secrets.mu.Unlock()
	if reads != 1 {
		t.Fatalf("credential reads = %d, want exactly one request-scoped read", reads)
	}
	if strings.Contains(mapped.ProviderModelID(), secret) || strings.Contains(result.Text, secret) {
		t.Fatal("credential escaped into Driver carriers")
	}
	events, err := audit.ListEvents(&runtimev1.ListAuditEventsRequest{})
	if err != nil || len(events.GetEvents()) != 2 {
		t.Fatalf("dispatch audit = %+v, %v", events, err)
	}
	for _, event := range events.GetEvents() {
		raw, _ := protojson.Marshal(event)
		if strings.Contains(string(raw), secret) {
			t.Fatalf("credential leaked to audit: %s", raw)
		}
		if _, exists := event.GetPayload().GetFields()["fallback"]; exists {
			t.Fatalf("remote dispatch recorded a fallback decision: %s", raw)
		}
	}
}

func remoteHostDriverInput(t *testing.T) (capabilitydriver.CloudTextDriver, capabilitydriver.CloudTextTarget, *capabilitydriver.CloudTextMappedRequest) {
	t.Helper()
	rawTarget, _ := structpb.NewStruct(map[string]any{"provider": "openai", "model": "gpt-4o-mini"})
	driver, target, err := capabilitydriver.NewProductionCloudTextRegistry().Resolve(capabilitydriver.Identity{
		ImplementationID: "cloud.text.openai", DriverID: "driver.openai", DriverDialect: "openai/chat-completions/v1",
	}, rawTarget)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := driver.MapRequest(target, &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	return driver, target, mapped
}
