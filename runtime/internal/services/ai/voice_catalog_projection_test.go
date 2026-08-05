package ai

import (
	"io"
	"log/slog"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/metadata"
)

type catalogProjectionSecretStore struct {
	mu      sync.Mutex
	values  map[string]string
	readOps int
}

func (s *catalogProjectionSecretStore) WriteSecret(id string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[id] = value
	return nil
}

func (s *catalogProjectionSecretStore) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.readOps++
	value, ok := s.values[id]
	return value, ok, nil
}

func (s *catalogProjectionSecretStore) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}

func TestListPresetVoicesUsesCatalogProjectionWithoutExecutionSelection(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-audio", "https://example.com", Config{})
	response, err := fixture.service.ListPresetVoices(fixture.context, &runtimev1.ListPresetVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ConnectorId:   fixture.connectorID,
		ModelId:       "gpt-audio",
	})
	if err != nil {
		t.Fatalf("ListPresetVoices: %v", err)
	}
	if response.GetModelResolved() != "gpt-audio" || len(response.GetVoices()) == 0 {
		t.Fatalf("voice catalog projection = %+v", response)
	}
}

func TestListPresetVoicesDoesNotOpenManagedConnectorSecret(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	secrets := &catalogProjectionSecretStore{values: map[string]string{}}
	store := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(connector.ConnectorRecord{
		ConnectorID: "voice-catalog-connector",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-001",
		Provider:    "openai",
		Endpoint:    "https://example.com",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "catalog-secret")
	if err != nil {
		t.Fatal(err)
	}
	service, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{}, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	ctx := metadata.NewIncomingContext(userCtx("user-001"), metadata.Pairs("x-nimi-key-source", "managed"))
	response, err := service.ListPresetVoices(ctx, &runtimev1.ListPresetVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ConnectorId:   record.ConnectorID,
		ModelId:       "gpt-audio",
	})
	if err != nil || response.GetModelResolved() != "gpt-audio" {
		t.Fatalf("ListPresetVoices = %+v, %v", response, err)
	}
	secrets.mu.Lock()
	readOps := secrets.readOps
	secrets.mu.Unlock()
	if readOps != 0 {
		t.Fatalf("catalog projection opened connector secret %d times", readOps)
	}
}
