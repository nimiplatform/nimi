package ai

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func streamTextGenerateScenario(s *Service, req *runtimev1.StreamScenarioRequest, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) error {
	scenarioStartedAt := time.Now()
	spec := req.GetSpec().GetTextGenerate()
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	if len(spec.GetInput()) == 0 && strings.TrimSpace(spec.GetSystemPrompt()) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	localCtx, localText, err := s.captureLocalTextRoutingIntent(stream.Context(), req.GetHead())
	if err != nil {
		return err
	}
	if localText {
		return streamLocalTextGenerateScenario(localCtx, s, req, stream)
	}
	intent, err := scenarioExecutionIntentFromContext(localCtx, aicapabilities.TextGenerate)
	if err != nil {
		return err
	}
	stream = &executionIntentScenarioStream{ServerStreamingServer: stream, ctx: localCtx}

	prepareStartedAt := time.Now()
	remoteTarget, err := s.prepareScenarioRequest(stream.Context(), req.GetHead(), req.GetScenarioType())
	s.observeLatency("runtime.ai.stream.prepare_request_ms", prepareStartedAt,
		"caller_app_id", req.GetHead().GetAppId(),
		"scenario_type", req.GetScenarioType().String(),
		"requested_model_id", intent.ModelID(),
	)
	if err != nil {
		return err
	}

	schedulerStartedAt := time.Now()
	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetHead().GetAppId())
	s.observeLatency("runtime.ai.scheduler_acquire_ms", schedulerStartedAt,
		"caller_app_id", req.GetHead().GetAppId(),
		"scenario_type", req.GetScenarioType().String(),
		"requested_model_id", intent.ModelID(),
	)
	if acquireErr != nil {
		return schedulerAcquireError(acquireErr)
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
	idleTimedOut := &atomic.Bool{}
	firstPacketSeen := &atomic.Bool{}
	firstTimeout := s.streamFirstPacketTimeout
	if totalTimeout > 0 && totalTimeout < firstTimeout {
		firstTimeout = totalTimeout
	}
	var firstPacketTimer *time.Timer
	startFirstPacketTimer := func() {
		if firstTimeout <= 0 || firstPacketTimer != nil {
			return
		}
		firstPacketTimer = time.AfterFunc(firstTimeout, func() {
			if firstPacketSeen.Load() {
				return
			}
			firstPacketTimedOut.Store(true)
			requestCancel()
		})
	}
	idleTimeout := s.streamIdleTimeout
	if totalTimeout > 0 && totalTimeout < idleTimeout {
		idleTimeout = totalTimeout
	}
	var idleTimer *time.Timer
	var idleTimerMu sync.Mutex
	resetIdleTimer := func() {
		if idleTimeout <= 0 || idleTimedOut.Load() {
			return
		}
		idleTimerMu.Lock()
		defer idleTimerMu.Unlock()
		if idleTimer == nil {
			idleTimer = time.AfterFunc(idleTimeout, func() {
				idleTimedOut.Store(true)
				requestCancel()
			})
			return
		}
		idleTimer.Reset(idleTimeout)
	}
	if idleTimeout > 0 {
		defer func() {
			idleTimerMu.Lock()
			defer idleTimerMu.Unlock()
			if idleTimer != nil {
				idleTimer.Stop()
			}
		}()
	}
	recordActivity := func() {
		if firstPacketSeen.CompareAndSwap(false, true) && firstPacketTimer != nil {
			firstPacketTimer.Stop()
		}
		resetIdleTimer()
	}

	routeStartedAt := time.Now()
	selectedProvider, routeDecision, modelResolved, _, err := s.selector.resolveProviderWithTargetAndModal(
		stream.Context(),
		intent.Route,
		intent.ModelID(),
		remoteTarget,
		runtimev1.Modal_MODAL_TEXT,
	)
	s.observeLatency("runtime.ai.route_resolve_ms", routeStartedAt,
		"caller_app_id", req.GetHead().GetAppId(),
		"scenario_type", req.GetScenarioType().String(),
		"requested_model_id", intent.ModelID(),
		"resolved_model_id", modelResolved,
		"route_decision", routeDecision.String(),
	)
	if err != nil {
		return err
	}
	if routeDecision == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	if err := s.validateScenarioCapability(stream.Context(), req, modelResolved, remoteTarget, selectedProvider); err != nil {
		return err
	}
	if err := validateReasoningRequest(spec, modelResolved, remoteTarget, selectedProvider, runtimev1.ExecutionMode_EXECUTION_MODE_STREAM); err != nil {
		return err
	}
	resolved, err := s.resolveTextGenerateScenario(stream.Context(), req.GetHead(), modelResolved, remoteTarget, selectedProvider, spec)
	if err != nil {
		return err
	}
	defer resolved.release()
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
		if rpcctx.WasServerShutdown(requestCtx) {
			return rpcctx.ServerShutdownError()
		}
		if firstPacketTimedOut.Load() && !firstPacketSeen.Load() {
			cause = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		} else if idleTimedOut.Load() {
			cause = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		if s.logger != nil {
			logArgs := []any{
				"scenario_type", req.GetScenarioType().String(),
				"model_resolved", modelResolved,
				"trace_id", traceID,
				"error", cause,
			}
			if metadata, ok := grpcerr.ExtractReasonMetadata(cause); ok {
				if actionHint := strings.TrimSpace(metadata["action_hint"]); actionHint != "" {
					logArgs = append(logArgs, "action_hint", actionHint)
				}
			}
			s.logger.Warn("scenario stream failed", logArgs...)
		}
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamScenarioEvent_Failed{
				Failed: &runtimev1.ScenarioStreamFailed{
					ReasonCode: reasonCodeFromStreamError(cause),
					ActionHint: actionHintFromStreamError(cause),
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
	streamStartedAt := time.Now()
	s.observeCounter("runtime_ai_stream_started_total", 1,
		"caller_app_id", req.GetHead().GetAppId(),
		"scenario_type", req.GetScenarioType().String(),
		"requested_model_id", intent.ModelID(),
		"resolved_model_id", modelResolved,
		"route_decision", routeDecision.String(),
	)
	startFirstPacketTimer()
	if firstPacketTimer != nil {
		defer firstPacketTimer.Stop()
	}

	inputText := nimillm.ComposeInputText(resolved.spec.GetSystemPrompt(), resolved.spec.GetInput())
	providerModelID := s.resolveTextProviderModelID(stream.Context(), req.GetHead(), modelResolved, remoteTarget)
	var usage *runtimev1.UsageStats
	var finishReason runtimev1.FinishReason
	streamSimulated := false
	firstProviderCallbackAt := time.Time{}
	firstDeltaSent := atomic.Bool{}
	recordFirstProviderCallback := func() {
		if firstProviderCallbackAt.IsZero() {
			firstProviderCallbackAt = time.Now()
			s.observeCounter("runtime_ai_stream_first_provider_callback_total", 1,
				"caller_app_id", req.GetHead().GetAppId(),
				"scenario_type", req.GetScenarioType().String(),
				"requested_model_id", intent.ModelID(),
				"resolved_model_id", modelResolved,
				"route_decision", routeDecision.String(),
				"stream_simulated", streamSimulated,
			)
			s.observeLatency("runtime.ai.stream.started_to_provider_first_callback_ms", streamStartedAt,
				"caller_app_id", req.GetHead().GetAppId(),
				"scenario_type", req.GetScenarioType().String(),
				"requested_model_id", intent.ModelID(),
				"resolved_model_id", modelResolved,
				"route_decision", routeDecision.String(),
				"stream_simulated", streamSimulated,
			)
		}
	}
	recordFirstDeltaSent := func() {
		if firstDeltaSent.CompareAndSwap(false, true) {
			s.observeCounter("runtime_ai_stream_first_delta_sent_total", 1,
				"caller_app_id", req.GetHead().GetAppId(),
				"scenario_type", req.GetScenarioType().String(),
				"requested_model_id", intent.ModelID(),
				"resolved_model_id", modelResolved,
				"route_decision", routeDecision.String(),
				"stream_simulated", streamSimulated,
			)
			if !firstProviderCallbackAt.IsZero() {
				s.observeLatency("runtime.ai.stream.provider_first_callback_to_first_delta_send_ms", firstProviderCallbackAt,
					"caller_app_id", req.GetHead().GetAppId(),
					"scenario_type", req.GetScenarioType().String(),
					"requested_model_id", intent.ModelID(),
					"resolved_model_id", modelResolved,
					"route_decision", routeDecision.String(),
					"stream_simulated", streamSimulated,
				)
				s.observeLatency("runtime.ai.stream.chunk_buffer_wait_ms", firstProviderCallbackAt,
					"caller_app_id", req.GetHead().GetAppId(),
					"scenario_type", req.GetScenarioType().String(),
					"requested_model_id", intent.ModelID(),
					"resolved_model_id", modelResolved,
					"route_decision", routeDecision.String(),
					"stream_simulated", streamSimulated,
				)
			}
		}
	}

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
		if err := send(&runtimev1.StreamScenarioEvent{
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
		}); err != nil {
			return err
		}
		recordFirstDeltaSent()
		return nil
	}
	flushDelta := func() error {
		if chunkBuf.Len() == 0 {
			return nil
		}
		chunk := chunkBuf.String()
		chunkBuf.Reset()
		if err := send(&runtimev1.StreamScenarioEvent{
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
		}); err != nil {
			return err
		}
		recordFirstDeltaSent()
		return nil
	}
	if remoteTarget == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	cloudProvider := s.selector.cloudProvider
	if cloudProvider == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	// Tool calls and structured output stream as a simulated stream over the sync
	// scenario path, which executes them end-to-end and returns the tool calls.
	usesToolSurface := nimillm.TextScenarioUsesToolSurface(resolved.spec)
	var pendingToolCalls []*runtimev1.ToolCall
	if !usesToolSurface {
		requestCtx = nimillm.WithStreamSimulationFlag(requestCtx, &streamSimulated)
		usage, finishReason, err = cloudProvider.StreamGenerateTextScenarioWithTarget(requestCtx, providerModelID, resolved.spec, func(part string) error {
			recordFirstProviderCallback()
			recordActivity()
			return sendDelta(part)
		}, remoteTarget)
		if err != nil {
			return failAndStop(err)
		}
	} else {
		streamSimulated = true
		outputText, toolCalls, streamUsage, streamFinish, generateErr := cloudProvider.GenerateTextScenarioWithTarget(requestCtx, providerModelID, resolved.spec, inputText, remoteTarget)
		if generateErr != nil {
			return failAndStop(generateErr)
		}
		pendingToolCalls = toolCalls
		usage = streamUsage
		finishReason = streamFinish
		for _, part := range nimillm.SplitText(outputText, 24) {
			recordFirstProviderCallback()
			recordActivity()
			if err := sendDelta(part); err != nil {
				return err
			}
		}
	}

	if err := flushDelta(); err != nil {
		return err
	}
	for _, toolCall := range pendingToolCalls {
		if err := send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_TOOL_CALL,
			Payload: &runtimev1.StreamScenarioEvent_ToolCall{
				ToolCall: toolCall,
			},
		}); err != nil {
			return err
		}
	}
	if streamSimulated {
		s.recordStreamFallbackSimulated(
			req.GetHead().GetAppId(),
			req.GetHead().GetSubjectUserId(),
			intent.ModelID(),
			modelResolved,
		)
	}
	s.observeLatency("runtime.ai.stream.total_ms", scenarioStartedAt,
		"caller_app_id", req.GetHead().GetAppId(),
		"scenario_type", req.GetScenarioType().String(),
		"requested_model_id", intent.ModelID(),
		"resolved_model_id", modelResolved,
		"route_decision", routeDecision.String(),
		"stream_simulated", streamSimulated,
		"finish_reason", finishReason.String(),
	)
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
