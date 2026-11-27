package ai

import (
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	outcomeUncertainActionHint    = "confirm_outcome_and_charges_before_new_request"
	callerMayResubmitActionHint   = "resubmit_request"
	outcomeUncertainBillingNotice = "Original cloud request outcome is unknown and charges may already have accrued. Confirm outcome and charges before starting a new request, which may incur additional charges."
)

type immediateExecutionTrackerKey struct{}

type immediateExecutionTracker struct {
	isCloud          atomic.Bool
	dispatchPossible atomic.Bool
	partialOutput    atomic.Bool
}

func withImmediateExecutionTracker(ctx context.Context) context.Context {
	if immediateExecutionTrackerFromContext(ctx) != nil {
		return ctx
	}
	return context.WithValue(ctx, immediateExecutionTrackerKey{}, &immediateExecutionTracker{})
}

func immediateExecutionTrackerFromContext(ctx context.Context) *immediateExecutionTracker {
	if ctx == nil {
		return nil
	}
	tracker, _ := ctx.Value(immediateExecutionTrackerKey{}).(*immediateExecutionTracker)
	return tracker
}

func markImmediateCloudExecution(ctx context.Context) {
	if tracker := immediateExecutionTrackerFromContext(ctx); tracker != nil {
		tracker.isCloud.Store(true)
	}
}

func markImmediateCloudDispatchPossible(ctx context.Context) {
	if tracker := immediateExecutionTrackerFromContext(ctx); tracker != nil {
		tracker.isCloud.Store(true)
		tracker.dispatchPossible.Store(true)
	}
}

func markImmediatePartialOutput(ctx context.Context) {
	if tracker := immediateExecutionTrackerFromContext(ctx); tracker != nil {
		tracker.partialOutput.Store(true)
	}
}

func immediateCloudDispatchPossible(ctx context.Context) bool {
	tracker := immediateExecutionTrackerFromContext(ctx)
	return tracker != nil && tracker.isCloud.Load() && tracker.dispatchPossible.Load()
}

func immediatePartialOutputObserved(ctx context.Context) bool {
	tracker := immediateExecutionTrackerFromContext(ctx)
	return tracker != nil && tracker.partialOutput.Load()
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r122
func runtimeRestartExecutionError() error {
	retryable := true
	base := grpcerr.WithReasonCodeOptions(
		codes.Unavailable,
		runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED,
		grpcerr.ReasonOptions{
			ActionHint: callerMayResubmitActionHint,
			Retryable:  &retryable,
			Message:    "Runtime restarted before execution completed",
		},
	)
	st, ok := status.FromError(base)
	if !ok {
		return base
	}
	detailed, err := st.WithDetails(runtimeRestartExecutionInterruption())
	if err != nil {
		return base
	}
	return detailed.Err()
}

func outcomeUncertainExecutionInterruption(isRestart bool) *runtimev1.ExecutionInterruption {
	cause := runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED
	if isRestart {
		cause = runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART
	}
	return &runtimev1.ExecutionInterruption{
		Cause:               cause,
		ResubmitDisposition: runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN,
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r122
func outcomeUncertainExecutionError(causeErr error, isRestart bool) error {
	retryable := false
	var (
		code   codes.Code
		reason runtimev1.ReasonCode
		msg    string
	)
	if isRestart {
		code = codes.Unavailable
		reason = runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED
		msg = "Runtime restarted after cloud request dispatch. " + outcomeUncertainBillingNotice
	} else {
		code = status.Code(causeErr)
		if errors.Is(causeErr, context.DeadlineExceeded) {
			code = codes.DeadlineExceeded
		} else if errors.Is(causeErr, context.Canceled) {
			code = codes.Canceled
		} else if code == codes.OK {
			code = codes.Unavailable
		}
		var hasReason bool
		reason, hasReason = grpcerr.ExtractReasonCode(causeErr)
		if !hasReason || reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			switch code {
			case codes.DeadlineExceeded:
				reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
			case codes.Canceled:
				reason = runtimev1.ReasonCode_ACTION_EXECUTED
			case codes.Unavailable:
				reason = runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			default:
				reason = runtimev1.ReasonCode_AI_STREAM_BROKEN
			}
		}
		baseMsg := ""
		if publicMsg, ok := grpcerr.ExtractPublicMessage(causeErr); ok {
			baseMsg = strings.TrimSpace(publicMsg)
		}
		if baseMsg == "" {
			switch {
			case code == codes.Canceled:
				baseMsg = "Cloud request was canceled after dispatch."
			case code == codes.DeadlineExceeded || reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
				baseMsg = "Cloud provider request timed out after dispatch."
			case reason == runtimev1.ReasonCode_AI_STREAM_BROKEN:
				baseMsg = "Cloud streaming response was interrupted after dispatch."
			default:
				baseMsg = "Cloud provider response was lost after dispatch."
			}
		}
		if strings.Contains(strings.ToLower(baseMsg), "charges") && strings.Contains(strings.ToLower(baseMsg), "unknown") {
			msg = baseMsg
		} else {
			if !strings.HasSuffix(baseMsg, ".") {
				baseMsg += "."
			}
			msg = baseMsg + " " + outcomeUncertainBillingNotice
		}
	}
	base := grpcerr.WithReasonCodeOptions(
		code,
		reason,
		grpcerr.ReasonOptions{
			ActionHint: outcomeUncertainActionHint,
			Retryable:  &retryable,
			Message:    msg,
		},
	)
	st, ok := status.FromError(base)
	if !ok {
		return base
	}
	detailed, err := st.WithDetails(outcomeUncertainExecutionInterruption(isRestart))
	if err != nil {
		return base
	}
	return detailed.Err()
}

func (s *Service) BeginRuntimeRestart() {
	if s != nil {
		s.runtimeRestarting.Store(true)
	}
}

func (s *Service) isRuntimeRestartShutdown(ctx context.Context) bool {
	return s != nil && s.runtimeRestarting.Load() && rpcctx.WasServerShutdown(ctx)
}

func isUncertainCloudImmediateError(ctx context.Context, err error) bool {
	if err == nil || !immediateCloudDispatchPossible(ctx) {
		return false
	}
	if executionInterruptionFromError(err) != nil {
		return false
	}
	ctxEnded := ctx != nil && ctx.Err() != nil
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || ctxEnded {
		return true
	}
	code := status.Code(err)
	if code == codes.DeadlineExceeded || code == codes.Canceled {
		return true
	}
	reason, hasReason := grpcerr.ExtractReasonCode(err)
	metadata, _ := grpcerr.ExtractReasonMetadata(err)
	if hasReason {
		switch reason {
		case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			runtimev1.ReasonCode_AI_STREAM_BROKEN:
			return true
		case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			runtimev1.ReasonCode_AI_MODEL_NOT_READY,
			runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
			runtimev1.ReasonCode_AI_CONFIG_INVALID,
			runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND,
			runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING,
			runtimev1.ReasonCode_AI_CONNECTOR_DISABLED,
			runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND,
			runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE,
			runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH,
			runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
			runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED,
			runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED,
			runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
			runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
			runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN,
			runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE:
			return false
		case runtimev1.ReasonCode_AI_OUTPUT_INVALID:
			return immediatePartialOutputObserved(ctx)
		}
	}
	if rawStatus := strings.TrimSpace(metadata["provider_http_status"]); rawStatus != "" {
		if httpStatus, parseErr := strconv.Atoi(rawStatus); parseErr == nil && httpStatus >= 400 && httpStatus < 500 {
			return false
		}
	}
	return true
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r122
func immediateProviderConnectionError(ctx context.Context, err error) error {
	tracker := immediateExecutionTrackerFromContext(ctx)
	if tracker == nil || !tracker.isCloud.Load() || tracker.dispatchPossible.Load() {
		return err
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || (reason != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE && reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT) {
		return err
	}
	var dialError *net.OpError
	var dnsError *net.DNSError
	if !(errors.As(err, &dialError) && dialError.Op == "dial") &&
		!errors.Is(err, endpointsec.ErrDNSResolution) && !errors.As(err, &dnsError) {
		return err
	}
	retryable := true
	return grpcerr.WrapWithReasonCode(status.Code(err), reason, err, grpcerr.ReasonOptions{
		ActionHint: callerMayResubmitActionHint,
		Retryable:  &retryable,
		Message:    "The Runtime could not connect to the cloud provider.",
	})
}

func (s *Service) projectImmediateExecutionError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if s.isRuntimeRestartShutdown(ctx) {
		if existing := executionInterruptionFromError(err); existing != nil {
			if immediateCloudDispatchPossible(ctx) &&
				existing.GetResubmitDisposition() != runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN {
				return outcomeUncertainExecutionError(err, true)
			}
			return err
		}
		if immediateCloudDispatchPossible(ctx) {
			return outcomeUncertainExecutionError(err, true)
		}
		return runtimeRestartExecutionError()
	}
	if isUncertainCloudImmediateError(ctx, err) {
		return outcomeUncertainExecutionError(err, false)
	}
	return immediateProviderConnectionError(ctx, err)
}

func executionInterruptionFromError(err error) *runtimev1.ExecutionInterruption {
	st, ok := status.FromError(err)
	if !ok {
		return nil
	}
	for _, detail := range st.Details() {
		interruption, ok := detail.(*runtimev1.ExecutionInterruption)
		if !ok {
			continue
		}
		cause := interruption.GetCause()
		disposition := interruption.GetResubmitDisposition()
		validRestart := cause == runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_RUNTIME_RESTART &&
			(disposition == runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_CALLER_MAY_RESUBMIT ||
				disposition == runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN)
		validUncertain := cause == runtimev1.ExecutionInterruptionCause_EXECUTION_INTERRUPTION_CAUSE_UNSPECIFIED &&
			disposition == runtimev1.ExecutionResubmitDisposition_EXECUTION_RESUBMIT_DISPOSITION_OUTCOME_UNCERTAIN
		if !validRestart && !validUncertain {
			continue
		}
		cloned, _ := proto.Clone(interruption).(*runtimev1.ExecutionInterruption)
		return cloned
	}
	return nil
}

type runtimeRestartScenarioStream struct {
	grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]
	service      *Service
	mu           sync.Mutex
	lastSequence uint64
	traceID      string
	terminal     bool
}

func newRuntimeRestartScenarioStream(service *Service, stream grpc.ServerStreamingServer[runtimev1.StreamScenarioEvent]) *runtimeRestartScenarioStream {
	return &runtimeRestartScenarioStream{ServerStreamingServer: stream, service: service}
}

func (stream *runtimeRestartScenarioStream) Send(event *runtimev1.StreamScenarioEvent) error {
	if stream == nil || stream.ServerStreamingServer == nil || event == nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	stream.mu.Lock()
	defer stream.mu.Unlock()
	if stream.terminal {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if err := stream.ServerStreamingServer.Send(event); err != nil {
		return err
	}
	if event.GetSequence() > stream.lastSequence {
		stream.lastSequence = event.GetSequence()
	}
	if event.GetTraceId() != "" {
		stream.traceID = event.GetTraceId()
	}
	if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_COMPLETED ||
		event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		stream.terminal = true
	}
	return nil
}

func (stream *runtimeRestartScenarioStream) finish(err error) error {
	if err == nil || stream == nil {
		return err
	}
	ctx := stream.Context()
	if !stream.service.isRuntimeRestartShutdown(ctx) {
		stream.mu.Lock()
		terminal := stream.terminal
		stream.mu.Unlock()
		if terminal {
			return err
		}
		return stream.service.projectImmediateExecutionError(ctx, err)
	}
	stream.mu.Lock()
	terminal := stream.terminal
	sequence := stream.lastSequence + 1
	traceID := stream.traceID
	stream.mu.Unlock()
	if terminal {
		return err
	}
	interruptionErr := stream.service.projectImmediateExecutionError(ctx, err)
	failure := &runtimev1.StreamScenarioEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
		Sequence:  sequence,
		TraceId:   traceID,
		Timestamp: timestamppb.New(time.Now().UTC()),
		Payload: &runtimev1.StreamScenarioEvent_Failed{Failed: &runtimev1.ScenarioStreamFailed{
			ReasonCode:   runtimev1.ReasonCode_AI_EXECUTION_INTERRUPTED,
			ActionHint:   actionHintFromStreamError(interruptionErr),
			Interruption: executionInterruptionFromError(interruptionErr),
		}},
	}
	if sendErr := stream.Send(failure); sendErr != nil {
		return interruptionErr
	}
	return nil
}
