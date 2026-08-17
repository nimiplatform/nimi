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
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
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

	job, jobCtx, err := s.captureImmediateLocalScenarioJob(
		ctx, req.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), ignored,
		effective.effectiveInputIdentity, effective.resolvedAssembly,
	)
	if err != nil {
		return nil, err
	}
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return nil, err
	}

	release, acquireResult, err := s.scheduler.Acquire(jobCtx, req.GetHead().GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, executionErr)
		return nil, executionErr
	}
	defer release()
	s.attachQueueWaitUnary(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return nil, err
	}
	captured, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	executionEffective, err := s.localTextEffectiveInputsFromResolvedAssembly(captured)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	requestCtx, cancel, err := withTimeout(jobCtx, req.GetHead().GetTimeoutMs(), defaultGenerateTimeout)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return nil, err
	}
	defer cancel()

	result, err := s.executeCapturedLocalText(requestCtx, executionEffective, nil)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return nil, err
	}
	usage := localTextUsage(result, executionEffective.request)
	artifact := nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(result.Text), map[string]any{"finish_reason": result.FinishReason.String()})
	if err := s.completeImmediateScenarioJob(jobID, []*runtimev1.ScenarioArtifact{artifact}, usage); err != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return nil, err
	}
	return &runtimev1.ExecuteScenarioResponse{
		Output: &runtimev1.ScenarioOutput{
			Output: &runtimev1.ScenarioOutput_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateOutput{Text: result.Text},
			},
		},
		FinishReason:      result.FinishReason,
		Usage:             usage,
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		TraceId:           job.GetTraceId(),
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

	job, jobCtx, err := s.captureImmediateLocalScenarioJob(
		ctx, req.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		runtimev1.ExecutionMode_EXECUTION_MODE_STREAM, effective.modelResolved(), nil,
		effective.effectiveInputIdentity, effective.resolvedAssembly,
	)
	if err != nil {
		return err
	}
	jobID := job.GetJobId()
	defer s.finishScenarioJobExecution(jobID)
	defer func() {
		if current, ok := s.scenarioJobs.get(jobID); ok && !isTerminalScenarioJobStatus(current.GetStatus()) {
			s.finishLocalTextScenarioJobFailure(jobCtx, jobID, grpcerr.WithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED))
		}
	}()
	if err := s.queueImmediateScenarioJob(jobID); err != nil {
		return err
	}

	release, acquireResult, err := s.scheduler.Acquire(jobCtx, req.GetHead().GetAppId())
	if err != nil {
		executionErr := schedulerAcquireError(err)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, executionErr)
		return executionErr
	}
	defer release()
	s.attachQueueWait(jobCtx, acquireResult)
	if err := s.startImmediateScenarioJob(jobID); err != nil {
		return err
	}
	captured, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		err := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return err
	}
	executionEffective, err := s.localTextEffectiveInputsFromResolvedAssembly(captured)
	if err != nil {
		s.finishLocalTextScenarioJobFailure(jobCtx, jobID, err)
		return err
	}
	totalTimeout, err := timeoutDuration(req.GetHead().GetTimeoutMs(), defaultStreamTotalTimeout)
	if err != nil {
		return err
	}
	requestBaseCtx, baseCancel := context.WithTimeout(jobCtx, totalTimeout)
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

	traceID := job.GetTraceId()
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
		result, err = s.localTextHost.StreamText(requestCtx, executionEffective.plan, onDelta, nil)
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
			usage := localTextUsage(result, executionEffective.request)
			artifact := nimillm.BinaryArtifact("text/plain; charset=utf-8", []byte(result.Text), map[string]any{"finish_reason": result.FinishReason.String()})
			if completeErr := s.completeImmediateScenarioJob(jobID, []*runtimev1.ScenarioArtifact{artifact}, usage); completeErr != nil {
				s.finishLocalTextScenarioJobFailure(requestCtx, jobID, completeErr)
				return completeErr
			}
			return send(&runtimev1.StreamScenarioEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
				Payload: &runtimev1.StreamScenarioEvent_Completed{Completed: &runtimev1.ScenarioStreamCompleted{
					FinishReason: result.FinishReason,
					Usage:        usage,
				}},
			})
		}
		err = localTextExecutionError(err)
	}
	if requestCtx.Err() != nil && ctx.Err() != nil {
		s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
		return err
	}
	if firstPacketTimedOut.Load() || idleTimedOut.Load() || requestCtx.Err() == context.DeadlineExceeded {
		err = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
	}
	s.finishLocalTextScenarioJobFailure(requestCtx, jobID, err)
	return send(&runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
		Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
			ReasonCode: reasonCodeFromStreamError(err),
			ActionHint: actionHintFromStreamError(err),
		}},
	})
}
