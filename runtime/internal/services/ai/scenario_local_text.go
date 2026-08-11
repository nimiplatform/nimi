package ai

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func executeLocalTextGenerateScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.ExecuteScenarioRequest,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.ExecuteScenarioResponse, error) {
	effective, err := s.captureLocalTextEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetTextGenerate(), false)
	if err != nil {
		return nil, err
	}
	defer effective.release()

	release, acquireResult, err := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if err != nil {
		return nil, schedulerAcquireError(err)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	requestCtx, cancel, err := withTimeout(ctx, req.GetHead().GetTimeoutMs(), defaultGenerateTimeout)
	if err != nil {
		return nil, err
	}
	defer cancel()

	result, err := s.executeCapturedLocalText(requestCtx, effective, nil)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateOutput{Text: result.Text},
			},
		},
		FinishReason:      result.FinishReason,
		Usage:             localTextUsage(result, effective.request),
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		TraceId:           ulid.Make().String(),
		IgnoredExtensions: cloneIgnoredScenarioExtensions(ignored),
	}, nil
}

func streamLocalTextGenerateScenario(
	ctx context.Context,
	s *Service,
	req *runtimev1.StreamScenarioRequest,
	stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent],
) error {
	effective, err := s.captureLocalTextEffectiveInputs(ctx, req.GetHead(), req.GetSpec().GetTextGenerate(), true)
	if err != nil {
		return err
	}
	defer effective.release()

	release, acquireResult, err := s.scheduler.Acquire(ctx, req.GetHead().GetAppId())
	if err != nil {
		return schedulerAcquireError(err)
	}
	defer release()
	s.attachQueueWait(ctx, acquireResult)
	totalTimeout, err := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultStreamTotalTimeout)
	if err != nil {
		return err
	}
	requestBaseCtx, baseCancel := context.WithTimeout(ctx, totalTimeout)
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

	traceID := ulid.Make().String()
	var sequence atomic.Uint64
	send := func(event *runtimev1.StreamScenarioEvent) error {
		event.Sequence = sequence.Add(1)
		event.TraceId = traceID
		event.Timestamp = timestamppb.New(time.Now().UTC())
		return stream.Send(event)
	}
	if err := send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamScenarioEvent_Started{
			Started: &runtimev1.ScenarioStreamStarted{
				ModelResolved: effective.modelResolved(),
				RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	}); err != nil {
		return err
	}
	startFirstPacketTimer()
	if firstPacketTimer != nil {
		defer firstPacketTimer.Stop()
	}

	var textBuffer strings.Builder
	var reasoningBuffer strings.Builder
	flushText := func() error {
		if textBuffer.Len() == 0 {
			return nil
		}
		text := textBuffer.String()
		textBuffer.Reset()
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Text{Text: &runtimev1.TextStreamDelta{Text: text}},
			}},
		})
	}
	flushReasoning := func() error {
		if reasoningBuffer.Len() == 0 {
			return nil
		}
		text := reasoningBuffer.String()
		reasoningBuffer.Reset()
		return send(&runtimev1.StreamScenarioEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamScenarioEvent_Delta{Delta: &runtimev1.ScenarioStreamDelta{
				Delta: &runtimev1.ScenarioStreamDelta_Reasoning{Reasoning: &runtimev1.ReasoningStreamDelta{Text: text}},
			}},
		})
	}
	onDelta := func(delta localexecution.TextDelta) error {
		if delta.Text != "" || delta.Reasoning != "" {
			recordActivity()
		}
		if delta.Text != "" {
			textBuffer.WriteString(delta.Text)
			if textBuffer.Len() >= minStreamChunkBytes {
				if err := flushText(); err != nil {
					return err
				}
			}
		}
		if delta.Reasoning != "" {
			reasoningBuffer.WriteString(delta.Reasoning)
			if reasoningBuffer.Len() >= minStreamChunkBytes {
				return flushReasoning()
			}
		}
		return nil
	}
	if s.localTextHost == nil {
		err = localTextExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad,
			Err:  context.Canceled,
		})
	} else {
		var result localexecution.TextResult
		result, err = s.localTextHost.StreamText(requestCtx, effective.plan, onDelta, nil)
		if err == nil {
			if flushErr := flushReasoning(); flushErr != nil {
				return flushErr
			}
			if flushErr := flushText(); flushErr != nil {
				return flushErr
			}
			if result.FinishReason == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
				result.FinishReason = runtimev1.FinishReason_FINISH_REASON_STOP
			}
			return send(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: result.FinishReason,
					Usage:        localTextUsage(result, effective.request),
				}},
			})
		}
		err = localTextExecutionError(err)
	}
	if requestCtx.Err() != nil && ctx.Err() != nil {
		return err
	}
	if firstPacketTimedOut.Load() || idleTimedOut.Load() || requestCtx.Err() == context.DeadlineExceeded {
		err = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
		Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
			ReasonCode: reasonCodeFromStreamError(err),
			ActionHint: actionHintFromStreamError(err),
		}},
	})
}
