package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// durableScenarioJobRowsForTest folds the durable document into the final
// row of every key, exactly as reload reads it before validation.
func durableScenarioJobRowsForTest(t testing.TB, path string) (map[string]json.RawMessage, map[string]scenarioJobDiskIdempotencyEntry, map[string]scenarioJobDiskPendingCustody, scenarioJobDurableDocument) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	document, err := parseScenarioJobDurableDocument(raw)
	if err != nil {
		t.Fatalf("parse durable ScenarioJob document: %v", err)
	}
	records := make(map[string]json.RawMessage)
	for _, row := range document.base.Records {
		var item scenarioJobDiskRecord
		if err := decodeScenarioJobStrictJSON(row, &item); err != nil {
			t.Fatal(err)
		}
		var job runtimev1.ScenarioJob
		if err := protojson.Unmarshal(item.Job, &job); err != nil {
			t.Fatal(err)
		}
		records[job.GetJobId()] = row
	}
	bindings := make(map[string]scenarioJobDiskIdempotencyEntry)
	for _, row := range document.base.Idempotency {
		var item scenarioJobDiskIdempotencyEntry
		if err := decodeScenarioJobStrictJSON(row, &item); err != nil {
			t.Fatal(err)
		}
		bindings[item.ScopeKey] = item
	}
	custody := make(map[string]scenarioJobDiskPendingCustody)
	for _, row := range document.base.PendingCustody {
		var item scenarioJobDiskPendingCustody
		if err := decodeScenarioJobStrictJSON(row, &item); err != nil {
			t.Fatal(err)
		}
		custody[item.JobID] = item
	}
	for _, entry := range document.entries {
		for _, row := range entry.Records {
			records[row.JobID] = row.Record
		}
		for _, jobID := range entry.DeletedJobs {
			delete(records, jobID)
		}
		for _, row := range entry.Idempotency {
			bindings[row.ScopeKey] = row
		}
		for _, key := range entry.DeletedIdempotency {
			delete(bindings, key)
		}
		for _, row := range entry.PendingCustody {
			custody[row.JobID] = row
		}
		for _, jobID := range entry.DeletedPendingCustody {
			delete(custody, jobID)
		}
	}
	return records, bindings, custody, document
}

// assertScenarioJobStoreMirrorsMemory checks that reload would read exactly
// the in-memory state: every live row and nothing else.
func assertScenarioJobStoreMirrorsMemory(t *testing.T, store *scenarioJobStore) {
	t.Helper()
	store.mu.Lock()
	defer store.mu.Unlock()
	records, bindings, custody, _ := durableScenarioJobRowsForTest(t, store.durablePath)
	if len(records) != len(store.jobs) {
		t.Fatalf("durable document holds %d Jobs, memory holds %d", len(records), len(store.jobs))
	}
	for jobID, record := range store.jobs {
		row, err := scenarioJobDiskRecordFor(jobID, record, false)
		if err != nil {
			t.Fatal(err)
		}
		want, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		got, ok := records[jobID]
		if !ok || !bytes.Equal(compactJSONForTest(t, got), compactJSONForTest(t, want)) {
			t.Fatalf("durable row for scenario job %q differs from memory:\n got: %s\nwant: %s", jobID, got, want)
		}
	}
	if len(bindings) != len(store.idempotency) {
		t.Fatalf("durable document holds %d bindings, memory holds %d", len(bindings), len(store.idempotency))
	}
	for key, binding := range store.idempotency {
		got, ok := bindings[key]
		if !ok || got.JobID != binding.jobID || !got.BoundAt.Equal(binding.boundAt) {
			t.Fatalf("durable binding %q = %+v, memory = %+v", key, got, binding)
		}
	}
	if len(custody) != len(store.pendingCloudCustody) {
		t.Fatalf("durable document holds %d custody obligations, memory holds %d", len(custody), len(store.pendingCloudCustody))
	}
	for jobID, pending := range store.pendingCloudCustody {
		got, ok := custody[jobID]
		if !ok || got.Ref != pending.ref || !got.CapturedAt.Equal(pending.capturedAt) {
			t.Fatalf("durable custody %q = %+v, memory = %+v", jobID, got, pending)
		}
	}
}

func transitionScenarioJobForJournalTest(t *testing.T, store *scenarioJobStore, jobID string, status runtimev1.ScenarioJobStatus) {
	t.Helper()
	if _, transitioned, err := store.transition(jobID, status, scenarioJobEventForStatus(status), func(job *runtimev1.ScenarioJob) {
		if status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			job.ProgressPercent = 100
		}
	}); err != nil || !transitioned {
		t.Fatalf("transition %q to %s: transitioned=%v err=%v", jobID, status, transitioned, err)
	}
}

func createLocalScenarioJobForJournalTest(t *testing.T, store *scenarioJobStore, jobID string, scope string, payload string) {
	t.Helper()
	job, assembly := localScenarioJobForPersistenceTest(t, jobID, "loadout-"+jobID, "recipe-journal", "1")
	if payload != "" {
		assembly.Request.Payload = json.RawMessage(payload)
	}
	if created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, scope, assembly); err != nil || created == nil || !published {
		t.Fatalf("create %q = %#v, published=%v err=%v", jobID, created, published, err)
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
func TestScenarioJobStoreJournalMirrorsEveryMutationPath(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}

	createLocalScenarioJobForJournalTest(t, store, "job-local", "scope-local", "")
	assertScenarioJobStoreMirrorsMemory(t, store)
	transitionScenarioJobForJournalTest(t, store, "job-local", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	transitionScenarioJobForJournalTest(t, store, "job-local", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	assertScenarioJobStoreMirrorsMemory(t, store)
	if _, updated, err := store.updateProgress("job-local", 1, 2, 50); err != nil || !updated {
		t.Fatalf("progress: updated=%v err=%v", updated, err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
	artifact := &runtimev1.ScenarioArtifact{ArtifactId: "artifact-local", MimeType: "text/plain", Bytes: []byte("result")}
	if _, committed, err := store.commitArtifact("job-local", artifact, 2, 2, 100); err != nil || !committed {
		t.Fatalf("artifact: committed=%v err=%v", committed, err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
	transitionScenarioJobForJournalTest(t, store, "job-local", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	assertScenarioJobStoreMirrorsMemory(t, store)

	ref := beginCloudCredentialCustodyForTest(t, store, "job-cloud")
	assertScenarioJobStoreMirrorsMemory(t, store)
	cloud := completedScenarioJobForIsolationTest("job-cloud")
	cloud.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	if created, published, err := store.createOwnedAndBindCloudAssemblyChecked(cloud, func() {}, nil, "scope-cloud", cloudAssemblyForIsolationTest(t, cloud)); err != nil || created == nil || !published {
		t.Fatalf("create Cloud Job = %#v, published=%v err=%v", created, published, err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
	transitionScenarioJobForJournalTest(t, store, "job-cloud", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	if err := store.clearTerminalCloudCredentialCustody("job-cloud", ref); err != nil {
		t.Fatal(err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
	abandonedRef := beginCloudCredentialCustodyForTest(t, store, "job-abandoned")
	if err := store.clearPendingCloudCredentialCustody("job-abandoned", abandonedRef); err != nil {
		t.Fatal(err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)

	createLocalScenarioJobForJournalTest(t, store, "job-canceled", "", "")
	if _, requested, err := store.requestCancel("job-canceled", "caller canceled"); err != nil || !requested {
		t.Fatalf("cancel: requested=%v err=%v", requested, err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)

	// A forced in-memory terminal is recorded by the next write that succeeds.
	createLocalScenarioJobForJournalTest(t, store, "job-forced", "", "")
	if _, forced := store.forceFailedInMemory("job-forced", scenarioJobTerminalPersistenceFailedReason); !forced {
		t.Fatal("forced in-memory failure did not apply")
	}
	createLocalScenarioJobForJournalTest(t, store, "job-after-forced", "", "")
	assertScenarioJobStoreMirrorsMemory(t, store)
	transitionScenarioJobForJournalTest(t, store, "job-after-forced", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)

	// Retention removal, with removed captured inputs folded out of history.
	store.mu.Lock()
	store.pruneLocked(time.Now().UTC().Add(scenarioJobRetention + time.Minute))
	err = store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistMaintenance})
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)

	createLocalScenarioJobForJournalTest(t, store, "job-final", "scope-final", "")
	transitionScenarioJobForJournalTest(t, store, "job-final", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	assertScenarioJobStoreMirrorsMemory(t, store)
	reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if diagnostics := reopened.IsolationDiagnostics(); len(diagnostics) != 0 {
		t.Fatalf("reload isolated journaled state: %+v", diagnostics)
	}
	for jobID, record := range store.jobs {
		got, ok := reopened.get(jobID)
		if !ok || !proto.Equal(got, record.job) {
			t.Fatalf("reloaded %q = %v, want %v", jobID, got, record.job)
		}
	}
	if len(reopened.jobs) != len(store.jobs) || len(reopened.idempotency) != len(store.idempotency) {
		t.Fatalf("reload holds jobs=%d bindings=%d, want %d and %d", len(reopened.jobs), len(reopened.idempotency), len(store.jobs), len(store.idempotency))
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
func TestScenarioJobStoreMutationAppendsOnlyTheChangedJob(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		jobID := fmt.Sprintf("job-retained-%d", i)
		createLocalScenarioJobForJournalTest(t, store, jobID, "", "")
		transitionScenarioJobForJournalTest(t, store, jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	}
	// An unchanged retained row is neither revalidated nor rewritten by an
	// unrelated mutation, even when its in-memory copy would now fail.
	store.mu.Lock()
	retained := store.jobs["job-retained-0"]
	traceID := retained.job.TraceId
	retained.job.TraceId = ""
	store.mu.Unlock()

	createLocalScenarioJobForJournalTest(t, store, "job-changed", "", "")
	for _, status := range []runtimev1.ScenarioJobStatus{
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
	} {
		transitionScenarioJobForJournalTest(t, store, "job-changed", status)
		_, _, _, document := durableScenarioJobRowsForTest(t, store.durablePath)
		last := document.entries[len(document.entries)-1]
		if len(last.Records) != 1 || last.Records[0].JobID != "job-changed" || len(last.DeletedJobs) != 0 ||
			len(last.Idempotency) != 0 || len(last.PendingCustody) != 0 {
			t.Fatalf("%s appended %+v, want only job-changed", status, last)
		}
	}
	store.mu.Lock()
	retained.job.TraceId = traceID
	store.mu.Unlock()
	assertScenarioJobStoreMirrorsMemory(t, store)
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
func TestScenarioJobStoreReloadDiscardsOnlyAnUnacknowledgedFinalAppend(t *testing.T) {
	tests := []struct {
		name     string
		corrupt  func(t *testing.T, raw []byte) []byte
		isolated bool
	}{
		{
			name: "unterminated final append",
			corrupt: func(_ *testing.T, raw []byte) []byte {
				return append(raw, []byte(`{"records":[{"job_id":"job-torn","rec`)...)
			},
		},
		{
			name: "terminated final append with unwritten bytes",
			corrupt: func(_ *testing.T, raw []byte) []byte {
				return append(raw, []byte("{\"records\":[\x00\x00\x00\x00]}\n")...)
			},
		},
		{
			name:     "well-formed final line that is not a mutation",
			corrupt:  func(_ *testing.T, raw []byte) []byte { return append(raw, []byte("{\"unexpected\":true}\n")...) },
			isolated: true,
		},
		{
			name: "unreadable acknowledged line before the final one",
			corrupt: func(t *testing.T, raw []byte) []byte {
				lines := bytes.SplitAfter(raw, []byte("\n"))
				if len(lines) < 3 {
					t.Fatalf("document has no appended line: %q", raw)
				}
				corrupted := append([]byte(nil), bytes.Join(lines[:len(lines)-2], nil)...)
				corrupted = append(corrupted, []byte("not a mutation\n")...)
				return append(corrupted, bytes.Join(lines[len(lines)-2:], nil)...)
			},
			isolated: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			createLocalScenarioJobForJournalTest(t, store, "job-acknowledged", "", "")
			transitionScenarioJobForJournalTest(t, store, "job-acknowledged", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
			raw, err := os.ReadFile(store.durablePath)
			if err != nil {
				t.Fatal(err)
			}
			corrupted := test.corrupt(t, raw)
			if err := os.WriteFile(store.durablePath, corrupted, 0o600); err != nil {
				t.Fatal(err)
			}

			reopened, err := newScenarioJobStoreForLocalStatePathBeforeStartupPrune(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			diagnostics := reopened.IsolationDiagnostics()
			job, visible := reopened.get("job-acknowledged")
			if test.isolated {
				if len(diagnostics) != 1 || diagnostics[0].Level != scenarioJobIsolationLevelDocument || visible {
					t.Fatalf("corrupt acknowledged state was not isolated: diagnostics=%+v visible=%v", diagnostics, visible)
				}
				preserved, err := os.ReadFile(diagnostics[0].QuarantinePath)
				if err != nil || !bytes.Equal(preserved, corrupted) {
					t.Fatalf("document quarantine did not preserve the original bytes: %v", err)
				}
				return
			}
			if len(diagnostics) != 1 || diagnostics[0].Level != scenarioJobIsolationLevelJournalTail || diagnostics[0].ReasonCode != scenarioJobJournalTailDiscardedReason {
				t.Fatalf("torn final append diagnostics = %+v", diagnostics)
			}
			if !visible || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("acknowledged Job after torn final append = %v visible=%v", job, visible)
			}
			rewritten, err := os.ReadFile(scenarioJobStorePathForLocalStatePath(localStatePath))
			if err != nil {
				t.Fatal(err)
			}
			document, err := parseScenarioJobDurableDocument(rewritten)
			if err != nil || document.tornBytes != 0 || len(document.entries) != 0 {
				t.Fatalf("reload did not rewrite away the torn append: entries=%d torn=%d err=%v", len(document.entries), document.tornBytes, err)
			}
		})
	}
}

// A document changed behind the writer is rebuilt from the acknowledged
// in-memory state instead of being appended to at the wrong offset.
func TestScenarioJobStoreRewritesADocumentChangedBehindTheWriter(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	createLocalScenarioJobForJournalTest(t, store, "job-drift", "", "")
	file, err := os.OpenFile(store.durablePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString("foreign bytes"); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	transitionScenarioJobForJournalTest(t, store, "job-drift", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("foreign bytes")) || store.durable.fileBytes != int64(len(raw)) {
		t.Fatalf("drifted document was appended to instead of rewritten: %q", raw)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-incremental-persistence
func TestScenarioJobStoreRewritesHistoryThatOutgrowsTheLiveState(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	padding := strings.Repeat("captured page text ", 256<<10/19)
	createLocalScenarioJobForJournalTest(t, store, "job-large", "", `{"input":[],"page":"`+padding+`"}`)
	transitionScenarioJobForJournalTest(t, store, "job-large", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	transitionScenarioJobForJournalTest(t, store, "job-large", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	rewrites := 0
	for step := int32(1); step <= 40; step++ {
		if _, updated, err := store.updateProgress("job-large", step, 40, step*2); err != nil || !updated {
			t.Fatalf("progress %d: updated=%v err=%v", step, updated, err)
		}
		// Every progress write changes the Job, so only a rewrite leaves no
		// appended history behind it.
		if store.durable.fileBytes == store.durable.baseBytes {
			rewrites++
		}
		if limit := store.durable.baseBytes + max(store.durable.baseBytes, scenarioJobStoreRewriteFloorBytes) + (512 << 10); store.durable.fileBytes > limit {
			t.Fatalf("document grew to %d bytes over a %d byte live state", store.durable.fileBytes, store.durable.baseBytes)
		}
	}
	if rewrites == 0 {
		t.Fatal("appended history was never folded into a new base snapshot")
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func TestScenarioJobRetentionSweepRemovesExpiredCapturedInputsFromDisk(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	const marker = "search query that must expire"
	createLocalScenarioJobForJournalTest(t, store, "job-expired", "", `{"input":[],"query":"`+marker+`"}`)
	transitionScenarioJobForJournalTest(t, store, "job-expired", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	// Age the terminal Job past retention.
	expiredAt := time.Now().UTC().Add(-scenarioJobRetention - time.Minute)
	store.mu.Lock()
	expired := store.jobs["job-expired"]
	expired.job.CreatedAt = timestamppb.New(expiredAt.Add(-time.Second))
	expired.job.UpdatedAt = timestamppb.New(expiredAt)
	expired.createdAt, expired.updatedAt, expired.terminalAt = expiredAt.Add(-time.Second), expiredAt, expiredAt
	err = store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: "job-expired"})
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	// Ordinary traffic prunes the expired Job, but its captured inputs stay in
	// superseded history until a rewrite drops them.
	createLocalScenarioJobForJournalTest(t, store, "job-live", "", "")
	if _, visible := store.get("job-expired"); visible {
		t.Fatal("expired Job remained live")
	}
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(marker)) || !store.durable.removed {
		t.Fatalf("expected pruned captured inputs pending removal: contains=%v removed=%v", bytes.Contains(raw, []byte(marker)), store.durable.removed)
	}
	if err := store.maintainDurableState(time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(marker)) || store.durable.removed {
		t.Fatal("retention sweep left expired captured inputs on disk")
	}
	if _, visible := store.get("job-live"); !visible {
		t.Fatal("retention sweep removed a live Job")
	}
	assertScenarioJobStoreMirrorsMemory(t, store)

	// A sweep with nothing expired writes nothing.
	before, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.maintainDurableState(time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(store.durablePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("idle retention sweep rewrote the store: %v", err)
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func TestScenarioJobStartupRemovesCapturedInputsThatExpiredWhileStopped(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	const marker = "goal text that expired while Runtime was stopped"
	createLocalScenarioJobForJournalTest(t, store, "job-expired-offline", "", `{"input":[],"goal":"`+marker+`"}`)
	transitionScenarioJobForJournalTest(t, store, "job-expired-offline", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	expiredAt := time.Now().UTC().Add(-scenarioJobRetention - time.Minute)
	store.mu.Lock()
	expired := store.jobs["job-expired-offline"]
	expired.job.CreatedAt = timestamppb.New(expiredAt.Add(-time.Second))
	expired.job.UpdatedAt = timestamppb.New(expiredAt)
	expired.createdAt, expired.updatedAt, expired.terminalAt = expiredAt.Add(-time.Second), expiredAt, expiredAt
	err = store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: "job-expired-offline"})
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	svc, err := NewProtected(nil, nil, connector.NewConnectorStoreWithMemorySecrets(t.TempDir()), runtimecfg.Config{LocalStatePath: localStatePath})
	if err != nil {
		t.Fatal(err)
	}
	if _, visible := svc.scenarioJobs.get("job-expired-offline"); visible {
		t.Fatal("restart served a Job that expired while Runtime was stopped")
	}
	raw, err := os.ReadFile(svc.scenarioJobs.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(marker)) {
		t.Fatal("restart kept captured inputs of a Job that expired while Runtime was stopped")
	}
}

func TestScenarioJobRetentionSweepDoesNotMaterializeAnUnwrittenStore(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.maintainDurableState(time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(store.durablePath); !os.IsNotExist(err) {
		t.Fatalf("retention sweep created an empty store: %v", err)
	}
}

func terminalScenarioJobForEvictionTest(jobID string, appID string, mode runtimev1.ExecutionMode, terminalAt time.Time) *scenarioJobRecord {
	return &scenarioJobRecord{
		job: &runtimev1.ScenarioJob{
			JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user"},
			ExecutionMode: mode, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		},
		terminalAt: terminalAt,
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func TestImmediateScenarioJobBurstCannotEvictSubmittedResults(t *testing.T) {
	store := newScenarioJobStore()
	now := time.Now().UTC()
	// Another App's finished media Job, older than every immediate Job.
	store.jobs["media-result"] = terminalScenarioJobForEvictionTest("media-result", "app.media", runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, now.Add(-20*time.Minute))
	burst := maxRetainedTerminalScenarioJobs + 60
	for i := 0; i < burst; i++ {
		mode := runtimev1.ExecutionMode_EXECUTION_MODE_SYNC
		if i%10 == 0 {
			mode = runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
		}
		jobID := fmt.Sprintf("decide-%04d", i)
		store.jobs[jobID] = terminalScenarioJobForEvictionTest(jobID, "app.browser", mode, now.Add(-10*time.Minute).Add(time.Duration(i)*time.Millisecond))
	}
	store.mu.Lock()
	store.pruneJobsLocked(now)
	store.mu.Unlock()
	if _, ok := store.get("media-result"); !ok {
		t.Fatal("immediate burst evicted another App's submitted result")
	}
	if got := len(store.jobs) - 1; got != maxRetainedTerminalScenarioJobs {
		t.Fatalf("retained %d immediate Jobs, want %d", got, maxRetainedTerminalScenarioJobs)
	}
	for i := 0; i < burst; i++ {
		_, ok := store.get(fmt.Sprintf("decide-%04d", i))
		if wantEvicted := i < burst-maxRetainedTerminalScenarioJobs; ok == wantEvicted {
			t.Fatalf("immediate Job %d retained=%v, want oldest-first eviction within its class", i, ok)
		}
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-retention
func TestSubmittedScenarioJobsKeepTheirOwnCountBound(t *testing.T) {
	store := newScenarioJobStore()
	now := time.Now().UTC()
	store.jobs["decide-old"] = terminalScenarioJobForEvictionTest("decide-old", "app.browser", runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, now.Add(-25*time.Minute))
	extra := 3
	for i := 0; i < maxRetainedTerminalScenarioJobs+extra; i++ {
		jobID := fmt.Sprintf("image-%04d", i)
		store.jobs[jobID] = terminalScenarioJobForEvictionTest(jobID, "app.media", runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, now.Add(-10*time.Minute).Add(time.Duration(i)*time.Millisecond))
	}
	store.mu.Lock()
	store.pruneJobsLocked(now)
	store.mu.Unlock()
	if _, ok := store.get("decide-old"); !ok {
		t.Fatal("submitted Jobs evicted an immediate Job from the other class")
	}
	for i := 0; i < extra; i++ {
		if _, ok := store.get(fmt.Sprintf("image-%04d", i)); ok {
			t.Fatalf("oldest submitted Job %d survived its class bound", i)
		}
	}
	if got := len(store.jobs) - 1; got != maxRetainedTerminalScenarioJobs {
		t.Fatalf("retained %d submitted Jobs, want %d", got, maxRetainedTerminalScenarioJobs)
	}
}

// @nimi-authority: rule.nimi.runtime.service-operations.scenario-job-isolation-evidence
func TestScenarioJobQuarantineCopiesExpireWithJobRetention(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	root := filepath.Dir(scenarioJobStorePathForLocalStatePath(localStatePath))
	quarantine := filepath.Join(root, scenarioJobIsolationQuarantineDirName)
	if err := os.MkdirAll(quarantine, 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	copyName := func(isolatedAt time.Time, level string) string {
		return filepath.Join(quarantine, fmt.Sprintf("%s.%d.%s.json", scenarioJobDiskStoreFileName, isolatedAt.UnixNano(), level))
	}
	expiredRecords := copyName(now.Add(-scenarioJobIsolationRetention-time.Minute), scenarioJobQuarantineRecordsLevel)
	expiredDocument := copyName(now.Add(-48*time.Hour), scenarioJobIsolationLevelDocument)
	fresh := copyName(now.Add(-time.Minute), scenarioJobQuarantineRecordsLevel)
	foreign := filepath.Join(quarantine, "operator-notes.txt")
	interrupted := []string{filepath.Join(root, ".scenario-jobs-1.tmp"), filepath.Join(quarantine, ".scenario-jobs-2.tmp")}
	for _, path := range append([]string{expiredRecords, expiredDocument, fresh, foreign}, interrupted...) {
		if err := os.WriteFile(path, []byte(`{"version":1,"records":[]}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	svc, err := NewProtected(nil, nil, connector.NewConnectorStoreWithMemorySecrets(t.TempDir()), runtimecfg.Config{LocalStatePath: localStatePath})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range append([]string{expiredRecords, expiredDocument}, interrupted...) {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("startup kept expired or interrupted copy %s: %v", filepath.Base(path), err)
		}
	}
	for _, path := range []string{fresh, foreign} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("startup removed %s: %v", filepath.Base(path), err)
		}
	}
	if err := svc.scenarioJobs.maintainDurableState(now.Add(scenarioJobIsolationRetention)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(fresh); !os.IsNotExist(err) {
		t.Fatalf("running sweep kept an expired quarantine copy: %v", err)
	}
	if _, err := os.Stat(foreign); err != nil {
		t.Fatalf("running sweep removed a file it did not write: %v", err)
	}
}

func TestScenarioJobQuarantineIsolatedAtReadsOnlyStoreWrittenNames(t *testing.T) {
	at := time.Unix(0, 1790199885489003400).UTC()
	for name, want := range map[string]bool{
		"scenario-jobs.json.1790199885489003400.records.json":  true,
		"scenario-jobs.json.1790199885489003400.document.json": true,
		"scenario-jobs.json.unreadable.document.json":          false,
		"scenario-jobs.json.1790199885489003400.other.json":    false,
		"local-state.json.1790199885489003400.records.json":    false,
		"scenario-jobs.json.-5.records.json":                   false,
	} {
		got, ok := scenarioJobQuarantineIsolatedAt(name)
		if ok != want || (ok && !got.Equal(at)) {
			t.Fatalf("%s isolated at %v ok=%v, want ok=%v", name, got, ok, want)
		}
	}
}

// benchmarkScenarioJobForTest clones one submitted local Job whose captured
// request is about the size of a real text.decide request.
func benchmarkScenarioJobForTest(template *runtimev1.ScenarioJob, jobID string, at time.Time) *runtimev1.ScenarioJob {
	job := proto.Clone(template).(*runtimev1.ScenarioJob)
	job.JobId, job.TraceId = jobID, "trace-"+jobID
	job.CreatedAt, job.UpdatedAt = timestamppb.New(at), timestamppb.New(at)
	return job
}

// retainedScenarioJobStoreForBenchmark holds retained terminal immediate Jobs
// that all share the template's captured inputs.
func retainedScenarioJobStoreForBenchmark(b *testing.B, retained int, template *runtimev1.ScenarioJob, assembly *localResolvedAssembly) *scenarioJobStore {
	b.Helper()
	store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(b.TempDir(), "local-state.json"))
	if err != nil {
		b.Fatal(err)
	}
	now := time.Now().UTC()
	for i := 0; i < retained; i++ {
		jobID := fmt.Sprintf("job-retained-%05d", i)
		job := benchmarkScenarioJobForTest(template, jobID, now)
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
		job.ProgressPercent = 100
		done := make(chan struct{})
		close(done)
		store.jobs[jobID] = &scenarioJobRecord{
			job: job, resolvedAssembly: assembly, subscribers: make(map[uint64]chan *runtimev1.ScenarioJobEvent),
			done: done, doneClosed: true, createdAt: now, updatedAt: now, terminalAt: now,
		}
	}
	store.mu.Lock()
	err = store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistLoad})
	store.mu.Unlock()
	if err != nil {
		b.Fatal(err)
	}
	return store
}

// BenchmarkScenarioJobStoreImmediateLifecycle measures the durable writes of
// one immediate Job (create, QUEUED, RUNNING, COMPLETED) against a store that
// already retains many terminal Jobs. Cost should not grow with retained.
func BenchmarkScenarioJobStoreImmediateLifecycle(b *testing.B) {
	template, assembly := localScenarioJobForPersistenceTest(b, "job-template", "loadout-bench", "recipe-bench", "1")
	assembly.Request.Payload = json.RawMessage(`{"input":[],"page":"` + strings.Repeat("page text words ", 1000) + `"}`)
	for _, retained := range []int{16, 256, 1024} {
		b.Run(fmt.Sprintf("retained=%d", retained), func(b *testing.B) {
			store := retainedScenarioJobStoreForBenchmark(b, retained, template, assembly)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				jobID := fmt.Sprintf("job-bench-%08d", i)
				job := benchmarkScenarioJobForTest(template, jobID, time.Now().UTC())
				if _, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || !published {
					b.Fatalf("create: %v", err)
				}
				for _, status := range []runtimev1.ScenarioJobStatus{
					runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
					runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
					runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
				} {
					if _, transitioned, err := store.transition(jobID, status, scenarioJobEventForStatus(status), nil); err != nil || !transitioned {
						b.Fatalf("transition %s: %v", status, err)
					}
				}
			}
		})
	}
}
