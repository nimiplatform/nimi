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
		InstallLevel:     req.GetInstallLevel(),
	})
	return &runtimev1.ResolveLocalEnvironmentPlanResponse{
		Plan: localEnvironmentPlanToProto(plan),
	}, nil
}

func (s *Service) PrepareProfileRuntimeDescriptor(ctx context.Context, req *runtimev1.PrepareProfileRuntimeDescriptorRequest) (*runtimev1.PrepareProfileRuntimeDescriptorResponse, error) {
	result, err := s.prepareProfileRuntimeDescriptor(ctx, ProfileRuntimeDescriptorPrepareRequest{
		DescriptorJSON: req.GetDescriptorJson(),
	})
	if err != nil {
		return nil, err
	}
	return profileRuntimeDescriptorPrepareResultToProto(result), nil
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
		if consumerFilter != "" && !stringSliceContains(source.SelectedConsumers, consumerFilter) {
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

func profileRuntimeDescriptorPrepareResultToProto(result *ProfileRuntimeDescriptorPrepareResult) *runtimev1.PrepareProfileRuntimeDescriptorResponse {
	if result == nil {
		return &runtimev1.PrepareProfileRuntimeDescriptorResponse{}
	}
	out := &runtimev1.PrepareProfileRuntimeDescriptorResponse{
		DescriptorId:   result.DescriptorID,
		ProfileId:      result.ProfileID,
		RequirementIds: append([]string(nil), result.RequirementIDs...),
		SliceResults:   make([]*runtimev1.ProfileRuntimeDescriptorSlicePrepareResult, 0, len(result.SliceResults)),
	}
	for _, item := range result.SliceResults {
		out.SliceResults = append(out.SliceResults, &runtimev1.ProfileRuntimeDescriptorSlicePrepareResult{
			SliceId:              item.SliceID,
			Capability:           item.Capability,
			Outcome:              item.Outcome,
			ReasonCodes:          append([]string(nil), item.ReasonCodes...),
			MaterializationKey:   item.MaterializationKey,
			WorkflowBindingId:    item.WorkflowBindingID,
			ReusableAssetHealthy: item.ReusableAssetHealthy,
		})
	}
	return out
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

// MintRuntimeBaselineReadiness mints a durable first-run runtime baseline
// readiness evidence ref (K-LENV-ACT-011) after running a fresh activation
// gate for every required first-run baseline consumer.
func (s *Service) MintRuntimeBaselineReadiness(_ context.Context, req *runtimev1.MintRuntimeBaselineReadinessRequest) (*runtimev1.MintRuntimeBaselineReadinessResponse, error) {
	record, state, reasonCode, detail := s.mintRuntimeBaselineReadiness(runtimeBaselineResolveRequest{
		SelectedLocalFactoryAIProfileRef: req.GetSelectedLocalFactoryAiProfileRef(),
		InstallLevel:                     req.GetInstallLevel(),
		RuntimeDataRootOrDataRootRef:     req.GetRuntimeDataRootOrDataRootRef(),
		HostProfile:                      req.GetHostProfile(),
		BaselineConsumers:                runtimeBaselineConsumerBindingsFromProto(req.GetBaselineConsumers()),
	})
	resp := &runtimev1.MintRuntimeBaselineReadinessResponse{
		State:      state,
		ReasonCode: reasonCode,
		Detail:     detail,
	}
	if state == runtimeBaselineStateReady {
		resp.Ref = runtimeBaselineReadinessRecordToProto(record)
	}
	return resp, nil
}

// ResolveRuntimeBaselineReadiness re-verifies a stored runtimeBaselineRef
// against fresh activation evidence (K-LENV-ACT-011). It fails closed for a
// string-only ref, a missing ref, a ref with no backing durable record, a ref
// bound to a divergent selection, or a ref whose dependency set no longer
// resolves ready.
func (s *Service) ResolveRuntimeBaselineReadiness(_ context.Context, req *runtimev1.ResolveRuntimeBaselineReadinessRequest) (*runtimev1.ResolveRuntimeBaselineReadinessResponse, error) {
	record, state, reasonCode, detail := s.resolveRuntimeBaselineReadiness(req.GetRuntimeBaselineRef(), req.GetHostProfile())
	resp := &runtimev1.ResolveRuntimeBaselineReadinessResponse{
		State:      state,
		ReasonCode: reasonCode,
		Detail:     detail,
	}
	if state == runtimeBaselineStateReady {
		resp.Ref = runtimeBaselineReadinessRecordToProto(record)
	}
	return resp, nil
}

func runtimeBaselineReadinessRecordToProto(record runtimeBaselineReadinessRecord) *runtimev1.RuntimeBaselineReadinessRef {
	out := &runtimev1.RuntimeBaselineReadinessRef{
		RuntimeBaselineRef:                                record.RuntimeBaselineRef,
		SelectedLocalFactoryAiProfileRef:                  record.SelectedLocalFactoryAIProfileRef,
		InstallLevel:                                      record.InstallLevel,
		RuntimeDataRootOrDataRootRef:                      record.RuntimeDataRootOrDataRootRef,
		RequiredDependencyFamilies:                        append([]string(nil), record.RequiredDependencyFamilies...),
		SelectedSourceRecordIds:                           append([]string(nil), record.SelectedSourceRecordIDs...),
		MaterializationOrSystemSourceVerificationEvidence: append([]string(nil), record.MaterializationOrSystemSourceVerificationEvidence...),
		ObservedAt:                                        record.ObservedAt,
		RuntimeVerifierIdentity:                           record.RuntimeVerifierIdentity,
		RuntimeAuditSequence:                              append([]string(nil), record.RuntimeAuditSequence...),
		ActivationReadyResponses:                          make([]*runtimev1.RuntimeBaselineActivationConsumerEvidence, 0, len(record.ActivationReadyResponses)),
	}
	for _, consumer := range record.ActivationReadyResponses {
		out.ActivationReadyResponses = append(out.ActivationReadyResponses, runtimeBaselineConsumerEvidenceToProto(consumer))
	}
	return out
}

// MintFirstRunExecutionEvidence executes every selected first-run baseline
// capability through the admitted Runtime local execution path and mints a
// durable executionEvidenceRef only when every execution resolved to a local
// route target (K-AIEXEC-007).
func (s *Service) MintFirstRunExecutionEvidence(_ context.Context, req *runtimev1.MintFirstRunExecutionEvidenceRequest) (*runtimev1.MintFirstRunExecutionEvidenceResponse, error) {
	record, state, reasonCode, detail := s.mintFirstRunExecutionEvidence(firstRunExecutionMintRequest{
		RuntimeBaselineRef:               req.GetRuntimeBaselineRef(),
		SelectedLocalFactoryAIProfileRef: req.GetSelectedLocalFactoryAiProfileRef(),
		InstallLevel:                     req.GetInstallLevel(),
		DataRootRef:                      req.GetDataRootRef(),
		HostProfile:                      req.GetHostProfile(),
		RecommendedCapabilities:          req.GetRecommendedCapabilities(),
		SubmitSchedulingEvaluated:        req.GetSubmitSchedulingEvaluated(),
	})
	resp := &runtimev1.MintFirstRunExecutionEvidenceResponse{
		State:      state,
		ReasonCode: reasonCode,
		Detail:     detail,
	}
	if state == firstRunExecutionStateReady {
		resp.Ref = firstRunExecutionEvidenceRecordToProto(record)
	}
	return resp, nil
}

// ResolveFirstRunExecutionEvidence re-verifies a stored executionEvidenceRef
// against fresh evidence (K-AIEXEC-007). It fails closed for a string-only ref,
// a missing ref, a ref with no backing durable record, a ref bound to a
// divergent composition input, an incomplete capability set, or any ref whose
// recorded route was cloud / non-local.
func (s *Service) ResolveFirstRunExecutionEvidence(_ context.Context, req *runtimev1.ResolveFirstRunExecutionEvidenceRequest) (*runtimev1.ResolveFirstRunExecutionEvidenceResponse, error) {
	record, state, reasonCode, detail := s.resolveFirstRunExecutionEvidence(firstRunExecutionResolveRequest{
		ExecutionEvidenceRef:       req.GetExecutionEvidenceRef(),
		ExpectedRuntimeBaselineRef: req.GetExpectedRuntimeBaselineRef(),
		ExpectedDataRootRef:        req.GetExpectedDataRootRef(),
		ExpectedInstallLevel:       req.GetExpectedInstallLevel(),
		HostProfile:                req.GetHostProfile(),
	})
	resp := &runtimev1.ResolveFirstRunExecutionEvidenceResponse{
		State:      state,
		ReasonCode: reasonCode,
		Detail:     detail,
	}
	if state == firstRunExecutionStateReady {
		resp.Ref = firstRunExecutionEvidenceRecordToProto(record)
	}
	return resp, nil
}

func firstRunExecutionEvidenceRecordToProto(record firstRunExecutionEvidenceRecord) *runtimev1.ExecutionEvidenceRef {
	out := &runtimev1.ExecutionEvidenceRef{
		ExecutionEvidenceRef:             record.ExecutionEvidenceRef,
		SelectedLocalFactoryAiProfileRef: record.SelectedLocalFactoryAIProfileRef,
		InstallLevel:                     record.InstallLevel,
		RuntimeBaselineRef:               record.RuntimeBaselineRef,
		DataRootRef:                      record.DataRootRef,
		LocalExecutionTargetEvidence:     append([]string(nil), record.LocalExecutionTargetEvidence...),
		TerminalResult:                   record.TerminalResult,
		ObservedAt:                       record.ObservedAt,
		RuntimeAuditSequence:             append([]string(nil), record.RuntimeAuditSequence...),
		RuntimeVerifierIdentity:          record.RuntimeVerifierIdentity,
		SelectedBaselineCapabilityProof:  make([]*runtimev1.ExecutionBaselineCapabilityProof, 0, len(record.SelectedBaselineCapabilityProof)),
	}
	for _, proof := range record.SelectedBaselineCapabilityProof {
		out.SelectedBaselineCapabilityProof = append(out.SelectedBaselineCapabilityProof, &runtimev1.ExecutionBaselineCapabilityProof{
			Capability:       proof.Capability,
			ScenarioType:     parseScenarioTypeName(proof.ScenarioType),
			BoundConsumerId:  proof.BoundConsumerID,
			BoundAssetId:     proof.BoundAssetID,
			LocalRouteTarget: proof.LocalRouteTarget,
			RoutePolicy:      parseRoutePolicyName(proof.RoutePolicy),
			ModelResolved:    proof.ModelResolved,
			TerminalResult:   proof.TerminalResult,
			ReasonCode:       proof.ReasonCode,
			TraceId:          proof.TraceID,
			ExecutedAt:       proof.ExecutedAt,
		})
	}
	if record.SubmitSpecificSchedulingJudgement != nil {
		out.SubmitSpecificSchedulingJudgement = &runtimev1.ExecutionSchedulingJudgement{
			Evaluated:       record.SubmitSpecificSchedulingJudgement.Evaluated,
			Capability:      record.SubmitSpecificSchedulingJudgement.Capability,
			SchedulingState: record.SubmitSpecificSchedulingJudgement.SchedulingState,
			Detail:          record.SubmitSpecificSchedulingJudgement.Detail,
			EvaluatedAt:     record.SubmitSpecificSchedulingJudgement.EvaluatedAt,
		}
	}
	return out
}

// parseScenarioTypeName maps a stored ScenarioType enum name back to the proto
// enum value. An unknown name resolves to UNSPECIFIED.
func parseScenarioTypeName(name string) runtimev1.ScenarioType {
	if value, ok := runtimev1.ScenarioType_value[strings.TrimSpace(name)]; ok {
		return runtimev1.ScenarioType(value)
	}
	return runtimev1.ScenarioType_SCENARIO_TYPE_UNSPECIFIED
}

// parseRoutePolicyName maps a stored RoutePolicy enum name back to the proto
// enum value. An unknown name resolves to UNSPECIFIED.
func parseRoutePolicyName(name string) runtimev1.RoutePolicy {
	if value, ok := runtimev1.RoutePolicy_value[strings.TrimSpace(name)]; ok {
		return runtimev1.RoutePolicy(value)
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED
}

func runtimeBaselineConsumerBindingsFromProto(bindings []*runtimev1.RuntimeBaselineConsumerBinding) []runtimeBaselineConsumerBinding {
	out := make([]runtimeBaselineConsumerBinding, 0, len(bindings))
	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		out = append(out, runtimeBaselineConsumerBinding{
			ConsumerID:   binding.GetConsumerId(),
			AssetID:      binding.GetAssetId(),
			LocalAssetID: binding.GetLocalAssetId(),
		})
	}
	return out
}

func runtimeBaselineConsumerEvidenceToProto(consumer runtimeBaselineActivationConsumerEvidence) *runtimev1.RuntimeBaselineActivationConsumerEvidence {
	out := &runtimev1.RuntimeBaselineActivationConsumerEvidence{
		ConsumerId:      consumer.ConsumerID,
		PackId:          consumer.PackID,
		ActivationState: consumer.ActivationState,
		ReasonCode:      consumer.ReasonCode,
		BoundAssetId:    consumer.BoundAssetID,
		Dependencies:    make([]*runtimev1.RuntimeBaselineActivationDependencyEvidence, 0, len(consumer.Dependencies)),
	}
	for _, dep := range consumer.Dependencies {
		out.Dependencies = append(out.Dependencies, &runtimev1.RuntimeBaselineActivationDependencyEvidence{
			DependencyFamily:       dep.DependencyFamily,
			DependencyId:           dep.DependencyID,
			EnvironmentKey:         dep.EnvironmentKey,
			SelectedSourceRecordId: dep.SelectedSourceRecordID,
			SourceKind:             dep.SourceKind,
			DependencyState:        dep.DependencyState,
			CanonicalRoot:          dep.CanonicalRoot,
			MaterializationOrSystemSourceVerificationEvidence: dep.VerificationEvidence,
		})
	}
	return out
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
		ConsumerScope:          dep.ConsumerScope,
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
		ConsumerScope:          job.ConsumerScope,
		State:                  job.State,
		SourceKind:             job.SourceKind,
		CanonicalRoot:          job.CanonicalRoot,
		SelectedSourceRecordId: job.SelectedSourceRecordID,
		FailureDetail:          job.FailureDetail,
		Retryable:              job.Retryable,
		ReasonCode:             job.ReasonCode,
		RecoveryDisposition:    job.RecoveryDisposition,
		CreatedAt:              job.CreatedAt,
		UpdatedAt:              job.UpdatedAt,
		// K-RPC-025 download-progress projection. The job state already zeroes
		// these fields outside a transferring state, so the projection here is a
		// faithful pass-through — never a fabricated %/rate/ETA.
		BytesReceived:    job.BytesReceived,
		BytesTotal:       job.BytesTotal,
		Percent:          job.Percent,
		SpeedBytesPerSec: job.SpeedBytesPerSec,
		EtaSeconds:       job.EtaSeconds,
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
