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
		JobId: "job-original", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
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
				now := time.Now().UTC()
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, ResolvedAssembly: json.RawMessage(`{"version":999}`), CreatedAt: now, UpdatedAt: now, TerminalAt: now,
				}))
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
				now := time.Now().UTC()
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, CreatedAt: now, UpdatedAt: now, TerminalAt: now,
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
				now := time.Now().UTC()
				snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
					Job: jobRaw, ResolvedAssembly: assemblyRaw, CreatedAt: now, UpdatedAt: now, TerminalAt: now,
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
			svc, err := NewProtected(logger, nil, nil, connectorStore, runtimecfg.Config{LocalStatePath: localStatePath})
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
			if created, err := svc.scenarioJobs.createOwnedChecked(completedScenarioJobForIsolationTest("job-after-isolation"), func() {}, nil); err != nil || created == nil {
				t.Fatalf("healthy write after isolation = %#v, %v", created, err)
			}
			preserved, err := os.ReadFile(diagnostics[0].QuarantinePath)
			if err != nil || !bytes.Equal(preserved, poisoned) {
				t.Fatalf("healthy write overwrote quarantined bytes: err=%v", err)
			}
		})
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
	svc, err := NewProtected(logger, nil, nil, connectorStore, runtimecfg.Config{LocalStatePath: localStatePath})
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
	if created, err := svc.scenarioJobs.createOwnedChecked(completedScenarioJobForIsolationTest("job-after-document-isolation"), func() {}, nil); err != nil || created == nil {
		t.Fatalf("healthy write after document isolation = %#v, %v", created, err)
	}
	preserved, err := os.ReadFile(diagnostics[0].QuarantinePath)
	if err != nil || !bytes.Equal(preserved, poisoned) {
		t.Fatalf("healthy write overwrote isolated document: err=%v", err)
	}
}

func healthyScenarioJobRawSnapshotForIsolationTest(t *testing.T) scenarioJobDiskRawSnapshot {
	t.Helper()
	now := time.Now().UTC()
	snapshot := scenarioJobDiskRawSnapshot{Version: scenarioJobDiskStoreVersion}
	for _, jobID := range []string{"job-healthy-a", "job-healthy-b"} {
		job := completedScenarioJobForIsolationTest(jobID)
		jobRaw, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(job)
		if err != nil {
			t.Fatal(err)
		}
		snapshot.Records = append(snapshot.Records, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskRecord{
			Job: jobRaw, CreatedAt: now, UpdatedAt: now, TerminalAt: now,
		}))
		snapshot.Idempotency = append(snapshot.Idempotency, marshalScenarioJobIsolationRowForTest(t, scenarioJobDiskIdempotencyEntry{
			ScopeKey: "scope-" + jobID, JobID: jobID, BoundAt: now,
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
		JobId: jobID, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, CreatedAt: now, UpdatedAt: now,
	}
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
		JobId: "job-terminal-proof", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
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
			now := timestamppb.New(time.Now().UTC())
			job := &runtimev1.ScenarioJob{
				JobId: "job-" + terminalStatus.String(), ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
				Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
				EffectiveInputIdentity: &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-terminal", RecipeId: "recipe-terminal", RecipeRevision: "1"},
			}
			if created, err := store.createOwnedChecked(job, func() {}, nil); err != nil || created == nil {
				t.Fatalf("create durable ScenarioJob = %#v, %v", created, err)
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
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-canceled-proof", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
		EffectiveInputIdentity: &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-canceled", RecipeId: "recipe-canceled", RecipeRevision: "3"},
	}
	if created, err := store.createOwnedChecked(job, func() {}, nil); err != nil || created == nil {
		t.Fatalf("create durable ScenarioJob = %#v, %v", created, err)
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
	now := timestamppb.New(time.Now().UTC())
	job := &runtimev1.ScenarioJob{
		JobId: "job-terminal-persist-failure", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
		EffectiveInputIdentity: &runtimev1.LoadoutEffectiveInputIdentity{LoadoutId: "loadout-failure", RecipeId: "recipe-failure", RecipeRevision: "1"},
	}
	if created, err := store.createOwnedChecked(job, func() {}, nil); err != nil || created == nil {
		t.Fatalf("create durable ScenarioJob = %#v, %v", created, err)
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
		JobId: "job-must-not-publish", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, CreatedAt: now, UpdatedAt: now,
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
