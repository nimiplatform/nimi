package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

type maintenanceFixtureForTest struct {
	maintenance *ProductControlMaintenance
	audit       *auditlog.Store
	recordPath  string
	refused     string
	activation  string
	writes      []string
	writeErr    error
}

func openMaintenanceAuditForTest(t *testing.T) *auditlog.Store {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "runtime", "maintenance", "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store, err := auditlog.Open(backend, nil, 64, 16)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func newProductControlMaintenanceFixtureForTest(t *testing.T) *maintenanceFixtureForTest {
	t.Helper()
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	refused := filepath.Join(home, "refused-root")
	ready := readyProductControlForReplacementTest(t, service, refused)
	if err := os.MkdirAll(filepath.Join(refused, "accounts", "runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(refused, "accounts", "runtime", "memory.db"), []byte("retired layout"), 0o600); err != nil {
		t.Fatal(err)
	}
	recordPath, err := service.productControlRecordPath()
	if err != nil {
		t.Fatal(err)
	}
	fixture := &maintenanceFixtureForTest{recordPath: recordPath, refused: refused, activation: ready.Record.DataRoot.RootActivationID, audit: openMaintenanceAuditForTest(t)}
	fixture.maintenance = fixture.newMaintenance(t, fixture.audit)
	return fixture
}

func (f *maintenanceFixtureForTest) newMaintenance(t *testing.T, audit *auditlog.Store) *ProductControlMaintenance {
	t.Helper()
	maintenance, err := NewProductControlMaintenance(
		nil,
		filepath.Dir(f.recordPath),
		ProductControlDataRootSecurityBinding{},
		func(string) error { return nil },
		func(target string) (bool, error) {
			f.writes = append(f.writes, target)
			return true, f.writeErr
		},
		audit,
	)
	if err != nil {
		t.Fatal(err)
	}
	return maintenance
}

func treeDigestForTest(t *testing.T, root string) string {
	t.Helper()
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		hash.Write([]byte(rel + "\x00"))
		if entry.Type().IsRegular() {
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			hash.Write(raw)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(hash.Sum(nil))
}

func fileDigestForTest(t *testing.T, path string) [32]byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(raw)
}

func (f *maintenanceFixtureForTest) replace(t *testing.T, target string) productControlRecordProjection {
	t.Helper()
	response, err := f.maintenance.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target})
	return decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
}

func TestMaintenanceReplacementRefusesNonEmptyAndOverlappingFoldersWithoutAnyChange(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	recordBefore := fileDigestForTest(t, fixture.recordPath)
	refusedBefore := treeDigestForTest(t, fixture.refused)

	occupied := t.TempDir()
	if err := os.WriteFile(filepath.Join(occupied, "notes.txt"), []byte("mine"), 0o600); err != nil {
		t.Fatal(err)
	}
	for target, reason := range map[string]string{
		occupied:                                "DATA_ROOT_NOT_EMPTY",
		fixture.refused:                         "DATA_ROOT_OVERLAPS_CURRENT",
		filepath.Join(fixture.refused, "fresh"): "DATA_ROOT_OVERLAPS_CURRENT",
	} {
		projection := fixture.replace(t, target)
		if projection.Activation == nil || projection.Activation.Activated || projection.Activation.ReasonCode != reason {
			t.Fatalf("%s: activation = %+v", target, projection.Activation)
		}
	}
	if fileDigestForTest(t, fixture.recordPath) != recordBefore || treeDigestForTest(t, fixture.refused) != refusedBefore {
		t.Fatal("refused replacement changed the record or the refused root")
	}
	if len(fixture.writes) != 0 {
		t.Fatalf("derived config written for a refused target: %v", fixture.writes)
	}
	if entries, _ := os.ReadDir(occupied); len(entries) != 1 {
		t.Fatalf("occupied folder was changed: %v", entries)
	}
}

func TestMaintenanceReplacementActivatesAnEmptyFolderAndNeverTouchesTheRefusedRoot(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	refusedBefore := treeDigestForTest(t, fixture.refused)
	target := filepath.Join(t.TempDir(), "fresh-nimi")

	projection := fixture.replace(t, target)
	if projection.Activation == nil || !projection.Activation.Activated ||
		projection.Activation.ReasonCode != "DATA_ROOT_REPLACED" ||
		projection.Activation.ActionHint != "restart_runtime_and_check_sync" {
		t.Fatalf("activation = %+v", projection.Activation)
	}
	record := projection.Record
	if record == nil || record.State != productControlStateReadyForUse || record.DataRoot == nil ||
		!productControlPathsEqual(record.DataRoot.Path, target) ||
		record.DataRoot.RootActivationID == "" || record.DataRoot.RootActivationID == fixture.activation {
		t.Fatalf("committed record = %+v", record)
	}
	if projection.RootHandoff == nil || projection.RootHandoff.Disposition != "committed_restart_required" ||
		projection.RootHandoff.RootActivationID != record.DataRoot.RootActivationID {
		t.Fatalf("root handoff = %+v", projection.RootHandoff)
	}
	if len(fixture.writes) != 1 || !productControlPathsEqual(fixture.writes[0], target) {
		t.Fatalf("derived config writes = %v", fixture.writes)
	}
	for _, directory := range nimiDataRootRequiredDirectories {
		if info, err := os.Stat(filepath.Join(target, directory)); err != nil || !info.IsDir() {
			t.Fatalf("minimum layout %s missing: %v", directory, err)
		}
	}
	if treeDigestForTest(t, fixture.refused) != refusedBefore {
		t.Fatal("replacement read-modified the refused root")
	}
	events, err := fixture.audit.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: productControlAuditDomain})
	if err != nil || len(events.GetEvents()) != 1 ||
		events.GetEvents()[0].GetOperation() != productControlAuditOperation ||
		events.GetEvents()[0].GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED ||
		!events.GetEvents()[0].GetPayload().GetFields()["from_refused_stored_data"].GetBoolValue() ||
		events.GetEvents()[0].GetPayload().GetFields()["root_activation_id"].GetStringValue() != record.DataRoot.RootActivationID {
		t.Fatalf("maintenance plane does not hold exactly the recorded replacement: %v %+v", err, events.GetEvents())
	}

	var persisted productControlRecord
	raw, err := os.ReadFile(fixture.recordPath)
	if err != nil || json.Unmarshal(raw, &persisted) != nil || persisted.DataRoot == nil ||
		persisted.DataRoot.RootActivationID != record.DataRoot.RootActivationID {
		t.Fatalf("canonical record not committed: %v %s", err, raw)
	}
	response, err := fixture.maintenance.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	read := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if read.RootHandoff == nil || read.RootHandoff.Disposition != "committed_restart_required" {
		t.Fatalf("post-commit record read = %+v", read.RootHandoff)
	}
	if _, err := fixture.maintenance.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: filepath.Join(t.TempDir(), "again")}); err == nil ||
		!strings.Contains(err.Error(), "restart") {
		t.Fatalf("second replacement before restart = %v", err)
	}

	selected, err := fixture.maintenance.GetProductControlSelectedDataRoot(context.Background(), &runtimev1.GetProductControlSelectedDataRootRequest{})
	if err != nil {
		t.Fatal(err)
	}
	var selectedProjection productControlSelectedDataRootProjection
	if err := json.Unmarshal([]byte(selected.GetJson()), &selectedProjection); err != nil {
		t.Fatal(err)
	}
	if selectedProjection.DataRoot == nil || !productControlPathsEqual(selectedProjection.DataRoot.Path, target) || selectedProjection.HostProfileScopeRoot != nil {
		t.Fatalf("selected root projection = %+v", selectedProjection)
	}
}

func TestMaintenanceReplacementKeepsTheNewSelectionInRepairWhenDerivedConfigFails(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	fixture.writeErr = errors.New("disk full")
	target := filepath.Join(t.TempDir(), "fresh-nimi")
	projection := fixture.replace(t, target)
	if projection.ConfigMutation == nil || projection.ConfigMutation.Disposition != "repair_required" {
		t.Fatalf("config mutation = %+v", projection.ConfigMutation)
	}
	if projection.Record == nil || projection.Record.State != productControlStateRepairRequired ||
		!productControlPathsEqual(projection.Record.DataRoot.Path, target) {
		t.Fatalf("record = %+v", projection.Record)
	}
	if projection.RootHandoff == nil || projection.RootHandoff.Disposition != "committed_repair_required" {
		t.Fatalf("root handoff = %+v", projection.RootHandoff)
	}
}

func TestMaintenanceReplacementIsNeverActivatedWhenItCannotBeRecorded(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	unrecorded := fixture.newMaintenance(t, nil)
	recordBefore := fileDigestForTest(t, fixture.recordPath)
	target := filepath.Join(t.TempDir(), "fresh-nimi")
	_, err := unrecorded.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target})
	if !errors.Is(err, auditlog.ErrUnrecorded) {
		t.Fatalf("unrecordable replacement error = %v", err)
	}
	if fileDigestForTest(t, fixture.recordPath) != recordBefore || len(fixture.writes) != 0 {
		t.Fatalf("unrecordable replacement was activated: writes=%v", fixture.writes)
	}
	// The failed attempt left only Nimi's own empty layout: retrying the same
	// folder is still a new empty location.
	if projection := fixture.replace(t, target); projection.Activation == nil || !projection.Activation.Activated {
		t.Fatalf("retry of the same folder after an unrecorded attempt = %+v", projection.Activation)
	}
}

func TestMaintenanceReplacementRequiresAReadySelection(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	var record map[string]any
	raw, err := os.ReadFile(fixture.recordPath)
	if err != nil || json.Unmarshal(raw, &record) != nil {
		t.Fatal(err)
	}
	record["state"] = string(productControlStateDataRootSelected)
	raw, _ = json.Marshal(record)
	if err := os.WriteFile(fixture.recordPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "fresh-nimi")
	if _, err := fixture.maintenance.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target}); err == nil {
		t.Fatal("maintenance replacement accepted a non-ready selection")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) || len(fixture.writes) != 0 {
		t.Fatalf("non-ready replacement mutated the target or config: %v %v", err, fixture.writes)
	}
}

func TestMaintenanceTargetEmptinessIgnoresOnlyFolderViewMetadata(t *testing.T) {
	folder := t.TempDir()
	if empty, err := productControlMaintenanceTargetEmpty(filepath.Join(folder, "absent")); err != nil || !empty {
		t.Fatalf("absent = %v %v", empty, err)
	}
	for _, name := range []string{".DS_Store", "desktop.ini", "Thumbs.db"} {
		if err := os.WriteFile(filepath.Join(folder, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if empty, err := productControlMaintenanceTargetEmpty(folder); err != nil || !empty {
		t.Fatalf("metadata only = %v %v", empty, err)
	}
	if err := os.WriteFile(filepath.Join(folder, ".nimi-hidden"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if empty, err := productControlMaintenanceTargetEmpty(folder); err != nil || empty {
		t.Fatalf("hidden user file counted as empty: %v %v", empty, err)
	}

	layout := t.TempDir()
	for _, directory := range nimiDataRootRequiredDirectories {
		if err := os.MkdirAll(filepath.Join(layout, directory), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(layout, "accounts", "runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if empty, err := productControlMaintenanceTargetEmpty(layout); err != nil || !empty {
		t.Fatalf("Nimi's own empty layout = %v %v", empty, err)
	}
	if err := os.WriteFile(filepath.Join(layout, "accounts", "runtime", "memory.db"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if empty, err := productControlMaintenanceTargetEmpty(layout); err != nil || empty {
		t.Fatalf("a file inside the layout counted as empty: %v %v", empty, err)
	}
	other := t.TempDir()
	if err := os.Mkdir(filepath.Join(other, "Photos"), 0o700); err != nil {
		t.Fatal(err)
	}
	if empty, err := productControlMaintenanceTargetEmpty(other); err != nil || empty {
		t.Fatalf("a user folder counted as empty: %v %v", empty, err)
	}
}
