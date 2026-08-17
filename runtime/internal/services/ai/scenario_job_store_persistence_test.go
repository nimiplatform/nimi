package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestScenarioJobStorePersistsJobAndCapturedResolvedAssemblyInOneRecord(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: "loadout-original", CapabilityContract: "text.generate", RecipeId: "llama.text-generate.gemma-4-e2b-it.v1", RecipeRevision: "1",
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text.generate.llama-cpp", DriverId: "nimi.runtime.driver.llama-cpp", DriverDialect: "llama.cpp/text-generate/v1"},
		ModelAxes:      []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main.gguf", ModelAssetId: "model-original", ContentId: "sha256:" + strings.Repeat("a", 64)}},
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-original", Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-job-original",
		EffectiveInputIdentity: identity,
	}
	assembly := resolvedAssemblyForPersistenceTest(t, identity)
	created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly)
	if err != nil || created == nil || !published {
		t.Fatalf("atomic create = %#v, published=%v err=%v", created, published, err)
	}
	raw, err := os.ReadFile(scenarioJobStorePathForLocalStatePath(localStatePath))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"job-original", "loadout-original", "model-original", identity.GetRecipeId(), identity.GetImplementation().GetDriverDialect()} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("durable ScenarioJob record does not contain captured identity %q", expected)
		}
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.get("job-original")
	if !ok {
		t.Fatal("durable ScenarioJob not visible after restart")
	}
	if persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("interrupted status = %v, want FAILED", persisted.GetStatus())
	}
	if persisted.GetEffectiveInputIdentity().GetLoadoutId() != "loadout-original" || persisted.GetEffectiveInputIdentity().GetModelAxes()[0].GetModelAssetId() != "model-original" {
		t.Fatalf("restart attribution changed captured ResolvedAssembly: %#v", persisted.GetEffectiveInputIdentity())
	}
	privateAssembly, ok := reopened.resolvedAssembly(job.GetJobId())
	if !ok || privateAssembly.ModelAxes[0].AbsolutePath != assembly.ModelAxes[0].AbsolutePath || privateAssembly.LoadPlan.Text == nil {
		t.Fatalf("restart private ResolvedAssembly = %+v, visible=%v", privateAssembly, ok)
	}
	if !strings.Contains(persisted.GetReasonDetail(), "loadout_id=loadout-original") || !strings.Contains(persisted.GetReasonDetail(), "recipe_id="+identity.GetRecipeId()) {
		t.Fatalf("restart error does not point to original assembly: %q", persisted.GetReasonDetail())
	}
}

func TestScenarioJobStoreRejectsInvalidLocalJobResolvedAssemblyPairs(t *testing.T) {
	tests := []struct {
		name           string
		mutate         func(*runtimev1.ScenarioJob, *localResolvedAssembly)
		removeAssembly bool
	}{
		{name: "missing public identity", mutate: func(job *runtimev1.ScenarioJob, _ *localResolvedAssembly) { job.EffectiveInputIdentity = nil }},
		{name: "missing private assembly", removeAssembly: true},
		{name: "missing pair", removeAssembly: true, mutate: func(job *runtimev1.ScenarioJob, _ *localResolvedAssembly) { job.EffectiveInputIdentity = nil }},
		{name: "public identity mismatch", mutate: func(job *runtimev1.ScenarioJob, _ *localResolvedAssembly) {
			job.EffectiveInputIdentity.LoadoutId = "loadout-public-mismatch"
		}},
		{name: "missing canonical Loadout identity", mutate: func(_ *runtimev1.ScenarioJob, assembly *localResolvedAssembly) {
			assembly.LoadoutID = ""
		}},
		{name: "missing canonical ModelAsset identity", mutate: func(_ *runtimev1.ScenarioJob, assembly *localResolvedAssembly) {
			assembly.ModelAxes[0].ModelAssetID = ""
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			identity := &runtimev1.LoadoutEffectiveInputIdentity{
				LoadoutId: "loadout-pair", CapabilityContract: "text.generate", RecipeId: "recipe-pair", RecipeRevision: "1",
				Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text", DriverId: "driver.text", DriverDialect: "text/v1"},
				ModelAxes:      []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main", ModelAssetId: "model-pair", ContentId: "sha256:" + strings.Repeat("a", 64)}},
			}
			assembly := resolvedAssemblyForPersistenceTest(t, identity)
			now := timestamppb.New(time.Now().UTC())
			job := &runtimev1.ScenarioJob{
				JobId: "job-pair", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
				CreatedAt: now, UpdatedAt: now, EffectiveInputIdentity: proto.Clone(identity).(*runtimev1.LoadoutEffectiveInputIdentity),
			}
			if test.mutate != nil {
				test.mutate(job, assembly)
			}
			if test.removeAssembly {
				assembly = nil
			}
			store, err := newScenarioJobStoreForLocalStatePath(filepath.Join(t.TempDir(), "local-state.json"))
			if err != nil {
				t.Fatal(err)
			}
			created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly)
			if err == nil || created != nil || published {
				t.Fatalf("invalid local Job pair created=%#v published=%v err=%v", created, published, err)
			}
			if persisted, ok := store.get(job.GetJobId()); ok || persisted != nil {
				t.Fatalf("invalid local Job pair became visible: %#v", persisted)
			}
		})
	}
}

func TestScenarioJobStoreIsolatesInvalidRowsAndStartsAIService(t *testing.T) {
	tests := []struct {
		name   string
		poison func(*scenarioJobDiskRawSnapshot)
	}{
		{
			name: "malformed Job",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				item := scenarioJobDiskRecord{Job: json.RawMessage(`{"job_id":7}`), CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, item))
			},
		},
		{
			name: "duplicate Job ID",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				snapshot.Records = append(snapshot.Records, append(json.RawMessage(nil), snapshot.Records[0]...))
			},
		},
		{
			name: "invalid idempotency row",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				item := scenarioJobDiskIdempotencyEntry{JobID: "job-healthy-a", BoundAt: time.Now().UTC()}
				snapshot.Idempotency = append(snapshot.Idempotency, marshalScenarioJobIsolationRowForTest(t, item))
			},
		},
		{
			name: "malformed private ResolvedAssembly",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-bad-assembly")
				job.RouteDecision = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
				job.EffectiveInputIdentity = &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-bad"}
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, ResolvedAssembly: json.RawMessage(`{"version":999}`),
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "malformed Cloud ResolvedAssembly",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-bad-cloud-assembly")
				job.Head = &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"}
				job.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
				job.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB
				job.RouteDecision = runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
				job.TraceId = "trace-bad-cloud"
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CloudResolvedAssembly: json.RawMessage(`{"version":999}`),
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "parseable Job with invalid public status",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-invalid-public-status")
				assembly := cloudAssemblyForIsolationTest(t, job)
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				assemblyRaw, err := json.Marshal(assembly)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CloudResolvedAssembly: assemblyRaw,
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "parseable Job with unspecified public reason",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-invalid-public-reason")
				assembly := cloudAssemblyForIsolationTest(t, job)
				job.ReasonCode = runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				assemblyRaw, err := json.Marshal(assembly)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CloudResolvedAssembly: assemblyRaw,
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "parseable Job with unknown public reason",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-unknown-public-reason")
				assembly := cloudAssemblyForIsolationTest(t, job)
				job.ReasonCode = runtimev1.ReasonCode(2147483647)
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				assemblyRaw, err := json.Marshal(assembly)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CloudResolvedAssembly: assemblyRaw,
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "non-voice Cloud assembly with voice workflow capture",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-nonvoice-workflow-capture")
				assembly := cloudAssemblyForIsolationTest(t, job)
				assembly.VoiceWorkflow = &cloudVoiceWorkflowCapture{
					Provider: "openai", ModelID: "gpt-image-1", WorkflowType: "text_description",
					WorkflowModelID: "voice-workflow", OutputPersistence: "provider_persistent",
				}
				appendCloudIsolationRowForTest(t, snapshot, job, assembly, true)
			},
		},
		{
			name: "voice Cloud assembly target mismatch",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := submittedVoiceScenarioJobForIsolationTest("job-voice-target-mismatch")
				assembly := cloudVoiceAssemblyForIsolationTest(t, job)
				assembly.VoiceWorkflow.Provider = "different-provider"
				appendCloudIsolationRowForTest(t, snapshot, job, assembly, false)
			},
		},
		{
			name: "Cloud media assembly with unknown stream behavior",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-invalid-media-stream")
				assembly := cloudAssemblyForIsolationTest(t, job)
				assembly.MediaStreamMode = capabilitydriver.CloudMediaStreamMode("future-stream-mode")
				appendCloudIsolationRowForTest(t, snapshot, job, assembly, true)
			},
		},
		{
			name: "Cloud media assembly request mode mismatch",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-media-request-mode-mismatch")
				assembly := cloudAssemblyForIsolationTest(t, job)
				request := cloudImageRequestForIsolationTest(job)
				request.ExecutionMode = runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
				requestRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(request)
				if err != nil {
					t.Fatal(err)
				}
				assembly.Request = requestRaw
				appendCloudIsolationRowForTest(t, snapshot, job, assembly, true)
			},
		},
		{
			name: "local Job missing captured pair",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-missing-captured-pair")
				job.RouteDecision = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
		{
			name: "public identity disagrees with private ResolvedAssembly",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				identity := &runtimev1.LoadoutEffectiveInputIdentity{
					LoadoutId: "loadout-public", CapabilityContract: "text.generate", RecipeId: "recipe-persisted", RecipeRevision: "1",
					Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text", DriverId: "driver.text", DriverDialect: "text/v1"},
					ModelAxes:      []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main", ModelAssetId: "model-persisted", ContentId: "sha256:" + strings.Repeat("b", 64)}},
				}
				job := completedScenarioJobForIsolationTest("job-mismatched-captured-pair")
				job.RouteDecision = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
				job.EffectiveInputIdentity = identity
				jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
				if err != nil {
					t.Fatal(err)
				}
				assembly := resolvedAssemblyForPersistenceTest(t, identity)
				assembly.LoadoutID = "loadout-private"
				assemblyRaw, err := json.Marshal(assembly)
				if err != nil {
					t.Fatal(err)
				}
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, ResolvedAssembly: assemblyRaw,
					CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
				}))
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			path := scenarioJobStorePathForLocalStatePath(localStatePath)
			snapshot := healthyScenarioJobRawSnapshotForIsolationTest(t)
			test.poison(&snapshot)
			poisoned, err := json.Marshal(snapshot)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, poisoned, 0o600); err != nil {
				t.Fatal(err)
			}

			var logs bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&logs, nil))
			connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
			svc, err := NewProtected(logger, nil, connectorStore, runtimecfg.Config{LocalStatePath: localStatePath})
			if err != nil {
				t.Fatalf("invalid sibling prevented AI Service startup: %v", err)
			}
			for _, jobID := range []string{"job-healthy-a", "job-healthy-b"} {
				if job, ok := svc.scenarioJobs.get(jobID); !ok || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
					t.Fatalf("healthy sibling %q after isolation = %#v, visible=%v", jobID, job, ok)
				}
			}
			diagnostics := svc.scenarioJobs.IsolationDiagnostics()
			if len(diagnostics) != 1 || diagnostics[0].Level != scenarioJobIsolationLevelRecord || diagnostics[0].ReasonCode != scenarioJobRecordQuarantinedReason || diagnostics[0].QuarantinePath == "" {
				t.Fatalf("record isolation diagnostics = %+v", diagnostics)
			}
			if !strings.Contains(logs.String(), scenarioJobRecordQuarantinedReason) {
				t.Fatalf("AI Service did not emit typed record isolation diagnostic: %s", logs.String())
			}
			quarantined, err := os.ReadFile(diagnostics[0].QuarantinePath)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(quarantined, poisoned) {
				t.Fatal("record quarantine did not preserve the original document bytes")
			}
			var rewritten scenarioJobDiskRawSnapshot
			rewrittenRaw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := decodeScenarioJobStrictJSON(rewrittenRaw, &rewritten); err != nil || len(rewritten.Records) != 2 || len(rewritten.Idempotency) != 2 {
				t.Fatalf("healthy ScenarioJob rewrite = records=%d bindings=%d err=%v", len(rewritten.Records), len(rewritten.Idempotency), err)
			}
			createCompletedCloudScenarioJobForIsolationTest(t, svc.scenarioJobs, "job-after-isolation")
			preserved, err := os.ReadFile(diagnostics[0].QuarantinePath)
			if err != nil || !bytes.Equal(preserved, poisoned) {
				t.Fatalf("healthy write overwrote quarantined bytes: err=%v", err)
			}
		})
	}
}

func TestScenarioJobStorePersistsCloudAssemblyWithoutCredentialAndUsesCloudRestartReason(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-cloud-restart", Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		ModelResolved: "gpt-image-1",
		Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-cloud-restart",
	}
	target, err := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "gpt-image-1", "remoteModelCatalogId": "catalog-image",
	})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestMedia, "image.generate",
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1"},
		target,
		connector.ConnectorRecord{
			ConnectorID: "connector-cloud", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
			Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true,
		},
		nil, cloudImageRequestForIsolationTest(job),
		job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	created, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "scope-cloud-restart", assembly)
	if err != nil || created == nil || !published {
		t.Fatalf("atomic Cloud create = %#v published=%v err=%v", created, published, err)
	}
	raw, err := os.ReadFile(store.durablePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"captured prompt", "connector-cloud", "cloud_resolved_assembly"} {
		if !bytes.Contains(raw, []byte(expected)) {
			t.Fatalf("durable Cloud assembly missing %q: %s", expected, raw)
		}
	}
	if bytes.Contains(raw, []byte("credential-secret")) {
		t.Fatalf("durable Cloud assembly contains credential material: %s", raw)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.get(job.GetJobId())
	if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("restarted Cloud Job = %#v visible=%v", persisted, ok)
	}
	if persisted.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("restarted Cloud reason = %v, want AI_PROVIDER_INTERNAL", persisted.GetReasonCode())
	}
	if _, ok := reopened.cloudResolvedAssembly(job.GetJobId()); !ok {
		t.Fatal("restarted Cloud Job lost captured ResolvedAssembly")
	}
}

func TestScenarioJobStorePersistsCompletedVoiceResultWithCapturedCloudAssembly(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-cloud-voice", Head: &runtimev1.ScenarioRequestHead{AppId: "app.voice", SubjectUserId: "user-voice"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:  now, UpdatedAt: now, TraceId: "trace-cloud-voice", ModelResolved: "voice-model",
	}
	target, err := structpb.NewStruct(map[string]any{
		"provider": "voice-provider", "providerModelId": "voice-model", "remoteModelCatalogId": "catalog-voice",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{
		Head: job.GetHead(), ScenarioType: job.GetScenarioType(), ExecutionMode: job.GetExecutionMode(),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			Source:        &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator"}},
			TargetModelId: "voice-model",
		}}},
	}
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestVoiceWorkflow, "voice.create",
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.voice", DriverId: "nimi.runtime.driver.voice", DriverDialect: "provider/media-v1"},
		target,
		connector.ConnectorRecord{
			ConnectorID: "connector-voice", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-voice",
			Provider: "voice-provider", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true,
		},
		nil, request, job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(),
		&cloudVoiceWorkflowCapture{Provider: "voice-provider", ModelID: "voice-model", WorkflowType: "text_description", WorkflowModelID: "voice-model", OutputPersistence: "provider_persistent"},
	)
	if err != nil {
		t.Fatal(err)
	}
	created, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "scope-cloud-voice", assembly)
	if err != nil || created == nil || !published {
		t.Fatalf("atomic Cloud voice create = %#v published=%v err=%v", created, published, err)
	}
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId: job.GetJobId(), AppId: job.GetHead().GetAppId(), SubjectUserId: job.GetHead().GetSubjectUserId(),
		Provider: "voice-provider", ModelId: "voice-model", ProviderVoiceRef: "provider-voice-ref",
		Persistence: runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT,
		Status:      runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_ACTIVE, CreatedAt: now, UpdatedAt: now,
	}
	completed, transitioned, err := store.transitionVoiceCompleted(job.GetJobId(), asset, voiceAssetReference(asset.GetVoiceAssetId()), func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
		job.ProgressPercent = 100
	})
	if err != nil || !transitioned || completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("complete voice Job = %#v transitioned=%v err=%v", completed, transitioned, err)
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	persistedAsset, persistedReference, ok := reopened.completedVoiceResult(job.GetJobId())
	if !ok || persistedAsset.GetProviderVoiceRef() != "provider-voice-ref" || persistedReference.GetVoiceAssetId() != job.GetJobId() {
		t.Fatalf("reopened voice result asset=%#v reference=%#v visible=%v", persistedAsset, persistedReference, ok)
	}
}

func TestScenarioJobStoreIsolatesTruncatedDocumentAndStartsEmptyAIService(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	path := scenarioJobStorePathForLocalStatePath(localStatePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	poisoned := []byte(`{"version":1,"records":[`)
	if err := os.WriteFile(path, poisoned, 0o600); err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	svc, err := NewProtected(logger, nil, connectorStore, runtimecfg.Config{LocalStatePath: localStatePath})
	if err != nil {
		t.Fatalf("truncated ScenarioJob document prevented AI Service startup: %v", err)
	}
	svc.scenarioJobs.mu.RLock()
	jobCount := len(svc.scenarioJobs.jobs)
	svc.scenarioJobs.mu.RUnlock()
	if jobCount != 0 {
		t.Fatalf("document isolation started with %d ScenarioJobs, want empty", jobCount)
	}
	diagnostics := svc.scenarioJobs.IsolationDiagnostics()
	if len(diagnostics) != 1 || diagnostics[0].Level != scenarioJobIsolationLevelDocument || diagnostics[0].ReasonCode != scenarioJobDocumentQuarantinedReason || diagnostics[0].QuarantinePath == "" {
		t.Fatalf("document isolation diagnostics = %+v", diagnostics)
	}
	if !strings.Contains(logs.String(), scenarioJobDocumentQuarantinedReason) {
		t.Fatalf("AI Service did not emit typed document isolation diagnostic: %s", logs.String())
	}
	quarantined, err := os.ReadFile(diagnostics[0].QuarantinePath)
	if err != nil || !bytes.Equal(quarantined, poisoned) {
		t.Fatalf("document quarantine did not preserve original bytes: err=%v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("isolated document remained on active path: %v", err)
	}
	createCompletedCloudScenarioJobForIsolationTest(t, svc.scenarioJobs, "job-after-document-isolation")
	preserved, err := os.ReadFile(diagnostics[0].QuarantinePath)
	if err != nil || !bytes.Equal(preserved, poisoned) {
		t.Fatalf("healthy write overwrote isolated document: err=%v", err)
	}
}

func healthyScenarioJobRawSnapshotForIsolationTest(t *testing.T) scenarioJobDiskRawSnapshot {
	t.Helper()
	snapshot := scenarioJobDiskRawSnapshot{Version: scenarioJobDiskStoreVersion}
	for _, jobID := range []string{"job-healthy-a", "job-healthy-b"} {
		job := completedScenarioJobForIsolationTest(jobID)
		assemblyRaw, err := json.Marshal(cloudAssemblyForIsolationTest(t, job))
		if err != nil {
			t.Fatal(err)
		}
		jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
		if err != nil {
			t.Fatal(err)
		}
		snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
			Job: jobRaw, CloudResolvedAssembly: assemblyRaw,
			CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: job.GetUpdatedAt().AsTime(),
		}))
		snapshot.Idempotency = append(snapshot.Idempotency, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskIdempotencyEntry{
			ScopeKey: "scope-" + jobID, JobID: jobID, BoundAt: job.GetUpdatedAt().AsTime(),
		}))
	}
	return snapshot
}

func resolvedAssemblyForPersistenceTest(t *testing.T, identity *runtimev1.LoadoutEffectiveInputIdentity) *localResolvedAssembly {
	t.Helper()
	axes := make([]localResolvedAssemblyModelAxis, 0, len(identity.GetModelAxes()))
	modelFiles := make([]localResolvedAssemblyInvocationBinding, 0, len(identity.GetModelAxes()))
	for index, axis := range identity.GetModelAxes() {
		absolutePath := filepath.Join(t.TempDir(), axis.GetSlotId()+".bin")
		modelAssetID := axis.GetModelAssetId()
		entrySHA := strings.Repeat(string(rune('a'+index)), 64)
		axes = append(axes, localResolvedAssemblyModelAxis{
			RequirementID: axis.GetSlotId(), ModelAssetID: modelAssetID,
			AbsolutePath: absolutePath, VerifiedContentID: axis.GetContentId(), EntrySHA256: entrySHA,
		})
		modelFiles = append(modelFiles, localResolvedAssemblyInvocationBinding{
			RequirementID: axis.GetSlotId(), ModelAssetID: modelAssetID, AbsolutePath: absolutePath,
			VerifiedContentID: axis.GetContentId(), EntrySHA256: entrySHA,
		})
	}
	var portableConfig json.RawMessage
	if identity.GetOptions() != nil {
		var err error
		portableConfig, err = protojson.Marshal(identity.GetOptions())
		if err != nil {
			t.Fatal(err)
		}
	}
	recipeCustody := make([]json.RawMessage, 0, len(identity.GetRecipeCustody()))
	for _, item := range identity.GetRecipeCustody() {
		raw, err := protojson.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		recipeCustody = append(recipeCustody, raw)
	}
	implementation := identity.GetImplementation()
	return &localResolvedAssembly{
		Version: localResolvedAssemblyVersion, LoadoutID: identity.GetLoadoutId(),
		CapabilityContract: identity.GetCapabilityContract(), RecipeID: identity.GetRecipeId(), RecipeRevision: identity.GetRecipeRevision(),
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: implementation.GetImplementationId(), DriverID: implementation.GetDriverId(), DriverDialect: implementation.GetDriverDialect(),
		},
		PortableConfig: portableConfig, ModelAxes: axes, RecipeCustody: recipeCustody,
		Request: localResolvedAssemblyRequest{Kind: "text.generate", Payload: json.RawMessage(`{"input":[]}`)},
		LoadPlan: localResolvedAssemblyLoadPlan{Kind: "text", Text: &localResolvedAssemblyTextPlan{
			ProcessKey: "process-persistence-test", ModelFiles: modelFiles, RequestPath: "/v1/chat/completions", RequestBody: []byte(`{"messages":[]}`),
		}},
		ProcessIdentity: localResolvedAssemblyProcessIdentity{ProcessKey: "process-persistence-test", DriverID: implementation.GetDriverId()},
	}
}

func completedScenarioJobForIsolationTest(jobID string) *runtimev1.ScenarioJob {
	now := timestamppb.New(time.Now().UTC())
	return &runtimev1.ScenarioJob{
		JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ModelResolved: "gpt-image-1",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-" + jobID,
	}
}

func cloudImageRequestForIsolationTest(job *runtimev1.ScenarioJob) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		Head: cloneScenarioHead(job.GetHead()), ScenarioType: job.GetScenarioType(), ExecutionMode: job.GetExecutionMode(),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "captured prompt"},
		}},
	}
}

func submittedVoiceScenarioJobForIsolationTest(jobID string) *runtimev1.ScenarioJob {
	now := timestamppb.New(time.Now().UTC())
	return &runtimev1.ScenarioJob{
		JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: "app.voice", SubjectUserId: "user-voice"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ModelResolved: "voice-model",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-" + jobID,
	}
}

func cloudVoiceAssemblyForIsolationTest(t *testing.T, job *runtimev1.ScenarioJob) *cloudResolvedAssembly {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{
		"provider": "voice-provider", "providerModelId": "voice-model", "remoteModelCatalogId": "catalog-voice",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{
		Head: cloneScenarioHead(job.GetHead()), ScenarioType: job.GetScenarioType(), ExecutionMode: job.GetExecutionMode(),
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: &runtimev1.VoiceCreateScenarioSpec{
			Source: &runtimev1.VoiceCreateScenarioSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
				InstructionText: "warm narrator", PreferredName: "captured-voice-name",
			}},
			TargetModelId: "voice-model",
		}}},
	}
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestVoiceWorkflow, "voice.create",
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.voice", DriverId: "nimi.runtime.driver.voice", DriverDialect: "provider/media-v1"},
		target,
		connector.ConnectorRecord{
			ConnectorID: "connector-voice", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: job.GetHead().GetSubjectUserId(),
			Provider: "voice-provider", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true,
		},
		nil, request, job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(),
		&cloudVoiceWorkflowCapture{
			Provider: "voice-provider", ModelID: "voice-model", WorkflowType: "text_description",
			WorkflowModelID: "voice-workflow", OutputPersistence: "provider_persistent",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return assembly
}

func appendCloudIsolationRowForTest(
	t *testing.T,
	snapshot *scenarioJobDiskRawSnapshot,
	job *runtimev1.ScenarioJob,
	assembly *cloudResolvedAssembly,
	terminal bool,
) {
	t.Helper()
	jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
	if err != nil {
		t.Fatal(err)
	}
	assemblyRaw, err := json.Marshal(assembly)
	if err != nil {
		t.Fatal(err)
	}
	terminalAt := time.Time{}
	if terminal {
		terminalAt = job.GetUpdatedAt().AsTime()
	}
	snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
		Job: jobRaw, CloudResolvedAssembly: assemblyRaw,
		CreatedAt: job.GetCreatedAt().AsTime(), UpdatedAt: job.GetUpdatedAt().AsTime(), TerminalAt: terminalAt,
	}))
}

func cloudAssemblyForIsolationTest(t *testing.T, job *runtimev1.ScenarioJob) *cloudResolvedAssembly {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "gpt-image-1", "remoteModelCatalogId": "catalog-image",
	})
	if err != nil {
		t.Fatal(err)
	}
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestMedia, "image.generate",
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1"},
		target,
		connector.ConnectorRecord{
			ConnectorID: "connector-cloud", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
			OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: job.GetHead().GetSubjectUserId(),
			Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE, HasCredential: true,
		},
		nil, cloudImageRequestForIsolationTest(job),
		job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	return assembly
}

func createCompletedCloudScenarioJobForIsolationTest(t *testing.T, store *scenarioJobStore, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	job := completedScenarioJobForIsolationTest(jobID)
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	assembly := cloudAssemblyForIsolationTest(t, job)
	created, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly)
	if err != nil || created == nil || !published {
		t.Fatalf("healthy Cloud write after isolation = %#v, published=%v err=%v", created, published, err)
	}
	completed, transitioned, err := store.transition(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		nil,
	)
	if err != nil || !transitioned || completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("complete healthy Cloud write after isolation = %#v, transitioned=%v err=%v", completed, transitioned, err)
	}
	return completed
}

func localScenarioJobForPersistenceTest(
	t *testing.T,
	jobID string,
	loadoutID string,
	recipeID string,
	recipeRevision string,
) (*runtimev1.ScenarioJob, *localResolvedAssembly) {
	t.Helper()
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: loadoutID, CapabilityContract: "text.generate", RecipeId: recipeID, RecipeRevision: recipeRevision,
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "local.text.generate.llama-cpp",
			DriverId:         "nimi.runtime.driver.llama-cpp",
			DriverDialect:    "llama.cpp/text-generate/v1",
		},
		ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{{
			SlotId: "main.gguf", ModelAssetId: "model-" + jobID, ContentId: "sha256:" + strings.Repeat("a", 64),
		}},
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ModelResolved: identity.GetModelAxes()[0].GetModelAssetId(),
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-" + jobID,
		EffectiveInputIdentity: identity,
	}
	return job, resolvedAssemblyForPersistenceTest(t, identity)
}

func marshalScenarioJobIsolationRowForTest(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestScenarioJobStoreSynchronouslyPersistsTerminalEffectiveInputIdentity(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	options, err := structpb.NewStruct(map[string]any{
		"temperature": 0.25,
		"sampling":    map[string]any{"top_p": 0.9},
	})
	if err != nil {
		t.Fatal(err)
	}
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId:          "loadout-terminal-proof",
		CapabilityContract: "text.generate",
		RecipeId:           "llama.text-generate.gemma-4-e2b-it.v1",
		RecipeRevision:     "7",
		Implementation: &runtimev1.CapabilityImplementationIdentity{
			ImplementationId: "local.text.generate.llama-cpp",
			DriverId:         "nimi.runtime.driver.llama-cpp",
			DriverDialect:    "llama.cpp/text-generate/v1",
		},
		Options: options,
		ModelAxes: []*runtimev1.LoadoutEffectiveModelAxisIdentity{
			{SlotId: "main.gguf", ModelAssetId: "model-main", ContentId: "sha256:" + strings.Repeat("a", 64)},
			{SlotId: "mmproj", ModelAssetId: "model-mmproj", ContentId: "sha256:" + strings.Repeat("b", 64)},
		},
	}
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-terminal-proof", Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-job-terminal-proof",
		EffectiveInputIdentity: identity,
	}
	assembly := resolvedAssemblyForPersistenceTest(t, identity)
	if created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
		t.Fatalf("submit durable ScenarioJob = %#v, published=%v err=%v", created, published, err)
	}
	terminal, transitioned, err := store.transition(
		job.GetJobId(),
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(candidate *runtimev1.ScenarioJob) { candidate.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED },
	)
	if err != nil || !transitioned || terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("terminal transition = %#v, transitioned=%v err=%v", terminal, transitioned, err)
	}

	raw, err := os.ReadFile(scenarioJobStorePathForLocalStatePath(localStatePath))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"job-terminal-proof", "loadout-terminal-proof", "llama.text-generate.gemma-4-e2b-it.v1", "llama.cpp/text-generate/v1",
		"model-main", "model-mmproj", identity.GetModelAxes()[0].GetContentId(), identity.GetModelAxes()[1].GetContentId(), "temperature", "top_p",
	} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("terminal scenario-jobs.json omitted effective input material %q", expected)
		}
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.get(job.GetJobId())
	if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("reopened terminal ScenarioJob = %#v, visible=%v", persisted, ok)
	}
	if !proto.Equal(persisted.GetEffectiveInputIdentity(), identity) {
		t.Fatalf("reopened effective_input_identity changed:\n got: %v\nwant: %v", persisted.GetEffectiveInputIdentity(), identity)
	}
	privateAssembly, ok := reopened.resolvedAssembly(job.GetJobId())
	if !ok || len(privateAssembly.ModelAxes) != len(identity.GetModelAxes()) || privateAssembly.ModelAxes[0].AbsolutePath != assembly.ModelAxes[0].AbsolutePath {
		t.Fatalf("reopened private ResolvedAssembly = %+v, visible=%v", privateAssembly, ok)
	}
}

func TestScenarioJobStorePersistsEveryTerminalTransition(t *testing.T) {
	for _, terminalStatus := range []runtimev1.ScenarioJobStatus{
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT,
	} {
		t.Run(terminalStatus.String(), func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			job, assembly := localScenarioJobForPersistenceTest(t, "job-"+terminalStatus.String(), "loadout-terminal", "recipe-terminal", "1")
			if created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
				t.Fatalf("create durable ScenarioJob = %#v, published=%v err=%v", created, published, err)
			}
			if _, transitioned, err := store.transition(job.GetJobId(), terminalStatus, scenarioJobEventForStatus(terminalStatus), nil); err != nil || !transitioned {
				t.Fatalf("transition to %s: transitioned=%v err=%v", terminalStatus, transitioned, err)
			}
			reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			persisted, ok := reopened.get(job.GetJobId())
			if !ok || persisted.GetStatus() != terminalStatus || persisted.GetEffectiveInputIdentity().GetLoadoutId() != "loadout-terminal" {
				t.Fatalf("reopened %s ScenarioJob = %#v, visible=%v", terminalStatus, persisted, ok)
			}
		})
	}
}

func TestScenarioJobStorePersistsCancellationCompletedByFinishExecution(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	job, assembly := localScenarioJobForPersistenceTest(t, "job-canceled-proof", "loadout-canceled", "recipe-canceled", "3")
	if created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
		t.Fatalf("create durable ScenarioJob = %#v, published=%v err=%v", created, published, err)
	}
	canceled, accepted, err := store.requestCancel(job.GetJobId(), "owner canceled")
	if err != nil || !accepted || canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cancel durable ScenarioJob = %#v, accepted=%v err=%v", canceled, accepted, err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	persisted, ok := reopened.get(job.GetJobId())
	if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED || persisted.GetEffectiveInputIdentity().GetLoadoutId() != "loadout-canceled" {
		t.Fatalf("reopened canceled ScenarioJob = %#v, visible=%v", persisted, ok)
	}
}

func TestScenarioJobStoreTerminalPersistenceFailureIsReturned(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	job, assembly := localScenarioJobForPersistenceTest(t, "job-terminal-persist-failure", "loadout-failure", "recipe-failure", "1")
	if created, published, err := store.createOwnedAndBindAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
		t.Fatalf("create durable ScenarioJob = %#v, published=%v err=%v", created, published, err)
	}
	store.durablePath = t.TempDir()
	current, transitioned, err := store.transition(
		job.GetJobId(),
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED,
		nil,
	)
	if err == nil || transitioned {
		t.Fatalf("failed terminal persistence = job %#v, transitioned=%v, err=%v", current, transitioned, err)
	}
	if current.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED {
		t.Fatalf("unpersisted terminal state became visible: %v", current.GetStatus())
	}
}

func TestScenarioJobStoreFailsClosedWhenAtomicJobAssemblyCommitCannotPersist(t *testing.T) {
	store := newScenarioJobStore()
	store.durablePath = t.TempDir()
	now := timestamppb.New(time.Now().UTC())
	identity := &runtimev1.LoadoutEffectiveInputIdentity{
		LoadoutId: "loadout-1", CapabilityContract: "text.generate", RecipeId: "recipe-1", RecipeRevision: "1",
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "local.text.generate.llama-cpp", DriverId: "nimi.runtime.driver.llama-cpp", DriverDialect: "llama.cpp/text-generate/v1"},
		ModelAxes:      []*runtimev1.LoadoutEffectiveModelAxisIdentity{{SlotId: "main.gguf", ModelAssetId: "model-1", ContentId: "sha256:" + strings.Repeat("a", 64)}},
	}
	job := &runtimev1.ScenarioJob{
		JobId: "job-must-not-publish", Head: &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "user-local"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		CreatedAt: now, UpdatedAt: now, TraceId: "trace-job-must-not-publish",
		EffectiveInputIdentity: identity,
	}
	assembly := resolvedAssemblyForPersistenceTest(t, identity)
	created, published, err := store.createOwnedAndBindAssemblyChecked(job, context.CancelFunc(func() {}), nil, "", assembly)
	if err == nil || created != nil || published {
		t.Fatalf("failed durable create = %#v, published=%v err=%v", created, published, err)
	}
	if _, ok := store.get(job.GetJobId()); ok {
		t.Fatal("ScenarioJob became visible without its durable captured ResolvedAssembly")
	}
	if _, ok := store.resolvedAssembly(job.GetJobId()); ok {
		t.Fatal("ResolvedAssembly became visible without its durable ScenarioJob")
	}
}
