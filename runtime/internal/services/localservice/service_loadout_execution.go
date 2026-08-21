// @nimi-authority: rule.nimi.runtime.local-compute.r100

package localservice

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func (s *Service) SelectedLocalCapabilityContracts() []string {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	contracts := make([]string, 0, len(s.loadoutSelections))
	for contract := range s.loadoutSelections {
		if contract = strings.TrimSpace(contract); contract != "" {
			contracts = append(contracts, contract)
		}
	}
	s.mu.RUnlock()
	sort.Strings(contracts)
	return contracts
}

// ResolveSelectedLocalExecution atomically captures the exact selected
// Loadout and resolves every ModelAsset axis to immutable absolute paths and
// content identities. Callers retain this ResolvedAssembly and never reread
// Loadout, inventory, catalog, selection, or process state for the Job.
func (s *Service) ResolveSelectedLocalExecution(capabilityContract string) (*localexecution.SelectedLocalExecution, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if s == nil || capabilityContract == "" {
		return nil, loadoutError(codes.InvalidArgument, runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID, "capability contract is required", nil)
	}
	s.loadoutMutationMu.Lock()
	defer s.loadoutMutationMu.Unlock()
	s.modelAssetMutationMu.Lock()
	defer s.modelAssetMutationMu.Unlock()

	s.mu.RLock()
	selection := cloneLoadoutSelection(s.loadoutSelections[capabilityContract])
	var loadout *runtimev1.Loadout
	if selection != nil {
		loadout = cloneLoadout(s.loadouts[selection.GetLoadoutId()])
	}
	s.mu.RUnlock()
	if selection == nil {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND, "no Loadout is selected for the capability", map[string]string{"capability_contract": capabilityContract})
	}
	if loadout == nil {
		return nil, loadoutError(codes.NotFound, runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND, "selected Loadout was not found", map[string]string{"loadout_id": selection.GetLoadoutId()})
	}
	if loadout.GetCapabilityContract() != capabilityContract {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH, "selected Loadout capability is mismatched", map[string]string{"loadout_id": loadout.GetLoadoutId()})
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
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOADOUT_NOT_CONFIGURED, "Loadout ResolvedAssembly is incomplete", nil)
		}
		exact = append(exact, localexecution.ExactBinding{
			RequirementID: requirement.GetRequirementId(), RequirementRole: requirement.GetRole(),
			OccurrenceOrdinal: requirement.GetOccurrenceOrdinal(), DisplayLabel: requirement.GetDisplayLabel(),
			ModelAssetID: axis.slot.GetModelAssetId(),
			AbsolutePath: axis.absolutePath, BundleDir: axis.bundleDir, DeclaredFiles: append([]string(nil), axis.declaredFiles...),
			VerifiedContentID: axis.slot.GetExpectedContentId(), EntrySHA256: axis.entrySHA256,
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
	dependencySources, dependencyErr := s.resolveSelectedLocalExecutionDependencySources(capabilityContract, identity)
	if dependencyErr != nil {
		return nil, dependencyErr
	}
	return &localexecution.SelectedLocalExecution{
		LoadoutID:          loadout.GetLoadoutId(),
		CapabilityContract: capabilityContract, DisplayName: loadout.GetDisplayName(),
		RecipeID: loadout.GetRecipeId(), RecipeRevision: loadout.GetRecipeRevision(), RecipeCustody: custody,
		DriverIdentity: identity, PortableConfig: cloneStruct(loadout.GetOptions()),
		ModelContextWindowTokens: contextWindow, Requirements: cloneLocalCapabilityRequirements(requirements),
		ExactBindings: exact, ExactDependencySources: dependencySources, SupportedFeatures: append([]string(nil), loadout.GetSupportedFeatures()...),
		ExecutionTarget: executionTarget, Configured: true,
	}, nil
}

func (s *Service) resolveSelectedLocalExecutionDependencySources(capabilityContract string, identity *runtimev1.CapabilityImplementationIdentity) ([]localexecution.ExactDependencySource, error) {
	consumer := ""
	switch {
	case strings.TrimSpace(capabilityContract) == capabilitydriver.MiniMaxMusic3CapabilityContract && identity.GetDriverId() == capabilitydriver.MiniMaxMusic3DriverID:
		consumer = audioCppCUDAConsumerID
	case strings.TrimSpace(capabilityContract) == capabilitydriver.AudioSynthesizeContract && identity.GetDriverId() == capabilitydriver.Qwen3TTSAudioCppDriverID:
		consumer = audioCppQwen3TTSCUDAConsumerID
	default:
		return nil, nil
	}
	required := []struct{ family, dependencyID string }{
		{localEnvironmentFamilyNativeAudioCPP, "audio.cpp.package"},
		{localEnvironmentFamilyCUDA, cuda13UserSpaceRuntimeDependencyID},
	}
	result := make([]localexecution.ExactDependencySource, 0, len(required))
	for _, item := range required {
		record, ok, detail := s.readySelectedSourceForFamilyAndConsumer(item.family, consumer)
		if !ok || strings.TrimSpace(record.DependencyID) != item.dependencyID {
			return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "audio.cpp Runtime dependency selected-source is not ready", map[string]string{"dependency_family": item.family, "dependency_id": item.dependencyID, "detail": detail})
		}
		hashes := make(map[string]string, len(record.Hashes))
		for key, value := range record.Hashes {
			hashes[key] = value
		}
		result = append(result, localexecution.ExactDependencySource{DependencyFamily: record.DependencyFamily, DependencyID: record.DependencyID, ConsumerScope: consumer, SelectedSourceRecordID: record.RecordID, CanonicalRoot: record.CanonicalRoot, Version: record.Version, VerifiedArtifacts: append([]string(nil), record.VerifiedArtifacts...), Hashes: hashes})
	}
	return result, nil
}
