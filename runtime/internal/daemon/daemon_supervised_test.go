package daemon

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

func TestStartSupervisedEnginesManagerInitFailureDegradesAndAudits(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:              "127.0.0.1:0",
		HTTPAddr:              "127.0.0.1:0",
		LocalRuntimeStatePath: filepath.Join(t.TempDir(), "local-runtime-state.json"),
		AuditRingBufferSize:   64,
		UsageStatsBufferSize:  64,
		EngineLocalAIEnabled:  true,
		EngineLocalAIPort:     1234,
		EngineLocalAIVersion:  "3.12.1",
	}
	daemon := New(cfg, logger, "test")
	if svc := daemon.grpc.LocalRuntimeService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(32, 32)
	daemon.auditStore = store

	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
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

	events := store.ListEvents(&runtimev1.ListAuditEventsRequest{
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

func TestAppendEngineCrashAuditIncludesStructuredFields(t *testing.T) {
	store := auditlog.New(32, 32)
	appendEngineCrashAudit(store, "localai", "crash=exit status 7 attempt=2/5 restarting")

	events := store.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain: "runtime.engine",
	})
	if len(events.GetEvents()) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got %d", len(events.GetEvents()))
	}
	record := events.GetEvents()[0]
	if record.GetOperation() != "engine.unhealthy" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	payload := record.GetPayload().GetFields()
	if payload["engine"].GetStringValue() != "localai" {
		t.Fatalf("unexpected engine: %q", payload["engine"].GetStringValue())
	}
	if payload["detail"].GetStringValue() != "crash=exit status 7 attempt=2/5 restarting" {
		t.Fatalf("unexpected detail: %q", payload["detail"].GetStringValue())
	}
	if payload["attempt"].GetNumberValue() != 2 {
		t.Fatalf("unexpected attempt: %v", payload["attempt"].GetNumberValue())
	}
	if payload["max_attempt"].GetNumberValue() != 5 {
		t.Fatalf("unexpected max_attempt: %v", payload["max_attempt"].GetNumberValue())
	}
	if payload["exit_code"].GetNumberValue() != 7 {
		t.Fatalf("unexpected exit_code: %v", payload["exit_code"].GetNumberValue())
	}
}

func TestStartSupervisedEnginesAutoManagedLocalAIEntersLocalBootstrapBranch(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		GRPCAddr:                 "127.0.0.1:0",
		HTTPAddr:                 "127.0.0.1:0",
		LocalRuntimeStatePath:    filepath.Join(t.TempDir(), "local-runtime-state.json"),
		AuditRingBufferSize:      64,
		UsageStatsBufferSize:     64,
		EngineLocalAIEnabled:     true,
		EngineLocalAIAutoManaged: true,
		EngineLocalAIPort:        1234,
		EngineLocalAIVersion:     "3.12.1",
	}
	daemon := New(cfg, logger, "test")
	if svc := daemon.grpc.LocalRuntimeService(); svc != nil {
		t.Cleanup(func() { svc.Close() })
	}
	store := auditlog.New(64, 64)
	daemon.auditStore = store
	daemon.aiHealth = providerhealth.New()
	daemon.newEngineManager = func(_ *slog.Logger, _ string, _ engine.StateChangeFunc) (*engine.Manager, error) {
		return &engine.Manager{}, nil
	}
	calls := make([]engine.EngineKind, 0, 1)
	daemon.startEngineFn = func(_ context.Context, kind engine.EngineKind, _ string, _ int, _ string) error {
		calls = append(calls, kind)
		return errors.New("mock bootstrap failure")
	}

	daemon.startSupervisedEngines(context.Background())

	if !slices.Equal(calls, []engine.EngineKind{engine.EngineLocalAI}) {
		t.Fatalf("expected localai bootstrap call, got=%v", calls)
	}
	snapshot := daemon.state.Snapshot()
	if snapshot.Status != health.StatusDegraded {
		t.Fatalf("expected degraded on bootstrap failure, got=%s (%s)", snapshot.Status, snapshot.Reason)
	}
	if !strings.Contains(snapshot.Reason, "engine bootstrap failed (localai: mock bootstrap failure)") {
		t.Fatalf("unexpected degraded reason: %s", snapshot.Reason)
	}

	localProvider := daemon.aiHealth.Snapshot("local")
	if localProvider.State != providerhealth.StateUnhealthy {
		t.Fatalf("expected local provider unhealthy after bootstrap failure, got=%s", localProvider.State)
	}
	if !strings.Contains(localProvider.LastReason, "engine bootstrap failed (localai: mock bootstrap failure)") {
		t.Fatalf("unexpected local provider reason: %s", localProvider.LastReason)
	}

	events := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.engine"}).GetEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 runtime.engine event, got=%d", len(events))
	}
	record := events[0]
	if record.GetOperation() != "engine.bootstrap_failed" {
		t.Fatalf("unexpected operation: %s", record.GetOperation())
	}
	payload := record.GetPayload().GetFields()
	if payload["engine"].GetStringValue() != "localai" {
		t.Fatalf("unexpected engine payload: %q", payload["engine"].GetStringValue())
	}
	if payload["provider"].GetStringValue() != "local" {
		t.Fatalf("unexpected provider payload: %q", payload["provider"].GetStringValue())
	}
	if payload["detail"].GetStringValue() != "mock bootstrap failure" {
		t.Fatalf("unexpected detail payload: %q", payload["detail"].GetStringValue())
	}
}
