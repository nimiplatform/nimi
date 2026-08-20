//go:build windows

package localservice

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"golang.org/x/sys/windows"
)

func TestModelAssetStoreStartupDoesNotReadLockedPayload(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "locked-payload.bin")
	if err := os.WriteFile(source, []byte("locked-payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "locked payload")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.mu.RLock()
	payloadPath := filepath.Join(svc.modelAssetDirectories[asset.GetModelAssetId()], filepath.FromSlash(asset.GetEntry()))
	svc.mu.RUnlock()
	svc.Close()

	pathUTF16, err := windows.UTF16PtrFromString(payloadPath)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(
		pathUTF16,
		windows.GENERIC_READ,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = windows.CloseHandle(handle)
		}
	})

	restarted := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := restarted.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("locked payload startup restore = %+v err=%v", listed, err)
	}
	storePayload, err := os.ReadFile(storePath)
	if err != nil || !modelAssetStorePayloadContainsID(storePayload, asset.GetModelAssetId()) {
		t.Fatalf("temporary payload lock rewrote active identity: retained=%t err=%v", modelAssetStorePayloadContainsID(storePayload, asset.GetModelAssetId()), err)
	}

	restarted.Close()
	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	closed = true
	again := restartModelAssetServiceForTest(t, statePath, modelsPath)
	againListed, err := again.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(againListed.GetAssets()) != 1 || againListed.GetAssets()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("post-lock startup restore = %+v err=%v", againListed, err)
	}
}

func TestModelAssetStoreStartupFailsClosedWithoutRewritingLockedManifest(t *testing.T) {
	svc := newTestService(t)
	source := filepath.Join(t.TempDir(), "locked-manifest-payload.bin")
	if err := os.WriteFile(source, []byte("locked-manifest-payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	asset := importModelAssetForTest(t, svc, source, "locked manifest")
	statePath := svc.stateStorePath
	modelsPath := svc.localModelsPath
	storePath := svc.modelAssetStorePath
	svc.mu.RLock()
	manifestPath := filepath.Join(svc.modelAssetDirectories[asset.GetModelAssetId()], localAssetManifestFileName)
	svc.mu.RUnlock()
	storeBefore, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	svc.Close()
	if count := modelAssetQuarantineEntryCount(t, storePath); count != 0 {
		t.Fatalf("unexpected preexisting quarantine entries: %d", count)
	}

	pathUTF16, err := windows.UTF16PtrFromString(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(
		pathUTF16,
		windows.GENERIC_READ,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	closed := false
	t.Cleanup(func() {
		if !closed {
			_ = windows.CloseHandle(handle)
		}
	})

	restarted, restartErr := NewWithProductControlDataRoot(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		statePath,
		0,
		modelsPath,
		filepath.Dir(modelsPath),
	)
	if restarted != nil {
		restarted.Close()
	}
	if restartErr == nil {
		t.Fatal("startup succeeded while the canonical ModelAsset manifest was unreadable")
	}
	storeAfter, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storeAfter, storeBefore) {
		t.Fatal("temporary manifest sharing violation rewrote active ModelAsset inventory")
	}
	if count := modelAssetQuarantineEntryCount(t, storePath); count != 0 {
		t.Fatalf("temporary manifest sharing violation created %d quarantine entries", count)
	}

	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	closed = true
	again := restartModelAssetServiceForTest(t, statePath, modelsPath)
	listed, err := again.ListModelAssets(context.Background(), &runtimev1.ListModelAssetsRequest{})
	if err != nil || len(listed.GetAssets()) != 1 || listed.GetAssets()[0].GetModelAssetId() != asset.GetModelAssetId() {
		t.Fatalf("post-lock startup restore = %+v err=%v", listed, err)
	}
}

func modelAssetQuarantineEntryCount(t *testing.T, storePath string) int {
	t.Helper()
	entries, err := os.ReadDir(stateQuarantineDirectory(storePath))
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}
