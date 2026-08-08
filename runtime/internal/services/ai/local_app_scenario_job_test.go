package ai

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
)

func localAppScenarioJobContext(operation accountservice.LocalAppOperation, capability string) context.Context {
	return localAppScenarioDecisionContext(operation, capability)
}

func TestLocalAppJobSpecsPreservePresenceAndOwnerClamps(t *testing.T) {
	tts, err := validateLocalAppSpeechSynthesizeJobSpec(&runtimev1.LocalAppSpeechSynthesizeJobSpec{
		Text: "hello", SampleRateHz: testInt32(0), Speed: testFloat32(4), Pitch: testFloat32(-24), Volume: testFloat32(4),
	})
	if err != nil || tts.SampleRateHz == nil || tts.Speed == nil || tts.Pitch == nil || tts.Volume == nil || tts.GetPitch() != -24 {
		t.Fatalf("TTS carrier projection=%+v error=%v", tts, err)
	}
	if _, err := validateLocalAppSpeechSynthesizeJobSpec(&runtimev1.LocalAppSpeechSynthesizeJobSpec{
		Text: "hello", Speed: testFloat32(4.1),
	}); err == nil {
		t.Fatal("TTS speed above owner clamp was accepted")
	}

	video, err := validateLocalAppVideoGenerationOptions(&runtimev1.LocalAppVideoGenerationOptions{
		Ratio: "16:9", DurationSec: testInt32(2), ReturnLastFrame: testBool(true),
		Seed: testInt64(0), GenerateAudio: testBool(false), CameraFixed: testBool(false),
	})
	if err != nil || video.Seed == nil || video.GenerateAudio == nil || video.CameraFixed == nil ||
		video.DurationSec == nil || video.ReturnLastFrame == nil || video.GetRatio() != "16:9" || video.GetDurationSec() != 2 ||
		!video.GetReturnLastFrame() || video.GetGenerateAudio() {
		t.Fatalf("video carrier projection=%+v error=%v", video, err)
	}

	stt, err := validateLocalAppSpeechTranscribeJobSpec(&runtimev1.LocalAppSpeechTranscribeJobSpec{
		MimeType: "audio/wav", Timestamps: testBool(false), Diarization: testBool(false), SpeakerCount: testInt32(0),
		AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("audio")}},
	})
	if err != nil || stt.Timestamps == nil || stt.Diarization == nil || stt.SpeakerCount == nil {
		t.Fatalf("STT carrier projection=%+v error=%v", stt, err)
	}
}

func TestSubmitLocalAppScenarioJobRequiresExactDecision(t *testing.T) {
	svc := &Service{}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "a persona portrait"},
		},
	}
	_, err := svc.SubmitLocalAppScenarioJob(context.Background(), request)
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)

	wrong := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	_, err = svc.SubmitLocalAppScenarioJob(wrong, request)
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE)
}

func TestSubmitLocalAppScenarioJobRejectsOutOfClosedSetInput(t *testing.T) {
	svc := &Service{}
	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	invalid := []*runtimev1.SubmitLocalAppScenarioJobRequest{
		{},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate{VideoGenerate: &runtimev1.LocalAppVideoGenerateJobSpec{
			Prompt: "clip",
			Content: []*runtimev1.VideoContentItem{{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
				ImageUrl: &runtimev1.VideoContentImageURL{
					Url: "http://insecure.example/image.png",
				},
			}},
		}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{
			Text: "hello",
			VoiceRef: &runtimev1.VoiceReference{
				Kind:      runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
				Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "provider-handle"},
			},
		}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe{SpeechTranscribe: &runtimev1.LocalAppSpeechTranscribeJobSpec{
			MimeType: "audio/wav",
			AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
				Source: &runtimev1.SpeechTranscriptionAudioSource_AudioChunks{AudioChunks: &runtimev1.AudioChunks{Chunks: [][]byte{[]byte("chunk")}}},
			},
		}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceClone{VoiceClone: &runtimev1.LocalAppVoiceCloneJobSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceDesign{VoiceDesign: &runtimev1.LocalAppVoiceDesignJobSpec{
			Input: &runtimev1.VoiceT2VInput{InstructionText: strings.Repeat("x", maxLocalAppScenarioVideoContentText+1)},
		}}},
	}
	for index, request := range invalid {
		_, err := svc.SubmitLocalAppScenarioJob(ctx, request)
		if err == nil {
			t.Fatalf("invalid job request %d was accepted", index)
		}
	}
}

func TestSubmitLocalAppScenarioJobFailsClosedWithoutAIConfig(t *testing.T) {
	svc := newTestService(nil)
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate{
			ImageGenerate: &runtimev1.LocalAppImageGenerateScenarioSpec{Prompt: "a persona portrait"},
		},
	}
	response, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	if response != nil {
		t.Fatalf("response = %+v, want nil", response)
	}
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
}

func TestSubmitLocalAppScenarioJobVoiceWorkflowDerivesTargetFromIntent(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
		appAIConfig("nimi.realm-persona-studio", grantlessCloudAIConfigIntent(t, "voice_workflow.voice_design"))); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceDesign{
			VoiceDesign: &runtimev1.LocalAppVoiceDesignJobSpec{
				Input: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator voice"},
			},
		},
	}
	// The wrapper fills target_model_id from the committed AIConfig intent, so
	// owner spec validation passes and the call fails closed later inside
	// Cloud composition (no resolvable binding in this fixture) rather than
	// with AI_VOICE_TARGET_MODEL_MISMATCH.
	_, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func TestSubmitLocalAppScenarioJobLocalVoiceWorkflowFailsClosed(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
		Owner:        derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localAppAIConfigIntent("voice_workflow.voice_design")},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceDesign{
			VoiceDesign: &runtimev1.LocalAppVoiceDesignJobSpec{
				Input: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator voice"},
			},
		},
	}
	_, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func createLocalAppScenarioJobForTest(svc *Service, jobID string, appID string, subject string, status runtimev1.ScenarioJobStatus) {
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: subject},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       status,
		TraceId:      "trace-" + jobID,
	}, nil)
}

func TestGetLocalAppScenarioJobProjectsTrimmedJob(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-1", "nimi.realm-persona-studio", "account-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	response, err := svc.GetLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet),
		&runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-1"})
	if err != nil {
		t.Fatalf("GetLocalAppScenarioJob: %v", err)
	}
	job := response.GetJob()
	if job.GetJobId() != "job-1" || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING ||
		job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE || job.GetTraceId() != "trace-job-1" {
		t.Fatalf("job projection = %+v", job)
	}
}

func TestGetLocalAppScenarioJobRejectsCrossOwnerAndUnknown(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-other", "other-app", "account-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	createLocalAppScenarioJobForTest(svc, "job-other-account", "nimi.realm-persona-studio", "account-2", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	_, err := svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-other"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-other-account"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-missing"})
	assertLocalAppTextCandidateError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: " padded "})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func TestCancelLocalAppScenarioJobCancelsOwnedJob(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-cancel", "nimi.realm-persona-studio", "account-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED)
	response, err := svc.CancelLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobCancel, localappop.AppOperationIDScenarioJobCancel),
		&runtimev1.CancelLocalAppScenarioJobRequest{JobId: "job-cancel", Reason: "user stopped"})
	if err != nil {
		t.Fatalf("CancelLocalAppScenarioJob: %v", err)
	}
	if response.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
		t.Fatalf("cancel projection = %+v", response.GetJob())
	}
}

type mockLocalAppScenarioJobEventStream struct {
	ctx    context.Context
	events []*runtimev1.LocalAppScenarioJobEvent
}

func (m *mockLocalAppScenarioJobEventStream) Send(event *runtimev1.LocalAppScenarioJobEvent) error {
	m.events = append(m.events, event)
	return nil
}

func (m *mockLocalAppScenarioJobEventStream) Context() context.Context     { return m.ctx }
func (m *mockLocalAppScenarioJobEventStream) SendHeader(metadata.MD) error { return nil }
func (m *mockLocalAppScenarioJobEventStream) SetHeader(metadata.MD) error  { return nil }
func (m *mockLocalAppScenarioJobEventStream) SetTrailer(metadata.MD)       {}
func (m *mockLocalAppScenarioJobEventStream) RecvMsg(any) error            { return nil }
func (m *mockLocalAppScenarioJobEventStream) SendMsg(any) error            { return nil }

func TestSubscribeLocalAppScenarioJobEventsProjectsTerminalBacklog(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-done", "nimi.realm-persona-studio", "account-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
	stream := &mockLocalAppScenarioJobEventStream{
		ctx: localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubscribe, localappop.AppOperationIDScenarioJobSubscribe),
	}
	if err := svc.SubscribeLocalAppScenarioJobEvents(&runtimev1.SubscribeLocalAppScenarioJobEventsRequest{JobId: "job-done"}, stream); err != nil {
		t.Fatalf("SubscribeLocalAppScenarioJobEvents: %v", err)
	}
	if len(stream.events) != 1 || stream.events[0].GetJob().GetJobId() != "job-done" ||
		stream.events[0].GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("subscribed events = %+v", stream.events)
	}
}

func TestProjectLocalAppScenarioJobFailsClosedOnOwnerOnlyShapes(t *testing.T) {
	if _, err := projectLocalAppScenarioJob(&runtimev1.ScenarioJob{
		JobId: "job-1", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}); err == nil {
		t.Fatal("text-generate Job passed the local-app job projection")
	}
	if _, err := projectLocalAppScenarioJob(&runtimev1.ScenarioJob{
		JobId: "job-1", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED,
	}); err == nil {
		t.Fatal("unspecified-status Job passed the local-app job projection")
	}
	if _, err := projectLocalAppScenarioJob(&runtimev1.ScenarioJob{
		JobId: "job-1", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED, ReasonDetail: strings.Repeat("x", maxLocalAppScenarioJobReasonBytes+1),
	}); err == nil {
		t.Fatal("oversized reason detail passed the local-app job projection")
	}
	projected, err := projectLocalAppScenarioJob(&runtimev1.ScenarioJob{
		JobId: "job-2", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED,
		Head:          &runtimev1.ScenarioRequestHead{AppId: "nimi.realm-persona-studio", SubjectUserId: "account-1"},
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL, ModelResolved: "private-model",
		ProviderJobId: "provider-job", TraceId: "trace-2",
	})
	if err != nil {
		t.Fatalf("project job: %v", err)
	}
	if projected.GetJobId() != "job-2" || projected.GetTraceId() != "trace-2" ||
		projected.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED {
		t.Fatalf("job projection = %+v", projected)
	}
}
