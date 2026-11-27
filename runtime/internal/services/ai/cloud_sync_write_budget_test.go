package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type countingCustodySecretStore struct {
	mu      sync.Mutex
	values  map[string]string
	writes  int
	reads   int
	deletes int
}

func newCountingCustodySecretStore() *countingCustodySecretStore {
	return &countingCustodySecretStore{values: make(map[string]string)}
}

func (s *countingCustodySecretStore) WriteSecret(id string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes++
	s.values[id] = value
	return nil
}

func (s *countingCustodySecretStore) ReadSecret(id string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reads++
	value, ok := s.values[id]
	return value, ok, nil
}

func (s *countingCustodySecretStore) DeleteSecret(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deletes++
	delete(s.values, id)
	return nil
}

func (s *countingCustodySecretStore) counts() (writes, reads, deletes int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writes, s.reads, s.deletes
}

type syncCloudWriteAuditHarness struct {
	fixture        managedCloudScenarioTestFixture
	store          *scenarioJobStore
	localStatePath string
	artifactRoot   string
	secrets        *countingCustodySecretStore
	storeWrites    atomic.Int32
	attemptsMu     sync.Mutex
	attempts       []scenarioJobPersistenceAttempt
	execReq        *runtimev1.ExecuteScenarioRequest
	streamReq      *runtimev1.StreamScenarioRequest
}

func newSyncCloudWriteAuditHarness(t *testing.T, handler http.HandlerFunc) *syncCloudWriteAuditHarness {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	secrets := newCountingCustodySecretStore()
	connStore := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
	created, err := connStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-openai-managed",
		Kind:        runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType:   runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER,
		OwnerID:     "user-001",
		Provider:    "openai",
		Endpoint:    server.URL,
		Label:       "openai Managed",
		Status:      runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "test-key")
	if err != nil {
		t.Fatalf("create counted Connector: %v", err)
	}
	connectorSvc := connector.New(logger, connStore, nil)
	listCtx := authn.WithIdentity(
		metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-nimi-app-id", "nimi.desktop")),
		&authn.Identity{SubjectUserID: "user-001"},
	)
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, listCtx, created.ConnectorID, "gpt-4o-mini")
	cfg := Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL, APIKey: "test-key"}},
		AllowLoopbackEndpoint: true,
	}
	svc, err := newFromProviderConfig(logger, nil, connStore, cfg, 8, 2)
	if err != nil {
		t.Fatalf("new managed cloud ai service: %v", err)
	}
	fixture := managedCloudScenarioTestFixture{
		service:          svc,
		connectorService: connectorSvc,
		context:          listCtx,
		connectorID:      created.ConnectorID,
		descriptor:       descriptor,
		targetRef:        cloudScenarioTargetRefForDescriptor(created.ConnectorID, descriptor),
	}

	store, localStatePath := newDurableScenarioJobStoreForFailureTest(t)
	h := &syncCloudWriteAuditHarness{
		fixture:        fixture,
		store:          store,
		localStatePath: localStatePath,
		artifactRoot:   t.TempDir(),
		secrets:        secrets,
	}
	store.durable.contentWritten = func(int) {
		h.storeWrites.Add(1)
	}
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		h.attemptsMu.Lock()
		h.attempts = append(h.attempts, attempt)
		h.attemptsMu.Unlock()
		return nil
	}
	fixture.service.scenarioJobs = store

	diskArtifacts, err := runtimeartifact.NewDiskStore(h.artifactRoot)
	if err != nil {
		t.Fatalf("NewDiskStore: %v", err)
	}
	fixture.service.SetRuntimeArtifactStore(diskArtifacts)

	const appID = "app.cloud.write-budget"
	cloudTarget, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	aiCfg := appAIConfig(appID, &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.generate",
		Defaults:           mustCloudDefaults(t, map[string]any{"maxTokens": 32}),
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: fixture.connectorID,
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.openai",
				DriverId:         "nimi.runtime.driver.openai",
				DriverDialect:    "openai/chat-completions/v1",
			},
			ProviderModelTarget: cloudTarget,
		}},
	})
	if err := overwriteAIConfigStoreForTest(scenarioJobUserContext(appID, "user-001"), fixture.service.aiConfigStore, "user-001", aiCfg); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	spec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "audit synchronous cloud writes"}},
	}}}
	h.execReq = &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec:          spec,
	}
	h.streamReq = &runtimev1.StreamScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec:          spec,
	}
	return h
}

func countFilesUnderDir(t *testing.T, root string) int {
	t.Helper()
	count := 0
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			count++
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WalkDir(%s): %v", root, err)
	}
	return count
}

func decodeJournalRecordStatusAndCustody(t *testing.T, raw json.RawMessage) (runtimev1.ScenarioJobStatus, string) {
	t.Helper()
	var diskRecord scenarioJobDiskRecord
	if err := json.Unmarshal(raw, &diskRecord); err != nil {
		t.Fatalf("unmarshal disk record: %v", err)
	}
	var job runtimev1.ScenarioJob
	if err := protojson.Unmarshal(diskRecord.Job, &job); err != nil {
		t.Fatalf("unmarshal disk job: %v", err)
	}
	var assembly cloudResolvedAssembly
	if err := json.Unmarshal(diskRecord.CloudResolvedAssembly, &assembly); err != nil {
		t.Fatalf("unmarshal cloud assembly: %v", err)
	}
	return job.GetStatus(), assembly.CredentialCustodyRef
}

// TestSynchronousCloudCallWriteCountAndJournalCheckpoints directly verifies
// the reduced per-request persistent write count on ExecuteScenario (SYNC) and
// StreamScenario (STREAM) cloud text calls:
//   - scenario-jobs.json: 3 writes (QUEUED, RUNNING, COMPLETED with empty
//     credential_custody_ref) instead of 7 (pending_custody, SUBMITTED, QUEUED,
//     RUNNING, COMPLETED+ref, no-op releaseScenarioBodyCandidates maintenance
//     rewrite, COMPLETED-clear).
//   - SecretStore: 0 WriteSecret / 0 DeleteSecret instead of 1+1.
//   - runtime-artifacts/: 0 files instead of 2 orphaned payload+record files.
func TestSynchronousCloudCallWriteCountAndJournalCheckpoints(t *testing.T) {
	var providerHits atomic.Int32
	h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, r *http.Request) {
		providerHits.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, "bad auth", http.StatusUnauthorized)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if stream, _ := body["stream"].(bool); stream {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"stream-ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n"))
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"sync-ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}`))
	})

	ctx := scenarioJobUserContext("app.cloud.write-budget", "user-001")

	// Cold call #1 establishes the base snapshot on QUEUED, then appends RUNNING
	// and COMPLETED (3 total writes). Steady-state call #2 appends all 3 lines.
	for callIdx := 1; callIdx <= 2; callIdx++ {
		writesBefore := h.storeWrites.Load()
		secretWritesBefore, _, secretDeletesBefore := h.secrets.counts()
		artifactFilesBefore := countFilesUnderDir(t, h.artifactRoot)

		resp, err := h.fixture.service.ExecuteScenario(ctx, h.execReq)
		if err != nil || outputText(resp.GetOutput()) != "sync-ok" {
			t.Fatalf("ExecuteScenario #%d = %+v, err=%v", callIdx, resp, err)
		}

		storeDelta := h.storeWrites.Load() - writesBefore
		secretWritesAfter, _, secretDeletesAfter := h.secrets.counts()
		artifactFilesAfter := countFilesUnderDir(t, h.artifactRoot)

		if storeDelta != 3 {
			h.attemptsMu.Lock()
			gotAttempts := append([]scenarioJobPersistenceAttempt(nil), h.attempts...)
			h.attemptsMu.Unlock()
			t.Fatalf("ExecuteScenario #%d scenario-jobs.json writes = %d, want 3 (QUEUED, RUNNING, COMPLETED); attempts=%+v", callIdx, storeDelta, gotAttempts)
		}
		if secretWritesAfter != secretWritesBefore || secretDeletesAfter != secretDeletesBefore {
			t.Fatalf("ExecuteScenario #%d touched durable SecretStore: writes %d->%d deletes %d->%d",
				callIdx, secretWritesBefore, secretWritesAfter, secretDeletesBefore, secretDeletesAfter)
		}
		if artifactFilesAfter != artifactFilesBefore {
			t.Fatalf("ExecuteScenario #%d wrote %d runtime-artifact files, want 0", callIdx, artifactFilesAfter-artifactFilesBefore)
		}
	}

	// Verify exact journal structure of steady-state ExecuteScenario #2:
	// 3 journal entries (QUEUED+ref, RUNNING+ref, COMPLETED+empty ref), zero
	// pending_credential_custody entries, zero SUBMITTED entries, zero raw secret.
	raw, err := readScenarioJobDocument(h.store.durablePath)
	if err != nil {
		t.Fatalf("readScenarioJobDocument: %v", err)
	}
	if bytes.Contains(raw, []byte("test-key")) {
		t.Fatalf("scenario-jobs.json contains raw credential: %s", raw)
	}
	doc, err := parseScenarioJobDurableDocument(raw)
	if err != nil {
		t.Fatalf("parseScenarioJobDurableDocument: %v", err)
	}
	// Call #1 wrote base(QUEUED) + 2 journal entries (RUNNING, COMPLETED);
	// Call #2 appended 3 journal entries (QUEUED, RUNNING, COMPLETED) = 5 total.
	if len(doc.entries) != 5 {
		t.Fatalf("journal entry count = %d, want 5 (2 from cold call #1 + 3 from steady-state call #2)", len(doc.entries))
	}
	for i, entry := range doc.entries {
		if len(entry.PendingCustody) != 0 || len(entry.DeletedPendingCustody) != 0 {
			t.Fatalf("journal entry %d unexpectedly wrote pending_credential_custody: %+v", i, entry)
		}
	}
	wantStatuses := []runtimev1.ScenarioJobStatus{
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
	}
	for offset, wantStatus := range wantStatuses {
		entry := doc.entries[2+offset]
		if len(entry.Records) != 1 {
			t.Fatalf("steady-state entry[%d] record count = %d, want 1", offset, len(entry.Records))
		}
		gotStatus, gotRef := decodeJournalRecordStatusAndCustody(t, entry.Records[0].Record)
		if gotStatus != wantStatus {
			t.Fatalf("steady-state entry[%d] status = %s, want %s", offset, gotStatus, wantStatus)
		}
		if wantStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			if gotRef != "" {
				t.Fatalf("COMPLETED entry retained non-empty credential_custody_ref %q", gotRef)
			}
		} else if gotRef == "" {
			t.Fatalf("%s entry missing opaque credential_custody_ref", wantStatus)
		}
	}

	// Steady-state StreamScenario must also take exactly 3 writes and 0 secret writes.
	writesBefore := h.storeWrites.Load()
	secretWritesBefore, _, secretDeletesBefore := h.secrets.counts()
	stream := &mockScenarioEventStream{ctx: ctx}
	if err := h.fixture.service.StreamScenario(h.streamReq, stream); err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	if storeDelta := h.storeWrites.Load() - writesBefore; storeDelta != 3 {
		t.Fatalf("StreamScenario scenario-jobs.json writes = %d, want 3 (QUEUED, RUNNING, COMPLETED)", storeDelta)
	}
	secretWritesAfter, _, secretDeletesAfter := h.secrets.counts()
	if secretWritesAfter != secretWritesBefore || secretDeletesAfter != secretDeletesBefore {
		t.Fatalf("StreamScenario touched durable SecretStore: writes %d->%d deletes %d->%d",
			secretWritesBefore, secretWritesAfter, secretDeletesBefore, secretDeletesAfter)
	}
	if providerHits.Load() != 3 {
		t.Fatalf("provider hits = %d, want 3 (no automatic replay)", providerHits.Load())
	}

	// Restart observation: reopening the store reloads all 3 completed jobs with
	// exact captured inputs, empty custody ref, and zero replay.
	reopened, err := newScenarioJobStoreForLocalStatePath(h.localStatePath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	reopened.mu.RLock()
	if len(reopened.jobs) != 3 {
		reopened.mu.RUnlock()
		t.Fatalf("reopened jobs = %d, want 3", len(reopened.jobs))
	}
	for id, rec := range reopened.jobs {
		if rec.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			reopened.mu.RUnlock()
			t.Fatalf("reopened job %s status = %s, want COMPLETED", id, rec.job.GetStatus())
		}
		if rec.cloudAssembly == nil || rec.cloudAssembly.CredentialCustodyRef != "" {
			reopened.mu.RUnlock()
			t.Fatalf("reopened job %s assembly = %+v", id, rec.cloudAssembly)
		}
	}
	reopened.mu.RUnlock()
	if providerHits.Load() != 3 {
		t.Fatalf("reopen triggered replay: provider hits = %d, want 3", providerHits.Load())
	}
}

func TestSynchronousCloudReducedWritesPreserveCancellationRestartOutcomeAndRetention(t *testing.T) {
	t.Run("pre-dispatch cancel uses 2 writes and releases custody with 0 provider hits", func(t *testing.T) {
		var providerHits atomic.Int32
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, _ *http.Request) {
			providerHits.Add(1)
			w.WriteHeader(http.StatusOK)
		})
		h.fixture.service.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
		releaseBlocker, _, err := h.fixture.service.scheduler.Acquire(context.Background(), "other.app")
		if err != nil {
			t.Fatalf("acquire blocker: %v", err)
		}
		defer releaseBlocker()

		reqCtx, cancel := context.WithCancel(scenarioJobUserContext("app.cloud.write-budget", "user-001"))
		errCh := make(chan error, 1)
		go func() {
			_, execErr := h.fixture.service.ExecuteScenario(reqCtx, h.execReq)
			errCh <- execErr
		}()

		// Wait until the job is persisted in QUEUED before canceling.
		deadline := time.Now().Add(3 * time.Second)
		var jobID string
		for time.Now().Before(deadline) {
			h.store.mu.RLock()
			for id, rec := range h.store.jobs {
				if rec != nil && rec.job != nil && rec.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
					jobID = id
				}
			}
			h.store.mu.RUnlock()
			if jobID != "" {
				break
			}
			time.Sleep(time.Millisecond)
		}
		if jobID == "" {
			t.Fatal("queued immediate cloud job was not persisted before scheduler wait")
		}
		cancel()

		select {
		case execErr := <-errCh:
			if status.Code(execErr) != codes.Canceled {
				t.Fatalf("pre-dispatch cancel err = %v, want Canceled", execErr)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("canceled queued request did not exit")
		}
		if providerHits.Load() != 0 {
			t.Fatalf("pre-dispatch cancel hit provider %d times", providerHits.Load())
		}
		if got := h.storeWrites.Load(); got != 2 {
			t.Fatalf("pre-dispatch cancel writes = %d, want 2 (QUEUED, CANCELED)", got)
		}
		assembly, ok := h.store.cloudResolvedAssembly(jobID)
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("pre-dispatch canceled assembly = %+v ok=%v, want empty custody ref", assembly, ok)
		}
		expectedRef, err := connector.CredentialCustodyRefForJob(jobID)
		if err != nil {
			t.Fatal(err)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(expectedRef); err != nil || secret != "" {
			t.Fatalf("pre-dispatch canceled ephemeral custody = %q, err=%v; want released", secret, err)
		}
	})

	t.Run("exact captured input and credential survive connector deletion with 3 store writes and 0 secret writes", func(t *testing.T) {
		var sawAuth string
		var providerHits atomic.Int32
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, r *http.Request) {
			providerHits.Add(1)
			sawAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"captured-ok"},"finish_reason":"stop"}]}`))
		})
		h.fixture.service.SetRemoteTextExecutionHost(&deleteConnectorBeforeTextHost{
			store:       h.fixture.service.connStore,
			connectorID: h.fixture.connectorID,
			delegate:    h.fixture.service.remoteTextHost,
		})
		secretWritesBefore, _, _ := h.secrets.counts()
		ctx := scenarioJobUserContext("app.cloud.write-budget", "user-001")
		resp, err := h.fixture.service.ExecuteScenario(ctx, h.execReq)
		if err != nil || outputText(resp.GetOutput()) != "captured-ok" {
			t.Fatalf("ExecuteScenario after Connector deletion = %+v, err=%v", resp, err)
		}
		if sawAuth != "Bearer test-key" || providerHits.Load() != 1 {
			t.Fatalf("auth=%q hits=%d, want Bearer test-key and 1", sawAuth, providerHits.Load())
		}
		if got := h.storeWrites.Load(); got != 3 {
			t.Fatalf("writes = %d, want 3 (QUEUED, RUNNING, COMPLETED)", got)
		}
		secretWritesAfter, _, _ := h.secrets.counts()
		if secretWritesAfter != secretWritesBefore {
			t.Fatalf("immediate capture wrote to durable SecretStore: %d -> %d", secretWritesBefore, secretWritesAfter)
		}
		job := onlyScenarioJobForRestartTest(t, h.fixture.service)
		expectedRef, err := connector.CredentialCustodyRefForJob(job.GetJobId())
		if err != nil {
			t.Fatal(err)
		}
		if loaded, err := h.fixture.service.connStore.LoadCredentialCustody(expectedRef); err != nil || loaded != "" {
			t.Fatalf("released ephemeral custody = %q, err=%v; want empty", loaded, err)
		}
	})

	t.Run("post-dispatch client cancel preserves Canceled OUTCOME_UNCERTAIN and 3 writes", func(t *testing.T) {
		dispatched := make(chan struct{})
		release := make(chan struct{})
		var providerHits atomic.Int32
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, r *http.Request) {
			providerHits.Add(1)
			select {
			case <-dispatched:
			default:
				close(dispatched)
			}
			select {
			case <-release:
			case <-r.Context().Done():
			}
		})
		t.Cleanup(func() { close(release) })

		reqCtx, cancel := context.WithCancel(scenarioJobUserContext("app.cloud.write-budget", "user-001"))
		errCh := make(chan error, 1)
		go func() {
			_, execErr := h.fixture.service.ExecuteScenario(reqCtx, h.execReq)
			errCh <- execErr
		}()
		waitForRestartTestSignal(t, dispatched, "provider was not entered")
		cancel()

		select {
		case execErr := <-errCh:
			assertOutcomeUncertainError(t, execErr, runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED, runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED)
			if status.Code(execErr) != codes.Canceled {
				t.Fatalf("post-dispatch cancel code = %v, want Canceled", status.Code(execErr))
			}
		case <-time.After(3 * time.Second):
			t.Fatal("canceled running request did not exit")
		}
		if providerHits.Load() != 1 {
			t.Fatalf("provider hits = %d, want 1 (no replay)", providerHits.Load())
		}
		if got := h.storeWrites.Load(); got != 3 {
			t.Fatalf("post-dispatch cancel writes = %d, want 3 (QUEUED, RUNNING, CANCELED)", got)
		}
		job := onlyScenarioJobForRestartTest(t, h.fixture.service)
		if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			t.Fatalf("terminal status = %s, want CANCELED", job.GetStatus())
		}
		assembly, ok := h.store.cloudResolvedAssembly(job.GetJobId())
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("canceled terminal assembly = %+v ok=%v, want empty custody ref", assembly, ok)
		}
		expectedRef, err := connector.CredentialCustodyRefForJob(job.GetJobId())
		if err != nil {
			t.Fatal(err)
		}
		if loaded, err := h.fixture.service.connStore.LoadCredentialCustody(expectedRef); err != nil || loaded != "" {
			t.Fatalf("post-dispatch canceled ephemeral custody = %q, err=%v; want empty", loaded, err)
		}
	})

	t.Run("post-dispatch cancel and restart preserve OUTCOME_UNCERTAIN billing warning and single dispatch", func(t *testing.T) {
		dispatched := make(chan struct{})
		release := make(chan struct{})
		var providerHits atomic.Int32
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, r *http.Request) {
			providerHits.Add(1)
			select {
			case <-dispatched:
			default:
				close(dispatched)
			}
			select {
			case <-release:
			case <-r.Context().Done():
			}
		})
		t.Cleanup(func() { close(release) })

		shutdownCtx, shutdownSignal := rpcctx.WithShutdownSignal(scenarioJobUserContext("app.cloud.write-budget", "user-001"))
		reqCtx, cancel := context.WithCancel(shutdownCtx)
		errCh := make(chan error, 1)
		go func() {
			_, execErr := h.fixture.service.ExecuteScenario(reqCtx, h.execReq)
			errCh <- execErr
		}()
		waitForRestartTestSignal(t, dispatched, "provider was not entered")
		h.fixture.service.BeginRuntimeRestart()
		shutdownSignal.MarkServerShutdown()
		cancel()

		select {
		case execErr := <-errCh:
			assertOutcomeUncertainError(t, execErr, runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART, runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED)
		case <-time.After(3 * time.Second):
			t.Fatal("restarted request did not exit")
		}
		if providerHits.Load() != 1 {
			t.Fatalf("provider hits = %d, want 1 (no replay)", providerHits.Load())
		}
		if got := h.storeWrites.Load(); got != 3 {
			t.Fatalf("post-dispatch restart writes = %d, want 3 (QUEUED, RUNNING, FAILED)", got)
		}
		job := onlyScenarioJobForRestartTest(t, h.fixture.service)
		assembly, ok := h.store.cloudResolvedAssembly(job.GetJobId())
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("restarted terminal assembly = %+v ok=%v, want empty custody ref", assembly, ok)
		}
	})

	t.Run("crash while QUEUED or RUNNING recovers cleanly on restart without disk secret orphans", func(t *testing.T) {
		for _, crashStatus := range []runtimev1.ScenarioJobStatus{
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
		} {
			t.Run(crashStatus.String(), func(t *testing.T) {
				h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"unused"},"finish_reason":"stop"}]}`))
				})
				ctx := scenarioJobUserContext("app.cloud.write-budget", "user-001")
				effective, err := h.fixture.service.captureCloudTextEffectiveInputs(ctx, h.execReq.GetHead(), h.execReq, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
				if err != nil {
					t.Fatalf("captureCloudTextEffectiveInputs: %v", err)
				}
				defer effective.release()
				job, _, err := h.fixture.service.captureImmediateCloudScenarioJob(
					ctx, h.execReq.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
					runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly,
				)
				if err != nil {
					t.Fatalf("captureImmediateCloudScenarioJob: %v", err)
				}
				if crashStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
					if err := h.fixture.service.startImmediateScenarioJob(job.GetJobId()); err != nil {
						t.Fatalf("startImmediateScenarioJob: %v", err)
					}
				}
				// Simulate hard process crash: fresh store + fresh connector store
				// (ephemeral in-memory map lost with crashed process).
				reopenedStore, err := newScenarioJobStoreForLocalStatePath(h.localStatePath)
				if err != nil {
					t.Fatalf("reopen crashed store: %v", err)
				}
				restarted := &Service{
					scenarioJobs: reopenedStore,
					connStore:    connector.NewConnectorStoreWithSecretStore(t.TempDir(), h.secrets),
				}
				if err := restarted.releaseRecoveredTerminalCloudCredentialCustody(); err != nil {
					t.Fatalf("releaseRecoveredTerminalCloudCredentialCustody: %v", err)
				}
				recovered, ok := reopenedStore.get(job.GetJobId())
				if !ok || recovered.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
					recovered.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED ||
					recovered.GetInterruption().GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART {
					t.Fatalf("recovered job = %+v ok=%v", recovered, ok)
				}
				assembly, ok := reopenedStore.cloudResolvedAssembly(job.GetJobId())
				if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
					t.Fatalf("recovered assembly custody ref = %+v ok=%v, want cleared", assembly, ok)
				}
			})
		}
	})

	t.Run("completed immediate cloud job is immediately prunable on retention expiry and enforces quota", func(t *testing.T) {
		var providerHits atomic.Int32
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, _ *http.Request) {
			providerHits.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}`))
		})
		ctx := scenarioJobUserContext("app.cloud.write-budget", "user-001")
		if _, err := h.fixture.service.ExecuteScenario(ctx, h.execReq); err != nil {
			t.Fatalf("ExecuteScenario: %v", err)
		}
		job := onlyScenarioJobForRestartTest(t, h.fixture.service)
		now := time.Now().UTC()
		h.store.mu.Lock()
		rec := h.store.jobs[job.GetJobId()]
		rec.terminalAt = now.Add(-scenarioJobRetention - time.Minute)
		rec.updatedAt = rec.terminalAt
		rec.job.UpdatedAt = timestamppb.New(rec.terminalAt)
		h.store.pruneJobsLocked(now)
		_, stillPresent := h.store.jobs[job.GetJobId()]
		if stillPresent {
			h.store.mu.Unlock()
			t.Fatal("expired completed immediate cloud job was not pruned")
		}
		// Fill per-owner nonterminal quota and verify immediate cloud capture
		// fails closed without calling provider or leaking ephemeral custody.
		for i := 0; i < scenarioJobOwnerMaximumNonterminal; i++ {
			id := "quota-fill-" + time.Now().Format("150405.000000") + "-" + string(rune('a'+(i%26))) + string(rune('a'+(i/26)))
			h.store.jobs[id] = &scenarioJobRecord{
				job: &runtimev1.ScenarioJob{
					JobId: id,
					Head:  &runtimev1.ScenarioRequestHead{AppId: "app.cloud.write-budget", SubjectUserId: "user-001"},
					Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
				},
			}
		}
		h.store.mu.Unlock()
		hitsBefore := providerHits.Load()
		if _, err := h.fixture.service.ExecuteScenario(ctx, h.execReq); err == nil {
			t.Fatal("ExecuteScenario succeeded despite exhausted per-owner nonterminal quota")
		}
		if providerHits.Load() != hitsBefore {
			t.Fatalf("quota-rejected ExecuteScenario hit provider: %d -> %d", hitsBefore, providerHits.Load())
		}
	})

	t.Run("async cloud job still uses durable credential custody", func(t *testing.T) {
		fixture := newManagedCloudScenarioTestFixture(t, "openai", "gpt-image-1.5", "https://api.openai.com/v1", Config{})
		record, found, err := fixture.service.connStore.Get(fixture.connectorID)
		if err != nil || !found {
			t.Fatalf("load fixture Connector: found=%v err=%v", found, err)
		}
		secrets := newCountingCustodySecretStore()
		connStore := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secrets)
		if _, err := connStore.Create(record, "test-key"); err != nil {
			t.Fatalf("create counted Connector: %v", err)
		}
		fixture.service.connStore = connStore
		store, _ := newDurableScenarioJobStoreForFailureTest(t)
		fixture.service.scenarioJobs = store
		host := newControlledRemoteMediaHost(false)
		fixture.service.SetRemoteMediaExecutionHost(host)

		writesBefore, _, deletesBefore := secrets.counts()
		ctx := withCloudScenarioTestIntent(scenarioJobUserContext("nimi.desktop", "user-001"), capabilitydriver.StableDiffusionCapabilityContract, fixture.targetRef)
		submitted, err := fixture.service.SubmitScenarioJob(ctx, cloudImageJobRequest("async durable custody"))
		if err != nil {
			t.Fatalf("SubmitScenarioJob: %v", err)
		}
		<-host.started
		writesDuring, _, _ := secrets.counts()
		if writesDuring != writesBefore+1 {
			t.Fatalf("ASYNC_JOB SecretStore writes = %d, want +1 durable custody write", writesDuring-writesBefore)
		}
		close(host.release)
		waitScenarioJobTerminal(t, fixture.service, submitted.GetJob().GetJobId(), 3*time.Second)
		waitCompletedScenarioJobCleanup(t, fixture.service, submitted.GetJob().GetJobId())
		_, _, deletesAfter := secrets.counts()
		if deletesAfter < deletesBefore+1 {
			t.Fatalf("ASYNC_JOB SecretStore deletes = %d, want at least +1 durable custody delete", deletesAfter-deletesBefore)
		}
	})
}

func TestImmediateCloudEphemeralCustodyReleasedAcrossAllTerminationPaths(t *testing.T) {
	newHarness := func(t *testing.T) (*syncCloudWriteAuditHarness, context.Context, *cloudTextEffectiveInputs) {
		t.Helper()
		h := newSyncCloudWriteAuditHarness(t, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"unused"},"finish_reason":"stop"}]}`))
		})
		ctx := scenarioJobUserContext("app.cloud.write-budget", "user-001")
		effective, err := h.fixture.service.captureCloudTextEffectiveInputs(ctx, h.execReq.GetHead(), h.execReq, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC)
		if err != nil {
			t.Fatalf("captureCloudTextEffectiveInputs: %v", err)
		}
		t.Cleanup(effective.release)
		return h, ctx, effective
	}

	t.Run("failJobWorkAuthority releases ephemeral custody and clears ref", func(t *testing.T) {
		h, ctx, effective := newHarness(t)
		job, _, err := h.fixture.service.captureImmediateCloudScenarioJob(
			ctx, h.execReq.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly,
		)
		if err != nil {
			t.Fatalf("captureImmediateCloudScenarioJob: %v", err)
		}
		defer h.fixture.service.finishScenarioJobExecution(job.GetJobId())
		ref, err := connector.CredentialCustodyRefForJob(job.GetJobId())
		if err != nil {
			t.Fatal(err)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret == "" {
			t.Fatalf("expected active ephemeral custody before failJobWorkAuthority: secret=%q err=%v", secret, err)
		}

		h.store.failJobWorkAuthority(job.GetJobId(), grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN))

		failed, ok := h.store.get(job.GetJobId())
		if !ok || failed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
			t.Fatalf("job after failJobWorkAuthority = %+v ok=%v", failed, ok)
		}
		assembly, ok := h.store.cloudResolvedAssembly(job.GetJobId())
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("assembly after failJobWorkAuthority = %+v ok=%v, want empty custody ref", assembly, ok)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret != "" {
			t.Fatalf("ephemeral custody leaked after failJobWorkAuthority: secret=%q err=%v", secret, err)
		}
	})

	t.Run("retryPendingTerminal via GetScenarioJob releases ephemeral custody after transient failure", func(t *testing.T) {
		h, ctx, effective := newHarness(t)
		var failTerminal atomic.Bool
		h.store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
			if failTerminal.Load() && attempt.Operation == scenarioJobPersistTransition && attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
				return errors.New("injected transient terminal persistence failure")
			}
			return nil
		}
		job, _, err := h.fixture.service.captureImmediateCloudScenarioJob(
			ctx, h.execReq.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly,
		)
		if err != nil {
			t.Fatalf("captureImmediateCloudScenarioJob: %v", err)
		}
		ref, err := connector.CredentialCustodyRefForJob(job.GetJobId())
		if err != nil {
			t.Fatal(err)
		}
		failTerminal.Store(true)
		h.fixture.service.finishCloudScenarioJobFailure(ctx, job.GetJobId(), grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE))
		h.fixture.service.finishScenarioJobExecution(job.GetJobId())

		// While terminal persistence is still pending, custody stays intact for retry.
		if current, _ := h.store.get(job.GetJobId()); isTerminalScenarioJobStatus(current.GetStatus()) {
			t.Fatalf("expected nonterminal job with pendingTerminal, got %s", current.GetStatus())
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret == "" {
			t.Fatalf("custody released before pendingTerminal committed: secret=%q err=%v", secret, err)
		}

		failTerminal.Store(false)
		resp, err := h.fixture.service.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
		if err != nil || resp.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
			t.Fatalf("GetScenarioJob retryPendingTerminal = %+v err=%v", resp, err)
		}
		assembly, ok := h.store.cloudResolvedAssembly(job.GetJobId())
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("assembly after retryPendingTerminal = %+v ok=%v, want empty custody ref", assembly, ok)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret != "" {
			t.Fatalf("ephemeral custody leaked after retryPendingTerminal: secret=%q err=%v", secret, err)
		}
	})

	t.Run("requestCancel when !executionStarted releases ephemeral custody and clears ref", func(t *testing.T) {
		h, ctx, effective := newHarness(t)
		job, _, err := h.fixture.service.prepareCloudScenarioJobWithOptions(
			ctx, h.execReq.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, true,
		)
		if err != nil {
			t.Fatalf("prepareCloudScenarioJobWithOptions: %v", err)
		}
		ref, err := connector.CredentialCustodyRefForJob(job.GetJobId())
		if err != nil {
			t.Fatal(err)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret == "" {
			t.Fatalf("expected active ephemeral custody before CancelScenarioJob: secret=%q err=%v", secret, err)
		}

		canceled, err := h.fixture.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{
			JobId:  job.GetJobId(),
			Reason: "canceled before startExecution",
		})
		if err != nil || canceled.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			t.Fatalf("CancelScenarioJob = %+v err=%v", canceled, err)
		}
		assembly, ok := h.store.cloudResolvedAssembly(job.GetJobId())
		if !ok || assembly == nil || assembly.CredentialCustodyRef != "" {
			t.Fatalf("assembly after unstarted requestCancel = %+v ok=%v, want empty custody ref", assembly, ok)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret != "" {
			t.Fatalf("ephemeral custody leaked after unstarted requestCancel: secret=%q err=%v", secret, err)
		}
	})

	t.Run("captureImmediateCloudScenarioJob when !startExecution on runtimeStopping cancels context and releases ephemeral custody", func(t *testing.T) {
		h, ctx, effective := newHarness(t)
		h.store.durable.contentWritten = func(int) {
			h.storeWrites.Add(1)
			// Flip runtimeStopping right after the QUEUED job commits and before
			// captureImmediateCloudScenarioJob calls startExecution.
			h.store.runtimeStopping.Store(true)
		}

		job, jobCtx, err := h.fixture.service.captureImmediateCloudScenarioJob(
			ctx, h.execReq.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly,
		)
		if err == nil || status.Code(err) != codes.Canceled || job != nil || jobCtx != nil {
			t.Fatalf("captureImmediateCloudScenarioJob on runtimeStopping = job:%v ctx:%v err:%v, want Canceled", job, jobCtx, err)
		}

		h.store.mu.RLock()
		if len(h.store.jobs) != 1 {
			h.store.mu.RUnlock()
			t.Fatalf("expected 1 persisted QUEUED job, got %d", len(h.store.jobs))
		}
		var jobID string
		var cancelStillSet bool
		for id, rec := range h.store.jobs {
			jobID = id
			cancelStillSet = rec.cancel != nil
		}
		h.store.mu.RUnlock()
		if cancelStillSet {
			t.Fatal("unstarted immediate job left record.cancel uncleaned")
		}
		ref, err := connector.CredentialCustodyRefForJob(jobID)
		if err != nil {
			t.Fatal(err)
		}
		if secret, err := h.fixture.service.connStore.LoadCredentialCustody(ref); err != nil || secret != "" {
			t.Fatalf("ephemeral custody leaked after !startExecution on runtimeStopping: secret=%q err=%v", secret, err)
		}
	})
}
