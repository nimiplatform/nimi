package localruntime

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/status"
)

const (
	applyStagePreflight = "preflight"
	applyStageInstall   = "install"
	applyStageBootstrap = "bootstrap"
	applyStageHealth    = "health"
	applyStageRollback  = "rollback"
)

func (s *Service) applyDependenciesStrict(ctx context.Context, plan *runtimev1.LocalDependencyResolutionPlan) *runtimev1.LocalDependencyApplyResult {
	if plan == nil {
		return &runtimev1.LocalDependencyApplyResult{
			ReasonCode:      "LOCAL_DEPENDENCY_PLAN_REQUIRED",
			StageResults:    []*runtimev1.LocalDependencyApplyStageResult{},
			Warnings:        []string{"apply request missing plan"},
			Dependencies:    []*runtimev1.LocalDependencyDescriptor{},
			Capabilities:    []string{},
			InstalledModels: []*runtimev1.LocalModelRecord{},
			Services:        []*runtimev1.LocalServiceDescriptor{},
		}
	}

	result := &runtimev1.LocalDependencyApplyResult{
		PlanId:             plan.GetPlanId(),
		ModId:              plan.GetModId(),
		Dependencies:       make([]*runtimev1.LocalDependencyDescriptor, 0, len(plan.GetDependencies())),
		InstalledModels:    []*runtimev1.LocalModelRecord{},
		Services:           []*runtimev1.LocalServiceDescriptor{},
		Capabilities:       []string{},
		StageResults:       []*runtimev1.LocalDependencyApplyStageResult{},
		PreflightDecisions: clonePreflightDecisions(plan.GetPreflightDecisions()),
		RollbackApplied:    false,
		Warnings:           append([]string(nil), plan.GetWarnings()...),
	}

	selected := make([]*runtimev1.LocalDependencyDescriptor, 0, len(plan.GetDependencies()))
	for _, dep := range plan.GetDependencies() {
		item := cloneDependencyDescriptor(dep)
		result.Dependencies = append(result.Dependencies, item)
		if !dep.GetSelected() {
			continue
		}
		selected = append(selected, item)
		if capName := strings.TrimSpace(dep.GetCapability()); capName != "" {
			result.Capabilities = append(result.Capabilities, capName)
		}
	}
	result.Capabilities = normalizeStringSlice(result.Capabilities)

	// Stage 1: preflight
	preflightFailed := false
	preflightFailureReason := ""
	preflightFailure := ""
	for _, dep := range selected {
		decision := s.runApplyPreflight(ctx, dep, plan.GetDeviceProfile())
		result.PreflightDecisions = append(result.PreflightDecisions, decision)
		if !decision.GetOk() && !preflightFailed {
			preflightFailed = true
			preflightFailureReason = strings.TrimSpace(decision.GetReasonCode())
			preflightFailure = decision.GetDetail()
		}
	}
	if preflightFailed {
		reasonCode := defaultString(preflightFailureReason, "LOCAL_DEPENDENCY_PREFLIGHT_FAILED")
		result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
			Stage:      applyStagePreflight,
			Ok:         false,
			ReasonCode: reasonCode,
			Detail:     preflightFailure,
		})
		result.ReasonCode = reasonCode
		return result
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
		Stage:      applyStagePreflight,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("dependencies=%d", len(selected)),
	})

	installedModelIDs := make([]string, 0, len(selected))
	installedServiceIDs := make([]string, 0, len(selected))
	modelRefToLocalID := make(map[string]string, len(selected)*2)

	// Stage 2: install artifacts
	for _, dep := range selected {
		switch dep.GetKind() {
		case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL:
			modelID := defaultString(dep.GetModelId(), "local/default")
			installed, err := s.InstallLocalModel(ctx, &runtimev1.InstallLocalModelRequest{
				ModelId:      modelID,
				Repo:         dep.GetRepo(),
				Capabilities: normalizeStringSlice([]string{dep.GetCapability()}),
				Engine:       defaultString(dep.GetEngine(), "localai"),
			})
			if err != nil || installed.GetModel() == nil {
				detail := defaultString(fmt.Sprintf("%v", err), "model install returned empty response")
				result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
					Stage:      applyStageInstall,
					Ok:         false,
					ReasonCode: "LOCAL_DEPENDENCY_MODEL_INSTALL_FAILED",
					Detail:     detail,
				})
				result.ReasonCode = "LOCAL_DEPENDENCY_MODEL_INSTALL_FAILED"
				s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
				return result
			}
			modelRecord := cloneLocalModel(installed.GetModel())
			result.InstalledModels = append(result.InstalledModels, modelRecord)
			installedModelIDs = append(installedModelIDs, modelRecord.GetLocalModelId())
			if ref := strings.TrimSpace(dep.GetModelId()); ref != "" {
				modelRefToLocalID[ref] = modelRecord.GetLocalModelId()
			}
			modelRefToLocalID[modelRecord.GetLocalModelId()] = modelRecord.GetLocalModelId()
		case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE:
			serviceID := defaultString(dep.GetServiceId(), "svc_"+slug(dep.GetDependencyId()))
			localModelID := s.resolveServiceDependencyLocalModelID(strings.TrimSpace(dep.GetModelId()), modelRefToLocalID)
			installed, err := s.InstallLocalService(ctx, &runtimev1.InstallLocalServiceRequest{
				ServiceId:    serviceID,
				Title:        serviceID,
				Engine:       defaultString(dep.GetEngine(), "localai"),
				Capabilities: normalizeStringSlice([]string{dep.GetCapability()}),
				LocalModelId: localModelID,
			})
			if err != nil || installed.GetService() == nil {
				detail := defaultString(fmt.Sprintf("%v", err), "service install returned empty response")
				result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
					Stage:      applyStageInstall,
					Ok:         false,
					ReasonCode: "LOCAL_DEPENDENCY_SERVICE_INSTALL_FAILED",
					Detail:     detail,
				})
				result.ReasonCode = "LOCAL_DEPENDENCY_SERVICE_INSTALL_FAILED"
				s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
				return result
			}
			serviceRecord := cloneServiceDescriptor(installed.GetService())
			result.Services = append(result.Services, serviceRecord)
			installedServiceIDs = append(installedServiceIDs, serviceRecord.GetServiceId())
		case runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE:
			// Node dependencies are validated in preflight and do not install artifacts.
		default:
			result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
				Stage:      applyStageInstall,
				Ok:         false,
				ReasonCode: "LOCAL_DEPENDENCY_KIND_UNSUPPORTED",
				Detail:     dep.GetDependencyId(),
			})
			result.ReasonCode = "LOCAL_DEPENDENCY_KIND_UNSUPPORTED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
		Stage:      applyStageInstall,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("models=%d services=%d", len(installedModelIDs), len(installedServiceIDs)),
	})

	// Stage 3: bootstrap
	for _, modelID := range installedModelIDs {
		started, err := s.StartLocalModel(ctx, &runtimev1.StartLocalModelRequest{LocalModelId: modelID})
		if err != nil || started.GetModel() == nil {
			result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
				Stage:      applyStageBootstrap,
				Ok:         false,
				ReasonCode: "LOCAL_DEPENDENCY_MODEL_START_FAILED",
				Detail:     defaultString(fmt.Sprintf("%v", err), modelID),
			})
			result.ReasonCode = "LOCAL_DEPENDENCY_MODEL_START_FAILED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	for _, serviceID := range installedServiceIDs {
		started, err := s.StartLocalService(ctx, &runtimev1.StartLocalServiceRequest{ServiceId: serviceID})
		if err != nil || started.GetService() == nil {
			result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
				Stage:      applyStageBootstrap,
				Ok:         false,
				ReasonCode: "LOCAL_DEPENDENCY_SERVICE_START_FAILED",
				Detail:     defaultString(fmt.Sprintf("%v", err), serviceID),
			})
			result.ReasonCode = "LOCAL_DEPENDENCY_SERVICE_START_FAILED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
		Stage:      applyStageBootstrap,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("started models=%d services=%d", len(installedModelIDs), len(installedServiceIDs)),
	})

	// Stage 4: health gates
	for _, modelID := range installedModelIDs {
		health, err := s.CheckLocalModelHealth(ctx, &runtimev1.CheckLocalModelHealthRequest{LocalModelId: modelID})
		if err != nil || len(health.GetModels()) == 0 || health.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
			result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
				Stage:      applyStageHealth,
				Ok:         false,
				ReasonCode: "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED",
				Detail:     modelID,
			})
			result.ReasonCode = "LOCAL_DEPENDENCY_MODEL_HEALTH_FAILED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	for _, serviceID := range installedServiceIDs {
		health, err := s.CheckLocalServiceHealth(ctx, &runtimev1.CheckLocalServiceHealthRequest{ServiceId: serviceID})
		if err != nil || len(health.GetServices()) == 0 || health.GetServices()[0].GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
			result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
				Stage:      applyStageHealth,
				Ok:         false,
				ReasonCode: "LOCAL_DEPENDENCY_SERVICE_HEALTH_FAILED",
				Detail:     serviceID,
			})
			result.ReasonCode = "LOCAL_DEPENDENCY_SERVICE_HEALTH_FAILED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
		Stage:      applyStageHealth,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     "all dependencies healthy",
	})

	result.ReasonCode = "ACTION_EXECUTED"
	return result
}

func (s *Service) runApplyPreflight(ctx context.Context, dep *runtimev1.LocalDependencyDescriptor, profile *runtimev1.LocalDeviceProfile) *runtimev1.LocalPreflightDecision {
	if dep == nil {
		return &runtimev1.LocalPreflightDecision{
			Target:     "",
			Check:      "dependency-shape",
			Ok:         false,
			ReasonCode: "LOCAL_DEPENDENCY_OPTION_MISSING",
			Detail:     "dependency option missing",
		}
	}

	check := evaluateDependencyCandidate(&runtimev1.LocalDependencyOptionDescriptor{
		DependencyId: dep.GetDependencyId(),
		Kind:         dep.GetKind(),
		Capability:   dep.GetCapability(),
		ModelId:      dep.GetModelId(),
		Repo:         dep.GetRepo(),
		ServiceId:    dep.GetServiceId(),
		NodeId:       dep.GetNodeId(),
		Engine:       dep.GetEngine(),
	}, profile)
	decision := &runtimev1.LocalPreflightDecision{
		DependencyId: dep.GetDependencyId(),
		Target:       preflightTargetForDependency(dep),
		Check:        defaultString(check.check, "dependency-shape"),
		Ok:           check.ok,
		ReasonCode:   check.reasonCode,
		Detail:       check.detail,
	}
	if !decision.GetOk() || dep.GetKind() != runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE {
		return decision
	}

	nodeID := strings.TrimSpace(dep.GetNodeId())
	nodesResp, err := s.ListNodeCatalog(ctx, &runtimev1.ListNodeCatalogRequest{
		ServiceId:  strings.TrimSpace(dep.GetServiceId()),
		Capability: strings.TrimSpace(dep.GetCapability()),
	})
	if err != nil {
		decision.Ok = false
		decision.Check = "node-catalog"
		decision.ReasonCode = "LOCAL_DEPENDENCY_NODE_LOOKUP_FAILED"
		decision.Detail = defaultString(fmt.Sprintf("%v", err), "node catalog lookup failed")
		return decision
	}

	for _, node := range nodesResp.GetNodes() {
		if strings.TrimSpace(node.GetNodeId()) != nodeID {
			continue
		}
		if !node.GetAvailable() {
			decision.Ok = false
			decision.Check = "node-availability"
			decision.ReasonCode = "LOCAL_DEPENDENCY_NODE_UNAVAILABLE"
			decision.Detail = defaultString(node.GetReasonCode(), "node is unavailable")
			return decision
		}
		decision.Ok = true
		decision.Check = "node-availability"
		decision.ReasonCode = "LOCAL_DEPENDENCY_NODE_RESOLVED"
		decision.Detail = defaultString(node.GetNodeId(), dep.GetDependencyId())
		return decision
	}

	decision.Ok = false
	decision.Check = "node-catalog"
	decision.ReasonCode = "LOCAL_DEPENDENCY_NODE_UNRESOLVED"
	decision.Detail = defaultString(nodeID, dep.GetDependencyId()) + " not found in node catalog"
	return decision
}

func (s *Service) resolveServiceDependencyLocalModelID(modelRef string, modelRefToLocalID map[string]string) string {
	ref := strings.TrimSpace(modelRef)
	if ref == "" {
		return ""
	}
	if localID, ok := modelRefToLocalID[ref]; ok && strings.TrimSpace(localID) != "" {
		return strings.TrimSpace(localID)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	if model := s.models[ref]; model != nil {
		return ref
	}
	for _, model := range s.models {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(model.GetModelId()) == ref {
			return strings.TrimSpace(model.GetLocalModelId())
		}
	}
	return ref
}

func (s *Service) rollbackApply(ctx context.Context, modelIDs []string, serviceIDs []string, result *runtimev1.LocalDependencyApplyResult) {
	if result == nil {
		return
	}
	result.RollbackApplied = true
	rollbackFailures := make([]string, 0, len(modelIDs)+len(serviceIDs))
	rollbackReason := ""
	for i := len(serviceIDs) - 1; i >= 0; i-- {
		serviceID := serviceIDs[i]
		if _, err := s.RemoveLocalService(ctx, &runtimev1.RemoveLocalServiceRequest{ServiceId: serviceID}); err != nil {
			rollbackFailures = append(rollbackFailures, "rollback remove service failed: "+serviceID)
			result.Warnings = append(result.Warnings, "rollback remove service failed: "+serviceID)
			rollbackReason = defaultString(rollbackReason, rollbackReasonCodeFromError(err))
		}
	}
	for i := len(modelIDs) - 1; i >= 0; i-- {
		modelID := modelIDs[i]
		if _, err := s.RemoveLocalModel(ctx, &runtimev1.RemoveLocalModelRequest{LocalModelId: modelID}); err != nil {
			rollbackFailures = append(rollbackFailures, "rollback remove model failed: "+modelID)
			result.Warnings = append(result.Warnings, "rollback remove model failed: "+modelID)
			rollbackReason = defaultString(rollbackReason, rollbackReasonCodeFromError(err))
		}
	}
	if len(rollbackFailures) > 0 {
		if strings.TrimSpace(rollbackReason) == "" {
			rollbackReason = "LOCAL_DEPENDENCY_ROLLBACK_FAILED"
		}
		result.ReasonCode = joinReasonCodes(result.GetReasonCode(), rollbackReason)
		result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
			Stage:      applyStageRollback,
			Ok:         false,
			ReasonCode: rollbackReason,
			Detail:     strings.Join(rollbackFailures, "; "),
		})
		return
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalDependencyApplyStageResult{
		Stage:      applyStageRollback,
		Ok:         true,
		ReasonCode: "LOCAL_DEPENDENCY_ROLLBACK_APPLIED",
		Detail:     fmt.Sprintf("models=%d services=%d", len(modelIDs), len(serviceIDs)),
	})
}

func rollbackReasonCodeFromError(err error) string {
	if err == nil {
		return ""
	}
	if st, ok := status.FromError(err); ok {
		return strings.TrimSpace(st.Message())
	}
	return ""
}

func joinReasonCodes(primary, secondary string) string {
	left := strings.TrimSpace(primary)
	right := strings.TrimSpace(secondary)
	switch {
	case left == "":
		return right
	case right == "":
		return left
	case left == right:
		return left
	default:
		return left + "+" + right
	}
}
