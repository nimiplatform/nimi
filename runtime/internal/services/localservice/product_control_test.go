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
	mustProductControlForTest(t, response, err)
	response, err = service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "local-speech-ready",
	})
	configured := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if configured.State != productControlStateAIEnvironmentUnconfigured {
		t.Fatalf("configured state = %s", configured.State)
	}
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("remove ephemeral data root: %v", err)
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	recovered := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if recovered.State != productControlStateDataRootMissing || recovered.Record == nil || recovered.Record.State != productControlStateAIEnvironmentUnconfigured || recovered.Record.DataRoot != nil {
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

func TestRuntimeProductControlMissingSetupDataRootRequiresRepair(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "admitted-trial-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)

	path, err := service.productControlRecordPath()
	if err != nil {
		t.Fatal(err)
	}
	record, err := readProductControlRecord(path)
	if err != nil {
		t.Fatal(err)
	}
	record.State = productControlStateLocalAIProfileNotReady
	record.FirstRun.InstallLevel = stringPtr("minimal")
	record.FirstRun.AIProfileAlias = stringPtr("local-speech-ready")
	if err := writeProductControlRecord(path, record); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("remove admitted data root: %v", err)
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	repair := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if repair.State != productControlStateRepairRequired || repair.Record == nil || repair.Record.State != productControlStateLocalAIProfileNotReady {
		t.Fatalf("missing setup projection = %+v", repair)
	}
	if repair.Error == nil || !strings.Contains(*repair.Error, "owner verification rejected") {
		t.Fatalf("missing setup projection error = %v", repair.Error)
	}
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: filepath.Join(home, "forbidden-replacement")}); err == nil {
		t.Fatal("setup data root replacement should fail closed")
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

func TestRuntimeProductControlInstallLevelValidatesPresetAlias(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)

	if _, err := service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "cloud-first",
	}); err == nil {
		t.Fatalf("unknown first-run alias should fail closed")
	}
	response, err = service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "local-speech-ready",
	})
	configured := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if configured.State != productControlStateAIEnvironmentUnconfigured {
		t.Fatalf("configured state = %s", configured.State)
	}
}

func TestRuntimeProductControlConfirmedInstallLevelEntersSetup(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err := service.SelectProductControlDataRoot(
		context.Background(),
		&runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot},
	)
	mustProductControlForTest(t, response, err)
	response, err = service.CompleteProductControlFirstRunDeviceEnvironmentScan(
		context.Background(),
		&runtimev1.CompleteProductControlFirstRunDeviceEnvironmentScanRequest{},
	)
	scanned := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if scanned.State != productControlStateAIEnvironmentUnconfigured {
		t.Fatalf("scanned state = %s", scanned.State)
	}

	response, err = service.SetProductControlFirstRunInstallLevel(
		context.Background(),
		&runtimev1.SetProductControlFirstRunInstallLevelRequest{
			InstallLevel:   "minimal",
			AiProfileAlias: "local-speech-ready",
		},
	)
	confirmed := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if confirmed.State != productControlStateLocalAIProfileAssetsMissing {
		t.Fatalf("confirmed state = %s", confirmed.State)
	}
}

func TestRuntimeProductControlAdmitsReadyForUseAndReadProjection(t *testing.T) {
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
	profileUnconfigured := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if profileUnconfigured.State != productControlStateAIEnvironmentUnconfigured ||
		profileUnconfigured.Record == nil ||
		profileUnconfigured.Record.FirstRun.Completed {
		t.Fatalf("unconfigured factory profile admission = %+v", profileUnconfigured)
	}
	response, err = service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "local-speech-ready",
	})
	mustProductControlForTest(t, response, err)

	response, err = service.AdmitProductControlReadyForUse(context.Background(), &runtimev1.AdmitProductControlReadyForUseRequest{})
	dependenciesMissing := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if dependenciesMissing.State != productControlStateLocalAIProfileAssetsMissing ||
		dependenciesMissing.Record == nil ||
		dependenciesMissing.Record.FirstRun.Completed {
		t.Fatalf("dependency-gated ready admission = %+v", dependenciesMissing)
	}

	profileResponse, err := service.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
	if err != nil || profileResponse.GetProfile() == nil {
		t.Fatalf("collect device profile: response=%+v err=%v", profileResponse, err)
	}
	consumers, ok := productControlFirstRunConsumerSet("minimal")
	if !ok {
		t.Fatal("minimal first-run consumer set is unavailable")
	}
	bindings, err := service.resolveProductControlFirstRunConsumerBindings("minimal", profileResponse.GetProfile(), consumers)
	if err != nil {
		t.Fatalf("resolve current minimal model set: %v", err)
	}
	for _, binding := range bindings {
		markProductControlFirstRunConsumerReady(t, service, dataRoot, binding, profileResponse.GetProfile())
	}
	reconciliation := service.deriveProductControlFirstRunSetupReconciliation("minimal", dataRoot)
	if !reconciliation.LocalAIReady {
		t.Fatalf("prepared dependency and activation gates = %+v", reconciliation)
	}

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
	if len(firstRunFields) != 4 {
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

	service.mu.Lock()
	service.localEnvironmentSelectedSources = make(map[string]localEnvironmentSelectedSourceRecordState)
	service.mu.Unlock()
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	staleRead := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if staleRead.State != productControlStateLocalAIProfileAssetsMissing ||
		staleRead.Record == nil ||
		staleRead.Record.State != productControlStateReadyForUse ||
		staleRead.Error == nil {
		t.Fatalf("ready read did not recheck dependency and activation gates: %+v", staleRead)
	}
	response, err = service.ReconcileProductControlFirstRunSetupState(
		context.Background(),
		&runtimev1.ReconcileProductControlFirstRunSetupStateRequest{},
	)
	reconciled := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if reconciled.State != productControlStateLocalAIProfileAssetsMissing || reconciled.Record == nil {
		t.Fatalf("ready record with lost dependencies was not reopened for setup: %+v", reconciled)
	}
	if reconciled.Record.FirstRun.Completed ||
		reconciled.Record.FirstRun.CompletedAt != nil ||
		reconciled.Record.DataRoot == nil ||
		reconciled.Record.DataRoot.Status != productDataRootStatusSelected {
		t.Fatalf("ready completion survived dependency reconciliation: %+v", reconciled.Record)
	}
}

func TestRuntimeProductControlFirstRunSetupReconciliationMapsActivationStates(t *testing.T) {
	ready := localEnvironmentConsumerActivationGate{ConsumerID: "llama.cpp.cpu", State: localEnvironmentActivationStateReady}
	setupRequired := localEnvironmentConsumerActivationGate{
		ConsumerID: "speech.qwen3-asr.python",
		State:      localEnvironmentActivationStateSetupRequired,
		Detail:     "dependency confirmation required",
	}
	failed := localEnvironmentConsumerActivationGate{
		ConsumerID: "speech.qwen3-tts.python",
		State:      localEnvironmentActivationStateFailed,
		Detail:     "materialization failed",
	}
	unsupported := localEnvironmentConsumerActivationGate{
		ConsumerID: "llama.cpp.cpu",
		State:      localEnvironmentActivationStateUnsupported,
		Detail:     "host unsupported",
	}

	reconciliation := productControlFirstRunSetupReconciliationFromActivationGates([]localEnvironmentConsumerActivationGate{ready, setupRequired})
	if reconciliation.State != productControlStateLocalAIProfileAssetsMissing || reconciliation.LocalAIReady {
		t.Fatalf("setup required reconciliation = %+v", reconciliation)
	}
	reconciliation = productControlFirstRunSetupReconciliationFromActivationGates([]localEnvironmentConsumerActivationGate{ready, failed})
	if reconciliation.State != productControlStateLocalAIProfileNotReady || reconciliation.LocalAIReady {
		t.Fatalf("failed reconciliation = %+v", reconciliation)
	}
	reconciliation = productControlFirstRunSetupReconciliationFromActivationGates([]localEnvironmentConsumerActivationGate{unsupported})
	if reconciliation.State != productControlStateBlocked || reconciliation.LocalAIReady {
		t.Fatalf("unsupported reconciliation = %+v", reconciliation)
	}
	reconciliation = productControlFirstRunSetupReconciliationFromActivationGates([]localEnvironmentConsumerActivationGate{ready})
	if reconciliation.State != productControlStateLocalAIReady || !reconciliation.LocalAIReady {
		t.Fatalf("ready reconciliation = %+v", reconciliation)
	}
}

func mustProductControlForTest(t *testing.T, response *runtimev1.ProductControlProjectionJson, err error) *runtimev1.ProductControlProjectionJson {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	return response
}
