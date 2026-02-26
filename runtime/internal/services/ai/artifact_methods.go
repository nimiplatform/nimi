package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
)

func (s *Service) Embed(ctx context.Context, req *runtimev1.EmbedRequest) (*runtimev1.EmbedResponse, error) {
	if err := validateEmbedRequest(req); err != nil {
		return nil, err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("embed", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultEmbedTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	vectors, usage, err := selectedProvider.embed(requestCtx, modelResolved, req.GetInputs())
	if err != nil {
		return nil, err
	}
	if usage == nil {
		var inputTokens int64
		for _, input := range req.GetInputs() {
			inputTokens += estimateTokens(strings.TrimSpace(input))
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  inputTokens,
			OutputTokens: int64(len(req.GetInputs()) * 4),
			ComputeMs:    maxInt64(4, int64(len(req.GetInputs())*3)),
		}
	}

	return &runtimev1.EmbedResponse{
		Vectors:       vectors,
		Usage:         usage,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       ulid.Make().String(),
	}, nil
}

func (s *Service) GenerateImage(req *runtimev1.GenerateImageRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validatePromptRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetPrompt(), req.GetRoutePolicy()); err != nil {
		return err
	}
	submitResp, err := s.SubmitMediaJob(stream.Context(), &runtimev1.SubmitMediaJobRequest{
		AppId:         req.GetAppId(),
		SubjectUserId: req.GetSubjectUserId(),
		ModelId:       req.GetModelId(),
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   req.GetRoutePolicy(),
		Fallback:      req.GetFallback(),
		TimeoutMs:     req.GetTimeoutMs(),
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: req.GetPrompt(),
			},
		},
	})
	if err != nil {
		return err
	}
	waitCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultGenerateImageTimeout)
	defer cancel()
	job, ok := s.mediaJobs.waitTerminal(waitCtx, submitResp.GetJob().GetJobId())
	if !ok {
		return status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	if job == nil {
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		return mediaJobStatusToError(job)
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	payload := artifacts[0].GetBytes()
	mimeType := artifacts[0].GetMimeType()
	if mimeType == "" {
		mimeType = "image/png"
	}
	usage := job.GetUsage()
	if usage == nil {
		usage = artifactUsage(req.GetPrompt(), payload, 180)
	}
	return streamArtifact(stream, mimeType, job.GetRouteDecision(), job.GetModelResolved(), payload, usage)
}

func (s *Service) GenerateVideo(req *runtimev1.GenerateVideoRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validatePromptRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetPrompt(), req.GetRoutePolicy()); err != nil {
		return err
	}
	submitResp, err := s.SubmitMediaJob(stream.Context(), &runtimev1.SubmitMediaJobRequest{
		AppId:         req.GetAppId(),
		SubjectUserId: req.GetSubjectUserId(),
		ModelId:       req.GetModelId(),
		Modal:         runtimev1.Modal_MODAL_VIDEO,
		RoutePolicy:   req.GetRoutePolicy(),
		Fallback:      req.GetFallback(),
		TimeoutMs:     req.GetTimeoutMs(),
		Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
			VideoSpec: &runtimev1.VideoGenerationSpec{
				Prompt: req.GetPrompt(),
			},
		},
	})
	if err != nil {
		return err
	}
	waitCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultGenerateVideoTimeout)
	defer cancel()
	job, ok := s.mediaJobs.waitTerminal(waitCtx, submitResp.GetJob().GetJobId())
	if !ok {
		return status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	if job == nil {
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		return mediaJobStatusToError(job)
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	payload := artifacts[0].GetBytes()
	mimeType := artifacts[0].GetMimeType()
	if mimeType == "" {
		mimeType = "video/mp4"
	}
	usage := job.GetUsage()
	if usage == nil {
		usage = artifactUsage(req.GetPrompt(), payload, 420)
	}
	return streamArtifact(stream, mimeType, job.GetRouteDecision(), job.GetModelResolved(), payload, usage)
}

func (s *Service) SynthesizeSpeech(req *runtimev1.SynthesizeSpeechRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validatePromptRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetText(), req.GetRoutePolicy()); err != nil {
		return err
	}
	submitResp, err := s.SubmitMediaJob(stream.Context(), &runtimev1.SubmitMediaJobRequest{
		AppId:         req.GetAppId(),
		SubjectUserId: req.GetSubjectUserId(),
		ModelId:       req.GetModelId(),
		Modal:         runtimev1.Modal_MODAL_TTS,
		RoutePolicy:   req.GetRoutePolicy(),
		Fallback:      req.GetFallback(),
		TimeoutMs:     req.GetTimeoutMs(),
		Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
			SpeechSpec: &runtimev1.SpeechSynthesisSpec{
				Text: req.GetText(),
			},
		},
	})
	if err != nil {
		return err
	}
	waitCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultSynthesizeTimeout)
	defer cancel()
	job, ok := s.mediaJobs.waitTerminal(waitCtx, submitResp.GetJob().GetJobId())
	if !ok {
		return status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	if job == nil {
		return status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		return mediaJobStatusToError(job)
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	payload := artifacts[0].GetBytes()
	mimeType := artifacts[0].GetMimeType()
	if mimeType == "" {
		mimeType = "audio/mpeg"
	}
	usage := job.GetUsage()
	if usage == nil {
		usage = artifactUsage(req.GetText(), payload, 120)
	}
	return streamArtifact(stream, mimeType, job.GetRouteDecision(), job.GetModelResolved(), payload, usage)
}

func (s *Service) TranscribeAudio(ctx context.Context, req *runtimev1.TranscribeAudioRequest) (*runtimev1.TranscribeAudioResponse, error) {
	if err := validateTranscribeRequest(req); err != nil {
		return nil, err
	}
	submitResp, err := s.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         req.GetAppId(),
		SubjectUserId: req.GetSubjectUserId(),
		ModelId:       req.GetModelId(),
		Modal:         runtimev1.Modal_MODAL_STT,
		RoutePolicy:   req.GetRoutePolicy(),
		Fallback:      req.GetFallback(),
		TimeoutMs:     req.GetTimeoutMs(),
		Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
			TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
				AudioBytes: req.GetAudioBytes(),
				MimeType:   req.GetMimeType(),
			},
		},
	})
	if err != nil {
		return nil, err
	}
	waitCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultTranscribeTimeout)
	defer cancel()
	job, ok := s.mediaJobs.waitTerminal(waitCtx, submitResp.GetJob().GetJobId())
	if !ok {
		return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_APP_GRANT_INVALID.String())
	}
	if job == nil {
		return nil, status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
	}
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		return nil, mediaJobStatusToError(job)
	}
	artifacts := job.GetArtifacts()
	if len(artifacts) == 0 {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	text := strings.TrimSpace(string(artifacts[0].GetBytes()))
	if text == "" {
		text = strings.TrimSpace(artifacts[0].GetProviderRaw().GetFields()["text"].GetStringValue())
	}
	usage := job.GetUsage()
	if usage == nil {
		usage = &runtimev1.UsageStats{
			InputTokens:  maxInt64(1, int64(len(req.GetAudioBytes())/256)),
			OutputTokens: estimateTokens(text),
			ComputeMs:    maxInt64(10, int64(len(req.GetAudioBytes())/64)),
		}
	}
	return &runtimev1.TranscribeAudioResponse{
		Text:          text,
		Usage:         usage,
		RouteDecision: job.GetRouteDecision(),
		ModelResolved: job.GetModelResolved(),
		TraceId:       job.GetTraceId(),
	}, nil
}

func mediaJobStatusToError(job *runtimev1.MediaJob) error {
	if job == nil {
		return status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
	}
	reasonCode := job.GetReasonCode()
	if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reasonCode = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	}
	switch reasonCode {
	case runtimev1.ReasonCode_AI_INPUT_INVALID:
		return status.Error(codes.InvalidArgument, reasonCode.String())
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return status.Error(codes.NotFound, reasonCode.String())
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return status.Error(codes.DeadlineExceeded, reasonCode.String())
	case runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED, runtimev1.ReasonCode_AI_MODEL_NOT_READY:
		return status.Error(codes.FailedPrecondition, reasonCode.String())
	case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED:
		return status.Error(codes.PermissionDenied, reasonCode.String())
	default:
		return status.Error(codes.Unavailable, reasonCode.String())
	}
}
