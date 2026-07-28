package daemon

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

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
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
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
	if _, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test"); err == nil {
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
	daemon, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon: %v", err)
	}
	closeDaemonForTest(t, daemon)
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

	restored, err := newDaemonForTest(t, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("create daemon(restored): %v", err)
	}
	closeDaemonForTest(t, restored)
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

func writeRuntimeLocalAgentState(localStatePath string, runtimeSourceRef string, scheduledFor time.Time) error {
	ownerUserID := "user-1"
	localAgentRef := "local-agent:" + ownerUserID + ":" + runtimeSourceRef
	now := time.Now().UTC()
	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		return err
	}
	defer func() { _ = backend.Close() }()
	agentRaw, err := protojson.Marshal(&runtimev1.LocalAgentRecord{
		LocalAgentRef:    localAgentRef,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: runtimeSourceRef,
		DisplayName:      runtimeSourceRef,
		LifecycleStatus:  runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		Autonomy: &runtimev1.AgentAutonomyState{
			Enabled: true,
			Config: &runtimev1.AgentAutonomyConfig{
				Mode:             runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM,
				DailyTokenBudget: 100,
				MaxTokensPerHook: 20,
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
	delay := scheduledFor.Sub(now)
	if delay < 0 {
		delay = 0
	}
	hookRaw, err := protojson.Marshal(&runtimev1.PendingHook{
		Intent: &runtimev1.HookIntent{
			IntentId:      "hook-daemon-loop",
			AgentId:       localAgentRef,
			TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
			TriggerDetail: &runtimev1.HookTriggerDetail{
				Detail: &runtimev1.HookTriggerDetail_Time{
					Time: &runtimev1.HookTriggerTimeDetail{Delay: durationpb.New(delay)},
				},
			},
			Effect:         runtimev1.HookEffect_HOOK_EFFECT_FOLLOW_UP_TURN,
			AdmissionState: runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING,
			NotBefore:      timestamppb.New(scheduledFor),
		},
		ScheduledFor: timestamppb.New(scheduledFor),
		AdmittedAt:   timestamppb.New(now),
	})
	if err != nil {
		return err
	}
	return backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`, localAgentRef, string(agentRaw)); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES (?, ?)`, localAgentRef, string(stateRaw)); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_hook(local_agent_ref, hook_id, status, scheduled_for, hook_json) VALUES (?, ?, ?, ?, ?)`, localAgentRef, "hook-daemon-loop", int(runtimev1.HookAdmissionState_HOOK_ADMISSION_STATE_PENDING), scheduledFor.Format(time.RFC3339Nano), string(hookRaw)); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('agent_event_sequence','0') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
		return err
	})
}

func runtimeAgentRequestContext(runtimeSourceRef string) *runtimev1.AgentRequestContext {
	ownerUserID := "user-1"
	return &runtimev1.AgentRequestContext{
		AppId:            "daemon-test",
		SubjectUserId:    ownerUserID,
		OwnerUserId:      ownerUserID,
		RuntimeSourceRef: runtimeSourceRef,
		LocalAgentRef:    "local-agent:" + ownerUserID + ":" + runtimeSourceRef,
	}
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

func waitForDaemonHookStatus(t *testing.T, daemon *Daemon, agentID string, expected runtimev1.HookAdmissionState, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := daemon.grpc.AgentService().ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
			Context:              runtimeAgentRequestContext(agentID),
			AdmissionStateFilter: expected,
		})
		if err == nil && len(resp.GetHooks()) == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("expected hook admission_state %s for agent %s", expected, agentID)
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
