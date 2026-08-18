package ai

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func testVoiceAssetCloudBinding(target *runtimeidentity.Target) *voiceAssetCloudBinding {
	providerTarget, _ := structpb.NewStruct(map[string]any{
		"provider": target.Cloud.Provider, "providerModelId": target.Cloud.ProviderModelID,
		"remoteModelCatalogId": target.Cloud.RemoteModelCatalogID,
	})
	return &voiceAssetCloudBinding{
		CapabilityContract: "voice.create",
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "cloud.voice.test", DriverId: "driver.voice.test", DriverDialect: "test/voice/v1",
		},
		ProviderModelTarget: providerTarget,
		ConnectorID:         target.Cloud.ConnectorID,
	}
}

func testVoiceAssetCloudTarget(connectorID string) *runtimeidentity.Target {
	return &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
		ConnectorID: connectorID, RemoteModelCatalogID: "catalog-voice", ProviderModelID: "voice-model", Provider: "voice-provider",
	}}
}

func testProviderPersistentVoiceDraft(assetID string) *runtimev1.VoiceAsset {
	return newVoiceAssetDraft(&voiceWorkflowSubmitInput{
		Head:         &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-1"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator"}},
		}}},
		ModelResolved: "voice-model", Provider: "voice-provider", WorkflowModelID: "voice-workflow",
		WorkflowFamily: "voice-family", OutputPersistence: "provider_persistent",
	}, assetID, timestamppb.Now())
}

func testActiveProviderPersistentVoiceAsset(assetID string) *runtimev1.VoiceAsset {
	asset := testProviderPersistentVoiceDraft(assetID)
	now := timestamppb.New(time.Now().UTC())
	asset.ProviderVoiceRef = "provider-voice-ref"
	asset.Status = runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE
	asset.CreatedAt = now
	asset.UpdatedAt = now
	return asset
}

func persistPendingVoicePublicationForTest(t *testing.T, localStatePath string, asset *runtimev1.VoiceAsset) {
	t.Helper()
	store, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	target := testVoiceAssetCloudTarget("connector-voice")
	id := strings.TrimSpace(asset.GetVoiceAssetId())
	store.mu.Lock()
	store.assets[id] = cloneVoiceAsset(asset)
	store.targets[id] = target.Clone()
	store.cloudBindings[id] = testVoiceAssetCloudBinding(target)
	store.pending[id] = true
	err = store.persistDurableAssetsLocked()
	store.mu.Unlock()
	if err != nil {
		t.Fatalf("persist pending VoiceAsset publication: %v", err)
	}
}

func persistPrimaryVoiceScenarioJobForTest(t *testing.T, localStatePath string, asset *runtimev1.VoiceAsset, completed bool) {
	t.Helper()
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	now := timestamppb.New(time.Now().UTC())
	head := &runtimev1.ScenarioRequestHead{AppId: asset.GetAppId(), SubjectUserId: asset.GetSubjectUserId()}
	job := &runtimev1.ScenarioJob{
		JobId: asset.GetVoiceAssetId(), Head: head,
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, CreatedAt: now, UpdatedAt: now,
		TraceId: "trace-" + asset.GetVoiceAssetId(), ModelResolved: "voice-model",
	}
	request := &runtimev1.SubmitScenarioJobRequest{
		Head: head, ScenarioType: job.GetScenarioType(), ExecutionMode: job.GetExecutionMode(),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			Source:        &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator"}},
			TargetModelId: "voice-model",
		}}},
	}
	target := testVoiceAssetCloudTarget("connector-voice")
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestVoiceWorkflow,
		capabilitydriver.VoiceCreateContract,
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.voice.test", DriverId: "driver.voice.test", DriverDialect: "test/voice/v1"},
		testVoiceAssetCloudBinding(target).ProviderModelTarget,
		connector.ConnectorRecord{
			ConnectorID: target.Cloud.ConnectorID, Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: asset.GetSubjectUserId(),
			Provider: target.Cloud.Provider, Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true,
		},
		nil,
		request,
		job.GetExecutionMode(),
		capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(),
		asset.GetAppId(),
		asset.GetSubjectUserId(),
		&cloudVoiceWorkflowCapture{
			Provider: target.Cloud.Provider, ModelID: target.Cloud.ProviderModelID, WorkflowType: "text_description",
			WorkflowModelID: "voice-workflow", OutputPersistence: "provider_persistent",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest(job.GetJobId())
	beginCloudCredentialCustodyForTest(t, store, job.GetJobId())
	if created, published, createErr := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly); createErr != nil || !published || created == nil {
		t.Fatalf("persist primary voice ScenarioJob: job=%#v published=%v err=%v", created, published, createErr)
	}
	if !completed {
		return
	}
	if terminal, transitioned, transitionErr := store.transitionVoiceCompleted(job.GetJobId(), asset, voiceAssetReference(asset.GetVoiceAssetId()), func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ProgressPercent = 100
	}); transitionErr != nil || !transitioned || terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("persist completed primary voice ScenarioJob: job=%#v transitioned=%v err=%v", terminal, transitioned, transitionErr)
	}
}

func agePrimaryVoiceScenarioJobBeyondRetentionForTest(t *testing.T, localStatePath string, jobID string) {
	t.Helper()
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	record := store.jobs[strings.TrimSpace(jobID)]
	if record == nil || record.job == nil || !isTerminalScenarioJobStatus(record.job.GetStatus()) {
		store.mu.Unlock()
		t.Fatalf("terminal primary voice ScenarioJob %q is missing", jobID)
	}
	oldUpdated := time.Now().UTC().Add(-scenarioJobRetention - time.Minute)
	oldCreated := oldUpdated.Add(-time.Minute)
	record.job.CreatedAt = timestamppb.New(oldCreated)
	record.job.UpdatedAt = timestamppb.New(oldUpdated)
	record.createdAt = oldCreated
	record.updatedAt = oldUpdated
	record.terminalAt = oldUpdated
	err = store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistTransition, JobID: jobID, Status: record.job.GetStatus()})
	store.mu.Unlock()
	if err != nil {
		t.Fatalf("age primary voice ScenarioJob beyond retention: %v", err)
	}
}

func restartProtectedAIServiceForVoicePublicationTest(t *testing.T, localStatePath string) *Service {
	t.Helper()
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	svc, err := NewProtected(nil, nil, connectorStore, runtimecfg.Config{LocalStatePath: localStatePath})
	if err != nil {
		t.Fatalf("restart protected AI Service: %v", err)
	}
	return svc
}

func TestVoiceAssetStoreProviderPersistentAssetSurvivesReopenWithoutOwningJobs(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	target := testVoiceAssetCloudTarget("connector-voice")
	draft := testProviderPersistentVoiceDraft("voice-job-1")
	asset, published := store.publishResult(draft, target, testVoiceAssetCloudBinding(target), "provider-voice-ref", nil,
		func(asset *runtimev1.VoiceAsset, reference *runtimev1.VoiceReference) bool {
			return asset.GetVoiceAssetId() == reference.GetVoiceAssetId()
		})
	if !published || asset == nil {
		t.Fatal("provider-persistent VoiceAsset was not published")
	}
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("connectorGrantId")) || bytes.Contains(raw, []byte("connector_grant_id")) {
		t.Fatal("durable VoiceAsset retained removed grant identity")
	}

	reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	stored, storedTarget, binding, ok := reopened.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok || stored.GetProviderVoiceRef() != "provider-voice-ref" || !runtimeidentity.Equal(storedTarget, target) ||
		binding == nil || !binding.Valid() || binding.ConnectorID != "connector-voice" {
		t.Fatalf("reopened VoiceAsset=%#v target=%#v binding=%#v visible=%v", stored, storedTarget, binding, ok)
	}
}

func TestVoiceAssetStorePublishFailsClosedWhenDurableAssetCannotPersist(t *testing.T) {
	store := newVoiceAssetStore()
	store.durablePath = t.TempDir()
	target := testVoiceAssetCloudTarget("connector-voice")
	draft := testProviderPersistentVoiceDraft("voice-job-failed")
	commitCalled := false
	asset, published := store.publishResult(draft, target, testVoiceAssetCloudBinding(target), "provider-voice-ref", nil,
		func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool {
			commitCalled = true
			return true
		})
	if published || asset != nil || commitCalled {
		t.Fatalf("failed durable publication asset=%#v published=%v commitCalled=%v", asset, published, commitCalled)
	}
	if stored, ok := store.getAsset(draft.GetVoiceAssetId()); ok || stored != nil {
		t.Fatalf("failed durable publication leaked VoiceAsset %#v", stored)
	}
}

func TestVoiceAssetStoreTerminalCommitFailureRemovesDurablePending(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	target := testVoiceAssetCloudTarget("connector-voice")
	draft := testProviderPersistentVoiceDraft("voice-job-terminal-commit-failed")
	commitCalled := false
	asset, published := store.publishResult(draft, target, testVoiceAssetCloudBinding(target), "provider-voice-ref", nil,
		func(*runtimev1.VoiceAsset, *runtimev1.VoiceReference) bool {
			commitCalled = true
			return false
		})
	if published || asset != nil || !commitCalled {
		t.Fatalf("failed primary terminal commit asset=%#v published=%v commitCalled=%v", asset, published, commitCalled)
	}
	if visible, ok := store.getAsset(draft.GetVoiceAssetId()); ok || visible != nil {
		t.Fatalf("failed primary terminal commit leaked VoiceAsset %#v", visible)
	}

	reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	reopened.mu.RLock()
	assetCount, pendingCount := len(reopened.assets), len(reopened.pending)
	reopened.mu.RUnlock()
	if assetCount != 0 || pendingCount != 0 {
		t.Fatalf("failed primary terminal commit retained durable publication: assets=%d pending=%d", assetCount, pendingCount)
	}
}

func TestVoicePublicationRestartPromotesPendingFromCompletedPrimaryJob(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	asset := testActiveProviderPersistentVoiceAsset("voice-job-completed-before-promote")
	persistPrimaryVoiceScenarioJobForTest(t, localStatePath, asset, true)
	persistPendingVoicePublicationForTest(t, localStatePath, asset)

	beforeRestart, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if visible, ok := beforeRestart.getAsset(asset.GetVoiceAssetId()); ok || visible != nil || len(beforeRestart.listAssets(&runtimev1.ListVoiceAssetsRequest{})) != 0 {
		t.Fatalf("private pending VoiceAsset was public before reconciliation: %#v", visible)
	}

	svc := restartProtectedAIServiceForVoicePublicationTest(t, localStatePath)
	promoted, target, binding, ok := svc.voiceAssets.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok || promoted.GetProviderVoiceRef() != asset.GetProviderVoiceRef() || target == nil || binding == nil || !binding.Valid() {
		t.Fatalf("completed primary Job did not promote pending VoiceAsset: asset=%#v target=%#v binding=%#v visible=%v", promoted, target, binding, ok)
	}

	reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	reopened.mu.RLock()
	pendingCount := len(reopened.pending)
	reopened.mu.RUnlock()
	if durable, ok := reopened.getAsset(asset.GetVoiceAssetId()); !ok || durable == nil || pendingCount != 0 {
		t.Fatalf("promoted VoiceAsset was not durably recovered: asset=%#v visible=%v pending=%d", durable, ok, pendingCount)
	}
}

func TestVoicePublicationRestartReconcilesBeforePruningExpiredCompletedJob(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	asset := testActiveProviderPersistentVoiceAsset("voice-job-expired-completed-before-promote")
	persistPrimaryVoiceScenarioJobForTest(t, localStatePath, asset, true)
	agePrimaryVoiceScenarioJobBeyondRetentionForTest(t, localStatePath, asset.GetVoiceAssetId())
	persistPendingVoicePublicationForTest(t, localStatePath, asset)

	svc := restartProtectedAIServiceForVoicePublicationTest(t, localStatePath)
	promoted, _, binding, ok := svc.voiceAssets.getAssetCloudBinding(asset.GetVoiceAssetId())
	if !ok || promoted.GetProviderVoiceRef() != asset.GetProviderVoiceRef() || binding == nil || !binding.Valid() {
		t.Fatalf("expired completed primary Job did not promote pending VoiceAsset before prune: asset=%#v binding=%#v visible=%v", promoted, binding, ok)
	}
	if pruned, ok := svc.scenarioJobs.get(asset.GetVoiceAssetId()); ok || pruned != nil {
		t.Fatalf("expired completed primary Job survived post-reconciliation prune: %#v", pruned)
	}

	reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if durable, ok := reopened.getAsset(asset.GetVoiceAssetId()); !ok || durable == nil {
		t.Fatalf("promoted VoiceAsset was lost after expired primary Job prune: asset=%#v visible=%v", durable, ok)
	}
}

func TestVoicePublicationRestartRemovesPendingWithoutCompletedPrimaryJob(t *testing.T) {
	for _, primaryState := range []string{"missing", "nonterminal"} {
		t.Run(primaryState, func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			asset := testActiveProviderPersistentVoiceAsset("voice-job-" + primaryState)
			if primaryState == "nonterminal" {
				persistPrimaryVoiceScenarioJobForTest(t, localStatePath, asset, false)
			}
			persistPendingVoicePublicationForTest(t, localStatePath, asset)

			svc := restartProtectedAIServiceForVoicePublicationTest(t, localStatePath)
			if visible, ok := svc.voiceAssets.getAsset(asset.GetVoiceAssetId()); ok || visible != nil || len(svc.voiceAssets.listAssets(&runtimev1.ListVoiceAssetsRequest{})) != 0 {
				t.Fatalf("pending VoiceAsset without completed primary Job became public: %#v", visible)
			}
			if primaryState == "nonterminal" {
				job, ok := svc.scenarioJobs.get(asset.GetVoiceAssetId())
				if !ok || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
					t.Fatalf("restarted nonterminal primary Job=%#v visible=%v", job, ok)
				}
			}

			reopened, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			reopened.mu.RLock()
			assetCount, pendingCount := len(reopened.assets), len(reopened.pending)
			reopened.mu.RUnlock()
			if assetCount != 0 || pendingCount != 0 {
				t.Fatalf("orphan pending VoiceAsset survived restart: assets=%d pending=%d", assetCount, pendingCount)
			}
		})
	}
}

func TestVoiceAssetDraftPreservesExplicitWorkflowFamilyMetadata(t *testing.T) {
	for _, tc := range []struct {
		name, modelID, workflowModelID, family string
	}{
		{name: "qwen3tts", modelID: "speech/qwen3tts", workflowModelID: "qwen3-local-voice-design", family: "qwen3_tts"},
		{name: "omnivoice", modelID: "k2-fsa/OmniVoice", workflowModelID: "local/omnivoice-voice-clone", family: "omnivoice"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			asset := newVoiceAssetDraft(&voiceWorkflowSubmitInput{
				Head:         &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-1"},
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
					Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator"}},
				}}},
				ModelResolved: tc.modelID, WorkflowModelID: tc.workflowModelID, WorkflowFamily: tc.family, Provider: "local",
			}, "voice-"+tc.name, timestamppb.Now())
			if asset == nil || asset.GetMetadata().GetFields()["workflow_family"].GetStringValue() != tc.family {
				t.Fatalf("VoiceAsset metadata=%#v", asset)
			}
		})
	}
}

func TestVoiceAssetStoreRejectsStaleDurableVersion(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	writeVoiceAssetDiskTestFile(t, localStatePath, []byte(`{"version":1,"records":[]}`))
	_, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err == nil || !strings.Contains(err.Error(), "unsupported voice asset store version 1") {
		t.Fatalf("stale durable version error = %v", err)
	}
}

func TestVoiceAssetStoreRejectsRemovedGrantField(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	writeVoiceAssetDiskTestFile(t, localStatePath, []byte(`{
		"version":2,
		"records":[{"asset":{},"target":{"cloud":{"connectorId":"connector-1","connectorGrantId":"removed-grant","remoteModelCatalogId":"catalog-1","providerModelId":"model-1","provider":"provider-1"}},"connector_id":"connector-1"}]
	}`))
	_, err := newVoiceAssetStoreForLocalStatePath(localStatePath)
	if err == nil || !strings.Contains(err.Error(), `unknown field "connectorGrantId"`) {
		t.Fatalf("removed grant field error = %v", err)
	}
}

func TestVoiceAssetStoreRejectsMissingOrConflictingConnectorIdentity(t *testing.T) {
	assetRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(&runtimev1.VoiceAsset{
		VoiceAssetId: "voice-asset-1", Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		ProviderVoiceRef: "provider-voice-ref",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, connectorID := range map[string]string{"missing": "", "conflicting": "connector-2"} {
		t.Run(name, func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			target := testVoiceAssetCloudTarget("connector-1")
			binding := testVoiceAssetCloudBinding(target)
			raw, marshalErr := json.Marshal(voiceAssetDiskSnapshot{Version: voiceAssetDiskStoreVersion, Records: []voiceAssetDiskRecord{{
				Asset: assetRaw, Target: target, CapabilityContract: binding.CapabilityContract, Implementation: binding.Implementation,
				ProviderModelTarget: binding.ProviderModelTarget.AsMap(), ConnectorID: connectorID,
			}}})
			if marshalErr != nil {
				t.Fatal(marshalErr)
			}
			writeVoiceAssetDiskTestFile(t, localStatePath, raw)
			_, loadErr := newVoiceAssetStoreForLocalStatePath(localStatePath)
			if loadErr == nil || !strings.Contains(loadErr.Error(), "has no exact Connector identity") {
				t.Fatalf("connector identity error = %v", loadErr)
			}
		})
	}
}

func writeVoiceAssetDiskTestFile(t *testing.T, localStatePath string, raw []byte) {
	t.Helper()
	path := voiceAssetStorePathForLocalStatePath(localStatePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}
