package localservice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func newRepairLegacyFixture(t *testing.T, prefix bool) (*Service, string, string, []byte) {
	t.Helper()
	root := t.TempDir()
	models := filepath.Join(root, "models")
	state := filepath.Join(root, "accounts", "runtime", "local-state.json")
	if err := os.MkdirAll(filepath.Dir(state), 0700); err != nil {
		t.Fatal(err)
	}
	payload := []byte("healthy original payload")
	manifest := writeLegacyLayoutView(t, filepath.Join(models, "resolved", "model_review"), "model_review", "review", "model.bin", map[string][]byte{"model.bin": payload}, "2026-01-01T00:00:00Z")
	store, _ := json.Marshal(map[string]any{"schemaVersion": 1, "assets": []any{legacyStoreRowForManifest(t, manifest, "resolved/model_review")}})
	if err := os.WriteFile(filepath.Join(filepath.Dir(state), modelAssetStoreFileName), store, 0600); err != nil {
		t.Fatal(err)
	}
	rows := []any{}
	if prefix {
		partial := []byte("partial bytes")
		sum := sha256.Sum256([]byte("partial bytes plus the rest of the real file"))
		dir := legacyManagedModelDownloadStageDir(models, "review-source", "transfer_review")
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "weights.bin.download"), partial, 0600); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, map[string]any{"installSessionId": "transfer_review", "assetId": "review-source", "sessionKind": "download", "phase": "download", "state": "failed", "retryable": true, "bytesReceived": len(partial), "bytesTotal": 43, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "managedDownloadSpec": map[string]any{"modelId": "review-source", "entry": "weights.bin", "files": []string{"weights.bin"}, "repo": "review/source", "revision": "main", "hashes": map[string]string{"weights.bin": "sha256:" + hex.EncodeToString(sum[:])}, "totalSizeBytes": 43}})
	}
	raw, _ := json.Marshal(map[string]any{"schemaVersion": localStateSchemaVersion, "transfers": rows})
	if err := os.WriteFile(state, raw, 0600); err != nil {
		t.Fatal(err)
	}
	svc, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, state, 8, models)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	return svc, state, models, payload
}

func TestRepairConversionMustNotReplaceHealthyBytesWithCorruptObject(t *testing.T) {
	svc, _, models, payload := newRepairLegacyFixture(t, false)
	sum := sha256.Sum256(payload)
	object, _ := modelObjectPath(models, hex.EncodeToString(sum[:]))
	if err := os.MkdirAll(filepath.Dir(object), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(object, bytes.Repeat([]byte("x"), len(payload)), 0600); err != nil {
		t.Fatal(err)
	}
	report, err := svc.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{Apply: true})
	if err == nil || report != nil && report.Applied {
		t.Fatal("corrupt existing object was accepted by conversion")
	}
	got, readErr := os.ReadFile(filepath.Join(models, "resolved", "model_review", "model.bin"))
	if readErr != nil || !bytes.Equal(got, payload) {
		t.Fatalf("healthy source was destroyed/replaced: applyErr=%v applied=%v payload=%q readErr=%v", err, report != nil && report.Applied, got, readErr)
	}
}

func TestRepairConversionReapplyMustPreserveResumablePrefix(t *testing.T) {
	svc, state, models, _ := newRepairLegacyFixture(t, true)
	if _, err := svc.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{Apply: true}); err != nil {
		t.Fatal(err)
	}
	read := func() localStateTransferState {
		raw, err := os.ReadFile(state)
		if err != nil {
			t.Fatal(err)
		}
		var snapshot localStateSnapshot
		if err = json.Unmarshal(raw, &snapshot); err != nil {
			t.Fatal(err)
		}
		for _, row := range snapshot.Transfers {
			if row.InstallSessionID == "transfer_review" {
				return row
			}
		}
		t.Fatal("transfer absent")
		return localStateTransferState{}
	}
	first := read()
	if !first.Retryable || first.ManagedDownloadSpec == nil {
		t.Fatalf("first apply not resumable: %+v", first)
	}
	svc.Close()
	again, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, state, 8, models)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	report, err := again.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{Apply: true})
	if err != nil {
		t.Fatal(err)
	}
	second := read()
	if !second.Retryable || second.ManagedDownloadSpec == nil || len(second.ObjectHolds) == 0 {
		t.Fatalf("second apply dropped resumability: AlreadyConverted=%v retryable=%v spec=%v holds=%v", report.AlreadyConverted, second.Retryable, second.ManagedDownloadSpec != nil, second.ObjectHolds)
	}
}

func TestRepairConversionResumesPrefixMovedBeforeStateSave(t *testing.T) {
	svc, state, models, _ := newRepairLegacyFixture(t, true)
	oldPath := legacyManagedModelDownloadStageDir(models, "review-source", "transfer_review")
	newPath := managedModelDownloadStageDir(models, "transfer_review")
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{Apply: true}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(state)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot localStateSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	row := snapshot.Transfers[0]
	if !row.Retryable || row.ManagedDownloadSpec == nil || len(row.ObjectHolds) != 1 {
		t.Fatalf("moved prefix lost owner/spec: %+v", row)
	}
	if raw, err := os.ReadFile(filepath.Join(newPath, "weights.bin.download")); err != nil || string(raw) != "partial bytes" {
		t.Fatalf("prefix changed: %q %v", raw, err)
	}
}

func TestRepairConversionPreviewNeverRewritesOrProbesState(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			svc, state, models, _ := newRepairLegacyFixture(t, false)
			svc.Close()
			if corrupt {
				if err := os.WriteFile(filepath.Join(filepath.Dir(state), loadoutStoreFileName), []byte("{broken"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			root := filepath.Dir(models)
			snapshot := func() map[string]string {
				result := make(map[string]string)
				err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
					if err != nil {
						return err
					}
					if entry.IsDir() {
						result[path] = "directory"
						return nil
					}
					raw, err := os.ReadFile(path)
					if err != nil {
						return err
					}
					sum := sha256.Sum256(raw)
					result[path] = hex.EncodeToString(sum[:])
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				return result
			}
			before := snapshot()
			preview, err := NewForLocalModelConversion(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, state, 8, models, true)
			if corrupt && err == nil {
				preview.Close()
				t.Fatal("malformed Loadouts silently accepted")
			}
			if !corrupt {
				if err != nil {
					t.Fatal(err)
				}
				defer preview.Close()
				if _, err := preview.ConvertModelStorageToContentAddressed(context.Background(), ModelStorageConversionOptions{PreviewUnlocked: true}); err != nil {
					t.Fatal(err)
				}
			}
			if !reflect.DeepEqual(before, snapshot()) {
				t.Fatal("preview changed file contents or tree entries")
			}
		})
	}
}

func TestRepairConversionRelinkPreservesRealRelinkNamedPayload(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "quarantine"), 0700); err != nil {
		t.Fatal(err)
	}
	object, view, neighbor := filepath.Join(root, "object"), filepath.Join(root, "payload"), filepath.Join(root, "payload.relink")
	for path, payload := range map[string]string{object: "healthy", view: "healthy", neighbor: "different required file"} {
		if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := replaceConversionViewFile(root, object, view); err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(neighbor); err != nil || string(raw) != "different required file" {
		t.Fatalf("neighbor overwritten: %q %v", raw, err)
	}
	left, _ := os.Stat(object)
	right, _ := os.Stat(view)
	if !os.SameFile(left, right) {
		t.Fatal("replacement did not link object")
	}
}

func TestRepairVerificationClaimKeepsItsOwnPrefixExclusive(t *testing.T) {
	svc := newTestService(t)
	digest := strings.Repeat("a", 64)
	if conflict := svc.acquireModelObjectWriter(digest, "original"); conflict != nil {
		t.Fatal(conflict)
	}
	svc.releaseModelObjectWriters("original")
	svc.holdModelObjectForVerification(digest, "original")
	if conflict := svc.acquireModelObjectWriter(digest, "new"); conflict == nil || conflict.Kind != modelObjectConflictResumeRequired || conflict.RelatedTransferID != "original" {
		t.Fatalf("verification released the prefix's exclusive owner: %+v", conflict)
	}
}

func TestRepairTwoBundlesResumeTheirOwnPrefixesWithoutWaitingCycle(t *testing.T) {
	svc := newTestService(t)
	payloads := map[string][]byte{"a.bin": []byte("first file content"), "b.bin": []byte("second file content")}
	hashes := make(map[string]string)
	for file, bytes := range payloads {
		sum := sha256.Sum256(bytes)
		hashes[file] = hex.EncodeToString(sum[:])
	}
	spec := managedDownloadedModelSpec{modelID: "two-prefixes", entry: "a.bin", files: []string{"a.bin", "b.bin"}, repo: "test/prefixes", revision: "main", hashes: hashes}
	ids := make([]string, 0, 2)
	for _, file := range []string{"b.bin", "a.bin"} {
		transfer, err := svc.newManagedModelDownloadTransfer(localTransferMutation{Phase: "download", State: localTransferStateRunning, Retryable: true}, spec)
		if err != nil {
			t.Fatal(err)
		}
		id := transfer.GetInstallSessionId()
		ids = append(ids, id)
		stage := managedModelDownloadStageDir(svc.localModelsPath, id)
		if err := os.MkdirAll(stage, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(stage, file+".download"), payloads[file][:5], 0600); err != nil {
			t.Fatal(err)
		}
		if conflict := svc.acquireModelObjectWriter(hashes[file], id); conflict != nil {
			t.Fatal(conflict)
		}
		svc.releaseModelObjectWriters(id)
		if err := svc.failTransfer(id, "interrupted", true); err != nil {
			t.Fatal(err)
		}
	}
	state, models := svc.stateStorePath, svc.localModelsPath
	svc.Close()
	restored := restartModelAssetServiceForTest(t, state, models)
	restored.OpenModelAssetReclamation()
	requests := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		file := filepath.Base(r.URL.Path)
		requests <- file + ":" + r.Header.Get("Range")
		serveModelWithRange(w, r, payloads[file])
	}))
	defer server.Close()
	restored.hfDownloadBaseURL = server.URL
	if _, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: ids[0]}); err != nil {
		t.Fatal(err)
	}
	restored.transferWorkerWG.Wait()
	if first := <-requests; first != "b.bin:bytes=5-" {
		t.Fatalf("resume did not advance its own later-sorted prefix first: %s", first)
	}
	if summary := restored.localTransferSummary(ids[0]); summary.GetState() != localTransferStateFailed || summary.GetRelatedInstallSessionId() != ids[1] {
		t.Fatalf("remaining conflict lacks the real owner: %+v", summary)
	}
	if _, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: ids[1]}); err != nil {
		t.Fatal(err)
	}
	restored.transferWorkerWG.Wait()
	summary := restored.localTransferSummary(ids[1])
	if summary.GetState() != localTransferStateCompleted {
		t.Fatalf("second owner remained blocked: %+v", summary)
	}
	asset, _, err := restored.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	if err != nil || asset.GetModelAssetId() != summary.GetAssetId() {
		t.Fatalf("explicit retry did not reuse the completed distribution: %+v %v", asset, err)
	}
}

func TestRepairCancelPendingImportMustRemoveItsUncommittedView(t *testing.T) {
	svc := newTestService(t)
	payload := []byte("pending managed import")
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, payload, 0600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "review")
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	forgetModelAssetInventoryForTest(t, svc, asset.GetModelAssetId())
	transfer := newImportTransferForTest(t, svc, modelAssetSource{Path: source, DisplayName: "review", SizeBytes: int64(len(payload))})
	dist, err := modelDistributionFromRecord(asset)
	if err != nil {
		t.Fatal(err)
	}
	svc.mu.Lock()
	svc.transferPrivateLocked(transfer.GetInstallSessionId()).commitIntent = &localTransferCommitIntent{Kind: "create", ModelAssetID: asset.GetModelAssetId(), ManagedDirectory: directory, Generation: asset.GetCreatedAt(), Entry: asset.GetEntry(), Files: dist.Files}
	err = svc.persistStateLocked()
	svc.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	state, models, root := svc.stateStorePath, svc.resolvedLocalModelsPath(), svc.runtimeDataRoot
	svc.Close()
	restored, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, state, 0, models, root)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	restored.OpenModelAssetReclamation()
	if _, err = restored.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()}); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(directory); !os.IsNotExist(err) {
		t.Errorf("cancel left the uncommitted view on disk: stat=%v", err)
	}
	restored.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{RootActivationID: "rootact_review", DataRoot: root})
	if restored.modelAssets[asset.GetModelAssetId()] != nil {
		t.Errorf("CheckSync resurrected the cancelled acquisition as asset %s", asset.GetModelAssetId())
	}
}

func TestRepairUnpersistedCreatedResultMustBlockRemoval(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { serveModelWithRange(w, r, payload) }))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL
	svc.writeModelAssetManifest = func(path string, raw []byte) error {
		if err := os.Remove(svc.stateStorePath); err != nil {
			return err
		}
		if err := os.Mkdir(svc.stateStorePath, 0700); err != nil {
			return err
		}
		return writeFileAtomically(path, raw, 0600)
	}
	asset, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), managedDownloadFailureSpec("review.persist", hex.EncodeToString(sum[:])), "")
	if err != nil || asset == nil {
		t.Fatalf("acquisition failed before the tested window: %v", err)
	}
	result, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err == nil {
		t.Fatalf("removal succeeded while created-result persistence is still impossible: result=%v assetStillPresent=%v", result, svc.modelAssets[asset.GetModelAssetId()] != nil)
	}
	if err := os.Remove(svc.stateStorePath); err != nil {
		t.Fatal(err)
	} // remove the empty failure fixture
	svc.saveModelAssetStore = func(string, modelAssetStoreSnapshot) error { return errors.New("inventory removal save failed") }
	if _, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true}); err == nil {
		t.Fatal("removal save unexpectedly succeeded")
	}
	raw, err := os.ReadFile(svc.stateStorePath)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot localStateSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	settled := false
	for _, row := range snapshot.Transfers {
		if row.InstallSessionID == transferID {
			settled = row.Result != nil && row.Result.Disposition == "created" && row.CommitIntent == nil
		}
	}
	if !settled || svc.transferPrivate[transferID].commitIntent != nil {
		t.Fatal("later inventory failure rolled back the durable created result")
	}
	svc.saveModelAssetStore = nil
	if _, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true}); err != nil {
		t.Fatalf("recovered removal: %v", err)
	}
}

func TestRepairCancelledBundleMustReclaimPublishedUnreferencedObject(t *testing.T) {
	svc := newTestService(t)
	firstPayload := []byte("first file already published before cancellation")
	secondPayload := []byte("second file whose transfer is interrupted")
	firstHash := sha256.Sum256(firstPayload)
	secondHash := sha256.Sum256(secondPayload)
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "a.bin") {
			serveModelWithRange(w, r, firstPayload)
			return
		}
		close(started)
		<-r.Context().Done()
	}))
	ctx, cancel := context.WithCancel(context.Background())
	defer server.Close()
	defer cancel()
	svc.hfDownloadBaseURL = server.URL
	done := make(chan error, 1)
	go func() {
		_, _, err := svc.installManagedDownloadedModelWithTransfer(ctx, managedDownloadedModelSpec{modelID: "review.cancel.bundle", repo: "review/source", revision: "main", entry: "a.bin", files: []string{"a.bin", "b.bin"}, hashes: map[string]string{"a.bin": hex.EncodeToString(firstHash[:]), "b.bin": hex.EncodeToString(secondHash[:])}}, "")
		done <- err
	}()
	select {
	case <-started:
	case err := <-done:
		t.Fatalf("acquisition stopped before second file: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("second file never requested")
	}
	listing, err := svc.ListLocalTransfers(context.Background(), &runtimev1.ListLocalTransfersRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.GetTransfers()) != 1 {
		t.Fatalf("transfers=%d", len(listing.GetTransfers()))
	}
	id := listing.GetTransfers()[0].GetInstallSessionId()
	if _, err = svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: id}); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled executor did not exit")
	}
	cleaned, err := svc.CancelLocalTransfer(context.Background(), &runtimev1.CancelLocalTransferRequest{InstallSessionId: id})
	if err != nil {
		t.Fatal(err)
	}
	if cleaned.GetTransfer().GetCleanupPending() || len(svc.modelObjectHoldsForTransfer(id)) != 0 {
		t.Fatalf("cleanup did not finish after executor exit: summary=%v holds=%v", cleaned.GetTransfer(), svc.modelObjectHoldsForTransfer(id))
	}
	svc.OpenModelAssetReclamation()
	object, _ := modelObjectPath(svc.resolvedLocalModelsPath(), hex.EncodeToString(firstHash[:]))
	if _, err = os.Stat(object); !os.IsNotExist(err) {
		t.Fatalf("cancelled acquisition left a published object without inventory or holds: assets=%d holds=%v objectStat=%v", len(svc.modelAssets), svc.modelObjectHoldsForTransfer(id), err)
	}
}

func TestRepairCheckSyncMustNotResurrectRemovedPinnedAsset(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, []byte("asset whose removal is waiting for a job"), 0600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "review removal")
	release := svc.AcquireModelAssetUse(asset.GetModelAssetId(), "job:review")
	defer release()
	removed, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !removed.GetCleanupPending() {
		t.Fatalf("remove did not enter the intended wait_users state: result=%v err=%v", removed, err)
	}
	svc.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{RootActivationID: "rootact_removed_review", DataRoot: svc.runtimeDataRoot})
	if svc.modelAssets[asset.GetModelAssetId()] != nil {
		t.Fatalf("CheckSync restored an explicitly removed asset while its cleanup obligation was waiting for users; obligation=%+v", svc.modelAssetCleanupObligations[asset.GetModelAssetId()])
	}
}
