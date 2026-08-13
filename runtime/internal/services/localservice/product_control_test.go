package localservice

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type fakeRuntimeAccountProjectionProvider struct {
	projection *runtimev1.AccountProjection
	ok         bool
}

func (p fakeRuntimeAccountProjectionProvider) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	return p.projection, p.ok
}

func decodeProductControlProjectionForTest(t *testing.T, response *runtimev1.ProductControlProjectionJson) productControlRecordProjection {
	t.Helper()
	var projection productControlRecordProjection
	if err := json.Unmarshal([]byte(response.GetJson()), &projection); err != nil {
		t.Fatalf("decode product-control projection: %v\n%s", err, response.GetJson())
	}
	return projection
}

func setProductControlHomeForTest(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	volume := filepath.VolumeName(home)
	if volume != "" {
		t.Setenv("HOMEDRIVE", volume)
		t.Setenv("HOMEPATH", strings.TrimPrefix(home, volume))
	}
	return home
}

func TestRuntimeProductControlCreatesAndSelectsDataRoot(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	var configuredRoot string
	service.SetProductControlDataRootConfigWriter(func(dataRootRef string) (bool, error) {
		configuredRoot = dataRootRef
		return true, nil
	})

	response, err := service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	missing := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if missing.State != productControlStateConfigMissing || missing.Exists {
		t.Fatalf("missing projection = %+v", missing)
	}

	response, err = service.EnsureProductControlRecordCreated(context.Background(), &runtimev1.EnsureProductControlRecordCreatedRequest{})
	created := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if created.State != productControlStateDataRootMissing || !created.Exists || created.Record == nil {
		t.Fatalf("created projection = %+v", created)
	}

	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err = service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	selected := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if selected.State != productControlStateDataRootSelected {
		t.Fatalf("selected state = %s", selected.State)
	}
	if configuredRoot != dataRoot || selected.ConfigMutation == nil || selected.ConfigMutation.ReasonCode != "CONFIG_RESTART_REQUIRED" || selected.ConfigMutation.Disposition != "restart_required" {
		t.Fatalf("selected config mutation root=%q projection=%+v", configuredRoot, selected.ConfigMutation)
	}
	if service.localEnvironmentRuntimeDataRoot() != dataRoot ||
		service.resolvedLocalModelsPath() != filepath.Join(dataRoot, "models") {
		t.Fatalf("selected root was not applied to the Runtime in-memory data plane")
	}
	for _, dir := range []string{"models", "dependencies", "environments", "apps", "accounts", "logs", "audit"} {
		if _, err := os.Stat(filepath.Join(dataRoot, dir)); err != nil {
			t.Fatalf("expected data-root directory %s: %v", dir, err)
		}
	}
	for _, retiredRoot := range []string{"cache", "generated", "tmp"} {
		if _, err := os.Stat(filepath.Join(dataRoot, retiredRoot)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("retired root-level directory %s was created: %v", retiredRoot, err)
		}
	}
}

func TestRuntimeProductControlSelectionRollsBackRecordWhenConfigMutationFails(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	response, err := service.EnsureProductControlRecordCreated(context.Background(), &runtimev1.EnsureProductControlRecordCreatedRequest{})
	created := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if created.Record == nil {
		t.Fatal("expected initial product-control record")
	}
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) {
		return false, errors.New("config write denied")
	})
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{
		DataRoot: filepath.Join(home, "transaction-rollback-root"),
	}); err == nil || !strings.Contains(err.Error(), "config write denied") {
		t.Fatalf("selection mutation error = %v", err)
	}
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	rolledBack := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if rolledBack.Record == nil || rolledBack.Record.InstallID != created.Record.InstallID || rolledBack.Record.DataRoot != nil || rolledBack.State != productControlStateDataRootMissing {
		t.Fatalf("selection did not roll back product-control record: %+v", rolledBack)
	}
}

func TestRuntimeProductControlMissingConfigurableDataRootReturnsToStorage(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "ephemeral-trial-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	configured := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if configured.State != productControlStateDataRootSelected {
		t.Fatalf("configured state = %s", configured.State)
	}
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("remove ephemeral data root: %v", err)
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	recovered := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if recovered.State != productControlStateDataRootMissing || recovered.Record == nil || recovered.Record.State != productControlStateDataRootSelected || recovered.Record.DataRoot != nil {
		t.Fatalf("missing configurable projection = %+v", recovered)
	}
	if recovered.Error == nil || !strings.Contains(*recovered.Error, "owner verification rejected") {
		t.Fatalf("missing configurable projection error = %v", recovered.Error)
	}

	selectedResponse, err := service.GetProductControlSelectedDataRoot(context.Background(), &runtimev1.GetProductControlSelectedDataRootRequest{})
	if err != nil {
		t.Fatalf("get selected data root: %v", err)
	}
	var selected productControlSelectedDataRootProjection
	if err := json.Unmarshal([]byte(selectedResponse.GetJson()), &selected); err != nil {
		t.Fatalf("decode selected data-root projection: %v", err)
	}
	if selected.State != productControlStateDataRootMissing || selected.DataRoot != nil || selected.Error == nil {
		t.Fatalf("missing selected data-root projection = %+v", selected)
	}
	stored, err := readProductControlRecord(recovered.Path)
	if err != nil {
		t.Fatalf("read durable configurable record: %v", err)
	}
	if selectedProductDataRootPath(stored) != dataRoot {
		t.Fatalf("read-time recovery mutated durable data root: %+v", stored)
	}

	replacement := filepath.Join(home, "replacement-trial-nimi-data")
	response, err = service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: replacement})
	reselected := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if reselected.State != productControlStateDataRootSelected || selectedProductDataRootPath(reselected.Record) != replacement {
		t.Fatalf("replacement selection = %+v", reselected)
	}
}

func TestRuntimeProductControlMissingReadyDataRootRequiresRepair(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "admitted-trial-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-ready"},
		ok:         true,
	})
	response, err = service.AdmitProductControlReadyForUse(
		context.Background(),
		&runtimev1.AdmitProductControlReadyForUseRequest{},
	)
	ready := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if ready.State != productControlStateReadyForUse {
		t.Fatalf("ready projection = %+v", ready)
	}
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("remove admitted data root: %v", err)
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	repair := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if repair.State != productControlStateRepairRequired || repair.Record == nil || repair.Record.State != productControlStateReadyForUse {
		t.Fatalf("missing ready data-root projection = %+v", repair)
	}
	if repair.Error == nil || !strings.Contains(*repair.Error, "owner verification rejected") {
		t.Fatalf("missing ready data-root projection error = %v", repair.Error)
	}
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: filepath.Join(home, "forbidden-replacement")}); err == nil {
		t.Fatal("ready data root replacement should fail closed")
	}
}

func TestRuntimeProductControlRepairRequiredBlocksSelectedProjection(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "repair-selected-projection-data")
	response, err := service.SelectProductControlDataRoot(
		context.Background(),
		&runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot},
	)
	mustProductControlForTest(t, response, err)

	path, err := service.productControlRecordPath()
	if err != nil {
		t.Fatal(err)
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		t.Fatal(err)
	}
	record.State = productControlStateRepairRequired
	record.DataRoot.Status = productDataRootStatusRepairRequired
	record.Repair = productRepairRecord{
		Required: true,
		Reason:   stringPtr("explicit repair fixture"),
	}
	if err := writeProductControlRecord(path, record); err != nil {
		t.Fatal(err)
	}

	response, err = service.GetProductControlSelectedDataRoot(
		context.Background(),
		&runtimev1.GetProductControlSelectedDataRootRequest{},
	)
	if err != nil {
		t.Fatalf("get repair-required selected projection: %v", err)
	}
	var projection productControlSelectedDataRootProjection
	if err := json.Unmarshal([]byte(response.GetJson()), &projection); err != nil {
		t.Fatalf("decode repair-required selected projection: %v", err)
	}
	if projection.State != productControlStateRepairRequired ||
		projection.DataRoot != nil ||
		projection.Error == nil {
		t.Fatalf("repair-required selected projection remained usable: %+v", projection)
	}

	response, err = service.GetProductControlRecord(
		context.Background(),
		&runtimev1.GetProductControlRecordRequest{},
	)
	repairProjection := decodeProductControlProjectionForTest(
		t,
		mustProductControlForTest(t, response, err),
	)
	if repairProjection.State != productControlStateRepairRequired ||
		repairProjection.Record == nil ||
		repairProjection.Error == nil {
		t.Fatalf("repair-required record projection appeared ready: %+v", repairProjection)
	}

	replacement := filepath.Join(home, "forbidden-repair-reselection")
	if _, err := service.SelectProductControlDataRoot(
		context.Background(),
		&runtimev1.SelectProductControlDataRootRequest{DataRoot: replacement},
	); err == nil {
		t.Fatal("normal reselection cleared explicit repair")
	}
	stored, err := readProductControlRecord(path)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.Repair.Required ||
		stored.State != productControlStateRepairRequired ||
		selectedProductDataRootPath(stored) != dataRoot {
		t.Fatalf("normal reselection mutated repair record: %+v", stored)
	}
}

func TestRuntimeProductControlRestartReusesFixedControlRootWithoutDeletingPayload(t *testing.T) {
	home := setProductControlHomeForTest(t)
	sharedDataRoot := filepath.Join(t.TempDir(), "shared-development-data")
	productControlRoot := filepath.Join(home, ".nimi")
	roundOne := newTestService(t)
	if err := roundOne.SetProductControlRoot(productControlRoot); err != nil {
		t.Fatal(err)
	}
	response, err := roundOne.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: sharedDataRoot})
	selected := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	selectedInstallID := selected.Record.InstallID

	restartedRoundOne := newTestService(t)
	if err := restartedRoundOne.SetProductControlRoot(productControlRoot); err != nil {
		t.Fatal(err)
	}
	response, err = restartedRoundOne.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	preserved := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if preserved.Record == nil || preserved.Record.InstallID != selectedInstallID || selectedProductDataRootPath(preserved.Record) != sharedDataRoot {
		t.Fatalf("restart did not preserve fixed Product Control state: %+v", preserved)
	}
	if _, err := os.Stat(sharedDataRoot); err != nil {
		t.Fatalf("Product Control restart mutated shared payload root: %v", err)
	}
}

func TestRuntimeProductControlBindsFixedInteractiveUserRootBeforeFirstUse(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	productControlRoot := filepath.Join(home, ".nimi")
	if err := service.SetProductControlRoot(productControlRoot); err != nil {
		t.Fatalf("bind fixed interactive-user Product Control root: %v", err)
	}

	response, err := service.EnsureProductControlRecordCreated(context.Background(), &runtimev1.EnsureProductControlRecordCreatedRequest{})
	created := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	expectedPath := filepath.Join(productControlRoot, "nimi.json")
	if created.Path != expectedPath {
		t.Fatalf("protected product-control path = %q, want %q", created.Path, expectedPath)
	}
	if _, err := os.Stat(expectedPath); err != nil {
		t.Fatalf("fixed Product Control record was not created: %v", err)
	}
	if created.Record == nil || created.Record.Pointers.FactoryProfileIndex != nil {
		t.Fatalf("fixed Product Control pointers = %+v", created.Record)
	}
	if err := service.SetProductControlRoot(filepath.Join(t.TempDir(), ".nimi")); err == nil || !strings.Contains(err.Error(), "already in use") {
		t.Fatalf("live product-control root replacement error = %v", err)
	}
}

func TestRuntimeProductControlRejectsForbiddenLegacyPointers(t *testing.T) {
	service := newTestService(t)
	record, err := service.emptyProductControlRecord(productControlStateDataRootMissing)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"runtimeConfigPath", "appRegistry", "appPackages"} {
		t.Run(field, func(t *testing.T) {
			clone := make(map[string]any, len(document))
			for key, value := range document {
				clone[key] = value
			}
			pointers := map[string]any{"factoryProfileIndex": nil, field: filepath.Join(t.TempDir(), "forbidden")}
			clone["pointers"] = pointers
			mutated, err := json.Marshal(clone)
			if err != nil {
				t.Fatal(err)
			}
			productControlRoot := filepath.Join(t.TempDir(), ".nimi")
			if err := os.Mkdir(productControlRoot, 0o755); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(productControlRoot, "nimi.json")
			if err := os.WriteFile(path, mutated, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readProductControlRecord(path); err == nil || !strings.Contains(err.Error(), "pointers fields are invalid") {
				t.Fatalf("forbidden pointer %s error = %v", field, err)
			}
		})
	}
}

func TestRuntimeProductControlRejectsRetiredAIFirstRunTruth(t *testing.T) {
	service := newTestService(t)
	record, err := service.emptyProductControlRecord(productControlStateDataRootMissing)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}

	t.Run("firstRun AI fields", func(t *testing.T) {
		clone := make(map[string]any, len(document))
		for key, value := range document {
			clone[key] = value
		}
		clone["firstRun"] = map[string]any{
			"installLevel":   "minimal",
			"aiProfileAlias": "local-speech",
			"completed":      false,
			"completedAt":    nil,
		}
		assertProductControlDocumentRejected(t, clone, "firstRun fields are invalid")
	})

	t.Run("retired AI state", func(t *testing.T) {
		clone := make(map[string]any, len(document))
		for key, value := range document {
			clone[key] = value
		}
		clone["state"] = "local_ai_profile_selected_environment_not_ready"
		assertProductControlDocumentRejected(t, clone, "unsupported product-control state")
	})
}

func assertProductControlDocumentRejected(t *testing.T, document map[string]any, errorText string) {
	t.Helper()
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	if err := os.Mkdir(productControlRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(productControlRoot, "nimi.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readProductControlRecord(path); err == nil || !strings.Contains(err.Error(), errorText) {
		t.Fatalf("retired Product Control truth error = %v", err)
	}
}

func TestRuntimeProductControlRetiredAISetupOperationsFailClosed(t *testing.T) {
	service := newTestService(t)
	operations := []struct {
		name string
		call func() error
	}{
		{
			name: "install-level",
			call: func() error {
				_, err := service.SetProductControlFirstRunInstallLevel(
					context.Background(),
					&runtimev1.SetProductControlFirstRunInstallLevelRequest{},
				)
				return err
			},
		},
		{
			name: "device-scan",
			call: func() error {
				_, err := service.CompleteProductControlFirstRunDeviceEnvironmentScan(
					context.Background(),
					&runtimev1.CompleteProductControlFirstRunDeviceEnvironmentScanRequest{},
				)
				return err
			},
		},
		{
			name: "setup-reconciliation",
			call: func() error {
				_, err := service.ReconcileProductControlFirstRunSetupState(
					context.Background(),
					&runtimev1.ReconcileProductControlFirstRunSetupStateRequest{},
				)
				return err
			},
		},
	}
	for _, operation := range operations {
		t.Run(operation.name, func(t *testing.T) {
			if err := operation.call(); err == nil || !strings.Contains(err.Error(), "not part of Product Control") {
				t.Fatalf("retired operation error = %v", err)
			}
		})
	}
}

func TestRuntimeProductControlAdmitsReadyForUseWithoutAIGates(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)

	response, err = service.AdmitProductControlReadyForUse(context.Background(), &runtimev1.AdmitProductControlReadyForUseRequest{})
	notLoggedIn := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if notLoggedIn.State != productControlStateNotLoggedIn ||
		notLoggedIn.Record == nil ||
		notLoggedIn.Record.FirstRun.Completed {
		t.Fatalf("unauthenticated ready admission = %+v", notLoggedIn)
	}
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-ready"},
		ok:         true,
	})

	response, err = service.AdmitProductControlReadyForUse(context.Background(), &runtimev1.AdmitProductControlReadyForUseRequest{})
	ready := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if ready.State != productControlStateReadyForUse ||
		ready.Record == nil ||
		!ready.Record.FirstRun.Completed ||
		ready.Record.FirstRun.CompletedAt == nil ||
		ready.Record.DataRoot == nil ||
		ready.Record.DataRoot.Status != productDataRootStatusReady {
		t.Fatalf("ready projection = %+v", ready)
	}
	firstRunRaw, err := json.Marshal(ready.Record.FirstRun)
	if err != nil {
		t.Fatal(err)
	}
	var firstRunFields map[string]json.RawMessage
	if err := json.Unmarshal(firstRunRaw, &firstRunFields); err != nil {
		t.Fatal(err)
	}
	if len(firstRunFields) != 2 {
		t.Fatalf("ready firstRun fields = %v", firstRunFields)
	}
	for _, field := range productControlFirstRunFields {
		if _, ok := firstRunFields[field]; !ok {
			t.Fatalf("ready firstRun is missing %q: %s", field, firstRunRaw)
		}
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	readBack := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if readBack.State != productControlStateReadyForUse || readBack.Record == nil {
		t.Fatalf("readback projection = %+v", readBack)
	}

	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{})
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	loggedOut := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if loggedOut.State != productControlStateNotLoggedIn ||
		loggedOut.Record == nil ||
		loggedOut.Record.State != productControlStateReadyForUse ||
		loggedOut.Error == nil {
		t.Fatalf("ready read did not recheck authenticated account: %+v", loggedOut)
	}
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-ready"},
		ok:         true,
	})

	// Product readiness is deliberately independent from local AI source,
	// dependency, materialization, and activation state.
	service.mu.Lock()
	service.localEnvironmentSelectedSources = make(map[string]localEnvironmentSelectedSourceRecordState)
	service.mu.Unlock()
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	stillReady := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if stillReady.State != productControlStateReadyForUse || stillReady.Record == nil || stillReady.Error != nil {
		t.Fatalf("AI dependency loss changed Product Control readiness: %+v", stillReady)
	}

	service.mu.Lock()
	service.runtimeDataRoot = filepath.Join(home, "different-protected-data-root")
	service.mu.Unlock()
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	protectedMismatch := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if protectedMismatch.State != productControlStateRepairRequired ||
		protectedMismatch.Record == nil ||
		protectedMismatch.Record.State != productControlStateReadyForUse ||
		protectedMismatch.Error == nil {
		t.Fatalf("protected Runtime mismatch did not fail closed: %+v", protectedMismatch)
	}
}

func mustProductControlForTest(t *testing.T, response *runtimev1.ProductControlProjectionJson, err error) *runtimev1.ProductControlProjectionJson {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	return response
}
