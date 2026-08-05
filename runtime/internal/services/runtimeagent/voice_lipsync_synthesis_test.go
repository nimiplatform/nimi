package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc"
)

func TestSyntheticVoiceLipsyncSynthesizerProducesMonotonicFrames(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-001",
		MessageID: "message-001",
		Text:      "Hello world this is a synthetic lipsync line.",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if !strings.HasPrefix(out.AudioArtifactID, syntheticVoiceArtifactScheme+"/turn-001") {
		t.Fatalf("audio artifact id missing synthetic prefix or turn id: %q", out.AudioArtifactID)
	}
	if out.AudioMimeType != syntheticVoiceMimeType {
		t.Fatalf("audio mime type expected %s, got %s", syntheticVoiceMimeType, out.AudioMimeType)
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected non-empty synthetic frame batch")
	}
	if out.DurationMs <= 0 {
		t.Fatalf("expected positive duration_ms, got %d", out.DurationMs)
	}
	if out.VoiceRouteBinding != nil {
		t.Fatalf("did not expect voice route binding without default voice reference, got %+v", out.VoiceRouteBinding)
	}

	var prevSeq uint64
	var prevOffset int64 = -1
	for i, frame := range out.Frames {
		if frame.FrameSequence != uint64(i+1) {
			t.Fatalf("frame[%d] sequence expected %d, got %d", i, i+1, frame.FrameSequence)
		}
		if frame.FrameSequence <= prevSeq {
			t.Fatalf("frame[%d] sequence not monotonic: %d <= %d", i, frame.FrameSequence, prevSeq)
		}
		if frame.OffsetMs < prevOffset {
			t.Fatalf("frame[%d] offset_ms not monotonic: %d < %d", i, frame.OffsetMs, prevOffset)
		}
		if frame.DurationMs != syntheticLipsyncFrameDurationMs {
			t.Fatalf("frame[%d] duration expected %d, got %d", i, syntheticLipsyncFrameDurationMs, frame.DurationMs)
		}
		if frame.MouthOpenY < 0 || frame.MouthOpenY > 1 {
			t.Fatalf("frame[%d] mouth_open_y out of [0,1]: %f", i, frame.MouthOpenY)
		}
		if frame.AudioLevel < 0 || frame.AudioLevel > 1 {
			t.Fatalf("frame[%d] audio_level out of [0,1]: %f", i, frame.AudioLevel)
		}
		prevSeq = frame.FrameSequence
		prevOffset = frame.OffsetMs
	}

	// Spec downstream check: the projection builder MUST accept this output unchanged.
	detail, err := publicChatBuildLipsyncFrameBatchDetail(publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: out.AudioArtifactID,
		Frames:          out.Frames,
	})
	if err != nil {
		t.Fatalf("projection rejected synthesized frames: %v", err)
	}
	frames, ok := detail["frames"].([]any)
	if !ok || len(frames) != len(out.Frames) {
		t.Fatalf("projection frames mismatch: got %v", detail["frames"])
	}
}

func TestSyntheticVoiceLipsyncSynthesizerCannotProjectPlayableVoiceRequest(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:                "turn-voice-route",
		MessageID:             "message-voice-route",
		Text:                  "Voice route binding must remain explicit.",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if out.VoiceRouteBinding == nil {
		t.Fatalf("expected unbound voice route binding for reviewed voice reference")
	}
	if got := out.VoiceRouteBinding.Capability; got != "audio.synthesize" {
		t.Fatalf("voice route capability = %q", got)
	}
	if got := out.VoiceRouteBinding.VoiceReferenceKind; got != "preset_voice_id" {
		t.Fatalf("voice reference kind = %q", got)
	}
	if got := out.VoiceRouteBinding.VoiceReferenceValue; got != "zh_narrator" {
		t.Fatalf("voice reference value = %q", got)
	}
	if got := out.VoiceRouteBinding.SynthesisMode; got != "synthetic_lipsync_only" {
		t.Fatalf("synthesis mode = %q", got)
	}
	if got := out.VoiceRouteBinding.Status; got != "unbound" {
		t.Fatalf("voice route status = %q", got)
	}
	if got := out.VoiceRouteBinding.Reason; got != "tts_provider_route_not_bound" {
		t.Fatalf("voice route reason = %q", got)
	}
	_, err = publicChatBuildVoicePlaybackDetail(publicChatVoicePlaybackProjection{
		AudioArtifactID:       out.AudioArtifactID,
		AudioMimeType:         out.AudioMimeType,
		DurationMs:            out.DurationMs,
		PlaybackState:         "requested",
		DefaultVoiceReference: out.DefaultVoiceReference,
		VoiceRouteBinding:     out.VoiceRouteBinding,
	})
	if err == nil {
		t.Fatalf("synthetic lipsync output must not project a playable voice request")
	}
}

func TestSyntheticVoiceLipsyncSynthesizerSkipsEmptyInputs(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()

	cases := []voiceLipsyncSynthesisInput{
		{TurnID: "", MessageID: "m", Text: "hi"},
		{TurnID: "t", MessageID: "m", Text: ""},
		{TurnID: "t", MessageID: "m", Text: "   "},
	}
	for i, input := range cases {
		out, err := synth.synthesize(input)
		if err != nil {
			t.Fatalf("case[%d]: unexpected error %v", i, err)
		}
		if out.AudioArtifactID != "" || out.AudioMimeType != "" || len(out.Frames) != 0 || out.DurationMs != 0 {
			t.Fatalf("case[%d]: expected zero-value output for empty input, got %+v", i, out)
		}
	}
}

func TestAIBackedVoiceLipsyncSynthesizerSubmitsSpeechSynthesisJob(t *testing.T) {
	t.Parallel()
	ai := &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-voice-001",
		modelResolved: "speech/qwen3tts-ready",
		artifact: &runtimev1.ScenarioArtifact{
			ArtifactId: "artifact-provider-voice-001",
			MimeType:   "audio/wav",
		},
	}
	synth := newAIBackedVoiceLipsyncSynthesizer(ai, "speech/qwen3tts", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		Context:               context.Background(),
		TurnID:                "turn-provider-voice",
		MessageID:             "message-provider-voice",
		Text:                  "Provider speech should own the audio artifact.",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
		SpeechTargetRef:       publicChatTestLocalRuntimeTargetRef("local-runtime:speech/qwen3tts"),
		AgentID:               "agent-provider-voice",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if ai.submitReq == nil {
		t.Fatalf("expected SubmitScenarioJob request")
	}
	if got := ai.submitReq.GetScenarioType(); got != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		t.Fatalf("scenario type = %v", got)
	}
	intent, ok := executionintent.FromContext(ai.submitCtx)
	if !ok || !intent.IsLocal() || intent.CapabilityContract != "audio.synthesize" {
		t.Fatalf("private speech intent = %+v, ok=%v", intent, ok)
	}
	spec := ai.submitReq.GetSpec().GetSpeechSynthesize()
	if spec == nil {
		t.Fatalf("expected speech synthesize spec")
	}
	if got := strings.TrimSpace(spec.GetText()); got == "" {
		t.Fatalf("expected non-empty speech text")
	}
	if got := spec.GetVoiceRef().GetPresetVoiceId(); got != "zh_narrator" {
		t.Fatalf("preset voice id = %q", got)
	}
	if out.AudioArtifactID != "artifact-provider-voice-001" {
		t.Fatalf("audio artifact id = %q", out.AudioArtifactID)
	}
	if out.AudioMimeType != "audio/wav" {
		t.Fatalf("audio mime type = %q", out.AudioMimeType)
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected synthetic lipsync frames for provider audio")
	}
	if out.VoiceRouteBinding == nil {
		t.Fatalf("expected provider route binding")
	}
	if got := out.VoiceRouteBinding.Status; got != "bound" {
		t.Fatalf("route status = %q", got)
	}
	if got := out.VoiceRouteBinding.SynthesisMode; got != "provider_audio_with_synthetic_lipsync" {
		t.Fatalf("synthesis mode = %q", got)
	}
	if got := out.VoiceRouteBinding.ModelResolved; got != "speech/qwen3tts-ready" {
		t.Fatalf("model resolved = %q", got)
	}
	if got := out.VoiceRouteBinding.ScenarioJobID; got != "job-voice-001" {
		t.Fatalf("scenario job id = %q", got)
	}
}

func TestSyntheticVoiceLipsyncSynthesizerRespectsMaxFrameCap(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()
	longText := strings.Repeat("hello world ", 400)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-long",
		MessageID: "m-long",
		Text:      longText,
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if len(out.Frames) > syntheticLipsyncMaxFrames {
		t.Fatalf("expected frame count <= %d, got %d", syntheticLipsyncMaxFrames, len(out.Frames))
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected non-empty frame batch on long input")
	}
}

func TestSyntheticVoiceLipsyncSynthesizerInstalledOnService(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if svc.voiceLipsync == nil {
		t.Fatalf("expected runtime Service to inject a default voiceLipsync synthesizer")
	}
	out, err := svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-svc",
		MessageID: "msg-svc",
		Text:      "hello from service",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected synthesizer to produce frames via Service injection")
	}
}

func TestServiceVoiceLipsyncScenarioExecutorRequiresExplicitModel(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	ai := &fakeVoiceLipsyncScenarioExecutor{jobID: "job-service-voice"}
	svc.SetVoiceLipsyncScenarioExecutor(ai, " ", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err := svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-service-fallback",
		MessageID: "message-service-fallback",
		Text:      "Missing speech model must stay text-only.",
	})
	if err != nil {
		t.Fatalf("synthesize without model: %v", err)
	}
	if ai.submitReq != nil {
		t.Fatalf("did not expect provider submit without explicit speech model")
	}
	if strings.TrimSpace(out.AudioArtifactID) != "" || len(out.Frames) != 0 {
		t.Fatalf("missing speech model must not fabricate voice output, got %+v", out)
	}

	ai = &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-service-voice-bound",
		modelResolved: "speech/qwen3tts-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: "artifact-service-voice-bound", MimeType: "audio/wav"},
	}
	svc.SetVoiceLipsyncScenarioExecutor(ai, "speech/qwen3tts", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err = svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		Context:               context.Background(),
		TurnID:                "turn-service-bound",
		MessageID:             "message-service-bound",
		Text:                  "Explicit speech model may bind provider audio.",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
	})
	if err != nil {
		t.Fatalf("synthesize provider: %v", err)
	}
	if ai.submitReq == nil {
		t.Fatalf("expected provider submit with explicit speech model")
	}
	if out.VoiceRouteBinding == nil || out.VoiceRouteBinding.Status != "bound" {
		t.Fatalf("expected bound voice route, got %+v", out.VoiceRouteBinding)
	}

	ai = &fakeVoiceLipsyncScenarioExecutor{
		jobID:         "job-service-voice-anchor-bound",
		modelResolved: "speech/anchor-ready",
		artifact:      &runtimev1.ScenarioArtifact{ArtifactId: "artifact-service-voice-anchor-bound", MimeType: "audio/wav"},
	}
	svc.SetVoiceLipsyncScenarioExecutor(ai, "", runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED)
	out, err = svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		Context:               context.Background(),
		TurnID:                "turn-service-anchor-bound",
		MessageID:             "message-service-anchor-bound",
		Text:                  "Anchor speech route may bind provider audio without a service default model.",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
		SpeechModelID:         "speech/anchor",
		SpeechRoutePolicy:     runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		SpeechTargetRef: &runtimeidentity.Target{Cloud: &runtimeidentity.CloudTarget{
			ConnectorID: "connector-anchor", RemoteModelCatalogID: "catalog-anchor",
			ProviderModelID: "speech/anchor", Provider: "provider-anchor",
		}},
	})
	if err != nil {
		t.Fatalf("synthesize anchor provider: %v", err)
	}
	if ai.submitReq == nil {
		t.Fatalf("expected provider submit with anchor speech model")
	}
	intent, ok := executionintent.FromContext(ai.submitCtx)
	if !ok || !intent.IsCloud() || intent.CloudTarget.ProviderModelID != "speech/anchor" {
		t.Fatalf("anchor private Cloud intent = %+v, ok=%v", intent, ok)
	}
	if out.VoiceRouteBinding == nil || out.VoiceRouteBinding.ModelID != "speech/anchor" {
		t.Fatalf("expected anchor model route binding, got %+v", out.VoiceRouteBinding)
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
	modelResolved string
	artifact      *runtimev1.ScenarioArtifact
}

func (f *fakeVoiceLipsyncScenarioExecutor) SubmitScenarioJob(ctx context.Context, req *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error) {
	f.submitReq = req
	f.submitCtx = ctx
	return &runtimev1.SubmitScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         f.jobID,
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *fakeVoiceLipsyncScenarioExecutor) GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error) {
	return &runtimev1.GetScenarioJobResponse{
		Job: &runtimev1.ScenarioJob{
			JobId:         f.jobID,
			Status:        runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			ModelResolved: f.modelResolved,
		},
	}, nil
}

func (f *fakeVoiceLipsyncScenarioExecutor) GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error) {
	return &runtimev1.GetScenarioArtifactsResponse{
		JobId:     f.jobID,
		Artifacts: []*runtimev1.ScenarioArtifact{f.artifact},
	}, nil
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

func TestAIBackedVoiceLipsyncSynthesizerSkipsWithoutModel(t *testing.T) {
	t.Parallel()
	ai := &fakeVoiceLipsyncScenarioExecutor{jobID: "job-unused"}
	synth := newAIBackedVoiceLipsyncSynthesizer(ai, " ", runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-fallback",
		MessageID: "message-fallback",
		Text:      "No speech model means no provider route.",
	})
	if err != nil {
		t.Fatalf("synthesize without model: %v", err)
	}
	if ai.submitReq != nil {
		t.Fatalf("did not expect provider submit without explicit model")
	}
	if strings.TrimSpace(out.AudioArtifactID) != "" || len(out.Frames) != 0 {
		t.Fatalf("missing speech model must not fabricate voice output, got %+v", out)
	}
}

func TestProviderVoiceRouteBindingProjectsTimelineDetail(t *testing.T) {
	t.Parallel()
	binding := providerVoiceRouteBinding(
		"preset_voice_id:zh_narrator",
		"speech/qwen3tts",
		"speech/qwen3tts-ready",
		"job-voice-001",
		"artifact-provider-voice-001",
		"audio/wav",
	)
	detail, err := publicChatBuildVoicePlaybackDetail(publicChatVoicePlaybackProjection{
		AudioArtifactID:       "artifact-provider-voice-001",
		AudioMimeType:         "audio/wav",
		DurationMs:            int64(time.Second / time.Millisecond),
		PlaybackState:         "requested",
		VoiceOutputMode:       "batch_final_artifact",
		VoicePlaybackState:    "active",
		DefaultVoiceReference: "preset_voice_id:zh_narrator",
		VoiceRouteBinding:     binding,
	})
	if err != nil {
		t.Fatalf("build voice playback detail: %v", err)
	}
	projected, ok := detail["voice_route_binding"].(map[string]any)
	if !ok {
		t.Fatalf("expected voice_route_binding detail, got %v", detail)
	}
	if got := strings.TrimSpace(projected["status"].(string)); got != "bound" {
		t.Fatalf("status = %q", got)
	}
	if got := strings.TrimSpace(projected["model_resolved"].(string)); got != "speech/qwen3tts-ready" {
		t.Fatalf("model_resolved = %q", got)
	}
	if got := strings.TrimSpace(projected["scenario_job_id"].(string)); got != "job-voice-001" {
		t.Fatalf("scenario_job_id = %q", got)
	}
}
