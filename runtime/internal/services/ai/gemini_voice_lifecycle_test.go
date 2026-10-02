package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/remoteexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type heldKnownVoiceHost struct {
	remoteexecution.MediaHost
	known  chan struct{}
	resume chan struct{}
}

func (h *heldKnownVoiceHost) ExecuteVoiceWorkflow(ctx context.Context, c connector.ConnectorRecord, target capabilitydriver.CloudMediaTarget, request *capabilitydriver.CloudVoiceWorkflowMappedRequest, audit remoteexecution.MediaDispatchAudit) (capabilitydriver.CloudVoiceWorkflowTransportResponse, error) {
	result, err := h.MediaHost.ExecuteVoiceWorkflow(ctx, c, target, request, audit)
	close(h.known)
	<-h.resume
	return result, err
}

func TestGeminiKnownVoiceCancellationAndPrimaryCommitFailureCleanProviderAndPreview(t *testing.T) {
	for _, mode := range []string{"cancel-after-provider-success", "primary-commit-failure"} {
		t.Run(mode, func(t *testing.T) {
			var deletes atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodDelete {
					deletes.Add(1)
					w.WriteHeader(http.StatusNoContent)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"id": "voice_unpublished", "type": "prompted", "model": "models/gemini-3.8-flash-tts", "expire_time": time.Now().UTC().Add(365 * 24 * time.Hour).Format(time.RFC3339Nano), "sample_audio": map[string]any{"mime_type": "audio/wav", "data": base64.StdEncoding.EncodeToString(mediaBudgetTestWAV())}})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash-tts", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
			svc := f.service
			host := &heldKnownVoiceHost{MediaHost: svc.remoteMediaHost, known: make(chan struct{}), resume: make(chan struct{})}
			svc.remoteMediaHost = host
			if mode == "primary-commit-failure" {
				store, _ := newDurableScenarioJobStoreForFailureTest(t)
				store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
					if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
						return errors.New("primary voice result unavailable")
					}
					return nil
				}
				svc.scenarioJobs = store
			}
			ctx := withCloudScenarioTestIntent(scenarioJobUserContext("app-1", "user-001"), "voice.create", f.targetRef)
			submitted, err := svc.SubmitScenarioJob(ctx, geminiVoiceTestRequest())
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-host.known:
			case <-time.After(3 * time.Second):
				t.Fatal("provider response not captured")
			}
			if mode == "cancel-after-provider-success" {
				if _, err := svc.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: submitted.GetJob().GetJobId()}); err != nil {
					t.Fatal(err)
				}
			}
			close(host.resume)
			job := waitVoiceWorkflowExecutionForTest(t, svc, submitted.GetJob().GetJobId())
			if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 0 || deletes.Load() != 1 {
				t.Fatalf("unpublished result leaked: status=%v artifacts=%d deletes=%d", job.GetStatus(), len(job.GetArtifacts()), deletes.Load())
			}
			if _, ok := svc.voiceAssets.getAsset(job.GetJobId()); ok || len(svc.voiceAssets.pending) != 0 {
				t.Fatal("unpublished resource survived successful cleanup")
			}
		})
	}
}

func TestUnpublishedVoiceCleanupIsSerializedAndLateFailureCannotRecreateSuccess(t *testing.T) {
	store := newVoiceAssetStore()
	draft := testProviderPersistentVoiceDraft("voice-concurrent")
	target := testVoiceAssetCloudTarget("connector-voice")
	binding := testVoiceAssetCloudBinding(target)
	if err := store.stageKnownVoiceResult(draft, target, binding, "known-handle"); err != nil {
		t.Fatal(err)
	}
	asset, _, _, _ := store.unpublishedVoiceBinding(draft.GetVoiceAssetId())
	release, ok := store.claimVoiceDelete(asset.GetVoiceAssetId())
	if !ok {
		t.Fatal("first retry not admitted")
	}
	if _, ok := store.claimVoiceDelete(asset.GetVoiceAssetId()); ok {
		t.Fatal("concurrent provider cleanup was admitted")
	}
	done := make(chan struct{})
	late := make(chan error, 1)
	go func() {
		<-done
		late <- store.finishUnpublishedCleanup(asset, target, binding, voiceAssetDeleteResult{Attempted: true, PendingReconciliation: true, LastError: "late 503"})
	}()
	if err := store.finishUnpublishedCleanup(asset, target, binding, voiceAssetDeleteResult{Attempted: true, Succeeded: true}); err != nil {
		t.Fatal(err)
	}
	release()
	close(done)
	if err := <-late; err != nil {
		t.Fatal(err)
	}
	if _, _, _, ok := store.unpublishedVoiceBinding(asset.GetVoiceAssetId()); ok || len(store.pending) != 0 {
		t.Fatal("late failure recreated successfully cleaned resource")
	}
	// Published deletion obeys the same irreversible provider-success fact.
	if _, ok := store.publishResult(draft, target, binding, "published-handle", nil, func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool { return true }); !ok {
		t.Fatal("publish test asset")
	}
	if _, err := store.deleteAssetWithResult(draft.GetVoiceAssetId(), voiceAssetDeleteResult{Attempted: true, Succeeded: true}); err != nil {
		t.Fatal(err)
	}
	store.updateAssetDeleteResult(draft.GetVoiceAssetId(), voiceAssetDeleteResult{Attempted: true, PendingReconciliation: true, LastError: "late 503"})
	published, _ := store.getAsset(draft.GetVoiceAssetId())
	if !published.GetMetadata().GetFields()["provider_delete_succeeded"].GetBoolValue() || published.GetMetadata().GetFields()["provider_delete_reconciliation_pending"].GetBoolValue() {
		t.Fatal("late public delete failure reverted provider success")
	}
}

func TestUnpublishedListRetryKeepsCancellationWhileJobCleanupRemainsIndependent(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusNoContent) }))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash-tts", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
	svc := f.service
	draft := testProviderPersistentVoiceDraft("voice-canceled-list")
	draft.Provider = "gemini"
	draft.SubjectUserId = "user-001"
	draft.Metadata = structFromMap(map[string]any{"workflow_model_id": "gemini-3.8-flash-tts", "voice_handle_policy_delete_semantics": "best_effort_provider_delete", "voice_handle_policy_runtime_reconciliation_required": true})
	binding := testVoiceAssetCloudBinding(f.targetRef)
	binding.Implementation = &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.voice.create.gemini", DriverId: "nimi.runtime.driver.gemini", DriverDialect: "provider/media-v1"}
	if err := svc.voiceAssets.stageKnownVoiceResult(draft, f.targetRef, binding, "voice_canceled_list"); err != nil {
		t.Fatal(err)
	}
	private, _, _, _ := svc.voiceAssets.unpublishedVoiceBinding(draft.GetVoiceAssetId())
	private.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_DELETED
	svc.voiceAssets.assets[draft.GetVoiceAssetId()] = private
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	svc.reconcileUnpublishedVoiceDeletes(ctx, "app-1", "user-001", 8)
	if calls.Load() != 0 {
		t.Fatal("canceled List detached and contacted provider")
	}
	svc.cleanupUnpublishedVoiceResult(ctx, draft.GetVoiceAssetId(), draft, f.targetRef, binding, "voice_canceled_list")
	if calls.Load() != 1 || len(svc.voiceAssets.pending) != 0 {
		t.Fatalf("job cancellation blocked ownership cleanup: calls=%d", calls.Load())
	}
}

func geminiVoiceTestRequest() *runtimev1.SubmitScenarioJobRequest {
	r := voiceTextDescriptionRequest()
	r.Head.SubjectUserId = "user-001"
	r.GetSpec().GetVoiceCreate().TargetModelId = "gemini-3.8-flash-tts"
	r.GetSpec().GetVoiceCreate().GetTextDescription().PreviewText = ""
	return r
}

func waitVoiceWorkflowExecutionForTest(t *testing.T, svc *Service, id string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, _ := svc.scenarioJobs.get(id)
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			// Cleanup belongs to execution completion, after the primary terminal
			// state. Wait for the worker rather than racing its deferred cleanup.
			svc.scenarioJobs.mu.RLock()
			record := svc.scenarioJobs.jobs[id]
			active := record.executionStarted
			svc.scenarioJobs.mu.RUnlock()
			if !active {
				return job
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("voice worker did not finish")
	return nil
}

func TestGeminiVoicePublishesPreviewExpiryAndRefreshesProviderRenewal(t *testing.T) {
	expires := time.Now().UTC().Add(365 * 24 * time.Hour)
	var reads, deletes atomic.Int32
	getStatus := atomic.Int32{}
	getStatus.Store(http.StatusOK)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Error("native credential header changed")
		}
		if r.Method == http.MethodDelete {
			deletes.Add(1)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodGet {
			reads.Add(1)
			if code := int(getStatus.Load()); code != http.StatusOK {
				w.WriteHeader(code)
				return
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "voice_lifecycle", "type": "prompted", "model": "models/gemini-3.8-flash-tts", "expire_time": expires.Format(time.RFC3339Nano),
			"sample_audio": map[string]any{"mime_type": "audio/wav", "data": base64.StdEncoding.EncodeToString(mediaBudgetTestWAV())},
			"usage":        map[string]any{"total_input_tokens": 0, "total_output_tokens": 4},
		})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash-tts", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
	svc := f.service
	localState := filepath.Join(t.TempDir(), "local-state.json")
	var err error
	svc.voiceAssets, err = newVoiceAssetStoreForLocalStatePath(localState)
	if err != nil {
		t.Fatal(err)
	}
	req := geminiVoiceTestRequest()
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("app-1", "user-001"), "voice.create", f.targetRef)
	submitted, err := svc.SubmitScenarioJob(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	job := waitVoiceWorkflowExecutionForTest(t, svc, submitted.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || job.GetUsage() == nil || job.GetUsage().GetInputTokens() != 0 || job.GetUsage().GetOutputTokens() != 4 {
		t.Fatalf("incomplete terminal result: %+v", job)
	}
	result, err := svc.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatal(err)
	}
	asset := result.GetAsset()
	if asset == nil || !asset.GetExpiresAt().AsTime().Equal(expires) {
		t.Fatalf("provider expiry lost: %+v", asset)
	}
	art := job.GetArtifacts()[0]
	if art.GetSha256() == "" || len(art.GetBytes()) != 0 {
		t.Fatalf("preview bypassed Runtime custody: %+v", art)
	}
	if _, ok := svc.runtimeArtifacts.Get(art.GetArtifactId()); !ok {
		t.Fatal("preview body not stored")
	}
	if deletes.Load() != 0 {
		t.Fatal("published handle was cleaned up")
	}
	expires = expires.Add(24 * time.Hour)
	updated, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.GetAsset().GetExpiresAt().AsTime().Equal(expires) || reads.Load() != 1 {
		t.Fatal("Get failed to retain provider renewal")
	}
	getStatus.Store(http.StatusServiceUnavailable)
	_, err = svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()})
	if err == nil {
		t.Fatal("unavailable inspection became a successful read")
	}
	preserved, _ := svc.voiceAssets.getAsset(asset.GetVoiceAssetId())
	if !proto.Equal(preserved, updated.GetAsset()) {
		t.Fatal("failed inspection changed provider facts")
	}
	getStatus.Store(http.StatusNotFound)
	missing, err := svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()})
	if err != nil || missing.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED {
		t.Fatalf("confirmed absence was not expired: %+v %v", missing, err)
	}
	reopened, err := newVoiceAssetStoreForLocalStatePath(localState)
	if err != nil {
		t.Fatal(err)
	}
	durable, _ := reopened.getAsset(asset.GetVoiceAssetId())
	if durable.GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED || !durable.GetExpiresAt().AsTime().Equal(expires) {
		t.Fatal("expiry state not durable")
	}
}

func TestGeminiKnownInvalidPreviewCleanupFailureStaysPrivateAcrossRestart(t *testing.T) {
	var deletes atomic.Int32
	deleteStatus := atomic.Int32{}
	deleteStatus.Store(http.StatusServiceUnavailable)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			deletes.Add(1)
			w.WriteHeader(int(deleteStatus.Load()))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "voice_failed_preview", "type": "prompted", "model": "models/gemini-3.8-flash-tts", "expire_time": time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339Nano), "sample_audio": map[string]any{"mime_type": "audio/wav", "data": "invalid"}})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-3.8-flash-tts", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
	svc := f.service
	state := filepath.Join(t.TempDir(), "local-state.json")
	var err error
	svc.voiceAssets, err = newVoiceAssetStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("app-1", "user-001"), "voice.create", f.targetRef)
	submitted, err := svc.SubmitScenarioJob(ctx, geminiVoiceTestRequest())
	if err != nil {
		t.Fatal(err)
	}
	job := waitVoiceWorkflowExecutionForTest(t, svc, submitted.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || len(job.GetArtifacts()) != 0 {
		t.Fatalf("failed preview published success: %+v", job)
	}
	if deletes.Load() != 1 {
		t.Fatalf("known handle cleanup attempts=%d", deletes.Load())
	}
	if _, ok := svc.voiceAssets.getAsset(job.GetJobId()); ok {
		t.Fatal("failed voice became public")
	}
	svc.voiceAssets, err = newVoiceAssetStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.voiceAssets.reconcilePendingPublications(svc.scenarioJobs); err != nil {
		t.Fatal(err)
	}
	private, _, _, ok := svc.voiceAssets.unpublishedVoiceBinding(job.GetJobId())
	if !ok || private.GetProviderVoiceRef() != "voice_failed_preview" {
		t.Fatal("restart lost private cleanup resource")
	}
	private.Metadata.Fields["provider_delete_next_retry_at"].Kind = &structpb.Value_StringValue{StringValue: time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)}
	svc.voiceAssets.assets[job.GetJobId()] = private
	deleteStatus.Store(http.StatusNoContent)
	svc.reconcileUnpublishedVoiceDeletes(ctx, "app-1", "user-001", 1)
	if deletes.Load() != 2 || len(svc.voiceAssets.pending) != 0 {
		t.Fatalf("cleanup did not converge: calls=%d pending=%d", deletes.Load(), len(svc.voiceAssets.pending))
	}
	_, err = svc.GetVoiceAsset(ctx, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: job.GetJobId()})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_AI_VOICE_ASSET_NOT_FOUND {
		t.Fatalf("private failed voice was exposed: %v", err)
	}
}
