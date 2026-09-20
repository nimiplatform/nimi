package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelassetintegrity"
)

func waitTransferTerminalForContentRepair(t *testing.T, svc *Service, id string) *runtimev1.LocalTransferSessionSummary {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		summary := svc.localTransferSummary(id)
		if isTerminalTransferState(summary.GetState()) {
			return summary
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("transfer did not terminate")
	return nil
}

func TestImportModelAssetAcceptsEmptyCompanion(t *testing.T) {
	svc := newTestService(t)
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "model.gguf"), validTestGGUF(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "__init__.py"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	response, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	summary := waitTransferTerminalForContentRepair(t, svc, response.GetTransfer().GetInstallSessionId())
	t.Logf("observed state=%s reason=%s message=%s inventory=%d", summary.GetState(), summary.GetReasonCode(), summary.GetMessage(), len(svc.modelAssets))
	if summary.GetState() != localTransferStateCompleted {
		t.Errorf("safe distribution with verified empty file should import, got %s: %s", summary.GetState(), summary.GetMessage())
	}
}

func TestImportModelAssetReuseRejectsExtraPayload(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.gguf")
	if err := os.WriteFile(source, validTestGGUF(), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	firstSummary := waitTransferTerminalForContentRepair(t, svc, first.GetTransfer().GetInstallSessionId())
	if firstSummary.GetState() != localTransferStateCompleted {
		t.Fatalf("initial import failed: %s", firstSummary.GetMessage())
	}
	id := firstSummary.GetAssetId()
	directory := svc.modelAssetDirectories[id]
	if err := os.WriteFile(filepath.Join(directory, "config.json"), []byte(`{"unexpected":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	// This is the same full-set guard used by Local Job admission and Host sealing.
	if err := modelassetintegrity.ValidateDeclaredPayloadSet(directory, []string{"model.gguf"}); err == nil {
		t.Fatal("negative control failed: admission payload-set guard accepted added file")
	} else {
		t.Logf("admission guard rejects altered view: %v", err)
	}
	second, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	secondSummary := waitTransferTerminalForContentRepair(t, svc, second.GetTransfer().GetInstallSessionId())
	t.Logf("reuse observed state=%s disposition=%s sameID=%t received=%d reused=%d", secondSummary.GetState(), secondSummary.GetDisposition(), secondSummary.GetAssetId() == id, secondSummary.GetBytesReceived(), secondSummary.GetBytesReused())
	if secondSummary.GetState() == localTransferStateCompleted {
		t.Errorf("reuse reported success for view whose actual payload set differs from distribution")
	}
}

func TestManagedDownloadAcceptsAndReusesEmptyCompanion(t *testing.T) {
	svc := newTestService(t)
	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	emptySum := sha256.Sum256(nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if filepath.Base(r.URL.Path) == "__init__.py" {
			w.WriteHeader(http.StatusOK)
			return
		}
		serveModelWithRange(w, r, payload)
	}))
	svc.hfDownloadBaseURL = server.URL
	spec := managedDownloadedModelSpec{modelID: "local/empty-companion", repo: "owner/repo", revision: "main", entry: "model.gguf", files: []string{"model.gguf", "__init__.py"},
		hashes: map[string]string{"model.gguf": hex.EncodeToString(sum[:]), "__init__.py": hex.EncodeToString(emptySum[:])}}
	asset, _, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	server.Close()
	if err != nil {
		t.Fatal(err)
	}
	if len(asset.GetFiles()) != 2 || asset.GetTotalSizeBytes() != int64(len(payload)) {
		t.Fatalf("empty companion was dropped or miscounted: %+v", asset)
	}
	// A repeat succeeds even after the source server is closed.
	reused, transfer, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	if err != nil || reused.GetModelAssetId() != asset.GetModelAssetId() || svc.localTransferSummary(transfer).GetBytesReceived() != 0 {
		t.Fatalf("empty companion distribution was not reused: %+v %v", reused, err)
	}
}

func TestImportModelAssetReuseRejectsChangedManifest(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.gguf")
	if err := os.WriteFile(source, validTestGGUF(), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTransferTerminalForContentRepair(t, svc, first.GetTransfer().GetInstallSessionId())
	if finished.GetState() != localTransferStateCompleted {
		t.Fatal(finished.GetMessage())
	}
	path := filepath.Join(svc.modelAssetDirectories[finished.GetAssetId()], localAssetManifestFileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest modelAssetManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.DisplayName = "changed outside inventory"
	raw, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportModelAsset(context.Background(), &runtimev1.ImportModelAssetRequest{SourcePath: source})
	if err != nil {
		t.Fatal(err)
	}
	finished = waitTransferTerminalForContentRepair(t, svc, second.GetTransfer().GetInstallSessionId())
	if finished.GetState() != localTransferStateFailed || finished.GetAssetId() != "" {
		t.Fatalf("changed manifest reported a successful reuse: %+v", finished)
	}
}
