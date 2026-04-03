package ai

import (
	"context"
	"strings"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	defaultSpeechStreamChunkSize = 32 * 1024 // 32 KB per speech chunk
)

func (s *Service) StreamScenario(req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	if req == nil || req.GetHead() == nil || req.GetSpec() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	mode := req.GetExecutionMode()
	if mode == runtimev1.ExecutionMode_EXECUTION_MODE_UNSPECIFIED {
		mode = runtimev1.ExecutionMode_EXECUTION_MODE_STREAM
	}
	if err := validateScenarioExecutionMode(req.GetScenarioType(), mode); err != nil {
		return err
	}
	if mode != runtimev1.ExecutionMode_EXECUTION_MODE_STREAM {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if _, err := classifyScenarioExtensions(req.GetScenarioType(), req.GetExtensions()); err != nil {
		return err
	}

	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE:
		return streamTextGenerateScenario(s, req, stream)

	case runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE:
		return streamSpeechSynthesizeScenario(s, req, stream)
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

func streamTextGenerateScenario(s *Service, req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	spec := req.GetSpec().GetTextGenerate()
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	if len(spec.GetInput()) == 0 && strings.TrimSpace(spec.GetSystemPrompt()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	remoteTarget, err := s.prepareScenarioRequest(stream.Context(), req.GetHead(), req.GetScenarioType())
	if err != nil {
		return err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetHead().GetAppId())
	if acquireErr != nil {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("stream_scenario_text_generate", req.GetHead().GetAppId(), acquireResult)
	totalTimeout := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultStreamTotalTimeout)
	requestBaseCtx, baseCancel := withTimeout(stream.Context(), req.GetHead().GetTimeoutMs(), defaultStreamTotalTimeout)
	defer baseCancel()
	requestCtx, requestCancel := context.WithCancel(requestBaseCtx)
	defer requestCancel()
	firstPacketTimedOut := &atomic.Bool{}
	firstPacketSeen := &atomic.Bool{}
	firstTimeout := s.streamFirstPacketTimeout
	if totalTimeout > 0 && totalTimeout < firstTimeout {
		firstTimeout = totalTimeout
	}
	var firstPacketTimer *time.Timer
	if firstTimeout > 0 {
		firstPacketTimer = time.AfterFunc(firstTimeout, func() {
			if firstPacketSeen.Load() {
				return
			}
			firstPacketTimedOut.Store(true)
			requestCancel()
		})
	}
	if firstPacketTimer != nil {
		defer firstPacketTimer.Stop()
	}

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		stream.Context(),
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)
	resolved, err := s.resolveTextGenerateScenario(stream.Context(), req.GetHead(), modelResolved, remoteTarget, selectedProvider, spec)
	if err != nil {
		return err
	}
	defer resolved.release()
	releaseLease, err := s.acquireSelectedLocalModelLease(requestCtx, req.GetHead().GetModelId(), remoteTarget, runtimev1.Modal_MODAL_TEXT, "stream_text_generate_request")
	if err != nil {
		return err
	}
	defer releaseLease()
	if err := s.validateTextGenerateInputParts(stream.Context(), modelResolved, remoteTarget, selectedProvider, resolved.spec.GetInput()); err != nil {
		return err
	}

	traceID := ulid.Make().String()
	var seq atomic.Uint64
	send := func(event *runtimev1.StreamScenarioEvent) error {
		event.Sequence = seq.Add(1)
		event.TraceId = traceID
		event.Timestamp = timestamppb.New(time.Now().UTC())
		return stream.Send(event)
	}
	failAndStop := func(cause error) error {
		if firstPacketTimedOut.Load() && !firstPacketSeen.Load() {
			cause = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		if s.logger != nil {
			s.logger.Warn("scenario stream failed",
				"scenario_type", req.GetScenarioType().String(),
				"model_resolved", modelResolved,
				"trace_id", traceID,
				"error", cause,
			)
		}
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamScenarioEvent_Failed{
				Failed: &runtimev1.ScenarioStreamFailed{
					ReasonCode: reasonCodeFromStreamError(cause),
					ActionHint: "retry stream request",
				},
			},
		})
	}

	if err := send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{
			Started: &runtimev1.ScenarioStreamStarted{
				ModelResolved: modelResolved,
				RouteDecision: routeDecision,
			},
		},
	}); err != nil {
		return err
	}

	inputText := nimillm.ComposeInputText(resolved.spec.GetSystemPrompt(), resolved.spec.GetInput())
	var usage *runtimev1.UsageStats
	var finishReason runtimev1.FinishReason
	streamSimulated := false

	var chunkBuf strings.Builder
	sendDelta := func(text string) error {
		if text == "" {
			return nil
		}
		chunkBuf.WriteString(text)
		if chunkBuf.Len() < minStreamChunkBytes {
			return nil
		}
		chunk := chunkBuf.String()
		chunkBuf.Reset()
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{
				Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{
						Text: &runtimev1.TextStreamDelta{
							Text: chunk,
						},
					},
				},
			},
		})
	}
	flushDelta := func() error {
		if chunkBuf.Len() == 0 {
			return nil
		}
		chunk := chunkBuf.String()
		chunkBuf.Reset()
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{
				Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Text{
						Text: &runtimev1.TextStreamDelta{
							Text: chunk,
						},
					},
				},
			},
		})
	}

	scenarioStreamer, canStreamScenario := selectedProvider.(scenarioStreamingTextProvider)
	scenarioGenerator, canGenerateScenario := selectedProvider.(scenarioTextProvider)
	if remoteTarget != nil && s.selector.cloudProvider != nil {
		requestCtx = nimillm.WithStreamSimulationFlag(requestCtx, &streamSimulated)
		usage, finishReason, err = s.selector.cloudProvider.StreamGenerateTextScenarioWithTarget(requestCtx, modelResolved, resolved.spec, func(part string) error {
			firstPacketSeen.Store(true)
			return sendDelta(part)
		}, remoteTarget)
		if err != nil {
			return failAndStop(err)
		}
	} else if canStreamScenario {
		requestCtx = nimillm.WithStreamSimulationFlag(requestCtx, &streamSimulated)
		usage, finishReason, err = scenarioStreamer.StreamGenerateTextScenario(requestCtx, modelResolved, resolved.spec, func(part string) error {
			firstPacketSeen.Store(true)
			return sendDelta(part)
		})
		if err != nil {
			return failAndStop(err)
		}
	} else {
		if !canGenerateScenario && (remoteTarget == nil || s.selector.cloudProvider == nil) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
		}
		streamSimulated = true
		var (
			outputText   string
			streamUsage  *runtimev1.UsageStats
			streamFinish runtimev1.FinishReason
			generateErr  error
		)
		if remoteTarget != nil && s.selector.cloudProvider != nil {
			outputText, streamUsage, streamFinish, generateErr = s.selector.cloudProvider.GenerateTextScenarioWithTarget(requestCtx, modelResolved, resolved.spec, inputText, remoteTarget)
		} else {
			outputText, streamUsage, streamFinish, generateErr = scenarioGenerator.GenerateTextScenario(requestCtx, modelResolved, resolved.spec, inputText)
		}
		if generateErr != nil {
			return failAndStop(generateErr)
		}
		usage = streamUsage
		finishReason = streamFinish
		parts := nimillm.SplitText(outputText, 24)
		for _, part := range parts {
			firstPacketSeen.Store(true)
			if err := sendDelta(part); err != nil {
				return err
			}
		}
	}

	if err := flushDelta(); err != nil {
		return err
	}
	if streamSimulated {
		s.recordStreamFallbackSimulated(
			req.GetHead().GetAppId(),
			req.GetHead().GetSubjectUserId(),
			req.GetHead().GetModelId(),
			modelResolved,
		)
	}
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamScenarioEvent_Completed{
			Completed: &runtimev1.ScenarioStreamCompleted{
				FinishReason:    finishReason,
				Usage:           usage,
				StreamSimulated: streamSimulated,
			},
		},
	})
}

func streamSpeechSynthesizeScenario(s *Service, req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	spec := req.GetSpec().GetSpeechSynthesize()
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(spec.GetText()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	remoteTarget, err := s.prepareScenarioRequest(stream.Context(), req.GetHead(), req.GetScenarioType())
	if err != nil {
		return err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetHead().GetAppId())
	if acquireErr != nil {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("stream_scenario_speech_synthesize", req.GetHead().GetAppId(), acquireResult)

	totalTimeout := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
	requestBaseCtx, baseCancel := withTimeout(stream.Context(), req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
	defer baseCancel()
	requestCtx, requestCancel := context.WithCancel(requestBaseCtx)
	defer requestCancel()
	firstPacketTimedOut := &atomic.Bool{}
	firstPacketSeen := &atomic.Bool{}
	firstTimeout := s.streamFirstPacketTimeout
	if totalTimeout > 0 && totalTimeout < firstTimeout {
		firstTimeout = totalTimeout
	}
	var firstPacketTimer *time.Timer
	if firstTimeout > 0 {
		firstPacketTimer = time.AfterFunc(firstTimeout, func() {
			if firstPacketSeen.Load() {
				return
			}
			firstPacketTimedOut.Store(true)
			requestCancel()
		})
	}
	if firstPacketTimer != nil {
		defer firstPacketTimer.Stop()
	}

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(
		stream.Context(),
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(
		req.GetHead().GetAppId(),
		req.GetHead().GetSubjectUserId(),
		req.GetHead().GetModelId(),
		modelResolved,
		routeInfo,
	)

	traceID := ulid.Make().String()
	var seq atomic.Uint64
	send := func(event *runtimev1.StreamScenarioEvent) error {
		event.Sequence = seq.Add(1)
		event.TraceId = traceID
		event.Timestamp = timestamppb.New(time.Now().UTC())
		return stream.Send(event)
	}
	failAndStop := func(cause error) error {
		if firstPacketTimedOut.Load() && !firstPacketSeen.Load() {
			cause = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		if s.logger != nil {
			s.logger.Warn("scenario stream failed",
				"scenario_type", req.GetScenarioType().String(),
				"model_resolved", modelResolved,
				"trace_id", traceID,
				"error", cause,
			)
		}
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamScenarioEvent_Failed{
				Failed: &runtimev1.ScenarioStreamFailed{
					ReasonCode: reasonCodeFromStreamError(cause),
					ActionHint: "retry stream request",
				},
			},
		})
	}

	if err := send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{
			Started: &runtimev1.ScenarioStreamStarted{
				ModelResolved: modelResolved,
				RouteDecision: routeDecision,
			},
		},
	}); err != nil {
		return err
	}

	var backend *nimillm.Backend
	var backendModelID string
	if remoteTarget != nil && s.selector.cloudProvider != nil {
		backend, backendModelID = s.selector.cloudProvider.ResolveMediaBackendWithTarget(modelResolved, remoteTarget)
	} else {
		mbp, ok := selectedProvider.(nimillm.MediaBackendProvider)
		if !ok || mbp == nil {
			return failAndStop(grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE))
		}
		backend, backendModelID = mbp.ResolveMediaBackend(modelResolved)
	}
	if backend == nil {
		return failAndStop(grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE))
	}
	if backendModelID == "" {
		backendModelID = modelResolved
	}

	speechSpec := &runtimev1.SpeechSynthesizeScenarioSpec{
		Text:             spec.GetText(),
		Language:         spec.GetLanguage(),
		AudioFormat:      spec.GetAudioFormat(),
		SampleRateHz:     spec.GetSampleRateHz(),
		Speed:            spec.GetSpeed(),
		Pitch:            spec.GetPitch(),
		Volume:           spec.GetVolume(),
		Emotion:          spec.GetEmotion(),
		VoiceRef:         spec.GetVoiceRef(),
		TimingMode:       spec.GetTimingMode(),
		VoiceRenderHints: spec.GetVoiceRenderHints(),
	}
	scenarioExtensions := nimillm.ScenarioExtensionPayloadForType(req.GetScenarioType(), req.GetExtensions())
	payload, usage, synthErr := backend.SynthesizeSpeech(requestCtx, backendModelID, speechSpec, scenarioExtensions)
	if synthErr != nil {
		return failAndStop(synthErr)
	}

	mimeType := nimillm.ResolveSpeechArtifactMIME(speechSpec, payload)
	for offset := 0; offset < len(payload); offset += defaultSpeechStreamChunkSize {
		end := offset + defaultSpeechStreamChunkSize
		if end > len(payload) {
			end = len(payload)
		}
		firstPacketSeen.Store(true)
		if err := send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{
				Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Artifact{
						Artifact: &runtimev1.ArtifactStreamDelta{
							Chunk:    payload[offset:end],
							MimeType: mimeType,
						},
					},
				},
			},
		}); err != nil {
			return err
		}
	}

	if usage != nil {
		if err := send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
			Payload:   &runtimev1.StreamScenarioEvent_Usage{Usage: usage},
		}); err != nil {
			return err
		}
	}
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamScenarioEvent_Completed{
			Completed: &runtimev1.ScenarioStreamCompleted{
				FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				Usage:        usage,
			},
		},
	})
}
