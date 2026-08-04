package localservice

import (
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

// SelectedLocalCapabilityContracts returns the stable machine-selection keys
// available to Runtime-private execution composition.
func (s *Service) SelectedLocalCapabilityContracts() []string {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	contracts := make([]string, 0, len(s.machineLocalSelections))
	for capabilityContract := range s.machineLocalSelections {
		if capabilityContract = strings.TrimSpace(capabilityContract); capabilityContract != "" {
			contracts = append(contracts, capabilityContract)
		}
	}
	s.mu.RUnlock()
	sort.Strings(contracts)
	return contracts
}

// ResolveSelectedLocalExecution composes one selected configuration with its
// currently verified exact LocalAsset occurrences. It never returns a partial
// projection: no selection, an incomplete binding set, current byte drift, or
// Driver rejection is a typed failure.
func (s *Service) ResolveSelectedLocalExecution(capabilityContract string) (*localexecution.SelectedLocalExecution, error) {
	capabilityContract = strings.TrimSpace(capabilityContract)
	if s == nil || capabilityContract == "" {
		return nil, machineLocalSelectionError(
			codes.InvalidArgument,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_INVALID,
			"capability contract is required for local execution resolution",
			nil,
		)
	}

	// Selection/configuration mutations are serialized for the complete
	// projection. LocalAsset records use an independent snapshot plus a final
	// exact-record fence because asset ownership has its own mutation paths.
	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.RLock()
	selection := cloneLocalCapabilitySelection(s.machineLocalSelections[capabilityContract])
	var stored *storedLocalCapabilityConfiguration
	if selection != nil {
		stored = cloneStoredLocalCapabilityConfiguration(s.machineLocalConfigurations[selection.GetConfigurationId()])
	}
	inventory := s.snapshotLocalCapabilityAssetInventoryLocked()
	s.mu.RUnlock()

	if selection == nil {
		return nil, machineLocalSelectionError(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND,
			"no local capability configuration is selected",
			map[string]string{"capability_contract": capabilityContract},
		)
	}
	configurationID := selection.GetConfigurationId()
	metadata := map[string]string{
		"capability_contract": capabilityContract,
		"configuration_id":    configurationID,
	}
	if stored == nil || stored.Configuration == nil {
		return nil, machineLocalSelectionError(
			codes.NotFound,
			runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_FOUND,
			"selected local capability configuration was not found",
			metadata,
		)
	}
	configuration := s.deriveLocalCapabilityConfiguration(stored)
	if configuration.GetCapabilityContract() != capabilityContract {
		return nil, machineLocalSelectionError(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH,
			"selected local capability configuration does not match the requested capability",
			metadata,
		)
	}

	driver, driverReason := s.capabilityDrivers.Resolve(
		capabilityContract,
		capabilitydriver.IdentityFromProto(configuration.GetImplementation()),
	)
	if driverReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		if driverReason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			driverReason = runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED
		}
		return nil, selectedLocalExecutionReasonError(driverReason, metadata)
	}
	if configuration.GetInterpretability() != runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_INTERPRETABLE ||
		configuration.GetRequirementResolution() != runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED ||
		!localCapabilityRequirementsCompletelyBound(configuration.GetProjectedRequirements(), configuration.GetExactBindings()) {
		return nil, selectedLocalExecutionReasonError(localCapabilityConfigurationFailureReason(configuration), metadata)
	}

	bindings := cloneLocalAssetExactBindings(configuration.GetExactBindings())
	descriptors := make([]capabilitydriver.AssetDescriptor, 0, len(bindings))
	resolvedBindings := make([]localexecution.ExactBinding, 0, len(bindings))
	boundAssetIDs := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		asset := inventory.exactAsset(binding.GetLocalAssetId())
		if asset == nil {
			return nil, selectedLocalExecutionReasonError(runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND, metadata)
		}
		descriptor, reason, candidate := s.verifyLocalCapabilityAssetContent(asset, inventory.modelsRoot, binding.GetVerifiedContentId())
		if !candidate {
			return nil, selectedLocalExecutionReasonError(runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND, metadata)
		}
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return nil, selectedLocalExecutionReasonError(reason, metadata)
		}
		if descriptor.LocalAssetID != binding.GetLocalAssetId() ||
			descriptor.VerifiedContentID != binding.GetVerifiedContentId() ||
			descriptor.EntrySHA256 != binding.GetEntrySha256() {
			return nil, selectedLocalExecutionReasonError(runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH, metadata)
		}
		entryPath, err := resolveManagedModelEntryAbsolutePath(inventory.modelsRoot, asset)
		if err != nil {
			return nil, selectedLocalExecutionReasonError(localCapabilityAssetVerificationReason(err), metadata)
		}
		absolutePath, err := resolveLocalCapabilityAssetPathWithinRoot(inventory.modelsRoot, entryPath)
		if err != nil || !filepath.IsAbs(absolutePath) {
			return nil, selectedLocalExecutionReasonError(runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED, metadata)
		}
		descriptors = append(descriptors, cloneCapabilityDriverAssetDescriptor(descriptor))
		resolvedBindings = append(resolvedBindings, localexecution.ExactBinding{
			RequirementID:     binding.GetRequirementId(),
			LocalAssetID:      binding.GetLocalAssetId(),
			AbsolutePath:      absolutePath,
			VerifiedContentID: binding.GetVerifiedContentId(),
			EntrySHA256:       binding.GetEntrySha256(),
		})
		boundAssetIDs = append(boundAssetIDs, binding.GetLocalAssetId())
	}

	if reason := driver.ValidateCombination(
		cloneLocalCapabilityRequirements(configuration.GetProjectedRequirements()),
		cloneLocalAssetExactBindings(bindings),
		cloneCapabilityDriverAssetDescriptors(descriptors),
	); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, selectedLocalExecutionReasonError(reason, metadata)
	}

	s.mu.RLock()
	inventoryStable := true
	for _, localAssetID := range boundAssetIDs {
		if !inventory.exactAssetStillMatchesLocked(s, localAssetID) {
			inventoryStable = false
			break
		}
	}
	s.mu.RUnlock()
	if !inventoryStable {
		return nil, machineLocalSelectionError(
			codes.Aborted,
			runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT,
			"local asset changed during selected execution resolution",
			metadata,
		)
	}

	return &localexecution.SelectedLocalExecution{
		ConfigurationID:    configurationID,
		CapabilityContract: capabilityContract,
		DisplayName:        strings.TrimSpace(configuration.GetDisplayName()),
		DriverIdentity:     cloneImplementationIdentity(configuration.GetImplementation()),
		PortableConfig:     cloneStruct(configuration.GetPortableConfig()),
		Requirements:       cloneLocalCapabilityRequirements(configuration.GetProjectedRequirements()),
		ExactBindings:      resolvedBindings,
		SupportedFeatures:  append([]string(nil), configuration.GetSupportedFeatures()...),
		Configured:         true,
	}, nil
}

func localCapabilityConfigurationFailureReason(configuration *runtimev1.LocalCapabilityConfiguration) runtimev1.LocalCapabilityReason {
	if configuration != nil {
		for _, reason := range configuration.GetReasons() {
			if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED &&
				reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING {
				return reason
			}
		}
	}
	return runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING
}

func selectedLocalExecutionReasonError(reason runtimev1.LocalCapabilityReason, metadata map[string]string) error {
	metadata = cloneStringMap(metadata)
	metadata["local_reason"] = reason.String()
	code := codes.FailedPrecondition
	reasonCode := runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED
	message := "selected local capability configuration is not configured"
	switch reason {
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND,
		runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED,
		runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED:
		reasonCode = runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE
		message = "selected local capability driver is unavailable"
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND:
		code = codes.NotFound
		reasonCode = runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND
		message = "selected local capability asset was not found"
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED:
		reasonCode = runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_UNVERIFIED
		message = "selected local capability asset content is not verified"
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH:
		reasonCode = runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH
		message = "selected local capability asset content does not match its exact binding"
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE:
		reasonCode = runtimev1.ReasonCode_AI_LOCAL_ASSET_INCOMPATIBLE
		message = "selected local capability asset is incompatible"
	}
	return machineLocalSelectionError(code, reasonCode, message, metadata)
}

func cloneCapabilityDriverAssetDescriptors(inputs []capabilitydriver.AssetDescriptor) []capabilitydriver.AssetDescriptor {
	result := make([]capabilitydriver.AssetDescriptor, 0, len(inputs))
	for _, input := range inputs {
		result = append(result, cloneCapabilityDriverAssetDescriptor(input))
	}
	return result
}
