package entrypoint

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunDaemonFromArgsFailsOnInvalidModelRegistry(t *testing.T) {
	homeDir := t.TempDir()
	setEntrypointTestHome(t, homeDir)
	clearRuntimeConfigEnvForStartupTest(t)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(homeDir, "runtime.lock"))

	registryPath := filepath.Join(homeDir, "model-registry.json")
	if err := os.WriteFile(registryPath, []byte("{invalid-json"), 0o600); err != nil {
		t.Fatalf("write invalid registry: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH", registryPath)

	err := RunDaemonFromArgs("nimi serve", nil)
	if err == nil {
		t.Fatal("expected startup failure for invalid model registry")
	}
	if !strings.Contains(err.Error(), "load model registry") {
		t.Fatalf("unexpected startup error: %v", err)
	}
}

func TestRunDaemonFromArgsFailsOnInvalidLocalState(t *testing.T) {
	homeDir := t.TempDir()
	setEntrypointTestHome(t, homeDir)
	clearRuntimeConfigEnvForStartupTest(t)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(homeDir, "runtime.lock"))
	t.Setenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH", "")

	localStatePath := filepath.Join(homeDir, "local-state.json")
	if err := os.WriteFile(localStatePath, []byte("{invalid-json"), 0o600); err != nil {
		t.Fatalf("write invalid local state: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_LOCAL_STATE_PATH", localStatePath)

	err := RunDaemonFromArgs("nimi serve", nil)
	if err == nil {
		t.Fatal("expected startup failure for invalid local state")
	}
	if !strings.Contains(err.Error(), "init local service") {
		t.Fatalf("unexpected startup error: %v", err)
	}
}
