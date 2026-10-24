package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/protobuf/encoding/protojson"
)

// The direct envelopes must preserve the existing serialized protocol, not
// merely decode to a superficially similar object. Rows come from the same
// canonical row encoder used by the actual writer.
func TestScenarioJobEncodedEnvelopesMatchExistingJSON(t *testing.T) {
	at := time.Date(2026, 10, 24, 2, 3, 4, 567000000, time.UTC)
	id := "工作\"\\\n<>&\u2028\u2029"
	job, err := json.Marshal(map[string]string{"job_id": id, "text": "正文 😀\n\t<>&\u2028\u2029"})
	if err != nil {
		t.Fatal(err)
	}
	row := scenarioJobDiskRecord{Job: job, CreatedAt: at, UpdatedAt: at}
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	for _, rowsPresent := range []bool{false, true} {
		for _, controlsPresent := range []bool{false, true} {
			for _, recovery := range []bool{false, true} {
				snapshot := scenarioJobDiskSnapshot{Version: scenarioJobDiskStoreVersion, RecoveryIncomplete: recovery, Records: []scenarioJobDiskRecord{}}
				var rows [][]byte
				entry := scenarioJobJournalEntry{Records: []scenarioJobJournalRecord{}, DeletedJobs: []string{}}
				if rowsPresent {
					snapshot.Records = append(snapshot.Records, row, row)
					rows = [][]byte{encoded, encoded}
					entry.Records = append(entry.Records, scenarioJobJournalRecord{JobID: id, Record: encoded}, scenarioJobJournalRecord{JobID: "second", Record: encoded})
				}
				if controlsPresent {
					snapshot.Idempotency = []scenarioJobDiskIdempotencyEntry{{ScopeKey: id, JobID: id, BoundAt: at}}
					snapshot.PendingCustody = []scenarioJobDiskPendingCustody{{JobID: id, Ref: "ref\"\\\n<>&", CapturedAt: at}}
					entry.Idempotency, entry.PendingCustody = snapshot.Idempotency, snapshot.PendingCustody
					entry.DeletedJobs = []string{id}
					entry.DeletedIdempotency = []string{id}
					entry.DeletedPendingCustody = []string{id}
				}
				want, err := json.Marshal(snapshot)
				if err != nil {
					t.Fatal(err)
				}
				got, err := encodeScenarioJobSnapshot(snapshot, rows)
				if err != nil || !bytes.Equal(got, want) || bytes.ContainsRune(got, '\n') {
					t.Fatalf("snapshot rows=%v controls=%v recovery=%v: got=%s want=%s err=%v", rowsPresent, controlsPresent, recovery, got, want, err)
				}
				want, err = json.Marshal(entry)
				if err != nil {
					t.Fatal(err)
				}
				got, err = encodeScenarioJobJournalEntry(entry)
				if err != nil || !bytes.Equal(got, want) || bytes.ContainsRune(got, '\n') {
					t.Fatalf("journal rows=%v controls=%v: got=%s want=%s err=%v", rowsPresent, controlsPresent, got, want, err)
				}
			}
		}
	}
	// Output buffers cannot alias a retained row. Otherwise reusing or dropping
	// an envelope could corrupt cached data or retain other Jobs' disposed data.
	copyBefore := append([]byte(nil), encoded...)
	envelope, err := encodeScenarioJobSnapshot(scenarioJobDiskSnapshot{Version: 1}, [][]byte{encoded})
	if err != nil {
		t.Fatal(err)
	}
	if terminated := append(envelope, '\n'); &terminated[0] != &envelope[0] {
		t.Fatal("snapshot newline recopied the retained document")
	}
	clear(envelope)
	if !bytes.Equal(encoded, copyBefore) {
		t.Fatal("snapshot envelope aliases its retained row")
	}
	envelope, err = encodeScenarioJobJournalEntry(scenarioJobJournalEntry{Records: []scenarioJobJournalRecord{{JobID: id, Record: encoded}}})
	if err != nil {
		t.Fatal(err)
	}
	if terminated := append(envelope, '\n'); &terminated[0] != &envelope[0] {
		t.Fatal("journal newline recopied its encoded rows")
	}
	clear(envelope)
	if !bytes.Equal(encoded, copyBefore) {
		t.Fatal("journal envelope aliases its retained row")
	}
}

func TestScenarioJobEncodedRowsReuseUnchangedRowsAndChangedRewriteCandidate(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	for _, id := range []string{"changing", "retained", "expired"} {
		createLocalScenarioJobForJournalTest(t, store, id, "", `{"prompt":"`+strings.Repeat("canonical <>& 内容 ", 1000)+`"}`)
		transitionScenarioJobForJournalTest(t, store, id, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	}
	transitionScenarioJobForJournalTest(t, store, "expired", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	encoded := map[string]int{}
	encodedBytes := map[string]int{}
	store.durable.rowEncoded = func(id string, n int) { encoded[id]++; encodedBytes[id] += n }
	retained := append([]byte(nil), store.durable.encodedRows["retained"]...)
	store.mu.Lock()
	err := store.rewriteDurableStoreLocked()
	store.mu.Unlock()
	if err != nil || len(encoded) != 0 {
		t.Fatalf("unchanged rewrite encoded rows: %v err=%v", encoded, err)
	}
	// Only the terminal fixture expires. The subsequent change goes through
	// append's removal branch, carrying its already encoded candidate to rewrite.
	store.mu.Lock()
	store.pruneJobsLocked(time.Now().Add(scenarioJobRetention + time.Minute))
	store.mu.Unlock()
	if _, updated, err := store.updateProgress("changing", 1, 2, 50); err != nil || !updated {
		t.Fatalf("update: %v %v", updated, err)
	}
	if encoded["changing"] != 1 || len(encoded) != 1 || encodedBytes["changing"] != len(store.durable.encodedRows["changing"]) {
		t.Fatalf("writer re-encoded an unchanged row or rewrite candidate: counts=%v bytes=%v", encoded, encodedBytes)
	}
	if !bytes.Equal(store.durable.encodedRows["retained"], retained) || len(store.durable.encodedRows) != 2 || store.durable.encodedRows["expired"] != nil {
		t.Fatal("rewrite retained an expired row or changed an unrelated cache entry")
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
}

func TestScenarioJobEncodedRowsNeverPublishFailedWriteCandidates(t *testing.T) {
	for _, kind := range []string{"append", "rewrite"} {
		t.Run(kind, func(t *testing.T) {
			store, _ := newDurableScenarioJobStoreForFailureTest(t)
			for _, id := range []string{"rolled-back", "other"} {
				createLocalScenarioJobForJournalTest(t, store, id, "", "")
				transitionScenarioJobForJournalTest(t, store, id, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
			}
			originalPath := store.durablePath
			attemptEncodings := 0
			store.durable.rowEncoded = func(id string, _ int) {
				if id == "rolled-back" {
					attemptEncodings++
				}
			}
			if kind == "append" {
				store.durable.fileIO = &scenarioJobFileIO{writeAt: func(file *os.File, data []byte, offset int64) (int, error) {
					n, err := file.WriteAt(data[:len(data)/2], offset)
					if err != nil {
						return n, err
					}
					return n, errors.New("injected partial append")
				}}
			} else {
				// A real OS write error after row encoding. The existing document
				// is a file, so it cannot become a new snapshot's parent directory.
				store.durablePath = filepath.Join(originalPath, "unwritable.json")
				store.durable.current = false
			}
			if _, changed, err := store.updateProgress("rolled-back", 99, 100, 99); err == nil || changed {
				t.Fatalf("write failure was acknowledged: changed=%v err=%v", changed, err)
			}
			if attemptEncodings != 1 || store.durable.encodedRows["rolled-back"] != nil {
				t.Fatalf("failed encoded row became reusable: encodings=%d cached=%v", attemptEncodings, store.durable.encodedRows["rolled-back"] != nil)
			}
			store.durablePath, store.durable.fileIO = originalPath, nil
			store.durable.current = false
			if _, changed, err := store.updateProgress("other", 1, 3, 33); err != nil || !changed {
				t.Fatalf("unrelated rewrite: changed=%v err=%v", changed, err)
			}
			assertScenarioJobStoreMirrorsMemory(t, store)
			row := encodedRowForCacheTest(t, store, "rolled-back")
			var job runtimev1.ScenarioJob
			if err := protojson.Unmarshal(row.Job, &job); err != nil || job.ProgressPercent != 0 {
				t.Fatalf("rewrite published rolled-back progress: %v err=%v", &job, err)
			}
		})
	}
}

func TestScenarioJobEncodedRowsForgetDisposedMemoryAndExpiredJobs(t *testing.T) {
	ctx := scenarioJobUserContext("nimi.runtime.memory", "user-001")
	svc, _, _, _, raw, _ := newCapturedLocalMemoryTest(t, ctx)
	var execution memoryEmbeddingExecution
	if err := json.Unmarshal(raw, &execution); err != nil {
		t.Fatal(err)
	}
	id := execution.Jobs[0]
	before := encodedRowForCacheTest(t, svc.scenarioJobs, id)
	if len(before.ResolvedAssembly) == 0 || before.Payload.State != "retained" {
		t.Fatal("fixture was not durably captured")
	}
	if err := svc.DiscardMemoryEmbedding(ctx, raw); err != nil {
		t.Fatal(err)
	}
	after := encodedRowForCacheTest(t, svc.scenarioJobs, id)
	if len(after.ResolvedAssembly) != 0 || len(after.CloudResolvedAssembly) != 0 || after.Payload.State != "disposed" {
		t.Fatal("disposed Memory contents remain in the live row cache")
	}
	assertScenarioJobStoreMirrorsMemory(t, svc.scenarioJobs)
	if err := svc.scenarioJobs.maintainDurableState(time.Now().Add(2 * scenarioJobRetention)); err != nil {
		t.Fatal(err)
	}
	if len(svc.scenarioJobs.durable.encodedRows) != 0 {
		t.Fatal("expired Memory row remains reachable in the cache")
	}
}

func TestScenarioJobEncodedRowsRefreshLateReceiptAndConfirmedCancelWithoutNewTimestamps(t *testing.T) {
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	job := completedScenarioJobForIsolationTest("late-encoded-receipt")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	if _, created, err := store.createOwnedAndBindCloudAssemblyChecked(job, nil, nil, "", cloudAssemblyForIsolationTest(t, job)); err != nil || !created {
		t.Fatal(err)
	}
	transitionScenarioJobForJournalTest(t, store, job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	if err := store.markScenarioDispatchPossible(context.Background(), job.JobId); err != nil {
		t.Fatal(err)
	}
	if _, canceled, err := store.requestCancel(job.JobId, "cancel before receipt"); err != nil || !canceled {
		t.Fatal(err)
	}
	terminalAt := store.jobs[job.JobId].terminalAt
	updatedAt := store.jobs[job.JobId].updatedAt
	receipt := &nimillm.NativeTaskReceipt{Version: 1, Adapter: nimillm.AdapterAlibabaNative, TaskID: "original-cached-task", QueryPathTemplate: "/api/v1/tasks/{task_id}", Artifact: &runtimev1.ScenarioArtifact{ArtifactId: "original-cached-result", MimeType: "image/png"}}
	store.durable.fileIO = &scenarioJobFileIO{writeAt: func(_ *os.File, _ []byte, _ int64) (int, error) { return 0, errors.New("receipt append unavailable") }}
	if err := store.bindNativeReceipt(job.JobId, receipt, true); err == nil {
		t.Fatal("receipt failure was acknowledged")
	}
	if !store.nativeReceiptNeedsPersistence(job.JobId) || store.durable.encodedRows[job.JobId] != nil {
		t.Fatal("failed receipt was cached as acknowledged")
	}
	store.durable.fileIO = nil
	createLocalScenarioJobForJournalTest(t, store, "unrelated-write", "", "")
	if row := encodedRowForCacheTest(t, store, job.JobId); row.NativeReceipt != nil {
		t.Fatal("unrelated write published an unpersisted receipt")
	}
	if err := store.bindNativeReceipt(job.JobId, receipt, true); err != nil {
		t.Fatal(err)
	}
	if row := encodedRowForCacheTest(t, store, job.JobId); row.NativeReceipt == nil || row.NativeReceipt.TaskID != receipt.TaskID {
		t.Fatal("late receipt did not replace cached projection")
	}
	if err := store.confirmNativeStop(context.Background(), job.JobId); err != nil {
		t.Fatal(err)
	}
	row := encodedRowForCacheTest(t, store, job.JobId)
	var final runtimev1.ScenarioJob
	if err := protojson.Unmarshal(row.Job, &final); err != nil {
		t.Fatal(err)
	}
	if final.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || final.GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_CONFIRMED || !row.TerminalAt.Equal(terminalAt) || !row.UpdatedAt.Equal(updatedAt) {
		t.Fatalf("cached cancellation lost its refinement or renewed its clocks: %v", &final)
	}
	assertScenarioJobStoreMirrorsMemory(t, store)
	// The public retention boundary can leave private receipt/custody duties
	// alive. Maintenance has no attempt.JobID and must still refresh this row.
	if err := store.maintainDurableState(time.Now().Add(2 * scenarioJobRetention)); err != nil {
		t.Fatal(err)
	}
	row = encodedRowForCacheTest(t, store, job.JobId)
	if !row.PublicEvicted || row.NativeReceipt == nil || !row.TerminalAt.Equal(terminalAt) {
		t.Fatal("public eviction reused a stale row or discarded private ownership")
	}
}

func encodedRowForCacheTest(t *testing.T, store *scenarioJobStore, id string) scenarioJobDiskRecord {
	t.Helper()
	store.mu.RLock()
	defer store.mu.RUnlock()
	var row scenarioJobDiskRecord
	if err := json.Unmarshal(store.durable.encodedRows[id], &row); err != nil {
		t.Fatalf("decode cached %q: %v", id, err)
	}
	return row
}
