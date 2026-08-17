package localservice

import (
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
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
)

type localEnvironmentPlanRequest struct {
	PackID          string
	ConsumerScope   string
	HostProfile     *runtimev1.LocalDeviceProfile
	RuntimeDataRoot string
}

type localEnvironmentPlan struct {
	PlanID                     string
	PackID                     string
	ProductLabel               string
	HostProfileID              string
	PlatformTuple              string
	RuntimeDataRoot            string
	ConsumerScope              string
	CloudOnlyImpact            string
	State                      string
	ReasonCode                 string
	Dependencies               []localEnvironmentPlanDependency
	RequiredDependencyFamilies []string
	AggregateSizeKnown         bool
	AggregateSizeBytes         int64
	StorageCategories          []string
	SourceOwners               []string
	NoSystemMutation           bool
}

type localEnvironmentPlanDependency struct {
	DependencyFamily       string
	DependencyID           string
	ConsumerScope          string
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

func localEnvironmentTargetForDriver(driver capabilitydriver.Driver, host localEnvironmentHostProfileState) (string, string, bool) {
	switch driver.(type) {
	case capabilitydriver.LlamaTextDriver:
		consumer := "llama.cpp.cpu"
		if localEnvironmentHostSupportsCUDA(host) {
			consumer = "llama.cpp.cuda"
		} else if strings.EqualFold(strings.TrimSpace(host.OS), "darwin") {
			consumer = "llama.cpp.metal"
		}
		return "local-text", consumer, true
	case capabilitydriver.StableDiffusionImageDriver:
		consumer := "stable-diffusion.cpp.cpu"
		if strings.EqualFold(strings.TrimSpace(host.OS), "darwin") {
			consumer = "stable-diffusion.cpp.metal"
		} else if localEnvironmentHostSupportsCUDA(host) {
			consumer = stableDiffusionCUDAConsumerID
		}
		return "local-image-native", consumer, true
	case capabilitydriver.Qwen3TTSDriver:
		return "local-speech", "speech.qwen3-tts.python", true
	case capabilitydriver.VoxCPMDriver:
		return "local-speech", "speech.voxcpm.python", true
	case capabilitydriver.Qwen3ASRDriver:
		return "local-speech", "speech.qwen3-asr.python", true
	case capabilitydriver.Qwen3ASRTransformersDriver:
		return "local-speech", "speech.qwen3-asr-transformers.python", true
	default:
		return "", "", false
	}
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
		runtimeDataRoot = s.localEnvironmentRuntimeDataRoot()
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

	firstRunLlamaCUDARequired := s.localEnvironmentFirstRunLlamaCUDARequired(def, consumerScope)

	dependencies := make([]localEnvironmentPlanDependency, 0, len(def.RequiredDependencyFamilies)+len(def.OptionalDependencyFamilies))
	for _, family := range def.RequiredDependencyFamilies {
		dependencyConsumerScope := localEnvironmentDependencyConsumerScope(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, true, hostState, platformTuple, runtimeDataRoot, consumerScope); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, true, hostState, platformTuple, runtimeDataRoot, dependencyConsumerScope))
	}
	for _, family := range def.OptionalDependencyFamilies {
		required := localEnvironmentOptionalDependencyRequiredForConsumer(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		dependencyConsumerScope := localEnvironmentDependencyConsumerScope(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, required, hostState, platformTuple, runtimeDataRoot, consumerScope); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, required, hostState, platformTuple, runtimeDataRoot, dependencyConsumerScope))
	}
	for i := range dependencies {
		dependencies[i] = s.resolveLocalEnvironmentPlanDependencyJobProjection(dependencies[i])
	}
	s.rememberLocalEnvironmentPlanDependencyContracts(dependencies)

	state, reasonCode := localEnvironmentPlanState(dependencies)
	requiredFamilies, aggregateSizeKnown, aggregateSizeBytes, storageCategories, sourceOwners := localEnvironmentPlanConfirmationProjection(dependencies)

	plan := localEnvironmentPlan{
		PackID:                     def.PackID,
		ProductLabel:               def.ProductLabel,
		HostProfileID:              hostState.HostProfileID,
		PlatformTuple:              platformTuple,
		RuntimeDataRoot:            runtimeDataRoot,
		ConsumerScope:              consumerScope,
		CloudOnlyImpact:            def.CloudOnlyImpact,
		State:                      state,
		ReasonCode:                 reasonCode,
		Dependencies:               dependencies,
		RequiredDependencyFamilies: requiredFamilies,
		AggregateSizeKnown:         aggregateSizeKnown,
		AggregateSizeBytes:         aggregateSizeBytes,
		StorageCategories:          storageCategories,
		SourceOwners:               sourceOwners,
		NoSystemMutation:           true,
	}
	plan.PlanID = localEnvironmentPlanIdentity(plan)
	return plan
}

func localEnvironmentPlanIdentity(plan localEnvironmentPlan) string {
	parts := make([]string, 0, 16+len(plan.Dependencies)*6)
	appendPart := func(value string) {
		parts = append(parts, strconv.Itoa(len(value))+":"+value)
	}
	for _, value := range []string{
		plan.PackID,
		plan.HostProfileID,
		plan.PlatformTuple,
		plan.RuntimeDataRoot,
		plan.ConsumerScope,
		plan.CloudOnlyImpact,
	} {
		appendPart(strings.TrimSpace(value))
	}
	for _, dep := range plan.Dependencies {
		if !dep.Required {
			continue
		}
		for _, value := range []string{
			dep.DependencyFamily,
			dep.DependencyID,
			dep.EnvironmentKey,
			dep.SourceKind,
			dep.ConsumerScope,
		} {
			appendPart(strings.TrimSpace(value))
		}
	}
	for _, family := range plan.RequiredDependencyFamilies {
		appendPart(strings.TrimSpace(family))
	}
	appendPart(strconv.FormatBool(plan.AggregateSizeKnown))
	appendPart(strconv.FormatInt(plan.AggregateSizeBytes, 10))
	for _, category := range plan.StorageCategories {
		appendPart(strings.TrimSpace(category))
	}
	for _, owner := range plan.SourceOwners {
		appendPart(strings.TrimSpace(owner))
	}
	appendPart(strconv.FormatBool(plan.NoSystemMutation))
	return "localenv_plan_" + shortHash(strings.Join(parts, "\x1f"))
}

func localEnvironmentPlanConfirmationProjection(dependencies []localEnvironmentPlanDependency) ([]string, bool, int64, []string, []string) {
	requiredFamilies := make([]string, 0, len(dependencies))
	storageCategories := make([]string, 0, 3)
	familySeen := make(map[string]struct{}, len(dependencies))
	categorySeen := make(map[string]struct{}, 3)
	hasRequired := false

	for _, dep := range dependencies {
		if !dep.Required {
			continue
		}
		hasRequired = true
		family := strings.TrimSpace(dep.DependencyFamily)
		if _, ok := familySeen[family]; family != "" && !ok {
			familySeen[family] = struct{}{}
			requiredFamilies = append(requiredFamilies, family)
		}
		category := localEnvironmentDependencyStorageCategory(family)
		if _, ok := categorySeen[category]; category != "" && !ok {
			categorySeen[category] = struct{}{}
			storageCategories = append(storageCategories, category)
		}
	}

	if !hasRequired {
		return requiredFamilies, false, 0, storageCategories, nil
	}
	// The current plan contract has no complete positive byte-size source for
	// every materializer in a capability DAG. Never infer a zero-byte download
	// from ready state or an absent estimate.
	return requiredFamilies, false, 0, storageCategories, []string{"RuntimeLocalService"}
}

func localEnvironmentDependencyStorageCategory(family string) string {
	switch family {
	case localEnvironmentFamilyCUDA, localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonTorchWheel:
		return "dependencies"
	case localEnvironmentFamilyNativeLlama, localEnvironmentFamilyNativeSDCPP,
		localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet:
		return "environments"
	default:
		return ""
	}
}

func (s *Service) resolveLocalEnvironmentPlanDependencyJobProjection(dep localEnvironmentPlanDependency) localEnvironmentPlanDependency {
	if !localEnvironmentDependencyBlocksActivation(dep.State) {
		return dep
	}
	job, ok := s.latestLocalEnvironmentDependencyJobForDependency(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope)
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

func (s *Service) resolveLocalEnvironmentDependency(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string) localEnvironmentPlanDependency {
	dependencyID := defaultLocalEnvironmentDependencyID(def.PackID, family)
	if (family == localEnvironmentFamilyPythonVenv || family == localEnvironmentFamilyPythonPackageSet) && strings.HasPrefix(strings.TrimSpace(consumerScope), "media.") {
		plane := "cpu"
		if localEnvironmentHostSupportsCUDA(hostState) {
			plane = "cuda"
		}
		identity, err := engine.ResolvePythonDependencyProfileIdentity(consumerScope, platformTuple, plane)
		if err != nil {
			return localEnvironmentUnsupportedPythonProfileDependency(family, required, consumerScope, runtimeDataRoot, err)
		}
		dependencyID = identity.DependencyID
	}
	return s.resolveLocalEnvironmentDependencyWithID(def, family, dependencyID, required, hostState, platformTuple, runtimeDataRoot, consumerScope)
}

func (s *Service) resolveLocalEnvironmentDependencyWithID(def localComputePackDefinition, family string, dependencyID string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string) localEnvironmentPlanDependency {
	environmentKey := localEnvironmentKey(family, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot)
	var torchIdentityErr error
	switch family {
	case localEnvironmentFamilyPythonUV:
		environmentKey = localEnvironmentManagedUVKey(platformTuple, runtimeDataRoot)
	case localEnvironmentFamilyPythonRuntime:
		dependencyID = localEnvironmentPythonRuntimeDependencyID()
		environmentKey = localEnvironmentPythonRuntimeKey(platformTuple, runtimeDataRoot)
	case localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet:
		if strings.HasPrefix(strings.TrimSpace(dependencyID), "python-profile.") {
			environmentKey = localEnvironmentPythonProfileKey(family, dependencyID, runtimeDataRoot)
		}
	case localEnvironmentFamilyPythonTorchWheel:
		var identity engine.PythonTorchWheelDependencyIdentity
		identity, torchIdentityErr = engine.ResolvePythonTorchWheelDependencyIdentity(consumerScope)
		if torchIdentityErr == nil {
			dependencyID = localEnvironmentPythonTorchWheelDependencyID(identity)
			environmentKey = localEnvironmentPythonTorchWheelKey(identity, platformTuple, runtimeDataRoot)
		}
	}
	dep := localEnvironmentPlanDependency{
		DependencyFamily: family,
		DependencyID:     dependencyID,
		ConsumerScope:    strings.TrimSpace(consumerScope),
		Required:         required,
		EnvironmentKey:   environmentKey,
		State:            localEnvironmentStateNeedsConfirmation,
		SourceKind:       localEnvironmentSourceManaged,
		ReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_CONFIRMATION_REQUIRED",
	}
	if torchIdentityErr != nil {
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
		dep.ConfirmationRequired = false
		dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
		dep.Detail = torchIdentityErr.Error()
		return dep
	}

	if family == localEnvironmentFamilyCUDA &&
		!localEnvironmentHostSupportsCUDA(hostState) &&
		!localEnvironmentCUDAConsumerScopeRequiresRuntime(consumerScope) {
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
		dep.ConfirmationRequired = false
		dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
		return dep
	}
	if family == localEnvironmentFamilyNativeSDCPP && strings.TrimSpace(dependencyID) == "stable-diffusion.cpp.package" {
		if _, ok := nativeSDCPPPackageContractForEnvironment(environmentKey, dep.ConsumerScope); !ok {
			dep.State = localEnvironmentStateUnsupported
			dep.SourceKind = localEnvironmentSourceUnavailable
			dep.ConfirmationRequired = false
			dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED"
			return dep
		}
	}

	if record, ok := s.localEnvironmentSelectedSourceRecordForDependency(environmentKey, family, dependencyID, dep.ConsumerScope); ok {
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
		if family == localEnvironmentFamilyPythonPackageSet {
			plane := "cpu"
			if localEnvironmentHostSupportsCUDA(hostState) {
				plane = "cuda"
			}
			expectedProfile, err := engine.ResolvePythonDependencyProfileIdentity(dep.ConsumerScope, platformTuple, plane)
			storedLockHash := strings.TrimSpace(record.Hashes["exact_lock_sha256"])
			storedProfileDigest := strings.TrimSpace(record.Hashes["profile_digest"])
			if err != nil || storedLockHash != expectedProfile.ExactLockDigest || storedProfileDigest != expectedProfile.ProfileDigest || strings.TrimSpace(record.Version) != expectedProfile.ProfileDigest {
				dep.State = localEnvironmentStateRepairRequired
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
				dep.Detail = "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_DRIFT"
				return dep
			}
			if err := engine.VerifyPythonDependencyProfileStaticContent(record.CanonicalRoot, dep.ConsumerScope, expectedProfile); err != nil {
				dep.State = localEnvironmentStateRepairRequired
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
				dep.Detail = "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_DRIFT: " + err.Error()
				return dep
			}
		}
		if family == localEnvironmentFamilyPythonTorchWheel {
			expectedIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(dep.ConsumerScope)
			storedLockHash := strings.TrimSpace(record.Hashes["wheel_lock_hash"])
			if err != nil || storedLockHash != expectedIdentity.WheelLockHash {
				dep.State = localEnvironmentStateRepairRequired
				dep.ReasonCode = "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED"
				dep.Detail = "LOCAL_ENVIRONMENT_TORCH_WHEEL_LOCK_DRIFT"
				return dep
			}
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

func (s *Service) resolveExpandedLocalEnvironmentDependencies(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string) ([]localEnvironmentPlanDependency, bool) {
	if def.PackID != "local-speech" {
		return nil, false
	}
	if family != localEnvironmentFamilyPythonUV &&
		family != localEnvironmentFamilyPythonRuntime &&
		family != localEnvironmentFamilyPythonVenv &&
		family != localEnvironmentFamilyPythonPackageSet &&
		family != localEnvironmentFamilyPythonTorchWheel &&
		family != localEnvironmentFamilyCUDA {
		return nil, false
	}
	if family == localEnvironmentFamilyCUDA && !localEnvironmentHostSupportsCUDA(hostState) {
		return nil, false
	}
	consumers := localSpeechPlanConsumers(consumerScope)
	dependencies := make([]localEnvironmentPlanDependency, 0, len(consumers))
	for _, consumer := range consumers {
		dependencyID := defaultLocalEnvironmentDependencyID(def.PackID, family)
		dependencyConsumer := consumer
		plane := "cpu"
		if localEnvironmentHostSupportsCUDA(hostState) {
			plane = "cuda"
		}
		if family == localEnvironmentFamilyPythonVenv || family == localEnvironmentFamilyPythonPackageSet {
			identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, platformTuple, plane)
			if err != nil {
				dependencies = append(dependencies, localEnvironmentUnsupportedPythonProfileDependency(family, required, consumer, runtimeDataRoot, err))
				continue
			}
			dependencyID = identity.DependencyID
		} else if family == localEnvironmentFamilyPythonTorchWheel {
			dependencyConsumer = consumer + "." + plane
		} else if family == localEnvironmentFamilyCUDA {
			dependencyID = cudaUserSpaceRuntimeDependencyID
			dependencyConsumer = consumer + ".cuda"
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependencyWithID(def, family, dependencyID, required, hostState, platformTuple, runtimeDataRoot, dependencyConsumer))
	}
	return dependencies, true
}

func localEnvironmentUnsupportedPythonProfileDependency(family string, required bool, consumer string, runtimeDataRoot string, cause error) localEnvironmentPlanDependency {
	dependencyID := "python-profile.unavailable"
	return localEnvironmentPlanDependency{
		DependencyFamily:     strings.TrimSpace(family),
		DependencyID:         dependencyID,
		ConsumerScope:        strings.TrimSpace(consumer),
		Required:             required,
		State:                localEnvironmentStateUnsupported,
		SourceKind:           localEnvironmentSourceUnavailable,
		EnvironmentKey:       localEnvironmentPythonProfileKey(family, dependencyID, runtimeDataRoot),
		ReasonCode:           "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		Detail:               cause.Error(),
		ConfirmationRequired: false,
	}
}

func localSpeechPlanConsumers(consumerScope string) []string {
	switch strings.TrimSpace(consumerScope) {
	case "speech.qwen3-asr.python":
		return []string{"speech.qwen3-asr.python"}
	case "speech.qwen3-asr-transformers.python":
		return []string{"speech.qwen3-asr-transformers.python"}
	case "speech.qwen3-tts.python":
		return []string{"speech.qwen3-tts.python"}
	case "speech.voxcpm.python":
		return []string{"speech.voxcpm.python"}
	default:
		return []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"}
	}
}

func (s *Service) localEnvironmentFirstRunLlamaCUDARequired(def localComputePackDefinition, consumerScope string) bool {
	if def.PackID != "local-text" || !localEnvironmentFirstRunConsumerScope(consumerScope) {
		return false
	}
	// The managed llama package selector and the shared CUDA dependency
	// resolver are both Engine-owned and use the same current-host accelerator
	// detection. Consult that resolver when the detailed device-profile probe
	// could not execute nvidia-smi: otherwise first-run may install the CUDA
	// llama package while omitting its required shared dependency from the
	// confirmed materialization plan.
	status := s.resolveSharedCUDADependencyStatus("llama.cpp.cuda")
	return status.State != engine.SharedAcceleratorDependencyUnsupported
}

func localEnvironmentOptionalDependencyRequiredForConsumer(def localComputePackDefinition, family string, hostState localEnvironmentHostProfileState, consumerScope string, firstRunLlamaCUDARequired bool) bool {
	if family != localEnvironmentFamilyCUDA {
		return false
	}
	scope := strings.TrimSpace(consumerScope)
	if localEnvironmentCUDAConsumerScopeRequiresRuntime(scope) {
		return true
	}
	if def.PackID == "local-speech" && localEnvironmentHostSupportsCUDA(hostState) {
		return true
	}
	return def.PackID == "local-text" &&
		(localEnvironmentHostSupportsCUDA(hostState) || firstRunLlamaCUDARequired) &&
		localEnvironmentFirstRunConsumerScope(scope)
}

func localEnvironmentDependencyConsumerScope(def localComputePackDefinition, family string, hostState localEnvironmentHostProfileState, consumerScope string, firstRunLlamaCUDARequired bool) string {
	scope := strings.TrimSpace(consumerScope)
	if !localEnvironmentFirstRunConsumerScope(scope) {
		return scope
	}
	switch def.PackID {
	case "local-text":
		switch family {
		case localEnvironmentFamilyNativeLlama:
			return "llama.cpp.cpu"
		case localEnvironmentFamilyCUDA:
			if localEnvironmentHostSupportsCUDA(hostState) || firstRunLlamaCUDARequired {
				return "llama.cpp.cuda"
			}
		}
	}
	return scope
}

func localEnvironmentCUDAConsumerScopeRequiresRuntime(consumerScope string) bool {
	trimmed := strings.TrimSpace(consumerScope)
	switch trimmed {
	case "llama.cpp.cuda", stableDiffusionCUDAConsumerID, "media.diffusers.cuda", "media.video-python.cuda":
		return true
	default:
		return strings.HasPrefix(trimmed, "speech.") && strings.HasSuffix(trimmed, ".cuda")
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

func localEnvironmentPythonRuntimeDependencyID() string {
	return "python-" + engine.ManagedPythonVersion + "-" + engine.ManagedPythonABI
}

func localEnvironmentPythonTorchWheelDependencyID(identity engine.PythonTorchWheelDependencyIdentity) string {
	return strings.Join([]string{
		"torch-" + strings.TrimSpace(identity.TorchVersion),
		strings.TrimSpace(identity.AcceleratorPlane) + "-" + strings.TrimSpace(identity.CUDAABI),
		"torch-wheel",
	}, ".")
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
			RequiredDependencyFamilies: []string{localEnvironmentFamilyNativeLlama},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:                     "local-image-native",
			ProductLabel:               "Local image native",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyNativeSDCPP},
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
			},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
			CloudOnlyImpact:            "none",
		},
		{
			PackID:                     "local-speech",
			ProductLabel:               "Local speech",
			RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyPythonTorchWheel},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
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
	default:
		return strings.ReplaceAll(family, ".", "-")
	}
}
