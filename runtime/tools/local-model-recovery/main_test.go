package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/protobuf/types/known/structpb"
)

type migrationCommandReport struct {
	Mode      string                                  `json:"mode"`
	NoOp      bool                                    `json:"noOp"`
	Migration localservice.LegacyAssetMigrationReport `json:"migration"`
}

func TestMigrateLegacyStateAssetsReforgesMergesRederivesAndIsIdempotent(t *testing.T) {
	root := filepath.Join(t.TempDir(), "models")
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	directory, manifestPath := makeLegacyResolvedDirectory(t, root, "legacy-command", true)
	writeLegacyState(t, statePath, "legacy-command-1", manifestPath)

	first := runMigrationCommand(t, root, statePath)
	if first.NoOp || len(first.Migration.Items) != 1 || first.Migration.Items[0].Disposition != localservice.LegacyAssetMigrationReforged {
		t.Fatalf("first migration report = %+v", first)
	}
	modelAssetID := first.Migration.Items[0].ModelAssetID
	if modelAssetID == "" || canonicalPath(first.Migration.Items[0].Directory) != canonicalPath(directory) {
		t.Fatalf("reforged identity = %+v", first.Migration.Items[0])
	}
	assertStateAssetCount(t, statePath, 0)
	storePath := filepath.Join(filepath.Dir(statePath), "model-assets.json")
	setStoredCatalogVerification(t, storePath, "MODEL_ASSET_CATALOG_VERIFICATION_MATCHED")

	writeLegacyState(t, statePath, "legacy-command-2", manifestPath)
	second := runMigrationCommand(t, root, statePath)
	if second.NoOp || len(second.Migration.Items) != 1 || second.Migration.Items[0].Disposition != localservice.LegacyAssetMigrationMerged || second.Migration.Items[0].ModelAssetID != modelAssetID {
		t.Fatalf("merge migration report = %+v", second)
	}
	if got := storedCatalogVerification(t, storePath); got != "MODEL_ASSET_CATALOG_VERIFICATION_NOT_MATCHED" {
		t.Fatalf("MATCHED catalog verification was not re-derived: got %q", got)
	}
	assertStateAssetCount(t, statePath, 0)

	third := runMigrationCommand(t, root, statePath)
	if !third.NoOp || len(third.Migration.Items) != 0 || third.Migration.MergedCount != 0 || third.Migration.ReforgedCount != 0 {
		t.Fatalf("idempotent migration report = %+v", third)
	}
}

func TestMigrateLegacyStateAssetsReportsUnrecoverablePayloadAndRetiresStateRow(t *testing.T) {
	root := filepath.Join(t.TempDir(), "models")
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	_, manifestPath := makeLegacyResolvedDirectory(t, root, "legacy-empty", false)
	writeLegacyState(t, statePath, "legacy-empty-1", manifestPath)

	report := runMigrationCommand(t, root, statePath)
	if len(report.Migration.Items) != 1 || report.Migration.Items[0].Disposition != localservice.LegacyAssetMigrationLeftWithWarning || report.Migration.Items[0].Warning == "" {
		t.Fatalf("left-with-warning report = %+v", report)
	}
	after, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(after, &document); err != nil {
		t.Fatal(err)
	}
	if _, exists := document["services"]; exists {
		t.Fatalf("explicit recovery retained retired LocalService section: %s", after)
	}
	if _, exists := document["assets"]; exists {
		t.Fatalf("explicit recovery retained an unrecoverable retired LocalAsset row: %s", after)
	}
}

func TestMigrateLegacyStateAssetsFailsFastWhileRuntimeOwnsState(t *testing.T) {
	root := filepath.Join(t.TempDir(), "models")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	writeEmptyState(t, statePath)
	owner, err := localservice.NewForLocalModelRecovery(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		auditlog.New(8, 8),
		statePath,
		8,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := run([]string{"--models-root", root, "--state-store", statePath, "--migrate-legacy-state-assets"}, &stdout, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "stop runtime first") || stdout.Len() != 0 {
		t.Fatalf("locked migration code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
}

type adoptionCommandReport struct {
	Mode            string `json:"mode"`
	FailedCount     int    `json:"failedCount"`
	ModelAssetCount int    `json:"modelAssetCount"`
	AdoptionResults []struct {
		Directory    string `json:"managed_manifest_directory"`
		ModelAssetID string `json:"model_asset_id"`
		State        string `json:"state"`
		Message      string `json:"message"`
	} `json:"adoptionResults"`
}

func TestAdoptResolvedDirectoriesReportsMixedResultsAndContinues(t *testing.T) {
	temp := t.TempDir()
	root := filepath.Join(temp, "models")
	statePath := filepath.Join(temp, "local-state.json")
	writeEmptyState(t, statePath)
	for _, name := range []string{"a-reimportable", "c-reimportable"} {
		directory := filepath.Join(root, "resolved", name)
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "model.bin"), []byte(name+"-payload"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "asset.manifest.json"), []byte(`{"entry":"model.bin","files":["model.bin"]}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	failedDirectory := filepath.Join(root, "resolved", "b-failed")
	if err := os.MkdirAll(failedDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(failedDirectory, "asset.manifest.json"), []byte(`{"entry":`), 0o600); err != nil {
		t.Fatal(err)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		var stdout bytes.Buffer
		var stderr bytes.Buffer
		code := run([]string{"--models-root", root, "--state-store", statePath, "--adopt"}, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("attempt %d exit code=%d stdout=%q stderr=%q", attempt, code, stdout.String(), stderr.String())
		}
		var report adoptionCommandReport
		if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
			t.Fatalf("attempt %d decode report: %v; output=%q", attempt, err, stdout.String())
		}
		if report.Mode != "adopt" || report.FailedCount != 1 || report.ModelAssetCount != 2 || len(report.AdoptionResults) != 3 {
			t.Fatalf("attempt %d incomplete report: %+v", attempt, report)
		}
		states := make(map[string]string, len(report.AdoptionResults))
		for _, result := range report.AdoptionResults {
			states[filepath.Base(result.Directory)] = result.State
		}
		if states["a-reimportable"] != "completed" || states["b-failed"] != "failed" || states["c-reimportable"] != "completed" {
			t.Fatalf("attempt %d adoption states=%v", attempt, states)
		}
		if !strings.Contains(stderr.String(), "adoption completed with 1 failed item") {
			t.Fatalf("attempt %d missing failure summary: %q", attempt, stderr.String())
		}
	}
}

func TestMigrationOptionsProducePrepareableImageDraftWithoutCommit(t *testing.T) {
	temp := t.TempDir()
	root := filepath.Join(temp, "models")
	statePath := filepath.Join(temp, "local-state.json")
	writeEmptyState(t, statePath)
	svc, err := localservice.NewForLocalModelRecovery(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		auditlog.New(8, 8),
		statePath,
		8,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()

	legacyPortable := map[string]any{
		"modelFamily": "z-image",
		"recipeId":    "z-image",
		"executionOptions": map[string]any{
			"steps": 8,
			"width": 768,
		},
	}
	rawOptions, err := structpb.NewStruct(legacyPortable)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		RecipeId:           "z-image",
		Options:            rawOptions,
		DisplayName:        "Legacy image raw options",
	}); err == nil {
		t.Fatal("raw legacy image topology unexpectedly passed current Prepare")
	}

	prepared, err := svc.PrepareLoadout(context.Background(), &runtimev1.PrepareLoadoutRequest{
		CapabilityContract: capabilitydriver.StableDiffusionCapabilityContract,
		RecipeId:           "z-image",
		Options:            migrationOptions(legacyPortable),
		DisplayName:        "Legacy image migration draft",
	})
	if err != nil {
		t.Fatalf("sanitized migration draft Prepare: %v", err)
	}
	options := prepared.GetProposedLoadout().GetOptions().AsMap()
	if _, exists := options["modelFamily"]; exists {
		t.Fatalf("migration draft retained modelFamily: %v", options)
	}
	if _, exists := options["recipeId"]; exists {
		t.Fatalf("migration draft retained recipeId: %v", options)
	}
	if _, exists := options["executionOptions"]; !exists {
		t.Fatalf("migration draft lost executionOptions: %v", options)
	}
	loadouts, err := svc.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(loadouts.GetAggregate().GetLoadouts()) != 0 {
		t.Fatalf("Prepare-only migration committed user state: %+v", loadouts.GetAggregate().GetLoadouts())
	}
}

type configurationMigrationCommandReport struct {
	Mode  string `json:"mode"`
	Items []struct {
		RowIndex        int    `json:"row_index"`
		ConfigurationID string `json:"configuration_id"`
		Status          string `json:"status"`
		FailureReason   string `json:"failure_reason"`
	} `json:"items"`
}

func TestConfigurationMigrationReportIsolatesInvalidSiblingRow(t *testing.T) {
	temp := t.TempDir()
	root := filepath.Join(temp, "models")
	statePath := filepath.Join(temp, "local-state.json")
	writeEmptyState(t, statePath)
	writeJSONFile(t, filepath.Join(temp, "machine-local-ai-configuration.json"), map[string]any{
		"schemaVersion": 1,
		"configurations": []any{
			map[string]any{"configuration": map[string]any{
				"configuration_id": "healthy-image", "capability_contract": capabilitydriver.StableDiffusionCapabilityContract,
				"implementation": map[string]any{
					"implementation_id": capabilitydriver.StableDiffusionImplementationID,
					"driver_id":         capabilitydriver.StableDiffusionDriverID, "driver_dialect": capabilitydriver.StableDiffusionDriverDialect,
				},
				"portable_config": map[string]any{"modelFamily": "z-image", "recipeId": "z-image"},
				"exact_bindings":  []any{}, "supported_features": []any{}, "display_name": "Healthy image",
			}},
			map[string]any{"configuration": map[string]any{
				"configuration_id": "", "capability_contract": capabilitydriver.StableDiffusionCapabilityContract,
			}},
		},
	})

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := run([]string{"--models-root", root, "--state-store", statePath, "--migrate-configurations"}, &stdout, &stderr)
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("configuration report code=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
	}
	var report configurationMigrationCommandReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("decode configuration report: %v; output=%q", err, stdout.String())
	}
	if report.Mode != "migrate-configurations" || len(report.Items) != 2 {
		t.Fatalf("configuration report omitted sibling: %+v", report)
	}
	if report.Items[0].RowIndex != 0 || report.Items[0].ConfigurationID != "healthy-image" || report.Items[0].Status != "failed" {
		t.Fatalf("healthy encoded sibling result=%+v", report.Items[0])
	}
	if report.Items[1].RowIndex != 1 || report.Items[1].Status != "failed" || !strings.Contains(report.Items[1].FailureReason, "incomplete identity") {
		t.Fatalf("invalid sibling result=%+v", report.Items[1])
	}
}

func runMigrationCommand(t *testing.T, root string, statePath string) migrationCommandReport {
	t.Helper()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := run([]string{"--models-root", root, "--state-store", statePath, "--migrate-legacy-state-assets"}, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("migration command code=%d stderr=%q stdout=%q", code, stderr.String(), stdout.String())
	}
	var report migrationCommandReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf("decode migration report: %v; output=%q", err, stdout.String())
	}
	if report.Mode != "migrate-legacy-state-assets" {
		t.Fatalf("migration mode = %q", report.Mode)
	}
	return report
}

func makeLegacyResolvedDirectory(t *testing.T, root string, name string, withPayload bool) (string, string) {
	t.Helper()
	directory := filepath.Join(root, "resolved", name)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if withPayload {
		if err := os.WriteFile(filepath.Join(directory, "model.bin"), []byte(name+"-payload"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	manifestPath := filepath.Join(directory, "asset.manifest.json")
	if err := os.WriteFile(manifestPath, []byte(`{"schema_version":"1.0.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return directory, manifestPath
}

func writeLegacyState(t *testing.T, statePath string, localAssetID string, manifestPath string) {
	t.Helper()
	document := map[string]any{
		"schemaVersion": 2,
		"savedAt":       "2026-01-01T00:00:00Z",
		"assets": []any{map[string]any{
			"localAssetId":         localAssetID,
			"assetId":              "local-import/" + localAssetID + "/instance",
			"displayName":          localAssetID,
			"engine":               "llama",
			"preferredEngine":      "llama",
			"fallbackEngines":      []string{"llama-cpu"},
			"bundleState":          2,
			"localInvokeProfileId": "legacy-profile",
			"engineConfig":         map[string]any{"backend": "legacy"},
			"entry":                "model.bin",
			"sourceRepo":           "file://" + filepath.ToSlash(manifestPath),
			"sourceRevision":       "import",
			"status":               2,
		}},
		"services":  []any{},
		"transfers": []any{},
		"audits":    []any{},
	}
	writeJSONFile(t, statePath, document)
}

func writeEmptyState(t *testing.T, statePath string) {
	t.Helper()
	writeJSONFile(t, statePath, map[string]any{
		"schemaVersion": 2,
		"savedAt":       "2026-01-01T00:00:00Z",
		"assets":        []any{},
		"services":      []any{},
		"transfers":     []any{},
		"audits":        []any{},
	})
}

func writeJSONFile(t *testing.T, path string, value any) {
	t.Helper()
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertStateAssetCount(t *testing.T, statePath string, want int) {
	t.Helper()
	var document struct {
		Assets []json.RawMessage `json:"assets"`
	}
	payload, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Assets) != want {
		t.Fatalf("state asset count=%d, want %d", len(document.Assets), want)
	}
}

func setStoredCatalogVerification(t *testing.T, storePath string, verification string) {
	t.Helper()
	document := readObjectFile(t, storePath)
	rows := document["assets"].([]any)
	row := rows[0].(map[string]any)
	asset := row["asset"].(map[string]any)
	asset["catalog_verification"] = verification
	writeJSONFile(t, storePath, document)
}

func storedCatalogVerification(t *testing.T, storePath string) string {
	t.Helper()
	document := readObjectFile(t, storePath)
	rows := document["assets"].([]any)
	row := rows[0].(map[string]any)
	asset := row["asset"].(map[string]any)
	return asset["catalog_verification"].(string)
}

func readObjectFile(t *testing.T, path string) map[string]any {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	return document
}

func canonicalPath(path string) string {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	return strings.ToLower(filepath.Clean(absolute))
}
