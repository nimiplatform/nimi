// @nimi-authority: rule.nimi.runtime.local-compute.r100

package localservice

import (
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func (s *Service) ProjectSelectedLocalLoadout(capabilityContract string) (localexecution.LoadoutOption, bool, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if s == nil || capabilityContract == "" {
		return localexecution.LoadoutOption{}, false, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "capability contract is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.mu.RLock()
	selection := cloneLoadoutSelection(s.loadoutSelections[capabilityContract])
	loadout := cloneLoadout(s.loadouts[selection.GetLoadoutId()])
	s.mu.RUnlock()
	if selection == nil || strings.TrimSpace(selection.GetLoadoutId()) == "" {
		return localexecution.LoadoutOption{}, false, nil
	}
	if loadout == nil {
		return localexecution.LoadoutOption{
			LoadoutID: selection.GetLoadoutId(), CapabilityContract: capabilityContract,
			ValidationState: runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_BLOCKED,
			Reasons:         []runtimev1.ReasonCode{runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND},
		}, true, nil
	}
	loadout = s.deriveCurrentLoadout(loadout)
	implementation, _ := proto.Clone(loadout.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
	return localexecution.LoadoutOption{
		LoadoutID: loadout.GetLoadoutId(), DisplayName: loadout.GetDisplayName(),
		CapabilityContract:              loadout.GetCapabilityContract(),
		Implementation:                  implementation,
		ImplementationSupportedFeatures: append([]string(nil), loadout.GetImplementationSupportedFeatures()...),
		ConfiguredFeatures:              append([]string(nil), loadout.GetConfiguredFeatures()...),
		TextBehaviors:                   cloneTextBehaviorCapabilityProjections(loadout.GetTextBehaviors()),
		ValidationState:                 loadout.GetValidationState(), Reasons: append([]runtimev1.ReasonCode(nil), loadout.GetReasons()...),
	}, true, nil
}

// ResolveSelectedLocalExecution atomically captures the current machine
// selection and resolves every ModelAsset axis to immutable absolute paths and
// content identities. Callers retain this ResolvedAssembly and never reread
// AIConfig, Loadout, inventory, catalog, machine selection, or process state.
func (s *Service) ResolveSelectedLocalExecution(capabilityContract string) (*localexecution.SelectedLocalExecution, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if s == nil || capabilityContract == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "capability contract is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	s.mu.RLock()
	selection := cloneLoadoutSelection(s.loadoutSelections[capabilityContract])
	s.mu.RUnlock()
	if selection == nil || strings.TrimSpace(selection.GetLoadoutId()) == "" {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND, "no Loadout is selected for the capability contract", map[string]string{"capability_contract": capabilityContract})
	}
	return s.resolveLocalExecutionLocked(capabilityContract, selection.GetLoadoutId())
}

// ResolveLocalExecution resolves an exact Loadout identity already captured by
// a Runtime-private caller. AIConfig admission uses ResolveSelectedLocalExecution.
func (s *Service) ResolveLocalExecution(capabilityContract string, loadoutRef string) (*localexecution.SelectedLocalExecution, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	loadoutRef = strings.TrimSpace(loadoutRef)
	if s == nil || capabilityContract == "" || loadoutRef == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID, "capability contract and loadout_ref are required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()
	return s.resolveLocalExecutionLocked(capabilityContract, loadoutRef)
}

func (s *Service) resolveLocalExecutionLocked(capabilityContract string, loadoutRef string) (*localexecution.SelectedLocalExecution, error) {
	s.mu.RLock()
	loadout := cloneLoadout(s.loadouts[loadoutRef])
	s.mu.RUnlock()
	if loadout == nil {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "referenced Loadout was not found", map[string]string{"loadout_ref": loadoutRef})
	}
	if loadout.GetCapabilityContract() != capabilityContract {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH, "referenced Loadout capability is mismatched", map[string]string{"loadout_ref": loadoutRef})
	}
	driver, requirements, err := s.projectStoredLoadout(loadout)
	if err != nil {
		return nil, err
	}
	validation := s.validateLoadoutForJobAdmission(loadout, driver, requirements)
	if validation.state != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
		for _, reason := range validation.reasons {
			if reason == runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
				return nil, loadoutError(codes.FailedPrecondition, reason, "Local Job admission rejected byte drift or content identity drift against the captured binding", map[string]string{"loadout_id": loadout.GetLoadoutId()})
			}
		}
		return nil, loadoutValidationError(validation, loadout.GetLoadoutId())
	}

	resolvedBySlot := make(map[string]resolvedLoadoutAxis, len(validation.axes))
	for _, axis := range validation.axes {
		resolvedBySlot[axis.requirement.GetRequirementId()] = axis
	}
	exact := make([]localexecution.ExactBinding, 0, len(requirements))
	var contextWindow uint64
	var executionTarget *runtimeidentity.Target
	for _, requirement := range requirements {
		axis, ok := resolvedBySlot[requirement.GetRequirementId()]
		if !ok {
			if requirement.GetPresence() == runtimev1.LocalCapabilityRequirementPresence_LOCAL_CAPABILITY_REQUIREMENT_PRESENCE_OPTIONAL_CONDITIONAL {
				continue
			}
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED, "Loadout ResolvedAssembly is incomplete", nil)
		}
		exact = append(exact, localexecution.ExactBinding{
			RequirementID: requirement.GetRequirementId(), RequirementRole: requirement.GetRole(),
			OccurrenceOrdinal: requirement.GetOccurrenceOrdinal(), DisplayLabel: requirement.GetDisplayLabel(),
			ModelAssetID: axis.slot.GetModelAssetId(),
			AbsolutePath: axis.absolutePath, BundleDir: axis.bundleDir, DeclaredFiles: append([]string(nil), axis.declaredFiles...),
			VerifiedContentID: axis.slot.GetExpectedContentId(), EntrySHA256: axis.entrySHA256,
			TemplateIdentity: axis.templateIdentity,
		})
		if requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN && axis.contextWindow > 0 {
			contextWindow = axis.contextWindow
		}
		if requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN {
			executionTarget = &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{
				ReadinessRef: "model-asset://" + axis.slot.GetModelAssetId(),
			}}
		}
	}
	if executionTarget == nil || !executionTarget.Valid() {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED, "Loadout has no canonical main ModelAsset execution target", nil)
	}
	identity, _ := proto.Clone(loadout.GetImplementation()).(*runtimev1.CapabilityImplementationIdentity)
	custody := make([]*runtimev1.LoadoutRecipeCustodyReference, 0, len(loadout.GetRecipeCustody()))
	for _, item := range loadout.GetRecipeCustody() {
		if item != nil {
			custody = append(custody, proto.Clone(item).(*runtimev1.LoadoutRecipeCustodyReference))
		}
	}
	dependencySources, dependencyErr := s.resolveSelectedLocalExecutionDependencySources(capabilityContract, driver, identity)
	if dependencyErr != nil {
		return nil, dependencyErr
	}
	return &localexecution.SelectedLocalExecution{
		LoadoutID:          loadout.GetLoadoutId(),
		CapabilityContract: capabilityContract, DisplayName: loadout.GetDisplayName(),
		RecipeID: loadout.GetRecipeId(), RecipeRevision: loadout.GetRecipeRevision(), RecipeCustody: custody,
		DriverIdentity: identity, PortableConfig: cloneStruct(loadout.GetOptions()),
		ModelContextWindowTokens: contextWindow, Requirements: cloneLocalCapabilityRequirements(requirements),
		ExactBindings: exact, ExactDependencySources: dependencySources,
		ImplementationSupportedFeatures: append([]string(nil), loadout.GetImplementationSupportedFeatures()...),
		ConfiguredFeatures:              append([]string(nil), loadout.GetConfiguredFeatures()...),
		TextBehaviors:                   cloneTextBehaviorCapabilityProjections(loadout.GetTextBehaviors()),
		ExecutionTarget:                 executionTarget, Configured: true,
	}, nil
}

func cloneTextBehaviorCapabilityProjections(values []*runtimev1.TextBehaviorCapabilityProjection) []*runtimev1.TextBehaviorCapabilityProjection {
	result := make([]*runtimev1.TextBehaviorCapabilityProjection, 0, len(values))
	for _, value := range values {
		if value != nil {
			result = append(result, proto.Clone(value).(*runtimev1.TextBehaviorCapabilityProjection))
		}
	}
	return result
}

func (s *Service) resolveSelectedLocalExecutionDependencySources(capabilityContract string, driver capabilitydriver.Driver, identity *runtimev1.CapabilityImplementationIdentity) ([]localexecution.ExactDependencySource, error) {
	consumer := ""
	type requiredDependency struct {
		family, dependencyID, version string
	}
	var required []requiredDependency
	host := localEnvironmentHostProfileFromDeviceProfile(collectDeviceProfile())
	switch typed := driver.(type) {
	case capabilitydriver.LlamaTextDriver, capabilitydriver.LlamaEmbedDriver:
		_, resolvedConsumer, ok := localEnvironmentTargetForDriver(typed, host)
		if !ok {
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "llama Runtime package is unsupported on the exact host tuple", nil)
		}
		consumer = resolvedConsumer
		s.mu.RLock()
		version := strings.TrimSpace(s.llamaEngineVersion)
		s.mu.RUnlock()
		required = append(required, requiredDependency{family: localEnvironmentFamilyNativeLlama, dependencyID: "llama.cpp.package", version: version})
		if consumer == "llama.cpp.cuda" {
			required = append(required, requiredDependency{family: localEnvironmentFamilyCUDA, dependencyID: cudaUserSpaceRuntimeDependencyID})
		}
	case capabilitydriver.StableDiffusionImageDriver, capabilitydriver.StableDiffusionVideoDriver:
		_, resolvedConsumer, ok := localEnvironmentTargetForDriver(typed, host)
		if !ok {
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "stable-diffusion.cpp Runtime package is unsupported on the exact host tuple", nil)
		}
		consumer = resolvedConsumer
		required = append(required, requiredDependency{family: localEnvironmentFamilyNativeSDCPP, dependencyID: "stable-diffusion.cpp.package"})
		if consumer == stableDiffusionCUDAConsumerID {
			required = append(required, requiredDependency{family: localEnvironmentFamilyCUDA, dependencyID: cudaUserSpaceRuntimeDependencyID})
		}
	default:
		switch {
		case strings.TrimSpace(capabilityContract) == capabilitydriver.MiniMaxMusic3CapabilityContract && identity.GetDriverId() == capabilitydriver.MiniMaxMusic3DriverID:
			consumer = audioCppCUDAConsumerID
		case strings.TrimSpace(capabilityContract) == capabilitydriver.AudioSynthesizeContract && identity.GetDriverId() == capabilitydriver.Qwen3TTSAudioCppDriverID:
			consumer = audioCppQwen3TTSCUDAConsumerID
		default:
			var ok bool
			consumer, ok = capabilitydriver.AudioCppSpeechConsumerID(strings.TrimSpace(capabilityContract), capabilitydriver.IdentityFromProto(identity))
			if !ok {
				return nil, nil
			}
		}
		required = []requiredDependency{
			{family: localEnvironmentFamilyNativeAudioCPP, dependencyID: "audio.cpp.package"},
			{family: localEnvironmentFamilyCUDA, dependencyID: cuda13UserSpaceRuntimeDependencyID},
		}
		if consumer == audioCppInflectTTSConsumerID {
			required = append(required, requiredDependency{family: localEnvironmentFamilyESpeakNG, dependencyID: engine.ESpeakNGDependencyID})
		}
	}
	result := make([]localexecution.ExactDependencySource, 0, len(required))
	for _, item := range required {
		record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(item.family, consumer)
		if !ok || strings.TrimSpace(record.DependencyID) != item.dependencyID || item.version != "" && strings.TrimSpace(record.Version) != item.version {
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "Runtime dependency selected-source is not ready for the exact Loadout and host tuple", map[string]string{"dependency_family": item.family, "dependency_id": item.dependencyID, "detail": detail})
		}
		if item.family == localEnvironmentFamilyNativeAudioCPP {
			expectedVersion := "release-" + engine.AudioCppPackageVersion + "@" + engine.AudioCppPackageCommit
			mgr := s.engineManagerOrNil()
			recordRoot := filepath.Clean(strings.TrimSpace(record.CanonicalRoot))
			expectedBinaryPath := filepath.Join(recordRoot, engine.AudioCppCLIExecutableName)
			artifactMatches := false
			for _, artifact := range normalizeStringSlice(record.VerifiedArtifacts) {
				candidate := localEnvironmentSelectedSourceArtifactLocalPath(recordRoot, true, artifact)
				if candidate != "" && productControlPathsEqual(filepath.Clean(candidate), expectedBinaryPath) {
					artifactMatches = true
					break
				}
			}
			if mgr == nil || !filepath.IsAbs(recordRoot) || strings.TrimSpace(record.Version) != expectedVersion || !artifactMatches {
				return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "Runtime native audio dependency requires fresh owner verification", map[string]string{"dependency_family": item.family, "dependency_id": item.dependencyID, "detail": "native audio package owner or exact version is unavailable"})
			}
			if err := mgr.VerifyEngineBinaryDependency("audio-cpp", engine.AudioCppPackageVersion, expectedBinaryPath); err != nil {
				return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "Runtime native audio dependency failed fresh owner verification", map[string]string{"dependency_family": item.family, "dependency_id": item.dependencyID, "detail": err.Error()})
			}
		}
		hashes := make(map[string]string, len(record.Hashes))
		for key, value := range record.Hashes {
			hashes[key] = value
		}
		result = append(result, localexecution.ExactDependencySource{DependencyFamily: record.DependencyFamily, DependencyID: record.DependencyID, ConsumerScope: consumer, SelectedSourceRecordID: record.RecordID, CanonicalRoot: record.CanonicalRoot, Version: record.Version, VerifiedArtifacts: append([]string(nil), record.VerifiedArtifacts...), Hashes: hashes})
	}
	return result, nil
}
