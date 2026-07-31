package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
)

func TestDaemonRunTransitionsStartupAndShutdownStates(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	updates, cancelUpdates := daemon.state.Subscribe(16)
	defer cancelUpdates()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()
	readyCtx, cancelReady := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelReady()
	if err := daemon.WaitReady(readyCtx); err != nil {
		t.Fatalf("wait for daemon ready: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	seenStarting := false
	for time.Now().Before(deadline) {
		snapshot := <-updates
		if snapshot.Status == health.StatusStarting {
			seenStarting = true
		}
		if snapshot.Status == health.StatusReady {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !seenStarting {
		t.Fatalf("expected daemon to enter STARTING")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusReady {
		t.Fatalf("expected daemon to reach READY, got %s (%s)", snapshot.Status, snapshot.Reason)
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
	seenStopping := false
	seenStopped := false
	shutdownDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(shutdownDeadline) {
		select {
		case snapshot := <-updates:
			if snapshot.Status == health.StatusStopping {
				seenStopping = true
			}
			if snapshot.Status == health.StatusStopped {
				seenStopped = true
				break
			}
		case <-time.After(20 * time.Millisecond):
		}
		if seenStopped {
			break
		}
	}
	if !seenStopping {
		t.Fatalf("expected daemon to enter STOPPING")
	}
	if !seenStopped {
		t.Fatalf("expected daemon to enter STOPPED")
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusStopped {
		t.Fatalf("expected daemon to end in STOPPED, got %s (%s)", snapshot.Status, snapshot.Reason)
	}
}

func TestDaemonRunTransitionsReadyBeforeStartupDegraded(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      18321,
		EngineLlamaVersion:   "test",
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return nil, errors.New("engine manager unavailable")
	}

	updates, cancelUpdates := daemon.state.Subscribe(32)
	defer cancelUpdates()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	seenReady := false
	seenDegraded := false
	for time.Now().Before(deadline) {
		select {
		case snapshot := <-updates:
			if snapshot.Status == health.StatusReady {
				seenReady = true
			}
			if snapshot.Status == health.StatusDegraded {
				if !seenReady {
					t.Fatal("daemon degraded before reaching ready")
				}
				seenDegraded = true
				cancel()
			}
		case <-time.After(20 * time.Millisecond):
		}
		if seenDegraded {
			break
		}
	}
	if !seenReady {
		t.Fatal("expected daemon to reach READY before DEGRADED")
	}
	if !seenDegraded {
		t.Fatal("expected daemon to enter DEGRADED after READY")
	}
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonRunReadyDefersEmptyManagedLlamaBootstrap(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		EngineLlamaEnabled:   true,
		EngineLlamaPort:      18321,
		EngineLlamaVersion:   "test",
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ engine.ManagedRoots, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	started := make(chan struct{}, 1)
	daemon.startEngineFn = func(ctx context.Context, _ engine.EngineKind, _ string, _ int, _ string) error {
		select {
		case started <- struct{}{}:
		default:
		}
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)
	select {
	case <-started:
		cancel()
		t.Fatal("empty managed llama state must not start supervised bootstrap without a generated preset")
	default:
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonRunRefreshesManagedEmbeddingProfileOnStartup(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.listEmbeddingAssetsFn = func(context.Context) ([]*runtimev1.LocalAssetRecord, error) {
		return []*runtimev1.LocalAssetRecord{
			{
				LocalAssetId: "local-embed-1",
				AssetId:      "local/embed-alpha",
				Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				UpdatedAt:    "2026-04-13T12:00:00Z",
			},
		}, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if daemon.state.Snapshot().Status == health.StatusReady {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if snapshot := daemon.state.Snapshot(); snapshot.Status != health.StatusReady {
		t.Fatalf("expected daemon to reach READY, got %s (%s)", snapshot.Status, snapshot.Reason)
	}

	profile := daemon.grpc.MemoryService().ManagedEmbeddingProfile()
	if profile == nil {
		t.Fatal("expected managed embedding profile to be refreshed on startup")
	}
	if got := profile.GetModelId(); got != "local/embed-alpha" {
		t.Fatalf("model id mismatch: got=%q want=%q", got, "local/embed-alpha")
	}
	if got := profile.GetVersion(); got != "local/embed-alpha@2026-04-13T12:00:00Z" {
		t.Fatalf("version mismatch: got=%q", got)
	}

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonRunWaitsForBackgroundWorkersToStop(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL", "http://127.0.0.1:1234/v1")
	cfg := config.Config{
		GRPCAddr:                "127.0.0.1:0",
		HTTPAddr:                "127.0.0.1:0",
		ShutdownTimeout:         2 * time.Second,
		LocalStatePath:          filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:     64,
		UsageStatsBufferSize:    64,
		IdempotencyCapacity:     32,
		AIHealthIntervalSeconds: 1,
		AIHTTPTimeoutSeconds:    1,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	probeStarted := make(chan struct{})
	probeStopped := make(chan struct{})
	daemon.probeAIProviderFn = func(ctx context.Context, _ *http.Client, _ aiProviderTarget) error {
		select {
		case <-probeStarted:
		default:
			close(probeStarted)
		}
		<-ctx.Done()
		close(probeStopped)
		return ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	select {
	case <-probeStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("expected AI provider probe to start")
	}

	cancel()

	select {
	case <-probeStopped:
	case <-time.After(2 * time.Second):
		t.Fatal("expected AI provider probe to stop after shutdown")
	}

	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonStopSupervisedEnginesRunsOnlyOnce(t *testing.T) {
	daemon := &Daemon{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	stops := 0
	daemon.stopSupervisedFn = func() {
		stops++
	}

	daemon.stopSupervisedEngines("first stop")
	daemon.EmergencyStopSupervisedEngines()
	daemon.stopSupervisedEngines("third stop")

	if stops != 1 {
		t.Fatalf("expected supervised engines to stop once, got %d", stops)
	}
}

func TestDaemonRunStartsRuntimeAgentLifeTrackLoop(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := writeRuntimeLocalAgentState(localStatePath, "agent-daemon-loop", time.Now().UTC().Add(-time.Second)); err != nil {
		t.Fatalf("writeRuntimeLocalAgentState: %v", err)
	}

	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       localStatePath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.grpc.AgentService().SetLifeTrackExecutor(runtimeagentservice.NewAIBackedLifeTrackExecutor(&daemonLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `<life-turn><summary>daemon life turn complete</summary><tokens-used>2</tokens-used><canonical-memory-candidates></canonical-memory-candidates></life-turn>`,
					},
				},
			},
		},
	}))

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()

	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)
	waitForDaemonHookStatus(t, daemon, "agent-daemon-loop", runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_COMPLETED, 2*time.Second)

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}
