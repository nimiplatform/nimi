package runtimeagent

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

// Voice/lipsync synthesis adapter for committed assistant turns.
//
// Per spec K-AGCORE-051 and K-VOICE-018, runtime owns whether voice/lipsync
// projection is emitted, and it may emit playable voice only after policy and
// provider audio resolve. This file keeps a deterministic frame generator for
// tests and local frame math; it is not a playable voice fallback.
//
// The synthetic adapter does NOT produce audio bytes. It produces:
//   - audio_artifact_id with `synthetic://lipsync/<turn_id>` prefix so
//     callers can detect frame-only output and fail-close audio playback.
//   - audio_mime_type = `application/x-nimi-synthetic-lipsync` (clearly
//     non-audio MIME) so any client treating it as audio fails closed.
//   - frame timing derived from character cadence (~14 chars/sec) and a
//     per-syllable open/close envelope so the avatar gets visually plausible
//     mouth movement aligned with the committed text length.

const (
	syntheticVoiceArtifactScheme = "synthetic://lipsync"
	syntheticVoiceMimeType       = "application/x-nimi-synthetic-lipsync"

	syntheticLipsyncFrameDurationMs    int64   = 80
	syntheticLipsyncMinTotalMs         int64   = 600
	syntheticLipsyncCharMs             int64   = 70
	syntheticLipsyncMaxFrames          int     = 256
	syntheticLipsyncEnvelopePeak       float64 = 0.78
	syntheticLipsyncEnvelopeFloor      float64 = 0.04
	syntheticLipsyncWordBoundaryDamp   float64 = 0.32
	syntheticLipsyncPunctuationDampDur int64   = 120

	runtimeAgentVoiceSynthesisAppID      = "runtime.agent.voice_lipsync"
	runtimeAgentVoiceSynthesisSubjectID  = "anonymous"
	defaultLocalVoiceSynthesisJobWait    = 15 * time.Minute
	defaultNonLocalVoiceSynthesisJobWait = 45 * time.Second
	defaultVoiceSynthesisStreamWait      = 45 * time.Second
	defaultProviderVoiceSynthesisPoll    = 50 * time.Millisecond
)

type voiceLipsyncSynthesisInput struct {
	Context               context.Context
	TurnID                string
	MessageID             string
	Text                  string
	DefaultVoiceReference string
	SpeechModelID         string
	SpeechRoutePolicy     runtimev1.RoutePolicy
	SpeechConnectorID     string
	SpeechTargetRef       *runtimeidentity.Target
	SpeechExecutionIntent executionintent.Intent
	SpeechAppID           string
	OwnerUserID           string
	AgentID               string
	IdempotencyKey        string
}

type voiceLipsyncSynthesisOutput struct {
	AudioArtifactID       string
	AudioMimeType         string
	AudioBytes            []byte
	DurationMs            int64
	DefaultVoiceReference string
	VoiceRouteBinding     *voiceRouteBindingProjection
	Frames                []publicChatLipsyncFrameProjection
}

type voiceRouteBindingProjection struct {
	Capability            string
	DefaultVoiceReference string
	VoiceReferenceKind    string
	VoiceReferenceValue   string
	ModelID               string
	ModelResolved         string
	ScenarioJobID         string
	AudioArtifactID       string
	AudioMimeType         string
	SynthesisMode         string
	Status                string
	Reason                string
}

// voiceLipsyncSynthesizer is the runtime-injected adapter contract. Real TTS
// providers MUST also produce frames (mouth_open_y + audio_level per
// K-AGCORE-051) regardless of whether they emit audio bytes.
type voiceLipsyncSynthesizer interface {
	synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error)
}

type syntheticVoiceLipsyncSynthesizer struct{}
type unavailableVoiceLipsyncSynthesizer struct{}

type voiceLipsyncScenarioExecutor interface {
	SubmitScenarioJob(context.Context, *runtimev1.SubmitScenarioJobRequest) (*runtimev1.SubmitScenarioJobResponse, error)
	GetScenarioJob(context.Context, *runtimev1.GetScenarioJobRequest) (*runtimev1.GetScenarioJobResponse, error)
	GetScenarioArtifacts(context.Context, *runtimev1.GetScenarioArtifactsRequest) (*runtimev1.GetScenarioArtifactsResponse, error)
}

type aiBackedVoiceLipsyncSynthesizer struct {
	ai           voiceLipsyncScenarioExecutor
	streamer     publicChatScenarioStreamer
	modelID      string
	routePolicy  runtimev1.RoutePolicy
	pollInterval time.Duration
}

func newSyntheticVoiceLipsyncSynthesizer() syntheticVoiceLipsyncSynthesizer {
	return syntheticVoiceLipsyncSynthesizer{}
}

func newAIBackedVoiceLipsyncSynthesizer(ai voiceLipsyncScenarioExecutor, modelID string, routePolicy runtimev1.RoutePolicy) voiceLipsyncSynthesizer {
	if ai == nil {
		return unavailableVoiceLipsyncSynthesizer{}
	}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		routePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	streamer, _ := ai.(publicChatScenarioStreamer)
	return &aiBackedVoiceLipsyncSynthesizer{
		ai:           ai,
		streamer:     streamer,
		modelID:      strings.TrimSpace(modelID),
		routePolicy:  routePolicy,
		pollInterval: defaultProviderVoiceSynthesisPoll,
	}
}

func (s *Service) SetVoiceLipsyncScenarioExecutor(ai voiceLipsyncScenarioExecutor, modelID string, routePolicy runtimev1.RoutePolicy) {
	if s == nil {
		return
	}
	s.voiceLipsync = newAIBackedVoiceLipsyncSynthesizer(ai, modelID, routePolicy)
}

func (s *Service) HasVoiceLipsyncScenarioExecutor() bool {
	if s == nil || s.voiceLipsync == nil {
		return false
	}
	_, ok := s.voiceLipsync.(*aiBackedVoiceLipsyncSynthesizer)
	return ok
}

func (syntheticVoiceLipsyncSynthesizer) synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
	turnID := strings.TrimSpace(input.TurnID)
	text := strings.TrimSpace(input.Text)
	// Empty text is not a synthesis target — caller should skip emission.
	if turnID == "" || text == "" {
		return voiceLipsyncSynthesisOutput{}, nil
	}

	frames := buildSyntheticLipsyncFrames(text)
	if len(frames) == 0 {
		return voiceLipsyncSynthesisOutput{}, nil
	}

	last := frames[len(frames)-1]
	totalDuration := last.OffsetMs + last.DurationMs

	return voiceLipsyncSynthesisOutput{
		AudioArtifactID:       syntheticVoiceArtifactScheme + "/" + turnID,
		AudioMimeType:         syntheticVoiceMimeType,
		DurationMs:            totalDuration,
		DefaultVoiceReference: strings.TrimSpace(input.DefaultVoiceReference),
		VoiceRouteBinding:     syntheticVoiceRouteBinding(strings.TrimSpace(input.DefaultVoiceReference)),
		Frames:                frames,
	}, nil
}

func (unavailableVoiceLipsyncSynthesizer) synthesize(voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
	return voiceLipsyncSynthesisOutput{}, nil
}

func (s *aiBackedVoiceLipsyncSynthesizer) synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
	if s == nil || s.ai == nil {
		return voiceLipsyncSynthesisOutput{}, nil
	}
	modelID := strings.TrimSpace(input.SpeechModelID)
	if modelID == "" {
		modelID = strings.TrimSpace(s.modelID)
	}
	if modelID == "" {
		return voiceLipsyncSynthesisOutput{}, nil
	}
	routePolicy := input.SpeechRoutePolicy
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		routePolicy = s.routePolicy
	}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
		routePolicy = runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	turnID := strings.TrimSpace(input.TurnID)
	text := strings.TrimSpace(input.Text)
	if turnID == "" || text == "" {
		return voiceLipsyncSynthesisOutput{}, nil
	}
	voiceRef, err := voiceReferenceProtoFromDefaultReference(input.DefaultVoiceReference)
	if err != nil {
		return voiceLipsyncSynthesisOutput{}, err
	}
	ctx := input.Context
	if ctx == nil {
		ctx = context.Background()
	}
	waitTimeout := voiceSynthesisJobWait(routePolicy)
	ctx, cancel := context.WithTimeout(ctx, waitTimeout)
	defer cancel()
	speechAppID := runtimeAgentVoiceSynthesisAppIDForInput(input)
	ownerUserID := runtimeAgentVoiceSynthesisOwnerForInput(input)
	ctx = runtimeAgentVoiceSynthesisContext(ctx, speechAppID, ownerUserID)
	intent := executionintent.Intent{CapabilityContract: "audio.synthesize", Route: routePolicy}
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		intent = executionintent.Clone(input.SpeechExecutionIntent)
		cloudTarget := input.SpeechTargetRef.GetCloud()
		if !intent.IsAIConfigCloud() || intent.CapabilityContract != "audio.synthesize" || cloudTarget == nil ||
			intent.ModelID() != strings.TrimSpace(cloudTarget.GetProviderModelId()) {
			return voiceLipsyncSynthesisOutput{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
	}
	ctx = executionintent.WithIntent(ctx, intent)
	submitResp, err := s.ai.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         speechAppID,
			SubjectUserId: ownerUserID,
			TimeoutMs:     int32(waitTimeout.Milliseconds()),
		},
		ScenarioType:   runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode:  runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		IdempotencyKey: runtimeAgentVoiceLipsyncIdempotencyKey(input),
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text:       text,
					VoiceRef:   voiceRef,
					TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD,
				},
			},
		},
	})
	if err != nil {
		return voiceLipsyncSynthesisOutput{}, err
	}
	jobID := strings.TrimSpace(submitResp.GetJob().GetJobId())
	if jobID == "" {
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("voice synthesis job id is required")
	}
	job, err := s.waitVoiceSynthesisJob(ctx, jobID)
	if err != nil {
		return voiceLipsyncSynthesisOutput{}, err
	}
	artifactsResp, err := s.ai.GetScenarioArtifacts(ctx, &runtimev1.GetScenarioArtifactsRequest{JobId: jobID})
	if err != nil {
		return voiceLipsyncSynthesisOutput{}, err
	}
	artifact := firstVoiceSynthesisArtifact(artifactsResp.GetArtifacts())
	if artifact == nil {
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("voice synthesis job %s completed without artifact", jobID)
	}
	audioArtifactID := strings.TrimSpace(artifact.GetArtifactId())
	audioMimeType := strings.TrimSpace(artifact.GetMimeType())
	if audioArtifactID == "" || audioMimeType == "" {
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("voice synthesis job %s artifact missing id or mime type", jobID)
	}
	frames := buildSyntheticLipsyncFrames(text)
	if len(frames) == 0 {
		return voiceLipsyncSynthesisOutput{}, nil
	}
	last := frames[len(frames)-1]
	return voiceLipsyncSynthesisOutput{
		AudioArtifactID:       audioArtifactID,
		AudioMimeType:         audioMimeType,
		DurationMs:            last.OffsetMs + last.DurationMs,
		DefaultVoiceReference: strings.TrimSpace(input.DefaultVoiceReference),
		VoiceRouteBinding: providerVoiceRouteBinding(
			strings.TrimSpace(input.DefaultVoiceReference),
			modelID,
			strings.TrimSpace(job.GetModelResolved()),
			jobID,
			audioArtifactID,
			audioMimeType,
		),
		Frames: frames,
	}, nil
}

func voiceSynthesisJobWait(routePolicy runtimev1.RoutePolicy) time.Duration {
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return defaultLocalVoiceSynthesisJobWait
	}
	return defaultNonLocalVoiceSynthesisJobWait
}

func cloneVoiceSynthesisTargetRef(input *runtimeidentity.Target) *runtimeidentity.Target {
	return input.Clone()
}

func runtimeAgentVoiceLipsyncIdempotencyKey(input voiceLipsyncSynthesisInput) string {
	if key := strings.TrimSpace(input.IdempotencyKey); key != "" {
		return key
	}
	parts := []string{"runtime-agent-voice-lipsync", strings.TrimSpace(input.TurnID)}
	if messageID := strings.TrimSpace(input.MessageID); messageID != "" {
		parts = append(parts, messageID)
	}
	return strings.Join(parts, ":")
}

func (s *aiBackedVoiceLipsyncSynthesizer) waitVoiceSynthesisJob(ctx context.Context, jobID string) (*runtimev1.ScenarioJob, error) {
	pollInterval := s.pollInterval
	if pollInterval <= 0 {
		pollInterval = defaultProviderVoiceSynthesisPoll
	}
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
			resp, err := s.ai.GetScenarioJob(ctx, &runtimev1.GetScenarioJobRequest{JobId: jobID})
			if err != nil {
				return nil, err
			}
			job := resp.GetJob()
			switch job.GetStatus() {
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED:
				return proto.Clone(job).(*runtimev1.ScenarioJob), nil
			case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
				runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
				return nil, fmt.Errorf("voice synthesis job %s ended with %s: %s", jobID, job.GetStatus().String(), strings.TrimSpace(job.GetReasonDetail()))
			default:
				timer.Reset(pollInterval)
			}
		}
	}
}

func syntheticVoiceRouteBinding(defaultVoiceReference string) *voiceRouteBindingProjection {
	voiceReference := strings.TrimSpace(defaultVoiceReference)
	if voiceReference == "" {
		return nil
	}
	kind, value, ok := strings.Cut(voiceReference, ":")
	kind = strings.TrimSpace(kind)
	value = strings.TrimSpace(value)
	if !ok || kind == "" || value == "" {
		return nil
	}
	return &voiceRouteBindingProjection{
		Capability:            "audio.synthesize",
		DefaultVoiceReference: kind + ":" + value,
		VoiceReferenceKind:    kind,
		VoiceReferenceValue:   value,
		SynthesisMode:         "synthetic_lipsync_only",
		Status:                "unbound",
		Reason:                "tts_provider_route_not_bound",
	}
}

func providerVoiceRouteBinding(defaultVoiceReference string, modelID string, modelResolved string, scenarioJobID string, audioArtifactID string, audioMimeType string) *voiceRouteBindingProjection {
	return providerVoiceRouteBindingWithMode(
		defaultVoiceReference,
		modelID,
		modelResolved,
		scenarioJobID,
		audioArtifactID,
		audioMimeType,
		"provider_audio_with_synthetic_lipsync",
		"tts_provider_route_bound",
	)
}

func providerVoiceRouteBindingWithMode(defaultVoiceReference string, modelID string, modelResolved string, scenarioJobID string, audioArtifactID string, audioMimeType string, synthesisMode string, reason string) *voiceRouteBindingProjection {
	voiceReference := strings.TrimSpace(defaultVoiceReference)
	if voiceReference == "" {
		return nil
	}
	kind, value, ok := strings.Cut(voiceReference, ":")
	kind = strings.TrimSpace(kind)
	value = strings.TrimSpace(value)
	if !ok || kind == "" || value == "" {
		return nil
	}
	return &voiceRouteBindingProjection{
		Capability:            "audio.synthesize",
		DefaultVoiceReference: kind + ":" + value,
		VoiceReferenceKind:    kind,
		VoiceReferenceValue:   value,
		ModelID:               strings.TrimSpace(modelID),
		ModelResolved:         strings.TrimSpace(modelResolved),
		ScenarioJobID:         strings.TrimSpace(scenarioJobID),
		AudioArtifactID:       strings.TrimSpace(audioArtifactID),
		AudioMimeType:         strings.TrimSpace(audioMimeType),
		SynthesisMode:         strings.TrimSpace(synthesisMode),
		Status:                "bound",
		Reason:                strings.TrimSpace(reason),
	}
}

func voiceReferenceProtoFromDefaultReference(defaultVoiceReference string) (*runtimev1.VoiceReference, error) {
	value := strings.TrimSpace(defaultVoiceReference)
	if value == "" {
		return nil, nil
	}
	kind, ref, ok := strings.Cut(value, ":")
	kind = strings.TrimSpace(kind)
	ref = strings.TrimSpace(ref)
	if !ok || kind == "" || ref == "" {
		return nil, fmt.Errorf("invalid default voice reference")
	}
	switch kind {
	case "preset_voice_id":
		return &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
			Reference: &runtimev1.VoiceReference_PresetVoiceId{
				PresetVoiceId: ref,
			},
		}, nil
	case "voice_asset_id":
		return &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: ref,
			},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported default voice reference kind %q", kind)
	}
}

func firstVoiceSynthesisArtifact(artifacts []*runtimev1.ScenarioArtifact) *runtimev1.ScenarioArtifact {
	for _, artifact := range artifacts {
		if artifact == nil {
			continue
		}
		if strings.TrimSpace(artifact.GetArtifactId()) == "" {
			continue
		}
		mimeType := strings.ToLower(strings.TrimSpace(artifact.GetMimeType()))
		if strings.HasPrefix(mimeType, "audio/") {
			return artifact
		}
	}
	return nil
}

func runtimeAgentVoiceSynthesisAppIDForInput(input voiceLipsyncSynthesisInput) string {
	if appID := strings.TrimSpace(input.SpeechAppID); appID != "" {
		return appID
	}
	return runtimeAgentVoiceSynthesisAppID
}

func runtimeAgentVoiceSynthesisOwnerForInput(input voiceLipsyncSynthesisInput) string {
	if ownerUserID := strings.TrimSpace(input.OwnerUserID); ownerUserID != "" {
		return ownerUserID
	}
	return runtimeAgentVoiceSynthesisSubjectID
}

func runtimeAgentVoiceSynthesisContext(parent context.Context, appID string, ownerUserID string) context.Context {
	if parent == nil {
		parent = context.Background()
	}
	md, _ := metadata.FromIncomingContext(parent)
	next := md.Copy()
	if next == nil {
		next = metadata.MD{}
	}
	appID = strings.TrimSpace(appID)
	if appID == "" {
		appID = runtimeAgentVoiceSynthesisAppID
	}
	next.Set("x-nimi-app-id", appID)
	ctx := metadata.NewIncomingContext(parent, next)
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID != "" && ownerUserID != runtimeAgentVoiceSynthesisSubjectID {
		ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: ownerUserID})
	}
	return ctx
}

// buildSyntheticLipsyncFrames returns deterministic mouth-open frames whose
// total length covers the natural cadence of `text`. Each frame is exactly
// `syntheticLipsyncFrameDurationMs` long; mouth_open_y oscillates per syllable
// with envelope dampening on whitespace and punctuation so the avatar visibly
// pauses between words.
func buildSyntheticLipsyncFrames(text string) []publicChatLipsyncFrameProjection {
	visibleChars := countVisibleChars(text)
	if visibleChars == 0 {
		return nil
	}

	totalMs := int64(visibleChars) * syntheticLipsyncCharMs
	if totalMs < syntheticLipsyncMinTotalMs {
		totalMs = syntheticLipsyncMinTotalMs
	}
	frameCount := int(totalMs / syntheticLipsyncFrameDurationMs)
	if frameCount < 1 {
		frameCount = 1
	}
	if frameCount > syntheticLipsyncMaxFrames {
		frameCount = syntheticLipsyncMaxFrames
	}

	cadence := buildSyllableCadence(text, frameCount)

	frames := make([]publicChatLipsyncFrameProjection, 0, frameCount)
	for i := 0; i < frameCount; i++ {
		offset := int64(i) * syntheticLipsyncFrameDurationMs
		envelope := cadence[i]
		mouthOpen := clampUnit(envelope)
		// audio_level mirrors envelope but slightly compressed so the avatar's
		// audio meter doesn't bottom out on word boundaries.
		audioLevel := clampUnit(envelope*0.85 + 0.05)
		frames = append(frames, publicChatLipsyncFrameProjection{
			FrameSequence: uint64(i + 1),
			OffsetMs:      offset,
			DurationMs:    syntheticLipsyncFrameDurationMs,
			MouthOpenY:    mouthOpen,
			AudioLevel:    audioLevel,
		})
	}
	return frames
}

// buildSyllableCadence produces a per-frame envelope vector. The envelope
// follows a 2.5-Hz syllabic carrier (typical speech rate) with damping at
// word boundaries so the mouth visibly closes on whitespace. The carrier is
// deterministic (no rand) so test fixtures stay reproducible.
func buildSyllableCadence(text string, frameCount int) []float64 {
	envelope := make([]float64, frameCount)
	if frameCount == 0 {
		return envelope
	}
	// Word-boundary mask: indices where the dominant frame phase falls inside
	// a whitespace / punctuation run get damped.
	boundaryMask := buildBoundaryMask(text, frameCount)
	for i := 0; i < frameCount; i++ {
		// 2.5Hz syllabic carrier mapped to frame index. With 80ms per frame,
		// one syllable cycle ≈ 5 frames.
		phase := float64(i) * 2.0 * math.Pi / 5.0
		// Half-rectified sine yields plausible open/close mouth shape.
		base := math.Abs(math.Sin(phase))
		level := syntheticLipsyncEnvelopeFloor + (syntheticLipsyncEnvelopePeak-syntheticLipsyncEnvelopeFloor)*base
		if boundaryMask[i] {
			level = syntheticLipsyncEnvelopeFloor + (level-syntheticLipsyncEnvelopeFloor)*syntheticLipsyncWordBoundaryDamp
		}
		envelope[i] = level
	}
	return envelope
}

// buildBoundaryMask returns a per-frame boolean indicating whether the
// corresponding character run is whitespace or punctuation. Used to dampen
// mouth amplitude on word boundaries in `buildSyllableCadence`.
func buildBoundaryMask(text string, frameCount int) []bool {
	mask := make([]bool, frameCount)
	if frameCount == 0 {
		return mask
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return mask
	}
	for i := 0; i < frameCount; i++ {
		// Map frame i back to a character index proportionally.
		ratio := float64(i) / float64(frameCount)
		idx := int(math.Floor(ratio * float64(len(runes))))
		if idx >= len(runes) {
			idx = len(runes) - 1
		}
		r := runes[idx]
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			mask[i] = true
		}
	}
	return mask
}

func countVisibleChars(text string) int {
	count := 0
	for _, r := range text {
		if unicode.IsSpace(r) {
			continue
		}
		count++
	}
	return count
}

func clampUnit(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
