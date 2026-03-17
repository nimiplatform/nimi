package connector

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func tempConnectorStore(t *testing.T) *ConnectorStore {
	t.Helper()
	dir := t.TempDir()
	return NewConnectorStore(dir)
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
		{Provider: "media.diffusers", Endpoint: "http://localhost:8083", APIKey: "test", Label: "Diffusers"},
		{Provider: "sidecar", Endpoint: "http://localhost:8084", APIKey: "test", Label: "Sidecar"},
		{Provider: "nexa", Endpoint: "http://localhost:8085", APIKey: "test", Label: "Nexa"},
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

func TestEnsureCloudConnectorsFromConfig_CredentialFileExists(t *testing.T) {
	store := tempConnectorStore(t)

	defs := []CloudConnectorDef{
		{Provider: "deepseek", Endpoint: "https://api.deepseek.com/v1", APIKey: "sk-test", Label: "Cloud Deepseek"},
	}
	if err := EnsureCloudConnectorsFromConfig(store, defs); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Verify credential file exists
	connectorID := SystemCloudConnectorID("deepseek")
	credPath := filepath.Join(store.credDir, connectorID+".key")
	if _, err := os.Stat(credPath); os.IsNotExist(err) {
		t.Error("credential file should exist")
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
