package localservice

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyMigrationRetiresEveryAttemptedRowAndPreservesOtherState(t *testing.T) {
	temp := t.TempDir()
	modelsRoot := filepath.Join(temp, "models")
	goodManifest := makeLegacyMigrationDirectory(t, modelsRoot, "good", true)
	badManifest := makeLegacyMigrationDirectory(t, modelsRoot, "bad", false)
	statePath := filepath.Join(temp, "local-state.json")
	writeLegacyMigrationState(t, statePath, map[string]any{
		"schemaVersion": 2,
		"savedAt":       "2026-01-01T00:00:00Z",
		"assets": []any{
			legacyMigrationRow("legacy-good", goodManifest),
			legacyMigrationRow("legacy-bad", badManifest),
		},
		"services":  []any{map[string]any{"serviceId": "retired-service"}},
		"transfers": []any{},
		"audits":    []any{map[string]any{"id": "audit-keep"}},
	})

	svc, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()

	report, err := svc.MigrateLegacyResolvedAssetsToModelAssetStore(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.ReforgedCount != 1 || report.MergedCount != 0 || report.LeftWithWarningCount != 1 || len(report.Items) != 2 {
		t.Fatalf("migration report = %+v", report)
	}

	document := readLegacyMigrationState(t, statePath)
	if _, exists := document["services"]; exists {
		t.Fatalf("retired LocalService state was retained: %s", document["services"])
	}
	var audits []localStateAuditState
	if err := json.Unmarshal(document["audits"], &audits); err != nil || len(audits) != 1 || audits[0].ID != "audit-keep" {
		t.Fatalf("unrelated state section changed: value=%s err=%v", document["audits"], err)
	}
	if _, exists := document["assets"]; exists {
		t.Fatalf("retired LocalAsset rows were retained: %s", document["assets"])
	}
}

func TestLegacyMigrationStateWriteFailureDoesNotReportCompletion(t *testing.T) {
	temp := t.TempDir()
	modelsRoot := filepath.Join(temp, "models")
	manifest := makeLegacyMigrationDirectory(t, modelsRoot, "write-failure", true)
	statePath := filepath.Join(temp, "local-state.json")
	writeLegacyMigrationState(t, statePath, map[string]any{
		"schemaVersion": 2,
		"savedAt":       "2026-01-01T00:00:00Z",
		"assets":        []any{legacyMigrationRow("legacy-write-failure", manifest)},
		"services":      []any{},
	})

	svc, err := NewForLocalModelRecovery(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 8, modelsRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	svc.saveModelAssetStore = func(path string, snapshot modelAssetStoreSnapshot) error {
		if err := saveModelAssetStore(path, snapshot); err != nil {
			return err
		}
		if err := os.Remove(statePath); err != nil {
			return err
		}
		return os.Mkdir(statePath, 0o700)
	}

	report, err := svc.MigrateLegacyResolvedAssetsToModelAssetStore(context.Background())
	if err == nil {
		t.Fatal("migration unexpectedly reported success after state commit failed")
	}
	if report.ReforgedCount != 0 || report.MergedCount != 0 || report.LeftWithWarningCount != 1 || len(report.Items) != 1 {
		t.Fatalf("write-failure report = %+v", report)
	}
	if report.Items[0].Disposition != LegacyAssetMigrationLeftWithWarning || !strings.Contains(report.Items[0].Warning, "retired state row was not removed") {
		t.Fatalf("write-failure item = %+v", report.Items[0])
	}
}

func makeLegacyMigrationDirectory(t *testing.T, modelsRoot string, name string, withPayload bool) string {
	t.Helper()
	directory := filepath.Join(modelsRoot, "resolved", name)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if withPayload {
		if err := os.WriteFile(filepath.Join(directory, "model.bin"), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	manifest := filepath.Join(directory, localAssetManifestFileName)
	if err := os.WriteFile(manifest, []byte(`{"schema_version":"1.0.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func legacyMigrationRow(id string, manifest string) map[string]any {
	return map[string]any{
		"localAssetId":         id,
		"assetId":              "local-import/" + id + "/instance",
		"displayName":          id,
		"entry":                "model.bin",
		"sourceRepo":           "file://" + filepath.ToSlash(manifest),
		"engine":               "retired-engine-fact",
		"localInvokeProfileId": "retired-profile-fact",
	}
}

func writeLegacyMigrationState(t *testing.T, path string, document map[string]any) {
	t.Helper()
	payload, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readLegacyMigrationState(t *testing.T, path string) map[string]json.RawMessage {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	return document
}
