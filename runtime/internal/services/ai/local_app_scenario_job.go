package ai

import (
	"context"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

const (
	maxLocalAppScenarioJobReasonBytes    = 1024
	maxLocalAppScenarioCancelReasonBytes = 512
	maxLocalAppScenarioReferenceURIBytes = 2048
	maxLocalAppScenarioVideoContentItems = 8
	maxLocalAppScenarioVideoContentText  = 8 * 1024
	maxLocalAppScenarioVoiceHintCount    = 8
	maxLocalAppScenarioVoiceHintBytes    = 64
	maxLocalAppScenarioVoiceNameBytes    = 256
	maxLocalAppScenarioTranscribePrompt  = 4 * 1024
	maxLocalAppScenarioInlineAudioBytes  = 32 * 1024 * 1024
)

// SubmitLocalAppScenarioJob preserves the third-party Local App async Job
// contract while delegating route composition, scheduling, Driver mapping,
// metering, and execution to the Scenario Job owner. The App supplies a
// closed-set Job spec only: no route, implementation, target, grant, model,
// tool, stream, idempotency, or label field. Voice workflow target model
// identity is derived from the committed AIConfig intent, never from the App.
func (s *Service) SubmitLocalAppScenarioJob(ctx context.Context, req *runtimev1.SubmitLocalAppScenarioJobRequest) (*runtimev1.SubmitLocalAppScenarioJobResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationScenarioJobSubmit, localappop.AppOperationIDScenarioJobSubmit)
	if err != nil {
		return nil, err
	}
	ownerSpec, scenarioType, err := validateLocalAppScenarioJobRequest(req)
	if err != nil {
		return nil, err
	}
	head := localAppScenarioHead(decision)
	if scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE ||
		scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN {
		_, intent, err := s.captureScenarioExecutionIntent(ctx, head, scenarioTargetCapability(scenarioType))
		if err != nil {
			return nil, err
		}
		if intent.IsLocal() {
			return nil, localExactMediaUnsupportedError(scenarioType)
		}
		modelID := intent.ModelID()
		if modelID == "" {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
		}
		switch spec := ownerSpec.GetSpec().(type) {
		case *runtimev1.ScenarioSpec_VoiceClone:
			spec.VoiceClone.TargetModelId = modelID
		case *runtimev1.ScenarioSpec_VoiceDesign:
			spec.VoiceDesign.TargetModelId = modelID
		}
	}
	result, err := s.SubmitScenarioJob(localAppOwnerCallContext(ctx, decision), &runtimev1.SubmitScenarioJobRequest{
		Head:          head,
		ScenarioType:  scenarioType,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec:          ownerSpec,
	})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	job, err := projectLocalAppScenarioJob(result.GetJob())
	if err != nil {
		return nil, err
	}
	response := &runtimev1.SubmitLocalAppScenarioJobResponse{Job: job}
	if result.GetAsset() != nil {
		asset, err := projectLocalAppVoiceAsset(result.GetAsset())
		if err != nil {
			return nil, err
		}
		response.Asset = asset
	}
	return response, nil
}

// GetLocalAppScenarioJob returns the trimmed Job projection for a Job owned by
// the calling App session owner; the Scenario Job owner enforces the exact
// owner match and cross-owner access fails closed.
func (s *Service) GetLocalAppScenarioJob(ctx context.Context, req *runtimev1.GetLocalAppScenarioJobRequest) (*runtimev1.GetLocalAppScenarioJobResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationScenarioJobGet, localappop.AppOperationIDScenarioJobGet)
	if err != nil {
		return nil, err
	}
	jobID, err := validateLocalAppScenarioJobID(req.GetJobId())
	if err != nil {
		return nil, err
	}
	result, err := s.GetScenarioJob(localAppOwnerCallContext(ctx, decision), &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	job, err := projectLocalAppScenarioJob(result.GetJob())
	if err != nil {
		return nil, err
	}
	return &runtimev1.GetLocalAppScenarioJobResponse{Job: job}, nil
}

// CancelLocalAppScenarioJob requests cancellation of a Job owned by the
// calling App session owner through the Scenario Job owner cancel path.
func (s *Service) CancelLocalAppScenarioJob(ctx context.Context, req *runtimev1.CancelLocalAppScenarioJobRequest) (*runtimev1.CancelLocalAppScenarioJobResponse, error) {
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationScenarioJobCancel, localappop.AppOperationIDScenarioJobCancel)
	if err != nil {
		return nil, err
	}
	jobID, err := validateLocalAppScenarioJobID(req.GetJobId())
	if err != nil {
		return nil, err
	}
	if !localAppOptionalExactText(req.GetReason(), maxLocalAppScenarioCancelReasonBytes) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	result, err := s.CancelScenarioJob(localAppOwnerCallContext(ctx, decision), &runtimev1.CancelScenarioJobRequest{JobId: jobID, Reason: req.GetReason()})
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	job, err := projectLocalAppScenarioJob(result.GetJob())
	if err != nil {
		return nil, err
	}
	return &runtimev1.CancelLocalAppScenarioJobResponse{Job: job}, nil
}

// SubscribeLocalAppScenarioJobEvents streams trimmed Job projections for a Job
// owned by the calling App session owner until the terminal event; backpressure
// and replay stay with the Scenario Job owner subscription.
func (s *Service) SubscribeLocalAppScenarioJobEvents(req *runtimev1.SubscribeLocalAppScenarioJobEventsRequest, stream grpc.ServerStreamingServer[runtimev1.LocalAppScenarioJobEvent]) error {
	decision, err := localAppScenarioDecision(stream.Context(), accountservice.LocalAppOperationScenarioJobSubscribe, localappop.AppOperationIDScenarioJobSubscribe)
	if err != nil {
		return err
	}
	jobID, err := validateLocalAppScenarioJobID(req.GetJobId())
	if err != nil {
		return err
	}
	bridge := &localAppScenarioJobEventBridge{
		ServerStreamingServer: stream,
		ctx:                   localAppOwnerCallContext(stream.Context(), decision),
	}
	return s.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{JobId: jobID}, bridge)
}

// localAppScenarioJobEventBridge adapts the owner ScenarioJobEvent stream to
// the trimmed Local App event stream. Context carries the session-derived
// owner identity so the owner subscription authorizes the exact owner match.
type localAppScenarioJobEventBridge struct {
	grpc.ServerStreamingServer[runtimev1.LocalAppScenarioJobEvent]
	ctx context.Context
}

func (b *localAppScenarioJobEventBridge) Context() context.Context { return b.ctx }

func (b *localAppScenarioJobEventBridge) Send(event *runtimev1.ScenarioJobEvent) error {
	projected, err := projectLocalAppScenarioJobEvent(event)
	if err != nil {
		return err
	}
	return b.ServerStreamingServer.Send(projected)
}

func validateLocalAppScenarioJobID(jobID string) (string, error) {
	if !localAppBoundedIdentifier(jobID) {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return jobID, nil
}

// projectLocalAppScenarioJob trims an owner ScenarioJob to the Local App
// projection: status, progress, typed reason, artifact summaries, and trace
// correlation only. Head, route, model, provider, usage, label, and extension
// fields never cross this boundary; unexpected owner shapes fail closed.
func projectLocalAppScenarioJob(job *runtimev1.ScenarioJob) (*runtimev1.LocalAppScenarioJob, error) {
	invalid := func() (*runtimev1.LocalAppScenarioJob, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if job == nil || !localAppBoundedIdentifier(job.GetJobId()) {
		return invalid()
	}
	switch job.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE,
		runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
	default:
		return invalid()
	}
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_UNSPECIFIED {
		return invalid()
	}
	if job.GetProgressPercent() < 0 || job.GetProgressPercent() > 100 ||
		job.GetProgressCurrentStep() < 0 || job.GetProgressTotalSteps() < 0 {
		return invalid()
	}
	if !localAppOptionalExactText(job.GetReasonDetail(), maxLocalAppScenarioJobReasonBytes) {
		return invalid()
	}
	if !localAppOptionalExactText(job.GetTraceId(), maxLocalAppTraceIDBytes) {
		return invalid()
	}
	transcriptionText := job.GetTranscriptionText()
	if !localAppOptionalExactText(transcriptionText, maxLocalAppTranscriptionTextBytes) ||
		(job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE && transcriptionText != "") {
		return invalid()
	}
	var artifacts []*runtimev1.LocalAppScenarioArtifact
	if len(job.GetArtifacts()) > 0 {
		projected, err := projectLocalAppScenarioArtifacts(job.GetArtifacts())
		if err != nil {
			return nil, err
		}
		artifacts = projected
	}
	return &runtimev1.LocalAppScenarioJob{
		JobId:               job.GetJobId(),
		ScenarioType:        job.GetScenarioType(),
		Status:              job.GetStatus(),
		ProgressPercent:     job.GetProgressPercent(),
		ProgressCurrentStep: job.GetProgressCurrentStep(),
		ProgressTotalSteps:  job.GetProgressTotalSteps(),
		ReasonCode:          job.GetReasonCode(),
		ReasonDetail:        job.GetReasonDetail(),
		Artifacts:           artifacts,
		TraceId:             job.GetTraceId(),
		CreatedAt:           job.GetCreatedAt(),
		UpdatedAt:           job.GetUpdatedAt(),
		TranscriptionText:   transcriptionText,
	}, nil
}

func projectLocalAppScenarioJobEvent(event *runtimev1.ScenarioJobEvent) (*runtimev1.LocalAppScenarioJobEvent, error) {
	if event == nil || event.GetEventType() == runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !localAppOptionalExactText(event.GetTraceId(), maxLocalAppTraceIDBytes) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	job, err := projectLocalAppScenarioJob(event.GetJob())
	if err != nil {
		return nil, err
	}
	return &runtimev1.LocalAppScenarioJobEvent{
		EventType: event.GetEventType(),
		Sequence:  event.GetSequence(),
		TraceId:   event.GetTraceId(),
		Timestamp: event.GetTimestamp(),
		Job:       job,
	}, nil
}

// projectLocalAppVoiceAsset trims an owner VoiceAsset to the Local App catalog
// projection. Provider, model, provider voice ref, owner identity, and
// free-form metadata fields never cross this boundary.
func projectLocalAppVoiceAsset(asset *runtimev1.VoiceAsset) (*runtimev1.LocalAppVoiceAsset, error) {
	invalid := func() (*runtimev1.LocalAppVoiceAsset, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if asset == nil || !localAppBoundedIdentifier(asset.GetVoiceAssetId()) {
		return invalid()
	}
	switch asset.GetWorkflowType() {
	case runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_CLONE,
		runtimev1.VoiceWorkflowType_VOICE_WORKFLOW_TYPE_VOICE_DESIGN:
	default:
		return invalid()
	}
	if asset.GetStatus() == runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED {
		return invalid()
	}
	return &runtimev1.LocalAppVoiceAsset{
		VoiceAssetId: asset.GetVoiceAssetId(),
		WorkflowType: asset.GetWorkflowType(),
		Status:       asset.GetStatus(),
		CreatedAt:    asset.GetCreatedAt(),
		UpdatedAt:    asset.GetUpdatedAt(),
		ExpiresAt:    asset.GetExpiresAt(),
	}, nil
}

func validateLocalAppScenarioJobRequest(req *runtimev1.SubmitLocalAppScenarioJobRequest) (*runtimev1.ScenarioSpec, runtimev1.ScenarioType, error) {
	if req == nil || req.GetSpec() == nil {
		return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	switch spec := req.GetSpec().(type) {
	case *runtimev1.SubmitLocalAppScenarioJobRequest_ImageGenerate:
		image, err := validateLocalAppImageGenerateSpec(spec.ImageGenerate)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{
			ImageGenerate: image,
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, nil
	case *runtimev1.SubmitLocalAppScenarioJobRequest_VideoGenerate:
		video, err := validateLocalAppVideoGenerateJobSpec(spec.VideoGenerate)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{
			VideoGenerate: video,
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, nil
	case *runtimev1.SubmitLocalAppScenarioJobRequest_SpeechSynthesize:
		speech, err := validateLocalAppSpeechSynthesizeJobSpec(spec.SpeechSynthesize)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
			SpeechSynthesize: speech,
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, nil
	case *runtimev1.SubmitLocalAppScenarioJobRequest_SpeechTranscribe:
		transcribe, err := validateLocalAppSpeechTranscribeJobSpec(spec.SpeechTranscribe)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
			SpeechTranscribe: transcribe,
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, nil
	case *runtimev1.SubmitLocalAppScenarioJobRequest_VoiceClone:
		input, err := validateLocalAppVoiceCloneJobSpec(spec.VoiceClone)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceClone{
			VoiceClone: &runtimev1.VoiceCloneScenarioSpec{Input: input},
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE, nil
	case *runtimev1.SubmitLocalAppScenarioJobRequest_VoiceDesign:
		input, err := validateLocalAppVoiceDesignJobSpec(spec.VoiceDesign)
		if err != nil {
			return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, err
		}
		return &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceDesign{
			VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{Input: input},
		}}, runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN, nil
	default:
		return nil, runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
}

func validateLocalAppVideoGenerateJobSpec(spec *runtimev1.LocalAppVideoGenerateJobSpec) (*runtimev1.VideoGenerateScenarioSpec, error) {
	invalid := func() (*runtimev1.VideoGenerateScenarioSpec, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || !localAppOptionalExactText(spec.GetPrompt(), maxLocalAppScenarioPromptBytes) ||
		!localAppOptionalExactText(spec.GetNegativePrompt(), maxLocalAppScenarioPromptBytes) ||
		len(spec.GetContent()) > maxLocalAppScenarioVideoContentItems {
		return invalid()
	}
	if _, ok := runtimev1.VideoMode_name[int32(spec.GetMode())]; !ok {
		return invalid()
	}
	if spec.GetPrompt() == "" && len(spec.GetContent()) == 0 {
		return invalid()
	}
	for _, item := range spec.GetContent() {
		if err := validateLocalAppVideoContentItem(item); err != nil {
			return nil, err
		}
	}
	options, err := validateLocalAppVideoGenerationOptions(spec.GetOptions())
	if err != nil {
		return nil, err
	}
	return &runtimev1.VideoGenerateScenarioSpec{
		Prompt:         spec.GetPrompt(),
		NegativePrompt: spec.GetNegativePrompt(),
		Mode:           spec.GetMode(),
		Content:        spec.GetContent(),
		Options:        options,
	}, nil
}

func validateLocalAppVideoContentItem(item *runtimev1.VideoContentItem) error {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	if item == nil {
		return invalid
	}
	if _, ok := runtimev1.VideoContentType_name[int32(item.GetType())]; !ok {
		return invalid
	}
	if _, ok := runtimev1.VideoContentRole_name[int32(item.GetRole())]; !ok {
		return invalid
	}
	if !localAppOptionalExactText(item.GetText(), maxLocalAppScenarioVideoContentText) {
		return invalid
	}
	for _, url := range []string{item.GetImageUrl().GetUrl(), item.GetVideoUrl().GetUrl(), item.GetAudioUrl().GetUrl()} {
		if url == "" {
			continue
		}
		if !localAppExactText(url, maxLocalAppScenarioReferenceURIBytes) || !strings.HasPrefix(url, "https://") {
			return invalid
		}
	}
	if item.GetArtifactRef() != nil && !localAppBoundedIdentifier(item.GetArtifactRef().GetArtifactId()) {
		return invalid
	}
	if item.GetText() == "" && item.GetImageUrl().GetUrl() == "" && item.GetVideoUrl().GetUrl() == "" &&
		item.GetAudioUrl().GetUrl() == "" && item.GetArtifactRef().GetArtifactId() == "" {
		return invalid
	}
	return nil
}

func validateLocalAppVideoGenerationOptions(options *runtimev1.LocalAppVideoGenerationOptions) (*runtimev1.VideoGenerationOptions, error) {
	if options == nil {
		return nil, nil
	}
	invalid := func() (*runtimev1.VideoGenerationOptions, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if !localAppOptionalExactText(options.GetResolution(), maxLocalAppScenarioVoiceHintBytes) ||
		!localAppOptionalExactText(options.GetRatio(), maxLocalAppScenarioVoiceHintBytes) ||
		options.GetDurationSec() < 0 || options.GetDurationSec() > 600 ||
		options.GetFrames() < 0 || options.GetFrames() > 100000 ||
		options.GetFps() < 0 || options.GetFps() > 120 || options.GetSeed() < 0 {
		return invalid()
	}
	return &runtimev1.VideoGenerationOptions{
		Resolution:      options.GetResolution(),
		Ratio:           options.GetRatio(),
		DurationSec:     localAppOptionalInt32(options.DurationSec),
		Frames:          localAppOptionalInt32(options.Frames),
		Fps:             localAppOptionalInt32(options.Fps),
		Seed:            localAppOptionalInt64(options.Seed),
		CameraFixed:     localAppOptionalBool(options.CameraFixed),
		Watermark:       localAppOptionalBool(options.Watermark),
		GenerateAudio:   localAppOptionalBool(options.GenerateAudio),
		Draft:           localAppOptionalBool(options.Draft),
		ReturnLastFrame: localAppOptionalBool(options.ReturnLastFrame),
	}, nil
}

func validateLocalAppSpeechSynthesizeJobSpec(spec *runtimev1.LocalAppSpeechSynthesizeJobSpec) (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
	invalid := func() (*runtimev1.SpeechSynthesizeScenarioSpec, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || !localAppExactText(spec.GetText(), maxLocalAppScenarioPromptBytes) ||
		!localAppOptionalExactText(spec.GetLanguage(), maxLocalAppScenarioVoiceHintBytes) ||
		!localAppOptionalExactText(spec.GetAudioFormat(), maxLocalAppScenarioVoiceHintBytes) ||
		!localAppOptionalExactText(spec.GetEmotion(), maxLocalAppScenarioOptionTextBytes) ||
		spec.GetSampleRateHz() < 0 || spec.GetSampleRateHz() > 192000 {
		return invalid()
	}
	if _, ok := runtimev1.SpeechTimingMode_name[int32(spec.GetTimingMode())]; !ok {
		return invalid()
	}
	validFloat := func(value *float32, minValue float32, maxValue float32) bool {
		return value == nil || (!math.IsNaN(float64(*value)) && !math.IsInf(float64(*value), 0) && *value >= minValue && *value <= maxValue)
	}
	if !validFloat(spec.Speed, 0, 4) || !validFloat(spec.Pitch, -24, 24) || !validFloat(spec.Volume, 0, 4) {
		return invalid()
	}
	if err := validateLocalAppVoiceReference(spec.GetVoiceRef()); err != nil {
		return nil, err
	}
	if hints := spec.GetVoiceRenderHints(); hints != nil {
		for _, value := range []float32{hints.GetStability(), hints.GetSimilarityBoost(), hints.GetStyle(), hints.GetSpeed()} {
			if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) || value < 0 || value > 10 {
				return invalid()
			}
		}
	}
	return &runtimev1.SpeechSynthesizeScenarioSpec{
		Text:             spec.GetText(),
		Language:         spec.GetLanguage(),
		AudioFormat:      spec.GetAudioFormat(),
		SampleRateHz:     localAppOptionalInt32(spec.SampleRateHz),
		Speed:            localAppOptionalFloat32(spec.Speed),
		Pitch:            localAppOptionalFloat32(spec.Pitch),
		Volume:           localAppOptionalFloat32(spec.Volume),
		Emotion:          spec.GetEmotion(),
		VoiceRef:         spec.GetVoiceRef(),
		TimingMode:       spec.GetTimingMode(),
		VoiceRenderHints: spec.GetVoiceRenderHints(),
	}, nil
}

// validateLocalAppVoiceReference admits only preset or voice-asset references.
// A bare provider voice ref is Runtime-private handle truth and fails closed.
func validateLocalAppVoiceReference(ref *runtimev1.VoiceReference) error {
	if ref == nil {
		return nil
	}
	switch ref.GetKind() {
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_UNSPECIFIED:
		return nil
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET:
		if !localAppBoundedIdentifier(ref.GetPresetVoiceId()) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return nil
	case runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET:
		if !localAppBoundedIdentifier(ref.GetVoiceAssetId()) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
}

func validateLocalAppSpeechTranscribeJobSpec(spec *runtimev1.LocalAppSpeechTranscribeJobSpec) (*runtimev1.SpeechTranscribeScenarioSpec, error) {
	invalid := func() (*runtimev1.SpeechTranscribeScenarioSpec, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || !localAppOptionalExactText(spec.GetMimeType(), maxLocalAppScenarioOptionTextBytes) ||
		!localAppOptionalExactText(spec.GetLanguage(), maxLocalAppScenarioVoiceHintBytes) ||
		!localAppOptionalExactText(spec.GetPrompt(), maxLocalAppScenarioTranscribePrompt) ||
		!localAppOptionalExactText(spec.GetResponseFormat(), maxLocalAppScenarioVoiceHintBytes) ||
		spec.GetSpeakerCount() < 0 || spec.GetSpeakerCount() > 32 {
		return invalid()
	}
	source := spec.GetAudioSource()
	if source == nil || source.GetSource() == nil {
		return invalid()
	}
	switch audio := source.GetSource().(type) {
	case *runtimev1.SpeechTranscriptionAudioSource_AudioBytes:
		if len(audio.AudioBytes) == 0 || len(audio.AudioBytes) > maxLocalAppScenarioInlineAudioBytes ||
			spec.GetMimeType() == "" {
			return invalid()
		}
	case *runtimev1.SpeechTranscriptionAudioSource_AudioUri:
		if !localAppExactText(audio.AudioUri, maxLocalAppScenarioReferenceURIBytes) ||
			!strings.HasPrefix(audio.AudioUri, "https://") {
			return invalid()
		}
	default:
		return invalid()
	}
	return &runtimev1.SpeechTranscribeScenarioSpec{
		MimeType:       spec.GetMimeType(),
		Language:       spec.GetLanguage(),
		Timestamps:     localAppOptionalBool(spec.Timestamps),
		Diarization:    localAppOptionalBool(spec.Diarization),
		SpeakerCount:   localAppOptionalInt32(spec.SpeakerCount),
		Prompt:         spec.GetPrompt(),
		AudioSource:    source,
		ResponseFormat: spec.GetResponseFormat(),
	}, nil
}

func validateLocalAppVoiceCloneJobSpec(spec *runtimev1.LocalAppVoiceCloneJobSpec) (*runtimev1.VoiceV2VInput, error) {
	invalid := func() (*runtimev1.VoiceV2VInput, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || spec.GetInput() == nil {
		return invalid()
	}
	input := spec.GetInput()
	hasBytes := len(input.GetReferenceAudioBytes()) > 0
	hasURI := strings.TrimSpace(input.GetReferenceAudioUri()) != ""
	if hasBytes == hasURI {
		return invalid()
	}
	if hasBytes {
		if len(input.GetReferenceAudioBytes()) > maxVoiceWorkflowReferenceAudioBytes ||
			!localAppExactText(input.GetReferenceAudioMime(), maxLocalAppScenarioOptionTextBytes) {
			return invalid()
		}
	}
	if hasURI && (!localAppExactText(input.GetReferenceAudioUri(), maxLocalAppScenarioReferenceURIBytes) ||
		!strings.HasPrefix(input.GetReferenceAudioUri(), "https://")) {
		return invalid()
	}
	if len(input.GetLanguageHints()) > maxLocalAppScenarioVoiceHintCount {
		return invalid()
	}
	for _, hint := range input.GetLanguageHints() {
		if !localAppExactText(hint, maxLocalAppScenarioVoiceHintBytes) {
			return invalid()
		}
	}
	if !localAppOptionalExactText(input.GetPreferredName(), maxLocalAppScenarioVoiceNameBytes) ||
		!localAppOptionalExactText(input.GetText(), maxLocalAppScenarioPromptBytes) {
		return invalid()
	}
	return input, nil
}

func validateLocalAppVoiceDesignJobSpec(spec *runtimev1.LocalAppVoiceDesignJobSpec) (*runtimev1.VoiceT2VInput, error) {
	invalid := func() (*runtimev1.VoiceT2VInput, error) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if spec == nil || spec.GetInput() == nil {
		return invalid()
	}
	input := spec.GetInput()
	if !localAppExactText(input.GetInstructionText(), maxLocalAppScenarioVideoContentText) ||
		!localAppOptionalExactText(input.GetPreviewText(), maxLocalAppScenarioVideoContentText) ||
		!localAppOptionalExactText(input.GetLanguage(), maxLocalAppScenarioVoiceHintBytes) ||
		!localAppOptionalExactText(input.GetPreferredName(), maxLocalAppScenarioVoiceNameBytes) {
		return invalid()
	}
	return input, nil
}
