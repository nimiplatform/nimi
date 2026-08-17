package connector

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type failingSecretStore struct {
	err error
}

func (f failingSecretStore) WriteSecret(string, string) error {
	return f.err
}

func (f failingSecretStore) ReadSecret(string) (string, bool, error) {
	return "", false, f.err
}

func (f failingSecretStore) DeleteSecret(string) error {
	return f.err
}

func newTestStore(t *testing.T) *ConnectorStore {
	t.Helper()
	dir := t.TempDir()
	return NewConnectorStoreWithMemorySecrets(dir)
}

func TestNewConnectorStoreIgnoresEnvironmentMemorySecretOverride(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CONNECTOR_TEST_MEMORY_SECRETS", "1")
	store := NewConnectorStore(t.TempDir())
	rec := ConnectorRecord{
		ConnectorID: "test-memory-secret",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Endpoint:    "https://api.openai.com/v1",
		Label:       "Memory Secret",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if _, err := store.Create(rec, "sk-memory"); err == nil {
		t.Fatal("environment override must not activate in-memory production connector custody")
	}
}

func TestConnectorRegistryCredentialEnvCannotBypassProtectedStore(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY", "env-secret-must-not-load")
	basePath := t.TempDir()
	registry := `[
  {
    "connector_id": "env-bypass",
    "kind": 2,
    "owner_type": 2,
    "owner_id": "user-1",
    "provider": "dashscope",
    "endpoint": "https://dashscope.example/v1",
    "label": "Environment bypass",
    "status": 1,
    "has_credential": true,
    "credential_env": "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY"
  }
]`
	if err := os.WriteFile(filepath.Join(basePath, registryFileName), []byte(registry), 0o600); err != nil {
		t.Fatalf("write legacy environment-backed registry: %v", err)
	}
	store := NewConnectorStore(basePath)
	if err := store.ReconcileStartup(); !errors.Is(err, ErrProtectedConnectorCustodyRequired) {
		t.Fatalf("environment-backed credential must fail at protected store boundary, got %v", err)
	}
}

func TestConnectorStoreCRUD(t *testing.T) {
	store := newTestStore(t)

	// Create
	rec := ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "user-1",
		Provider:  "openai",
		Endpoint:  "https://api.openai.com/v1",
		Label:     "My OpenAI",
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if _, err := store.Create(rec, "sk-test-key"); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Load all
	records, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if records[0].Provider != "openai" {
		t.Errorf("expected provider openai, got %s", records[0].Provider)
	}
	if !records[0].HasCredential {
		t.Error("expected has_credential=true")
	}
	connID := records[0].ConnectorID
	if connID == "" {
		t.Fatal("expected non-empty connector_id")
	}

	// Get
	got, found, err := store.Get(connID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !found {
		t.Fatal("expected found=true")
	}
	if got.Label != "My OpenAI" {
		t.Errorf("expected label 'My OpenAI', got %q", got.Label)
	}

	// LoadCredential
	apiKey, err := store.LoadCredential(connID)
	if err != nil {
		t.Fatalf("LoadCredential: %v", err)
	}
	if apiKey != "sk-test-key" {
		t.Errorf("expected api key 'sk-test-key', got %q", apiKey)
	}

	// Update
	newLabel := "Updated OpenAI"
	newKey := "sk-new-key"
	updated, err := store.Update(connID, ConnectorMutations{
		Label:         &newLabel,
		SecretPayload: &newKey,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Label != "Updated OpenAI" {
		t.Errorf("expected updated label, got %q", updated.Label)
	}

	apiKey2, err := store.LoadCredential(connID)
	if err != nil {
		t.Fatalf("LoadCredential after update: %v", err)
	}
	if apiKey2 != "sk-new-key" {
		t.Errorf("expected updated api key, got %q", apiKey2)
	}

	// Delete
	if err := store.Delete(connID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	records, err = store.Load()
	if err != nil {
		t.Fatalf("Load after delete: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("expected 0 records after delete, got %d", len(records))
	}

	// Credential should also be gone
	apiKey3, err := store.LoadCredential(connID)
	if err != nil {
		t.Fatalf("LoadCredential after delete: %v", err)
	}
	if apiKey3 != "" {
		t.Errorf("expected empty credential after delete, got %q", apiKey3)
	}
}

func TestConnectorStoreDeleteIdempotent(t *testing.T) {
	store := newTestStore(t)

	// Deleting a non-existent connector should not error
	if err := store.Delete("nonexistent"); err != nil {
		t.Fatalf("Delete nonexistent: %v", err)
	}
}

func TestConnectorStoreDuplicateCreate(t *testing.T) {
	store := newTestStore(t)

	rec := ConnectorRecord{
		ConnectorID: "fixed-id",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if _, err := store.Create(rec, "key1"); err != nil {
		t.Fatalf("first Create: %v", err)
	}
	if _, err := store.Create(rec, "key2"); err == nil {
		t.Fatal("expected error on duplicate Create")
	}
}

func TestConnectorStoreUpdateNotFound(t *testing.T) {
	store := newTestStore(t)

	_, err := store.Update("nonexistent", ConnectorMutations{})
	if err == nil {
		t.Fatal("expected error on Update nonexistent")
	}
}

func TestConnectorStoreUpdateClearCredential(t *testing.T) {
	store := newTestStore(t)

	rec := ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "user-1",
		Provider:  "openai",
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if _, err := store.Create(rec, "key1"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	records, _ := store.Load()
	connID := records[0].ConnectorID

	emptyKey := ""
	updated, err := store.Update(connID, ConnectorMutations{SecretPayload: &emptyKey})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.HasCredential {
		t.Error("expected has_credential=false after clearing key")
	}
}

func TestConnectorStoreReconcileStartup(t *testing.T) {
	store := newTestStore(t)

	// Create a connector, then manually mark it delete_pending
	rec := ConnectorRecord{
		ConnectorID:   "pending-delete",
		Kind:          runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:     runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:       "user-1",
		Provider:      "openai",
		Status:        runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		DeletePending: true,
		CreatedAt:     1000,
		UpdatedAt:     1000,
	}
	// Write registry directly with delete_pending=true
	if _, err := store.Create(ConnectorRecord{
		ConnectorID: "healthy-conn",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "gemini",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "gemini-key"); err != nil {
		t.Fatalf("Create healthy: %v", err)
	}

	// Manually inject the delete_pending record into registry
	store.mu.Lock()
	records, _ := store.loadRegistryLocked()
	records = append(records, rec)
	_ = store.persistRegistryLocked(records)
	store.mu.Unlock()

	// Run reconciliation
	if err := store.ReconcileStartup(); err != nil {
		t.Fatalf("ReconcileStartup: %v", err)
	}

	// delete_pending should be cleaned
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(loaded) != 1 {
		t.Fatalf("expected 1 record after reconcile, got %d", len(loaded))
	}
	if loaded[0].ConnectorID != "healthy-conn" {
		t.Errorf("expected healthy-conn, got %s", loaded[0].ConnectorID)
	}
}

func TestReconcileStartupDoesNotCreateRetiredLocalCategories(t *testing.T) {
	store := newTestStore(t)
	if err := store.ReconcileStartup(); err != nil {
		t.Fatalf("reconcile empty connector store: %v", err)
	}
	records, err := store.Load()
	if err != nil {
		t.Fatalf("load reconciled connector store: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("startup minted ConnectorService records: %+v", records)
	}

	created, err := store.Create(ConnectorRecord{
		ConnectorID: "remote-only",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "remote-secret")
	if err != nil {
		t.Fatalf("create admitted remote connector: %v", err)
	}
	if err := store.ReconcileStartup(); err != nil {
		t.Fatalf("reconcile remote connector store: %v", err)
	}
	records, err = store.Load()
	if err != nil || len(records) != 1 || records[0].ConnectorID != created.ConnectorID {
		t.Fatalf("reconciled remote connector projection = (%+v, %v)", records, err)
	}
	for _, record := range records {
		if record.RetiredLocalCategory != 0 {
			t.Fatalf("startup retained or minted retired local connector category: %+v", record)
		}
	}
}

func TestConnectorStoreAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-file")

	if err := atomicWriteFile(path, []byte("hello"), 0o600); err != nil {
		t.Fatalf("atomicWriteFile: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(data) != "hello" {
		t.Errorf("expected 'hello', got %q", string(data))
	}

	// Verify no temp file remains
	tmpPath := path + ".tmp"
	if _, err := os.Stat(tmpPath); !os.IsNotExist(err) {
		t.Error("expected temp file to be cleaned up")
	}
}

func TestConnectorStoreDeleteCompensation(t *testing.T) {
	store := newTestStore(t)

	// Create connector with credential
	rec := ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "user-1",
		Provider:  "openai",
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}
	if _, err := store.Create(rec, "secret-key"); err != nil {
		t.Fatalf("Create: %v", err)
	}
	records, _ := store.Load()
	connID := records[0].ConnectorID

	// Verify credential exists
	cred, err := store.LoadCredential(connID)
	if err != nil {
		t.Fatalf("LoadCredential before delete: %v", err)
	}
	if cred != "secret-key" {
		t.Fatalf("expected secret-key, got %q", cred)
	}

	// Delete
	if err := store.Delete(connID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Verify credential file is removed
	credAfterDelete, err := store.LoadCredential(connID)
	if err != nil {
		t.Fatalf("LoadCredential after delete: %v", err)
	}
	if credAfterDelete != "" {
		t.Errorf("expected deleted credential, got %q", credAfterDelete)
	}

	// Verify registry is clean
	loaded, _ := store.Load()
	if len(loaded) != 0 {
		t.Error("expected empty registry")
	}
}

func TestConnectorStoreRejectsTraversalConnectorID(t *testing.T) {
	store := newTestStore(t)

	_, err := store.Create(ConnectorRecord{
		ConnectorID: "../escape",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "secret")
	if err == nil {
		t.Fatalf("expected invalid connector id error")
	}
	if _, loadErr := store.LoadCredential("../escape"); loadErr == nil {
		t.Fatalf("expected credential path validation error")
	}
}

func TestConnectorStoreCreateWithOwnerLimit(t *testing.T) {
	store := newTestStore(t)
	for i := 0; i < 2; i++ {
		if _, err := store.CreateWithOwnerLimit(ConnectorRecord{
			Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
			OwnerID:   "user-1",
			Provider:  "openai",
			Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		}, "secret", 2); err != nil {
			t.Fatalf("CreateWithOwnerLimit #%d: %v", i, err)
		}
	}
	if _, err := store.CreateWithOwnerLimit(ConnectorRecord{
		Kind:      runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:   "user-1",
		Provider:  "openai",
		Status:    runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "secret", 2); !errors.Is(err, errConnectorLimitExceeded) {
		t.Fatalf("expected errConnectorLimitExceeded, got %v", err)
	}
}

func TestConnectorStoreCreateFailsWhenSecureStoreUnavailable(t *testing.T) {
	store := newConnectorStore(t.TempDir(), failingSecretStore{err: fmt.Errorf("secure store unavailable")})
	_, err := store.Create(ConnectorRecord{
		ConnectorID: "no-secure-store",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "secret")
	if err == nil {
		t.Fatal("expected create failure when secure store is unavailable")
	}
}

func TestConnectorCredentialCustodySurvivesConnectorDeletion(t *testing.T) {
	store := newTestStore(t)
	record, err := store.Create(ConnectorRecord{
		ConnectorID: "queued-cloud-job",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"captured-secret"}`)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	capturedRecord, ref, err := store.CaptureCredentialCustody(record.ConnectorID, "01KJOB00000000000000000000")
	if err != nil {
		t.Fatalf("CaptureCredentialCustody: %v", err)
	}
	if capturedRecord.ConnectorID != record.ConnectorID {
		t.Fatalf("captured Connector=%+v", capturedRecord)
	}
	if err := store.Delete(record.ConnectorID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if current, err := store.LoadSecretPayload(record.ConnectorID); err != nil || current != "" {
		t.Fatalf("live connector credential after delete = %q, err=%v", current, err)
	}
	captured, err := store.LoadCredentialCustody(ref)
	if err != nil || captured != `{"apiKey":"captured-secret"}` {
		t.Fatalf("captured credential after delete = %q, err=%v", captured, err)
	}
	if err := store.ReleaseCredentialCustody(ref); err != nil {
		t.Fatalf("ReleaseCredentialCustody: %v", err)
	}
	if captured, err := store.LoadCredentialCustody(ref); err != nil || captured != "" {
		t.Fatalf("released credential = %q, err=%v", captured, err)
	}
}

func TestConnectorCredentialCustodyRejectsDisabledConnector(t *testing.T) {
	store := newTestStore(t)
	record, err := store.Create(ConnectorRecord{
		ConnectorID: "disabled-cloud-job",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"must-not-capture"}`)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
	if _, err := store.Update(record.ConnectorID, ConnectorMutations{Status: &disabled}); err != nil {
		t.Fatalf("disable Connector: %v", err)
	}
	if _, ref, err := store.CaptureCredentialCustody(record.ConnectorID, "job-after-disable"); err == nil || ref != "" {
		t.Fatalf("CaptureCredentialCustody after disable = %q, err=%v", ref, err)
	}
	ref, err := scenarioJobCredentialCustodyRef("job-after-disable")
	if err != nil {
		t.Fatal(err)
	}
	if captured, err := store.LoadCredentialCustody(ref); err != nil || captured != "" {
		t.Fatalf("disabled Connector created custody = %q, err=%v", captured, err)
	}
}

func TestConnectorStoreRejectsCredentialCustodyNamespaceAsConnectorID(t *testing.T) {
	store := newTestStore(t)
	created, err := store.Create(ConnectorRecord{
		ConnectorID: scenarioJobCredentialCustodyPrefix + "job-1",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-1",
		Provider:    "openai",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"must-not-write"}`)
	if err == nil || created.ConnectorID != "" {
		t.Fatalf("Create with reserved credential custody ID = %+v, err=%v", created, err)
	}
	ref := scenarioJobCredentialCustodyPrefix + "job-1"
	if captured, err := store.LoadCredentialCustody(ref); err != nil || captured != "" {
		t.Fatalf("reserved Connector ID wrote credential custody = %q, err=%v", captured, err)
	}
}
