package ai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func streamLocalSpeechSynthesizeScenario(s *Service, req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	capturedRequest := &runtimev1.SubmitScenarioJobRequest{
		Head:          cloneScenarioHead(req.GetHead()),
		ScenarioType:  req.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec:          req.GetSpec(),
		Extensions:    req.GetExtensions(),
	}
	effective, err := s.captureLocalSpeechEffectiveInputs(stream.Context(), req.GetHead(), capturedRequest)
	if err != nil {
		return err
	}
	defer func() { effective.synthesizePlan = nil }()
	if effective.streamMode != capabilitydriver.SpeechStreamSimulated {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}

	release, acquireResult, err := s.scheduler.Acquire(stream.Context(), req.GetHead().GetAppId())
	if err != nil {
		return schedulerAcquireError(err)
	}
	defer release()
	waitMS := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMS))
	s.logQueueWait("stream_scenario_local_speech_synthesize", req.GetHead().GetAppId(), acquireResult)

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
		defer firstPacketTimer.Stop()
	}

	traceID := ulid.Make().String()
	modelResolved := effective.modelResolved()
	var sequence atomic.Uint64
	send := func(event *runtimev1.StreamScenarioEvent) error {
		event.Sequence = sequence.Add(1)
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
			s.logger.Warn("local speech stream failed", "scenario_type", req.GetScenarioType().String(), "model_resolved", modelResolved, "trace_id", traceID, "error", cause)
		}
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
				ReasonCode: reasonCodeFromStreamError(cause),
				ActionHint: actionHintFromStreamError(cause),
			}},
		})
	}

	if err := send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{Started: &runtimev1.ScenarioStreamStarted{
			ModelResolved:   modelResolved,
			RouteDecision:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			VoiceOutputMode: runtimev1.VoiceOutputMode_VOICE_OUTPUT_MODE_SIMULATED_STREAM,
		}},
	}); err != nil {
		return err
	}

	artifacts, bodies, usage, err := s.executeCapturedLocalSpeech(requestCtx, effective, nil)
	if err != nil {
		return failAndStop(err)
	}
	if len(artifacts) != 1 || artifacts[0] == nil {
		capabilitydriver.CloseArtifactBodies(bodies)
		return failAndStop(grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	payloadSource, payloadErr := localSpeechStreamPayload(artifacts[0], bodies)
	if payloadErr != nil {
		capabilitydriver.CloseArtifactBodies(bodies)
		return failAndStop(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, payloadErr, grpcerr.ReasonOptions{}))
	}
	defer func() { _ = payloadSource.Close() }()
	mimeType := strings.TrimSpace(artifacts[0].GetMimeType())
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	buffer := make([]byte, defaultSpeechStreamChunkSize)
	for {
		read, readErr := payloadSource.Read(buffer)
		if read == 0 && readErr == io.EOF {
			break
		}
		if readErr != nil && readErr != io.EOF {
			return failAndStop(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, readErr, grpcerr.ReasonOptions{}))
		}
		if read == 0 {
			continue
		}
		firstPacketSeen.Store(true)
		if err := send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Artifact{Artifact: &runtimev1.ArtifactStreamDelta{
					Chunk: append([]byte(nil), buffer[:read]...), MimeType: mimeType,
				}},
			}},
		}); err != nil {
			return err
		}
		if readErr == io.EOF {
			break
		}
	}
	if usage != nil {
		if err := send(&runtimev1.StreamScenarioEvent{EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE, Payload: &runtimev1.StreamScenarioEvent_Usage{Usage: usage}}); err != nil {
			return err
		}
	}
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
			FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP, Usage: usage, StreamSimulated: true,
		}},
	})
}

func localSpeechStreamPayload(artifact *runtimev1.ScenarioArtifact, bodies map[string]*capabilitydriver.ArtifactBody) (io.ReadCloser, error) {
	if artifact == nil {
		return nil, fmt.Errorf("local speech stream artifact is missing")
	}
	body := bodies[strings.TrimSpace(artifact.GetArtifactId())]
	if body != nil {
		if len(artifact.GetBytes()) != 0 {
			return nil, fmt.Errorf("local speech stream artifact body is ambiguous")
		}
		switch body.Kind() {
		case capabilitydriver.ArtifactBodyIncrementalStream:
			if source := body.TakeIncrementalStream(); source != nil {
				return source, nil
			}
		case capabilitydriver.ArtifactBodyBoundedBytes:
			if payload := body.BoundedBytes(); len(payload) != 0 {
				return io.NopCloser(bytes.NewReader(payload)), nil
			}
		}
		return nil, fmt.Errorf("local speech stream artifact body is unavailable")
	}
	payload := artifact.GetBytes()
	if len(payload) == 0 {
		return nil, fmt.Errorf("local speech stream artifact body is missing")
	}
	return io.NopCloser(bytes.NewReader(payload)), nil
}
