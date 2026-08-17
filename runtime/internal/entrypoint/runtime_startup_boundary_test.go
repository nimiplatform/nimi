package entrypoint

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/daemon"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

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

func TestPortableDaemonFromArgsDelegatesInvalidLocalStateToRecordIsolation(t *testing.T) {
	homeDir := t.TempDir()
	setEntrypointTestHome(t, homeDir)
	clearRuntimeConfigEnvForStartupTest(t)
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(homeDir, "runtime.lock"))
	localStatePath := filepath.Join(homeDir, "local-state.json")
	if err := os.WriteFile(localStatePath, []byte("{invalid-json"), 0o600); err != nil {
		t.Fatalf("write invalid local state: %v", err)
	}
	t.Setenv("NIMI_RUNTIME_LOCAL_STATE_PATH", localStatePath)

	delegated := errors.New("constructor observed isolated local state path")
	err := runNonProductionDaemonFromArgsWithConstructor(
		"nimi serve",
		nil,
		func(cfg config.Config, _ *slog.Logger, _ string) (*daemon.Daemon, error) {
			if cfg.LocalStatePath != localStatePath {
				t.Fatalf("local state path = %q, want %q", cfg.LocalStatePath, localStatePath)
			}
			return nil, delegated
		},
	)
	if !errors.Is(err, delegated) {
		t.Fatalf("startup did not delegate local state isolation to the service constructor: %v", err)
	}
}
