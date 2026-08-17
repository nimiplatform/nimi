package localservice

import (
	"context"
	"errors"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

type localEnvironmentPlanApplyActionKind string

const (
	localEnvironmentPlanApplyStart  localEnvironmentPlanApplyActionKind = "start"
	localEnvironmentPlanApplyRetry  localEnvironmentPlanApplyActionKind = "retry"
	localEnvironmentPlanApplyRepair localEnvironmentPlanApplyActionKind = "repair"
	localEnvironmentPlanApplyReuse  localEnvironmentPlanApplyActionKind = "reuse"
)

type localEnvironmentPlanApplyAction struct {
	Kind       localEnvironmentPlanApplyActionKind
	Dependency localEnvironmentPlanDependency
	Job        localEnvironmentDependencyJobState
}

func (s *Service) StartLocalEnvironmentDependencyJob(ctx context.Context, req *runtimev1.StartLocalEnvironmentDependencyJobRequest) (*runtimev1.StartLocalEnvironmentDependencyJobResponse, error) {
	s.localEnvironmentPlanApplyMu.Lock()
	defer s.localEnvironmentPlanApplyMu.Unlock()
	return s.startLocalEnvironmentDependencyJobConfirmed(ctx, req)
}

func (s *Service) startLocalEnvironmentDependencyJobConfirmed(ctx context.Context, req *runtimev1.StartLocalEnvironmentDependencyJobRequest) (*runtimev1.StartLocalEnvironmentDependencyJobResponse, error) {
	if !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency setup requires explicit confirmation", "confirm_local_environment_dependency")
	}
	consumerScope := s.localEnvironmentDependencyJobConsumerScope(req.GetEnvironmentKey(), req.GetDependencyFamily(), req.GetDependencyId(), req.GetConsumerScope())
	if strings.TrimSpace(consumerScope) == "" {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency consumer scope is ambiguous", "refresh_local_environment_plan")
	}
	if localEnvironmentDependencyProfileStartRequiresPlanContract(req.GetDependencyFamily()) {
		if _, ok := s.localEnvironmentPlanDependencyContract(req.GetEnvironmentKey(), req.GetDependencyFamily(), req.GetDependencyId(), consumerScope); !ok {
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency profile is not admitted by the current plan", "refresh_local_environment_plan")
		}
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

func (s *Service) ApplyLocalEnvironmentPlan(ctx context.Context, req *runtimev1.ApplyLocalEnvironmentPlanRequest) (*runtimev1.ApplyLocalEnvironmentPlanResponse, error) {
	if req == nil || !req.GetConfirmed() {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment plan apply requires one explicit capability confirmation", "confirm_local_environment_plan")
	}
	s.localEnvironmentPlanApplyMu.Lock()
	defer s.localEnvironmentPlanApplyMu.Unlock()

	resolution := req.GetResolution()
	if resolution == nil {
		return nil, localEnvironmentJobControlError(codes.InvalidArgument, "local environment plan apply requires the original plan resolution input", "refresh_local_environment_plan")
	}
	plan, err := s.resolveLocalEnvironmentPlanForApply(resolution)
	if err != nil {
		return nil, err
	}
	expectedPlanID := strings.TrimSpace(req.GetExpectedPlanId())
	if expectedPlanID == "" || expectedPlanID != plan.PlanID {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment plan changed after confirmation", "refresh_local_environment_plan")
	}
	if !localEnvironmentPlanHasCompleteConfirmation(plan) {
		return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment plan confirmation projection is incomplete", "refresh_local_environment_plan")
	}
	actions, err := s.prepareLocalEnvironmentPlanApplyActions(plan)
	if err != nil {
		return nil, err
	}

	jobs := make([]*runtimev1.LocalEnvironmentDependencyJob, 0, len(actions))
	jobIDs := make(map[string]struct{}, len(actions))
	appendJob := func(job *runtimev1.LocalEnvironmentDependencyJob) {
		if job == nil || strings.TrimSpace(job.GetJobId()) == "" {
			return
		}
		if _, exists := jobIDs[job.GetJobId()]; exists {
			return
		}
		jobIDs[job.GetJobId()] = struct{}{}
		jobs = append(jobs, job)
	}
	for _, action := range actions {
		dep := action.Dependency
		switch action.Kind {
		case localEnvironmentPlanApplyReuse:
			appendJob(localEnvironmentDependencyJobToProto(action.Job))
		case localEnvironmentPlanApplyRetry:
			response, applyErr := s.retryLocalEnvironmentDependencyJobConfirmed(ctx, &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
				JobId:     action.Job.JobID,
				Confirmed: true,
			})
			if applyErr != nil {
				return nil, applyErr
			}
			appendJob(response.GetJob())
		case localEnvironmentPlanApplyRepair:
			response, applyErr := s.repairLocalEnvironmentDependencyConfirmed(ctx, &runtimev1.RepairLocalEnvironmentDependencyRequest{
				EnvironmentKey:   dep.EnvironmentKey,
				DependencyFamily: dep.DependencyFamily,
				DependencyId:     dep.DependencyID,
				Confirmed:        true,
				ReasonCode:       dep.ReasonCode,
				ConsumerScope:    dep.ConsumerScope,
			})
			if applyErr != nil {
				return nil, applyErr
			}
			appendJob(response.GetJob())
		case localEnvironmentPlanApplyStart:
			response, applyErr := s.startLocalEnvironmentDependencyJobConfirmed(ctx, &runtimev1.StartLocalEnvironmentDependencyJobRequest{
				EnvironmentKey:   dep.EnvironmentKey,
				DependencyFamily: dep.DependencyFamily,
				DependencyId:     dep.DependencyID,
				SourceKind:       dep.SourceKind,
				Confirmed:        true,
				ConsumerScope:    dep.ConsumerScope,
			})
			if applyErr != nil {
				return nil, applyErr
			}
			appendJob(response.GetJob())
		default:
			return nil, localEnvironmentJobControlError(codes.Internal, "local environment plan contains an unknown apply action", "refresh_local_environment_plan")
		}
	}

	current, err := s.resolveLocalEnvironmentPlanForApply(resolution)
	if err != nil {
		return nil, err
	}
	return &runtimev1.ApplyLocalEnvironmentPlanResponse{
		Plan: localEnvironmentPlanToProto(current),
		Jobs: jobs,
	}, nil
}

func (s *Service) resolveLocalEnvironmentPlanForApply(req *runtimev1.ResolveLocalEnvironmentPlanRequest) (localEnvironmentPlan, error) {
	return s.resolveLocalEnvironmentPlanResolution(req)
}

func localEnvironmentPlanHasCompleteConfirmation(plan localEnvironmentPlan) bool {
	if !plan.NoSystemMutation || len(plan.RequiredDependencyFamilies) == 0 || len(plan.StorageCategories) == 0 || len(plan.SourceOwners) == 0 {
		return false
	}
	confirmedFamilies := make(map[string]struct{}, len(plan.RequiredDependencyFamilies))
	for _, family := range plan.RequiredDependencyFamilies {
		if family = strings.TrimSpace(family); family != "" {
			confirmedFamilies[family] = struct{}{}
		}
	}
	for _, dep := range plan.Dependencies {
		if !dep.Required {
			continue
		}
		if _, ok := confirmedFamilies[strings.TrimSpace(dep.DependencyFamily)]; !ok {
			return false
		}
	}
	return len(confirmedFamilies) > 0
}

func (s *Service) prepareLocalEnvironmentPlanApplyActions(plan localEnvironmentPlan) ([]localEnvironmentPlanApplyAction, error) {
	actions := make([]localEnvironmentPlanApplyAction, 0, len(plan.Dependencies))
	for _, dep := range plan.Dependencies {
		if !dep.Required || !localEnvironmentDependencyBlocksActivation(dep.State) {
			continue
		}
		if !localEnvironmentDependencyFamilyHasMaterializer(dep.DependencyFamily) {
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment plan dependency has no admitted materializer", "inspect_local_environment_dependency")
		}
		job, hasJob := s.latestLocalEnvironmentDependencyJobForDependency(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope)
		if hasJob && localEnvironmentDependencyJobActiveForPlanApply(job.State) {
			actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyReuse, Dependency: dep, Job: job})
			continue
		}
		switch strings.TrimSpace(dep.State) {
		case localEnvironmentStateNeedsConfirmation, "missing", "stale":
			if err := s.validateLocalEnvironmentPlanStartDependency(dep); err != nil {
				return nil, err
			}
			actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyStart, Dependency: dep})
		case localEnvironmentStateRepairRequired:
			if strings.TrimSpace(dep.ConsumerScope) == "" {
				return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency repair consumer scope is ambiguous", "refresh_local_environment_plan")
			}
			if _, ok := s.localEnvironmentSelectedSourceRecordForRepair(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope); !ok {
				if !hasJob ||
					strings.TrimSpace(job.State) != localEnvironmentStateRepairRequired ||
					strings.TrimSpace(job.RecoveryDisposition) != localEnvironmentJobRecoveryRepairRequired ||
					strings.TrimSpace(job.SelectedSourceRecordID) != "" {
					return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency has no selected source record to repair", "refresh_local_environment_plan")
				}
				if err := s.validateLocalEnvironmentPlanStartDependency(dep); err != nil {
					return nil, err
				}
				actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyStart, Dependency: dep})
				continue
			}
			actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyRepair, Dependency: dep})
		case localEnvironmentStateFailed, localEnvironmentStateCancelled:
			if hasJob &&
				strings.TrimSpace(job.State) == localEnvironmentStateFailed &&
				dep.DependencyFamily == localEnvironmentFamilyNativeSDCPP &&
				strings.TrimSpace(job.SelectedSourceRecordID) == "" &&
				localEnvironmentCUDAConsumerScopeRequiresRuntime(dep.ConsumerScope) {
				if _, ready, _ := s.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, dep.ConsumerScope); ready {
					if err := s.validateLocalEnvironmentPlanStartDependency(dep); err != nil {
						return nil, err
					}
					actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyStart, Dependency: dep})
					continue
				}
			}
			if hasJob &&
				strings.TrimSpace(job.State) == localEnvironmentStateFailed &&
				strings.TrimSpace(job.ReasonCode) == localEnvironmentDependencyPrerequisiteFailedReason &&
				strings.TrimSpace(job.RecoveryDisposition) == localEnvironmentJobRecoveryNotRetryable &&
				strings.TrimSpace(job.SelectedSourceRecordID) == "" {
				if err := s.validateLocalEnvironmentPlanStartDependency(dep); err != nil {
					return nil, err
				}
				actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyStart, Dependency: dep})
				continue
			}
			if !hasJob || !localEnvironmentDependencyJobRetryAllowed(job) {
				return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency job is not retryable", "inspect_local_environment_dependency")
			}
			actions = append(actions, localEnvironmentPlanApplyAction{Kind: localEnvironmentPlanApplyRetry, Dependency: dep, Job: job})
		case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency has no active job for its in-progress state", "refresh_local_environment_plan")
		case localEnvironmentStateUnsupported:
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency is unsupported", "inspect_local_environment_dependency")
		default:
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency state is not actionable", "refresh_local_environment_plan")
		}
	}
	return actions, nil
}

func (s *Service) validateLocalEnvironmentPlanStartDependency(dep localEnvironmentPlanDependency) error {
	consumerScope := s.localEnvironmentDependencyJobConsumerScope(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope)
	if strings.TrimSpace(consumerScope) == "" {
		return localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency consumer scope is ambiguous", "refresh_local_environment_plan")
	}
	if localEnvironmentDependencyProfileStartRequiresPlanContract(dep.DependencyFamily) {
		if _, ok := s.localEnvironmentPlanDependencyContract(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, consumerScope); !ok {
			return localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency profile is not admitted by the current plan", "refresh_local_environment_plan")
		}
	}
	if strings.TrimSpace(dep.EnvironmentKey) == "" || strings.TrimSpace(dep.DependencyFamily) == "" || strings.TrimSpace(dep.DependencyID) == "" || strings.TrimSpace(dep.SourceKind) == "" {
		return localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency plan identity is incomplete", "refresh_local_environment_plan")
	}
	return nil
}

func localEnvironmentDependencyJobActiveForPlanApply(state string) bool {
	switch strings.TrimSpace(state) {
	case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
		return true
	default:
		return false
	}
}

func localEnvironmentDependencyJobRetryAllowed(job localEnvironmentDependencyJobState) bool {
	if !job.Retryable || !localEnvironmentDependencyJobTerminal(job.State) {
		return false
	}
	switch strings.TrimSpace(job.RecoveryDisposition) {
	case localEnvironmentJobRecoveryManualRetry, localEnvironmentJobRecoveryAutoRetryTransient:
		return true
	default:
		return false
	}
}

func localEnvironmentDependencyFamilyHasMaterializer(family string) bool {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyCUDA,
		localEnvironmentFamilyNativeLlama,
		localEnvironmentFamilyNativeSDCPP,
		localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		return true
	default:
		return false
	}
}

func localEnvironmentDependencyProfileStartRequiresPlanContract(family string) bool {
	switch strings.TrimSpace(family) {
	case localEnvironmentFamilyPythonVenv,
		localEnvironmentFamilyPythonUV,
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentFamilyPythonPackageSet,
		localEnvironmentFamilyPythonTorchWheel:
		return true
	default:
		return false
	}
}

func (s *Service) CancelLocalEnvironmentDependencyJob(_ context.Context, req *runtimev1.CancelLocalEnvironmentDependencyJobRequest) (*runtimev1.CancelLocalEnvironmentDependencyJobResponse, error) {
	s.localEnvironmentPlanApplyMu.Lock()
	defer s.localEnvironmentPlanApplyMu.Unlock()
	job, ok := s.cancelLocalEnvironmentDependencyJob(req.GetJobId())
	if !ok {
		return nil, localEnvironmentJobControlError(codes.NotFound, "local environment dependency job not found", "refresh_local_environment_jobs")
	}
	return &runtimev1.CancelLocalEnvironmentDependencyJobResponse{Job: localEnvironmentDependencyJobToProto(job)}, nil
}

func (s *Service) RetryLocalEnvironmentDependencyJob(ctx context.Context, req *runtimev1.RetryLocalEnvironmentDependencyJobRequest) (*runtimev1.RetryLocalEnvironmentDependencyJobResponse, error) {
	s.localEnvironmentPlanApplyMu.Lock()
	defer s.localEnvironmentPlanApplyMu.Unlock()
	return s.retryLocalEnvironmentDependencyJobConfirmed(ctx, req)
}

func (s *Service) retryLocalEnvironmentDependencyJobConfirmed(ctx context.Context, req *runtimev1.RetryLocalEnvironmentDependencyJobRequest) (*runtimev1.RetryLocalEnvironmentDependencyJobResponse, error) {
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
	if localEnvironmentDependencyProfileStartRequiresPlanContract(previous.DependencyFamily) {
		if _, ok := s.localEnvironmentPlanDependencyContract(previous.EnvironmentKey, previous.DependencyFamily, previous.DependencyID, consumerScope); !ok {
			return nil, localEnvironmentJobControlError(codes.FailedPrecondition, "local environment dependency retry is not admitted by the current plan", "refresh_local_environment_plan")
		}
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
	s.localEnvironmentPlanApplyMu.Lock()
	defer s.localEnvironmentPlanApplyMu.Unlock()
	return s.repairLocalEnvironmentDependencyConfirmed(ctx, req)
}

func (s *Service) repairLocalEnvironmentDependencyConfirmed(ctx context.Context, req *runtimev1.RepairLocalEnvironmentDependencyRequest) (*runtimev1.RepairLocalEnvironmentDependencyResponse, error) {
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
