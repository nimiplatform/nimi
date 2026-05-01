package localservice

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func (s *Service) ResolveLocalEnvironmentPlan(_ context.Context, req *runtimev1.ResolveLocalEnvironmentPlanRequest) (*runtimev1.ResolveLocalEnvironmentPlanResponse, error) {
	plan := s.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           req.GetPackId(),
		ConsumerScope:    req.GetConsumerScope(),
		HostProfile:      req.GetHostProfile(),
		RuntimeDataRoot:  req.GetRuntimeDataRoot(),
		AssetID:          req.GetAssetId(),
		LocalAssetID:     req.GetLocalAssetId(),
		CompanionAssetID: req.GetCompanionAssetId(),
		ParentAssetID:    req.GetParentAssetId(),
	})
	return &runtimev1.ResolveLocalEnvironmentPlanResponse{
		Plan: localEnvironmentPlanToProto(plan),
	}, nil
}

func (s *Service) ListLocalEnvironmentSelectedSources(_ context.Context, req *runtimev1.ListLocalEnvironmentSelectedSourcesRequest) (*runtimev1.ListLocalEnvironmentSelectedSourcesResponse, error) {
	familyFilter := strings.TrimSpace(req.GetDependencyFamily())
	consumerFilter := strings.TrimSpace(req.GetConsumerScope())
	s.mu.RLock()
	sources := make([]localEnvironmentSelectedSourceRecordState, 0, len(s.localEnvironmentSelectedSources))
	for _, source := range s.localEnvironmentSelectedSources {
		if familyFilter != "" && source.DependencyFamily != familyFilter {
			continue
		}
		if consumerFilter != "" && !stringSliceContains(source.SelectedConsumers, consumerFilter) && !strings.Contains(source.EnvironmentKey, "|"+consumerFilter) {
			continue
		}
		sources = append(sources, source)
	}
	s.mu.RUnlock()
	sort.Slice(sources, func(i, j int) bool {
		return sources[i].EnvironmentKey < sources[j].EnvironmentKey
	})
	out := make([]*runtimev1.LocalEnvironmentSelectedSourceRecord, 0, len(sources))
	for _, source := range sources {
		out = append(out, localEnvironmentSelectedSourceRecordToProto(source))
	}
	return &runtimev1.ListLocalEnvironmentSelectedSourcesResponse{Sources: out}, nil
}

func (s *Service) ListLocalEnvironmentDependencyJobs(_ context.Context, req *runtimev1.ListLocalEnvironmentDependencyJobsRequest) (*runtimev1.ListLocalEnvironmentDependencyJobsResponse, error) {
	environmentKeyFilter := strings.TrimSpace(req.GetEnvironmentKey())
	stateFilter := strings.TrimSpace(req.GetState())
	s.mu.RLock()
	jobs := make([]localEnvironmentDependencyJobState, 0, len(s.localEnvironmentDependencyJobs))
	for _, job := range s.localEnvironmentDependencyJobs {
		if environmentKeyFilter != "" && job.EnvironmentKey != environmentKeyFilter {
			continue
		}
		if stateFilter != "" && job.State != stateFilter {
			continue
		}
		jobs = append(jobs, job)
	}
	s.mu.RUnlock()
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].UpdatedAt == jobs[j].UpdatedAt {
			return jobs[i].JobID < jobs[j].JobID
		}
		return jobs[i].UpdatedAt > jobs[j].UpdatedAt
	})
	out := make([]*runtimev1.LocalEnvironmentDependencyJob, 0, len(jobs))
	for _, job := range jobs {
		out = append(out, localEnvironmentDependencyJobToProto(job))
	}
	return &runtimev1.ListLocalEnvironmentDependencyJobsResponse{Jobs: out}, nil
}

func (s *Service) ResolveLocalEnvironmentActivationGate(_ context.Context, req *runtimev1.ResolveLocalEnvironmentActivationGateRequest) (*runtimev1.ResolveLocalEnvironmentActivationGateResponse, error) {
	gate := s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
		ConsumerID:       req.GetConsumerId(),
		PackID:           req.GetPackId(),
		HostProfile:      req.GetHostProfile(),
		RuntimeDataRoot:  req.GetRuntimeDataRoot(),
		AssetID:          req.GetAssetId(),
		LocalAssetID:     req.GetLocalAssetId(),
		CompanionAssetID: req.GetCompanionAssetId(),
		ParentAssetID:    req.GetParentAssetId(),
	})
	return &runtimev1.ResolveLocalEnvironmentActivationGateResponse{
		Gate: localEnvironmentActivationGateToProto(gate),
	}, nil
}

func localEnvironmentPlanToProto(plan localEnvironmentPlan) *runtimev1.LocalEnvironmentPlan {
	out := &runtimev1.LocalEnvironmentPlan{
		PlanId:          plan.PlanID,
		PackId:          plan.PackID,
		ProductLabel:    plan.ProductLabel,
		HostProfileId:   plan.HostProfileID,
		PlatformTuple:   plan.PlatformTuple,
		RuntimeDataRoot: plan.RuntimeDataRoot,
		ConsumerScope:   plan.ConsumerScope,
		CloudOnlyImpact: plan.CloudOnlyImpact,
		State:           plan.State,
		ReasonCode:      plan.ReasonCode,
		Dependencies:    make([]*runtimev1.LocalEnvironmentPlanDependency, 0, len(plan.Dependencies)),
	}
	for _, dep := range plan.Dependencies {
		out.Dependencies = append(out.Dependencies, localEnvironmentPlanDependencyToProto(dep))
	}
	return out
}

func localEnvironmentPlanDependencyToProto(dep localEnvironmentPlanDependency) *runtimev1.LocalEnvironmentPlanDependency {
	return &runtimev1.LocalEnvironmentPlanDependency{
		DependencyFamily:       dep.DependencyFamily,
		DependencyId:           dep.DependencyID,
		Required:               dep.Required,
		State:                  dep.State,
		SourceKind:             dep.SourceKind,
		ConfirmationRequired:   dep.ConfirmationRequired,
		SelectedSourceRecordId: dep.SelectedSourceRecordID,
		EnvironmentKey:         dep.EnvironmentKey,
		CanonicalRoot:          dep.CanonicalRoot,
		ReasonCode:             dep.ReasonCode,
		Detail:                 dep.Detail,
	}
}

func localEnvironmentSelectedSourceRecordToProto(source localEnvironmentSelectedSourceRecordState) *runtimev1.LocalEnvironmentSelectedSourceRecord {
	return &runtimev1.LocalEnvironmentSelectedSourceRecord{
		RecordId:              source.RecordID,
		DependencyFamily:      source.DependencyFamily,
		DependencyId:          source.DependencyID,
		EnvironmentKey:        source.EnvironmentKey,
		SourceKind:            source.SourceKind,
		CanonicalRoot:         source.CanonicalRoot,
		Version:               source.Version,
		CompatibilityEvidence: append([]string(nil), source.CompatibilityEvidence...),
		VerifiedArtifacts:     append([]string(nil), source.VerifiedArtifacts...),
		Hashes:                cloneStringMap(source.Hashes),
		SelectedConsumers:     append([]string(nil), source.SelectedConsumers...),
		ActivationEnvDelta:    append([]string(nil), source.ActivationEnvDelta...),
		SelectedAt:            source.SelectedAt,
		LastVerifiedAt:        source.LastVerifiedAt,
		RepairState:           source.RepairState,
		AuditReasonCode:       source.AuditReasonCode,
	}
}

func localEnvironmentDependencyJobToProto(job localEnvironmentDependencyJobState) *runtimev1.LocalEnvironmentDependencyJob {
	return &runtimev1.LocalEnvironmentDependencyJob{
		JobId:                  job.JobID,
		EnvironmentKey:         job.EnvironmentKey,
		DependencyFamily:       job.DependencyFamily,
		DependencyId:           job.DependencyID,
		State:                  job.State,
		SourceKind:             job.SourceKind,
		CanonicalRoot:          job.CanonicalRoot,
		SelectedSourceRecordId: job.SelectedSourceRecordID,
		FailureDetail:          job.FailureDetail,
		Retryable:              job.Retryable,
		CreatedAt:              job.CreatedAt,
		UpdatedAt:              job.UpdatedAt,
	}
}

func localEnvironmentActivationGateToProto(gate localEnvironmentConsumerActivationGate) *runtimev1.LocalEnvironmentActivationGate {
	out := &runtimev1.LocalEnvironmentActivationGate{
		ConsumerId:           gate.ConsumerID,
		PackId:               gate.PackID,
		State:                gate.State,
		ReasonCode:           gate.ReasonCode,
		Detail:               gate.Detail,
		BlockingDependencies: make([]*runtimev1.LocalEnvironmentPlanDependency, 0, len(gate.BlockingDependencies)),
		Dependencies:         make([]*runtimev1.LocalEnvironmentPlanDependency, 0, len(gate.Dependencies)),
	}
	for _, dep := range gate.BlockingDependencies {
		out.BlockingDependencies = append(out.BlockingDependencies, localEnvironmentPlanDependencyToProto(dep))
	}
	for _, dep := range gate.Dependencies {
		out.Dependencies = append(out.Dependencies, localEnvironmentPlanDependencyToProto(dep))
	}
	return out
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}
