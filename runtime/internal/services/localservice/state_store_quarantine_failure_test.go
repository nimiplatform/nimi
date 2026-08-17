package localservice

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalStateQuarantineFailurePreservesOriginal(t *testing.T) {
	t.Run("record", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "local-state.json")
		payload, err := json.Marshal(map[string]any{
			"schemaVersion": localStateSchemaVersion,
			"audits": []any{
				map[string]any{"id": "healthy"},
				map[string]any{"id": "invalid", "unknownField": true},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		writeStoreAndBlockQuarantineForTest(t, path, payload)

		snapshot, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(path)
		if err != nil {
			t.Fatalf("load record-isolated state: %v", err)
		}
		if len(snapshot.Audits) != 1 || rewriteRequired {
			t.Fatalf("record isolation = healthy:%d rewrite:%t, want 1/false", len(snapshot.Audits), rewriteRequired)
		}
		assertFailedQuarantineDiagnosticForTest(t, diagnostics, "quarantine write failed")
		assertStoreBytesForTest(t, path, payload)
		if len(snapshot.retainedRecords) != 1 {
			t.Fatalf("retained local-state records = %d, want 1", len(snapshot.retainedRecords))
		}
		retained := append([]byte(nil), snapshot.retainedRecords[0].Payload...)
		snapshot.Audits = append(snapshot.Audits, localStateAuditState{ID: "mutation"})
		if err := saveLocalStateSnapshot(path, snapshot); err != nil {
			t.Fatalf("persist healthy local-state mutation: %v", err)
		}
		assertStoreContainsRecordForTest(t, path, retained, true)

		unblockQuarantineForTest(t, path)
		recovered, _, recoveredRewrite, err := loadLocalStateSnapshotIsolated(path)
		if err != nil || !recoveredRewrite || len(recovered.retainedRecords) != 0 {
			t.Fatalf("recovered local-state isolation = rewrite:%t retained:%d err:%v", recoveredRewrite, len(recovered.retainedRecords), err)
		}
		if err := saveLocalStateSnapshot(path, recovered); err != nil {
			t.Fatalf("rewrite recovered local-state: %v", err)
		}
		assertStoreContainsRecordForTest(t, path, retained, false)
	})

	t.Run("document", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "local-state.json")
		payload := []byte(`{"schemaVersion":2,"audits":[`)
		writeStoreAndBlockQuarantineForTest(t, path, payload)

		_, diagnostics, rewriteRequired, err := loadLocalStateSnapshotIsolated(path)
		if err == nil || rewriteRequired {
			t.Fatalf("document isolation = err:%v rewrite:%t, want error/false", err, rewriteRequired)
		}
		assertFailedQuarantineDiagnosticForTest(t, diagnostics, "quarantine failed")
		assertStoreBytesForTest(t, path, payload)
	})
}

func TestModelAssetStoreQuarantineFailurePreservesOriginal(t *testing.T) {
	t.Run("record", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, modelAssetStoreFileName)
		payload, err := json.Marshal(map[string]any{
			"schemaVersion": modelAssetStoreSchemaVersion,
			"assets": []any{map[string]any{
				"asset":            map[string]any{"model_asset_id": "invalid"},
				"managedDirectory": "",
			}},
		})
		if err != nil {
			t.Fatal(err)
		}
		writeStoreAndBlockQuarantineForTest(t, path, payload)

		decoded, err := loadModelAssetStore(path, filepath.Join(root, "models"))
		if err != nil {
			t.Fatalf("load record-isolated ModelAsset store: %v", err)
		}
		if decoded.RewriteRequired {
			t.Fatal("record quarantine failure requested a healthy-store rewrite")
		}
		assertFailedQuarantineDiagnosticForTest(t, decoded.Diagnostics, "quarantine write failed")
		assertStoreBytesForTest(t, path, payload)
		if len(decoded.retainedRecords) != 1 {
			t.Fatalf("retained ModelAsset records = %d, want 1", len(decoded.retainedRecords))
		}
		retained := append([]byte(nil), decoded.retainedRecords[0].Payload...)
		svc := &Service{
			modelAssets:                  decoded.Assets,
			modelAssetDirectories:        decoded.Directories,
			modelAssetCleanupObligations: decoded.CleanupObligations,
			modelAssetRetainedRecords:    cloneQuarantinedStateRecords(decoded.retainedRecords),
			modelAssetStorePath:          path,
			saveModelAssetStore:          saveModelAssetStore,
		}
		svc.modelAssetCleanupObligations["mutation"] = modelAssetCleanupObligation{
			ModelAssetID: "mutation", ContentID: "sha256:" + strings.Repeat("a", 64),
			ManagedDirectory: filepath.Join(root, "models", "resolved", "mutation"), Reason: "test mutation",
		}
		svc.mu.Lock()
		err = svc.persistModelAssetStoreLocked()
		svc.mu.Unlock()
		if err != nil {
			t.Fatalf("persist healthy ModelAsset mutation: %v", err)
		}
		assertStoreContainsRecordForTest(t, path, retained, true)

		unblockQuarantineForTest(t, path)
		recovered, err := loadModelAssetStore(path, filepath.Join(root, "models"))
		if err != nil || !recovered.RewriteRequired || len(recovered.retainedRecords) != 0 {
			t.Fatalf("recovered ModelAsset isolation = rewrite:%t retained:%d err:%v", recovered.RewriteRequired, len(recovered.retainedRecords), err)
		}
		recoveredSnapshot, err := buildModelAssetStoreSnapshot(recovered.Assets, recovered.Directories, recovered.CleanupObligations)
		if err != nil {
			t.Fatal(err)
		}
		if err := saveModelAssetStore(path, recoveredSnapshot); err != nil {
			t.Fatalf("rewrite recovered ModelAsset store: %v", err)
		}
		assertStoreContainsRecordForTest(t, path, retained, false)
	})

	t.Run("document", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, modelAssetStoreFileName)
		payload := []byte(`{"schemaVersion":1,"assets":[`)
		writeStoreAndBlockQuarantineForTest(t, path, payload)

		decoded, err := loadModelAssetStore(path, filepath.Join(root, "models"))
		if err == nil || decoded.RewriteRequired {
			t.Fatalf("document isolation = err:%v rewrite:%t, want error/false", err, decoded.RewriteRequired)
		}
		assertFailedQuarantineDiagnosticForTest(t, decoded.Diagnostics, "quarantine failed")
		assertStoreBytesForTest(t, path, payload)
	})
}

func TestLoadoutStoreQuarantineFailurePreservesOriginal(t *testing.T) {
	t.Run("record", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), loadoutStoreFileName)
		payload, err := json.Marshal(map[string]any{
			"schemaVersion": loadoutStoreSchemaVersion,
			"loadouts":      []any{map[string]any{"unknownField": true}},
			"selections":    []any{},
		})
		if err != nil {
			t.Fatal(err)
		}
		writeStoreAndBlockQuarantineForTest(t, path, payload)
		store := &diskLoadoutStore{path: path}

		loadouts, selections, err := store.Load()
		if err != nil {
			t.Fatalf("load record-isolated Loadout store: %v", err)
		}
		if len(loadouts) != 0 || len(selections) != 0 {
			t.Fatalf("record isolation returned loadouts=%d selections=%d", len(loadouts), len(selections))
		}
		assertFailedQuarantineDiagnosticForTest(t, store.IsolationDiagnostics(), "quarantine write failed")
		assertStoreBytesForTest(t, path, payload)
		if len(store.retainedRecords) != 1 {
			t.Fatalf("retained Loadout records = %d, want 1", len(store.retainedRecords))
		}
		retained := append([]byte(nil), store.retainedRecords[0].Payload...)
		if err := store.Save(loadouts, selections); err != nil {
			t.Fatalf("persist healthy Loadout mutation: %v", err)
		}
		assertStoreContainsRecordForTest(t, path, retained, true)

		unblockQuarantineForTest(t, path)
		loadouts, selections, err = store.Load()
		if err != nil || len(loadouts) != 0 || len(selections) != 0 || len(store.retainedRecords) != 0 {
			t.Fatalf("recovered Loadout isolation = loadouts:%d selections:%d retained:%d err:%v", len(loadouts), len(selections), len(store.retainedRecords), err)
		}
		assertStoreContainsRecordForTest(t, path, retained, false)
	})

	t.Run("document", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), loadoutStoreFileName)
		payload := []byte(`{"schemaVersion":1,"loadouts":[`)
		writeStoreAndBlockQuarantineForTest(t, path, payload)
		store := &diskLoadoutStore{path: path}

		_, _, err := store.Load()
		if err == nil {
			t.Fatal("document quarantine failure did not fail closed")
		}
		assertFailedQuarantineDiagnosticForTest(t, store.IsolationDiagnostics(), "quarantine failed")
		assertStoreBytesForTest(t, path, payload)
	})
}

func writeStoreAndBlockQuarantineForTest(t *testing.T, path string, payload []byte) {
	t.Helper()
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write store fixture: %v", err)
	}
	if err := os.WriteFile(stateQuarantineDirectory(path), []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("block quarantine directory: %v", err)
	}
}

func unblockQuarantineForTest(t *testing.T, path string) {
	t.Helper()
	if err := os.Remove(stateQuarantineDirectory(path)); err != nil {
		t.Fatalf("unblock quarantine directory: %v", err)
	}
}

func assertStoreContainsRecordForTest(t *testing.T, path string, record []byte, want bool) {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read store after mutation: %v", err)
	}
	if got := bytes.Contains(payload, record); got != want {
		t.Fatalf("store contains retained record = %t, want %t\nrecord=%q\nstore=%q", got, want, record, payload)
	}
}

func assertFailedQuarantineDiagnosticForTest(t *testing.T, diagnostics []stateIsolationDiagnostic, failureText string) {
	t.Helper()
	if len(diagnostics) == 0 {
		t.Fatal("missing quarantine failure diagnostic")
	}
	for _, diagnostic := range diagnostics {
		if !strings.Contains(diagnostic.Message, failureText) {
			t.Fatalf("diagnostic does not contain %q: %+v", failureText, diagnostic)
		}
	}
}

func assertStoreBytesForTest(t *testing.T, path string, expected []byte) {
	t.Helper()
	actual, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read original store: %v", err)
	}
	if !bytes.Equal(actual, expected) {
		t.Fatalf("original store bytes changed:\nwant=%q\n got=%q", expected, actual)
	}
}
