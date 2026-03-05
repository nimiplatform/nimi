package ai

import (
	"context"
	"strconv"
	"strings"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

const (
	defaultSpeechStreamChunkSize = 32 * 1024 // 32 KB per ArtifactChunk
)

func (s *Service) GetSpeechVoices(ctx context.Context, req *runtimev1.GetSpeechVoicesRequest) (*runtimev1.GetSpeechVoicesResponse, error) {
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return nil, err
	}

	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(ctx, req.GetConnectorId())
	if err := validateKeySource(parsed, req.GetAppId()); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(ctx, parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalModelRequest(ctx, req.GetModelId(), remoteTarget); err != nil {
		return nil, err
	}

	selectedProvider, _, modelResolved, _, err := s.selector.resolveProviderWithTarget(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return nil, err
	}

	traceID := ulid.Make().String()
	providerType := ""
	if remoteTarget != nil {
		providerType = strings.TrimSpace(remoteTarget.ProviderType)
	}
	backend := resolveSpeechVoiceBackend(modelResolved, remoteTarget, selectedProvider, s.selector.cloudProvider)
	voices, source, catalogVersion, err := resolveSpeechVoicesForModel(ctx, modelResolved, remoteTarget, backend, s.speechCatalog)
	if err != nil {
		return nil, err
	}
	if catalogVersion == "" {
		catalogVersion = "n/a"
	}
	_ = grpc.SetHeader(ctx, metadata.Pairs(
		"x-nimi-voice-catalog-source", string(source),
		"x-nimi-voice-catalog-version", catalogVersion,
		"x-nimi-voice-count", strconv.Itoa(len(voices)),
	))

	s.logger.Debug(
		"voice-list-resolved",
		"source", string(source),
		"catalog_source", string(source),
		"catalog_version", catalogVersion,
		"voice_count", len(voices),
		"model_resolved", strings.TrimSpace(modelResolved),
		"provider_type", providerType,
		"connector_id", strings.TrimSpace(req.GetConnectorId()),
	)

	return &runtimev1.GetSpeechVoicesResponse{
		Voices:        voices,
		ModelResolved: modelResolved,
		TraceId:       traceID,
	}, nil
}

func (s *Service) StreamSpeechSynthesis(req *runtimev1.StreamSpeechSynthesisRequest, stream grpc.ServerStreamingServer[runtimev1.ArtifactChunk]) error {
	if err := validateStreamSpeechSynthesisRequest(req); err != nil {
		return err
	}

	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(stream.Context(), req.GetConnectorId())
	if err := validateKeySource(parsed, req.GetAppId()); err != nil {
		return err
	}
	remoteTarget, err := resolveKeySourceToTarget(stream.Context(), parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return err
	}
	if err := s.validateLocalModelRequest(stream.Context(), req.GetModelId(), remoteTarget); err != nil {
		return err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.logQueueWait("stream_speech_synthesis", req.GetAppId(), acquireResult)

	requestCtx, cancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultSynthesizeTimeout)
	defer cancel()

	selectedProvider, _, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(stream.Context(), req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	spec := req.GetSpeechSpec()
	var backend *nimillm.Backend
	var backendModelID string
	if remoteTarget != nil && s.selector.cloudProvider != nil {
		backend, backendModelID = s.selector.cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
	} else {
		mbp, ok := selectedProvider.(nimillm.MediaBackendProvider)
		if !ok || mbp == nil {
			return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		backend, backendModelID = mbp.ResolveMediaBackend(modelResolved)
	}
	if backend == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backendModelID == "" {
		backendModelID = modelResolved
	}
	payload, usage, err := backend.SynthesizeSpeech(requestCtx, backendModelID, spec)
	if err != nil {
		return err
	}

	traceID := ulid.Make().String()
	artifactID := ulid.Make().String()
	mimeType := nimillm.ResolveSpeechArtifactMIME(spec, payload)

	var sequence uint64
	for offset := 0; offset < len(payload); offset += defaultSpeechStreamChunkSize {
		end := offset + defaultSpeechStreamChunkSize
		if end > len(payload) {
			end = len(payload)
		}
		isLast := end == len(payload)
		chunk := &runtimev1.ArtifactChunk{
			ArtifactId:    artifactID,
			MimeType:      mimeType,
			Sequence:      sequence,
			Chunk:         payload[offset:end],
			Eof:           isLast,
			ModelResolved: modelResolved,
			TraceId:       traceID,
		}
		if isLast && usage != nil {
			chunk.Usage = usage
		}
		if err := stream.Send(chunk); err != nil {
			return err
		}
		sequence++
	}

	if len(payload) == 0 {
		if err := stream.Send(&runtimev1.ArtifactChunk{
			ArtifactId:    artifactID,
			MimeType:      mimeType,
			Sequence:      0,
			Eof:           true,
			Usage:         usage,
			ModelResolved: modelResolved,
			TraceId:       traceID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func validateStreamSpeechSynthesisRequest(req *runtimev1.StreamSpeechSynthesisRequest) error {
	if req == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if err := validateBaseRequest(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), req.GetRoutePolicy()); err != nil {
		return err
	}
	spec := req.GetSpeechSpec()
	if spec == nil || strings.TrimSpace(spec.GetText()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return nil
}
