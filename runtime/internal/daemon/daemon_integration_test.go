package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	agentcoreservice "github.com/nimiplatform/nimi/runtime/internal/services/agentcore"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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
	for time.Now().Before(deadline) {
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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

func TestDaemonBindCanonicalMemoryStandardIsIdempotent(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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

	first, err := daemon.bindCanonicalMemoryStandard(context.Background(), "agent-standard")
	if err != nil {
		t.Fatalf("first bind: %v", err)
	}
	if first.AlreadyBound {
		t.Fatal("expected first bind to report alreadyBound=false")
	}
	if first.Bank == nil || first.Bank.GetEmbeddingProfile() == nil {
		t.Fatal("expected first bind to return a bound bank")
	}

	second, err := daemon.bindCanonicalMemoryStandard(context.Background(), "agent-standard")
	if err != nil {
		t.Fatalf("second bind: %v", err)
	}
	if !second.AlreadyBound {
		t.Fatal("expected second bind to report alreadyBound=true")
	}
	if second.Bank == nil || second.Bank.GetEmbeddingProfile() == nil {
		t.Fatal("expected second bind to keep the bank bound")
	}
}

func TestDaemonRunWaitsForBackgroundWorkersToStop(t *testing.T) {
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
		Providers: map[string]config.RuntimeFileTarget{
			"openrouter": {BaseURL: "https://example.invalid", APIKey: "openrouter-key"},
		},
	}
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
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

func TestDaemonRunStartsAgentCoreLifeTrackLoop(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := writePersistedAgentCoreState(localStatePath, "agent-daemon-loop", time.Now().UTC().Add(-time.Second)); err != nil {
		t.Fatalf("writePersistedAgentCoreState: %v", err)
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	daemon.grpc.AgentCoreService().SetLifeTrackExecutor(agentcoreservice.NewAIBackedLifeTrackExecutor(&daemonLifeTurnAI{
		response: &runtimev1.ExecuteScenarioResponse{
			Output: &runtimev1.ScenarioOutput{
				Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{
						Text: `{"summary":"daemon life turn complete","tokens_used":2,"canonical_memory_candidates":[],"next_hook_intent":null}`,
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
	waitForDaemonHookStatus(t, daemon, "agent-daemon-loop", runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_COMPLETED, 2*time.Second)

	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}
}

func TestDaemonRunDoesNotStartMemoryReplicationLoopByDefault(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	memoryID := "mem-daemon-replication"
	if err := writePersistedMemoryState(localStatePath, "agent-daemon-replication", memoryID); err != nil {
		t.Fatalf("writePersistedMemoryState: %v", err)
	}
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       localStatePath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
		AIHTTPTimeoutSeconds: 1,
	}

	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()
	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)
	time.Sleep(1200 * time.Millisecond)
	assertMemoryReplicationAttemptCount(t, daemon.grpc.MemoryService(), memoryID, 0)
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}

	daemon2, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon restart: %v", err)
	}
	if svc := daemon2.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	done2 := make(chan error, 1)
	go func() {
		done2 <- daemon2.Run(ctx2)
	}()
	waitForDaemonStatus(t, daemon2, health.StatusReady, 2*time.Second)
	time.Sleep(1200 * time.Millisecond)
	assertMemoryReplicationAttemptCount(t, daemon2.grpc.MemoryService(), memoryID, 0)
	cancel2()
	if err := <-done2; err != nil {
		t.Fatalf("daemon restart returned error: %v", err)
	}
}

func TestDaemonNewImportsLegacyStateBeforeReadiness(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := writePersistedMemoryState(localStatePath, "agent-import", "mem-import"); err != nil {
		t.Fatalf("writePersistedMemoryState: %v", err)
	}
	if err := writePersistedAgentCoreState(localStatePath, "agent-import", time.Now().UTC().Add(time.Minute)); err != nil {
		t.Fatalf("writePersistedAgentCoreState: %v", err)
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
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	defer func() {
		if svc := daemon.grpc.MemoryService(); svc != nil {
			_ = svc.Close()
		}
	}()

	runtimeDir := filepath.Dir(localStatePath)
	if _, err := os.Stat(filepath.Join(runtimeDir, "memory.db")); err != nil {
		t.Fatalf("expected memory.db before Run readiness: %v", err)
	}
	if _, err := os.Stat(filepath.Join(runtimeDir, "memory-state.json.wave3-imported.json.bak")); err != nil {
		t.Fatalf("expected memory legacy rename before Run: %v", err)
	}
	if _, err := os.Stat(filepath.Join(runtimeDir, "agent-core-state.json.wave3-imported.json.bak")); err != nil {
		t.Fatalf("expected agentcore legacy rename before Run: %v", err)
	}
}

func TestDaemonRunCreatesSQLiteBackupOnShutdown(t *testing.T) {
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- daemon.Run(ctx)
	}()
	waitForDaemonStatus(t, daemon, health.StatusReady, 2*time.Second)
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("daemon run returned error: %v", err)
	}

	entries, err := os.ReadDir(filepath.Join(filepath.Dir(cfg.LocalStatePath), "backups"))
	if err != nil {
		t.Fatalf("os.ReadDir(backups): %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least one sqlite backup snapshot after shutdown")
	}
}

func TestDaemonNewFailsClosedOnCorruptedSQLiteWithoutBackup(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "memory.db"), []byte("corrupt"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(memory.db): %v", err)
	}
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(dir, "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	if _, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test"); err == nil {
		t.Fatal("expected daemon init to fail closed on corrupted sqlite without backup")
	}
}

func TestDaemonNewRestoresHealthySQLiteBackup(t *testing.T) {
	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       localStatePath,
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	daemon, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	if svc := daemon.grpc.LocalService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	locator := &runtimev1.PublicMemoryBankLocator{
		Locator: &runtimev1.PublicMemoryBankLocator_AppPrivate{
			AppPrivate: &runtimev1.AppPrivateBankOwner{AccountId: "acct-1", AppId: "app.test"},
		},
	}
	createResp, err := daemon.grpc.MemoryService().CreateBank(context.Background(), &runtimev1.CreateBankRequest{
		Locator: locator,
	})
	if err != nil {
		t.Fatalf("CreateBank: %v", err)
	}
	if _, err := daemon.grpc.MemoryService().Retain(context.Background(), &runtimev1.RetainRequest{
		Bank: createResp.GetBank().GetLocator(),
		Records: []*runtimev1.MemoryRecordInput{
			{
				Kind: runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
				Payload: &runtimev1.MemoryRecordInput_Observational{
					Observational: &runtimev1.ObservationalMemoryRecord{Observation: "restorable daemon memory"},
				},
			},
		},
	}); err != nil {
		t.Fatalf("Retain: %v", err)
	}
	if _, err := daemon.grpc.MemoryService().PersistenceBackend().BackupNow(context.Background()); err != nil {
		t.Fatalf("BackupNow: %v", err)
	}
	if err := daemon.grpc.MemoryService().Close(); err != nil {
		t.Fatalf("Close(memory service): %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "memory.db"), []byte("corrupted-primary"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(corrupted primary): %v", err)
	}

	restored, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon(restored): %v", err)
	}
	defer func() {
		if svc := restored.grpc.MemoryService(); svc != nil {
			_ = svc.Close()
		}
	}()
	historyResp, err := restored.grpc.MemoryService().History(context.Background(), &runtimev1.HistoryRequest{
		Bank:  createResp.GetBank().GetLocator(),
		Query: &runtimev1.MemoryHistoryQuery{PageSize: 10, IncludeInvalidated: true},
	})
	if err != nil {
		t.Fatalf("History(restored): %v", err)
	}
	if len(historyResp.GetRecords()) != 1 {
		t.Fatalf("expected restored memory record, got %#v", historyResp.GetRecords())
	}
}

func writePersistedAgentCoreState(localStatePath string, agentID string, scheduledFor time.Time) error {
	now := time.Now().UTC()
	agentRaw, err := protojson.Marshal(&runtimev1.AgentRecord{
		AgentId:         agentID,
		DisplayName:     agentID,
		LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy: &runtimev1.AgentAutonomyState{
			Enabled: true,
			Config: &runtimev1.AgentAutonomyConfig{
				Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW,
				DailyTokenBudget: 10,
			},
			WindowStartedAt: timestamppb.New(now),
		},
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	})
	if err != nil {
		return err
	}
	stateRaw, err := protojson.Marshal(&runtimev1.AgentStateProjection{
		ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_LIFE_PENDING,
		UpdatedAt:      timestamppb.New(now),
	})
	if err != nil {
		return err
	}
	hookRaw, err := protojson.Marshal(&runtimev1.PendingHook{
		HookId: "hook-daemon-loop",
		Status: runtimev1.AgentHookStatus_AGENT_HOOK_STATUS_PENDING,
		Trigger: &runtimev1.HookTriggerDetail{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.HookTriggerDetail_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeTriggerDetail{
					ScheduledFor: timestamppb.New(scheduledFor),
				},
			},
		},
		NextIntent: &runtimev1.NextHookIntent{
			TriggerKind: runtimev1.HookTriggerKind_HOOK_TRIGGER_KIND_SCHEDULED_TIME,
			Detail: &runtimev1.NextHookIntent_ScheduledTime{
				ScheduledTime: &runtimev1.ScheduledTimeHookIntent{
					ScheduledFor: timestamppb.New(scheduledFor),
				},
			},
		},
		ScheduledFor: timestamppb.New(scheduledFor),
		AdmittedAt:   timestamppb.New(now),
	})
	if err != nil {
		return err
	}

	payload := map[string]any{
		"schemaVersion": 1,
		"savedAt":       now.Format(time.RFC3339),
		"sequence":      0,
		"agents": []map[string]any{
			{
				"agent": json.RawMessage(agentRaw),
				"state": json.RawMessage(stateRaw),
				"hooks": []json.RawMessage{hookRaw},
			},
		},
		"events": []json.RawMessage{},
	}
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	statePath := filepath.Join(filepath.Dir(localStatePath), "agent-core-state.json")
	return os.WriteFile(statePath, append(content, '\n'), 0o600)
}

type daemonLifeTurnAI struct {
	response *runtimev1.ExecuteScenarioResponse
	err      error
}

func (f *daemonLifeTurnAI) ExecuteScenario(_ context.Context, _ *runtimev1.ExecuteScenarioRequest) (*runtimev1.ExecuteScenarioResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.response == nil {
		return &runtimev1.ExecuteScenarioResponse{}, nil
	}
	return proto.Clone(f.response).(*runtimev1.ExecuteScenarioResponse), nil
}

func waitForDaemonStatus(t *testing.T, daemon *Daemon, expected health.Status, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if daemon.state.Snapshot().Status == expected {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected daemon status %s, got %s", expected, daemon.state.Snapshot().Status)
}

func waitForDaemonHookStatus(t *testing.T, daemon *Daemon, agentID string, expected runtimev1.AgentHookStatus, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := daemon.grpc.AgentCoreService().ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
			AgentId:      agentID,
			StatusFilter: expected,
		})
		if err == nil && len(resp.GetHooks()) == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected hook status %s for agent %s", expected, agentID)
}

func waitForMemoryReplicationAttempt(t *testing.T, svc interface {
	ListReplicationBacklog() []*memoryservice.ReplicationBacklogItem
}, memoryID string, attempts int32, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, item := range svc.ListReplicationBacklog() {
			if item.MemoryID == memoryID && item.AttemptCount >= attempts {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected memory %s to reach %d replication attempts", memoryID, attempts)
}

func assertMemoryReplicationAttemptCount(t *testing.T, svc interface {
	ListReplicationBacklog() []*memoryservice.ReplicationBacklogItem
}, memoryID string, attempts int32) {
	t.Helper()
	for _, item := range svc.ListReplicationBacklog() {
		if item.MemoryID == memoryID {
			if item.AttemptCount != attempts {
				t.Fatalf("expected memory %s to have %d replication attempts, got %#v", memoryID, attempts, item)
			}
			return
		}
	}
	t.Fatalf("expected replication backlog item for memory %s", memoryID)
}

func writePersistedMemoryState(localStatePath string, agentID string, memoryID string) error {
	now := time.Now().UTC()
	locator := &runtimev1.MemoryBankLocator{
		Scope: runtimev1.MemoryBankScope_MEMORY_BANK_SCOPE_AGENT_CORE,
		Owner: &runtimev1.MemoryBankLocator_AgentCore{
			AgentCore: &runtimev1.AgentCoreBankOwner{AgentId: agentID},
		},
	}
	bankRaw, err := protojson.Marshal(&runtimev1.MemoryBank{
		BankId:              "bank-daemon-replication",
		Locator:             locator,
		DisplayName:         "Agent Memory",
		CanonicalAgentScope: true,
		PublicApiWritable:   false,
		CreatedAt:           timestamppb.New(now),
		UpdatedAt:           timestamppb.New(now),
	})
	if err != nil {
		return err
	}
	recordRaw, err := protojson.Marshal(&runtimev1.MemoryRecord{
		MemoryId:       memoryID,
		Bank:           locator,
		Kind:           runtimev1.MemoryRecordKind_MEMORY_RECORD_KIND_OBSERVATIONAL,
		CanonicalClass: runtimev1.MemoryCanonicalClass_MEMORY_CANONICAL_CLASS_PUBLIC_SHARED,
		Replication: &runtimev1.MemoryReplicationState{
			Outcome:      runtimev1.MemoryReplicationOutcome_MEMORY_REPLICATION_OUTCOME_PENDING,
			LocalVersion: memoryID,
			BasisVersion: "",
			Detail: &runtimev1.MemoryReplicationState_Pending{
				Pending: &runtimev1.MemoryReplicationPending{
					BasisVersion: "",
					EnqueuedAt:   timestamppb.New(now),
				},
			},
		},
		Payload:   &runtimev1.MemoryRecord_Observational{Observational: &runtimev1.ObservationalMemoryRecord{Observation: "daemon backlog"}},
		CreatedAt: timestamppb.New(now),
		UpdatedAt: timestamppb.New(now),
	})
	if err != nil {
		return err
	}
	locatorRaw, err := protojson.Marshal(locator)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"schemaVersion": 1,
		"savedAt":       now.Format(time.RFC3339Nano),
		"sequence":      0,
		"banks": []map[string]any{
			{
				"locatorKey": "agent-core::" + agentID,
				"bank":       json.RawMessage(bankRaw),
				"records":    []json.RawMessage{recordRaw},
			},
		},
		"replicationBacklog": []map[string]any{
			{
				"backlogKey":   "agent-core::" + agentID + "::" + memoryID,
				"locator":      json.RawMessage(locatorRaw),
				"memoryId":     memoryID,
				"localVersion": memoryID,
				"basisVersion": "",
				"enqueuedAt":   now.Format(time.RFC3339Nano),
				"attemptCount": 0,
				"status":       "pending",
			},
		},
	}
	content, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	statePath := filepath.Join(filepath.Dir(localStatePath), "memory-state.json")
	return os.WriteFile(statePath, append(content, '\n'), 0o600)
}
