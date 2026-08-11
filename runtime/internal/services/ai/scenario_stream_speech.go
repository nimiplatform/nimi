package ai

import (
	"context"
	"strings"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const defaultSpeechStreamChunkSize = 32 * 1024

func speechStreamVoiceOutputMode(nativeRequired bool) (runtimev1.VoiceOutputMode, error) {
	if nativeRequired {
		return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_UNSPECIFIED,
			grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	return runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM, nil
}

func streamSpeechSynthesizeScenario(s *Service, req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	spec := req.GetSpec().GetSpeechSynthesize()
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if strings.TrimSpace(spec.GetText()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	intent, err := scenarioExecutionIntentFromContext(stream.Context(), scenarioTargetCapability(req.GetScenarioType()))
	if err != nil {
		return err
	}
	if intent.IsLocal() {
		return streamLocalSpeechSynthesizeScenario(s, req, stream)
	}

	capturedRequest := &runtimev1.SubmitScenarioJobRequest{
		Head:          cloneScenarioHead(req.GetHead()),
		ScenarioType:  req.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec:          req.GetSpec(),
		Extensions:    req.GetExtensions(),
	}
	effective, err := s.captureCloudMediaEffectiveInputs(stream.Context(), req.GetHead(), capturedRequest, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM)
	if err != nil {
		return err
	}
	defer effective.release()

	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetHead().GetAppId())
	if acquireErr != nil {
		return schedulerAcquireError(acquireErr)
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("stream_scenario_speech_synthesize", req.GetHead().GetAppId(), acquireResult)

	totalTimeout, err := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultSynthesizeTimeout)
	if err != nil {
		return err
	}
	requestBaseCtx, baseCancel := context.WithTimeout(stream.Context(), totalTimeout)
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

	traceID := effective.traceID
	modelResolved := effective.modelResolved()
	var seq atomic.Uint64
	send := func(event *runtimev1.StreamScenarioEvent) error {
		event.Sequence = seq.Add(1)
		event.TraceId = traceID
		event.Timestamp = timestamppb.New(time.Now().UTC())
		return stream.Send(event)
	}
	failAndStop := func(cause error) error {
		if rpcctx.WasServerShutdown(requestCtx) {
			return rpcctx.ServerShutdownError()
		}
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
			Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
				ReasonCode: reasonCodeFromStreamError(cause),
				ActionHint: actionHintFromStreamError(cause),
			}},
		})
	}

	voiceOutputMode := runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM
	if effective.streamMode() == capabilitydriver.CloudMediaStreamNative {
		voiceOutputMode = runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_NATIVE_STREAM
	}
	if err := send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
			ModelResolved:   modelResolved,
			RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			VoiceOutputMode: voiceOutputMode,
		}},
	}); err != nil {
		return err
	}

	result, err := s.streamCapturedCloudSpeech(requestCtx, effective, func(chunk capabilitydriver.CloudMediaStreamChunk) error {
		firstPacketSeen.Store(true)
		mimeType := strings.TrimSpace(chunk.MIMEType)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Artifact{Artifact: &runtimev1.ArtifactStreamDelta{
					Chunk:    append([]byte(nil), chunk.Bytes...),
					MimeType: mimeType,
				}},
			}},
		})
	})
	if err != nil {
		return failAndStop(err)
	}

	if effective.streamMode() == capabilitydriver.CloudMediaStreamNative && !firstPacketSeen.Load() {
		return failAndStop(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	if effective.streamMode() == capabilitydriver.CloudMediaStreamSimulated {
		if len(result.Artifacts) == 0 || result.Artifacts[0] == nil {
			return failAndStop(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		}
		artifact := result.Artifacts[0]
		payload := artifact.GetBytes()
		mimeType := strings.TrimSpace(artifact.GetMimeType())
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		for offset := 0; offset < len(payload); offset += defaultSpeechStreamChunkSize {
			end := offset + defaultSpeechStreamChunkSize
			if end > len(payload) {
				end = len(payload)
			}
			firstPacketSeen.Store(true)
			if err := send(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
					Delta: &runtimev1.ScenarioStreamDelta_Artifact{Artifact: &runtimev1.ArtifactStreamDelta{
						Chunk:    append([]byte(nil), payload[offset:end]...),
						MimeType: mimeType,
					}},
				}},
			}); err != nil {
				return err
			}
		}
	}
	if result.Usage != nil {
		if err := send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
			Payload:   &runtimev1.StreamScenarioEvent_Usage{Usage: result.Usage},
		}); err != nil {
			return err
		}
	}
	finish := result.FinishReason
	if finish == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		finish = runtimev1.FinishReason_FINISH_REASON_STOP
	}
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
			FinishReason:    finish,
			Usage:           result.Usage,
			StreamSimulated: effective.streamMode() == capabilitydriver.CloudMediaStreamSimulated,
		}},
	})
}
