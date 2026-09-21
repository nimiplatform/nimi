package ai

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func musicSubmissionRequest() *runtimev1.SubmitLocalAppScenarioJobRequest {
	return &runtimev1.SubmitLocalAppScenarioJobRequest{ClientSubmissionId: "song-action-1", Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_MusicGenerate{MusicGenerate: &runtimev1.LocalAppMusicGenerateJobSpec{Prompt: "warm acoustic ballad", Lyrics: "Keep this melody"}}}
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
			job := &runtimev1.ScenarioJob{JobId: fmt.Sprintf("job-%d", i), ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE}
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
	_, _, err = store.createOwnedAndBindCapturedInputsChecked(&runtimev1.ScenarioJob{JobId: "conflict", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE}, nil, owner, "", nil, nil, false, &changed)
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
	_, created, err := store.createOwnedAndBindCapturedInputsChecked(&runtimev1.ScenarioJob{JobId: "failed-write", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE}, nil, owner, "", nil, nil, false, submission)
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
