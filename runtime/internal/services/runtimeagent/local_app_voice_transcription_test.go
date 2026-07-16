package runtimeagent

import (
	"context"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type stubLocalAppVoiceTranscriptionExecutor struct {
	request LocalAppVoiceTranscriptionExecutionRequest
	result  LocalAppVoiceTranscriptionExecutionResult
	err     error
}

func (s *stubLocalAppVoiceTranscriptionExecutor) TranscribeLocalAppVoice(_ context.Context, req LocalAppVoiceTranscriptionExecutionRequest) (LocalAppVoiceTranscriptionExecutionResult, error) {
	s.request = req
	return s.result, s.err
}

func TestTranscribeLocalAppAgentAudioUsesCommittedBindingAndRedactedAudit(t *testing.T) {
	svc := newAgentAIConfigTestService(t)
	auditStore := auditlog.New(128, 128)
	svc.SetAuditStore(auditStore)
	upsertLocalAppVoiceTranscriptionIntent(t, svc)
	executor := &stubLocalAppVoiceTranscriptionExecutor{result: LocalAppVoiceTranscriptionExecutionResult{Transcript: "你好，Nimi。"}}
	svc.SetLocalAppVoiceTranscriptionExecutor(executor)

	audio := []byte("bounded-webm-audio")
	response, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), &runtimev1.TranscribeLocalAppAgentAudioRequest{
		AgentId:        runtimeAgentAIConfigTestLocalRef,
		ClientRequestId: "voice-request-1",
		Audio:          audio,
		MimeType:       "audio/webm;codecs=opus",
	})
	if err != nil {
		t.Fatalf("TranscribeLocalAppAgentAudio: %v", err)
	}
	if response.GetClientRequestId() != "voice-request-1" || response.GetTranscript() != "你好，Nimi。" {
		t.Fatalf("response = %#v", response)
	}
	if executor.request.SubjectUserID != runtimeAgentAIConfigTestOwner || executor.request.MIMEType != "audio/webm" || string(executor.request.Audio) != string(audio) {
		t.Fatalf("bounded executor request = %#v", executor.request)
	}
	if executor.request.Binding.ModelID != "speech/local-asr" || executor.request.Binding.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("committed binding was not used: %#v", executor.request.Binding)
	}
	if executor.request.IdempotencyKey == "" || strings.Contains(executor.request.IdempotencyKey, "voice-request-1") || strings.Contains(executor.request.IdempotencyKey, runtimeAgentAIConfigTestLocalRef) {
		t.Fatalf("idempotency key leaked caller selectors: %q", executor.request.IdempotencyKey)
	}

	events, listErr := auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.agent.local_app_voice"})
	if listErr != nil || len(events.GetEvents()) != 1 {
		t.Fatalf("voice audit = (%#v, %v)", events, listErr)
	}
	record := events.GetEvents()[0]
	if record.GetOperation() != string(accountservice.LocalAppOperationVoiceTranscribe) || record.GetCapability() != "runtime.agent.voice.transcribe" {
		t.Fatalf("voice audit identity = %#v", record)
	}
	fields := record.GetPayload().GetFields()
	if len(fields) != 3 || fields["audio_byte_count"].GetNumberValue() != float64(len(audio)) || fields["transcript_byte_count"].GetNumberValue() != float64(len([]byte("你好，Nimi。"))) || fields["mime_type"].GetStringValue() != "audio/webm" {
		t.Fatalf("voice audit payload = %#v", fields)
	}
	for _, forbidden := range []string{"audio", "transcript", "model_id", "connector_id", "target_ref", "grant_id", "session_id", "client_request_id"} {
		if _, exists := fields[forbidden]; exists {
			t.Fatalf("voice audit exposed forbidden field %q", forbidden)
		}
	}
}

func TestTranscribeLocalAppAgentAudioFailsClosedAtEveryAuthorityBoundary(t *testing.T) {
	svc := newAgentAIConfigTestService(t)
	svc.SetAuditStore(auditlog.New(64, 64))
	valid := &runtimev1.TranscribeLocalAppAgentAudioRequest{
		AgentId: runtimeAgentAIConfigTestLocalRef, ClientRequestId: "voice-request-2", Audio: []byte("audio"), MimeType: "audio/wav",
	}
	if _, err := svc.TranscribeLocalAppAgentAudio(context.Background(), valid); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("missing authorization code = %s err=%v", status.Code(err), err)
	}
	if _, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), valid); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("missing committed binding code = %s err=%v", status.Code(err), err)
	}

	upsertLocalAppVoiceTranscriptionIntent(t, svc)
	svc.SetLocalAppVoiceTranscriptionExecutor(&stubLocalAppVoiceTranscriptionExecutor{err: errors.New("provider secret: should never cross")})
	if _, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), valid); status.Code(err) != codes.Unavailable || strings.Contains(status.Convert(err).Message(), "provider secret") {
		t.Fatalf("provider failure was not redacted: %v", err)
	}
	oversized := proto.Clone(valid).(*runtimev1.TranscribeLocalAppAgentAudioRequest)
	oversized.Audio = make([]byte, maxLocalAppVoiceTranscriptionBytes+1)
	if _, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), oversized); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("oversized audio code = %s err=%v", status.Code(err), err)
	}
	badMIME := proto.Clone(valid).(*runtimev1.TranscribeLocalAppAgentAudioRequest)
	badMIME.MimeType = "audio/aac"
	if _, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), badMIME); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("unadmitted MIME code = %s err=%v", status.Code(err), err)
	}
	svc.SetAuditStore(nil)
	if _, err := svc.TranscribeLocalAppAgentAudio(localAppVoiceTranscriptionTestContext(), valid); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("missing audit store code = %s err=%v", status.Code(err), err)
	}
}

type fakeLocalAppVoiceScenarioExecutor struct {
	submit *runtimev1.SubmitScenarioJobRequest
}

func (f *fakeLocalAppVoiceScenarioExecutor) SubmitScenarioJob(_ context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.submit = proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{JobId: "voice-job-1"}}, nil
}

func (*fakeLocalAppVoiceScenarioExecutor) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{JobId: "voice-job-1", Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED}}, nil
}

func (*fakeLocalAppVoiceScenarioExecutor) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_SpeechTranscribe{
		SpeechTranscribe: &runtimev1.SpeechTranscribeResult{Text: "runtime transcript"},
	}}}, nil
}

func TestAIBackedLocalAppVoiceTranscriptionForcesClosedScenarioShape(t *testing.T) {
	ai := &fakeLocalAppVoiceScenarioExecutor{}
	executor := NewAIBackedLocalAppVoiceTranscriptionExecutor(ai)
	result, err := executor.TranscribeLocalAppVoice(context.Background(), LocalAppVoiceTranscriptionExecutionRequest{
		Binding: publicChatExecutionBinding{
			ModelID: "speech/asr", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD, ConnectorID: "connector-private",
			TargetRef: &runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{Cloud: &runtimev1.RuntimeDurableCloudTargetRef{ConnectorId: "connector-private"}}},
		},
		SubjectUserID: runtimeAgentAIConfigTestOwner,
		Audio: []byte("wav"), MIMEType: "audio/wav", IdempotencyKey: "lavt_v1_hash",
	})
	if err != nil || result.Transcript != "runtime transcript" {
		t.Fatalf("AI-backed transcription = (%#v, %v)", result, err)
	}
	req := ai.submit
	if req == nil || req.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE || req.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB {
		t.Fatalf("scenario identity = %#v", req)
	}
	if req.GetHead().GetAppId() != localAppVoiceTranscriptionAppID || req.GetHead().GetFallback() != runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY || req.GetHead().GetModelId() != "speech/asr" || req.GetHead().GetConnectorId() != "connector-private" {
		t.Fatalf("scenario head = %#v", req.GetHead())
	}
	spec := req.GetSpec().GetSpeechTranscribe()
	if spec.GetMimeType() != "audio/wav" || string(spec.GetAudioSource().GetAudioBytes()) != "wav" || spec.GetLanguage() != "" || spec.GetTimestamps() || spec.GetDiarization() || spec.GetPrompt() != "" || spec.GetResponseFormat() != "" || len(req.GetLabels()) != 0 || len(req.GetExtensions()) != 0 {
		t.Fatalf("scenario widened caller control: req=%#v spec=%#v", req, spec)
	}
}

func upsertLocalAppVoiceTranscriptionIntent(t *testing.T, svc *Service) {
	t.Helper()
	_, err := svc.UpsertRuntimeAgentAIConfig(context.Background(), &runtimev1.UpsertRuntimeAgentAIConfigRequest{
		Context:          agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Intents: requiredRuntimeAgentAIConfigTestIntents(&runtimev1.RuntimeAgentAIConfigIntent{
			Capability: runtimeAgentAIConfigCapabilityAudioTranscribe, ModelId: "speech/local-asr", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		}),
	})
	if err != nil {
		t.Fatalf("UpsertRuntimeAgentAIConfig(audio.transcribe): %v", err)
	}
}

func localAppVoiceTranscriptionTestContext() context.Context {
	return accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{
		AppID: "world.nimi.zhiyu", AccountID: runtimeAgentAIConfigTestOwner, AccountGeneration: 4,
		LocalAppPrincipalID: "lap_v1_zhiyu_voice", LocalAppRecordID: "lar_v1_zhiyu_voice",
		Operation: accountservice.LocalAppOperationVoiceTranscribe, PermissionScope: "runtime.agent.voice.transcribe",
	})
}
