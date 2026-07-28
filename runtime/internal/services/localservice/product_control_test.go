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
	"github.com/nimiplatform/nimi/runtime/internal/engine"
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

func accountDefaultProfileEvidenceJSONForTest(t *testing.T, accountID, dataRoot, aiProfileAlias string) string {
	t.Helper()
	evidence := map[string]any{
		"accountDefaultProfileRef": "account-default-profile:v1:" + accountID + ":default:hash",
		"accountId":                accountID,
		"dataRootRef":              productControlDataRootRef(dataRoot),
		"profileId":                "default",
		"contentHash":              "sha256:abc",
		"sourcePolicyRef":          "policy",
		"sourceCatalogId":          "catalog",
		"sourceCatalogVersion":     1,
		"createdAt":                "2026-06-02T00:00:00.000Z",
		"updatedAt":                "2026-06-02T00:00:00.000Z",
		"aiProfileAlias":           aiProfileAlias,
		"profilePayloadHash":       "sha256:def",
		"factoryProvenanceHash":    "sha256:123",
	}
	raw, err := json.Marshal(evidence)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func builtInAIConfigEvidenceJSONForTest(t *testing.T, accountID, dataRoot, aiProfileAlias, installLevel string) string {
	return builtInAIConfigEvidenceJSONWithRefPrefixForTest(t, "aiconfig:", accountID, dataRoot, aiProfileAlias, installLevel)
}

func builtInAIConfigEvidenceJSONWithRefPrefixForTest(t *testing.T, refPrefix, accountID, dataRoot, aiProfileAlias, installLevel string) string {
	t.Helper()
	evidenceFor := func(surfaceID string) map[string]any {
		return map[string]any{
			"builtInAiConfigRef":  refPrefix + surfaceID,
			"accountId":           accountID,
			"dataRootRef":         productControlDataRootRef(dataRoot),
			"scopeRef":            map[string]any{"kind": "feature", "ownerId": "desktop.chat", "surfaceId": surfaceID},
			"aiProfileRef":        map[string]any{"profileId": "default", "aiProfileAlias": aiProfileAlias, "installLevel": installLevel, "sourcePolicyRef": "policy", "sourceCatalogId": "catalog", "sourceCatalogVersion": 1, "profilePayloadHash": "sha256:def", "appliedAt": "2026-06-02T00:00:00.000Z"},
			"aiConfigVersion":     1,
			"aiConfigContentHash": "sha256:" + surfaceID,
			"writerIdentity":      "sdk.ai-config-projection",
			"committedAt":         "2026-06-02T00:00:00.000Z",
		}
	}
	raw, err := json.Marshal(map[string]any{
		"nimi":  evidenceFor("nimi"),
		"agent": evidenceFor("agent"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestRuntimeProductControlBuiltInAIConfigRefreshCanReplaceStaleRefs(t *testing.T) {
	dataRoot := filepath.Join(t.TempDir(), "chosen-nimi-data")
	record := &productControlRecord{
		FirstRun: productFirstRunRecord{
			BuiltInAIConfigRefs: []string{"aiconfig:stale-nimi", "aiconfig:stale-agent"},
		},
	}
	refreshedEvidence := builtInAIConfigEvidenceJSONWithRefPrefixForTest(
		t,
		"aiconfig-refreshed:",
		"acct-refresh",
		dataRoot,
		"local-speech-ready",
		"minimal",
	)

	refs, _, failure := parseAndVerifyBuiltInAIConfigAdmissionEvidence(
		refreshedEvidence,
		record,
		"acct-refresh",
		productControlDataRootRef(dataRoot),
		"local-speech-ready",
		"minimal",
		false,
	)
	if failure != "" {
		t.Fatalf("refresh evidence should replace stale refs, got failure: %s", failure)
	}
	if len(refs) != 2 || refs[0] != "aiconfig-refreshed:nimi" || refs[1] != "aiconfig-refreshed:agent" {
		t.Fatalf("unexpected refreshed refs: %+v", refs)
	}

	_, _, failure = parseAndVerifyBuiltInAIConfigAdmissionEvidence(
		refreshedEvidence,
		record,
		"acct-refresh",
		productControlDataRootRef(dataRoot),
		"local-speech-ready",
		"minimal",
		true,
	)
	if failure != "built-in AIConfig evidence refs are stale or mismatched" {
		t.Fatalf("ready admission must still reject stale ref replacement, got: %q", failure)
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

func TestRuntimeProductControlMissingPreEvidenceDataRootReturnsToStorage(t *testing.T) {
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
		t.Fatalf("missing pre-evidence projection = %+v", recovered)
	}
	if recovered.Error == nil || !strings.Contains(*recovered.Error, "owner verification rejected") {
		t.Fatalf("missing pre-evidence projection error = %v", recovered.Error)
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
		t.Fatalf("read durable pre-evidence record: %v", err)
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

func TestRuntimeProductControlMissingPostEvidenceDataRootRequiresRepair(t *testing.T) {
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
	record.FirstRun.InitializationPlanID = stringPtr("plan-with-owner-evidence")
	if err := writeProductControlRecord(path, record); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(dataRoot); err != nil {
		t.Fatalf("remove admitted data root: %v", err)
	}

	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	repair := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if repair.State != productControlStateRepairRequired || repair.Record == nil || repair.Record.State != productControlStateLocalAIProfileNotReady {
		t.Fatalf("missing post-evidence projection = %+v", repair)
	}
	if repair.Error == nil || !strings.Contains(*repair.Error, "owner verification rejected") {
		t.Fatalf("missing post-evidence projection error = %v", repair.Error)
	}
	if _, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: filepath.Join(home, "forbidden-replacement")}); err == nil {
		t.Fatal("post-evidence data root replacement should fail closed")
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

func TestRuntimeProductControlAdmitsReadyForUseAndReadProjection(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-ready"},
		ok:         true,
	})
	service.SetFirstRunLocalExecutor(&fakeFirstRunLocalExecutor{})
	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)
	response, err = service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "local-speech-ready",
	})
	mustProductControlForTest(t, response, err)

	deviceProfile, profileState, profileFailure := service.productControlHostProfile(context.Background())
	if profileFailure != "" {
		t.Fatalf("host profile state=%q failure=%q", profileState, profileFailure)
	}
	markRuntimeBaselineMinimalReady(t, service, dataRoot, deviceProfile)
	baselineRequest := runtimeBaselineMintRequest(dataRoot)
	baselineRequest.HostProfile = deviceProfile
	baselineRecord, baselineState, baselineReason, baselineDetail := service.mintRuntimeBaselineReadiness(baselineRequest)
	if baselineState != runtimeBaselineStateReady {
		t.Fatalf("baseline state=%q reason=%q detail=%q", baselineState, baselineReason, baselineDetail)
	}
	service.SetEngineManager(&mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "healthy",
		Port:     8330,
		Endpoint: "http://127.0.0.1:8330",
	}})
	service.localModelsPath = filepath.Join(t.TempDir(), "models")
	ttsRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	asrRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-asr")
	upsertVerifiedSpeechPackageSetForTest(t, service, "speech.qwen3-tts.python", "local-speech-qwen3-tts.package-set", ttsRoot, "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	upsertVerifiedSpeechPackageSetForTest(t, service, "speech.qwen3-asr.python", "local-speech-qwen3-asr.package-set", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)
	executionRequest := firstRunExecutionMintRequestFor(baselineRecord.RuntimeBaselineRef, dataRoot)
	executionRequest.HostProfile = deviceProfile
	executionRecord, executionState, executionReason, executionDetail := service.mintFirstRunExecutionEvidence(context.Background(), executionRequest)
	if executionState != firstRunExecutionStateReady {
		t.Fatalf("execution state=%q reason=%q detail=%q", executionState, executionReason, executionDetail)
	}

	accountEvidenceJSON := accountDefaultProfileEvidenceJSONForTest(t, "acct-ready", dataRoot, "local-speech-ready")
	builtInEvidenceJSON := builtInAIConfigEvidenceJSONForTest(t, "acct-ready", dataRoot, "local-speech-ready", "minimal")
	response, err = service.RecordProductControlAccountDefaultProfileEvidence(context.Background(), &runtimev1.RecordProductControlAccountDefaultProfileEvidenceRequest{
		AccountDefaultProfileEvidenceJson: accountEvidenceJSON,
	})
	mustProductControlForTest(t, response, err)
	response, err = service.RecordProductControlFirstRunLocalAiReadyEvidence(context.Background(), &runtimev1.RecordProductControlFirstRunLocalAiReadyEvidenceRequest{
		RuntimeBaselineRef:          baselineRecord.RuntimeBaselineRef,
		BuiltInAiConfigEvidenceJson: builtInEvidenceJSON,
		ExecutionEvidenceRef:        executionRecord.ExecutionEvidenceRef,
	})
	localAIReady := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if localAIReady.State != productControlStateLocalAIReady {
		t.Fatalf("local AI ready state = %s", localAIReady.State)
	}
	refreshedBuiltInEvidenceJSON := builtInAIConfigEvidenceJSONWithRefPrefixForTest(t, "aiconfig-refreshed:", "acct-ready", dataRoot, "local-speech-ready", "minimal")
	response, err = service.RecordProductControlFirstRunLocalAiReadyEvidence(context.Background(), &runtimev1.RecordProductControlFirstRunLocalAiReadyEvidenceRequest{
		RuntimeBaselineRef:          baselineRecord.RuntimeBaselineRef,
		BuiltInAiConfigEvidenceJson: refreshedBuiltInEvidenceJSON,
		ExecutionEvidenceRef:        executionRecord.ExecutionEvidenceRef,
	})
	refreshedLocalAIReady := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if refreshedLocalAIReady.Record == nil || len(refreshedLocalAIReady.Record.FirstRun.BuiltInAIConfigRefs) != 2 {
		t.Fatalf("refreshed built-in AIConfig refs were not recorded: %+v", refreshedLocalAIReady.Record)
	}
	if refreshedLocalAIReady.Record.FirstRun.BuiltInAIConfigRefs[0] != "aiconfig-refreshed:nimi" ||
		refreshedLocalAIReady.Record.FirstRun.BuiltInAIConfigRefs[1] != "aiconfig-refreshed:agent" {
		t.Fatalf("stale built-in AIConfig refs were not replaced: %+v", refreshedLocalAIReady.Record.FirstRun.BuiltInAIConfigRefs)
	}

	response, err = service.AdmitProductControlReadyForUse(context.Background(), &runtimev1.AdmitProductControlReadyForUseRequest{
		AccountDefaultProfileEvidenceJson: accountEvidenceJSON,
		BuiltInAiConfigEvidenceJson:       refreshedBuiltInEvidenceJSON,
	})
	ready := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if ready.State != productControlStateReadyForUse || ready.Record == nil {
		t.Fatalf("ready projection = %+v", ready)
	}
	response, err = service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	readBack := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if readBack.State != productControlStateReadyForUse || readBack.Record == nil {
		t.Fatalf("readback projection = %+v", readBack)
	}
}

func TestRuntimeProductControlRecordsHostEvidenceAndSetupState(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	service.SetRuntimeAccountProjectionProvider(fakeRuntimeAccountProjectionProvider{
		projection: &runtimev1.AccountProjection{AccountId: "acct-host"},
		ok:         true,
	})
	dataRoot := filepath.Join(home, "chosen-nimi-data")
	response, err := service.SelectProductControlDataRoot(context.Background(), &runtimev1.SelectProductControlDataRootRequest{DataRoot: dataRoot})
	mustProductControlForTest(t, response, err)
	response, err = service.SetProductControlFirstRunInstallLevel(context.Background(), &runtimev1.SetProductControlFirstRunInstallLevelRequest{
		InstallLevel:   "minimal",
		AiProfileAlias: "local-speech-ready",
	})
	mustProductControlForTest(t, response, err)

	accountEvidence := map[string]any{
		"accountDefaultProfileRef": "account-default-profile:v1:acct:default:hash",
		"accountId":                "acct-host",
		"dataRootRef":              productControlDataRootRef(dataRoot),
		"profileId":                "default",
		"contentHash":              "sha256:abc",
		"sourcePolicyRef":          "policy",
		"sourceCatalogId":          "catalog",
		"sourceCatalogVersion":     1,
		"createdAt":                "2026-06-02T00:00:00.000Z",
		"updatedAt":                "2026-06-02T00:00:00.000Z",
		"aiProfileAlias":           "local-speech-ready",
		"profilePayloadHash":       "sha256:def",
		"factoryProvenanceHash":    "sha256:123",
	}
	accountEvidenceJSON, err := json.Marshal(accountEvidence)
	if err != nil {
		t.Fatal(err)
	}
	response, err = service.RecordProductControlAccountDefaultProfileEvidence(context.Background(), &runtimev1.RecordProductControlAccountDefaultProfileEvidenceRequest{
		AccountDefaultProfileEvidenceJson: string(accountEvidenceJSON),
	})
	recorded := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if recorded.Record == nil || recorded.Record.FirstRun.AccountDefaultProfileRef == nil || *recorded.Record.FirstRun.AccountDefaultProfileRef != "account-default-profile:v1:acct:default:hash" {
		t.Fatalf("account evidence was not recorded: %+v", recorded.Record)
	}

	response, err = service.ReconcileProductControlFirstRunSetupState(context.Background(), &runtimev1.ReconcileProductControlFirstRunSetupStateRequest{})
	reconciled := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if reconciled.State != productControlStateLocalAIProfileAssetsMissing {
		t.Fatalf("reconciled state = %s", reconciled.State)
	}
	if reconciled.Record == nil || reconciled.Record.Repair.Required {
		t.Fatalf("setup-required reconciliation must not mark product repair required: %+v", reconciled.Record)
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
