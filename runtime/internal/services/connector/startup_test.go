package connector

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func tempConnectorStore(t *testing.T) *ConnectorStore {
	t.Helper()
	dir := t.TempDir()
	return NewConnectorStoreWithMemorySecrets(dir)
}

func TestEnsureCloudConnectorsFromConfig_CreateNew(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-test", Label: "Cloud Deepseek"},
		{Provider: "gemini", Endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", APIKey: "gem-key", Label: "Cloud Gemini"},
	}

	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	records, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	cloudRecords := filterSystemCloud(records)
	if len(cloudRecords) != 2 {
		t.Fatalf("expected 2 cloud connectors, got %d", len(cloudRecords))
	}

	for _, r := range cloudRecords {
		expectedID := SystemCloudConnectorID(r.Provider)
		if r.ConnectorID != expectedID {
			t.Errorf("expected ID %q, got %q", expectedID, r.ConnectorID)
		}
		if r.Kind != runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			t.Errorf("expected REMOTE_MANAGED, got %v", r.Kind)
		}
		if r.OwnerType != runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM {
			t.Errorf("expected SYSTEM owner, got %v", r.OwnerType)
		}
		if r.OwnerID != "system" {
			t.Errorf("expected owner_id=system, got %q", r.OwnerID)
		}
		if !r.HasCredential {
			t.Errorf("expected has_credential=true for %q", r.ConnectorID)
		}
	}
}

func TestEnsureCloudConnectorsFromConfig_Idempotent(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-test", Label: "Cloud Deepseek"},
	}

	// First run
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("first run: %v", err)
	}

	records1, _ := store.Load()
	cloud1 := filterSystemCloud(records1)
	if len(cloud1) != 1 {
		t.Fatalf("expected 1, got %d", len(cloud1))
	}
	createdAt := cloud1[0].CreatedAt

	// Second run with same data
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("second run: %v", err)
	}

	records2, _ := store.Load()
	cloud2 := filterSystemCloud(records2)
	if len(cloud2) != 1 {
		t.Fatalf("expected 1 after idempotent run, got %d", len(cloud2))
	}
	if cloud2[0].CreatedAt != createdAt {
		t.Error("createdAt should not change on idempotent run")
	}
}

func TestEnsureCloudConnectorsFromConfig_SkipNoAPIKey(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "", Label: "Cloud Deepseek"},
	}

	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	records, _ := store.Load()
	cloud := filterSystemCloud(records)
	if len(cloud) != 0 {
		t.Fatalf("expected 0 connectors for empty API key, got %d", len(cloud))
	}
}

func TestEnsureCloudConnectorsFromConfig_SkipLocal(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "local", Endpoint: "http://localhost:8080", APIKey: "test", Label: "Local"},
		{Provider: "llama", Endpoint: "http://localhost:8081", APIKey: "test", Label: "Llama"},
		{Provider: "media", Endpoint: "http://localhost:8082", APIKey: "test", Label: "Media"},
		{Provider: "speech", Endpoint: "http://localhost:8083", APIKey: "test", Label: "Speech"},
		{Provider: "sidecar", Endpoint: "http://localhost:8084", APIKey: "test", Label: "Sidecar"},
	}

	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	records, _ := store.Load()
	cloud := filterSystemCloud(records)
	if len(cloud) != 0 {
		t.Fatalf("expected 0 connectors for local runtime providers, got %d", len(cloud))
	}
}

func TestEnsureCloudConnectorsFromConfig_RejectsUnknownProvider(t *testing.T) {
	store := tempConnectorStore(t)

	err := EnsureCloudConnectorsFromConfig(store, []CloudConnectorDef{
		{Provider: "unreviewed-provider", Endpoint: "https://provider.example/v1", APIKey: "sk-test", Label: "Unreviewed"},
	})
	if err == nil {
		t.Fatalf("expected unknown provider to be rejected")
	}

	records, loadErr := store.Load()
	if loadErr != nil {
		t.Fatalf("load: %v", loadErr)
	}
	if cloud := filterSystemCloud(records); len(cloud) != 0 {
		t.Fatalf("expected no system cloud connector for unknown provider, got %d", len(cloud))
	}
}

func TestEnsureCloudConnectorsFromConfig_UpdateEndpoint(t *testing.T) {
	store := tempConnectorStore(t)

	// Create with original endpoint
	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-test", Label: "Cloud Deepseek"},
	}
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Update with new endpoint
	defs[0].Endpoint = "https://new-endpoint.deepseek.com/v1"
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("update: %v", err)
	}

	rec, found, err := store.Get(SystemCloudConnectorID("deepseek"))
	if err != nil || !found {
		t.Fatalf("get: err=%v found=%v", err, found)
	}
	if rec.Endpoint != "https://new-endpoint.deepseek.com/v1" {
		t.Errorf("expected updated endpoint, got %q", rec.Endpoint)
	}
}

func TestEnsureCloudConnectorsFromConfig_UpdateCredential(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-old", Label: "Cloud Deepseek"},
	}
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Verify old credential
	key1, _ := store.LoadCredential(SystemCloudConnectorID("deepseek"))
	if key1 != "sk-old" {
		t.Fatalf("expected sk-old, got %q", key1)
	}

	// Update with new credential
	defs[0].APIKey = "sk-new"
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("update: %v", err)
	}

	key2, _ := store.LoadCredential(SystemCloudConnectorID("deepseek"))
	if key2 != "sk-new" {
		t.Errorf("expected sk-new, got %q", key2)
	}
}

func TestSystemCloudConnectorID(t *testing.T) {
	tests := []struct {
		provider string
		expected string
	}{
		{"deepseek", "sys-cloud-deepseek"},
		{"Gemini", "sys-cloud-gemini"},
		{" dashscope ", "sys-cloud-dashscope"},
	}
	for _, tc := range tests {
		got := SystemCloudConnectorID(tc.provider)
		if got != tc.expected {
			t.Errorf("SystemCloudConnectorID(%q) = %q, want %q", tc.provider, got, tc.expected)
		}
	}
}

func TestEnsureCloudConnectorsFromConfig_CredentialStored(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-test", Label: "Cloud Deepseek"},
	}
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Verify credential is stored through the secure store abstraction.
	connectorID := SystemCloudConnectorID("deepseek")
	apiKey, err := store.LoadCredential(connectorID)
	if err != nil {
		t.Fatalf("LoadCredential: %v", err)
	}
	if apiKey != "sk-test" {
		t.Fatalf("expected stored credential, got %q", apiKey)
	}
}

func TestEnsureCloudConnectorsFromConfig_EnvBackedCredentialDoesNotUseSecureStore(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY", "dashscope-env-key")
	store := newConnectorStore(t.TempDir(), failingSecretStore{err: errors.New("secure store unavailable")})

	defs := []CloudConnectorDef{
		{
			Provider:  "dashscope",
			Endpoint:  "https://dashscope.aliyuncs.com/compatible-mode/v1",
			APIKey:    "dashscope-env-key",
			APIKeyEnv: "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
			Label:     "Cloud DashScope",
		},
	}
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("create env-backed connector: %v", err)
	}

	connectorID := SystemCloudConnectorID("dashscope")
	rec, found, err := store.Get(connectorID)
	if err != nil || !found {
		t.Fatalf("get env-backed connector: found=%v err=%v", found, err)
	}
	if rec.CredentialEnv != "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY" {
		t.Fatalf("credential env mismatch: got=%q", rec.CredentialEnv)
	}
	if !rec.HasCredential {
		t.Fatal("env-backed connector should report credential present while env is set")
	}
	key, err := store.LoadCredential(connectorID)
	if err != nil {
		t.Fatalf("LoadCredential should resolve from env without secure store: %v", err)
	}
	if key != "dashscope-env-key" {
		t.Fatalf("env credential mismatch: got=%q", key)
	}

	t.Setenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY", "dashscope-env-key-rotated")
	defs[0].APIKey = "dashscope-env-key-rotated"
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("rotate env-backed connector: %v", err)
	}
	key, err = store.LoadCredential(connectorID)
	if err != nil {
		t.Fatalf("LoadCredential after env rotation: %v", err)
	}
	if key != "dashscope-env-key-rotated" {
		t.Fatalf("rotated env credential mismatch: got=%q", key)
	}
}

func TestReconcileStartup_EnvBackedCredentialDoesNotUseSecureStore(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY", "dashscope-env-key")
	store := newConnectorStore(t.TempDir(), failingSecretStore{err: errors.New("secure store unavailable")})
	connectorID := SystemCloudConnectorID("dashscope")
	if _, err := store.Create(ConnectorRecord{
		ConnectorID:   connectorID,
		Kind:          runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:     runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM,
		OwnerID:       "system",
		Provider:      "dashscope",
		Endpoint:      "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Label:         "Cloud DashScope",
		Status:        runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		AuthKind:      runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY,
		CredentialEnv: "NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY",
	}, ""); err != nil {
		t.Fatalf("create env-backed connector: %v", err)
	}

	if err := store.ReconcileStartup(); err != nil {
		t.Fatalf("reconcile with env credential: %v", err)
	}
	rec, found, err := store.Get(connectorID)
	if err != nil || !found {
		t.Fatalf("get reconciled env-backed connector: found=%v err=%v", found, err)
	}
	if !rec.HasCredential {
		t.Fatal("reconcile should keep env-backed credential present while env is set")
	}

	t.Setenv("NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY", "")
	if err := store.ReconcileStartup(); err != nil {
		t.Fatalf("reconcile with missing env credential: %v", err)
	}
	rec, found, err = store.Get(connectorID)
	if err != nil || !found {
		t.Fatalf("get reconciled missing-env connector: found=%v err=%v", found, err)
	}
	if rec.HasCredential {
		t.Fatal("reconcile should mark env-backed credential missing when env is empty")
	}
}

func filterSystemCloud(records []ConnectorRecord) []ConnectorRecord {
	var result []ConnectorRecord
	for _, r := range records {
		if r.OwnerType == runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_SYSTEM &&
			r.Kind == runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED {
			result = append(result, r)
		}
	}
	return result
}
