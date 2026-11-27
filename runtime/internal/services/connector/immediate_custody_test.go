package connector

import (
	"context"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type countingSecretStore struct {
	mu      sync.Mutex
	secrets map[string]string
	writes  int
	reads   int
	deletes int
}

func newCountingSecretStore() *countingSecretStore {
	return &countingSecretStore{secrets: make(map[string]string)}
}

func (c *countingSecretStore) WriteSecret(connectorID string, payload string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writes++
	c.secrets[connectorID] = payload
	return nil
}

func (c *countingSecretStore) ReadSecret(connectorID string) (string, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reads++
	secret, ok := c.secrets[connectorID]
	return secret, ok, nil
}

func (c *countingSecretStore) DeleteSecret(connectorID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deletes++
	delete(c.secrets, connectorID)
	return nil
}

func (c *countingSecretStore) snapshotCounts() (writes, reads, deletes int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.writes, c.reads, c.deletes
}

func TestImmediateCredentialCustodySkipsSecretStoreWritesAndPreservesSnapshot(t *testing.T) {
	secrets := newCountingSecretStore()
	store := NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	record, err := store.Create(ConnectorRecord{
		ConnectorID: "immediate-cloud-job",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Endpoint:    "https://api.openai.com/v1",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"original-secret"}`)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	writesBefore, _, deletesBefore := secrets.snapshotCounts()

	capturedRecord, ref, err := store.CaptureImmediateCredentialCustody(record.ConnectorID, "01KJOBIMMEDIATE00000000001")
	if err != nil {
		t.Fatalf("CaptureImmediateCredentialCustody: %v", err)
	}
	if capturedRecord.ConnectorID != record.ConnectorID || ref == "" {
		t.Fatalf("captured record=%+v ref=%q", capturedRecord, ref)
	}
	writesAfterCapture, _, deletesAfterCapture := secrets.snapshotCounts()
	if writesAfterCapture != writesBefore || deletesAfterCapture != deletesBefore {
		t.Fatalf("immediate capture touched durable SecretStore: writes %d->%d deletes %d->%d",
			writesBefore, writesAfterCapture, deletesBefore, deletesAfterCapture)
	}

	// Updating and then deleting the live Connector must not alter the captured
	// immediate credential generation.
	replacement := `{"apiKey":"updated-secret"}`
	if _, err := store.Update(record.ConnectorID, ConnectorMutations{SecretPayload: &replacement}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := store.Delete(record.ConnectorID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	writesBeforeLoad, _, deletesBeforeLoad := secrets.snapshotCounts()
	loaded, err := store.LoadCredentialCustody(ref)
	if err != nil || loaded != `{"apiKey":"original-secret"}` {
		t.Fatalf("LoadCredentialCustody after Connector update/delete = %q, err=%v", loaded, err)
	}

	store.mu.Lock()
	backingSlice := store.ephemeralCustody[ref]
	store.mu.Unlock()
	if len(backingSlice) == 0 {
		t.Fatal("expected ephemeral custody slice before release")
	}

	if err := store.ReleaseCredentialCustody(ref); err != nil {
		t.Fatalf("ReleaseCredentialCustody: %v", err)
	}
	writesAfterRelease, _, deletesAfterRelease := secrets.snapshotCounts()
	if writesAfterRelease != writesBeforeLoad || deletesAfterRelease != deletesBeforeLoad {
		t.Fatalf("immediate load/release touched durable SecretStore: writes %d->%d deletes %d->%d",
			writesBeforeLoad, writesAfterRelease, deletesBeforeLoad, deletesAfterRelease)
	}
	for i, b := range backingSlice {
		if b != 0 {
			t.Fatalf("ephemeral custody byte[%d] = %d, want zeroed on release", i, b)
		}
	}
	if after, err := store.LoadCredentialCustody(ref); err != nil || after != "" {
		t.Fatalf("LoadCredentialCustody after release = %q, err=%v; want empty", after, err)
	}
}

func TestImmediateChatGPTPlanRequestCaptureSkipsPerRequestSecretWrites(t *testing.T) {
	secrets := newCountingSecretStore()
	renewer := &fakeChatGPTPlanRenewer{}
	store := NewConnectorStoreWithSecretStore(t.TempDir(), secrets, WithChatGPTPlanRenewer(renewer))
	sealed, registration, err := SealChatGPTPlanAuthorization(testChatGPTPlanAuthorization(t, store.now(), nil), "", store.now())
	if err != nil {
		t.Fatalf("SealChatGPTPlanAuthorization: %v", err)
	}
	record, err := store.Create(ConnectorRecord{
		ConnectorID:         "siwc-immediate",
		Kind:                runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:           runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:             "user-1",
		Provider:            ChatGPTPlanProvider,
		Endpoint:            ChatGPTPlanEndpoint,
		Label:               "user@example.com",
		Status:              runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:            runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED,
		ProviderAuthProfile: ChatGPTPlanAuthProfile,
		OAuthRegistration:   registration,
	}, sealed)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	writesBefore, _, deletesBefore := secrets.snapshotCounts()

	if _, _, err := store.CaptureImmediateCredentialCustody(record.ConnectorID, "job-siwc-reject"); err == nil {
		t.Fatal("CaptureImmediateCredentialCustody accepted a SIWC connector")
	}
	captured, ref, err := store.CaptureImmediateChatGPTPlanRequestCredential(context.Background(), record.ConnectorID, "job-siwc-1")
	if err != nil || captured.ConnectorID != record.ConnectorID {
		t.Fatalf("CaptureImmediateChatGPTPlanRequestCredential: record=%+v err=%v", captured, err)
	}
	payload, err := store.LoadCredentialCustody(ref)
	if err != nil || strings.Contains(payload, "refresh") || !strings.Contains(payload, chatGPTPlanRequestAccessSchema) {
		t.Fatalf("captured SIWC payload = %q, err=%v", payload, err)
	}
	if resolved := ResolveCredential(record, payload); resolved.APIKey == "" {
		t.Fatal("captured immediate SIWC access token is unusable")
	}
	if err := store.ReleaseCredentialCustody(ref); err != nil {
		t.Fatalf("ReleaseCredentialCustody: %v", err)
	}
	writesAfter, _, deletesAfter := secrets.snapshotCounts()
	if writesAfter != writesBefore || deletesAfter != deletesBefore {
		t.Fatalf("immediate SIWC capture/release touched durable SecretStore: writes %d->%d deletes %d->%d",
			writesBefore, writesAfter, deletesBefore, deletesAfter)
	}
	if after, err := store.LoadCredentialCustody(ref); err != nil || after != "" {
		t.Fatalf("released SIWC custody = %q, err=%v; want empty", after, err)
	}
}
