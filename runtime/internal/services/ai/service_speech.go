package ai

import (
	"context"
	"strings"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"

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
	if err := validateKeySource(parsed); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}

	selectedProvider, _, modelResolved, _, err := s.selector.resolveProviderWithTarget(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return nil, err
	}

	traceID := ulid.Make().String()
	voices := resolveVoicePresets(selectedProvider, modelResolved)

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
	if err := validateKeySource(parsed); err != nil {
		return err
	}
	remoteTarget, err := resolveKeySourceToTarget(parsed, s.connStore, s.allowLoopback)
	if err != nil {
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

// resolveVoicePresets returns a list of voice descriptors based on the resolved
// provider backend. For cloud providers, built-in presets are returned based on
// the model ID prefix. For local providers, a minimal default set is returned.
func resolveVoicePresets(selectedProvider provider, modelResolved string) []*runtimev1.SpeechVoiceDescriptor {
	lower := strings.ToLower(modelResolved)

	switch {
	case strings.HasPrefix(lower, "aliyun/") || strings.HasPrefix(lower, "alibaba/"):
		return dashScopeVoicePresets()
	case strings.HasPrefix(lower, "bytedance/") || strings.HasPrefix(lower, "byte/"):
		return volcengineVoicePresets()
	default:
		return openAIVoicePresets()
	}
}

func dashScopeVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "Cherry", Name: "Cherry", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Serena", Name: "Serena", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Ethan", Name: "Ethan", Lang: "en", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Chelsie", Name: "Chelsie", Lang: "en", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Aura", Name: "Aura", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Breeze", Name: "Breeze", Lang: "zh", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "Haruto", Name: "Haruto", Lang: "ja", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
		{VoiceId: "Maple", Name: "Maple", Lang: "zh", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "Sierra", Name: "Sierra", Lang: "en", SupportedLangs: []string{"zh", "en"}},
		{VoiceId: "River", Name: "River", Lang: "zh", SupportedLangs: []string{"zh", "en", "ja", "ko"}},
	}
}

func volcengineVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "BV001_streaming", Name: "BV001", Lang: "zh", SupportedLangs: []string{"zh"}},
		{VoiceId: "BV002_streaming", Name: "BV002", Lang: "zh", SupportedLangs: []string{"zh"}},
	}
}

func openAIVoicePresets() []*runtimev1.SpeechVoiceDescriptor {
	return []*runtimev1.SpeechVoiceDescriptor{
		{VoiceId: "alloy", Name: "Alloy", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
		{VoiceId: "nova", Name: "Nova", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
		{VoiceId: "shimmer", Name: "Shimmer", Lang: "en", SupportedLangs: []string{"en", "zh", "ja", "ko", "es", "fr", "de"}},
	}
}
