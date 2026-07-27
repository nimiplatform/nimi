package entrypoint

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func runNonProductionDaemonForStartupTest(t *testing.T, program string, args []string) error {
	t.Helper()
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	return runNonProductionDaemonFromArgsWithConstructor(
		program,
		args,
		func(cfg config.Config, logger *slog.Logger, version string) (*daemon.Daemon, error) {
			return daemon.NewNonProductionAtProductControlRoot(cfg, logger, version, productControlRoot)
		},
	)
}

func TestRunProductionDaemonFromArgsRejectsUserSuppliedRuntimeControls(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:59999")
	err := RunProductionDaemonFromArgs("nimi serve", []string{
		"--grpc-addr=127.0.0.1:59998",
		"--local-state-path=C:\\user-writable-state.json",
	})
	if err == nil {
		t.Fatal("production daemon entrypoint accepted user-controlled startup inputs")
	}
	if !strings.Contains(err.Error(), string(protectedlocal.ReasonProtectedLocalRuntimePrincipalRequired)) {
		t.Fatalf("production startup error = %v, want protected Runtime principal failure", err)
	}
}

func TestPortableDaemonFromArgsFailsOnInvalidModelRegistry(t *testing.T) {
	homeDir := t.TempDir()
	setEntrypointTestHome(t, homeDir)
	clearRuntimeConfigEnvForStartupTest(t)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(homeDir, "runtime.lock"))

	registryPath := filepath.Join(homeDir, "model-registry.json")
	if err := os.WriteFile(registryPath, []byte("{invalid-json"), 0o600); err != nil {
		t.Fatalf("write invalid registry: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_MODEL_REGISTRY_PATH", registryPath)

	err := runNonProductionDaemonForStartupTest(t, "nimi serve", nil)
	if err == nil {
		t.Fatal("expected startup failure for invalid model registry")
	}
	if !strings.Contains(err.Error(), "load model registry") {
		t.Fatalf("unexpected startup error: %v", err)
	}
}

func TestPortableDaemonFromArgsFailsOnInvalidLocalState(t *testing.T) {
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

	err := runNonProductionDaemonForStartupTest(t, "nimi serve", nil)
	if err == nil {
		t.Fatal("expected startup failure for invalid local state")
	}
	if !strings.Contains(err.Error(), "init local service") {
		t.Fatalf("unexpected startup error: %v", err)
	}
}
