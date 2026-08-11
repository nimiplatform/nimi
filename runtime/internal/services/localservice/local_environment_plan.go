package localservice

import (
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	localEnvironmentInstallLevelMinimal     = "minimal"
	localEnvironmentInstallLevelRecommended = "recommended"
)

func normalizeLocalEnvironmentInstallLevel(installLevel string) string {
	switch strings.ToLower(strings.TrimSpace(installLevel)) {
	case localEnvironmentInstallLevelMinimal:
		return localEnvironmentInstallLevelMinimal
	case localEnvironmentInstallLevelRecommended:
		return localEnvironmentInstallLevelRecommended
	default:
		return ""
	}
}

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
		runtimeDataRoot = s.localEnvironmentRuntimeDataRoot()
	}
	consumerScope := strings.TrimSpace(req.ConsumerScope)
	if consumerScope == "" {
		consumerScope = def.PackID
		if resolved := s.localImageNativeExplicitAssetConsumerScope(def, req, profile); resolved != "" {
			consumerScope = resolved
		}
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
	for family, deps := range s.resolveCachedProfileModelAssetDependencies(def, hostState, platformTuple, runtimeDataRoot, consumerScope, req) {
		if modelResolution == nil {
			modelResolution = make(map[string][]localEnvironmentPlanDependency, 1)
		}
		modelResolution[family] = deps
	}
	firstRunLlamaCUDARequired := s.localEnvironmentFirstRunLlamaCUDARequired(def, consumerScope)

	dependencies := make([]localEnvironmentPlanDependency, 0, len(def.RequiredDependencyFamilies)+len(def.OptionalDependencyFamilies))
	for _, family := range def.RequiredDependencyFamilies {
		if resolved, ok := modelResolution[family]; ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencyConsumerScope := localEnvironmentDependencyConsumerScope(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, true, hostState, platformTuple, runtimeDataRoot, consumerScope, req); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, true, hostState, platformTuple, runtimeDataRoot, dependencyConsumerScope, req))
	}
	for _, family := range def.OptionalDependencyFamilies {
		required := localEnvironmentOptionalDependencyRequiredForConsumer(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		dependencyConsumerScope := localEnvironmentDependencyConsumerScope(def, family, hostState, consumerScope, firstRunLlamaCUDARequired)
		if resolved, ok := modelResolution[family]; ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		if resolved, ok := s.resolveExpandedLocalEnvironmentDependencies(def, family, required, hostState, platformTuple, runtimeDataRoot, consumerScope, req); ok {
			dependencies = append(dependencies, resolved...)
			continue
		}
		dependencies = append(dependencies, s.resolveLocalEnvironmentDependency(def, family, required, hostState, platformTuple, runtimeDataRoot, dependencyConsumerScope, req))
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
	case localEnvironmentFamilyModelAsset, localEnvironmentFamilyModelCompanion:
		return "models"
	default:
		return ""
	}
}

func (s *Service) localImageNativeExplicitAssetConsumerScope(
	def localComputePackDefinition,
	req localEnvironmentPlanRequest,
	profile *runtimev1.LocalDeviceProfile,
) string {
	if def.PackID != "local-image-native" || strings.TrimSpace(req.InstallLevel) != "" {
		return ""
	}
	if strings.TrimSpace(req.LocalAssetID) == "" && strings.TrimSpace(req.AssetID) == "" {
		return ""
	}
	model := s.resolveManagedMediaImageModel(strings.TrimSpace(req.LocalAssetID))
	if model == nil {
		model = s.resolveManagedMediaImageModel(strings.TrimSpace(req.AssetID))
	}
	if model == nil {
		return ""
	}
	selection := canonicalSupervisedImageSelectionForLocalAsset(model, profile)
	if !selection.Matched || selection.Conflict || selection.Entry == nil || selection.ProductState != engine.ImageProductStateSupported {
		return ""
	}
	consumerID, ok := managedImageConsumerIDForMatrixEntry(selection.Entry)
	if !ok {
		return ""
	}
	return consumerID
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

func (s *Service) resolveLocalEnvironmentDependency(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string, req localEnvironmentPlanRequest) localEnvironmentPlanDependency {
	dependencyID := s.localEnvironmentDependencyID(def.PackID, family, req)
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

func (s *Service) resolveCachedProfileModelAssetDependencies(
	def localComputePackDefinition,
	hostState localEnvironmentHostProfileState,
	platformTuple string,
	runtimeDataRoot string,
	consumerScope string,
	req localEnvironmentPlanRequest,
) map[string][]localEnvironmentPlanDependency {
	if def.PackID != "local-image-native" {
		return nil
	}
	if strings.TrimSpace(req.InstallLevel) != "" || strings.TrimSpace(req.CompanionAssetID) != "" {
		return nil
	}
	if strings.TrimSpace(req.LocalAssetID) == "" && strings.TrimSpace(req.AssetID) == "" {
		return nil
	}
	cacheLocalAssetID := strings.TrimSpace(req.LocalAssetID)
	if cacheLocalAssetID == "" {
		if model := s.resolveManagedMediaImageModel(strings.TrimSpace(req.AssetID)); model != nil {
			cacheLocalAssetID = strings.TrimSpace(model.GetLocalAssetId())
		}
	}
	cached, ok := s.cachedManagedMediaImageProfile(cacheLocalAssetID)
	if !ok || !cached.MaterializationResolved {
		return map[string][]localEnvironmentPlanDependency{
			localEnvironmentFamilyModelCompanion: {
				localEnvironmentImageProfileBindingsRequiredDependency(def, hostState, platformTuple, runtimeDataRoot, consumerScope, req),
			},
		}
	}
	companionDeps := make([]localEnvironmentPlanDependency, 0)
	for _, binding := range cached.MaterializationBindings {
		if strings.TrimSpace(binding.CompanionAssetID) == "" {
			continue
		}
		companionReq := req
		companionReq.AssetID = ""
		companionReq.LocalAssetID = ""
		companionReq.CompanionAssetID = strings.TrimSpace(binding.CompanionAssetID)
		companionReq.ParentAssetID = strings.TrimSpace(binding.ParentAssetID)
		if companionReq.ParentAssetID == "" {
			companionReq.ParentAssetID = strings.TrimSpace(req.AssetID)
		}
		companionDeps = append(companionDeps, s.resolveLocalEnvironmentDependency(
			def,
			localEnvironmentFamilyModelCompanion,
			planModelFamilyRequired(def, localEnvironmentFamilyModelCompanion),
			hostState,
			platformTuple,
			runtimeDataRoot,
			consumerScope,
			companionReq,
		))
	}
	return map[string][]localEnvironmentPlanDependency{
		localEnvironmentFamilyModelCompanion: companionDeps,
	}
}

func localEnvironmentImageProfileBindingsRequiredDependency(
	def localComputePackDefinition,
	hostState localEnvironmentHostProfileState,
	platformTuple string,
	runtimeDataRoot string,
	consumerScope string,
	req localEnvironmentPlanRequest,
) localEnvironmentPlanDependency {
	identity := strings.TrimSpace(req.LocalAssetID)
	if identity == "" {
		identity = strings.TrimSpace(req.AssetID)
	}
	if identity == "" {
		identity = "unknown"
	}
	dependencyID := "image-profile-bindings:" + identity
	return localEnvironmentPlanDependency{
		DependencyFamily:     localEnvironmentFamilyModelCompanion,
		DependencyID:         dependencyID,
		ConsumerScope:        strings.TrimSpace(consumerScope),
		Required:             planModelFamilyRequired(def, localEnvironmentFamilyModelCompanion),
		State:                localEnvironmentStateUnsupported,
		SourceKind:           localEnvironmentSourceUnavailable,
		ConfirmationRequired: false,
		EnvironmentKey:       localEnvironmentKey(localEnvironmentFamilyModelCompanion, dependencyID, hostState.HostProfileID, platformTuple, runtimeDataRoot),
		ReasonCode:           "LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED",
		Detail:               "image profile materialization bindings are required before resolving companion assets; call Runtime descriptor prepare to materialize this image profile",
	}
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

	if (family == localEnvironmentFamilyModelAsset || family == localEnvironmentFamilyModelCompanion) && strings.TrimSpace(dependencyID) == "" {
		dep.State = localEnvironmentStateUnsupported
		dep.SourceKind = localEnvironmentSourceUnavailable
		dep.ConfirmationRequired = false
		dep.ReasonCode = "LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED"
		dep.Detail = "model asset dependencies require explicit asset identity"
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

func (s *Service) resolveExpandedLocalEnvironmentDependencies(def localComputePackDefinition, family string, required bool, hostState localEnvironmentHostProfileState, platformTuple string, runtimeDataRoot string, consumerScope string, _ localEnvironmentPlanRequest) ([]localEnvironmentPlanDependency, bool) {
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
		if model := s.localAssetRecordForIdentity(trimmed); model != nil {
			if semanticAssetID := strings.TrimSpace(model.GetAssetId()); semanticAssetID != "" {
				return semanticAssetID
			}
		}
		return trimmed
	}
	if trimmed := strings.TrimSpace(localAssetID); trimmed != "" {
		if model := s.localAssetRecordForIdentity(trimmed); model != nil {
			if semanticAssetID := strings.TrimSpace(model.GetAssetId()); semanticAssetID != "" {
				return semanticAssetID
			}
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
	return localEnvironmentCompanionAssetDependencyID(companion, parent)
}

func localEnvironmentCompanionAssetDependencyID(companionAssetID string, parentAssetID string) string {
	companion := strings.TrimSpace(companionAssetID)
	parent := strings.TrimSpace(parentAssetID)
	if companion == "" || parent == "" {
		return ""
	}
	return "asset_id=" + companion + "|parent_asset_id=" + parent
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
			RequiredDependencyFamilies: []string{localEnvironmentFamilyNativeSDCPP, localEnvironmentFamilyModelAsset, localEnvironmentFamilyModelCompanion},
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
			RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyPythonTorchWheel, localEnvironmentFamilyModelAsset},
			OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA},
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
