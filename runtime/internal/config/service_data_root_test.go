package config

import (
	"path/filepath"
	"testing"
)

func TestWriteAndApplyServiceOwnedDataRootRequiresRestartOnlyOnChange(t *testing.T) {
	runtimeRoot := t.TempDir()
	path := filepath.Join(runtimeRoot, ServiceOwnedConfigFilename)
	dataRoot := filepath.Join(t.TempDir(), "nimi_data")

	changed, err := WriteServiceOwnedDataRoot(path, dataRoot)
	if err != nil || !changed {
		t.Fatalf("first mutation changed=%v err=%v", changed, err)
	}
	changed, err = WriteServiceOwnedDataRoot(path, dataRoot)
	if err != nil || changed {
		t.Fatalf("idempotent mutation changed=%v err=%v", changed, err)
	}

	cfg := Config{DataRootRef: filepath.Join(runtimeRoot, "stale")}
	if err := ApplyServiceOwnedDataRoot(&cfg, path); err != nil {
		t.Fatalf("apply service-owned config: %v", err)
	}
	if cfg.DataRootRef != dataRoot || cfg.LocalModelsPath != filepath.Join(dataRoot, "models") ||
		cfg.ManagedRoots.Dependencies != filepath.Join(dataRoot, "dependencies") ||
		cfg.ManagedRoots.Environments != filepath.Join(dataRoot, "environments") ||
		cfg.ManagedRoots.Logs != filepath.Join(dataRoot, "logs") ||
		cfg.ManagedRoots.Audit != filepath.Join(dataRoot, "audit") {
		t.Fatalf("unexpected resolved data-plane config: %+v", cfg)
	}
}

func TestApplyServiceOwnedDataRootMissingConfigFailsClosed(t *testing.T) {
	cfg := Config{DataRootRef: filepath.Join(t.TempDir(), "stale"), LocalModelsPath: "stale"}
	if err := ApplyServiceOwnedDataRoot(&cfg, filepath.Join(t.TempDir(), ServiceOwnedConfigFilename)); err != nil {
		t.Fatalf("apply missing service-owned config: %v", err)
	}
	if cfg.DataRootRef != "" || cfg.LocalModelsPath != "" || cfg.ManagedRoots != (ManagedRootsConfig{}) {
		t.Fatalf("missing config retained guessed roots: %+v", cfg)
	}
}
