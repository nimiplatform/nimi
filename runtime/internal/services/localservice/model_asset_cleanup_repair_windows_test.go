//go:build windows

package localservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"golang.org/x/sys/windows"
)

func TestRepairCleanupResumesAfterPartialUnlinkRestartAndHandleRelease(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "model.bin")
	if err := os.WriteFile(source, []byte("cleanup across a real Windows handle"), 0600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "locked manifest")
	directory := svc.modelAssetDirectories[asset.GetModelAssetId()]
	manifest := filepath.Join(directory, localAssetManifestFileName)
	path, err := windows.UTF16PtrFromString(manifest)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = windows.CloseHandle(handle)
		}
	})
	result, err := svc.RemoveModelAsset(context.Background(), &runtimev1.RemoveModelAssetRequest{ModelAssetId: asset.GetModelAssetId(), Force: true})
	if err != nil || !result.GetCleanupPending() {
		t.Fatalf("locked cleanup = %+v %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(directory, asset.GetEntry())); !os.IsNotExist(err) {
		t.Fatalf("expected actual partial unlink before blocked manifest: %v", err)
	}
	state, models := svc.stateStorePath, svc.localModelsPath
	svc.Close()
	restarted := restartModelAssetServiceForTest(t, state, models)
	restarted.OpenModelAssetReclamation()
	if _, err := os.Stat(manifest); err != nil {
		t.Fatalf("locked manifest lost: %v", err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	closed = true
	restarted.reconcileProductControlCheckSyncModelAssets(context.Background(), ProductControlCheckSyncInput{RootActivationID: "repair-root", DataRoot: filepath.Dir(models)})
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("handle release did not finish cleanup: %v", err)
	}
	if _, exists := restarted.modelAssets[asset.GetModelAssetId()]; exists {
		t.Fatal("partial view resurrected during recovery")
	}
}
