package ai

import (
	"context"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"time"
)

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

func reasonCodeFromStreamError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_AI_STREAM_BROKEN
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
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

func withTimeout(ctx context.Context, timeoutMS int32, defaultTimeout time.Duration) (context.Context, context.CancelFunc) {
	duration := timeoutDuration(timeoutMS, defaultTimeout)
	if duration <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, duration)
}

func timeoutDuration(timeoutMS int32, defaultTimeout time.Duration) time.Duration {
	duration := defaultTimeout
	if timeoutMS > 0 {
		requested := time.Duration(timeoutMS) * time.Millisecond
		if requested < defaultTimeout {
			duration = requested
		}
	}
	return duration
}
