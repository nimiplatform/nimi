package localservice

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) StartLocalEnvironmentDependencyJob(ctx context.Context, req *runtimev1.StartLocalEnvironmentDependencyJobRequest) (*runtimev1.StartLocalEnvironmentDependencyJobResponse, error) {
	if !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency setup requires explicit confirmation", "confirm_local_environment_dependency")
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   req.GetEnvironmentKey(),
		DependencyFamily: req.GetDependencyFamily(),
		DependencyID:     req.GetDependencyId(),
		SourceKind:       req.GetSourceKind(),
	}, s.localEnvironmentDependencyJobExecutor(req.GetDependencyFamily()))
	if err != nil {
		if job.JobID != "" {
			return &runtimev1.StartLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
		}
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, err.Error(), "inspect_local_environment_dependency")
	}
	return &runtimev1.StartLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
}

func (s *Service) CancelLocalEnvironmentDependencyJob(_ context.Context, req *runtimev1.CancelLocalEnvironmentDependencyJobRequest) (*runtimev1.CancelLocalEnvironmentDependencyJobResponse, error) {
	job, ok := s.cancelLocalEnvironmentDependencyJob(req.GetJobId())
	if !ok {
		return nil, localEnvironmentJobControlError(codes.NotFound, "local environment dependency job not found", "refresh_local_environment_jobs")
	}
	return &runtimev1.CancelLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
}

func (s *Service) RetryLocalEnvironmentDependencyJob(ctx context.Context, req *runtimev1.RetryLocalEnvironmentDependencyJobRequest) (*runtimev1.RetryLocalEnvironmentDependencyJobResponse, error) {
	if !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency retry requires explicit confirmation", "confirm_local_environment_dependency_retry")
	}
	previous, ok := s.localEnvironmentDependencyJob(req.GetJobId())
	if !ok {
		return nil, localEnvironmentJobControlError(codes.NotFound, "local environment dependency job not found", "refresh_local_environment_jobs")
	}
	if !localEnvironmentDependencyJobTerminal(previous.State) {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency job is still active", "wait_for_local_environment_job")
	}
	if !previous.Retryable {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency job is not retryable", "inspect_local_environment_dependency")
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   previous.EnvironmentKey,
		DependencyFamily: previous.DependencyFamily,
		DependencyID:     previous.DependencyID,
		SourceKind:       previous.SourceKind,
	}, s.localEnvironmentDependencyJobExecutor(previous.DependencyFamily))
	if err != nil {
		if job.JobID != "" {
			return &runtimev1.RetryLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
		}
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, err.Error(), "inspect_local_environment_dependency")
	}
	return &runtimev1.RetryLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
}

func (s *Service) RepairLocalEnvironmentDependency(ctx context.Context, req *runtimev1.RepairLocalEnvironmentDependencyRequest) (*runtimev1.RepairLocalEnvironmentDependencyResponse, error) {
	if !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency repair requires explicit confirmation", "confirm_local_environment_dependency_repair")
	}
	environmentKey := strings.TrimSpace(req.GetEnvironmentKey())
	record, ok := s.markLocalEnvironmentDependencyRepairRequired(environmentKey, req.GetReasonCode())
	if !ok {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency has no selected source record to repair", "refresh_local_environment_plan")
	}
	family := strings.TrimSpace(req.GetDependencyFamily())
	if family == "" {
		family = record.DependencyFamily
	}
	dependencyID := strings.TrimSpace(req.GetDependencyId())
	if dependencyID == "" {
		dependencyID = record.DependencyID
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: family,
		DependencyID:     dependencyID,
		SourceKind:       record.SourceKind,
	}, s.localEnvironmentDependencyJobExecutor(family))
	if err != nil {
		if job.JobID != "" {
			return &runtimev1.RepairLocalEnvironmentDependencyResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
		}
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, err.Error(), "inspect_local_environment_dependency")
	}
	return &runtimev1.RepairLocalEnvironmentDependencyResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
}

func (s *Service) localEnvironmentDependencyJob(reqID string) (localEnvironmentDependencyJobState, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.localEnvironmentDependencyJobs[strings.TrimSpace(reqID)]
	return job, ok
}

func (s *Service) localEnvironmentDependencyJobExecutor(family string) localEnvironmentDependencyJobExecutor {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyCUDA:
		return s.executeCUDAEnvironmentDependencyJob
	default:
		return func(context.Context, localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
			return localEnvironmentDependencyJobResult{}, errors.New("no admitted Runtime materializer for dependency family " + strings.TrimSpace(family))
		}
	}
}

func (s *Service) executeCUDAEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState) (localEnvironmentDependencyJobResult, error) {
	if normalizeLocalRuntimeDependencyID(job.DependencyID) != cudaUserSpaceRuntimeDependencyID {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	status, err := mgr.EnsureSharedAcceleratorDependency(ctx, cudaUserSpaceRuntimeDependencyID)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	return localEnvironmentDependencyJobResultFromSharedAcceleratorStatus(status), nil
}

func localEnvironmentDependencyJobResultFromSharedAcceleratorStatus(status engine.SharedAcceleratorDependencyStatus) localEnvironmentDependencyJobResult {
	switch status.State {
	case engine.SharedAcceleratorDependencyReadySystem:
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadySystem,
			SourceKind:            localEnvironmentSourceSystem,
			CanonicalRoot:         strings.TrimSpace(status.CanonicalRoot),
			CompatibilityEvidence: []string{strings.TrimSpace(status.Detail)},
			VerifiedArtifacts:     normalizeStringSlice(status.RequiredArtifacts),
			SelectedConsumers:     normalizeStringSlice([]string{status.ConsumerID}),
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_SYSTEM",
		}
	case engine.SharedAcceleratorDependencyReadyManaged:
		return localEnvironmentDependencyJobResult{
			State:                 localEnvironmentStateReadyManaged,
			SourceKind:            localEnvironmentSourceManaged,
			CanonicalRoot:         strings.TrimSpace(status.CanonicalRoot),
			CompatibilityEvidence: []string{strings.TrimSpace(status.Detail)},
			VerifiedArtifacts:     normalizeStringSlice(status.RequiredArtifacts),
			SelectedConsumers:     normalizeStringSlice([]string{status.ConsumerID}),
			AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
		}
	case engine.SharedAcceleratorDependencyRepairRequired:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}
	case engine.SharedAcceleratorDependencyUnsupported:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}
	default:
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNAVAILABLE",
		}
	}
}

func localEnvironmentJobControlError(code codes.Code, message string, actionHint string) error {
	return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    strings.TrimSpace(message),
		ActionHint: strings.TrimSpace(actionHint),
	})
}
