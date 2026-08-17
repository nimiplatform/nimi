package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

type localSpeechHostStub struct {
	mu                 sync.Mutex
	synthesizePlan     *capabilitydriver.SpeechSynthesizeInvocationPlan
	transcribePlan     *capabilitydriver.SpeechTranscribeInvocationPlan
	voiceCreatePlan    *capabilitydriver.VoiceCreateInvocationPlan
	entered            chan struct{}
	release            chan struct{}
	beforeStartEntered chan struct{}
	beforeStartRelease chan struct{}
	cancelRelease      chan struct{}
	calls              chan string
	synthesisResult    *localexecution.SpeechSynthesisResult
	voiceCreateResult  *localexecution.VoiceCreateResult
	preStartErr        error
}

func (host *localSpeechHostStub) ExecuteVoiceCreate(ctx context.Context, plan *capabilitydriver.VoiceCreateInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.VoiceCreateResult, error) {
	if host.preStartErr != nil {
		return localexecution.VoiceCreateResult{}, host.preStartErr
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.VoiceCreateResult{}, err
		}
	}
	host.mu.Lock()
	host.voiceCreatePlan = plan
	host.mu.Unlock()
	if host.voiceCreateResult != nil {
		return *host.voiceCreateResult, nil
	}
	return localexecution.VoiceCreateResult{ProviderVoiceRef: "local-voice-handle"}, nil
}

func (host *localSpeechHostStub) ExecuteSpeechSynthesis(ctx context.Context, plan *capabilitydriver.SpeechSynthesizeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	if host.preStartErr != nil {
		return localexecution.SpeechSynthesisResult{}, host.preStartErr
	}
	closeOnce(host.beforeStartEntered)
	if host.beforeStartRelease != nil {
		select {
		case <-host.beforeStartRelease:
		case <-ctx.Done():
			return localexecution.SpeechSynthesisResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.SpeechSynthesisResult{}, err
		}
	}
	host.mu.Lock()
	host.synthesizePlan = plan
	host.mu.Unlock()
	if host.calls != nil {
		host.calls <- plan.Request().GetText()
	}
	closeOnce(host.entered)
	if host.release != nil {
		select {
		case <-host.release:
		case <-ctx.Done():
			if host.cancelRelease != nil {
				<-host.cancelRelease
			}
			return localexecution.SpeechSynthesisResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	if host.synthesisResult != nil {
		return *host.synthesisResult, nil
	}
	return localexecution.SpeechSynthesisResult{
		AudioBytes: []byte("RIFF-local-speech"),
		MIMEType:   "audio/wav",
		Usage:      &runtimev1.UsageStats{InputTokens: 1, OutputTokens: 2, ComputeMs: 3},
	}, nil
}

func TestLocalSpeechMaterializationFailureNeverPublishesRunning(t *testing.T) {
	svc := newTestService(nil)
	host := &localSpeechHostStub{preStartErr: &localexecution.ExecutionError{
		Kind: localexecution.FailureLoad,
		Err:  errors.New("exact speech ExecutionHost unavailable"),
	}}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-materialization-failure")})
	svc.SetLocalSpeechExecutionHost(host)
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "materialization failure"},
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	job := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		t.Fatalf("materialization failure status=%s", job.GetStatus())
	}
	svc.scenarioJobs.mu.RLock()
	record := svc.scenarioJobs.jobs[job.GetJobId()]
	events := append([]*runtimev1.ScenarioJobEvent(nil), record.events...)
	svc.scenarioJobs.mu.RUnlock()
	queued := false
	for _, event := range events {
		switch event.GetEventType() {
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED:
			queued = true
		case runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING:
			t.Fatalf("materialization failure published RUNNING: %+v", events)
		}
	}
	if !queued {
		t.Fatalf("materialization failure omitted QUEUED: %+v", events)
	}
}

func TestLocalSpeechJobRejectsPublicTimeoutAboveServerMaximumBeforePublication(t *testing.T) {
	svc := newTestService(nil)
	host := &localSpeechHostStub{calls: make(chan string, 1)}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-timeout-admission")})
	svc.SetLocalSpeechExecutionHost(host)
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "app.local",
			SubjectUserId: "anonymous",
			TimeoutMs:     int32((31 * time.Minute).Milliseconds()),
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "reject timeout"},
		}},
	})
	if response != nil {
		t.Fatalf("out-of-range timeout returned response: %+v", response)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
		t.Fatalf("timeout error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
	}
	svc.scenarioJobs.mu.RLock()
	jobCount := len(svc.scenarioJobs.jobs)
	svc.scenarioJobs.mu.RUnlock()
	if jobCount != 0 {
		t.Fatalf("out-of-range timeout published %d jobs", jobCount)
	}
	select {
	case call := <-host.calls:
		t.Fatalf("out-of-range timeout reached Host: %q", call)
	default:
	}
}

func TestLocalSpeechRunningCancelRetainsSchedulerLeaseUntilHostExits(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	host := &localSpeechHostStub{
		entered:       make(chan struct{}),
		release:       make(chan struct{}),
		cancelRelease: make(chan struct{}),
		calls:         make(chan string, 2),
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-running-cancel")})
	svc.SetLocalSpeechExecutionHost(host)
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	submit := func(text string) *runtimev1.ScenarioJob {
		t.Helper()
		response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
			Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: text},
			}},
		})
		if err != nil {
			t.Fatalf("SubmitScenarioJob(%q): %v", text, err)
		}
		return response.GetJob()
	}

	first := submit("running")
	select {
	case got := <-host.calls:
		if got != "running" {
			t.Fatalf("first Host call=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("running job did not enter Host")
	}
	waitLocalSpeechJobStatus(t, svc, first.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	if _, err := svc.CancelScenarioJob(ownerCtx, &runtimev1.CancelScenarioJobRequest{JobId: first.GetJobId(), Reason: "cancel running speech"}); err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	second := submit("replacement")
	waitLocalSpeechJobStatus(t, svc, second.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	select {
	case got := <-host.calls:
		t.Fatalf("replacement entered before canceled Host exited: %q", got)
	case <-time.After(100 * time.Millisecond):
	}
	if job, ok := svc.scenarioJobs.get(first.GetJobId()); !ok || isTerminalScenarioJobStatus(job.GetStatus()) {
		t.Fatalf("running cancel terminalized before Host exit: %+v", job)
	}

	close(host.cancelRelease)
	canceled := waitLocalSpeechJobTerminal(t, svc, first.GetJobId())
	if canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("canceled job status=%s", canceled.GetStatus())
	}
	select {
	case got := <-host.calls:
		if got != "replacement" {
			t.Fatalf("replacement Host call=%q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("replacement did not enter after canceled Host exited")
	}
	close(host.release)
	completed := waitLocalSpeechJobTerminal(t, svc, second.GetJobId())
	if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("replacement status=%s", completed.GetStatus())
	}
}

func TestLocalSpeechJobRemainsQueuedUntilSchedulerLeaseAndCancelsWithoutEnteringHost(t *testing.T) {
	svc := newTestService(nil)
	svc.scheduler = scheduler.New(scheduler.Config{GlobalConcurrency: 1, PerAppConcurrency: 1})
	host := &localSpeechHostStub{
		entered: make(chan struct{}),
		release: make(chan struct{}),
		calls:   make(chan string, 2),
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-scheduler")})
	svc.SetLocalSpeechExecutionHost(host)
	ownerCtx := scenarioJobUserContext("app.local", "anonymous")
	ctx := executionintent.WithIntent(ownerCtx, executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	submit := func(text string, timeoutMS int32) *runtimev1.ScenarioJob {
		t.Helper()
		response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
			Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous", TimeoutMs: timeoutMS},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: text},
			}},
		})
		if err != nil {
			t.Fatalf("SubmitScenarioJob(%q): %v", text, err)
		}
		return response.GetJob()
	}

	first := submit("first", 0)
	select {
	case got := <-host.calls:
		if got != "first" {
			t.Fatalf("first Host call = %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first local speech job did not enter Host")
	}
	probeCtx, cancelProbe := context.WithTimeout(context.Background(), 50*time.Millisecond)
	probeRelease, _, probeErr := svc.scheduler.Acquire(probeCtx, "other.app")
	cancelProbe()
	if probeErr == nil {
		probeRelease()
		t.Fatal("scheduler lease was not held for the active speech Host execution")
	}
	if !errors.Is(probeErr, context.DeadlineExceeded) {
		t.Fatalf("scheduler probe error=%v", probeErr)
	}
	second := submit("second", 0)
	waitLocalSpeechJobStatus(t, svc, second.GetJobId(), runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED)
	select {
	case got := <-host.calls:
		t.Fatalf("queued job entered Host before scheduler lease: %q", got)
	case <-time.After(100 * time.Millisecond):
	}

	if _, err := svc.CancelScenarioJob(ownerCtx, &runtimev1.CancelScenarioJobRequest{
		JobId:  second.GetJobId(),
		Reason: "cancel queued speech",
	}); err != nil {
		t.Fatalf("CancelScenarioJob: %v", err)
	}
	canceled := waitLocalSpeechJobTerminal(t, svc, second.GetJobId())
	if canceled.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("queued job status=%s", canceled.GetStatus())
	}
	select {
	case got := <-host.calls:
		t.Fatalf("canceled queued job entered Host: %q", got)
	default:
	}
	timedOut := waitLocalSpeechJobTerminal(t, svc, submit("timed-out", 50).GetJobId())
	if timedOut.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
		t.Fatalf("queued timeout job status=%s", timedOut.GetStatus())
	}
	select {
	case got := <-host.calls:
		t.Fatalf("timed-out queued job entered Host: %q", got)
	default:
	}

	close(host.release)
	completed := waitLocalSpeechJobTerminal(t, svc, first.GetJobId())
	if completed.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("first job status=%s", completed.GetStatus())
	}
}

func TestLocalSpeechSubmissionTurnsPreserveReservationOrderAndSkipCanceled(t *testing.T) {
	var order localSpeechSubmissionOrder
	first := order.reserve()
	second := order.reserve()
	third := order.reserve()

	type outcome struct {
		release func()
		err     error
	}
	thirdDone := make(chan outcome, 1)
	go func() {
		release, err := third.wait(context.Background())
		thirdDone <- outcome{release: release, err: err}
	}()
	secondCtx, cancelSecond := context.WithCancel(context.Background())
	secondDone := make(chan error, 1)
	go func() {
		_, err := second.wait(secondCtx)
		secondDone <- err
	}()

	firstRelease, err := first.wait(context.Background())
	if err != nil {
		t.Fatalf("first turn: %v", err)
	}
	cancelSecond()
	select {
	case err := <-secondDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("second turn cancellation=%v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("canceled middle turn did not exit")
	}
	select {
	case result := <-thirdDone:
		if result.release != nil {
			result.release()
		}
		t.Fatalf("third turn overtook active first turn: %v", result.err)
	case <-time.After(100 * time.Millisecond):
	}

	firstRelease()
	select {
	case result := <-thirdDone:
		if result.err != nil {
			t.Fatalf("third turn: %v", result.err)
		}
		result.release()
	case <-time.After(2 * time.Second):
		t.Fatal("third turn did not advance after first release")
	}
}

type trackedSpeechBody struct {
	*bytes.Reader
	closed bool
}

func (body *trackedSpeechBody) Close() error {
	body.closed = true
	return nil
}

func (host *localSpeechHostStub) ExecuteSpeechTranscription(ctx context.Context, plan *capabilitydriver.SpeechTranscribeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	if host.preStartErr != nil {
		return localexecution.SpeechTranscriptionResult{}, host.preStartErr
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return localexecution.SpeechTranscriptionResult{}, err
		}
	}
	host.mu.Lock()
	host.transcribePlan = plan
	host.mu.Unlock()
	closeOnce(host.entered)
	if host.release != nil {
		select {
		case <-host.release:
		case <-ctx.Done():
			if host.cancelRelease != nil {
				<-host.cancelRelease
			}
			return localexecution.SpeechTranscriptionResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
		}
	}
	return localexecution.SpeechTranscriptionResult{Text: "captured transcript", Usage: &runtimev1.UsageStats{InputTokens: 2, OutputTokens: 3, ComputeMs: 4}}, nil
}

func TestLocalSpeechWithoutMachineSelectionFailsClosed(t *testing.T) {
	tests := []struct {
		name               string
		capabilityContract string
		scenarioType       runtimev1.ScenarioType
		spec               *runtimev1.ScenarioSpec
	}{
		{
			name:               "synthesize",
			capabilityContract: "audio.synthesize",
			scenarioType:       runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
			}},
		},
		{
			name:               "transcribe",
			capabilityContract: "audio.transcribe",
			scenarioType:       runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: "audio/wav",
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
						AudioBytes: []byte("audio"),
					}},
				},
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{err: grpcerr.WithReasonCode(
				codes.FailedPrecondition,
				runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
			)})
			ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
				CapabilityContract: test.capabilityContract,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			})
			_, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
				ScenarioType:  test.scenarioType,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				Spec:          test.spec,
			})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND {
				t.Fatalf("missing speech selection error=%v reason=%v ok=%v", err, reason, ok)
			}
		})
	}
}

func TestLocalSpeechJobsExecuteExactCapturedDriverPlans(t *testing.T) {
	tests := []struct {
		name               string
		capabilityContract string
		scenarioType       runtimev1.ScenarioType
		selected           func(*testing.T) *localexecution.SelectedLocalExecution
		spec               func() *runtimev1.ScenarioSpec
		assert             func(*testing.T, *Service, *localSpeechHostStub, *runtimev1.ScenarioJob)
	}{
		{
			name:               "synthesize",
			capabilityContract: capabilitydriver.AudioSynthesizeContract,
			scenarioType:       runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			selected: func(t *testing.T) *localexecution.SelectedLocalExecution {
				return selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-tts")
			},
			spec: func() *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"}}}
			},
			assert: func(t *testing.T, svc *Service, host *localSpeechHostStub, job *runtimev1.ScenarioJob) {
				t.Helper()
				host.mu.Lock()
				plan := host.synthesizePlan
				host.mu.Unlock()
				if plan == nil || plan.ModelAssetID() != "speech-tts-model" || plan.Request().GetText() != "hello" {
					t.Fatalf("captured synthesis plan=%+v", plan)
				}
				if len(job.GetArtifacts()) != 1 || job.GetArtifacts()[0].GetMimeType() != "audio/wav" || len(job.GetArtifacts()[0].GetBytes()) != 0 || job.GetArtifacts()[0].GetUri() != "" {
					t.Fatalf("synthesis artifacts=%+v", job.GetArtifacts())
				}
				assertRuntimeArtifactBody(t, svc, job.GetArtifacts()[0].GetArtifactId(), "RIFF-local-speech")
			},
		},
		{
			name:               "transcribe",
			capabilityContract: capabilitydriver.AudioTranscribeContract,
			scenarioType:       runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			selected: func(t *testing.T) *localexecution.SelectedLocalExecution {
				return selectedSpeechExecutionForTest(t, capabilitydriver.AudioTranscribeContract, "speech-stt")
			},
			spec: func() *runtimev1.ScenarioSpec {
				return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: "audio/wav",
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
						AudioBytes: []byte("original-audio"),
					}},
				}}}
			},
			assert: func(t *testing.T, svc *Service, host *localSpeechHostStub, job *runtimev1.ScenarioJob) {
				t.Helper()
				host.mu.Lock()
				plan := host.transcribePlan
				host.mu.Unlock()
				if plan == nil || plan.ModelAssetID() != "speech-stt-model" || !reflect.DeepEqual(plan.AudioBytes(), []byte("original-audio")) || plan.Request().GetAudioSource() != nil {
					t.Fatalf("captured transcription plan=%+v", plan)
				}
				if len(job.GetArtifacts()) != 1 || job.GetArtifacts()[0].GetMimeType() != "text/plain; charset=utf-8" || len(job.GetArtifacts()[0].GetBytes()) != 0 || job.GetArtifacts()[0].GetUri() != "" {
					t.Fatalf("transcription artifacts=%+v", job.GetArtifacts())
				}
				if job.GetTranscriptionText() != "captured transcript" {
					t.Fatalf("transcription text=%q", job.GetTranscriptionText())
				}
				assertRuntimeArtifactBody(t, svc, job.GetArtifacts()[0].GetArtifactId(), "captured transcript")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(nil)
			host := &localSpeechHostStub{entered: make(chan struct{}), release: make(chan struct{})}
			svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: test.selected(t)})
			svc.SetLocalSpeechExecutionHost(host)
			ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
				CapabilityContract: test.capabilityContract,
				Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			})
			spec := test.spec()
			response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
				Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
				ScenarioType:  test.scenarioType,
				ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
				Spec:          spec,
			})
			if err != nil {
				t.Fatalf("SubmitScenarioJob: %v", err)
			}
			if transcribe := spec.GetSpeechTranscribe(); transcribe != nil {
				transcribe.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("mutated")}}
			}
			select {
			case <-host.entered:
			case <-time.After(2 * time.Second):
				t.Fatal("local speech Host was not entered")
			}
			close(host.release)
			job := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || job.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || job.GetModelResolved() == "" {
				t.Fatalf("local speech job=%+v", job)
			}
			test.assert(t, svc, host, job)
		})
	}
}

func TestLocalSpeechJobStreamsHostBodyIntoRuntimeCustody(t *testing.T) {
	payload := []byte("RIFF-streamed-local-speech")
	source := &trackedSpeechBody{Reader: bytes.NewReader(payload)}
	host := &localSpeechHostStub{synthesisResult: &localexecution.SpeechSynthesisResult{
		AudioBody: source,
		SizeBytes: int64(len(payload)),
		MIMEType:  "audio/wav",
		Usage:     &runtimev1.UsageStats{InputTokens: 1, OutputTokens: 2, ComputeMs: 3},
	}}
	svc := newTestService(nil)
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-streamed-custody")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "stream into custody"},
		}},
	})
	if err != nil {
		t.Fatalf("SubmitScenarioJob: %v", err)
	}
	job := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 {
		t.Fatalf("local speech job=%+v", job)
	}
	artifact := job.GetArtifacts()[0]
	if len(artifact.GetBytes()) != 0 || artifact.GetUri() != "" || artifact.GetSizeBytes() != int64(len(payload)) {
		t.Fatalf("streamed synthesis metadata=%+v", artifact)
	}
	if !source.closed {
		t.Fatal("Runtime custody did not close the accepted speech body")
	}
	assertRuntimeArtifactBody(t, svc, artifact.GetArtifactId(), string(payload))
}

func assertRuntimeArtifactBody(t *testing.T, svc *Service, artifactID string, want string) {
	t.Helper()
	source, ok := svc.runtimeArtifacts.Open(context.Background(), artifactID)
	if !ok {
		t.Fatalf("Runtime artifact %q is unavailable", artifactID)
	}
	payload, err := io.ReadAll(source.Body)
	closeErr := source.Body.Close()
	if err != nil || closeErr != nil {
		t.Fatalf("read Runtime artifact %q: read=%v close=%v", artifactID, err, closeErr)
	}
	if string(payload) != want {
		t.Fatalf("Runtime artifact %q body=%q want=%q", artifactID, payload, want)
	}
}

func TestLocalSpeechSynthesisStreamUsesDeclaredSimulatedMode(t *testing.T) {
	svc := newTestService(nil)
	host := &localSpeechHostStub{}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-stream")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	stream := &mockScenarioEventStream{ctx: ctx}
	err := svc.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello stream"},
		}},
	}, stream)
	if err != nil {
		t.Fatalf("StreamScenario: %v", err)
	}
	if len(stream.events) != 4 || stream.events[0].GetStarted().GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
		stream.events[0].GetStarted().GetVoiceOutputMode() != runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM ||
		string(stream.events[1].GetDelta().GetArtifact().GetChunk()) != "RIFF-local-speech" ||
		!stream.events[3].GetCompleted().GetStreamSimulated() {
		t.Fatalf("local speech stream events=%+v", stream.events)
	}
}

func TestLocalSpeechSynthesisStreamFirstPacketTimeoutStartsAfterHostLease(t *testing.T) {
	svc := newTestService(nil)
	svc.streamFirstPacketTimeout = 20 * time.Millisecond
	host := &localSpeechHostStub{
		beforeStartEntered: make(chan struct{}),
		beforeStartRelease: make(chan struct{}),
	}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(t, capabilitydriver.AudioSynthesizeContract, "speech-stream-queued")})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := executionintent.WithIntent(context.Background(), executionintent.Intent{
		CapabilityContract: capabilitydriver.AudioSynthesizeContract,
		Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
	})
	stream := &mockScenarioEventStream{ctx: ctx}
	done := make(chan error, 1)
	go func() {
		done <- svc.StreamScenario(&runtimev1.StreamScenarioRequest{
			Head:          &runtimev1.ScenarioRequestHead{AppId: "app.local", SubjectUserId: "anonymous", TimeoutMs: 1_000},
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
			Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "queued stream"},
			}},
		}, stream)
	}()
	select {
	case <-host.beforeStartEntered:
	case <-time.After(time.Second):
		t.Fatal("stream did not reach the Host queue")
	}
	time.Sleep(3 * svc.streamFirstPacketTimeout)
	close(host.beforeStartRelease)
	if err := <-done; err != nil {
		t.Fatalf("StreamScenario after Host queue: %v", err)
	}
	if len(stream.events) != 4 || stream.events[1].GetDelta().GetArtifact() == nil || stream.events[3].GetCompleted() == nil {
		t.Fatalf("queued local speech stream events=%+v", stream.events)
	}
}

func selectedSpeechExecutionForTest(t *testing.T, contract string, configurationID string) *localexecution.SelectedLocalExecution {
	t.Helper()
	var driver capabilitydriver.Driver
	var identity capabilitydriver.Identity
	switch contract {
	case capabilitydriver.AudioSynthesizeContract:
		driver = capabilitydriver.Qwen3TTSDriver{}
		identity = capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3TTSImplementationID, DriverID: capabilitydriver.Qwen3TTSDriverID, DriverDialect: capabilitydriver.Qwen3TTSDriverDialect}
	case capabilitydriver.AudioTranscribeContract:
		driver = capabilitydriver.Qwen3ASRDriver{}
		identity = capabilitydriver.Identity{ImplementationID: capabilitydriver.Qwen3ASRImplementationID, DriverID: capabilitydriver.Qwen3ASRDriverID, DriverDialect: capabilitydriver.Qwen3ASRDriverDialect}
	default:
		t.Fatalf("unsupported speech contract %q", contract)
	}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || len(requirements) != 1 {
		t.Fatalf("speech Interpret reason=%v requirements=%+v", reason, requirements)
	}
	path := filepath.Join(t.TempDir(), "model.safetensors")
	payload := []byte(configurationID)
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	digestBytes := sha256.Sum256(payload)
	digest := hex.EncodeToString(digestBytes[:])
	options, err := structpb.NewStruct(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	modelAssetID := fmt.Sprintf("%s-model", configurationID)
	return &localexecution.SelectedLocalExecution{
		LoadoutID:          configurationID,
		CapabilityContract: contract,
		DisplayName:        configurationID,
		RecipeID:           fmt.Sprintf("recipe.%s.%s", contract, configurationID),
		RecipeRevision:     "7",
		DriverIdentity:     identity.Proto(),
		PortableConfig:     options,
		Requirements:       requirements,
		ExactBindings: []localexecution.ExactBinding{{
			RequirementID: requirements[0].GetRequirementId(), ModelAssetID: modelAssetID,
			AbsolutePath: path, VerifiedContentID: "sha256:" + digest, EntrySHA256: digest,
		}},
		Configured: true,
	}
}

func waitLocalSpeechJobTerminal(t *testing.T, svc *Service, jobID string) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(job.GetStatus()) {
			return job
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("local speech job %s did not reach a terminal state", jobID)
	return nil
}

func waitLocalSpeechJobStatus(t *testing.T, svc *Service, jobID string, wanted runtimev1.ScenarioJobStatus) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := svc.scenarioJobs.get(jobID); ok {
			if job.GetStatus() == wanted {
				return job
			}
			if isTerminalScenarioJobStatus(job.GetStatus()) {
				t.Fatalf("local speech job %s reached %s before %s", jobID, job.GetStatus(), wanted)
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("local speech job %s did not reach %s", jobID, wanted)
	return nil
}
