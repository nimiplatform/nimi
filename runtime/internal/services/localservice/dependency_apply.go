package localservice

import (
	"context"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	applyStagePreflight = "preflight"
	applyStageInstall   = "install"
	applyStageBootstrap = "bootstrap"
	applyStageHealth    = "health"
	applyStageRollback  = "rollback"
)

func (s *Service) applyExecutionPlanStrict(ctx context.Context, plan *runtimev1.LocalExecutionPlan) *runtimev1.LocalExecutionApplyResult {
	if plan == nil {
		return &runtimev1.LocalExecutionApplyResult{
			ReasonCode:      "LOCAL_DEPENDENCY_PLAN_REQUIRED",
			StageResults:    []*runtimev1.LocalExecutionStageResult{},
			Warnings:        []string{"apply request missing plan"},
			Entries:         []*runtimev1.LocalExecutionEntryDescriptor{},
			Capabilities:    []string{},
			InstalledAssets: []*runtimev1.LocalAssetRecord{},
			Services:        []*runtimev1.LocalServiceDescriptor{},
		}
	}

	result := &runtimev1.LocalExecutionApplyResult{
		PlanId:             plan.GetPlanId(),
		ModId:              plan.GetModId(),
		Entries:            make([]*runtimev1.LocalExecutionEntryDescriptor, 0, len(plan.GetEntries())),
		InstalledAssets:    []*runtimev1.LocalAssetRecord{},
		Services:           []*runtimev1.LocalServiceDescriptor{},
		Capabilities:       []string{},
		StageResults:       []*runtimev1.LocalExecutionStageResult{},
		PreflightDecisions: clonePreflightDecisions(plan.GetPreflightDecisions()),
		RollbackApplied:    false,
		Warnings:           append([]string(nil), plan.GetWarnings()...),
	}

	selected := make([]*runtimev1.LocalExecutionEntryDescriptor, 0, len(plan.GetEntries()))
	for _, dep := range plan.GetEntries() {
		item := cloneDependencyDescriptor(dep)
		result.Entries = append(result.Entries, item)
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
		result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
			Stage:      applyStagePreflight,
			Ok:         false,
			ReasonCode: reasonCode,
			Detail:     preflightFailure,
		})
		result.ReasonCode = reasonCode
		return result
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
		Stage:      applyStagePreflight,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("dependencies=%d", len(selected)),
	})

	installedModelIDs := make([]string, 0, len(selected))
	installedServiceIDs := make([]string, 0, len(selected))
	passiveAssetIDs := make(map[string]bool, len(selected))
	modelRefToLocalID := make(map[string]string, len(selected)*2)

	// Stage 2: install artifacts
	for _, dep := range selected {
		switch dep.GetKind() {
		case runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_MODEL:
			modelID := defaultString(dep.GetModelId(), "local/default")

			// Override path: if modelID matches an already-installed asset by
			// local_asset_id, use it directly — no verified lookup or install needed.
			if existing := s.assetByLocalID(modelID); existing != nil && existing.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
				assetRecord := cloneLocalAsset(existing)
				result.InstalledAssets = append(result.InstalledAssets, assetRecord)
				localID := assetRecord.GetLocalAssetId()
				installedModelIDs = append(installedModelIDs, localID)
				if isRunnableKind(assetRecord.GetKind()) {
					modelRefToLocalID[localID] = localID
					if ref := strings.TrimSpace(dep.GetModelId()); ref != "" {
						modelRefToLocalID[ref] = localID
					}
				} else {
					passiveAssetIDs[localID] = true
				}
				continue
			}

			// Check if this is a passive asset (kind >= VAE). Passive assets
			// are installed via InstallVerifiedAsset and skip start/health.
			if verified := s.resolveVerifiedByAssetIDAndEngine(modelID, dep.GetEngine()); verified != nil && verified.GetKind() >= runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE {
				templateID := strings.TrimSpace(verified.GetTemplateId())
				if templateID == "" {
					result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
						Stage:      applyStageInstall,
						Ok:         false,
						ReasonCode: "LOCAL_DEPENDENCY_PASSIVE_TEMPLATE_REQUIRED",
						Detail:     modelID,
					})
					result.ReasonCode = "LOCAL_DEPENDENCY_PASSIVE_TEMPLATE_REQUIRED"
					s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
					return result
				}
				installed, err := s.InstallVerifiedAsset(ctx, &runtimev1.InstallVerifiedAssetRequest{
					TemplateId: templateID,
				})
				if err != nil || installed.GetAsset() == nil {
					detail := defaultString(fmt.Sprintf("%v", err), "passive asset install returned empty response")
					result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
						Stage:      applyStageInstall,
						Ok:         false,
						ReasonCode: "LOCAL_DEPENDENCY_PASSIVE_ASSET_INSTALL_FAILED",
						Detail:     detail,
					})
					result.ReasonCode = "LOCAL_DEPENDENCY_PASSIVE_ASSET_INSTALL_FAILED"
					s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
					return result
				}
				assetRecord := cloneLocalAsset(installed.GetAsset())
				result.InstalledAssets = append(result.InstalledAssets, assetRecord)
				localID := assetRecord.GetLocalAssetId()
				installedModelIDs = append(installedModelIDs, localID)
				passiveAssetIDs[localID] = true
				if ref := strings.TrimSpace(dep.GetModelId()); ref != "" {
					modelRefToLocalID[ref] = localID
				}
				modelRefToLocalID[localID] = localID
				continue
			}

			capabilities := normalizeStringSlice([]string{dep.GetCapability()})
			engine := defaultLocalEngine(dep.GetEngine(), capabilities)
			binding := resolveInstallRuntimeBinding(
				engine,
				capabilities,
				inferAssetKindFromCapabilities(capabilities),
				"",
				cloneDeviceProfile(plan.GetDeviceProfile()),
			)
			if normalizeRuntimeMode(binding.mode) == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT && strings.TrimSpace(binding.endpoint) == "" {
				result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
					Stage:      applyStageInstall,
					Ok:         false,
					ReasonCode: runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String(),
					Detail:     modelID,
				})
				result.ReasonCode = runtimev1.ReasonCode_AI_LOCAL_ENDPOINT_REQUIRED.String()
				s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
				return result
			}
			modelRecord, err := s.installLocalAssetRecord(
				modelID,
				inferAssetKindFromCapabilities(capabilities),
				capabilities,
				engine,
				"./dist/index.js",
				"unknown",
				dep.GetRepo(),
				"main",
				map[string]string{},
				binding.endpoint,
				binding.mode,
				"",
				nil,
				nil,
				"runtime_model_ready_after_install",
				"model installed",
				false,
			)
			if err != nil || modelRecord == nil {
				detail := defaultString(fmt.Sprintf("%v", err), "model install returned empty response")
				result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
					Stage:      applyStageInstall,
					Ok:         false,
					ReasonCode: "LOCAL_DEPENDENCY_MODEL_INSTALL_FAILED",
					Detail:     detail,
				})
				result.ReasonCode = "LOCAL_DEPENDENCY_MODEL_INSTALL_FAILED"
				s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
				return result
			}
			modelRecord = cloneLocalAsset(modelRecord)
			result.InstalledAssets = append(result.InstalledAssets, modelRecord)
			installedModelIDs = append(installedModelIDs, modelRecord.GetLocalAssetId())
			if ref := strings.TrimSpace(dep.GetModelId()); ref != "" {
				modelRefToLocalID[ref] = modelRecord.GetLocalAssetId()
			}
			modelRefToLocalID[modelRecord.GetLocalAssetId()] = modelRecord.GetLocalAssetId()
		case runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_SERVICE:
			serviceID := defaultString(dep.GetServiceId(), "svc_"+slug(dep.GetEntryId()))
			localModelID := s.resolveServiceDependencyLocalModelID(strings.TrimSpace(dep.GetModelId()), modelRefToLocalID)
			serviceEndpoint := ""
			if localModelID != "" {
				if modelRecord := s.modelByID(localModelID); modelRecord != nil {
					serviceEndpoint = s.effectiveLocalModelEndpoint(modelRecord)
				}
			}
			installed, err := s.InstallLocalService(ctx, &runtimev1.InstallLocalServiceRequest{
				ServiceId:    serviceID,
				Title:        serviceID,
				Engine:       defaultLocalEngine(dep.GetEngine(), []string{dep.GetCapability()}),
				Capabilities: normalizeStringSlice([]string{dep.GetCapability()}),
				LocalModelId: localModelID,
				Endpoint:     serviceEndpoint,
			})
			if err != nil || installed.GetService() == nil {
				detail := defaultString(fmt.Sprintf("%v", err), "service install returned empty response")
				result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
		case runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_NODE:
			// Node dependencies are validated in preflight and do not install artifacts.
		default:
			result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
				Stage:      applyStageInstall,
				Ok:         false,
				ReasonCode: "LOCAL_EXECUTION_ENTRY_KIND_UNSUPPORTED",
				Detail:     dep.GetEntryId(),
			})
			result.ReasonCode = "LOCAL_EXECUTION_ENTRY_KIND_UNSUPPORTED"
			s.rollbackApply(ctx, installedModelIDs, installedServiceIDs, result)
			return result
		}
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
		Stage:      applyStageInstall,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("models=%d services=%d", len(installedModelIDs), len(installedServiceIDs)),
	})

	// Stage 3: bootstrap (skip passive assets — no start needed)
	for _, modelID := range installedModelIDs {
		if passiveAssetIDs[modelID] {
			continue
		}
		started, err := s.StartLocalAsset(ctx, &runtimev1.StartLocalAssetRequest{LocalAssetId: modelID})
		if err != nil || started.GetAsset() == nil {
			result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
			result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
	result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
		Stage:      applyStageBootstrap,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     fmt.Sprintf("started models=%d services=%d", len(installedModelIDs), len(installedServiceIDs)),
	})

	// Stage 4: health gates (skip passive assets — no health check needed)
	for _, modelID := range installedModelIDs {
		if passiveAssetIDs[modelID] {
			continue
		}
		health, err := s.CheckLocalAssetHealth(ctx, &runtimev1.CheckLocalAssetHealthRequest{LocalAssetId: modelID})
		if err != nil || len(health.GetAssets()) == 0 || health.GetAssets()[0].GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
			result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
	result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
		Stage:      applyStageHealth,
		Ok:         true,
		ReasonCode: "ACTION_EXECUTED",
		Detail:     "all dependencies healthy",
	})

	result.ReasonCode = "ACTION_EXECUTED"
	return result
}

func (s *Service) runApplyPreflight(ctx context.Context, dep *runtimev1.LocalExecutionEntryDescriptor, profile *runtimev1.LocalDeviceProfile) *runtimev1.LocalPreflightDecision {
	if dep == nil {
		return &runtimev1.LocalPreflightDecision{
			Target:     "",
			Check:      "dependency-shape",
			Ok:         false,
			ReasonCode: "LOCAL_DEPENDENCY_OPTION_MISSING",
			Detail:     "dependency option missing",
		}
	}

	check := evaluateDependencyCandidate(&runtimev1.LocalExecutionOptionDescriptor{
		EntryId:    dep.GetEntryId(),
		Kind:       dep.GetKind(),
		Capability: dep.GetCapability(),
		ModelId:    dep.GetModelId(),
		Repo:       dep.GetRepo(),
		ServiceId:  dep.GetServiceId(),
		NodeId:     dep.GetNodeId(),
		Engine:     dep.GetEngine(),
	}, profile)
	decision := &runtimev1.LocalPreflightDecision{
		EntryId:    dep.GetEntryId(),
		Target:     preflightTargetForDependency(dep),
		Check:      defaultString(check.check, "dependency-shape"),
		Ok:         check.ok,
		ReasonCode: check.reasonCode,
		Detail:     check.detail,
	}
	if !decision.GetOk() || dep.GetKind() != runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_NODE {
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
		decision.Detail = defaultString(node.GetNodeId(), dep.GetEntryId())
		return decision
	}

	decision.Ok = false
	decision.Check = "node-catalog"
	decision.ReasonCode = "LOCAL_DEPENDENCY_NODE_UNRESOLVED"
	decision.Detail = defaultString(nodeID, dep.GetEntryId()) + " not found in node catalog"
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
	if model := s.assets[ref]; model != nil {
		return ref
	}
	for _, model := range s.assets {
		if model == nil {
			continue
		}
		if model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if strings.TrimSpace(model.GetAssetId()) == ref {
			return strings.TrimSpace(model.GetLocalAssetId())
		}
	}
	return ref
}

func (s *Service) rollbackApply(ctx context.Context, modelIDs []string, serviceIDs []string, result *runtimev1.LocalExecutionApplyResult) {
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
		if _, err := s.RemoveLocalAsset(ctx, &runtimev1.RemoveLocalAssetRequest{LocalAssetId: modelID}); err != nil {
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
		result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
			Stage:      applyStageRollback,
			Ok:         false,
			ReasonCode: rollbackReason,
			Detail:     strings.Join(rollbackFailures, "; "),
		})
		return
	}
	result.StageResults = append(result.StageResults, &runtimev1.LocalExecutionStageResult{
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
	if reason, ok := grpcerr.ExtractReasonCode(err); ok && reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		return reason.String()
	}
	if st, ok := status.FromError(err); ok {
		switch st.Code() {
		case codes.NotFound, codes.InvalidArgument:
			return runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String()
		}
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
