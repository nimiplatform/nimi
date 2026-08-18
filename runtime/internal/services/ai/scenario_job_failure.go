package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.service-operations.r042
// @nimi-authority: rule.nimi.runtime.service-operations.r043
const maxScenarioJobReasonMetadataTokenLength = 120

type scenarioStreamDeliveryFailure struct {
	mu        sync.Mutex
	durable   error
	transport error
}

func (failure *scenarioStreamDeliveryFailure) record(err error) {
	if failure == nil || err == nil {
		return
	}
	failure.mu.Lock()
	defer failure.mu.Unlock()
	if failure.durable == nil {
		failure.durable = scenarioStreamDeliveryError(err)
		failure.transport = err
	}
}

func (failure *scenarioStreamDeliveryFailure) durableCause() error {
	if failure == nil {
		return nil
	}
	failure.mu.Lock()
	defer failure.mu.Unlock()
	return failure.durable
}

func (failure *scenarioStreamDeliveryFailure) transportCause() error {
	if failure == nil {
		return nil
	}
	failure.mu.Lock()
	defer failure.mu.Unlock()
	return failure.transport
}

func scenarioStreamDeliveryError(err error) error {
	code := status.Code(err)
	if code == codes.OK {
		code = codes.Unknown
	}
	retryable := true
	return grpcerr.WrapWithReasonCode(
		code,
		runtimev1.ReasonCode_AI_STREAM_BROKEN,
		err,
		grpcerr.ReasonOptions{
			ActionHint: "retry_or_reopen_stream",
			Retryable:  &retryable,
			Message:    "stream delivery failed",
		},
	)
}

func prepareFailedScenarioJobProjection(job *runtimev1.ScenarioJob) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob is required")
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		return nil
	}
	detail := strings.TrimSpace(job.GetReasonDetail())
	if detail == "" {
		detail = stableScenarioJobReasonDetail(job.GetReasonCode())
	}
	if detail == "" {
		detail = "scenario job failed"
	}
	job.ReasonDetail = detail
	if job.GetReasonMetadata() == nil || len(job.GetReasonMetadata().GetFields()) == 0 {
		job.ReasonMetadata = defaultScenarioJobFailureMetadata(job.GetReasonCode())
	}
	return validateFailedScenarioJobProjection(job)
}

func defaultScenarioJobFailureMetadata(reasonCode runtimev1.ReasonCode) *structpb.Struct {
	return scenarioJobReasonMetadata(grpcerr.WithReasonCode(codes.Internal, reasonCode), reasonCode)
}

func validateFailedScenarioJobProjection(job *runtimev1.ScenarioJob) error {
	if job == nil {
		return fmt.Errorf("ScenarioJob is required")
	}
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		return nil
	}
	if detail := strings.TrimSpace(job.GetReasonDetail()); detail == "" || detail != job.GetReasonDetail() {
		return fmt.Errorf("failed ScenarioJob has no canonical reason detail")
	}
	metadata := job.GetReasonMetadata()
	if metadata == nil || len(metadata.GetFields()) == 0 {
		return fmt.Errorf("failed ScenarioJob has no reason metadata")
	}
	for key, value := range metadata.GetFields() {
		if value == nil {
			return fmt.Errorf("failed ScenarioJob reason metadata %q has no value", key)
		}
		switch key {
		case "action_hint", "failure_stage":
			stringValue, ok := value.GetKind().(*structpb.Value_StringValue)
			if !ok || safeScenarioReasonMetadataToken(stringValue.StringValue, maxScenarioJobReasonMetadataTokenLength) != stringValue.StringValue {
				return fmt.Errorf("failed ScenarioJob reason metadata %q is not a safe token", key)
			}
		case "retryable":
			if _, ok := value.GetKind().(*structpb.Value_BoolValue); !ok {
				return fmt.Errorf("failed ScenarioJob reason metadata %q is not boolean", key)
			}
		default:
			return fmt.Errorf("failed ScenarioJob reason metadata field %q is not allowed", key)
		}
	}
	return nil
}

func (s *Service) finishLocalTextScenarioJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled || reason == runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
	})
}

func (s *Service) finishCloudScenarioJobFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok {
		reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || reason == runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case reason != runtimev1.ReasonCode_AI_STREAM_BROKEN &&
		(errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled):
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
		reason = runtimev1.ReasonCode_ACTION_EXECUTED
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		if jobStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED {
			job.ReasonMetadata = nil
		} else {
			job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		}
	})
}
