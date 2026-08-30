package daemon

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
)

func TestLlamaExecutionHostConfigUsesRuntimeConfigExactly(t *testing.T) {
	disabled, ok := llamaExecutionHostConfig(config.Config{
		EngineLlamaVersion: "disabled-version",
		EngineLlamaPort:    24567,
	})
	if ok || disabled.Kind != "" || disabled.Version != "" || disabled.Port != 0 {
		t.Fatalf("disabled llama config = %+v/%t, want zero/false", disabled, ok)
	}

	resolved, ok := llamaExecutionHostConfig(config.Config{
		EngineLlamaEnabled: true,
		EngineLlamaVersion: "  llama-version-override  ",
		EngineLlamaPort:    24567,
	})
	if !ok || resolved.Kind != engine.EngineLlama || resolved.Version != "llama-version-override" || resolved.Port != 24567 {
		t.Fatalf("resolved llama config = %+v/%t", resolved, ok)
	}
}

func TestLlamaHostStateNeverInjectsAmbientProviderEndpoint(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "sentinel")

	daemon.onEngineStateChange("llama", "healthy", "ready")

	if value := os.Getenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL"); value != "sentinel" {
		t.Fatalf("private llama Host mutated ambient endpoint: %q", value)
	}
}

func TestLlamaHostStateNeverMutatesDaemonReadiness(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)
	daemon.state.SetStatus(health.StatusDegraded, "unrelated degraded state")

	daemon.onEngineStateChange("llama", "healthy", "probe recovered")

	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusDegraded || snapshot.Reason != "unrelated degraded state" {
		t.Fatalf("private llama Host mutated Runtime readiness: %s (%s)", snapshot.Status, snapshot.Reason)
	}
}

func TestOnEngineStateChangeHealthyDoesNotRecoverDifferentEngineFailure(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, nil))
	daemon := newTestDaemon(t, logger)
	daemon.engineMgr = newHealthyEngineManager(t, engine.EngineLlama, 1234)
	daemon.state.SetStatus(health.StatusDegraded, "engine:media unhealthy (probe failed)")

	daemon.onEngineStateChange("llama", "healthy", "ready")

	logs := logBuf.String()
	if strings.Contains(logs, "msg=\"engine endpoint env injected\"") {
		t.Fatalf("did not expect endpoint reinjection while another engine is degraded, got:\n%s", logs)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded || snapshot.Reason != "engine:media unhealthy (probe failed)" {
		t.Fatalf("expected unrelated degraded state to remain untouched, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
}

func TestOnEngineStateChangeHealthyWaitsForEveryUnhealthyEngine(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	daemon := newTestDaemon(t, logger)
	manager, err := engine.NewManager(logger, engine.ManagedRoots{
		Environments: t.TempDir(),
		Dependencies: t.TempDir(),
	}, nil)
	if err != nil {
		t.Fatalf("create engine manager: %v", err)
	}
	media := engine.NewSupervisor(engine.EngineConfig{Kind: engine.EngineMedia}, logger, nil)
	media.SetStateForTesting(engine.StatusUnhealthy, time.Time{})
	speech := engine.NewSupervisor(engine.EngineConfig{Kind: engine.EngineSpeech}, logger, nil)
	speech.SetStateForTesting(engine.StatusHealthy, time.Now())
	manager.SetSupervisorForTesting(engine.EngineMedia, media)
	manager.SetSupervisorForTesting(engine.EngineSpeech, speech)
	daemon.engineMgr = manager
	daemon.state.SetStatus(health.StatusDegraded, "engine:speech unhealthy (probe failed)")

	daemon.onEngineStateChange("speech", "healthy", "probe recovered")

	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded || !engineUnhealthyReasonMatches(snapshot.Reason, "media") {
		t.Fatalf("remaining unhealthy media engine must keep Runtime degraded, got %s (%s)", snapshot.Status, snapshot.Reason)
	}

	media.SetStateForTesting(engine.StatusHealthy, time.Now())
	daemon.onEngineStateChange("media", "healthy", "probe recovered")

	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusReady || snapshot.Reason != "ready" {
		t.Fatalf("last recovered engine must restore Runtime readiness, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
}

func TestStartSupervisedEnginesManagerInitFailureDegradesAndAudits(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      1234,
		EngineLlamaVersion:   "b8575",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(32, 32)
	daemon.auditStore = store

	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return nil, errors.New("engine manager unavailable")
	}

	daemon.startSupervisedEngines(context.Background())

	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded state when engine manager init fails, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "engine manager init failed") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	events := mustListAuditEvents(t, store, &runtimev1.ListAuditEventsRequest{
		Domain: "runtime.lifecycle",
	})
	startupFailures := make([]*runtimev1.AuditEventRecord, 0, len(events.GetEvents()))
	for _, event := range events.GetEvents() {
		if event.GetOperation() == "startup.failed" {
			startupFailures = append(startupFailures, event)
		}
	}
	if len(startupFailures) != 1 {
		t.Fatalf("expected 1 startup failure audit event, got %d", len(startupFailures))
	}
	if startupFailures[0].GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE {
		t.Fatalf("unexpected startup failure reason code: %v", startupFailures[0].GetReasonCode())
	}
}

// TestStartSupervisedEnginesResolvesEngineRootsFromDataPlaneConfig is the
// daemon-level regression guard for the engine install-root vs K-CFG-018
// data-plane contract alignment. It exercises the real engine.NewManager
// factory (no test stub) so the data-root threading is verified end to end:
//   - engines requested with no data root -> degrades (fail closed, no
//     ~/.nimi/engines fallback);
//   - engines requested with valid managed roots -> manager builds;
//   - no engine work requested with no data root -> daemon is not degraded
//     (Runtime core readiness is independent of materializers, K-LENG-028).
func TestStartSupervisedEnginesResolvesEngineRootsFromDataPlaneConfig(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	baseCfg := func() config.Config {
		return config.Config{
			GRPCAddr:             "127.0.0.1:0",
			HTTPAddr:             "127.0.0.1:0",
			LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
			AuditRingBufferSize:  64,
			UsageStatsBufferSize: 64,
			IdempotencyCapacity:  32,
		}
	}

	t.Run("engines requested without data root degrades", func(t *testing.T) {
		cfg := baseCfg()
		cfg.EngineLlamaEnabled = true
		cfg.EngineLlamaPort = 1234
		cfg.EngineLlamaVersion = "b8575"
		daemon, err := newDaemonForTest(t, cfg, logger, "test")
		if err != nil {
			t.Fatalf("create daemon: %v", err)
		}
		closeDaemonForTest(t, daemon)
		if svc := daemon.grpc.LocalService(); svc != nil {
			t.Cleanup(func() { svc.Close() })
		}
		daemon.startSupervisedEngines(context.Background())
		snapshot := daemon.state.Snapshot()
		if snapshot.Status != health.StatusDegraded {
			t.Fatalf("expected degraded state without data root, got %s (%s)", snapshot.Status, snapshot.Reason)
		}
		if !strings.Contains(snapshot.Reason, "engine manager init failed") {
			t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
		}
	})

	t.Run("engines requested with data root builds manager", func(t *testing.T) {
		dataRoot := t.TempDir()
		cfg := baseCfg()
		cfg.EngineLlamaEnabled = true
		cfg.EngineLlamaPort = 1234
		cfg.EngineLlamaVersion = "b8575"
		cfg.DataRootRef = dataRoot
		cfg.ManagedRoots = config.ManagedRootsConfig{
			Environments: filepath.Join(dataRoot, "environments"),
			Dependencies: filepath.Join(dataRoot, "dependencies"),
		}
		daemon, err := newDaemonForTest(t, cfg, logger, "test")
		if err != nil {
			t.Fatalf("create daemon: %v", err)
		}
		closeDaemonForTest(t, daemon)
		if svc := daemon.grpc.LocalService(); svc != nil {
			t.Cleanup(func() { svc.Close() })
		}
		daemon.startSupervisedEngines(context.Background())
		if daemon.engineMgr == nil {
			t.Fatal("expected engine manager to be built from data-plane roots")
		}
		if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded &&
			strings.Contains(snapshot.Reason, "engine manager init failed") {
			t.Fatalf("engine manager init must not fail closed with a valid data root: %s", snapshot.Reason)
		}
	})

	t.Run("no engine work without data root does not degrade", func(t *testing.T) {
		cfg := baseCfg()
		daemon, err := newDaemonForTest(t, cfg, logger, "test")
		if err != nil {
			t.Fatalf("create daemon: %v", err)
		}
		closeDaemonForTest(t, daemon)
		if svc := daemon.grpc.LocalService(); svc != nil {
			t.Cleanup(func() { svc.Close() })
		}
		daemon.startSupervisedEngines(context.Background())
		if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
			t.Fatalf("daemon must not degrade when no engine work is requested, got %s (%s)", snapshot.Status, snapshot.Reason)
		}
	})
}

func TestStartSupervisedEnginesRegistersSpeechWithoutBootstrapping(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineSpeechEnabled:  true,
		EngineSpeechPort:     8330,
		EngineSpeechVersion:  "0.1.0-qwen3-tts",
	}
	daemon, err := newDaemonForTest(t, cfg, logger, "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return engine.NewManager(slog.New(slog.NewTextHandler(io.Discard, nil)), engine.ManagedRoots{Environments: t.TempDir(), Dependencies: t.TempDir()}, nil)
	}

	daemon.startSupervisedEngines(context.Background())

	if daemon.engineMgr == nil {
		t.Fatal("expected engine manager to initialize for managed speech requests")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status == health.StatusDegraded {
		t.Fatalf("speech cold registration must not degrade Runtime core readiness: %s", snapshot.Reason)
	}
}
