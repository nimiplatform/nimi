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

func TestNewRejectsRetiredMachineConfigurationUntilExplicitRecovery(t *testing.T) {
	stateDir := t.TempDir()
	statePath := filepath.Join(stateDir, "local-state.json")
	legacyPath := filepath.Join(stateDir, "machine-local-ai-configuration.json")
	if err := os.WriteFile(legacyPath, []byte(`{"configurations":[]}`), 0o600); err != nil {
		t.Fatalf("write retired machine configuration: %v", err)
	}

	if _, err := New(nil, auditlog.New(16, 16), statePath, 16); err == nil || !strings.Contains(err.Error(), "explicit local-model-recovery tool") {
		t.Fatalf("retired machine configuration was not rejected: %v", err)
	}

	recovery, err := NewForLocalModelRecovery(nil, auditlog.New(16, 16), statePath, 16, filepath.Join(stateDir, "models"))
	if err != nil {
		t.Fatalf("explicit recovery constructor: %v", err)
	}
	recovery.Close()
}

func TestLoadLocalStateSnapshotQuarantinesUnsupportedSchemaVersion(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	raw, err := json.Marshal(localStateSnapshot{
		SchemaVersion: 0,
	})
	if err != nil {
		t.Fatalf("marshal local state: %v", err)
	}
	if err := os.WriteFile(statePath, raw, 0o600); err != nil {
		t.Fatalf("write local state: %v", err)
	}

	snapshot, diagnostics, _, err := loadLocalStateSnapshotIsolated(statePath)
	if err != nil {
		t.Fatalf("load isolated state: %v", err)
	}
	if len(snapshot.Transfers) != 0 || len(snapshot.Audits) != 0 || len(diagnostics) != 1 {
		t.Fatalf("unsupported document was not isolated: snapshot=%+v diagnostics=%+v", snapshot, diagnostics)
	}
	if diagnostics[0].Level != stateIsolationLevelDocument || !strings.Contains(diagnostics[0].Message, "schemaVersion=0 (expected 2)") {
		t.Fatalf("unexpected diagnostic: %+v", diagnostics[0])
	}
	if _, statErr := os.Stat(diagnostics[0].QuarantinePath); statErr != nil {
		t.Fatalf("quarantined snapshot missing: %v", statErr)
	}
}
