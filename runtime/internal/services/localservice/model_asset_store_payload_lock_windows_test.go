//go:build windows

package localservice

import (
	"bytes"
	"context"
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

func modelAssetStorePayloadContainsID(payload []byte, id string) bool {
	return id != "" && bytes.Contains(payload, []byte(id))
}
