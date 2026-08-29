package runtimeagent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
)

// Conversation voice synthesis adapter for committed assistant turns.
// Runtime owns only provider-neutral artifact, turn, and timing correlation.
// Decoder/audio clock and lipsync/mouth projection belong to Avatar/Host.

const (
	runtimeAgentVoiceSynthesisAppID      = "runtime.agent.voice_lipsync"
	runtimeAgentVoiceSynthesisSubjectID  = "anonymous"
	defaultLocalVoiceSynthesisJobWait    = 15 * time.Minute
	defaultNonLocalVoiceSynthesisJobWait = 45 * time.Second
	defaultVoiceSynthesisStreamWait      = 45 * time.Second
	defaultProviderVoiceSynthesisPoll    = 50 * time.Millisecond
)

type voiceLipsyncSynthesisInput struct {
	Context                context.Context
	TurnID                 string
	MessageID              string
	Text                   string
	DefaultVoiceReference  string
	SpeechModelID          string
	SpeechRoutePolicy      runtimev1.RoutePolicy
	SpeechConnectorID      string
	SpeechTargetRef        *runtimeidentity.Target
	SpeechExecutionIntent  executionintent.Intent
	SpeechLocalExecution   *localexecution.SelectedLocalExecution
	SpeechLocalIntent      bool
	SpeechRequiredFeatures []string
	SpeechAppID            string
	OwnerUserID            string
	AgentID                string
	IdempotencyKey         string
}

type voiceLipsyncSynthesisOutput struct {
	AudioArtifactID       string
	AudioMimeType         string
	AudioBytes            []byte
	DurationMs            int64
	DefaultVoiceReference string
	VoiceRouteBinding     *voiceRouteBindingProjection
}

type voiceSynthesisJobTerminalError struct {
	jobID        string
	status       runtimev1.ScenarioJobStatus
	reasonCode   runtimev1.ReasonCode
	reasonDetail string
}

func (err *voiceSynthesisJobTerminalError) Error() string {
	if err == nil {
		return "voice synthesis job failed"
	}
	return fmt.Sprintf(
		"voice synthesis job %s ended with %s: %s",
		strings.TrimSpace(err.jobID),
		err.status.String(),
		strings.TrimSpace(err.reasonDetail),
	)
}

func voiceProjectionTerminalReason(err error, fallback string) string {
	var terminalErr *voiceSynthesisJobTerminalError
	if errors.As(err, &terminalErr) {
		if terminalErr.reasonCode != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			return terminalErr.reasonCode.String()
		}
		switch terminalErr.status {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED:
			return "VOICE_SYNTHESIS_CANCELED"
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return "VOICE_SYNTHESIS_TIMEOUT"
		}
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok && reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return reason.String()
	}
	if errors.Is(err, context.Canceled) {
		return "VOICE_SYNTHESIS_CANCELED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "VOICE_SYNTHESIS_TIMEOUT"
	}
	if reason := strings.TrimSpace(fallback); reason != "" {
		return reason
	}
	return "VOICE_SYNTHESIS_FAILED"
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

// voiceLipsyncSynthesizer is the runtime-injected provider-neutral artifact
// adapter. The historical name remains internal during this hard cut; its
// contract carries no renderer or mouth state.
type voiceLipsyncSynthesizer interface {
	synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error)
}

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
	if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		intent := executionintent.Clone(input.SpeechExecutionIntent)
		cloudTarget := input.SpeechTargetRef.GetCloud()
		if !intent.IsAIConfigCloud() || intent.CapabilityContract != "audio.synthesize" || cloudTarget == nil ||
			intent.ModelID() != strings.TrimSpace(cloudTarget.GetProviderModelId()) {
			return voiceLipsyncSynthesisOutput{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
	}
	ctx = withPublicChatExecutionIntent(ctx, publicChatExecutionBinding{
		ModelID:             modelID,
		RoutePolicy:         routePolicy,
		ConnectorID:         strings.TrimSpace(input.SpeechConnectorID),
		TargetRef:           cloneVoiceSynthesisTargetRef(input.SpeechTargetRef),
		ExecutionIntent:     executionintent.Clone(input.SpeechExecutionIntent),
		LocalExecution:      localexecution.CloneSelectedLocalExecution(input.SpeechLocalExecution),
		CapabilityContract:  runtimeAgentAIConfigCapabilityAudioSynthesize,
		RequiredFeatures:    append([]string(nil), input.SpeechRequiredFeatures...),
		LocalAIConfigIntent: input.SpeechLocalIntent,
	}, runtimeAgentAIConfigCapabilityAudioSynthesize)
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
					Text:     text,
					VoiceRef: voiceRef,
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
	durationMs := artifact.GetDurationMs()
	if durationMs < 0 {
		return voiceLipsyncSynthesisOutput{}, fmt.Errorf("voice synthesis job %s artifact has invalid duration", jobID)
	}
	return voiceLipsyncSynthesisOutput{
		AudioArtifactID:       audioArtifactID,
		AudioMimeType:         audioMimeType,
		DurationMs:            durationMs,
		DefaultVoiceReference: strings.TrimSpace(input.DefaultVoiceReference),
		VoiceRouteBinding: providerVoiceRouteBinding(
			strings.TrimSpace(input.DefaultVoiceReference),
			modelID,
			strings.TrimSpace(job.GetModelResolved()),
			jobID,
			audioArtifactID,
			audioMimeType,
		),
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
				return nil, &voiceSynthesisJobTerminalError{
					jobID:        jobID,
					status:       job.GetStatus(),
					reasonCode:   job.GetReasonCode(),
					reasonDetail: strings.TrimSpace(job.GetReasonDetail()),
				}
			default:
				timer.Reset(pollInterval)
			}
		}
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
		"provider_audio_artifact",
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
	// Voice synthesis is a Runtime Agent owner call. Preserve cancellation and
	// the deadline, but do not inherit an outer Desktop/App principal or local
	// App operation decision: those values describe the consumer ingress, not
	// the VoiceAsset-owning App used for this private AI execution.
	var ctx context.Context
	var cancel context.CancelFunc
	if deadline, ok := parent.Deadline(); ok {
		ctx, cancel = context.WithDeadline(context.Background(), deadline)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}
	context.AfterFunc(parent, cancel)
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
	ctx = metadata.NewIncomingContext(ctx, next)
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID != "" && ownerUserID != runtimeAgentVoiceSynthesisSubjectID {
		ctx = authn.WithIdentity(ctx, &authn.Identity{SubjectUserID: ownerUserID})
	}
	return ctx
}
