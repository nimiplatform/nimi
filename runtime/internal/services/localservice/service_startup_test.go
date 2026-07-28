package localservice

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
)

func TestNewDoesNotProbeCatalogDeviceProfileDuringStartup(t *testing.T) {
	originalLookPath := localRuntimeLookPath
	originalCommand := localRuntimeCommand
	t.Cleanup(func() {
		localRuntimeLookPath = originalLookPath
		localRuntimeCommand = originalCommand
	})

	localRuntimeLookPath = func(string) (string, error) {
		t.Fatal("device profile probe should not run during Service startup")
		return "", nil
	}
	localRuntimeCommand = nil

	statePath := filepath.Join(t.TempDir(), "local-state.json")
	svc, err := New(nil, auditlog.New(16, 16), statePath, 16)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(svc.Close)
}

func TestLoadLocalStateSnapshotRequiresCurrentSchemaVersion(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	raw, err := json.Marshal(localStateSnapshot{
		SchemaVersion: 0,
		Assets:        []localStateAssetState{},
		Services:      []localStateServiceState{},
	})
	if err != nil {
		t.Fatalf("marshal local state: %v", err)
	}
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		t.Fatalf("write local state: %v", err)
	}

	_, err = loadLocalStateSnapshot(statePath)
	if err == nil {
		t.Fatal("expected state without the current schema version to fail closed")
	}
	if !strings.Contains(err.Error(), "schemaVersion=0 (expected 2)") {
		t.Fatalf("unexpected error: %v", err)
	}
}
