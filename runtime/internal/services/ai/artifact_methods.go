package ai

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
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
	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("generate_image", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultGenerateImageTimeout)
	defer cancel()
	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)
	payload, usage, err := selectedProvider.generateImage(requestCtx, modelResolved, req.GetPrompt())
	if err != nil {
		return err
	}
	if usage == nil {
		usage = artifactUsage(req.GetPrompt(), payload, 180)
	}
	return streamArtifact(stream, "image/png", routeDecision, modelResolved, payload, usage)
}

func (s *Service) GenerateVideo(req *runtimev1.GenerateVideoRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validatePromptRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetPrompt(), req.GetRoutePolicy()); err != nil {
		return err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("generate_video", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultGenerateVideoTimeout)
	defer cancel()
	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)
	payload, usage, err := selectedProvider.generateVideo(requestCtx, modelResolved, req.GetPrompt())
	if err != nil {
		return err
	}
	if usage == nil {
		usage = artifactUsage(req.GetPrompt(), payload, 420)
	}
	return streamArtifact(stream, "video/mp4", routeDecision, modelResolved, payload, usage)
}

func (s *Service) SynthesizeSpeech(req *runtimev1.SynthesizeSpeechRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validatePromptRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetText(), req.GetRoutePolicy()); err != nil {
		return err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("synthesize_speech", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultSynthesizeTimeout)
	defer cancel()
	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)
	payload, usage, err := selectedProvider.synthesizeSpeech(requestCtx, modelResolved, req.GetText())
	if err != nil {
		return err
	}
	if usage == nil {
		usage = artifactUsage(req.GetText(), payload, 120)
	}
	return streamArtifact(stream, "audio/mpeg", routeDecision, modelResolved, payload, usage)
}

func (s *Service) TranscribeAudio(ctx context.Context, req *runtimev1.TranscribeAudioRequest) (*runtimev1.TranscribeAudioResponse, error) {
	if err := validateTranscribeRequest(req); err != nil {
		return nil, err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("transcribe_audio", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultTranscribeTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	text, usage, err := selectedProvider.transcribe(requestCtx, modelResolved, req.GetAudioBytes(), req.GetMimeType())
	if err != nil {
		return nil, err
	}
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
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       ulid.Make().String(),
	}, nil
}
