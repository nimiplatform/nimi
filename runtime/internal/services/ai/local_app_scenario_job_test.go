package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
)

func localAppScenarioJobContext(operation accountservice.LocalAppOperation, capability string) context.Context {
	return localAppScenarioDecisionContext(operation, capability)
}

func localAppScenarioJobContextForSubject(operation accountservice.LocalAppOperation, capability string, subject string) context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID: "account-1", AppID: "nimi.realm-persona-studio", RegisteredAppSubject: subject,
		Operation: operation, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: capability,
	})
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

func TestLocalAppVideoSeedUsesCanonicalRange(t *testing.T) {
	video, err := validateLocalAppVideoGenerationOptions(&runtimev1.LocalAppVideoGenerationOptions{
		Seed: testInt64(-1),
	})
	if err != nil || video.GetSeed() != -1 {
		t.Fatalf("random sentinel projection=%+v error=%v", video, err)
	}
	video, err = validateLocalAppVideoGenerationOptions(&runtimev1.LocalAppVideoGenerationOptions{
		Seed: testInt64(4_294_967_295),
	})
	if err != nil || video.GetSeed() != 4_294_967_295 {
		t.Fatalf("maximum seed projection=%+v error=%v", video, err)
	}
	if _, err := validateLocalAppVideoGenerationOptions(&runtimev1.LocalAppVideoGenerationOptions{
		Seed: testInt64(4_294_967_296),
	}); err == nil {
		t.Fatal("seed above canonical maximum was accepted")
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
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{}}},
		{Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
			Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: strings.Repeat("x", maxLocalAppScenarioVideoContentText+1)}},
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

func TestSubmitLocalAppSpeechJobAcceptsMinimalTypedSpecAndBindsOwner(t *testing.T) {
	svc := newTestService(nil)
	host := &localSpeechHostStub{entered: make(chan struct{}), release: make(chan struct{})}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedSpeechExecutionForTest(
		t,
		capabilitydriver.AudioSynthesizeContract,
		"speech-tts",
	)})
	svc.SetLocalSpeechExecutionHost(host)
	ctx := executionintent.WithIntent(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit),
		executionintent.Intent{
			CapabilityContract: capabilitydriver.AudioSynthesizeContract,
			Route:              runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	)
	response, err := svc.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize{
			SpeechSynthesize: &runtimev1.LocalAppSpeechSynthesizeJobSpec{
				Text:       "Synthesize a short Runtime acceptance sentence.",
				TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_NONE,
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitLocalAppScenarioJob: %v", err)
	}
	if response.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		t.Fatalf("scenario type = %v", response.GetJob().GetScenarioType())
	}
	select {
	case <-host.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("local speech Host was not entered")
	}
	close(host.release)
	job := waitLocalSpeechJobTerminal(t, svc, response.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("job status = %v", job.GetStatus())
	}
	readback, err := svc.GetLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet),
		&runtimev1.GetLocalAppScenarioJobRequest{JobId: response.GetJob().GetJobId()},
	)
	if err != nil {
		t.Fatalf("GetLocalAppScenarioJob: %v", err)
	}
	if readback.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("readback job status = %v", readback.GetJob().GetStatus())
	}
}

func TestSubmitLocalAppScenarioJobVoiceWorkflowWithoutCurrentAccountConnectorFailsClosed(t *testing.T) {
	catalogFixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", "https://example.invalid", Config{})
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1",
		appAIConfig("nimi.realm-persona-studio", cloudVoiceAIConfigIntent(t, catalogFixture.descriptor))); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{
			VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
				Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator voice"}},
			},
		},
	}
	// The wrapper fills target_model_id from a complete Connector-scoped target,
	// so owner spec validation passes and current-account Connector resolution is
	// the first failing boundary. The protected App supplies no execution-route input.
	_, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND)
}

func TestSubmitLocalAppScenarioJobVoiceWorkflowMapsProviderUnauthorizedThroughRemoteHost(t *testing.T) {
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"InvalidApiKey","message":"invalid api key"}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", server.URL, Config{AllowLoopbackEndpoint: true})
	if err := fixture.service.aiConfigStore.Overwrite(context.Background(), "user-001",
		appAIConfig("nimi.realm-persona-studio", cloudVoiceAIConfigIntent(t, fixture.descriptor))); err != nil {
		t.Fatalf("install Cloud App AIConfig: %v", err)
	}
	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "user-001",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "protected-app-principal",
		Operation:            accountservice.LocalAppOperationScenarioJobSubmit,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  localappop.AppOperationIDScenarioJobSubmit,
	})
	response, err := fixture.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{
			VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
				Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
					InstructionText: "warm narrator voice",
					PreviewText:     "Hello from Nimi.",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitLocalAppScenarioJob: %v", err)
	}
	deadline := time.Now().Add(3 * time.Second)
	var job *runtimev1.ScenarioJob
	for time.Now().Before(deadline) {
		job, _ = fixture.service.scenarioJobs.get(response.GetJob().GetJobId())
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("voice workflow status=%s reason=%s detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("provider calls = %d, want exactly one and no fallback", providerCalls.Load())
	}
}

type replaceAIConfigAfterFirstGetStore struct {
	delegate    aiconfig.Store
	replacement *runtimev1.AIConfig
	getCount    atomic.Int32
}

func (s *replaceAIConfigAfterFirstGetStore) Get(
	ctx context.Context,
	accountNamespace string,
	owner *runtimev1.AIConfigOwner,
) (*runtimev1.AIConfig, bool, error) {
	config, found, err := s.delegate.Get(ctx, accountNamespace, owner)
	if err != nil || !found || s.getCount.Add(1) != 1 {
		return config, found, err
	}
	if err := s.delegate.Overwrite(ctx, accountNamespace, s.replacement); err != nil {
		return nil, false, err
	}
	return config, found, nil
}

func (s *replaceAIConfigAfterFirstGetStore) Overwrite(
	ctx context.Context,
	accountNamespace string,
	config *runtimev1.AIConfig,
) error {
	return s.delegate.Overwrite(ctx, accountNamespace, config)
}

func TestSubmitLocalAppScenarioJobVoiceWorkflowUsesOneCapturedAIConfigSnapshot(t *testing.T) {
	var providerCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"InvalidApiKey","message":"invalid api key"}`))
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "dashscope", "qwen3-tts-vd-2026-01-26", server.URL, Config{AllowLoopbackEndpoint: true})
	baseStore := fixture.service.aiConfigStore
	if err := baseStore.Overwrite(context.Background(), "user-001",
		appAIConfig("nimi.realm-persona-studio", cloudVoiceAIConfigIntent(t, fixture.descriptor))); err != nil {
		t.Fatalf("install initial Cloud App AIConfig: %v", err)
	}
	switchingStore := &replaceAIConfigAfterFirstGetStore{
		delegate: baseStore,
		replacement: appAIConfig("nimi.realm-persona-studio",
			localAppAIConfigIntent(capabilitydriver.VoiceCreateContract)),
	}
	fixture.service.aiConfigStore = switchingStore

	ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AccountID:            "user-001",
		AppID:                "nimi.realm-persona-studio",
		RegisteredAppSubject: "protected-app-principal",
		Operation:            accountservice.LocalAppOperationScenarioJobSubmit,
		AuthorityClass:       localappop.AuthorityClassAppAccess,
		OperationCapability:  localappop.AppOperationIDScenarioJobSubmit,
	})
	response, err := fixture.service.SubmitLocalAppScenarioJob(ctx, &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{
			VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
				Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{
					InstructionText: "warm narrator voice",
					PreviewText:     "Hello from the captured Cloud route.",
				}},
			},
		},
	})
	if err != nil {
		t.Fatalf("SubmitLocalAppScenarioJob: %v", err)
	}
	if response == nil || response.GetJob() == nil {
		t.Fatalf("response = %+v, want accepted captured Cloud Job", response)
	}
	if switchingStore.getCount.Load() != 1 {
		t.Fatalf("AIConfig reads = %d, want exactly one", switchingStore.getCount.Load())
	}

	deadline := time.Now().Add(3 * time.Second)
	var job *runtimev1.ScenarioJob
	for time.Now().Before(deadline) {
		job, _ = fixture.service.scenarioJobs.get(response.GetJob().GetJobId())
		if isTerminalScenarioJobStatus(job.GetStatus()) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED ||
		job.GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("captured Cloud workflow status=%s reason=%s detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	if providerCalls.Load() != 1 {
		t.Fatalf("provider calls = %d, want captured Cloud route to execute exactly once", providerCalls.Load())
	}
}

func cloudVoiceAIConfigIntent(t *testing.T, descriptor *runtimev1.ConnectorModelDescriptor) *runtimev1.AIConfigCapabilityIntent {
	t.Helper()
	target, err := structpb.NewStruct(map[string]any{
		"provider":             descriptor.GetProvider(),
		"providerModelId":      descriptor.GetProviderModelId(),
		"remoteModelCatalogId": descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatalf("build Cloud voice target: %v", err)
	}
	return &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "voice.create",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.voice.create.dashscope",
				DriverId:         "nimi.runtime.driver.dashscope",
				DriverDialect:    "provider/media-v1",
			},
			ProviderModelTarget: target,
		}},
	}
}

func TestSubmitLocalAppScenarioJobLocalVoiceWorkflowRequiresSelectedImplementation(t *testing.T) {
	svc := newTestService(nil)
	if err := svc.aiConfigStore.Overwrite(context.Background(), "account-1", &runtimev1.AIConfig{
		Owner:        derivedAppAIConfigOwner("nimi.realm-persona-studio"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localAppAIConfigIntent("voice.create")},
	}); err != nil {
		t.Fatalf("install App AIConfig: %v", err)
	}
	request := &runtimev1.SubmitLocalAppScenarioJobRequest{
		Spec: &runtimev1.SubmitLocalAppScenarioJobRequest_VoiceCreate{
			VoiceCreate: &runtimev1.LocalAppVoiceCreateJobSpec{
				Source: &runtimev1.LocalAppVoiceCreateJobSpec_TextDescription{TextDescription: &runtimev1.VoiceT2VInput{InstructionText: "warm narrator voice"}},
			},
		},
	}
	_, err := svc.SubmitLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit), request)
	assertLocalAppTextCandidateError(t, err, codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
}

func createLocalAppScenarioJobForTest(
	svc *Service,
	jobID string,
	appID string,
	accountID string,
	registeredAppSubject string,
	status runtimev1.ScenarioJobStatus,
) {
	svc.scenarioJobs.createOwned(&runtimev1.ScenarioJob{
		JobId:        jobID,
		Head:         &runtimev1.ScenarioRequestHead{AppId: appID, SubjectUserId: accountID},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       status,
		TraceId:      "trace-" + jobID,
	}, nil, &localAppJobOwner{
		AccountID:            accountID,
		RegisteredAppSubject: registeredAppSubject,
		ProducerAppID:        appID,
	})
}

func TestGetLocalAppScenarioJobProjectsTrimmedJob(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-1", "nimi.realm-persona-studio", "account-1", "principal-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
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
	createLocalAppScenarioJobForTest(svc, "job-other-subject", "nimi.realm-persona-studio", "account-1", "principal-2", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	createLocalAppScenarioJobForTest(svc, "job-other-account", "nimi.realm-persona-studio", "account-2", "principal-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING)
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId: "job-historical", Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.realm-persona-studio", SubjectUserId: "account-1"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING,
	}, nil)
	ctx := localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	_, err := svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-other-subject"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-other-account"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-historical"})
	assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-missing"})
	assertLocalAppTextCandidateError(t, err, codes.NotFound, runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND)
	_, err = svc.GetLocalAppScenarioJob(ctx, &runtimev1.GetLocalAppScenarioJobRequest{JobId: " padded "})
	assertLocalAppTextCandidateError(t, err, codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
}

func TestCancelLocalAppScenarioJobCancelsOwnedJob(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-cancel", "nimi.realm-persona-studio", "account-1", "principal-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED)
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
	createLocalAppScenarioJobForTest(svc, "job-done", "nimi.realm-persona-studio", "account-1", "principal-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED)
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

func TestLocalAppTranscriptionJobProjectsImmutableTextOnGetAndSubscribe(t *testing.T) {
	svc := newTestService(nil)
	svc.scenarioJobs.createOwned(&runtimev1.ScenarioJob{
		JobId: "job-transcribe", Head: &runtimev1.ScenarioRequestHead{AppId: "producer-app", SubjectUserId: "account-1"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, TranscriptionText: "hello from immutable state",
		Artifacts: []*runtimev1.ScenarioArtifact{{ArtifactId: "artifact-transcript", MimeType: "text/plain", SizeBytes: 26}},
	}, nil, &localAppJobOwner{AccountID: "account-1", RegisteredAppSubject: "principal-1", ProducerAppID: "producer-app"})
	response, err := svc.GetLocalAppScenarioJob(
		localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet),
		&runtimev1.GetLocalAppScenarioJobRequest{JobId: "job-transcribe"})
	if err != nil || response.GetJob().GetTranscriptionText() != "hello from immutable state" ||
		len(response.GetJob().GetArtifacts()) != 1 || len(response.GetJob().GetArtifacts()[0].GetBytes()) != 0 {
		t.Fatalf("get transcription projection=%+v err=%v", response, err)
	}
	stream := &mockLocalAppScenarioJobEventStream{
		ctx: localAppScenarioJobContext(accountservice.LocalAppOperationScenarioJobSubscribe, localappop.AppOperationIDScenarioJobSubscribe),
	}
	if err := svc.SubscribeLocalAppScenarioJobEvents(&runtimev1.SubscribeLocalAppScenarioJobEventsRequest{JobId: "job-transcribe"}, stream); err != nil {
		t.Fatal(err)
	}
	if len(stream.events) != 1 || stream.events[0].GetJob().GetTranscriptionText() != "hello from immutable state" {
		t.Fatalf("subscribe transcription projection=%+v", stream.events)
	}
}

func TestLocalAppJobControlRejectsSameAppIDCrossSubjectAndHistoricalOwner(t *testing.T) {
	svc := newTestService(nil)
	createLocalAppScenarioJobForTest(svc, "job-subject-1", "nimi.realm-persona-studio", "account-1", "principal-1", runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED)
	svc.scenarioJobs.create(&runtimev1.ScenarioJob{
		JobId: "job-historical-control", Head: &runtimev1.ScenarioRequestHead{AppId: "nimi.realm-persona-studio", SubjectUserId: "account-1"},
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
	}, nil)
	for _, jobID := range []string{"job-subject-1", "job-historical-control"} {
		_, err := svc.CancelLocalAppScenarioJob(
			localAppScenarioJobContextForSubject(accountservice.LocalAppOperationScenarioJobCancel, localappop.AppOperationIDScenarioJobCancel, "principal-2"),
			&runtimev1.CancelLocalAppScenarioJobRequest{JobId: jobID})
		assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		stream := &mockLocalAppScenarioJobEventStream{
			ctx: localAppScenarioJobContextForSubject(accountservice.LocalAppOperationScenarioJobSubscribe, localappop.AppOperationIDScenarioJobSubscribe, "principal-2"),
		}
		err = svc.SubscribeLocalAppScenarioJobEvents(&runtimev1.SubscribeLocalAppScenarioJobEventsRequest{JobId: jobID}, stream)
		assertLocalAppTextCandidateError(t, err, codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		if len(stream.events) != 0 {
			t.Fatalf("forbidden job %q leaked events: %+v", jobID, stream.events)
		}
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

func TestProjectLocalAppScenarioJobAdmitsCompletedMusicArtifact(t *testing.T) {
	projected, err := projectLocalAppScenarioJob(&runtimev1.ScenarioJob{
		JobId: "job-music", ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId: "trace-music", Artifacts: []*runtimev1.ScenarioArtifact{{
			ArtifactId: "artifact-music", MimeType: "audio/wav", SizeBytes: 3530796,
			Sha256:     "75b32ec1ad1fd80bccb8fb020a726616394412e81ffa3229fd60fcaa98a60db2",
			DurationMs: 20015, SampleRateHz: 44100, Channels: 2,
		}},
	})
	if err != nil {
		t.Fatalf("project completed Music Job: %v", err)
	}
	if projected.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE || len(projected.GetArtifacts()) != 1 || projected.GetArtifacts()[0].GetMimeType() != "audio/wav" {
		t.Fatalf("Music Job projection = %+v", projected)
	}
}
