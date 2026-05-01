package daemon

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestDaemonNewImportsLegacyStateBeforeReadiness(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	if err := writePersistedMemoryState(localStatePath, "agent-import", "mem-import"); err != nil {
		t.Fatalf("writePersistedMemoryState: %v", err)
	}
	if err := writePersistedRuntimeAgentState(localStatePath, "agent-import", time.Now().UTC().Add(time.Minute)); err != nil {
		t.Fatalf("writePersistedRuntimeAgentState: %v", err)
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
	closeDaemonForTest(t, daemon)
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
	if _, err := os.Stat(filepath.Join(runtimeDir, "runtime-agent-state.json.wave4-imported.json.bak")); err != nil {
		t.Fatalf("expected runtime-agent legacy rename before Run: %v", err)
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

	restored, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
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

func writePersistedRuntimeAgentState(localStatePath string, agentID string, scheduledFor time.Time) error {
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
	// K-AGCORE-041 mounted hook vocabulary: TIME-family HookIntent with
	// relative delay = scheduledFor - now. not_before pins the earliest
	// firing so the normalizer's max(delay, not_before) preserves the
	// absolute-schedule semantics this integration test historically relied
	// on, without reintroducing SCHEDULED_TIME / NextHookIntent.
	hookDelay := scheduledFor.Sub(now)
	if hookDelay < 0 {
		hookDelay = 0
	}
	hookRaw, err := protojson.Marshal(&runtimev1.PendingHook{
		Intent: &runtimev1.HookIntent{
			IntentId:      "hook-daemon-loop",
			AgentId:       "agent-daemon-loop",
			TriggerFamily: runtimev1.HookTriggerFamily_HOOK_TRIGGER_FAMILY_TIME,
			TriggerDetail: &runtimev1.HookTriggerDetail{
				Detail: &runtimev1.HookTriggerDetail_Time{
					Time: &runtimev1.HookTriggerTimeDetail{
						Delay: durationpb.New(hookDelay),
					},
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
	statePath := filepath.Join(filepath.Dir(localStatePath), "runtime-agent-state.json")
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

func waitForDaemonHookStatus(t *testing.T, daemon *Daemon, agentID string, expected runtimev1.HookAdmissionState, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := daemon.grpc.AgentService().ListPendingHooks(context.Background(), &runtimev1.ListPendingHooksRequest{
			AgentId:              agentID,
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
