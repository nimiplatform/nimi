package daemon

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func newTestDaemon(t *testing.T, logger *slog.Logger) *Daemon {
	t.Helper()
	daemon, err := New(config.Config{
		GRPCAddr:            "127.0.0.1:0",
		HTTPAddr:            "127.0.0.1:0",
		LocalStatePath:      filepath.Join(t.TempDir(), "local-state.json"),
		IdempotencyCapacity: 32,
	}, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	return daemon
}

func closeDaemonForTest(t *testing.T, daemon *Daemon) {
	t.Helper()
	t.Cleanup(func() {
		if daemon == nil {
			return
		}
		_ = daemon.shutdown()
	})
}

func setDaemonTestHome(t *testing.T, homeDir string) {
	t.Helper()
	t.Setenv("HOME", homeDir)
	t.Setenv("USERPROFILE", homeDir)
	t.Setenv("NIMI_RUNTIME_CONNECTOR_STORE_PATH", filepath.Join(homeDir, ".nimi-connectors"))
	volume := filepath.VolumeName(homeDir)
	if volume == "" {
		volume = "C:"
	}
	homePath := strings.TrimPrefix(homeDir, volume)
	if homePath == "" {
		homePath = string(os.PathSeparator)
	}
	t.Setenv("HOMEDRIVE", volume)
	t.Setenv("HOMEPATH", homePath)
}

func newHealthyEngineManager(t *testing.T, kind engine.EngineKind, port int) *engine.Manager {
	t.Helper()
	manager, err := engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engine.ManagedRoots{Environments: t.TempDir(), Dependencies: t.TempDir()}, nil)
	if err != nil {
		t.Fatalf("create engine manager: %v", err)
	}
	supervisor := engine.NewSupervisor(engine.EngineConfig{Kind: kind, Port: port}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	supervisor.SetStateForTesting(engine.StatusHealthy, time.Now())
	manager.SetSupervisorForTesting(kind, supervisor)
	return manager
}

func waitForProviderState(t *testing.T, tracker *providerhealth.Tracker, providerName string, expected providerhealth.State) providerhealth.Snapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snapshot := tracker.SnapshotOf(providerName)
		if snapshot.State == expected {
			return snapshot
		}
		time.Sleep(10 * time.Millisecond)
	}
	snapshot := tracker.SnapshotOf(providerName)
	t.Fatalf("provider %s did not reach state %s, got %#v", providerName, expected, snapshot)
	return providerhealth.Snapshot{}
}
