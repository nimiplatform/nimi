package localservice

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func (s *Service) StartLocalEnvironmentDependencyJob(ctx context.Context, req *runtimev1.StartLocalEnvironmentDependencyJobRequest) (*runtimev1.StartLocalEnvironmentDependencyJobResponse, error) {
	if !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency setup requires explicit confirmation", "confirm_local_environment_dependency")
	}
	consumerScope := s.localEnvironmentDependencyJobConsumerScope(req.GetEnvironmentKey(), req.GetDependencyFamily(), req.GetDependencyId(), req.GetConsumerScope())
	if strings.TrimSpace(consumerScope) == "" {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency consumer scope is ambiguous", "refresh_local_environment_plan")
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   req.GetEnvironmentKey(),
		DependencyFamily: req.GetDependencyFamily(),
		DependencyID:     req.GetDependencyId(),
		ConsumerScope:    consumerScope,
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
	consumerScope := s.localEnvironmentDependencyJobConsumerScope(previous.EnvironmentKey, previous.DependencyFamily, previous.DependencyID, previous.ConsumerScope)
	if strings.TrimSpace(consumerScope) == "" {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency retry has no consumer scope", "refresh_local_environment_plan")
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   previous.EnvironmentKey,
		DependencyFamily: previous.DependencyFamily,
		DependencyID:     previous.DependencyID,
		ConsumerScope:    consumerScope,
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
	family := strings.TrimSpace(req.GetDependencyFamily())
	dependencyID := strings.TrimSpace(req.GetDependencyId())
	consumerScope := s.localEnvironmentDependencyJobConsumerScope(environmentKey, family, dependencyID, req.GetConsumerScope())
	if strings.TrimSpace(consumerScope) == "" {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency repair consumer scope is ambiguous", "refresh_local_environment_plan")
	}
	record, ok := s.markLocalEnvironmentDependencyRepairRequired(environmentKey, family, dependencyID, consumerScope, req.GetReasonCode())
	if !ok {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency has no selected source record to repair", "refresh_local_environment_plan")
	}
	if family == "" {
		family = record.DependencyFamily
	}
	if dependencyID == "" {
		dependencyID = record.DependencyID
	}
	job, err := s.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: family,
		DependencyID:     dependencyID,
		ConsumerScope:    consumerScope,
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

func (s *Service) localEnvironmentDependencyJobConsumerScope(environmentKey string, dependencyFamily string, dependencyID string, preferred string) string {
	if consumer := strings.TrimSpace(preferred); consumer != "" {
		return consumer
	}
	key := strings.TrimSpace(environmentKey)
	if contract, ok := s.localEnvironmentPlanDependencyContractForStart(key, dependencyFamily, dependencyID); ok {
		return strings.TrimSpace(contract.ConsumerScope)
	}
	switch strings.TrimSpace(dependencyFamily) {
	case localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		if consumers := pythonSelectedConsumersForDependency(dependencyID); len(consumers) == 1 {
			return consumers[0]
		}
	}
	if record, ok := s.localEnvironmentSelectedSourceRecordForRepair(key, dependencyFamily, dependencyID, ""); ok {
		consumers := normalizeStringSlice(record.SelectedConsumers)
		if len(consumers) == 1 {
			return consumers[0]
		}
	}
	if consumer := localEnvironmentConsumerScopeFromKey(key); consumer != "" {
		return consumer
	}
	return ""
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
	case localEnvironmentFamilyNativeLlama:
		return s.executeNativeLlamaEnvironmentDependencyJob
	case localEnvironmentFamilyNativeSDCPP:
		return s.executeNativeSDCPPEnvironmentDependencyJob
	case localEnvironmentFamilyPythonUV:
		return s.executePythonUVEnvironmentDependencyJob
	case localEnvironmentFamilyPythonRuntime:
		return s.executePythonRuntimeEnvironmentDependencyJob
	case localEnvironmentFamilyPythonVenv:
		return s.executePythonVenvEnvironmentDependencyJob
	case localEnvironmentFamilyPythonPackageSet:
		return s.executePythonPackageSetEnvironmentDependencyJob
	case localEnvironmentFamilyPythonTorchWheel:
		return s.executePythonTorchWheelEnvironmentDependencyJob
	case localEnvironmentFamilyModelAsset:
		return s.executeModelAssetEnvironmentDependencyJob
	case localEnvironmentFamilyModelCompanion:
		return s.executeModelCompanionEnvironmentDependencyJob
	default:
		return func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
			return localEnvironmentDependencyJobResult{}, errors.New("no admitted Runtime materializer for dependency family " + strings.TrimSpace(family))
		}
	}
}

func localEnvironmentJobControlError(code codes.Code, message string, actionHint string) error {
	return grpcerr.WithReasonCodeOptions(code, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE, grpcerr.ReasonOptions{
		Message:    strings.TrimSpace(message),
		ActionHint: strings.TrimSpace(actionHint),
	})
}
