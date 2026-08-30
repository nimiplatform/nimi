package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

type committedCredentialWriteErrorStore struct {
	mu                    sync.Mutex
	secrets               map[string]string
	failWritesAfterCommit bool
	failDeletes           bool
}

func newCommittedCredentialWriteErrorStore(failDeletes bool) *committedCredentialWriteErrorStore {
	return &committedCredentialWriteErrorStore{
		secrets:               make(map[string]string),
		failWritesAfterCommit: true,
		failDeletes:           failDeletes,
	}
}

func (s *committedCredentialWriteErrorStore) WriteSecret(name string, payload string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.secrets[name] = payload
	if s.failWritesAfterCommit && strings.HasPrefix(name, "scenario-job-credential-") {
		return fmt.Errorf("secret committed before store acknowledgement")
	}
	return nil
}

func (s *committedCredentialWriteErrorStore) ReadSecret(name string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, ok := s.secrets[name]
	return value, ok, nil
}

func (s *committedCredentialWriteErrorStore) DeleteSecret(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failDeletes && strings.HasPrefix(name, "scenario-job-credential-") {
		return fmt.Errorf("secret delete unavailable")
	}
	delete(s.secrets, name)
	return nil
}

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
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
			name: "Cloud credential custody ref belongs to another Job",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-wrong-credential-custody")
				assembly := cloudAssemblyForIsolationTest(t, job)
				assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest("different-job")
				appendCloudIsolationRowForTest(t, snapshot, job, assembly, true)
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
			name: "completed Job with stale reason metadata",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-completed-stale-metadata")
				metadataValue, err := structpb.NewStruct(map[string]any{"action_hint": "must-not-survive"})
				if err != nil {
					t.Fatal(err)
				}
				job.ReasonMetadata = metadataValue
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
			},
		},
		{
			name: "canceled Job with stale reason metadata",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-canceled-stale-metadata")
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
				metadataValue, err := structpb.NewStruct(map[string]any{"action_hint": "must-not-survive"})
				if err != nil {
					t.Fatal(err)
				}
				job.ReasonMetadata = metadataValue
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
			},
		},
		{
			name: "failed Job missing reason detail",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-failed-missing-detail")
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
				job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
				job.ReasonDetail = ""
				job.ReasonMetadata, _ = structpb.NewStruct(map[string]any{"action_hint": "retry_request"})
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
			},
		},
		{
			name: "failed Job missing reason metadata",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-failed-missing-metadata")
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
				job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
				job.ReasonDetail = "provider request failed"
				job.ReasonMetadata = nil
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
			},
		},
		{
			name: "failed Job with unknown reason metadata field",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-failed-unknown-metadata")
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
				job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
				job.ReasonDetail = "provider request failed"
				job.ReasonMetadata, _ = structpb.NewStruct(map[string]any{"diagnostic": "provider-secret"})
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
			},
		},
		{
			name: "failed Job with invalid reason metadata type",
			poison: func(snapshot *scenarioJobDiskRawSnapshot) {
				job := completedScenarioJobForIsolationTest("job-failed-invalid-metadata-type")
				job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
				job.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
				job.ReasonDetail = "provider request failed"
				job.ReasonMetadata, _ = structpb.NewStruct(map[string]any{"action_hint": true})
				appendCloudIsolationRowForTest(t, snapshot, job, cloudAssemblyForIsolationTest(t, job), true)
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
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorRecord, err := connectorStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-cloud", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
		Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, "credential-secret")
	if err != nil {
		t.Fatalf("create Connector: %v", err)
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
		connectorRecord,
		nil, cloudImageRequestForIsolationTest(job),
		job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{scenarioJobs: store, connStore: connectorStore}
	if err := svc.bindCloudCredentialCustody(job.GetJobId(), assembly); err != nil {
		t.Fatalf("bind credential custody: %v", err)
	}
	custodyRef := assembly.CredentialCustodyRef
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
	if persisted.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
		t.Fatalf("restarted Cloud reason = %v, want AI_EXECUTION_INTERRUPTED", persisted.GetReasonCode())
	}
	if interruption := persisted.GetInterruption(); interruption == nil ||
		interruption.GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART ||
		interruption.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT {
		t.Fatalf("restarted Cloud interruption = %#v", interruption)
	}
	if persisted.GetReasonDetail() == "" {
		t.Fatal("restarted Cloud Job has no stable reason detail")
	}
	metadata := persisted.GetReasonMetadata().AsMap()
	if metadata["action_hint"] != "inspect_reason_code_and_retry_with_corrected_request" {
		t.Fatalf("restarted Cloud reason metadata = %v", metadata)
	}
	if _, ok := reopened.cloudResolvedAssembly(job.GetJobId()); !ok {
		t.Fatal("restarted Cloud Job lost captured ResolvedAssembly")
	}
	restarted := &Service{scenarioJobs: reopened, connStore: connectorStore}
	if err := restarted.releaseRecoveredTerminalCloudCredentialCustody(); err != nil {
		t.Fatalf("release recovered terminal credential custody: %v", err)
	}
	if captured, err := connectorStore.LoadCredentialCustody(custodyRef); err != nil || captured != "" {
		t.Fatalf("recovered terminal credential custody = %q, err=%v; want released", captured, err)
	}
}

func TestScenarioJobStoreRestartTerminalizesEveryPersistedInFlightState(t *testing.T) {
	for _, recoveredStatus := range []runtimev1.ScenarioJobStatus{
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	} {
		t.Run(recoveredStatus.String(), func(t *testing.T) {
			localStatePath := filepath.Join(t.TempDir(), "local-state.json")
			store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			jobID := "job-restart-" + strings.ToLower(recoveredStatus.String())
			job := completedScenarioJobForIsolationTest(jobID)
			job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
			assembly := cloudAssemblyForIsolationTest(t, job)
			beginCloudCredentialCustodyForTest(t, store, jobID)
			if created, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
				t.Fatalf("create durable ScenarioJob = %#v, published=%v err=%v", created, published, err)
			}
			if recoveredStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED || recoveredStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
				if _, transitioned, err := store.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); err != nil || !transitioned {
					t.Fatalf("queue durable ScenarioJob: transitioned=%v err=%v", transitioned, err)
				}
			}
			if recoveredStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING {
				if _, transitioned, err := store.transition(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !transitioned {
					t.Fatalf("start durable ScenarioJob: transitioned=%v err=%v", transitioned, err)
				}
			}

			reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			persisted, ok := reopened.get(jobID)
			if !ok || persisted.GetJobId() != jobID || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
				persisted.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
				t.Fatalf("restart-recovered ScenarioJob = %#v, visible=%v", persisted, ok)
			}
			if interruption := persisted.GetInterruption(); interruption == nil ||
				interruption.GetCause() != runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART ||
				interruption.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT {
				t.Fatalf("restart-recovered interruption = %#v", interruption)
			}
			projected, err := projectLocalAppScenarioJob(persisted)
			if err != nil {
				t.Fatalf("project restart-recovered Local App Job: %v", err)
			}
			if projected.GetReasonCode() != runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED {
				t.Fatalf("Local App restart reason = %v", projected.GetReasonCode())
			}
			assertRuntimeRestartInterruption(t, projected.GetInterruption())
			captured, ok := reopened.cloudResolvedAssembly(jobID)
			if !ok || !bytes.Contains(captured.Request, []byte("captured prompt")) {
				t.Fatalf("restart recovery lost captured Cloud ResolvedAssembly: %+v, visible=%v", captured, ok)
			}

			secondReopen, err := newScenarioJobStoreForLocalStatePath(localStatePath)
			if err != nil {
				t.Fatal(err)
			}
			second, ok := secondReopen.get(jobID)
			if !ok || !proto.Equal(second, persisted) {
				t.Fatalf("restart terminal was not durable:\n first: %v\nsecond: %v", persisted, second)
			}
		})
	}
}

func TestScenarioJobStoreRestartPreservesCompletedArtifactAndExplicitCancellation(t *testing.T) {
	t.Run("completed artifact", func(t *testing.T) {
		localStatePath := filepath.Join(t.TempDir(), "local-state.json")
		store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
		if err != nil {
			t.Fatal(err)
		}
		job := completedScenarioJobForIsolationTest("job-completed-restart")
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
		assembly := cloudAssemblyForIsolationTest(t, job)
		assembly.Defaults = json.RawMessage(`{"quality":"hd"}`)
		beginCloudCredentialCustodyForTest(t, store, job.GetJobId())
		if _, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || !published {
			t.Fatalf("create completed-artifact Job: published=%v err=%v", published, err)
		}
		if _, transitioned, err := store.transition(job.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); err != nil || !transitioned {
			t.Fatalf("queue completed-artifact Job: transitioned=%v err=%v", transitioned, err)
		}
		if _, transitioned, err := store.transition(job.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); err != nil || !transitioned {
			t.Fatalf("start completed-artifact Job: transitioned=%v err=%v", transitioned, err)
		}
		artifact := &runtimev1.ScenarioArtifact{ArtifactId: "artifact-completed-restart", MimeType: "image/png", Uri: "nimi-artifact://artifact-completed-restart", SizeBytes: 42}
		if _, committed, err := store.commitArtifact(job.GetJobId(), artifact, 1, 1, 100); err != nil || !committed {
			t.Fatalf("commit completed artifact: committed=%v err=%v", committed, err)
		}
		if _, transitioned, err := store.transition(job.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED, nil); err != nil || !transitioned {
			t.Fatalf("complete artifact Job: transitioned=%v err=%v", transitioned, err)
		}
		reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
		if err != nil {
			t.Fatal(err)
		}
		persisted, ok := reopened.get(job.GetJobId())
		if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED ||
			persisted.GetInterruption() != nil || len(persisted.GetArtifacts()) != 1 ||
			persisted.GetArtifacts()[0].GetArtifactId() != artifact.GetArtifactId() {
			t.Fatalf("restart changed completed artifact Job: %#v, visible=%v", persisted, ok)
		}
		captured, ok := reopened.cloudResolvedAssembly(job.GetJobId())
		if !ok || !bytes.Contains(captured.Request, []byte("captured prompt")) || !bytes.Contains(captured.Defaults, []byte("quality")) {
			t.Fatalf("restart changed completed captured configuration: %+v, visible=%v", captured, ok)
		}
	})

	t.Run("explicit cancellation", func(t *testing.T) {
		localStatePath := filepath.Join(t.TempDir(), "local-state.json")
		store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
		if err != nil {
			t.Fatal(err)
		}
		job := completedScenarioJobForIsolationTest("job-canceled-restart")
		job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
		assembly := cloudAssemblyForIsolationTest(t, job)
		beginCloudCredentialCustodyForTest(t, store, job.GetJobId())
		if _, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || !published {
			t.Fatalf("create cancel Job: published=%v err=%v", published, err)
		}
		if canceled, accepted, err := store.requestCancel(job.GetJobId(), "explicit user cancel"); err != nil || !accepted ||
			canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			t.Fatalf("explicit cancel = %#v accepted=%v err=%v", canceled, accepted, err)
		}
		reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
		if err != nil {
			t.Fatal(err)
		}
		persisted, ok := reopened.get(job.GetJobId())
		if !ok || persisted.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED ||
			persisted.GetInterruption() != nil || persisted.GetReasonMetadata() != nil {
			t.Fatalf("restart changed explicit cancellation: %#v, visible=%v", persisted, ok)
		}
	})
}

func TestBindCloudCredentialCustodyCapturesConnectorRecordAndSecretFromOneGeneration(t *testing.T) {
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := connectorStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-generation", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
		Provider: "openai", Endpoint: "https://old.example/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
		ProviderAuthProfile: "bearer-old",
	}, `{"apiKey":"old-secret"}`)
	if err != nil {
		t.Fatalf("create Connector: %v", err)
	}
	target, err := structpb.NewStruct(map[string]any{
		"provider": "openai", "providerModelId": "gpt-image-1", "remoteModelCatalogId": "catalog-image",
	})
	if err != nil {
		t.Fatal(err)
	}
	job := &runtimev1.ScenarioJob{
		JobId: "job-cloud-generation", Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, TraceId: "trace-cloud-generation",
	}
	assembly, err := newCloudResolvedAssembly(
		cloudResolvedRequestMedia, "image.generate",
		&runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.image.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "provider/media-v1"},
		target, record, nil, cloudImageRequestForIsolationTest(job), job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	newEndpoint := "https://new.example/v1"
	newProfile := "bearer-new"
	newSecret := `{"apiKey":"new-secret"}`
	if _, err := connectorStore.Update(record.ConnectorID, connector.ConnectorMutations{
		Endpoint: &newEndpoint, ProviderAuthProfile: &newProfile, SecretPayload: &newSecret,
	}); err != nil {
		t.Fatalf("update Connector: %v", err)
	}
	svc := &Service{scenarioJobs: newScenarioJobStore(), connStore: connectorStore}
	if err := svc.bindCloudCredentialCustody(job.GetJobId(), assembly); err != nil {
		t.Fatalf("bind credential custody: %v", err)
	}
	if assembly.Connector.Endpoint != newEndpoint || assembly.Connector.ProviderAuthProfile != newProfile {
		t.Fatalf("captured Connector record=%+v, want current generation", assembly.Connector)
	}
	capturedSecret, err := connectorStore.LoadCredentialCustody(assembly.CredentialCustodyRef)
	if err != nil || capturedSecret != newSecret {
		t.Fatalf("captured secret=%q err=%v", capturedSecret, err)
	}
}

func TestBindCloudCredentialCustodyRetainsCleanupObligationAfterAmbiguousStoreFailure(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		failDeletes bool
	}{
		{name: "cleanup succeeds"},
		{name: "cleanup remains pending", failDeletes: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			secretStore := newCommittedCredentialWriteErrorStore(testCase.failDeletes)
			connectorStore := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secretStore)
			record, err := connectorStore.Create(connector.ConnectorRecord{
				ConnectorID: "connector-ambiguous-write", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
				OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
				Provider: "openai", Endpoint: "https://example.test/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
			}, `{"apiKey":"ambiguous-secret"}`)
			if err != nil {
				t.Fatalf("create Connector: %v", err)
			}
			jobID := "job-ambiguous-custody-" + strings.ReplaceAll(testCase.name, " ", "-")
			job := &runtimev1.ScenarioJob{
				JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
				ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, TraceId: "trace-ambiguous-custody",
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
				target, record, nil, cloudImageRequestForIsolationTest(job), job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
				job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
			)
			if err != nil {
				t.Fatal(err)
			}
			store := newScenarioJobStore()
			svc := &Service{scenarioJobs: store, connStore: connectorStore}
			if err := svc.bindCloudCredentialCustody(jobID, assembly); err == nil {
				t.Fatal("ambiguous custody write unexpectedly succeeded")
			}
			ref, err := connector.CredentialCustodyRefForJob(jobID)
			if err != nil {
				t.Fatal(err)
			}
			captured, err := connectorStore.LoadCredentialCustody(ref)
			if err != nil {
				t.Fatalf("load captured custody: %v", err)
			}
			pending := store.pendingCloudCredentialCustody()
			if testCase.failDeletes {
				if captured == "" || len(pending) != 1 || pending[0].jobID != jobID || pending[0].ref != ref {
					t.Fatalf("failed cleanup lost durable obligation: captured=%q pending=%+v", captured, pending)
				}
				return
			}
			if captured != "" || len(pending) != 0 {
				t.Fatalf("successful cleanup left custody residue: captured=%q pending=%+v", captured, pending)
			}
		})
	}
}

func TestTerminalCloudCredentialCleanupFailurePreventsJobPrune(t *testing.T) {
	svc, store, connectorStore, _, jobID := newCloudCustodyTerminalTestService(t, true)
	if _, transitioned, err := svc.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) { job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED },
	); err != nil || !transitioned {
		t.Fatalf("terminal transition: transitioned=%v err=%v", transitioned, err)
	}
	assembly, ok := store.cloudResolvedAssembly(jobID)
	if !ok || assembly == nil || assembly.CredentialCustodyRef == "" {
		t.Fatalf("failed cleanup lost custody obligation: %+v visible=%v", assembly, ok)
	}
	if captured, err := connectorStore.LoadCredentialCustody(assembly.CredentialCustodyRef); err != nil || captured == "" {
		t.Fatalf("failed cleanup custody=%q err=%v", captured, err)
	}

	now := time.Now().UTC()
	store.mu.Lock()
	record := store.jobs[jobID]
	record.terminalAt = now.Add(-scenarioJobRetention - time.Minute)
	record.updatedAt = record.terminalAt
	record.job.UpdatedAt = timestamppb.New(record.terminalAt)
	store.pruneJobsLocked(now)
	_, retained := store.jobs[jobID]
	store.mu.Unlock()
	if !retained {
		t.Fatal("terminal Job with unresolved credential cleanup was pruned")
	}
}

func TestSuccessfulTerminalCloudCredentialCleanupClearsDurableRefBeforePrune(t *testing.T) {
	svc, store, connectorStore, _, jobID := newCloudCustodyTerminalTestService(t, false)
	if _, transitioned, err := svc.transitionScenarioJob(
		jobID,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_COMPLETED,
		func(job *runtimev1.ScenarioJob) { job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED },
	); err != nil || !transitioned {
		t.Fatalf("terminal transition: transitioned=%v err=%v", transitioned, err)
	}
	assembly, ok := store.cloudResolvedAssembly(jobID)
	if !ok || assembly == nil {
		t.Fatalf("terminal Cloud assembly missing: %+v visible=%v", assembly, ok)
	}
	if assembly.CredentialCustodyRef != "" {
		t.Fatalf("successful cleanup retained durable custody ref %q", assembly.CredentialCustodyRef)
	}
	ref, err := connector.CredentialCustodyRefForJob(jobID)
	if err != nil {
		t.Fatal(err)
	}
	if captured, err := connectorStore.LoadCredentialCustody(ref); err != nil || captured != "" {
		t.Fatalf("successful cleanup custody=%q err=%v", captured, err)
	}

	now := time.Now().UTC()
	store.mu.Lock()
	record := store.jobs[jobID]
	record.terminalAt = now.Add(-scenarioJobRetention - time.Minute)
	record.updatedAt = record.terminalAt
	record.job.UpdatedAt = timestamppb.New(record.terminalAt)
	store.pruneJobsLocked(now)
	_, retained := store.jobs[jobID]
	store.mu.Unlock()
	if retained {
		t.Fatal("fully cleaned terminal Job was not pruned")
	}
}

func newCloudCustodyTerminalTestService(
	t *testing.T,
	failDeletes bool,
) (*Service, *scenarioJobStore, *connector.ConnectorStore, *committedCredentialWriteErrorStore, string) {
	t.Helper()
	secretStore := newCommittedCredentialWriteErrorStore(failDeletes)
	secretStore.failWritesAfterCommit = false
	connectorStore := connector.NewConnectorStoreWithSecretStore(t.TempDir(), secretStore)
	record, err := connectorStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-terminal-cleanup", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
		Provider: "openai", Endpoint: "https://example.test/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"terminal-secret"}`)
	if err != nil {
		t.Fatalf("create Connector: %v", err)
	}
	jobID := "job-terminal-custody"
	job := &runtimev1.ScenarioJob{
		JobId: jobID, Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ModelResolved: "gpt-image-1",
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId: "trace-terminal-custody",
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
		target, record, nil, cloudImageRequestForIsolationTest(job), job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	store := newScenarioJobStore()
	svc := &Service{scenarioJobs: store, connStore: connectorStore}
	if err := svc.bindCloudCredentialCustody(jobID, assembly); err != nil {
		t.Fatalf("bind credential custody: %v", err)
	}
	if created, published, err := store.createOwnedAndBindCloudAssemblyChecked(job, func() {}, nil, "", assembly); err != nil || created == nil || !published {
		t.Fatalf("create terminal cleanup Job: created=%+v published=%v err=%v", created, published, err)
	}
	return svc, store, connectorStore, secretStore, jobID
}

func TestStartupReleasesCredentialCapturedBeforeJobPublication(t *testing.T) {
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")
	store, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	connectorStore := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	record, err := connectorStore.Create(connector.ConnectorRecord{
		ConnectorID: "connector-pending-custody", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED,
		OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "user-cloud",
		Provider: "openai", Endpoint: "https://example.test/v1", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE,
	}, `{"apiKey":"pending-secret"}`)
	if err != nil {
		t.Fatalf("create Connector: %v", err)
	}
	job := &runtimev1.ScenarioJob{
		JobId: "job-pending-custody", Head: &runtimev1.ScenarioRequestHead{AppId: "app.cloud", SubjectUserId: "user-cloud"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, TraceId: "trace-pending-custody",
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
		target, record, nil, cloudImageRequestForIsolationTest(job), job.GetExecutionMode(), capabilitydriver.CloudMediaStreamNone,
		job.GetTraceId(), job.GetHead().GetAppId(), job.GetHead().GetSubjectUserId(), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{scenarioJobs: store, connStore: connectorStore}
	if err := svc.bindCloudCredentialCustody(job.GetJobId(), assembly); err != nil {
		t.Fatalf("bind credential custody: %v", err)
	}
	custodyRef := assembly.CredentialCustodyRef
	if captured, err := connectorStore.LoadCredentialCustody(custodyRef); err != nil || captured == "" {
		t.Fatalf("captured pending credential custody = %q, err=%v", captured, err)
	}

	reopened, err := newScenarioJobStoreForLocalStatePath(localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	restarted := &Service{scenarioJobs: reopened, connStore: connectorStore}
	if err := restarted.releaseRecoveredTerminalCloudCredentialCustody(); err != nil {
		t.Fatalf("reconcile pending credential custody: %v", err)
	}
	if captured, err := connectorStore.LoadCredentialCustody(custodyRef); err != nil || captured != "" {
		t.Fatalf("orphaned pending credential custody = %q, err=%v; want released", captured, err)
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
	assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest(job.GetJobId())
	beginCloudCredentialCustodyForTest(t, store, job.GetJobId())
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
	var mainModelAssetID, mainVerifiedContentID, mainEntrySHA256 string
	for index, axis := range identity.GetModelAxes() {
		absolutePath := filepath.Join(t.TempDir(), axis.GetSlotId()+".bin")
		modelAssetID := axis.GetModelAssetId()
		entrySHA := strings.Repeat(string(rune('a'+index)), 64)
		presence := axis.GetPresence()
		if presence == runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_UNSPECIFIED {
			presence = runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_REQUIRED
			axis.Presence = presence
		}
		axes = append(axes, localResolvedAssemblyModelAxis{
			RequirementID: axis.GetSlotId(), ModelAssetID: modelAssetID,
			AbsolutePath: absolutePath, VerifiedContentID: axis.GetContentId(), EntrySHA256: entrySHA, Presence: presence,
		})
		modelFiles = append(modelFiles, localResolvedAssemblyInvocationBinding{
			RequirementID: axis.GetSlotId(), ModelAssetID: modelAssetID, AbsolutePath: absolutePath,
			VerifiedContentID: axis.GetContentId(), EntrySHA256: entrySHA,
		})
		if axis.GetSlotId() == capabilitydriver.MainGGUFRequirementID {
			mainModelAssetID, mainVerifiedContentID, mainEntrySHA256 = modelAssetID, axis.GetContentId(), entrySHA
		}
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
	behaviorMatch := localResolvedAssemblyTextBehaviorMatch{
		RecipeID: identity.GetRecipeId(), RecipeRevision: identity.GetRecipeRevision(), DriverDialect: implementation.GetDriverDialect(),
		ModelAssetID: mainModelAssetID, VerifiedContentID: mainVerifiedContentID, EntrySHA256: mainEntrySHA256,
	}
	return &localResolvedAssembly{
		Version: localResolvedAssemblyVersion, LoadoutID: identity.GetLoadoutId(),
		CapabilityContract: identity.GetCapabilityContract(), RecipeID: identity.GetRecipeId(), RecipeRevision: identity.GetRecipeRevision(),
		DriverIdentity: localResolvedAssemblyDriverIdentity{
			ImplementationID: implementation.GetImplementationId(), DriverID: implementation.GetDriverId(), DriverDialect: implementation.GetDriverDialect(),
		},
		PortableConfig: portableConfig, ModelAxes: axes, RecipeCustody: recipeCustody,
		Request: localResolvedAssemblyRequest{Kind: "text.generate", Payload: json.RawMessage(`{"input":[]}`)},
		LoadPlan: localResolvedAssemblyLoadPlan{Kind: "text", Text: &localResolvedAssemblyTextPlan{
			ProcessKey: "process-persistence-test", ModelFiles: modelFiles, RequestPath: "/v1/chat/completions", RequestContentType: "application/json", RequestBody: []byte(`{"messages":[]}`),
			BehaviorMatch: behaviorMatch,
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
	assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest(job.GetJobId())
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
	assembly.CredentialCustodyRef = cloudCredentialCustodyRefForTest(job.GetJobId())
	return assembly
}

func cloudCredentialCustodyRefForTest(jobID string) string {
	return "scenario-job-credential-" + strings.TrimSpace(jobID)
}

func beginCloudCredentialCustodyForTest(t *testing.T, store *scenarioJobStore, jobID string) string {
	t.Helper()
	ref := cloudCredentialCustodyRefForTest(jobID)
	if err := store.beginCloudCredentialCustody(jobID, ref); err != nil {
		t.Fatalf("begin Cloud credential custody for %q: %v", jobID, err)
	}
	return ref
}

func createCompletedCloudScenarioJobForIsolationTest(t *testing.T, store *scenarioJobStore, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	job := completedScenarioJobForIsolationTest(jobID)
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	assembly := cloudAssemblyForIsolationTest(t, job)
	beginCloudCredentialCustodyForTest(t, store, jobID)
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
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
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
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
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
