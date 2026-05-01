package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	localEnvironmentStateUnknown           = "unknown"
	localEnvironmentStateNeedsConfirmation = "needs_confirmation"
	localEnvironmentStateQueued            = "queued"
	localEnvironmentStateDownloading       = "downloading"
	localEnvironmentStateVerifying         = "verifying"
	localEnvironmentStateInstalling        = "installing"
	localEnvironmentStateReadySystem       = "ready_system"
	localEnvironmentStateReadyManaged      = "ready_managed"
	localEnvironmentStateRepairRequired    = "repair_required"
	localEnvironmentStateFailed            = "failed"
	localEnvironmentStateUnsupported       = "unsupported"
	localEnvironmentStateCancelled         = "cancelled"
)

const (
	localEnvironmentFamilyCUDA             = "accelerator.cuda.runtime"
	localEnvironmentFamilyNativeLlama      = "native-engine-package.llama"
	localEnvironmentFamilyNativeSDCPP      = "native-engine-package.stablediffusion-ggml"
	localEnvironmentFamilyPythonUV         = "python.tool.uv"
	localEnvironmentFamilyPythonRuntime    = "python.runtime"
	localEnvironmentFamilyPythonVenv       = "python.venv"
	localEnvironmentFamilyPythonPackageSet = "python.package-set"
	localEnvironmentFamilyPythonTorchWheel = "python.torch-wheel"
	localEnvironmentFamilyModelAsset       = "model.asset"
	localEnvironmentFamilyModelCompanion   = "model.companion-asset"
)

type localEnvironmentPlanRequest struct {
	PackID           string
	ConsumerScope    string
	HostProfile      *runtimev1.LocalDeviceProfile
	RuntimeDataRoot  string
	AssetID          string
	LocalAssetID     string
	CompanionAssetID string
	ParentAssetID    string
}

type localEnvironmentPlan struct {
	PlanID          string
	PackID          string
	ProductLabel    string
	HostProfileID   string
	PlatformTuple   string
	RuntimeDataRoot string
	ConsumerScope   string
	CloudOnlyImpact string
	State           string
	ReasonCode      string
	Dependencies    []localEnvironmentPlanDependency
}

type localEnvironmentPlanDependency struct {
	DependencyFamily       string
	DependencyID           string
	Required               bool
	State                  string
	SourceKind             string
	ConfirmationRequired   bool
	SelectedSourceRecordID string
	EnvironmentKey         string
	CanonicalRoot          string
	ReasonCode             string
	Detail                 string
}

type localComputePackDefinition struct {
	PackID                     string
	ProductLabel               string
	RequiredDependencyFamilies []string
	OptionalDependencyFamilies []string
	CloudOnlyImpact            string
}

func (s *Service) resolveLocalEnvironmentPlan(req localEnvironmentPlanRequest) localEnvironmentPlan {
	packID := strings.TrimSpace(req.PackID)
	def, ok := localComputePackByID(packID)
	if !ok {
		return localEnvironmentPlan{
			PlanID:          "localenv_plan_" + shortHash(packID+"|unsupported"),
			PackID:          packID,
			CloudOnlyImpact: "none",
			State:           localEnvironmentStateUnsupported,
			ReasonCode:      "LOCAL_ENVIRONMENT_PACK_UNSUPPORTED",
		}
	}

	profile := cloneDeviceProfile(req.HostProfile)
	if profile == nil {
		profile = collectDeviceProfile()
	}
	hostState := localEnvironmentHostProfileFromDeviceProfile(profile)
	runtimeDataRoot := strings.TrimSpace(req.RuntimeDataRoot)
	if runtimeDataRoot == "" {
		runtimeDataRoot = strings.TrimSpace(s.localModelsPath)
	}
	consumerScope := strings.TrimSpace(req.ConsumerScope)
	if consumerScope == "" {
		consumerScope = def.PackID
	}
	platformTuple := localEnvironmentPlatformTuple(hostState)

	s.mu.Lock()
	if s.localEnvironmentHostProfiles == nil {
		s.localEnvironmentHostProfiles = make(map[string]localEnvironmentHostProfileState)
	}
	s.localEnvironmentHostProfiles[hostState.HostProfileID] = hostState
	s.persistStateLocked()
	s.mu.Unlock()

	dependencies := make([]localEnvironmentPlanDependency, 0, len(def.RequiredDependencyFamilies)+len(def.OptionalDependencyFamilies))
	for _, family := range def.RequiredDependencyFamilies {
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, true, hostState, platformTuple, runtimeDataRoot, consumerScope, req))
	}
	for _, family := range def.OptionalDependencyFamilies {
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, false, hostState, platformTuple, runtimeDataRoot, consumerScope, req))
	}

	state := localEnvironmentStateReadyManaged
	reasonCode := "LOCAL_ENVIRONMENT_PLAN_READY"
	for _, dep := range dependencies {
		if dep.Required && dep.State != localEnvironmentStateReadyManaged && dep.State != localEnvironmentStateReadySystem {
			state = localEnvironmentStateNeedsConfirmation
			reasonCode = "LOCAL_ENVIRONMENT_PLAN_REQUIRES_SETUP"
			if dep.State == localEnvironmentStateUnsupported {
				state = localEnvironmentStateUnsupported
				reasonCode = "LOCAL_ENVIRONMENT_PLAN_UNSUPPORTED"
				break
			}
			if dep.State == localEnvironmentStateRepairRequired {
				state = localEnvironmentStateRepairRequired
				reasonCode = "LOCAL_ENVIRONMENT_PLAN_REPAIR_REQUIRED"
				break
			}
		}
	}

	return localEnvironmentPlan{
		PlanID:          "localenv_plan_" + shortHash(def.PackID+"|"+hostState.HostProfileID+"|"+runtimeDataRoot+"|"+consumerScope),
		PackID:          def.PackID,
		ProductLabel:    def.ProductLabel,
		HostProfileID:   hostState.HostProfileID,
		PlatformTuple:   platformTuple,
		RuntimeDataRoot: runtimeDataRoot,
		ConsumerScope:   consumerScope,
		CloudOnlyImpact: def.CloudOnlyImpact,
		State:           state,
		ReasonCode:      reasonCode,
		Dependencies:    dependencies,
	}
}

func (s *Service) resolveLocalEnvironmentDependency(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string, req localEnvironmentPlanRequest) localEnvironmentPlanDependency {
	dependencyID := s.localEnvironmentDependencyID(def.PackID, family, req)
	environmentKey := localEnvironmentKey(family, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot, consumerScope)
	dep := localEnvironmentPlanDependency{
		DependencyFamily: family,
		DependencyID:     dependencyID,
		Required:         required,
		EnvironmentKey:   environmentKey,
		State:            localEnvironmentStateNeedsConfirmation,
		SourceKind:       localEnvironmentSourceManaged,
		ReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED",
	}

	if (family == localEnvironmentFamilyModelAsset || family == localEnvironmentFamilyModelCompanion) && strings.TrimSpace(dependencyID) == "" {
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
		dep.ConfirmationRequired = false
		dep.ReasonCode = "LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED"
		dep.Detail = "model asset dependencies require explicit asset identity"
		return dep
	}

	if family == localEnvironmentFamilyCUDA && !localEnvironmentHostSupportsCUDA(hostState) {
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
		dep.ConfirmationRequired = false
		dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
		return dep
	}

	if record, ok := s.localEnvironmentSelectedSourceRecord(environmentKey); ok {
		dep.SourceKind = record.SourceKind
		dep.SelectedSourceRecordID = record.RecordID
		dep.CanonicalRoot = record.CanonicalRoot
		switch strings.TrimSpace(record.RepairState) {
		case localEnvironmentRepairRequired, localEnvironmentRepairRunning, localEnvironmentRepairFailed:
			dep.State = localEnvironmentStateRepairRequired
			dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
		default:
			if record.SourceKind == localEnvironmentSourceSystem {
				dep.State = localEnvironmentStateReadySystem
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_READY_SYSTEM"
			} else if record.SourceKind == localEnvironmentSourceUnavailable {
				dep.State = localEnvironmentStateUnsupported
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
			} else {
				dep.State = localEnvironmentStateReadyManaged
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED"
			}
		}
		return dep
	}

	dep.ConfirmationRequired = true
	return dep
}

func (s *Service) localEnvironmentDependencyID(packID string, family string, req localEnvironmentPlanRequest) string {
	switch family {
	case localEnvironmentFamilyModelAsset:
		return localEnvironmentAssetDependencyID(strings.TrimSpace(req.LocalAssetID), strings.TrimSpace(req.AssetID))
	case localEnvironmentFamilyModelCompanion:
		return localEnvironmentAssetDependencyID(strings.TrimSpace(req.CompanionAssetID), "")
	default:
		return defaultLocalEnvironmentDependencyID(packID, family)
	}
}

func localEnvironmentAssetDependencyID(localAssetID string, assetID string) string {
	if trimmed := strings.TrimSpace(localAssetID); trimmed != "" {
		return "asset:" + trimmed
	}
	if trimmed := strings.TrimSpace(assetID); trimmed != "" {
		return "asset-id:" + trimmed
	}
	return ""
}

func localEnvironmentHostSupportsCUDA(host localEnvironmentHostProfileState) bool {
	return host.GPUAvailable && strings.EqualFold(strings.TrimSpace(host.GPUVendor), "nvidia")
}

func localComputePackByID(packID string) (localComputePackDefinition, bool) {
	for _, def := range localComputePackDefinitions() {
		if def.PackID == strings.TrimSpace(packID) {
			return def, true
		}
	}
	return localComputePackDefinition{}, false
}

func localComputePackDefinitions() []localComputePackDefinition {
	return []localComputePackDefinition{
		{
			PackID:                     "local-text",
			ProductLabel:               "Local text",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyNativeLlama, localEnvironmentFamilyModelAsset},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:                     "local-image-native",
			ProductLabel:               "Local image native",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyNativeSDCPP, localEnvironmentFamilyModelAsset, localEnvironmentFamilyModelCompanion},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:       "local-image-python",
			ProductLabel: "Local image Python workflows",
			RequiredDependencyFamilies: []string{
				localEnvironmentFamilyPythonUV,
				localEnvironmentFamilyPythonRuntime,
				localEnvironmentFamilyPythonVenv,
				localEnvironmentFamilyPythonPackageSet,
				localEnvironmentFamilyPythonTorchWheel,
				localEnvironmentFamilyModelAsset,
				localEnvironmentFamilyModelCompanion,
			},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:       "local-video-python",
			ProductLabel: "Local video Python workflows",
			RequiredDependencyFamilies: []string{
				localEnvironmentFamilyPythonUV,
				localEnvironmentFamilyPythonRuntime,
				localEnvironmentFamilyPythonVenv,
				localEnvironmentFamilyPythonPackageSet,
				localEnvironmentFamilyPythonTorchWheel,
				localEnvironmentFamilyModelAsset,
				localEnvironmentFamilyModelCompanion,
			},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:                     "local-speech",
			ProductLabel:               "Local speech",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyModelAsset},
			OptionalDependencyFamilies: []string{},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:                     "local-gpu-support",
			ProductLabel:               "Local GPU support",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			OptionalDependencyFamilies: []string{},
			CloudOnlyImpact:            "none",
		},
	}
}

func defaultLocalEnvironmentDependencyID(packID string, family string) string {
	switch family {
	case localEnvironmentFamilyCUDA:
		return cudaUserSpaceRuntimeDependencyID
	case localEnvironmentFamilyNativeLlama:
		return "llama.cpp.package"
	case localEnvironmentFamilyNativeSDCPP:
		return "stable-diffusion.cpp.package"
	case localEnvironmentFamilyPythonUV:
		return "uv"
	case localEnvironmentFamilyPythonRuntime:
		return "python.runtime"
	case localEnvironmentFamilyPythonVenv:
		return packID + ".venv"
	case localEnvironmentFamilyPythonPackageSet:
		return packID + ".package-set"
	case localEnvironmentFamilyPythonTorchWheel:
		return packID + ".torch-wheel"
	case localEnvironmentFamilyModelAsset:
		return packID + ".model-asset"
	case localEnvironmentFamilyModelCompanion:
		return packID + ".companion-asset"
	default:
		return strings.ReplaceAll(family, ".", "-")
	}
}
