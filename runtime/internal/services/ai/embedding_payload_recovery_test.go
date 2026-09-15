package ai

import (
	"bytes"
	"encoding/json"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAgentCleanupDisposesQuarantinedUnpublishedPayload(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	service, _, _, _, raw, statePath := newCapturedLocalMemoryTest(t, ctx)
	var capture memoryEmbeddingExecution
	if err := json.Unmarshal(raw, &capture); err != nil {
		t.Fatal(err)
	}
	durable, err := os.ReadFile(service.scenarioJobs.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	// Malformed durable-record isolation is an existing supported startup path.
	// Keep its exact private Memory owner and request, break a public timestamp.
	var snapshot scenarioJobDiskSnapshot
	if err := json.Unmarshal(durable, &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Records[0].CreatedAt = time.Time{}
	poisoned, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.scenarioJobs.durablePath, poisoned, 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(statePath)
	if err != nil {
		t.Fatal(err)
	}
	// The fixture capture has not been published to the Runtime bridge, exactly
	// as allowed by the capture -> bridge-transaction crash boundary.
	service.scenarioJobs = restored
	diagnostics := restored.IsolationDiagnostics()
	if len(diagnostics) != 1 {
		t.Fatalf("expected isolated record, got %+v", diagnostics)
	}
	if _, ok := restored.get(capture.Jobs[0]); ok {
		t.Fatal("fixture record was not isolated")
	}
	if err := service.resumeEmbeddingPayloadDisposals(ctx); err != nil {
		t.Fatal(err)
	}
	if err := service.DisposeAgentMemoryEmbeddingPayloads(ctx, "agent-a"); err != nil {
		t.Fatal(err)
	}
	remaining, err := os.ReadFile(diagnostics[0].QuarantinePath)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	var isolated scenarioJobDiskSnapshot
	if err := json.Unmarshal(remaining, &isolated); err != nil {
		t.Fatal(err)
	}
	for _, record := range isolated.Records {
		if record.Payload != nil && record.Payload.Owner.AgentRef == "agent-a" && (len(record.ResolvedAssembly) > 0 || len(record.CloudResolvedAssembly) > 0) {
			t.Fatal("quarantined execution content survived cleanup")
		}
	}
}

func TestDisposedEmbeddingMetadataExpiresAndDisposalRemainsIdempotent(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	svc, _, _, _, raw, path := newCapturedLocalMemoryTest(t, ctx)
	var execution memoryEmbeddingExecution
	if err := json.Unmarshal(raw, &execution); err != nil {
		t.Fatal(err)
	}
	if err := svc.DiscardMemoryEmbedding(ctx, raw); err != nil {
		t.Fatal(err)
	}
	svc.scenarioJobs.mu.Lock()
	svc.scenarioJobs.pruneLocked(time.Now().Add(2 * scenarioJobRetention))
	err := svc.scenarioJobs.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistPrune})
	svc.scenarioJobs.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, found := svc.scenarioJobs.get(execution.Jobs[0]); found {
		t.Fatal("disposed metadata bypassed normal retention")
	}
	restored, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	svc.scenarioJobs = restored
	if err := svc.DiscardMemoryEmbedding(ctx, raw); err != nil {
		t.Fatalf("owner could not confirm already-absent content: %v", err)
	}
	if _, err := svc.ExecuteMemoryEmbedding(ctx, raw); err == nil {
		t.Fatal("expired Job was reconstructed for execution")
	}
}

func TestMemoryCleanupFailureDoesNotPreventServiceStartup(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	original, _, _, _, raw, path := newCapturedLocalMemoryTest(t, ctx)
	var execution memoryEmbeddingExecution
	if err := json.Unmarshal(raw, &execution); err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(filepath.Dir(original.scenarioJobs.durablePath), scenarioJobIsolationQuarantineDirName)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "scenario-jobs.json.unreadable.document.json"), []byte("{incomplete"), 0600); err != nil {
		t.Fatal(err)
	}
	scratch := filepath.Join(filepath.Dir(original.scenarioJobs.durablePath), ".scenario-jobs-interrupted.tmp")
	if err := os.WriteFile(scratch, []byte("{interrupted atomic write"), 0600); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	service, err := NewProtected(slog.New(slog.NewTextHandler(&logs, nil)), nil, connector.NewConnectorStoreWithMemorySecrets(t.TempDir()), runtimecfg.Config{LocalStatePath: path})
	if err != nil {
		t.Fatalf("copy cleanup blocked Runtime service initialization: %v", err)
	}
	if !strings.Contains(logs.String(), "embedding payload cleanup remains pending") {
		t.Fatal("pending cleanup was not observable")
	}
	job, found := service.scenarioJobs.get(execution.Jobs[0])
	if !found || !isTerminalScenarioJobStatus(job.GetStatus()) {
		t.Fatal("interrupted Job regained execution custody")
	}
	if err := service.DiscardMemoryEmbedding(ctx, raw); err == nil {
		t.Fatal("uninspectable copy was reported disposed")
	}
	if _, err := os.Stat(scratch); !os.IsNotExist(err) {
		t.Fatalf("abandoned atomic-write scratch remained: %v", err)
	}
}
