package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestSpeakerEmbeddingRejectsJobTimeoutBeforeResolvingConfiguration(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, timeout := range []int32{-1, 1, 120000, 1200000} {
		_, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
			Head:         &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user", TimeoutMs: timeout},
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SPEAKER_EMBED,
			Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioSpeakerEmbed{AudioSpeakerEmbed: &runtimev1.AudioSpeakerEmbedScenarioSpec{}}},
		})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("timeout %d was not rejected before resource resolution: %v", timeout, err)
		}
	}
}

func TestSpeakerEmbeddingUsesCommonActionIdentityAndOutcomePersistence(t *testing.T) {
	store, original, state := speakerEmbeddingJobFixture(t)
	assembly, _ := store.resolvedAssembly(original.JobId)
	owner := &localAppJobOwner{AccountID: "account", RegisteredAppSubject: "registered-app", ProducerAppID: "app"}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "speaker-action-01", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_AudioSpeakerEmbed{AudioSpeakerEmbed: &runtimev1.AudioSpeakerEmbedScenarioSpec{
		MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: assembly.Request.BinaryInput}},
	}}}
	submission, err := captureLocalAppMusicSubmission(request)
	if err != nil {
		t.Fatal(err)
	}
	job := cloneScenarioJob(original)
	job.JobId = "speaker-owned-action"
	stored, created, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", assembly, nil, false, submission)
	if err != nil || !created || stored.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_NOT_DISPATCHED {
		t.Fatalf("speaker action admission: %v", err)
	}
	found, err := store.getMusicSubmission(owner, submission.ID, submission.RequestSHA256)
	if err != nil || found.GetJobId() != job.JobId {
		t.Fatalf("original action lookup: %v", err)
	}
	if _, err := store.getMusicSubmission(owner, submission.ID, strings.Repeat("f", 64)); !errors.Is(err, errLocalAppSubmissionConflict) {
		t.Fatalf("changed input accepted: %v", err)
	}
	space, err := speakerEmbeddingSpaceID(assembly)
	if err != nil {
		t.Fatal(err)
	}
	values := make([]float64, 512)
	values[0] = .75
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.scenarioJobs = store
	store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil)
	if err := svc.completeSpeakerEmbeddingScenarioJob(job.JobId, &runtimev1.AudioSpeakerEmbedResult{Vector: &runtimev1.EmbeddingVector{Values: values}, SpaceId: space}); err != nil {
		t.Fatal(err)
	}
	restored, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	found, err = restored.getMusicSubmission(owner, submission.ID, "")
	if err != nil || found.GetJobId() != job.JobId || found.GetSpeakerEmbedding().GetSpaceId() != space || found.GetSubmissionOutcome() != runtimev1.ScenarioJobSubmissionOutcome_SCENARIO_JOB_SUBMISSION_OUTCOME_ACCEPTED {
		t.Fatalf("speaker action/result/outcome not restored: %v", err)
	}
	if found.GetStopOutcome() != runtimev1.ScenarioJobStopOutcome_SCENARIO_JOB_STOP_OUTCOME_UNSPECIFIED {
		t.Fatal("uncanceled speaker Job claimed a stop")
	}
}

func speakerEmbeddingJobFixture(t *testing.T) (*scenarioJobStore, *runtimev1.ScenarioJob, string) {
	t.Helper()
	root := t.TempDir()
	state := filepath.Join(root, "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	requirements, _ := (capabilitydriver.SherpaSpeakerEmbedDriver{}).ProjectRecipe(capabilitydriver.SherpaSpeakerEmbedRecipeID, nil, nil)
	profile := strings.Repeat("a", 64)
	selected := &localexecution.SelectedLocalExecution{
		LoadoutID: "speakerEmbedding-loadout", CapabilityContract: capabilitydriver.SpeakerEmbedContract, RecipeID: capabilitydriver.SherpaSpeakerEmbedRecipeID, RecipeRevision: "1",
		DriverIdentity:         &runtimev1.CapabilityImplementationIdentity{ImplementationId: capabilitydriver.SherpaSpeakerEmbedImplementationID, DriverId: capabilitydriver.SherpaSpeakerEmbedDriverID, DriverDialect: capabilitydriver.SherpaSpeakerEmbedDriverDialect},
		EmbeddingDimension:     512,
		Requirements:           requirements,
		ExactBindings:          []localexecution.ExactBinding{{RequirementID: capabilitydriver.SpeakerEncoderSlot, RequirementRole: runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN, ModelAssetID: "speakerEmbedding-model", AbsolutePath: filepath.Join(root, "config.cfg"), BundleDir: root, DeclaredFiles: []string{"config.cfg"}, VerifiedContentID: "sha256:" + strings.Repeat("b", 64), EntrySHA256: strings.Repeat("c", 64)}},
		ExactDependencySources: []localexecution.ExactDependencySource{{DependencyFamily: "python.package-set", DependencyID: "python-profile." + profile, ConsumerScope: capabilitydriver.SpeakerEncoderConsumerID, SelectedSourceRecordID: "profile-record", CanonicalRoot: filepath.Join(root, profile), Version: profile, Hashes: map[string]string{"profile_digest": profile, "driver_bundle_sha256": strings.Repeat("d", 64)}}},
	}
	spec := &runtimev1.AudioSpeakerEmbedScenarioSpec{MimeType: "audio/wav"}
	plan, err := (capabilitydriver.SherpaSpeakerEmbedDriver{}).PlanSpeakerEmbeddingInvocation(capabilitydriver.SpeakerEmbeddingInvocationInput{RecipeID: selected.RecipeID, Request: spec, AudioBytes: []byte("explicit-fixture-audio"), MIMEType: "audio/wav", Dimension: 512, Bindings: projectInvocationExactBindings(selected.ExactBindings), DependencySources: invocationExactDependencySources(selected.ExactDependencySources)})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := protojson.Marshal(spec)
	assembly, err := newLocalResolvedAssembly(selected, capabilitydriver.SpeakerEmbedContract, raw)
	if err == nil {
		assembly.Request.BinaryInput = plan.AudioBytes
		assembly.EmbeddingDimension = plan.Dimension
		assembly.Request.MIMEType = "audio/wav"
		assembly.LoadPlan = localResolvedAssemblyLoadPlan{Kind: "speaker-embedding", SpeakerEmbedding: speakerEmbeddingResolvedPlan(plan)}
		assembly.ProcessIdentity.ModelAssetID = plan.Binding.ModelAssetID
	}
	if err != nil {
		t.Fatal(err)
	}
	identity, err := projectResolvedAssemblyEffectiveInputIdentity(assembly)
	if err != nil {
		t.Fatal(err)
	}
	job := &runtimev1.ScenarioJob{JobId: "speakerEmbedding-job", Head: &runtimev1.ScenarioRequestHead{AppId: "app", SubjectUserId: "user"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_SPEAKER_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED, TraceId: "speakerEmbedding-trace", EffectiveInputIdentity: identity}
	if _, _, err := store.createOwnedAndBindAssemblyChecked(job, nil, nil, "", assembly); err != nil {
		t.Fatal(err)
	}
	return store, job, state
}

func TestSpeakerEmbeddingTerminalVectorSurvivesRestartAndRefusesForeignSpace(t *testing.T) {
	store, job, state := speakerEmbeddingJobFixture(t)
	assembly, _ := store.resolvedAssembly(job.JobId)
	space, err := speakerEmbeddingSpaceID(assembly)
	if err != nil {
		t.Fatal(err)
	}
	values := make([]float64, 512)
	values[0] = 0.75
	result := &runtimev1.AudioSpeakerEmbedResult{Vector: &runtimev1.EmbeddingVector{Values: values}, SpaceId: space}
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.scenarioJobs = store
	store.transition(job.JobId, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil)
	wrong := cloneAudioSpeakerEmbedResult(result)
	wrong.SpaceId = "same-width-different-space"
	if err := svc.completeSpeakerEmbeddingScenarioJob(job.JobId, wrong); err == nil {
		t.Fatal("foreign speaker space accepted")
	}
	if err := svc.completeSpeakerEmbeddingScenarioJob(job.JobId, result); err != nil {
		t.Fatal(err)
	}
	restored, err := newScenarioJobStoreForLocalStatePath(state)
	if err != nil {
		t.Fatal(err)
	}
	read, ok := restored.get(job.JobId)
	if !ok || read.GetSpeakerEmbedding().GetSpaceId() != space || read.GetSpeakerEmbedding().GetVector().GetValues()[0] != 0.75 {
		t.Fatal("actual fixture result not restored")
	}
	projected, err := projectLocalAppScenarioJob(read)
	if err != nil || projected.GetSpeakerEmbedding().GetSpaceId() != space {
		t.Fatalf("protected speaker result: %v", err)
	}
}
