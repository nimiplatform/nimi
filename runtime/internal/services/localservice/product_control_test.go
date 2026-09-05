package localservice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestNimiDataRootDirectoryAccessProbeReadsBackAndCleansUp(t *testing.T) {
	root := t.TempDir()
	if err := verifyNimiDataRootDirectoryAccess(root); err != nil {
		t.Fatalf("verify data-root directory access: %v", err)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read probed directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("Runtime access probe left artifacts behind: %+v", entries)
	}
}

func TestNimiDataRootDirectoryAccessProbeRejectsMissingDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	err := verifyNimiDataRootDirectoryAccess(missing)
	if err == nil || !strings.Contains(err.Error(), "create Runtime access probe") {
		t.Fatalf("missing-directory access probe error = %v", err)
	}
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

func TestRuntimeProductControlSelectionSynchronizesModelsRootReaders(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return true, nil })
	service.SetProductControlDataRootConfigValidator(func(string) error { return nil })
	if _, err := service.EnsureProductControlRecordCreated(context.Background(), &runtimev1.EnsureProductControlRecordCreatedRequest{}); err != nil {
		t.Fatal(err)
	}

	stop := make(chan struct{})
	var readers sync.WaitGroup
	for range 8 {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_ = service.resolvedLocalModelsPath()
				}
			}
		}()
	}
	dataRoot := filepath.Join(home, "concurrent-model-root")
	_, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	close(stop)
	readers.Wait()
	if err != nil {
		t.Fatal(err)
	}
	if got := service.resolvedLocalModelsPath(); got != filepath.Join(dataRoot, "models") {
		t.Fatalf("models root = %q", got)
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
	if recovered.Error == nil || !strings.Contains(*recovered.Error, "Runtime verification rejected") {
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
	if repair.Error == nil || !strings.Contains(*repair.Error, "Runtime verification rejected") {
		t.Fatalf("missing ready data-root projection error = %v", repair.Error)
	}
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: filepath.Join(home, "forbidden-replacement")}); err == nil {
		t.Fatal("ready data root replacement should fail closed")
	}
}

type productControlRootHandoffForTest struct {
	closed    int
	aborted   int
	committed int
	closeErr  error
}

func (h *productControlRootHandoffForTest) CloseRootAdmission(context.Context) error {
	h.closed++
	return h.closeErr
}

func (h *productControlRootHandoffForTest) AbortRootHandoff()  { h.aborted++ }
func (h *productControlRootHandoffForTest) CommitRootHandoff() { h.committed++ }

type blockingProductControlEngineQuiesceForTest struct {
	*mockEngineManager
	started chan struct{}
	release chan struct{}
}

func (m *blockingProductControlEngineQuiesceForTest) QuiesceDataRoot(ctx context.Context) error {
	close(m.started)
	select {
	case <-m.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestRuntimeProductControlRootBoundWorkQuiesceRespectsContext(t *testing.T) {
	service := newTestService(t)
	manager := &blockingProductControlEngineQuiesceForTest{
		mockEngineManager: &mockEngineManager{}, started: make(chan struct{}), release: make(chan struct{}),
	}
	service.SetEngineManager(manager)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	err := service.stopProductControlRootBoundWork(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("root-bound environment quiesce error = %v, want deadline exceeded", err)
	}
	select {
	case <-manager.started:
	default:
		t.Fatal("environment owner quiesce was not attempted")
	}
	service.resumeProductControlRootBoundWork()
}

func readyProductControlForReplacementTest(t *testing.T, service *Service, root string) productControlRecordProjection {
	t.Helper()
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) { return true, nil })
	service.SetProductControlDataRootConfigValidator(func(string) error { return nil })
	response, err := service.SelectProductControlDataRoot(
		context.Background(),
		&runtimev1.SelectProductControlDataRootRequest{DataRoot: root},
	)
	selected := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-replacement"},
		ok:         true,
	})
	response, err = service.AdmitProductControlReadyForUse(context.Background(), &runtimev1.AdmitProductControlReadyForUseRequest{})
	ready := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if ready.State != productControlStateReadyForUse || ready.Record == nil {
		t.Fatalf("ready projection = %+v (selected=%+v)", ready, selected)
	}
	return ready
}

func TestRuntimeProductControlInitializesLegacyRootActivationWithoutReadingRoot(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "legacy-activation-root")
	ready := readyProductControlForReplacementTest(t, service, root)
	path, err := service.productControlRecordPath()
	if err != nil {
		t.Fatal(err)
	}
	record := *ready.Record
	dataRoot := *record.DataRoot
	dataRoot.RootActivationID = ""
	record.DataRoot = &dataRoot
	record.SchemaVersion = productControlLegacySchemaVersion
	if err := writeProductControlRecord(path, &record); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}

	response, err := service.InitializeProductControlRootActivation(
		context.Background(),
		&runtimev1.InitializeProductControlRootActivationRequest{},
	)
	initialized := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if initialized.Record == nil || initialized.Record.SchemaVersion != productControlSchemaVersion || initialized.Record.DataRoot == nil || initialized.Record.DataRoot.RootActivationID == "" {
		t.Fatalf("initialized legacy projection = %+v", initialized)
	}
	if initialized.Record.DataRoot.Path != root || initialized.Record.InstallID != ready.Record.InstallID || !initialized.Record.FirstRun.Completed {
		t.Fatalf("legacy initialization changed canonical truth: %+v", initialized.Record)
	}
}

func TestRuntimeProductControlReplacesReadyRootAndKeepsFormerRootDetached(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	current := filepath.Join(home, "ready-current-root")
	ready := readyProductControlForReplacementTest(t, service, current)
	formerPayload := filepath.Join(current, "accounts", "keep.txt")
	if err := os.WriteFile(formerPayload, []byte("former-root-remains-user-owned"), 0o600); err != nil {
		t.Fatal(err)
	}
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	target := filepath.Join(home, "ready-target-root")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	unknownTargetContent := filepath.Join(target, "third-party-owner-content.bin")
	if err := os.WriteFile(unknownTargetContent, []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}

	response, err := service.ReplaceProductControlDataRoot(
		context.Background(),
		&runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target},
	)
	replaced := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if replaced.State != productControlStateReadyForUse || replaced.Record == nil || replaced.Record.DataRoot == nil {
		t.Fatalf("replacement projection = %+v", replaced)
	}
	if replaced.Activation == nil || !replaced.Activation.Activated || replaced.Activation.ReasonCode != productControlActivationReplacedReason {
		t.Fatalf("replacement activation = %+v", replaced.Activation)
	}
	if replaced.Record.InstallID != ready.Record.InstallID || !replaced.Record.FirstRun.Completed || replaced.Record.FirstRun.CompletedAt == nil {
		t.Fatalf("replacement reset Product Control completion: %+v", replaced.Record)
	}
	if replaced.Record.DataRoot.Path != target || replaced.Record.DataRoot.RootActivationID == "" || replaced.Record.DataRoot.RootActivationID == ready.Record.DataRoot.RootActivationID {
		t.Fatalf("replacement data root = %+v", replaced.Record.DataRoot)
	}
	if handoff.closed != 1 || handoff.committed != 1 || handoff.aborted != 0 {
		t.Fatalf("handoff disposition = %+v", handoff)
	}
	queriedResponse, queriedErr := service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	queried := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, queriedResponse, queriedErr))
	if queried.RootHandoff == nil || queried.RootHandoff.Disposition != "committed_restart_required" ||
		queried.RootHandoff.RootActivationID != replaced.Record.DataRoot.RootActivationID ||
		queried.Record == nil || queried.Record.DataRoot == nil || queried.Record.DataRoot.Path != target {
		t.Fatalf("response-loss disposition query = %+v", queried)
	}
	if payload, err := os.ReadFile(formerPayload); err != nil || string(payload) != "former-root-remains-user-owned" {
		t.Fatalf("former root changed after activation: payload=%q err=%v", payload, err)
	}
	if payload, err := os.ReadFile(unknownTargetContent); err != nil || string(payload) != "preserve" {
		t.Fatalf("partial target content was changed: payload=%q err=%v", payload, err)
	}

	activationID := replaced.Record.DataRoot.RootActivationID
	response, err = service.ReplaceProductControlDataRoot(
		context.Background(),
		&runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target},
	)
	unchanged := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if unchanged.Activation == nil || unchanged.Activation.Activated || unchanged.Activation.ReasonCode != productControlActivationUnchangedReason || unchanged.Record.DataRoot.RootActivationID != activationID {
		t.Fatalf("same-root disposition = %+v", unchanged)
	}
	child := filepath.Join(target, "nested-target")
	response, err = service.ReplaceProductControlDataRoot(
		context.Background(),
		&runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: child},
	)
	overlap := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if overlap.Activation == nil || overlap.Activation.ReasonCode != productControlActivationOverlappingReason || overlap.Error == nil {
		t.Fatalf("overlap disposition = %+v", overlap)
	}
	if _, err := os.Stat(child); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("overlap target mutated before rejection: %v", err)
	}
}

func TestRuntimeProductControlPostCommitConfigFailureKeepsNewRoot(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	current := filepath.Join(home, "postcommit-current-root")
	readyProductControlForReplacementTest(t, service, current)
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	service.SetProductControlDataRootConfigWriter(func(string) (bool, error) {
		return false, errors.New("derived config unavailable")
	})
	target := filepath.Join(home, "postcommit-target-root")

	response, err := service.ReplaceProductControlDataRoot(
		context.Background(),
		&runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target},
	)
	projection := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if projection.Activation == nil || !projection.Activation.Activated || projection.State != productControlStateRepairRequired || projection.Record == nil || projection.Record.DataRoot == nil || projection.Record.DataRoot.Path != target {
		t.Fatalf("post-commit failure projection = %+v", projection)
	}
	if !projection.Record.FirstRun.Completed || projection.ConfigMutation == nil || projection.ConfigMutation.Disposition != "repair_required" {
		t.Fatalf("post-commit failure lost completion or repair disposition: %+v", projection)
	}
	recordPath, err := service.productControlRecordPath()
	if err != nil {
		t.Fatal(err)
	}
	stored, err := readProductControlRecord(recordPath)
	if err != nil || stored == nil || stored.DataRoot == nil || stored.DataRoot.Path != target {
		t.Fatalf("post-commit failure rolled back activation: stored=%+v err=%v", stored, err)
	}
	queriedResponse, queriedErr := service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	queried := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, queriedResponse, queriedErr))
	if queried.RootHandoff == nil || queried.RootHandoff.Disposition != "committed_repair_required" ||
		queried.RootHandoff.RootActivationID != stored.DataRoot.RootActivationID {
		t.Fatalf("post-commit repair disposition query = %+v", queried)
	}
}

func TestRuntimeProductControlConfigPreflightFailureLeavesCurrentActivationOpen(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	current := filepath.Join(home, "preflight-current-root")
	ready := readyProductControlForReplacementTest(t, service, current)
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	service.SetProductControlDataRootConfigValidator(func(string) error { return errors.New("config document invalid") })
	target := filepath.Join(home, "preflight-target-root")
	if _, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target}); err == nil || !strings.Contains(err.Error(), "config document invalid") {
		t.Fatalf("config preflight error = %v", err)
	}
	if handoff.closed != 0 || handoff.committed != 0 || handoff.aborted != 0 {
		t.Fatalf("config preflight crossed lifecycle boundary: %+v", handoff)
	}
	if _, err := os.Stat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("config preflight mutated target: %v", err)
	}
	recordPath, _ := service.productControlRecordPath()
	stored, err := readProductControlRecord(recordPath)
	if err != nil || stored == nil || stored.DataRoot == nil || stored.DataRoot.RootActivationID != ready.Record.DataRoot.RootActivationID || stored.DataRoot.Path != current {
		t.Fatalf("config preflight changed Product Control: stored=%+v err=%v", stored, err)
	}
}

func productControlCheckSyncOwnerForTest(ownerID string, state string, reason string) ProductControlCheckSyncOwner {
	return func(context.Context, ProductControlCheckSyncInput) ProductControlCheckSyncOwnerResult {
		status := "available"
		if state == "failed" {
			status = "failed"
		}
		return ProductControlCheckSyncOwnerResult{
			OwnerID: ownerID, State: state,
			Resources: []ProductControlCheckSyncResourceResult{{Kind: "owner_state", Status: status, Reason: reason}},
		}
	}
}

func TestCloneProductControlCheckSyncRunPreservesEmptyArrayWireShape(t *testing.T) {
	run := &productControlCheckSyncRun{
		RunID: "sync-test", RootActivationID: "activation-test", Trigger: "manual", State: "running", StartedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Owners:    []ProductControlCheckSyncOwnerResult{{OwnerID: "owner", State: "pending", Resources: []ProductControlCheckSyncResourceResult{}}},
		Unclaimed: []productControlCheckSyncUnclaimed{},
	}
	payload, err := json.Marshal(cloneProductControlCheckSyncRun(run))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload, []byte(`"resources":[]`)) || !bytes.Contains(payload, []byte(`"unclaimed":[]`)) || bytes.Contains(payload, []byte(`"resources":null`)) || bytes.Contains(payload, []byte(`"unclaimed":null`)) {
		t.Fatalf("Check & Sync empty array wire shape = %s", payload)
	}
}

func waitProductControlCheckSyncForTest(t *testing.T, service *Service) productControlCheckSyncProjection {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		projection, err := service.readProductControlCheckSyncProjection()
		if err != nil {
			t.Fatal(err)
		}
		if projection.Run != nil && projection.Run.State != "running" {
			return projection
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Check & Sync did not reach a terminal state")
	return productControlCheckSyncProjection{}
}

func TestCheckSyncManagedAppStorageProjectionBecomesUnavailableAfterAccountGenerationChange(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "check-sync-account-generation-root")
	readyProductControlForReplacementTest(t, service, root)
	generation := uint64(1)
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      productControlCheckSyncOwnerForTest("runtime_agent", "completed", "RUNTIME_AGENT_REOPENED"),
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "completed", "COGNITION_REOPENED"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
		AccountGeneration: func(context.Context) (uint64, bool) { return generation, true },
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.startProductControlCheckSync("manual", true); err != nil {
		t.Fatal(err)
	}
	_ = waitProductControlCheckSyncForTest(t, service)
	generation = 2
	wire, err := service.GetProductControlCheckSync(context.Background(), &runtimev1.GetProductControlCheckSyncRequest{})
	if err != nil {
		t.Fatal(err)
	}
	var projection productControlCheckSyncProjection
	if err := json.Unmarshal([]byte(wire.GetJson()), &projection); err != nil {
		t.Fatal(err)
	}
	appStorageStale := false
	runtimeAgentStale := false
	for _, owner := range projection.Run.Owners {
		if owner.OwnerID == "managed_app_storage" && len(owner.Resources) == 1 &&
			owner.Resources[0].Status == "unavailable" && owner.Resources[0].Reason == "APP_STORAGE_ACCOUNT_CONTEXT_CHANGED" {
			appStorageStale = true
		}
		if owner.OwnerID == "runtime_agent" && len(owner.Resources) == 1 &&
			owner.Resources[0].Status == "unavailable" && owner.Resources[0].Reason == "RUNTIME_OWNER_ACCOUNT_CONTEXT_CHANGED" {
			runtimeAgentStale = true
		}
	}
	if !appStorageStale || !runtimeAgentStale {
		t.Fatalf("stale account-scoped App storage result remained visible: %+v", projection.Run.Owners)
	}
}

func TestRuntimeProductControlCheckSyncPersistsStartBeforeEnvironmentDetachment(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "check-sync-order-root")
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      productControlCheckSyncOwnerForTest("runtime_agent", "completed", "RUNTIME_AGENT_REOPENED"),
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "completed", "COGNITION_REOPENED"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
	}); err != nil {
		t.Fatal(err)
	}
	readyProductControlForReplacementTest(t, service, root)
	// Finish the activation-triggered run before injecting the manual start
	// failure. Otherwise setup can detach this test's newly inserted record.
	activation := waitProductControlCheckSyncForTest(t, service)
	formerRoot := filepath.Join(home, "former-check-sync-root")
	formerCanonical := filepath.Join(formerRoot, "environments", "native", "engine-a")
	currentCanonical := filepath.Join(root, "environments", "native", "engine-a")
	if err := os.MkdirAll(currentCanonical, 0o755); err != nil {
		t.Fatal(err)
	}
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		RecordID: "source-check-sync-order", DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyID: "llama.cpp.package", SourceKind: localEnvironmentSourceManaged,
		EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyNativeLlama, "llama.cpp.package", "old-host", "windows/amd64", formerRoot),
		CanonicalRoot:  formerCanonical, VerifiedArtifacts: []string{filepath.Join(formerCanonical, "llama-server")},
	})
	service.mu.Lock()
	service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)] = record
	if err := service.persistStateLocked(); err != nil {
		service.mu.Unlock()
		t.Fatal(err)
	}
	service.mu.Unlock()
	stateBefore, err := os.ReadFile(service.stateStorePath)
	if err != nil {
		t.Fatal(err)
	}

	obligationPath, err := service.productControlCheckSyncObligationPath()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(obligationPath); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(obligationPath, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := service.startProductControlCheckSync("manual", true); err == nil {
		t.Fatal("Check & Sync start unexpectedly succeeded with an unwritable obligation target")
	}
	service.productControlCheckSyncMu.RLock()
	failedRun := cloneProductControlCheckSyncRun(service.productControlCheckSyncRun)
	service.productControlCheckSyncMu.RUnlock()
	service.mu.RLock()
	afterFailure := service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)]
	service.mu.RUnlock()
	stateAfterFailure, err := os.ReadFile(service.stateStorePath)
	if err != nil {
		t.Fatal(err)
	}
	if failedRun == nil || failedRun.RunID != activation.Run.RunID || afterFailure.CanonicalRoot != formerCanonical || !bytes.Equal(stateBefore, stateAfterFailure) {
		t.Fatalf("failed manual start changed the prior run or owner state: run=%+v record=%+v", failedRun, afterFailure)
	}

	if err := os.RemoveAll(obligationPath); err != nil {
		t.Fatal(err)
	}
	started, err := service.startProductControlCheckSync("manual", true)
	if err != nil || started.Run == nil || started.Obligation == nil || started.Obligation.State != productControlCheckSyncRequired {
		t.Fatalf("real Check & Sync start = %+v err=%v", started, err)
	}
	completed := waitProductControlCheckSyncForTest(t, service)
	foundDetachment := false
	for _, owner := range completed.Run.Owners {
		if owner.OwnerID != "dependencies_environments" {
			continue
		}
		for _, resource := range owner.Resources {
			foundDetachment = foundDetachment || resource.Reference != nil && *resource.Reference == record.RecordID &&
				resource.Change == nil && resource.Status == "unavailable" && resource.Reason == "ENVIRONMENT_OWNER_REOPEN_EVIDENCE_REQUIRED"
		}
	}
	service.mu.RLock()
	var rebasedRecord localEnvironmentSelectedSourceRecordState
	for _, current := range service.localEnvironmentSelectedSources {
		if current.RecordID == record.RecordID {
			rebasedRecord = current
		}
	}
	service.mu.RUnlock()
	if !foundDetachment || rebasedRecord.CanonicalRoot != "" || rebasedRecord.RepairState != localEnvironmentRepairRequired {
		t.Fatalf("foreign absolute owner locator was not detached: found=%t record=%+v run=%+v current-candidate=%q", foundDetachment, rebasedRecord, completed.Run, currentCanonical)
	}
}

func TestRuntimeProductControlCheckSyncEnvironmentRebaseFailsClosedWhenPersistenceFails(t *testing.T) {
	service := newTestService(t)
	currentRoot := filepath.Join(t.TempDir(), "current-root")
	formerRoot := filepath.Join(t.TempDir(), "former-root")
	currentCanonical := filepath.Join(currentRoot, "environments", "native", "engine-a")
	formerCanonical := filepath.Join(formerRoot, "environments", "native", "engine-a")
	if err := os.MkdirAll(currentCanonical, 0o755); err != nil {
		t.Fatal(err)
	}
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		RecordID: "source-check-sync-persist-failure", DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyID: "llama.cpp.package", SourceKind: localEnvironmentSourceManaged,
		EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyNativeLlama, "llama.cpp.package", "old-host", "windows/amd64", formerRoot),
		CanonicalRoot:  formerCanonical, VerifiedArtifacts: []string{filepath.Join(formerCanonical, "llama-server")},
	})
	service.mu.Lock()
	service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)] = record
	service.mu.Unlock()
	badStateTarget := filepath.Join(t.TempDir(), "state-target-is-directory")
	if err := os.MkdirAll(badStateTarget, 0o700); err != nil {
		t.Fatal(err)
	}
	service.stateStorePath = badStateTarget

	result := service.reconcileProductControlCheckSyncEnvironments(context.Background(), ProductControlCheckSyncInput{DataRoot: currentRoot})
	if result.State != "failed" || len(result.Resources) != 1 || result.Resources[0].Reason != "ENVIRONMENT_STATE_PERSIST_FAILED" {
		t.Fatalf("persistence failure result = %+v", result)
	}
	service.mu.RLock()
	preserved := service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)]
	service.mu.RUnlock()
	if preserved.CanonicalRoot != formerCanonical || preserved.EnvironmentKey != record.EnvironmentKey {
		t.Fatalf("persistence failure committed in-memory rebase: %+v", preserved)
	}
}

func TestRuntimeProductControlCheckSyncEnvironmentKeyCollisionPreservesBothIntents(t *testing.T) {
	service := newTestService(t)
	currentRoot := t.TempDir()
	platform := "windows/amd64"
	makeRecord := func(id, host, formerRoot, currentName string) localEnvironmentSelectedSourceRecordState {
		root := filepath.Join(currentRoot, "environments", "native", currentName)
		artifact := filepath.Join(root, "llama-server")
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(artifact, []byte(id), 0o700); err != nil {
			t.Fatal(err)
		}
		record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
			RecordID: id, DependencyFamily: localEnvironmentFamilyNativeLlama, DependencyID: "llama.cpp.package",
			EnvironmentKey: strings.Join([]string{localEnvironmentFamilyNativeLlama, "llama.cpp.package", host, platform, formerRoot}, "|"),
			Version:        "1.0.0", CanonicalRoot: root, VerifiedArtifacts: []string{artifact},
		})
		record.LastVerifiedAt = nowISO()
		return record
	}
	one := makeRecord("source-collision-one", "host-one", `C:\former-one`, "one")
	two := makeRecord("source-collision-two", "host-two", `D:\former-two`, "two")
	service.mu.Lock()
	service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(one)] = one
	service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(two)] = two
	service.mu.Unlock()

	result := service.reconcileProductControlCheckSyncEnvironments(context.Background(), ProductControlCheckSyncInput{DataRoot: currentRoot})
	conflicts := 0
	for _, resource := range result.Resources {
		if resource.Reason == "ENVIRONMENT_KEY_REWRITE_CONFLICT" && resource.Status == "conflict" {
			conflicts++
		}
	}
	service.mu.RLock()
	preserved := make([]localEnvironmentSelectedSourceRecordState, 0, len(service.localEnvironmentSelectedSources))
	for _, record := range service.localEnvironmentSelectedSources {
		preserved = append(preserved, record)
	}
	service.mu.RUnlock()
	if conflicts != 2 || len(preserved) != 2 {
		t.Fatalf("portable EnvironmentKey collision = conflicts:%d records:%+v result:%+v", conflicts, preserved, result)
	}
	seen := map[string]bool{}
	for _, record := range preserved {
		seen[record.EnvironmentKey] = true
		if record.RepairState != localEnvironmentRepairRequired {
			t.Fatalf("colliding intent was not failed closed: %+v", record)
		}
	}
	if !seen[one.EnvironmentKey] || !seen[two.EnvironmentKey] {
		t.Fatalf("colliding EnvironmentKey intents were overwritten: %+v", preserved)
	}
}

func TestRuntimeProductControlCheckSyncCanceledOwnersDoNotCommitPendingRebases(t *testing.T) {
	service := newTestService(t)
	service.mu.Lock()
	service.modelAssetDirectories["asset-cancel"] = filepath.Join("former", "models", "resolved", "asset-cancel")
	service.modelAssetPendingDirectoryRebases["asset-cancel"] = filepath.Join("current", "models", "resolved", "asset-cancel")
	record := localEnvironmentSelectedSourceRecordState{
		RecordID: "source-cancel", DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyID: "llama.cpp.package", EnvironmentKey: "old-key", CanonicalRoot: filepath.Join("former", "environments", "engine"),
	}
	service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)] = record
	service.mu.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	modelResult := service.reconcileProductControlCheckSyncModelAssets(ctx, ProductControlCheckSyncInput{DataRoot: t.TempDir()})
	environmentResult := service.reconcileProductControlCheckSyncEnvironments(ctx, ProductControlCheckSyncInput{DataRoot: t.TempDir()})
	if modelResult.State != "failed" || environmentResult.State != "failed" {
		t.Fatalf("canceled owner results = model:%+v environment:%+v", modelResult, environmentResult)
	}
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.modelAssetDirectories["asset-cancel"] != filepath.Join("former", "models", "resolved", "asset-cancel") ||
		service.modelAssetPendingDirectoryRebases["asset-cancel"] == "" {
		t.Fatalf("canceled model owner committed pending rebase: directories=%v pending=%v", service.modelAssetDirectories, service.modelAssetPendingDirectoryRebases)
	}
	preserved := service.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)]
	if preserved.CanonicalRoot != record.CanonicalRoot || preserved.EnvironmentKey != record.EnvironmentKey {
		t.Fatalf("canceled environment owner committed rebase: %+v", preserved)
	}
}

func TestRuntimeProductControlCheckSyncAdoptsManifestIdentityAndCompletesWithOwnerIssue(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "check-sync-root")
	readyProductControlForReplacementTest(t, service, root)
	resolved := filepath.Join(root, "models", "resolved", "copied-model")
	if err := os.MkdirAll(resolved, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resolved, "model.gguf"), validTestGGUF(), 0o600); err != nil {
		t.Fatal(err)
	}
	asset, _, err := service.adoptResolvedModelAssetDirectory(context.Background(), resolved, "copied model")
	if err != nil {
		t.Fatal(err)
	}
	service.modelAssetMutationMu.Lock()
	service.mu.Lock()
	service.modelAssets = make(map[string]*runtimev1.ModelAssetRecord)
	service.modelAssetDirectories = make(map[string]string)
	if err := service.persistModelAssetStoreLocked(); err != nil {
		service.mu.Unlock()
		service.modelAssetMutationMu.Unlock()
		t.Fatal(err)
	}
	service.mu.Unlock()
	service.modelAssetMutationMu.Unlock()
	if err := os.WriteFile(filepath.Join(root, "third-party-note.txt"), []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      productControlCheckSyncOwnerForTest("runtime_agent", "completed", "RUNTIME_AGENT_REOPENED"),
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "failed", "COGNITION_UNAVAILABLE"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartProductControlCheckSync(context.Background(), &runtimev1.StartProductControlCheckSyncRequest{}); err != nil {
		t.Fatal(err)
	}
	projection := waitProductControlCheckSyncForTest(t, service)
	if projection.Run == nil || projection.Run.State != "completed" || projection.Obligation == nil || projection.Obligation.State != productControlCheckSyncCompleted {
		t.Fatalf("terminal Check & Sync projection = %+v", projection)
	}
	service.mu.RLock()
	recovered := cloneModelAsset(service.modelAssets[asset.GetModelAssetId()])
	service.mu.RUnlock()
	if recovered == nil || recovered.GetContentId() != asset.GetContentId() {
		t.Fatalf("manifest identity was not preserved: recovered=%+v original=%+v", recovered, asset)
	}
	foundUnknown := false
	foundOwnerFailure := false
	foundAdoption := false
	for _, item := range projection.Run.Unclaimed {
		foundUnknown = foundUnknown || item.Locator == "third-party-note.txt" && item.Status == "unknown"
	}
	for _, owner := range projection.Run.Owners {
		foundOwnerFailure = foundOwnerFailure || owner.OwnerID == "cognition" && owner.State == "failed"
		for _, resource := range owner.Resources {
			foundAdoption = foundAdoption || resource.Reference != nil && *resource.Reference == asset.GetModelAssetId() && resource.Change != nil && *resource.Change == "adopted"
		}
	}
	if !foundUnknown || !foundOwnerFailure || !foundAdoption {
		t.Fatalf("Check & Sync lost independent unknown/failure outcomes: %+v", projection.Run)
	}
	if _, err := service.StartProductControlCheckSync(context.Background(), &runtimev1.StartProductControlCheckSyncRequest{}); err != nil {
		t.Fatal(err)
	}
	second := waitProductControlCheckSyncForTest(t, service)
	if second.Run == nil {
		t.Fatal("repeated Check & Sync returned no run")
	}
	foundReuse := false
	for _, owner := range second.Run.Owners {
		for _, resource := range owner.Resources {
			foundReuse = foundReuse || resource.Reference != nil && *resource.Reference == asset.GetModelAssetId() && resource.Status == "available" && resource.Change == nil && resource.Reason == "MODEL_MANIFEST_REUSED"
		}
	}
	if second.Run == nil || second.Run.RunID == projection.Run.RunID || !foundReuse {
		t.Fatalf("repeated Check & Sync was not idempotent: first=%+v second=%+v", projection.Run, second.Run)
	}
}

func TestRuntimeProductControlCheckSyncObligationRecoversInterruptedRunButSkipsCompletedRestart(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "check-sync-recovery-root")
	ready := readyProductControlForReplacementTest(t, service, root)
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      productControlCheckSyncOwnerForTest("runtime_agent", "completed", "RUNTIME_AGENT_REOPENED"),
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "completed", "COGNITION_REOPENED"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartProductControlCheckSync(context.Background(), &runtimev1.StartProductControlCheckSyncRequest{}); err != nil {
		t.Fatal(err)
	}
	completed := waitProductControlCheckSyncForTest(t, service)
	if completed.Run == nil || completed.Obligation == nil || completed.Obligation.State != productControlCheckSyncCompleted {
		runState := "<nil>"
		if completed.Run != nil {
			runState = completed.Run.State
		}
		t.Fatalf("initial completed obligation run_state=%q run=%+v obligation=%+v error=%v", runState, completed.Run, completed.Obligation, completed.Error)
	}
	service.productControlCheckSyncMu.Lock()
	service.productControlCheckSyncRun = nil
	service.productControlCheckSyncMu.Unlock()
	if err := service.RecoverProductControlCheckSync(); err != nil {
		t.Fatal(err)
	}
	projection, err := service.readProductControlCheckSyncProjection()
	if err != nil || projection.Run != nil {
		t.Fatalf("ordinary completed restart created a run: %+v err=%v", projection, err)
	}
	activationID := ready.Record.DataRoot.RootActivationID
	if err := service.writeProductControlCheckSyncObligation(&productControlCheckSyncObligation{RootActivationID: activationID, State: productControlCheckSyncRequired}); err != nil {
		t.Fatal(err)
	}
	if err := service.RecoverProductControlCheckSync(); err != nil {
		t.Fatal(err)
	}
	recovered := waitProductControlCheckSyncForTest(t, service)
	if recovered.Run == nil || recovered.Run.Trigger != "interrupted_recovery" || recovered.Run.RunID == completed.Run.RunID || recovered.Obligation == nil || recovered.Obligation.State != productControlCheckSyncCompleted {
		t.Fatalf("interrupted Check & Sync recovery = %+v", recovered)
	}
}

func TestRuntimeProductControlCheckSyncAutomaticRecoveryDoesNotRequireEngineManager(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	root := filepath.Join(home, "check-sync-no-engine-manager")
	readyProductControlForReplacementTest(t, service, root)
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      productControlCheckSyncOwnerForTest("runtime_agent", "completed", "RUNTIME_AGENT_REOPENED"),
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "completed", "COGNITION_REOPENED"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.RecoverProductControlCheckSync(); err != nil {
		t.Fatalf("automatic recovery without engine manager: %v", err)
	}
	projection := waitProductControlCheckSyncForTest(t, service)
	if projection.Run == nil || projection.Run.State != "completed" || projection.Obligation == nil || projection.Obligation.State != productControlCheckSyncCompleted {
		t.Fatalf("automatic recovery projection = %+v", projection)
	}
	var environments *ProductControlCheckSyncOwnerResult
	for index := range projection.Run.Owners {
		if projection.Run.Owners[index].OwnerID == "dependencies_environments" {
			environments = &projection.Run.Owners[index]
			break
		}
	}
	if environments == nil || environments.State != "completed" {
		t.Fatalf("environment owner result = %+v", environments)
	}
	foundUnavailable := false
	for _, resource := range environments.Resources {
		if resource.Reason == "ENVIRONMENT_MANAGER_UNAVAILABLE" && resource.Status == "unavailable" {
			foundUnavailable = true
			break
		}
	}
	if !foundUnavailable {
		t.Fatalf("missing manager-unavailable resource = %+v", environments.Resources)
	}
}

func TestRuntimeProductControlReplacementSupersedesOnlyAfterCommit(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	current := filepath.Join(home, "sync-supersede-current")
	ready := readyProductControlForReplacementTest(t, service, current)
	started := make(chan struct{})
	blockingOwner := func(ctx context.Context, _ ProductControlCheckSyncInput) ProductControlCheckSyncOwnerResult {
		close(started)
		<-ctx.Done()
		return failedProductControlCheckSyncOwner("runtime_agent", "RUN_INTERRUPTED")
	}
	if err := service.SetProductControlCheckSyncRuntimeOwners(ProductControlCheckSyncRuntimeOwners{
		RuntimeAgent:      blockingOwner,
		RegisteredApps:    productControlCheckSyncOwnerForTest("registered_apps", "completed", "REGISTERED_APPS_REOPENED"),
		Cognition:         productControlCheckSyncOwnerForTest("cognition", "completed", "COGNITION_REOPENED"),
		ManagedAppStorage: productControlCheckSyncOwnerForTest("managed_app_storage", "completed", "APP_STORAGE_REOPENED"),
	}); err != nil {
		t.Fatal(err)
	}
	startedProjection, err := service.startProductControlCheckSync("manual", true)
	if err != nil || startedProjection.Run == nil {
		t.Fatalf("start current run = %+v err=%v", startedProjection, err)
	}
	<-started
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	target := filepath.Join(home, "sync-supersede-target")
	response, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target})
	replaced := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if replaced.Activation == nil || !replaced.Activation.Activated || replaced.Record.DataRoot.RootActivationID == ready.Record.DataRoot.RootActivationID {
		t.Fatalf("replacement activation = %+v", replaced)
	}
	service.productControlCheckSyncMu.RLock()
	currentRun := cloneProductControlCheckSyncRun(service.productControlCheckSyncRun)
	service.productControlCheckSyncMu.RUnlock()
	if currentRun == nil || currentRun.RunID != startedProjection.Run.RunID || currentRun.State != "superseded" {
		t.Fatalf("prior Check & Sync run was not superseded after commit: %+v", currentRun)
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
