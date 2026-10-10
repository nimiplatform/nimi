package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func musicSubmissionRequest() *runtimev1.SubmitLocalAppScenarioJobRequest {
	return &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "song-action-1", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "warm acoustic ballad", Lyrics: "Keep this melody"}}}
}

func TestGenericJobActionIdentityDoesNotAcquireMediaRetention(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	owner := &localAppJobOwner{AccountID: "account", RegisteredAppSubject: "subject", ProducerAppID: "app"}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "image-action", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "original input"}}}
	submission, err := captureLocalAppMusicSubmission(request)
	if err != nil || submission.ReservedBytes != 0 {
		t.Fatalf("generic identity inherited media quota: %+v %v", submission, err)
	}
	job := completedScenarioJobForIsolationTest("generic-action-job")
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	job.Head.AppId, job.Head.SubjectUserId = owner.ProducerAppID, owner.AccountID
	assembly := cloudAssemblyForIsolationTest(t, job)
	beginCloudCredentialCustodyForTest(t, store, job.JobId)
	if _, created, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, assembly, true, submission); err != nil || !created {
		t.Fatalf("publish action: %v", err)
	}
	if _, accepted, err := store.requestCancel(job.JobId, "cancel before dispatch"); err != nil || !accepted {
		t.Fatalf("cancel: %v", err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(statePath)
	if err != nil {
		t.Fatal(err)
	}
	store = reopened
	found, err := store.getMusicSubmission(owner, request.ClientSubmissionId, submission.RequestSHA256)
	if err != nil || found.GetJobId() != job.JobId || found.GetRecoveryExpiresAt() != nil {
		t.Fatalf("generic action lookup/retention: %v %v", found, err)
	}
	request.GetImageGenerate().Prompt = "changed input"
	changed, err := captureLocalAppMusicSubmission(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.getMusicSubmission(owner, request.ClientSubmissionId, changed.RequestSHA256); !errors.Is(err, errLocalAppSubmissionConflict) {
		t.Fatalf("changed input did not conflict: %v", err)
	}
	store.mu.Lock()
	store.pruneJobsLocked(time.Now().Add(scenarioJobRetention + time.Minute))
	store.mu.Unlock()
	if found, _ := store.getMusicSubmission(owner, request.ClientSubmissionId, ""); found != nil {
		t.Fatal("generic action acquired the media 24-hour TTL")
	}
}

func TestMusicSubmissionConcurrentPublicationAndConflict(t *testing.T) {
	store := newScenarioJobStore()
	owner := &localAppJobOwner{AccountID: "account-1", RegisteredAppSubject: "app-subject-1", ProducerAppID: "catalog-name"}
	submission, err := captureLocalAppMusicSubmission(musicSubmissionRequest())
	if err != nil {
		t.Fatal(err)
	}
	var published atomic.Int32
	var wg sync.WaitGroup
	ids := make(chan string, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			job := &runtimev1.ScenarioJob{JobId: fmt.Sprintf("job-%d", i), ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}
			got, created, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, nil, false, submission)
			if err != nil {
				t.Error(err)
				return
			}
			if created {
				published.Add(1)
			}
			ids <- got.GetJobId()
		}(i)
	}
	wg.Wait()
	close(ids)
	if published.Load() != 1 || len(store.jobs) != 1 {
		t.Fatalf("published=%d records=%d", published.Load(), len(store.jobs))
	}
	first := ""
	for id := range ids {
		if first == "" {
			first = id
		}
		if first != id {
			t.Fatalf("duplicate executions: %s, %s", first, id)
		}
	}
	changed := *submission
	changed.RequestSHA256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	_, _, err = store.createOwnedAndBindCapturedInputsChecked(&runtimev1.ScenarioJob{JobId: "conflict", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}, nil, owner, "", nil, nil, false, &changed)
	if !errors.Is(err, errLocalAppSubmissionConflict) {
		t.Fatalf("conflict=%v", err)
	}
	owner.ProducerAppID = "renamed-catalog-name"
	if job, err := store.getMusicSubmission(owner, submission.ID, submission.RequestSHA256); err != nil || job.GetJobId() != first {
		t.Fatalf("catalog metadata changed identity: %v %v", job, err)
	}
	owner.RegisteredAppSubject = "other-subject"
	if job, _ := store.getMusicSubmission(owner, submission.ID, ""); job != nil {
		t.Fatal("cross-subject disclosure")
	}
}

func TestMusicSubmissionWriteFailureDoesNotPublishBinding(t *testing.T) {
	store := newScenarioJobStore()
	store.persistenceFailure = func(scenarioJobPersistenceAttempt) error { return errors.New("disk full") }
	owner := &localAppJobOwner{AccountID: "a", RegisteredAppSubject: "s", ProducerAppID: "p"}
	submission, _ := captureLocalAppMusicSubmission(musicSubmissionRequest())
	_, created, err := store.createOwnedAndBindCapturedInputsChecked(&runtimev1.ScenarioJob{JobId: "failed-write", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB}, nil, owner, "", nil, nil, false, submission)
	if err == nil || created {
		t.Fatalf("failed write published: %v %v", created, err)
	}
	if job, _ := store.getMusicSubmission(owner, submission.ID, ""); job != nil {
		t.Fatal("binding survived failed publication")
	}
}

func TestMusicSubmissionDurableLookupAndIngressAdmission(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	submitCtx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	owner := localAppJobOwnerFromContext(submitCtx)
	request := musicSubmissionRequest()
	submission, _ := captureLocalAppMusicSubmission(request)
	job := completedScenarioJobForIsolationTest("music-recovery")
	job.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE
	job.Status = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED
	job.Head = &runtimev1.ScenarioRequestHead{AppId: owner.ProducerAppID, SubjectUserId: owner.AccountID}
	job.Artifacts = nil
	imageFixture := proto.Clone(job).(*runtimev1.ScenarioJob)
	imageFixture.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
	assembly := cloudAssemblyForIsolationTest(t, imageFixture)
	assembly.CapabilityContract = "music.generate"
	assembly.Request, err = (protojson.MarshalOptions{UseProtoNames: true}).Marshal(&runtimev1.SubmitScenarioJobRequest{
		Head: job.Head, ScenarioType: job.ScenarioType, ExecutionMode: job.ExecutionMode,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: request.GetMusicGenerate().GetPrompt(), Lyrics: request.GetMusicGenerate().GetLyrics()}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, assembly, false, submission)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := newScenarioJobStoreForLocalStatePath(path)
	if err != nil {
		t.Fatal(err)
	}
	// No configured resolver or execution Host: duplicate admission must return
	// the actual durable Job without touching newly selected resources.
	svc := &Service{scenarioJobs: reopened}
	result, err := svc.SubmitLocalAppScenarioJob(submitCtx, request)
	if err != nil || result.GetJob().GetJobId() != job.GetJobId() {
		t.Fatalf("durable reuse=%v %v", result, err)
	}
	changed := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
	changed.GetMusicGenerate().Lyrics = "another lyric"
	_, err = svc.SubmitLocalAppScenarioJob(submitCtx, changed)
	assertLocalAppTextCandidateError(t, err, codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT)
	_, err = svc.SubmitLocalAppScenarioJob(context.Background(), request)
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
	getCtx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	got, err := svc.GetLocalAppScenarioJob(getCtx, &runtimev1.GetLocalAppScenarioJobRequest{ClientSubmissionId: request.GetClientSubmissionId()})
	if err != nil || got.GetJob().GetJobId() != job.GetJobId() {
		t.Fatalf("lookup=%v %v", got, err)
	}
	_, err = svc.GetLocalAppScenarioJob(getCtx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: job.GetJobId(), ClientSubmissionId: request.GetClientSubmissionId()})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	foreign := localAppScenarioJobContextForSubject(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet, "foreign")
	_, err = svc.GetLocalAppScenarioJob(foreign, &runtimev1.GetLocalAppScenarioJobRequest{ClientSubmissionId: request.GetClientSubmissionId()})
	assertLocalAppTextCandidateError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
}

func TestVoiceCreationSubmissionReusesJobBeforeConfigurationAndScopesOwner(t *testing.T) {
	store := newScenarioJobStore()
	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	owner := localAppJobOwnerFromContext(ctx)
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "reference-voice-action", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{Source: &runtimev1.LocalAppVoiceCreateJobSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioUri: "https://assets.example.test/current.wav"}}}}}
	submission, err := captureLocalAppMusicSubmission(request)
	if err != nil || submission.ReservedBytes != 0 {
		t.Fatalf("submission=%v err=%v", submission, err)
	}
	job := &runtimev1.ScenarioJob{JobId: "voice-job", ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED}
	_, created, err := store.createOwnedAndBindCapturedInputsChecked(job, nil, owner, "", nil, nil, false, submission)
	if err != nil || !created {
		t.Fatalf("create=%v err=%v", created, err)
	}
	// No AIConfig resolver or provider is installed: the same explicit action must
	// recover the existing Job rather than create another paid provider voice.
	svc := &Service{scenarioJobs: store}
	response, err := svc.SubmitLocalAppScenarioJob(ctx, request)
	if err != nil || response.GetJob().GetJobId() != "voice-job" || len(store.jobs) != 1 {
		t.Fatalf("reuse=%v err=%v", response, err)
	}
	changed := proto.Clone(request).(*runtimev1.SubmitLocalAppScenarioJobRequest)
	changed.GetVoiceCreate().GetReferenceAudio().ReferenceAudioUri = "https://assets.example.test/other.wav"
	_, err = svc.SubmitLocalAppScenarioJob(ctx, changed)
	assertLocalAppTextCandidateError(t, err, codes.AlreadyExists, runtimev1.ReasonCode_AI_MEDIA_IDEMPOTENCY_CONFLICT)
	foreign := &localAppJobOwner{AccountID: owner.AccountID, RegisteredAppSubject: "other-app", ProducerAppID: owner.ProducerAppID}
	if found, _ := store.getMusicSubmission(foreign, submission.ID, ""); found != nil {
		t.Fatal("foreign owner recovered voice submission")
	}
}

type countedActionCaptureResolver struct {
	*localVoiceExecutionResolver
	calls atomic.Int32
}

func (r *countedActionCaptureResolver) ResolveLocalExecution(contract, ref string) (*localexecution.SelectedLocalExecution, error) {
	r.calls.Add(1)
	return r.localVoiceExecutionResolver.ResolveLocalExecution(contract, ref)
}
func (r *countedActionCaptureResolver) ResolveSelectedLocalExecution(contract string) (*localexecution.SelectedLocalExecution, error) {
	return r.ResolveLocalExecution(contract, "")
}

func TestVoiceCreationSubmissionDoesNotPromiseRecoveryForEphemeralLocalVoice(t *testing.T) {
	svc := newTestService(nil)
	resolver := &countedActionCaptureResolver{localVoiceExecutionResolver: &localVoiceExecutionResolver{selections: map[string]*localexecution.SelectedLocalExecution{
		"voice.create": selectedLocalVoiceCreateExecutionForTest(t, "reference-recovery", "input.audio"),
	}}}
	svc.SetLocalExecutionResolver(resolver)
	if err := overwriteAIConfigStoreForTest(context.Background(), svc.aiConfigStore, "account-1", appAIConfig("nimi.realm-persona-studio", localAppAIConfigIntent("voice.create"))); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "reference.wav")
	if err := writeLocalMusicTestWAV(path, 16000, 1, 1); err != nil {
		t.Fatal(err)
	}
	audio, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	req := &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "local-voice-action", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{Source: &runtimev1.LocalAppVoiceCreateJobSpec_ReferenceAudio{ReferenceAudio: &runtimev1.VoiceV2VInput{ReferenceAudioBytes: audio, ReferenceAudioMime: "audio/wav"}}}}}
	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	var wg sync.WaitGroup
	responses := make(chan *runtimev1.SubmitLocalAppScenarioJobResponse, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := svc.SubmitLocalAppScenarioJob(ctx, proto.Clone(req).(*runtimev1.SubmitLocalAppScenarioJobRequest))
			if err != nil {
				t.Error(err)
				return
			}
			responses <- result
		}()
	}
	wg.Wait()
	close(responses)
	var response *runtimev1.SubmitLocalAppScenarioJobResponse
	for result := range responses {
		if response != nil && result.GetJob().GetJobId() != response.GetJob().GetJobId() {
			t.Fatal("one action published duplicate Jobs")
		}
		response = result
	}
	if resolver.calls.Load() != 1 {
		t.Fatalf("duplicate action re-captured mutable Local selection %d times", resolver.calls.Load())
	}
	if response.GetJob().GetJobId() == "" {
		t.Fatalf("generic Local voice action was rejected: %v", err)
	}
	// No model Host is installed: exercise admission/binding, not fake inference.
	terminal := waitLocalVoiceJobTerminal(t, svc, response.GetJob().GetJobId())
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED || terminal.GetRecoveryExpiresAt() != nil {
		t.Fatalf("Local identity acquired retained-media policy: %v", terminal)
	}
	found, err := svc.scenarioJobs.getMusicSubmission(localAppJobOwnerFromContext(ctx), req.ClientSubmissionId, "")
	if err != nil || found.GetJobId() != terminal.GetJobId() {
		t.Fatalf("Local action was not bound: %v", err)
	}
}
