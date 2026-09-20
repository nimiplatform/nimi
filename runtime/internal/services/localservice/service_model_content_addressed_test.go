package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// E08: two equivalent catalog acquisitions. The second one meets the first's
// active writer, ends as a typed in-progress conflict naming the first
// transfer, and never creates a second prefix. After the first commits, an
// explicit retry commits a reused result against the same asset.
func TestConcurrentEquivalentDownloadsYieldTypedInProgressConflict(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	release := make(chan struct{})
	firstStarted := make(chan struct{}, 1)
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requests, 1) == 1 {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload[:16])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			firstStarted <- struct{}{}
			<-release
			_, _ = w.Write(payload[16:])
			return
		}
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	spec := managedDownloadedModelSpec{
		modelID: "local/concurrent", capabilities: []string{"text.embed"}, entry: "model.gguf", files: []string{"model.gguf"},
		repo: "owner/repo", revision: "main", hashes: map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
	}
	type outcome struct {
		asset      *runtimev1.ModelAssetRecord
		transferID string
		err        error
	}
	first := make(chan outcome, 1)
	go func() {
		asset, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
		first <- outcome{asset: asset, transferID: transferID, err: err}
	}()
	<-firstStarted

	_, secondTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	var conflict *modelObjectConflict
	if !errors.As(err, &conflict) || conflict.Kind != modelObjectConflictInProgress {
		close(release)
		t.Fatalf("second acquisition error = %v, want in-progress conflict", err)
	}
	rpcErr := modelInstallRPCError(err)
	if reason, ok := grpcerr.ExtractReasonCode(rpcErr); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_TRANSFER_IN_PROGRESS {
		close(release)
		t.Fatalf("second acquisition reason = %v", rpcErr)
	}
	secondSummary := svc.localTransferSummary(secondTransfer)
	if secondSummary.GetState() != localTransferStateFailed || secondSummary.GetRetryable() || secondSummary.GetRelatedInstallSessionId() != conflict.RelatedTransferID {
		close(release)
		t.Fatalf("second transfer summary = %+v", secondSummary)
	}
	if actions := secondSummary.GetAvailableActions(); len(actions) == 0 || actions[0] != runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_VIEW_RELATED_TRANSFER {
		close(release)
		t.Fatalf("second transfer actions = %v", actions)
	}
	if _, err := os.Stat(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), secondTransfer)); !os.IsNotExist(err) {
		close(release)
		t.Fatalf("conflicting acquisition left a second prefix: %v", err)
	}
	close(release)
	firstOutcome := <-first
	if firstOutcome.err != nil {
		t.Fatalf("first acquisition: %v", firstOutcome.err)
	}
	if conflict.RelatedTransferID != firstOutcome.transferID {
		t.Fatalf("conflict named %q, want the active transfer %q", conflict.RelatedTransferID, firstOutcome.transferID)
	}
	retried, retriedTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	if err != nil || retried.GetModelAssetId() != firstOutcome.asset.GetModelAssetId() {
		t.Fatalf("retry after conflict = %+v err=%v", retried, err)
	}
	if svc.localTransferSummary(retriedTransfer).GetDisposition() != runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED {
		t.Fatal("retry after conflict did not report reused")
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("payload requests = %d, want 1", got)
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("inventory count = %d, want 1", len(svc.modelAssets))
	}
}

// E12: a new acquisition that needs a digest whose durable prefix belongs to
// a retryable-failed transfer is refused with resume-required; resuming the
// original transfer completes it, and the later retry reuses the asset.
func TestNewAcquisitionAgainstRetryablePrefixRequiresResume(t *testing.T) {
	svc := newTestService(t)
	svc.modelDownloadMaxAttempts = 1
	payload := []byte(strings.Repeat("resume-required-payload", 2048))
	sum := sha256.Sum256(payload)
	var requests int32
	var rangeStart int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requests, 1) == 1 {
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload[:4096])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Error("hijack unsupported")
				return
			}
			conn, _, err := hijacker.Hijack()
			if err != nil {
				t.Errorf("hijack: %v", err)
				return
			}
			_ = conn.Close()
			return
		}
		if raw := strings.TrimSpace(r.Header.Get("Range")); raw != "" {
			start, _ := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(raw, "bytes="), "-"), 10, 64)
			atomic.StoreInt64(&rangeStart, start)
		}
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	spec := managedDownloadFailureSpec("local.test.resume-required", hex.EncodeToString(sum[:]))
	if _, firstTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, ""); err == nil {
		t.Fatal("expected the interrupted download to fail")
	} else if summary := svc.localTransferSummary(firstTransfer); summary.GetState() != localTransferStateFailed || !summary.GetRetryable() {
		t.Fatalf("interrupted transfer = %+v", summary)
	}
	firstTransfer := transferForAssetForTest(t, svc, "local.test.resume-required")

	_, secondTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	var conflict *modelObjectConflict
	if !errors.As(err, &conflict) || conflict.Kind != modelObjectConflictResumeRequired || conflict.RelatedTransferID != firstTransfer.GetInstallSessionId() {
		t.Fatalf("new acquisition against prefix = %v, want resume-required naming %q", err, firstTransfer.GetInstallSessionId())
	}
	if reason, ok := grpcerr.ExtractReasonCode(modelInstallRPCError(err)); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_TRANSFER_RESUME_REQUIRED {
		t.Fatalf("resume-required reason = %v", modelInstallRPCError(err))
	}
	if _, err := os.Stat(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), secondTransfer)); !os.IsNotExist(err) {
		t.Fatalf("refused acquisition created a second prefix: %v", err)
	}
	response, err := svc.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: firstTransfer.GetInstallSessionId()})
	if err != nil || response.GetTransfer().GetState() != localTransferStateRunning {
		t.Fatalf("resume original = %+v err=%v", response, err)
	}
	waitTransferStateForTest(t, svc, firstTransfer.GetInstallSessionId(), localTransferStateCompleted)
	completed := svc.localTransferSummary(firstTransfer.GetInstallSessionId())
	if completed.GetDisposition() != runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED || completed.GetAssetId() == "" {
		t.Fatalf("resumed original result = %+v", completed)
	}
	if got := atomic.LoadInt64(&rangeStart); got != 4096 {
		t.Fatalf("resume Range start = %d, want the original prefix 4096", got)
	}
	retried, retriedTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	if err != nil || retried.GetModelAssetId() != completed.GetAssetId() {
		t.Fatalf("retry after resume = %+v err=%v", retried, err)
	}
	if svc.localTransferSummary(retriedTransfer).GetDisposition() != runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_REUSED {
		t.Fatal("retry after resume did not report reused")
	}
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Fatalf("payload requests = %d, want the initial fetch and one resume", got)
	}
}

// E10: a durable cancel persisted before the created commit point wins; the
// commit never enters inventory and the uncommitted view is discarded.
func TestDurableCancelBeforeCommitPreventsCreatedResult(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	var cancelledTransfer string
	svc.writeModelAssetManifest = func(path string, payloadBytes []byte) error {
		// The view is complete; a durable cancel lands before the inventory
		// commit. Every later commit attempt must observe it.
		svc.mu.Lock()
		for id, private := range svc.transferPrivate {
			if private.commitIntent != nil {
				private.cancelRequested = true
				cancelledTransfer = id
			}
		}
		err := svc.persistStateLocked()
		svc.mu.Unlock()
		if err != nil {
			return err
		}
		return writeFileAtomically(path, payloadBytes, 0o600)
	}
	_, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), managedDownloadFailureSpec("local.test.cancel-race", hex.EncodeToString(sum[:])), "")
	if !errors.Is(err, errLocalTransferCancelled) {
		t.Fatalf("install racing a durable cancel = %v, want cancelled", err)
	}
	if cancelledTransfer != transferID {
		t.Fatalf("cancel targeted %q, want %q", cancelledTransfer, transferID)
	}
	if len(svc.modelAssets) != 0 {
		t.Fatalf("cancelled acquisition entered inventory: %d", len(svc.modelAssets))
	}
	entries, _ := os.ReadDir(filepath.Join(svc.resolvedLocalModelsPath(), "resolved"))
	if len(entries) != 0 {
		t.Fatalf("cancelled acquisition left a view: %v", entries)
	}
	summary := svc.localTransferSummary(transferID)
	if summary.GetState() != localTransferStateCancelled || summary.GetAssetId() != "" {
		t.Fatalf("cancelled transfer summary = %+v", summary)
	}
}

// E22: the inventory commit succeeded but the transfer's result never became
// durable. After a restart the durable create intent is reconciled against
// the committed asset and annotated as created; nothing is re-acquired.
func TestRestartReconcilesCommittedCreateIntentAsCreatedResult(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	statePath := svc.stateStorePath
	var frozenState []byte
	svc.writeModelAssetManifest = func(path string, payloadBytes []byte) error {
		// The create intent is already durable. Freeze the state document at
		// this point and make later state saves fail, like a crash between the
		// inventory save and the transfer result save.
		current, err := os.ReadFile(statePath)
		if err != nil {
			return err
		}
		frozenState = current
		if err := os.Remove(statePath); err != nil {
			return err
		}
		if err := os.Mkdir(statePath, 0o700); err != nil {
			return err
		}
		return writeFileAtomically(path, payloadBytes, 0o600)
	}
	asset, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), managedDownloadFailureSpec("local.test.intent-restart", hex.EncodeToString(sum[:])), "")
	if err != nil || asset == nil {
		t.Fatalf("install with failing result persistence = %+v err=%v", asset, err)
	}
	if len(svc.modelAssets) != 1 {
		t.Fatalf("committed asset missing from inventory: %d", len(svc.modelAssets))
	}
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	svc.Close()
	if err := os.RemoveAll(statePath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, frozenState, 0o600); err != nil {
		t.Fatal(err)
	}
	var frozen localStateSnapshot
	if err := json.Unmarshal(frozenState, &frozen); err != nil {
		t.Fatal(err)
	}
	var row *localStateTransferState
	for index := range frozen.Transfers {
		if frozen.Transfers[index].InstallSessionID == transferID {
			row = &frozen.Transfers[index]
		}
	}
	if row == nil || row.CommitIntent == nil || row.CommitIntent.ModelAssetID != asset.GetModelAssetId() || row.State == localTransferStateCompleted {
		t.Fatalf("frozen transfer row = %+v, want a durable create intent before completion", row)
	}

	restored, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	defer restored.Close()
	restored.OpenModelAssetReclamation()
	summary := restored.localTransferSummary(transferID)
	if summary.GetState() != localTransferStateCompleted || summary.GetAssetId() != asset.GetModelAssetId() || summary.GetDisposition() != runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED {
		t.Fatalf("reconciled transfer = %+v", summary)
	}
	if len(restored.modelAssets) != 1 {
		t.Fatalf("restart changed inventory: %d", len(restored.modelAssets))
	}
	if _, err := restored.GetModelAsset(context.Background(), &runtimev1.GetModelAssetRequest{ModelAssetId: asset.GetModelAssetId()}); err != nil {
		t.Fatalf("committed asset unavailable after restart: %v", err)
	}
}

// E11/E21: an import interrupted after its complete managed view existed but
// before the inventory commit becomes paused in commit_pending with only
// check_sync and cancel; Check & Sync commits the original target through the
// transfer's result, and no second identity is minted.
func TestRestartedImportWithCompleteViewCommitsThroughCheckSync(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "commit-pending.bin")
	if err := os.WriteFile(source, []byte("commit pending payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "commit-pending")
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	files := make([]modelDistributionFile, 0)
	for _, file := range asset.GetFiles() {
		files = append(files, modelDistributionFile{RelativePath: file.GetRelativePath(), SHA256: file.GetSha256(), SizeBytes: file.GetSizeBytes(), NonExecutableContent: file.GetNonExecutableContent()})
	}
	// Rewind history to "view complete, inventory not committed": drop the
	// inventory row and persist a running import transfer carrying the intent.
	forgetModelAssetInventoryForTest(t, svc, asset.GetModelAssetId())
	transfer := newImportTransferForTest(t, svc, modelAssetSource{Path: source, DisplayName: "commit-pending", SizeBytes: 22})
	svc.mu.Lock()
	private := svc.transferPrivateLocked(transfer.GetInstallSessionId())
	private.commitIntent = &localTransferCommitIntent{Kind: "create", ModelAssetID: asset.GetModelAssetId(), ManagedDirectory: directory, Generation: asset.GetCreatedAt(), Entry: asset.GetEntry(), Files: files}
	if err := svc.persistStateLocked(); err != nil {
		svc.mu.Unlock()
		t.Fatal(err)
	}
	svc.mu.Unlock()
	statePath := svc.stateStorePath
	modelsRoot := svc.resolvedLocalModelsPath()
	runtimeRoot := svc.runtimeDataRoot
	svc.Close()

	restored, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	defer restored.Close()
	restored.OpenModelAssetReclamation()
	pending := restored.localTransferSummary(transfer.GetInstallSessionId())
	if pending.GetState() != localTransferStatePaused || pending.GetPhase() != localTransferCommitPendingPhase {
		t.Fatalf("restarted import = %+v, want paused commit_pending", pending)
	}
	wantActions := []runtimev1.LocalTransferAction{runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CHECK_SYNC, runtimev1.LocalTransferAction_LOCAL_TRANSFER_ACTION_CANCEL}
	if got := pending.GetAvailableActions(); len(got) != len(wantActions) || got[0] != wantActions[0] || got[1] != wantActions[1] {
		t.Fatalf("commit_pending actions = %v, want %v", got, wantActions)
	}
	if _, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()}); err == nil {
		t.Fatal("resume of a commit_pending import must be refused")
	}
	if _, err := os.Stat(filepath.Join(directory, localAssetManifestFileName)); err != nil {
		t.Fatalf("intent-protected view was removed before explicit reconciliation: %v", err)
	}
	if len(restored.modelAssets) != 0 {
		t.Fatalf("uncommitted view was adopted in the background: %d", len(restored.modelAssets))
	}

	result := restored.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{RootActivationID: "rootact_commit_pending", DataRoot: runtimeRoot})
	adopted := false
	for _, resource := range result.Resources {
		if resource.Kind == "model_asset" && resource.Reference != nil && *resource.Reference == asset.GetModelAssetId() && resource.Change != nil && *resource.Change == "adopted" {
			adopted = true
		}
	}
	if !adopted {
		t.Fatalf("Check & Sync did not commit the pending view: %+v", result.Resources)
	}
	committed := restored.localTransferSummary(transfer.GetInstallSessionId())
	if committed.GetState() != localTransferStateCompleted || committed.GetAssetId() != asset.GetModelAssetId() || committed.GetDisposition() != runtimev1.LocalTransferDisposition_LOCAL_TRANSFER_DISPOSITION_CREATED {
		t.Fatalf("committed transfer = %+v", committed)
	}
	if len(restored.modelAssets) != 1 || restored.modelAssets[asset.GetModelAssetId()] == nil {
		t.Fatalf("Check & Sync inventory = %d", len(restored.modelAssets))
	}
}

// E29: a corrupt published object is isolated by physical identity when an
// explicit acquisition of another layout meets it; the old view keeps its old
// inode and stays unavailable, the new view gets a healthy generation, and
// removing the old view never touches the healthy object.
func TestCorruptObjectIsIsolatedAndReplacedByExplicitAcquisition(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		serveModelWithRange(w, r, payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	old, err := svc.installManagedDownloadedModel(context.Background(), managedDownloadedModelSpec{
		modelID: "local/corrupt-a", capabilities: []string{"text.embed"}, entry: "model.gguf", files: []string{"model.gguf"},
		repo: "owner/repo", revision: "main", hashes: map[string]string{"model.gguf": "sha256:" + digest},
	})
	if err != nil {
		t.Fatalf("first install: %v", err)
	}
	modelsRoot := svc.resolvedLocalModelsPath()
	objectPath, _ := modelObjectPath(modelsRoot, digest)
	oldIdentity, _, err := modelFileIdentityOf(objectPath)
	if err != nil {
		t.Fatal(err)
	}
	// Corrupt the shared inode in place, keeping size and mtime.
	viewPath := filepath.Join(svc.modelAssetDirectories[old.GetModelAssetId()], "model.gguf")
	info, _ := os.Stat(viewPath)
	corrupt := append([]byte(nil), payload...)
	corrupt[len(corrupt)-1] ^= 0xff
	if err := os.WriteFile(viewPath, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(viewPath, info.ModTime(), info.ModTime())

	// The equivalent distribution is refused: its committed view is corrupt.
	_, _, err = svc.installManagedDownloadedModelWithTransfer(context.Background(), managedDownloadedModelSpec{
		modelID: "local/corrupt-a", capabilities: []string{"text.embed"}, entry: "model.gguf", files: []string{"model.gguf"},
		repo: "owner/repo", revision: "main", hashes: map[string]string{"model.gguf": "sha256:" + digest},
	}, "")
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_INVENTORY_RECONCILIATION_REQUIRED {
		t.Fatalf("equivalent acquisition over a corrupt view = %v, want reconciliation required", err)
	}

	// A different layout needing the same digest isolates the corrupt
	// generation and publishes a healthy replacement.
	replacement, replacementTransfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), managedDownloadedModelSpec{
		modelID: "local/corrupt-b", capabilities: []string{"text.embed"}, entry: "weights/model.gguf", files: []string{"weights/model.gguf"},
		repo: "owner/repo", revision: "main", hashes: map[string]string{"weights/model.gguf": "sha256:" + digest},
	}, "")
	if err != nil {
		t.Fatalf("replacement acquisition: %v", err)
	}
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Fatalf("payload requests = %d, want a fresh fetch for the replacement", got)
	}
	if svc.localTransferSummary(replacementTransfer).GetBytesReused() != 0 {
		t.Fatal("replacement counted the corrupt generation as reused")
	}
	newIdentity, _, err := modelFileIdentityOf(objectPath)
	if err != nil || newIdentity == oldIdentity {
		t.Fatalf("healthy object identity = %s err=%v, want a new generation (old %s)", newIdentity, err, oldIdentity)
	}
	oldViewIdentity, _, _ := modelFileIdentityOf(viewPath)
	if oldViewIdentity != oldIdentity {
		t.Fatal("old view was silently relinked to the new generation")
	}
	if err := svc.verifyManagedModelAssetView(context.Background(), modelsRoot, replacement, svc.modelAssetDirectories[replacement.GetModelAssetId()], nil); err != nil {
		t.Fatalf("replacement view failed verification: %v", err)
	}
	if err := svc.verifyManagedModelAssetView(context.Background(), modelsRoot, old, svc.modelAssetDirectories[old.GetModelAssetId()], nil); err == nil {
		t.Fatal("old corrupt view verified as healthy")
	}
	svc.mu.RLock()
	quarantines := len(svc.modelObjectQuarantines)
	svc.mu.RUnlock()
	if quarantines != 1 {
		t.Fatalf("object quarantine obligations = %d, want 1 pending the old view", quarantines)
	}

	// Removing the old distribution deletes its view by its captured identity,
	// leaves the healthy object alone, and lets the isolated generation go.
	if removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: old.GetModelAssetId(), Force: true}); err != nil || removed.GetCleanupPending() {
		t.Fatalf("remove old view = %+v err=%v", removed, err)
	}
	afterIdentity, _, err := modelFileIdentityOf(objectPath)
	if err != nil || afterIdentity != newIdentity {
		t.Fatalf("healthy object changed after old cleanup: %s err=%v", afterIdentity, err)
	}
	svc.mu.RLock()
	quarantines = len(svc.modelObjectQuarantines)
	svc.mu.RUnlock()
	if quarantines != 0 {
		t.Fatalf("isolated generation survived the last old reference: %+v", svc.modelObjectQuarantines)
	}
	if err := svc.verifyManagedModelAssetView(context.Background(), modelsRoot, replacement, svc.modelAssetDirectories[replacement.GetModelAssetId()], nil); err != nil {
		t.Fatalf("replacement view failed verification after old cleanup: %v", err)
	}
}

func waitTransferStateForTest(t *testing.T, svc *Service, sessionID string, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if svc.localTransferSummary(sessionID).GetState() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("transfer %q did not reach %q: %+v", sessionID, want, svc.localTransferSummary(sessionID))
}
