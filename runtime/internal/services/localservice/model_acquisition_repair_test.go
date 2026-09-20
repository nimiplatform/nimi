package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Real installation snapshots at the manifest/inventory boundary, followed
// by a new Service reading those exact disk snapshots. No real data roots.
func TestManagedDownloadResumeDiscardsUncommittedView(t *testing.T) {
	for _, manifestPresent := range []bool{false, true} {
		t.Run(fmt.Sprint(manifestPresent), func(t *testing.T) {
			svc := newTestService(t)
			payload := validTestGGUF()
			sum := sha256.Sum256(payload)
			var requests atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				serveModelWithRange(w, r, payload)
			}))
			defer server.Close()
			svc.hfDownloadBaseURL = server.URL
			spec := managedDownloadFailureSpec("local/audit-pending-download", hex.EncodeToString(sum[:]))
			svc.mu.Lock()
			if err := svc.persistModelAssetStoreLocked(); err != nil {
				t.Fatal(err)
			}
			svc.mu.Unlock()
			var frozenState, frozenInventory []byte
			svc.writeModelAssetManifest = func(path string, bytes []byte) error {
				if err := writeFileAtomically(path, bytes, 0600); err != nil {
					return err
				}
				var err error
				frozenState, err = os.ReadFile(svc.stateStorePath)
				if err != nil {
					return err
				}
				frozenInventory, err = os.ReadFile(svc.modelAssetStorePath)
				return err
			}
			asset, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
			if err != nil {
				t.Fatal(err)
			}
			directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
			statePath, inventoryPath, modelsRoot, runtimeRoot := svc.stateStorePath, svc.modelAssetStorePath, svc.resolvedLocalModelsPath(), svc.runtimeDataRoot
			svc.Close()
			if err := os.WriteFile(statePath, frozenState, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(inventoryPath, frozenInventory, 0600); err != nil {
				t.Fatal(err)
			}
			var frozen localStateSnapshot
			if err := json.Unmarshal(frozenState, &frozen); err != nil {
				t.Fatal(err)
			}
			if len(frozen.Transfers) != 1 || frozen.Transfers[0].CommitIntent == nil || frozen.Transfers[0].CommitIntent.ModelAssetID != asset.GetModelAssetId() {
				t.Fatal("fixture did not capture real create intent")
			}
			if !manifestPresent {
				if err := os.Remove(filepath.Join(directory, localAssetManifestFileName)); err != nil {
					t.Fatal(err)
				}
			}
			restored, err := NewWithProductControlDataRoot(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0, modelsRoot, runtimeRoot)
			if err != nil {
				t.Fatal(err)
			}
			defer restored.Close()
			restored.hfDownloadBaseURL = server.URL
			restored.OpenModelAssetReclamation()
			if len(restored.modelAssets) != 0 {
				t.Fatal("fixture inventory must be precommit")
			}
			if _, err := os.Stat(directory); err != nil {
				t.Fatal(err)
			}
			if _, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: transferID}); err != nil {
				t.Fatal(err)
			}
			waitTransferStateForTest(t, restored, transferID, localTransferStateCompleted)
			completed := restored.localTransferSummary(transferID)
			views, err := os.ReadDir(filepath.Join(modelsRoot, "resolved"))
			if err != nil {
				t.Fatal(err)
			}
			result := restored.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{RootActivationID: "audit_storage", DataRoot: runtimeRoot})
			reasons := make([]string, 0)
			for _, resource := range result.Resources {
				reasons = append(reasons, resource.Reason)
			}
			t.Logf("original=%s resumed=%s views=%d payload_requests=%d checksync=%v", asset.GetModelAssetId(), completed.GetAssetId(), len(views), requests.Load(), reasons)
			if len(views) != 1 || len(restored.modelAssets) != 1 || restored.modelAssets[completed.GetAssetId()] == nil {
				t.Fatal("resume left duplicate views or an invalid result")
			}
			if requests.Load() != 1 {
				t.Fatal("resume downloaded already published content")
			}
			for _, resource := range result.Resources {
				if resource.Status == "conflict" || resource.Status == "failed" {
					t.Fatalf("reconciliation failed after resume: %+v", resource)
				}
			}
		})
	}
}
