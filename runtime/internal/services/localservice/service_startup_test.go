package localservice

import (
	"path/filepath"
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
