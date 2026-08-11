package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const maxRuntimeRequestTimeout = 5 * time.Minute
const maxLocalImageJobTimeout = 60 * time.Minute
const minLocalImageJobTimeout = 20 * time.Minute
const maxLocalSpeechJobTimeout = 30 * time.Minute

func (s *Service) attachQueueWaitUnary(ctx context.Context, result scheduler.AcquireResult) {
	waitMs := s.attachQueueWait(ctx, result)
	_ = grpc.SetTrailer(ctx, usagemetrics.QueueWaitTrailer(waitMs))
}

func (s *Service) attachQueueWait(ctx context.Context, result scheduler.AcquireResult) int64 {
	waitMs := maxInt64(result.Waited.Milliseconds(), 0)
	usagemetrics.SetQueueWaitMS(ctx, waitMs)
	return waitMs
}

func (s *Service) logQueueWait(operation string, appID string, result scheduler.AcquireResult) {
	if s.logger == nil {
		return
	}
	waitMs := result.Waited.Milliseconds()
	if waitMs <= 0 {
		return
	}
	if result.Starved {
		s.logger.Warn("scheduler starvation threshold reached", "operation", operation, "app_id", appID, "queue_wait_ms", waitMs)
		return
	}
	s.logger.Debug("scheduler queue wait", "operation", operation, "app_id", appID, "queue_wait_ms", waitMs)
}

func (s *Service) acquireAsyncScenarioJobLease(ctx context.Context, appID string, operation string) (func(), error) {
	release, result, err := s.scheduler.Acquire(ctx, appID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, grpcerr.WrapWithReasonCode(
				codes.DeadlineExceeded,
				runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
				err,
				grpcerr.ReasonOptions{
					ActionHint: "retry_with_a_longer_timeout",
					Message:    "runtime scheduler wait exceeded the scenario job deadline",
				},
			)
		}
		return nil, schedulerAcquireError(err)
	}
	s.attachQueueWait(ctx, result)
	s.logQueueWait(operation, appID, result)
	return release, nil
}

func schedulerAcquireError(err error) error {
	return grpcerr.WrapWithReasonCode(
		codes.ResourceExhausted,
		runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		err,
		grpcerr.ReasonOptions{
			ActionHint: "retry_or_reduce_concurrent_requests",
			Message:    "runtime scheduler could not admit the request",
		},
	)
}

func reasonCodeFromStreamError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_AI_STREAM_BROKEN
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return reason
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_AI_STREAM_BROKEN
	}
	if value, exists := runtimev1.ReasonCode_value[st.Message()]; exists {
		return runtimev1.ReasonCode(value)
	}
	switch st.Code() {
	case codes.InvalidArgument:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case codes.NotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case codes.DeadlineExceeded:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case codes.Unavailable:
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
	default:
		return runtimev1.ReasonCode_AI_STREAM_BROKEN
	}
}

func actionHintFromStreamError(err error) string {
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if actionHint := strings.TrimSpace(metadata["action_hint"]); actionHint != "" {
			return actionHint
		}
	}
	return "retry_or_reopen_stream"
}

func withTimeout(ctx context.Context, timeoutMS int32, defaultTimeout time.Duration) (context.Context, context.CancelFunc, error) {
	duration, err := timeoutDuration(timeoutMS, defaultTimeout)
	if err != nil {
		return nil, nil, err
	}
	if duration <= 0 {
		requestCtx, cancel := context.WithCancel(ctx)
		return requestCtx, cancel, nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, duration)
	return requestCtx, cancel, nil
}

func timeoutDuration(timeoutMS int32, defaultTimeout time.Duration) (time.Duration, error) {
	if timeoutMS == 0 {
		return clampTimeoutDuration(defaultTimeout), nil
	}
	duration := time.Duration(timeoutMS) * time.Millisecond
	if duration <= 0 || duration > maxRuntimeRequestTimeout {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return duration, nil
}

func localImageJobTimeoutDuration(timeoutMS int32) (time.Duration, error) {
	if timeoutMS == 0 {
		return minLocalImageJobTimeout, nil
	}
	duration := time.Duration(timeoutMS) * time.Millisecond
	if duration < minLocalImageJobTimeout || duration > maxLocalImageJobTimeout {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return duration, nil
}

func scenarioJobTimeoutDuration(
	req *runtimev1.SubmitScenarioJobRequest,
	defaultTimeout time.Duration,
	localRoute bool,
) (time.Duration, error) {
	timeoutMS := int32(0)
	scenarioType := runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED
	if req != nil {
		scenarioType = req.GetScenarioType()
		if head := req.GetHead(); head != nil {
			timeoutMS = head.GetTimeoutMs()
		}
	}
	if timeoutMS == 0 {
		return clampScenarioJobTimeoutDuration(defaultTimeout, scenarioType, localRoute), nil
	}
	duration := time.Duration(timeoutMS) * time.Millisecond
	maxDuration := maxRuntimeRequestTimeout
	if localRoute && (scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE ||
		scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE) {
		maxDuration = maxLocalSpeechJobTimeout
	}
	if duration <= 0 || duration > maxDuration {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return duration, nil
}

func scenarioJobUsesDetachedPolling(scenarioType runtimev1.ScenarioType, adapterName string) bool {
	return capabilitydriver.CloudMediaUsesDetachedPolling(scenarioType, strings.TrimSpace(adapterName))
}

func clampTimeoutDuration(duration time.Duration) time.Duration {
	if duration <= 0 {
		return 0
	}
	if duration > maxRuntimeRequestTimeout {
		return maxRuntimeRequestTimeout
	}
	return duration
}

func clampScenarioJobTimeoutDuration(
	duration time.Duration,
	scenarioType runtimev1.ScenarioType,
	localRoute bool,
) time.Duration {
	if duration <= 0 {
		return 0
	}
	maxDuration := maxRuntimeRequestTimeout
	if localRoute && (scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE ||
		scenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE) {
		maxDuration = maxLocalSpeechJobTimeout
	}
	if duration > maxDuration {
		return maxDuration
	}
	return duration
}
