package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestRuntimeAgentVoiceSynthesisContextSeparatesOuterIngressFromOwnerExecution(t *testing.T) {
	invalidated := make(chan struct{})
	transportDone := make(chan struct{})
	principal := protectedprincipal.NewDirectDesktopAccountProduct(
		&runtimev1.AccountProjection{AccountId: "owner-1", RealmEnvironmentId: "test"},
		1,
		invalidated,
		transportDone,
	)
	parent, parentCancel := context.WithCancel(protectedprincipal.With(context.Background(), principal))
	parent = accountservice.ContextWithAuthorizedLocalAppDecision(parent, accountservice.LocalAppCallerDecision{
		AppID: "outer-app", RegisteredAppSubject: "outer-subject",
	})
	ctx := runtimeAgentVoiceSynthesisContext(parent, "voice-owner-app", "owner-1")
	if _, ok := protectedprincipal.AttachedToContext(ctx); ok {
		t.Fatal("Agent-private voice execution inherited the outer protected principal")
	}
	if _, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx); ok {
		t.Fatal("Agent-private voice execution inherited the outer local App decision")
	}
	incoming, _ := metadata.FromIncomingContext(ctx)
	if got := firstString(incoming.Get("x-nimi-app-id")); got != "voice-owner-app" {
		t.Fatalf("owner execution app = %q", got)
	}
	if identity := authn.IdentityFromContext(ctx); identity == nil || identity.SubjectUserID != "owner-1" {
		t.Fatalf("owner execution identity = %#v", identity)
	}
	parentCancel()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("owner execution context did not converge after caller cancellation")
	}
}

func TestUnavailableConversationVoiceSynthesizerDoesNotFabricateArtifact(t *testing.T) {
	out, err := (unavailableVoiceLipsyncSynthesizer{}).synthesize(voiceLipsyncSynthesisInput{
		TurnID: "turn-1", MessageID: "message-1", Text: "No provider is configured.",
	})
	if err != nil || out.AudioArtifactID != "" || out.AudioMimeType != "" || out.DurationMs != 0 {
		t.Fatalf("unavailable voice synthesis = (%+v, %v)", out, err)
	}
}

func TestAIBackedConversationVoiceSynthesizerProjectsArtifactWithoutMouthState(t *testing.T) {
	ai := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-voice-001",
		modelResolved: "speech/qwen3tts-ready",
		artifact: &runtimev1.ScenarioArtifact{
			ArtifactId: "artifact-provider-voice-001",
			MimeType:   "audio/wav",
			DurationMs: 1250,
		},
	}
	synth := newAIBackedVoiceLipsyncSynthesizer(ai, "speech/qwen3tts", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		Context:               context.Background(),
		TurnID:                "turn-provider-voice",
		MessageID:             "message-provider-voice",
		Text:                  "Provider speech owns the audio artifact.",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
		SpeechTargetRef:       publicChatTestLocalRuntimeTargetRef("local-runtime:speech/qwen3tts"),
		AgentID:               "agent-provider-voice",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if ai.submitReq == nil || ai.submitReq.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		t.Fatalf("speech request = %+v", ai.submitReq)
	}
	if got := ai.submitReq.GetSpec().GetSpeechSynthesize().GetVoiceRef().GetPresetVoiceId(); got != "zh_narrator" {
		t.Fatalf("preset voice id = %q", got)
	}
	if out.AudioArtifactID != "artifact-provider-voice-001" || out.AudioMimeType != "audio/wav" || out.DurationMs != 1250 {
		t.Fatalf("voice artifact = %+v", out)
	}
	if out.VoiceRouteBinding == nil || out.VoiceRouteBinding.SynthesisMode != "provider_audio_artifact" {
		t.Fatalf("private route binding = %+v", out.VoiceRouteBinding)
	}
	intent, ok := executionintent.FromContext(ai.submitCtx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "audio.synthesize" {
		t.Fatalf("private speech intent = %+v, ok=%v", intent, ok)
	}
}

func TestAIBackedConversationVoiceSynthesizerSkipsWithoutModel(t *testing.T) {
	ai := &fakeVoiceLipsyncScenarioExecutor{jobID: "job-unused"}
	synth := newAIBackedVoiceLipsyncSynthesizer(ai, " ", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID: "turn-fallback", MessageID: "message-fallback", Text: "No model.",
	})
	if err != nil || ai.submitReq != nil || strings.TrimSpace(out.AudioArtifactID) != "" {
		t.Fatalf("missing model synthesis = (%+v, %v), request=%+v", out, err, ai.submitReq)
	}
}

func TestVoiceSynthesisJobFailurePreservesTypedTerminalReason(t *testing.T) {
	ai := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-voice-load-failed",
		jobStatus:     runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		jobReasonCode: runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED,
		jobReason:     "local execution model load failed",
	}
	synth := &aiBackedVoiceLipsyncSynthesizer{ai: ai, pollInterval: time.Millisecond}
	_, err := synth.waitVoiceSynthesisJob(context.Background(), ai.jobID)
	if err == nil {
		t.Fatal("expected failed voice synthesis Job")
	}
	if got := voiceProjectionTerminalReason(err, "VOICE_SYNTHESIS_FAILED"); got != "AI_LOCAL_EXECUTION_LOAD_FAILED" {
		t.Fatalf("voice terminal reason = %q", got)
	}
}

type fakeVoiceLipsyncScenarioExecutor struct {
	submitReq     *runtimev1.SubmitScenarioJobRequest
	streamReq     *runtimev1.StreamScenarioRequest
	streamEvents  []*runtimev1.StreamScenarioEvent
	streamErr     error
	submitCtx     context.Context
	streamCtx     context.Context
	jobID         string
	jobStatus     runtimev1.ScenarioJobStatus
	jobReasonCode runtimev1.ReasonCode
	jobReason     string
	modelResolved string
	artifact      *runtimev1.ScenarioArtifact
}

func (f *fakeVoiceLipsyncScenarioExecutor) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.submitReq = req
	f.submitCtx = ctx
	return &runtimev1.SubmitScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId: f.jobID, Status: runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ModelResolved: f.modelResolved,
	}}, nil
}

func (f *fakeVoiceLipsyncScenarioExecutor) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	state := f.jobStatus
	if state == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		state = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED
	}
	return &runtimev1.GetScenarioJobResponse{Job: &runtimev1.ScenarioJob{
		JobId: f.jobID, Status: state, ReasonCode: f.jobReasonCode,
		ReasonDetail: f.jobReason, ModelResolved: f.modelResolved,
	}}, nil
}

func (f *fakeVoiceLipsyncScenarioExecutor) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{JobId: f.jobID, Artifacts: []*runtimev1.ScenarioArtifact{f.artifact}}, nil
}

func (f *fakeVoiceLipsyncScenarioExecutor) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	f.streamReq = req
	f.streamCtx = stream.Context()
	for _, event := range f.streamEvents {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	return f.streamErr
}
