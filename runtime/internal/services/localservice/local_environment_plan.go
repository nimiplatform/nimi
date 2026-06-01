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

// localResolverCapability* are the precise K-MCAT-033 preset-slot capability
// identifiers a compute pack may host a model asset for (design/05 §3). They
// are matched verbatim against the resolver's ResolvedSlot.Capability.
const (
	localResolverCapabilityTextGenerate    = "text.generate"
	localResolverCapabilityAudioTranscribe = "audio.transcribe"
	localResolverCapabilityAudioSynthesize = "audio.synthesize"
	localResolverCapabilityImageGenerate   = "image.generate"
	localResolverCapabilityVideoGenerate   = "video.generate"
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
	// InstallLevel is the first-run install level (minimal | recommended | "").
	// When set and no explicit AssetID is supplied, the plan resolves the
	// pack's model.asset / model.companion-asset dependencies internally via the
	// K-MCAT-034 deterministic resolver from the curated preset + host posture
	// (design/05 §2-3). An explicit AssetID always wins; an empty InstallLevel
	// preserves the prior explicit-identity behaviour.
	InstallLevel string
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
	// HostedCapabilities is the explicit set of resolver-slot capabilities a
	// pack hosts model assets for (design/05 §3). It is NOT the broad
	// product-facing `capabilities` grouping of local-compute-packs.yaml; it is
	// the precise per-slot capability set the K-MCAT-033 presets bind
	// (`text.generate` | `audio.transcribe` | `audio.synthesize` |
	// `image.generate`). When install-level resolution is requested, the plan
	// emits one model.asset dependency per resolved preset slot whose capability
	// appears here — so a multi-slot pack (`local-speech` hosts both stt and
	// tts) materialises every hosted asset. Empty means the pack hosts no
	// preset model slot and install-level resolution does not apply.
	HostedCapabilities []string
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

	profile := hostProfileOrCollected(req.HostProfile)
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

	// design/05 §2-3: when an install_level is supplied and the caller passes no
	// explicit AssetID, the plan resolves the pack's model.asset /
	// model.companion-asset dependencies internally via the K-MCAT-034
	// deterministic resolver. A pack may host more than one preset slot
	// (`local-speech` hosts both stt and tts), so `model.asset` is 1:N per pack:
	// one dependency per resolved preset slot whose capability the pack hosts.
	//
	// The resolver consumes `profile` — the host posture this plan already
	// normalized above (a caller-supplied HostProfile, or one collected on this
	// host when the request omitted it). It must never read req.HostProfile
	// directly: a nil request HostProfile would zero the resolver's RAM budget
	// and fail-close every cpu variant even on a capable host.
	modelResolution := s.resolvePlanModelAssetDependencies(def, hostState, platformTuple, runtimeDataRoot, req, profile)

	dependencies := make([]localEnvironmentPlanDependency, 0, len(def.RequiredDependencyFamilies)+len(def.OptionalDependencyFamilies))
	for _, family := range def.RequiredDependencyFamilies {
		if resolved, ok := modelResolution[family]; ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, true, hostState, platformTuple, runtimeDataRoot, consumerScope, req); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, true, hostState, platformTuple, runtimeDataRoot, consumerScope, req))
	}
	for _, family := range def.OptionalDependencyFamilies {
		required := localEnvironmentOptionalDependencyRequiredForConsumer(def, family, hostState, consumerScope)
		if resolved, ok := modelResolution[family]; ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, required, hostState, platformTuple, runtimeDataRoot, consumerScope, req); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, required, hostState, platformTuple, runtimeDataRoot, consumerScope, req))
	}
	for i := range dependencies {
		dependencies[i] = s.resolveLocalEnvironmentPlanDependencyJobProjection(dependencies[i])
	}

	state, reasonCode := localEnvironmentPlanState(dependencies)

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

func (s *Service) resolveLocalEnvironmentPlanDependencyJobProjection(dep localEnvironmentPlanDependency) localEnvironmentPlanDependency {
	if !localEnvironmentDependencyBlocksActivation(dep.State) {
		return dep
	}
	job, ok := s.latestLocalEnvironmentDependencyJobForEnvironment(dep.EnvironmentKey)
	if !ok {
		return dep
	}
	switch strings.TrimSpace(job.State) {
	case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling,
		localEnvironmentStateRepairRequired, localEnvironmentStateFailed, localEnvironmentStateCancelled, localEnvironmentStateUnsupported:
	default:
		return dep
	}
	dep.State = strings.TrimSpace(job.State)
	dep.ConfirmationRequired = false
	if sourceKind := strings.TrimSpace(job.SourceKind); sourceKind != "" {
		dep.SourceKind = sourceKind
	}
	dep.CanonicalRoot = strings.TrimSpace(job.CanonicalRoot)
	dep.SelectedSourceRecordID = strings.TrimSpace(job.SelectedSourceRecordID)
	dep.Detail = strings.TrimSpace(job.FailureDetail)
	dep.ReasonCode = localEnvironmentActivationDependencyReason(dep.State)
	return dep
}

func localEnvironmentPlanState(dependencies []localEnvironmentPlanDependency) (string, string) {
	state := localEnvironmentStateReadyManaged
	reasonCode := "LOCAL_ENVIRONMENT_PLAN_READY"
	for _, dep := range dependencies {
		if !dep.Required || !localEnvironmentDependencyBlocksActivation(dep.State) {
			continue
		}
		if state == localEnvironmentStateReadyManaged {
			state = localEnvironmentStateNeedsConfirmation
			reasonCode = "LOCAL_ENVIRONMENT_PLAN_REQUIRES_SETUP"
		}
		switch strings.TrimSpace(dep.State) {
		case localEnvironmentStateUnsupported:
			return localEnvironmentStateUnsupported, "LOCAL_ENVIRONMENT_PLAN_UNSUPPORTED"
		case localEnvironmentStateRepairRequired:
			return localEnvironmentStateRepairRequired, "LOCAL_ENVIRONMENT_PLAN_REPAIR_REQUIRED"
		case localEnvironmentStateFailed:
			return localEnvironmentStateFailed, "LOCAL_ENVIRONMENT_PLAN_FAILED"
		case localEnvironmentStateCancelled:
			return localEnvironmentStateCancelled, "LOCAL_ENVIRONMENT_PLAN_CANCELLED"
		case localEnvironmentStateQueued, localEnvironmentStateDownloading, localEnvironmentStateVerifying, localEnvironmentStateInstalling:
			return dep.State, "LOCAL_ENVIRONMENT_PLAN_SETUP_IN_PROGRESS"
		}
	}
	return state, reasonCode
}

func (s *Service) resolveLocalEnvironmentDependency(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string, req localEnvironmentPlanRequest) localEnvironmentPlanDependency {
	dependencyID := s.localEnvironmentDependencyID(def.PackID, family, req)
	return s.resolveLocalEnvironmentDependencyWithID(def, family, dependencyID, required, hostState, platformTuple, runtimeDataRoot, consumerScope)
}

func (s *Service) resolveLocalEnvironmentDependencyWithID(def localComputePackDefinition, family string, dependencyID string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string) localEnvironmentPlanDependency {
	environmentKey := localEnvironmentKey(family, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot)
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
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			dep.State = localEnvironmentStateRepairRequired
			dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
			dep.Detail = err.Error()
			return dep
		}
		if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			dep.State = localEnvironmentStateRepairRequired
			dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
			dep.Detail = err.Error()
			return dep
		}
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

	if family == localEnvironmentFamilyCUDA {
		return s.resolveLocalEnvironmentCUDAProjection(dep, consumerScope)
	}

	dep.ConfirmationRequired = true
	return dep
}

func (s *Service) resolveExpandedLocalEnvironmentDependencies(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string, _ localEnvironmentPlanRequest) ([]localEnvironmentPlanDependency, bool) {
	if def.PackID != "local-speech" {
		return nil, false
	}
	if family != localEnvironmentFamilyPythonVenv && family != localEnvironmentFamilyPythonPackageSet {
		return nil, false
	}
	consumers := localSpeechPlanConsumers(consumerScope)
	dependencies := make([]localEnvironmentPlanDependency, 0, len(consumers))
	for _, consumer := range consumers {
		dependencyID := localSpeechPythonDependencyID(family, consumer)
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependencyWithID(def, family, dependencyID, required, hostState, platformTuple, runtimeDataRoot, consumer))
	}
	return dependencies, true
}

func localSpeechPlanConsumers(consumerScope string) []string {
	switch strings.TrimSpace(consumerScope) {
	case "speech.qwen3-asr.python":
		return []string{"speech.qwen3-asr.python"}
	case "speech.qwen3-tts.python":
		return []string{"speech.qwen3-tts.python"}
	default:
		return []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"}
	}
}

func localEnvironmentOptionalDependencyRequiredForConsumer(def localComputePackDefinition, family string, hostState localEnvironmentHostProfileState, consumerScope string) bool {
	if family != localEnvironmentFamilyCUDA {
		return false
	}
	scope := strings.TrimSpace(consumerScope)
	if localEnvironmentCUDAConsumerScopeRequiresRuntime(scope) {
		return true
	}
	return def.PackID == "local-text" &&
		localEnvironmentHostSupportsCUDA(hostState) &&
		localEnvironmentFirstRunConsumerScope(scope)
}

func localEnvironmentCUDAConsumerScopeRequiresRuntime(consumerScope string) bool {
	switch strings.TrimSpace(consumerScope) {
	case "llama.cpp.cuda", stableDiffusionCUDAConsumerID, "media.diffusers.cuda", "media.video-python.cuda":
		return true
	default:
		return false
	}
}

func localEnvironmentFirstRunConsumerScope(consumerScope string) bool {
	switch strings.TrimSpace(consumerScope) {
	case "first-run", "desktop.first-run":
		return true
	default:
		return false
	}
}

func localSpeechPythonDependencyID(family string, consumer string) string {
	suffix := ""
	switch family {
	case localEnvironmentFamilyPythonVenv:
		suffix = "venv"
	case localEnvironmentFamilyPythonPackageSet:
		suffix = "package-set"
	default:
		suffix = strings.ReplaceAll(family, ".", "-")
	}
	switch strings.TrimSpace(consumer) {
	case "speech.qwen3-asr.python":
		return "local-speech-qwen3-asr." + suffix
	case "speech.qwen3-tts.python":
		return "local-speech-qwen3-tts." + suffix
	default:
		return "local-speech." + suffix
	}
}

func (s *Service) localEnvironmentDependencyID(packID string, family string, req localEnvironmentPlanRequest) string {
	switch family {
	case localEnvironmentFamilyModelAsset:
		return s.localEnvironmentModelAssetDependencyID(strings.TrimSpace(req.LocalAssetID), strings.TrimSpace(req.AssetID))
	case localEnvironmentFamilyModelCompanion:
		return s.localEnvironmentCompanionAssetDependencyID(strings.TrimSpace(req.CompanionAssetID), strings.TrimSpace(req.ParentAssetID), strings.TrimSpace(req.LocalAssetID))
	default:
		return defaultLocalEnvironmentDependencyID(packID, family)
	}
}

func (s *Service) localEnvironmentModelAssetDependencyID(localAssetID string, assetID string) string {
	if trimmed := strings.TrimSpace(assetID); trimmed != "" {
		return "asset-id:" + trimmed
	}
	if model := s.modelByID(strings.TrimSpace(localAssetID)); model != nil {
		if trimmed := strings.TrimSpace(model.GetAssetId()); trimmed != "" {
			return "asset-id:" + trimmed
		}
	}
	return ""
}

func (s *Service) localEnvironmentCompanionAssetDependencyID(companionAssetID string, parentAssetID string, parentLocalAssetID string) string {
	companion := strings.TrimSpace(companionAssetID)
	parent := strings.TrimSpace(parentAssetID)
	if parent == "" {
		if model := s.modelByID(strings.TrimSpace(parentLocalAssetID)); model != nil {
			parent = strings.TrimSpace(model.GetAssetId())
		}
	}
	if companion == "" || parent == "" {
		return ""
	}
	return "asset-id:" + companion + "|parent-asset-id:" + parent
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
			HostedCapabilities:         []string{localResolverCapabilityTextGenerate},
		},
		{
			PackID:                     "local-image-native",
			ProductLabel:               "Local image native",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyNativeSDCPP, localEnvironmentFamilyModelAsset, localEnvironmentFamilyModelCompanion},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
			HostedCapabilities:         []string{localResolverCapabilityImageGenerate},
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
			HostedCapabilities:         []string{localResolverCapabilityImageGenerate},
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
			HostedCapabilities:         []string{localResolverCapabilityVideoGenerate},
		},
		{
			PackID:                     "local-speech",
			ProductLabel:               "Local speech",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyModelAsset},
			OptionalDependencyFamilies: []string{},
			CloudOnlyImpact:            "none",
			HostedCapabilities:         []string{localResolverCapabilityAudioTranscribe, localResolverCapabilityAudioSynthesize},
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
