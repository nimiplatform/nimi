package localservice

import (
	"context"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func (s *Service) restoreMachineLocalConfigurations() error {
	rows, selections, err := s.machineLocalConfigurationStore.Load()
	if err != nil {
		return err
	}
	restored := make(map[string]*storedLocalCapabilityConfiguration, len(rows))
	for index, row := range rows {
		if err := validateStoredLocalCapabilityConfiguration(row); err != nil {
			return fmt.Errorf("configuration row %d: %w", index, err)
		}
		configurationID := row.Configuration.GetConfigurationId()
		if _, exists := restored[configurationID]; exists {
			return fmt.Errorf("duplicate configuration id %q", configurationID)
		}
		restored[configurationID] = cloneStoredLocalCapabilityConfiguration(row)
	}
	restoredSelections := make(map[string]*runtimev1.LocalCapabilitySelection, len(selections))
	for index, selection := range selections {
		if err := validateStoredLocalCapabilitySelection(selection, restored); err != nil {
			return fmt.Errorf("selection row %d: %w", index, err)
		}
		capabilityContract := selection.GetCapabilityContract()
		if _, exists := restoredSelections[capabilityContract]; exists {
			return fmt.Errorf("duplicate selection for capability %q", capabilityContract)
		}
		restoredSelections[capabilityContract] = cloneLocalCapabilitySelection(selection)
	}
	s.machineLocalConfigurations = restored
	s.machineLocalSelections = restoredSelections
	return nil
}

func (s *Service) GetMachineLocalAIConfiguration(_ context.Context, _ *runtimev1.GetMachineLocalAIConfigurationRequest) (*runtimev1.GetMachineLocalAIConfigurationResponse, error) {
	s.mu.RLock()
	rows := make([]*runtimev1.LocalCapabilityConfiguration, 0, len(s.machineLocalConfigurations))
	for _, stored := range s.machineLocalConfigurations {
		rows = append(rows, s.deriveLocalCapabilityConfiguration(stored))
	}
	selections := s.machineLocalSelectionsLocked()
	s.mu.RUnlock()
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].GetConfigurationId() < rows[j].GetConfigurationId()
	})
	return &runtimev1.GetMachineLocalAIConfigurationResponse{
		Aggregate: &runtimev1.MachineLocalAIConfiguration{Configurations: rows, Selections: selections},
	}, nil
}

func (s *Service) GetLocalCapabilityConfiguration(_ context.Context, request *runtimev1.GetLocalCapabilityConfigurationRequest) (*runtimev1.GetLocalCapabilityConfigurationResponse, error) {
	configurationID := strings.TrimSpace(request.GetConfigurationId())
	if configurationID == "" {
		return nil, status.Error(codes.InvalidArgument, "configuration_id is required")
	}
	s.mu.RLock()
	configuration := s.deriveLocalCapabilityConfiguration(s.machineLocalConfigurations[configurationID])
	s.mu.RUnlock()
	if configuration == nil {
		return nil, status.Error(codes.NotFound, "local capability configuration not found")
	}
	return &runtimev1.GetLocalCapabilityConfigurationResponse{Configuration: configuration}, nil
}

func (s *Service) AddLocalCapabilityConfiguration(_ context.Context, request *runtimev1.AddLocalCapabilityConfigurationRequest) (*runtimev1.AddLocalCapabilityConfigurationResponse, error) {
	if err := validateAddLocalCapabilityConfigurationRequest(request); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	configuration := &runtimev1.LocalCapabilityConfiguration{
		ConfigurationId:    "lcc_" + ulid.Make().String(),
		CapabilityContract: strings.TrimSpace(request.GetCapabilityContract()),
		Implementation:     cloneImplementationIdentity(request.GetImplementation()),
		PortableConfig:     cloneStruct(request.GetPortableConfig()),
		SupportedFeatures:  normalizeStableStringSet(request.GetSupportedFeatures()),
		DisplayName:        strings.TrimSpace(request.GetDisplayName()),
		Provenance:         cloneStruct(request.GetProvenance()),
	}

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	inventory := s.snapshotLocalCapabilityAssetInventory()
	projected, preferredContentIDs := s.projectLocalCapabilityConfiguration(configuration, inventory)
	if err := validateStoredLocalCapabilityConfiguration(projected); err != nil {
		return nil, status.Error(codes.Internal, "local capability projection produced invalid canonical state")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !inventory.stillMatchesLocked(s, preferredContentIDs) {
		return nil, status.Error(codes.Aborted, "LocalAsset inventory changed during exact binding; retry")
	}
	next := s.machineLocalConfigurationRowsLocked(projected)
	if err := s.machineLocalConfigurationStore.Save(next, s.machineLocalSelectionsLocked()); err != nil {
		return nil, status.Error(codes.Internal, "persist Machine Local AI Configuration failed")
	}
	s.machineLocalConfigurations[configuration.GetConfigurationId()] = cloneStoredLocalCapabilityConfiguration(projected)
	return &runtimev1.AddLocalCapabilityConfigurationResponse{
		Configuration: s.deriveLocalCapabilityConfiguration(projected),
	}, nil
}

func (s *Service) UpdateLocalCapabilityConfiguration(_ context.Context, request *runtimev1.UpdateLocalCapabilityConfigurationRequest) (*runtimev1.UpdateLocalCapabilityConfigurationResponse, error) {
	if err := validateUpdateLocalCapabilityConfigurationRequest(request); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	configurationID := strings.TrimSpace(request.GetConfigurationId())

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.RLock()
	current := cloneStoredLocalCapabilityConfiguration(s.machineLocalConfigurations[configurationID])
	inventory := s.snapshotLocalCapabilityAssetInventoryLocked()
	s.mu.RUnlock()
	if current == nil || current.Configuration == nil {
		return nil, status.Error(codes.NotFound, "local capability configuration not found")
	}

	intent := &runtimev1.LocalCapabilityConfiguration{
		ConfigurationId:    configurationID,
		CapabilityContract: current.Configuration.GetCapabilityContract(),
		Implementation:     cloneImplementationIdentity(current.Configuration.GetImplementation()),
		PortableConfig:     cloneStruct(request.GetPortableConfig()),
		SupportedFeatures:  normalizeStableStringSet(request.GetSupportedFeatures()),
		DisplayName:        strings.TrimSpace(request.GetDisplayName()),
		Provenance:         cloneStruct(request.GetProvenance()),
	}
	projected, observedContentIDs := s.projectLocalCapabilityConfiguration(intent, inventory)
	if proto.Equal(
		&runtimev1.LocalCapabilityConfiguration{ProjectedRequirements: current.Configuration.GetProjectedRequirements()},
		&runtimev1.LocalCapabilityConfiguration{ProjectedRequirements: projected.Configuration.GetProjectedRequirements()},
	) {
		projected.Configuration.ExactBindings = cloneLocalAssetExactBindings(current.Configuration.GetExactBindings())
		projected.ResolutionReasons = append([]runtimev1.LocalCapabilityReason(nil), current.ResolutionReasons...)
		for _, binding := range projected.Configuration.GetExactBindings() {
			if contentID := normalizeVerifiedContentID(binding.GetVerifiedContentId()); contentID != "" {
				observedContentIDs[contentID] = struct{}{}
			}
		}
	}
	if err := validateStoredLocalCapabilityConfiguration(projected); err != nil {
		return nil, status.Error(codes.Internal, "local capability update produced invalid canonical state")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !inventory.stillMatchesLocked(s, observedContentIDs) {
		return nil, status.Error(codes.Aborted, "LocalAsset inventory changed during exact binding; retry")
	}
	next := s.machineLocalConfigurationRowsLocked(projected)
	if err := s.machineLocalConfigurationStore.Save(next, s.machineLocalSelectionsLocked()); err != nil {
		return nil, status.Error(codes.Internal, "persist Machine Local AI Configuration failed")
	}
	s.machineLocalConfigurations[configurationID] = cloneStoredLocalCapabilityConfiguration(projected)
	return &runtimev1.UpdateLocalCapabilityConfigurationResponse{
		Configuration: s.deriveLocalCapabilityConfiguration(projected),
	}, nil
}

func (s *Service) ReprojectLocalCapabilityRequirements(_ context.Context, request *runtimev1.ReprojectLocalCapabilityRequirementsRequest) (*runtimev1.ReprojectLocalCapabilityRequirementsResponse, error) {
	configurationID := strings.TrimSpace(request.GetConfigurationId())
	if configurationID == "" {
		return nil, status.Error(codes.InvalidArgument, "configuration_id is required")
	}
	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()
	s.mu.RLock()
	current := cloneStoredLocalCapabilityConfiguration(s.machineLocalConfigurations[configurationID])
	inventory := s.snapshotLocalCapabilityAssetInventoryLocked()
	s.mu.RUnlock()
	if current == nil || current.Configuration == nil {
		return nil, status.Error(codes.NotFound, "local capability configuration not found")
	}
	// Reprojection starts only from portable intent. Old requirements and
	// bindings never participate in the new result.
	intent := &runtimev1.LocalCapabilityConfiguration{
		ConfigurationId:    current.Configuration.GetConfigurationId(),
		CapabilityContract: current.Configuration.GetCapabilityContract(),
		Implementation:     cloneImplementationIdentity(current.Configuration.GetImplementation()),
		PortableConfig:     cloneStruct(current.Configuration.GetPortableConfig()),
		SupportedFeatures:  append([]string(nil), current.Configuration.GetSupportedFeatures()...),
		DisplayName:        current.Configuration.GetDisplayName(),
		Provenance:         cloneStruct(current.Configuration.GetProvenance()),
	}
	projected, preferredContentIDs := s.projectLocalCapabilityConfiguration(intent, inventory)
	if err := validateStoredLocalCapabilityConfiguration(projected); err != nil {
		return nil, status.Error(codes.Internal, "local capability reprojection produced invalid canonical state")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !inventory.stillMatchesLocked(s, preferredContentIDs) {
		return nil, status.Error(codes.Aborted, "LocalAsset inventory changed during exact binding; retry")
	}
	next := s.machineLocalConfigurationRowsLocked(projected)
	if err := s.machineLocalConfigurationStore.Save(next, s.machineLocalSelectionsLocked()); err != nil {
		return nil, status.Error(codes.Internal, "persist Machine Local AI Configuration failed")
	}
	s.machineLocalConfigurations[configurationID] = cloneStoredLocalCapabilityConfiguration(projected)
	return &runtimev1.ReprojectLocalCapabilityRequirementsResponse{
		Configuration: s.deriveLocalCapabilityConfiguration(projected),
	}, nil
}

func (s *Service) projectLocalCapabilityConfiguration(configuration *runtimev1.LocalCapabilityConfiguration, inventory localCapabilityAssetInventorySnapshot) (*storedLocalCapabilityConfiguration, map[string]struct{}) {
	canonical := cloneCanonicalStoredConfiguration(configuration)
	stored := &storedLocalCapabilityConfiguration{Configuration: canonical}
	preferredContentIDs := make(map[string]struct{})
	driver, reason := s.capabilityDrivers.Resolve(
		canonical.GetCapabilityContract(),
		capabilitydriver.IdentityFromProto(canonical.GetImplementation()),
	)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		stored.ProjectionReason = reason
		return stored, preferredContentIDs
	}
	requirements, reason := driver.Interpret(capabilitydriver.InterpretInput{
		PortableConfig:    cloneStruct(canonical.GetPortableConfig()),
		SupportedFeatures: append([]string(nil), canonical.GetSupportedFeatures()...),
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		stored.ProjectionReason = reason
		return stored, preferredContentIDs
	}
	canonical.ProjectedRequirements = cloneLocalCapabilityRequirements(requirements)
	for _, requirement := range canonical.GetProjectedRequirements() {
		if preferred := normalizeVerifiedContentID(requirement.GetPreferredVerifiedContentId()); preferred != "" {
			preferredContentIDs[preferred] = struct{}{}
		}
	}
	bindings, resolutionReasons := s.autoBindLocalCapabilityRequirements(driver, canonical.GetProjectedRequirements(), inventory)
	canonical.ExactBindings = cloneLocalAssetExactBindings(bindings)
	stored.ResolutionReasons = resolutionReasons
	return stored, preferredContentIDs
}

func (s *Service) autoBindLocalCapabilityRequirements(driver capabilitydriver.Driver, requirements []*runtimev1.LocalCapabilityRequirement, inventory localCapabilityAssetInventorySnapshot) ([]*runtimev1.LocalAssetExactBinding, []runtimev1.LocalCapabilityReason) {
	bindings := make([]*runtimev1.LocalAssetExactBinding, 0, len(requirements))
	reasons := make([]runtimev1.LocalCapabilityReason, 0)
	for _, requirement := range requirements {
		preferredContentID := normalizeVerifiedContentID(requirement.GetPreferredVerifiedContentId())
		if preferredContentID == "" {
			continue
		}
		matches := make([]localCapabilityAssetMatch, 0, 1)
		rejectedReasons := make([]runtimev1.LocalCapabilityReason, 0, 1)
		for _, asset := range inventory.assets {
			descriptor, verificationReason, candidate := s.verifyLocalCapabilityAssetContent(asset, inventory.modelsRoot, preferredContentID)
			if !candidate {
				continue
			}
			if verificationReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				rejectedReasons = appendUniqueLocalCapabilityReason(rejectedReasons, verificationReason)
				continue
			}
			binding := &runtimev1.LocalAssetExactBinding{
				RequirementId:     requirement.GetRequirementId(),
				LocalAssetId:      descriptor.LocalAssetID,
				VerifiedContentId: descriptor.VerifiedContentID,
				EntrySha256:       descriptor.EntrySHA256,
			}
			// Driver code never receives pointers or slices owned by the canonical
			// configuration. It may only classify compatibility, not mutate Core state.
			if reason := driver.ValidateBinding(
				cloneLocalCapabilityRequirement(requirement),
				cloneLocalAssetExactBinding(binding),
				cloneCapabilityDriverAssetDescriptor(descriptor),
			); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
				rejectedReasons = appendUniqueLocalCapabilityReason(rejectedReasons, reason)
				continue
			}
			matches = append(matches, localCapabilityAssetMatch{asset: cloneLocalAsset(asset), descriptor: descriptor, binding: binding})
		}
		match, ok := selectEquivalentLocalCapabilityAssetMatch(matches)
		if !ok {
			for _, reason := range rejectedReasons {
				reasons = appendUniqueLocalCapabilityReason(reasons, reason)
			}
			continue
		}
		bindings = append(bindings, match.binding)
	}
	sort.Slice(reasons, func(i, j int) bool { return reasons[i] < reasons[j] })
	return bindings, reasons
}

type localCapabilityAssetMatch struct {
	asset      *runtimev1.LocalAssetRecord
	descriptor capabilitydriver.AssetDescriptor
	binding    *runtimev1.LocalAssetExactBinding
}

// selectEquivalentLocalCapabilityAssetMatch collapses duplicate installed
// records only when their verified bytes are identical. Different content is
// never ranked or guessed.
func selectEquivalentLocalCapabilityAssetMatch(matches []localCapabilityAssetMatch) (localCapabilityAssetMatch, bool) {
	if len(matches) == 0 {
		return localCapabilityAssetMatch{}, false
	}
	selected := matches[0]
	for _, candidate := range matches[1:] {
		if candidate.descriptor.VerifiedContentID != selected.descriptor.VerifiedContentID || candidate.descriptor.EntrySHA256 != selected.descriptor.EntrySHA256 {
			return localCapabilityAssetMatch{}, false
		}
		if strings.TrimSpace(candidate.asset.GetLocalAssetId()) < strings.TrimSpace(selected.asset.GetLocalAssetId()) {
			selected = candidate
		}
	}
	return selected, true
}

func normalizeVerifiedContentID(value string) string {
	normalized := normalizeExactSHA256Hex(value)
	if normalized == "" {
		return ""
	}
	return "sha256:" + normalized
}

func normalizeExactSHA256Hex(value string) string {
	normalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "sha256:")
	if len(normalized) != 64 {
		return ""
	}
	if _, err := hex.DecodeString(normalized); err != nil {
		return ""
	}
	return normalized
}

func normalizeStableStringSet(values []string) []string {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			set[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for value := range set {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func (s *Service) deriveLocalCapabilityConfiguration(stored *storedLocalCapabilityConfiguration) *runtimev1.LocalCapabilityConfiguration {
	if stored == nil || stored.Configuration == nil {
		return nil
	}
	configuration := cloneCanonicalStoredConfiguration(stored.Configuration)
	reasons := make([]runtimev1.LocalCapabilityReason, 0, 2+len(stored.ResolutionReasons))
	if stored.ProjectionReason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		configuration.Interpretability = runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNAVAILABLE
		configuration.RequirementResolution = runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED
		reasons = appendUniqueLocalCapabilityReason(reasons, stored.ProjectionReason)
	} else {
		configuration.Interpretability = runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_INTERPRETABLE
		for _, reason := range stored.ResolutionReasons {
			reasons = appendUniqueLocalCapabilityReason(reasons, reason)
		}
		completelyBound := localCapabilityRequirementsCompletelyBound(configuration.GetProjectedRequirements(), configuration.GetExactBindings())
		if completelyBound {
			configuration.RequirementResolution = runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_CONFIGURED
		} else {
			configuration.RequirementResolution = runtimev1.LocalCapabilityRequirementResolution_LOCAL_CAPABILITY_REQUIREMENT_RESOLUTION_UNRESOLVED
			if !completelyBound {
				reasons = appendUniqueLocalCapabilityReason(reasons, runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_REQUIRED_BINDING_MISSING)
			}
		}
	}
	// Interpretability is derived against the exact registry available now. A
	// Driver disappearing never mutates or clears the persisted projection or
	// exact bindings, but it must be visible immediately as unavailable.
	if _, reason := s.capabilityDrivers.Resolve(
		configuration.GetCapabilityContract(),
		capabilitydriver.IdentityFromProto(configuration.GetImplementation()),
	); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		configuration.Interpretability = runtimev1.LocalCapabilityInterpretability_LOCAL_CAPABILITY_INTERPRETABILITY_UNAVAILABLE
		reasons = appendUniqueLocalCapabilityReason(reasons, reason)
	}
	configuration.Reasons = reasons
	return configuration
}

func localCapabilityRequirementsCompletelyBound(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.LocalAssetExactBinding) bool {
	if len(requirements) == 0 || len(bindings) != len(requirements) {
		return false
	}
	requirementIDs := make(map[string]struct{}, len(requirements))
	for _, requirement := range requirements {
		id := strings.TrimSpace(requirement.GetRequirementId())
		if id == "" {
			return false
		}
		requirementIDs[id] = struct{}{}
	}
	bound := make(map[string]struct{}, len(bindings))
	for _, binding := range bindings {
		id := strings.TrimSpace(binding.GetRequirementId())
		if _, exists := requirementIDs[id]; !exists {
			return false
		}
		if _, exists := bound[id]; exists || strings.TrimSpace(binding.GetLocalAssetId()) == "" || normalizeVerifiedContentID(binding.GetVerifiedContentId()) == "" || normalizeExactSHA256Hex(binding.GetEntrySha256()) == "" {
			return false
		}
		bound[id] = struct{}{}
	}
	return len(bound) == len(requirementIDs)
}

func validateAddLocalCapabilityConfigurationRequest(request *runtimev1.AddLocalCapabilityConfigurationRequest) error {
	if request == nil || strings.TrimSpace(request.GetCapabilityContract()) == "" {
		return fmt.Errorf("capability_contract is required")
	}
	identity := request.GetImplementation()
	if identity == nil || strings.TrimSpace(identity.GetImplementationId()) == "" || strings.TrimSpace(identity.GetDriverId()) == "" || strings.TrimSpace(identity.GetDriverDialect()) == "" {
		return fmt.Errorf("complete implementation identity is required")
	}
	return nil
}

func validateUpdateLocalCapabilityConfigurationRequest(request *runtimev1.UpdateLocalCapabilityConfigurationRequest) error {
	if request == nil {
		return fmt.Errorf("request is required")
	}
	if value := strings.TrimSpace(request.GetConfigurationId()); value == "" || value != request.GetConfigurationId() {
		return fmt.Errorf("configuration_id is required and canonical")
	}
	if value := strings.TrimSpace(request.GetDisplayName()); value == "" || value != request.GetDisplayName() {
		return fmt.Errorf("display_name is required and canonical")
	}
	return nil
}

func validateStoredLocalCapabilityConfiguration(stored *storedLocalCapabilityConfiguration) error {
	if stored == nil || stored.Configuration == nil {
		return fmt.Errorf("configuration is required")
	}
	configuration := stored.Configuration
	if strings.TrimSpace(configuration.GetConfigurationId()) == "" || strings.TrimSpace(configuration.GetCapabilityContract()) == "" {
		return fmt.Errorf("configuration identity is required")
	}
	identity := configuration.GetImplementation()
	if identity == nil || strings.TrimSpace(identity.GetImplementationId()) == "" || strings.TrimSpace(identity.GetDriverId()) == "" || strings.TrimSpace(identity.GetDriverDialect()) == "" {
		return fmt.Errorf("complete implementation identity is required")
	}
	requirementIDs := make(map[string]struct{}, len(configuration.GetProjectedRequirements()))
	orderedOccurrenceNext := make(map[string]uint32)
	for _, requirement := range configuration.GetProjectedRequirements() {
		if requirement == nil {
			return fmt.Errorf("projected requirement is required")
		}
		id := strings.TrimSpace(requirement.GetRequirementId())
		if id == "" || id != requirement.GetRequirementId() {
			return fmt.Errorf("projected requirement id is required and canonical")
		}
		if _, exists := requirementIDs[id]; exists {
			return fmt.Errorf("duplicate projected requirement id %q", id)
		}
		if label := requirement.GetDisplayLabel(); strings.TrimSpace(label) == "" || strings.TrimSpace(label) != label {
			return fmt.Errorf("projected requirement %q has a non-canonical display label", id)
		}
		ordinal := requirement.GetOccurrenceOrdinal()
		if requirement.GetRole() == runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_MAIN && ordinal != 0 {
			return fmt.Errorf("projected main requirement %q cannot declare an ordered ordinal", id)
		}
		if ordinal > 0 {
			if requirement.GetRole() != runtimev1.LocalCapabilityRequirementRole_LOCAL_CAPABILITY_REQUIREMENT_ROLE_COMPANION {
				return fmt.Errorf("projected ordered requirement %q must be a companion", id)
			}
			scope := requirement.GetRole().String() + "\x00" + requirement.GetResourceKind()
			expected := orderedOccurrenceNext[scope] + 1
			if ordinal != expected {
				return fmt.Errorf("projected ordered requirement %q has ordinal %d, want %d", id, ordinal, expected)
			}
			orderedOccurrenceNext[scope] = ordinal
		}
		if preferred := requirement.GetPreferredVerifiedContentId(); preferred != "" && normalizeVerifiedContentID(preferred) != preferred {
			return fmt.Errorf("projected requirement %q has non-canonical verified content identity", id)
		}
		requirementIDs[id] = struct{}{}
	}
	bindingIDs := make(map[string]struct{}, len(configuration.GetExactBindings()))
	for _, binding := range configuration.GetExactBindings() {
		id := strings.TrimSpace(binding.GetRequirementId())
		if _, exists := requirementIDs[id]; !exists {
			return fmt.Errorf("binding references unknown requirement %q", id)
		}
		if _, exists := bindingIDs[id]; exists {
			return fmt.Errorf("duplicate binding for requirement %q", id)
		}
		if strings.TrimSpace(binding.GetLocalAssetId()) == "" ||
			normalizeVerifiedContentID(binding.GetVerifiedContentId()) != binding.GetVerifiedContentId() ||
			normalizeExactSHA256Hex(binding.GetEntrySha256()) != binding.GetEntrySha256() {
			return fmt.Errorf("binding %q is not exact", id)
		}
		bindingIDs[id] = struct{}{}
	}
	return nil
}

func (s *Service) machineLocalConfigurationRowsLocked(replacement *storedLocalCapabilityConfiguration) []*storedLocalCapabilityConfiguration {
	rows := make([]*storedLocalCapabilityConfiguration, 0, len(s.machineLocalConfigurations)+1)
	replacementID := replacement.Configuration.GetConfigurationId()
	for id, current := range s.machineLocalConfigurations {
		if id == replacementID {
			continue
		}
		rows = append(rows, cloneStoredLocalCapabilityConfiguration(current))
	}
	rows = append(rows, cloneStoredLocalCapabilityConfiguration(replacement))
	return rows
}

func (s *Service) machineLocalSelectionsLocked() []*runtimev1.LocalCapabilitySelection {
	selections := make([]*runtimev1.LocalCapabilitySelection, 0, len(s.machineLocalSelections))
	for _, selection := range s.machineLocalSelections {
		if cloned := cloneLocalCapabilitySelection(selection); cloned != nil {
			selections = append(selections, cloned)
		}
	}
	sort.Slice(selections, func(i, j int) bool {
		return selections[i].GetCapabilityContract() < selections[j].GetCapabilityContract()
	})
	return selections
}

func validateStoredLocalCapabilitySelection(selection *runtimev1.LocalCapabilitySelection, configurations map[string]*storedLocalCapabilityConfiguration) error {
	if selection == nil || strings.TrimSpace(selection.GetCapabilityContract()) == "" || strings.TrimSpace(selection.GetConfigurationId()) == "" {
		return fmt.Errorf("complete local capability selection identity is required")
	}
	if selection.GetCapabilityContract() != strings.TrimSpace(selection.GetCapabilityContract()) || selection.GetConfigurationId() != strings.TrimSpace(selection.GetConfigurationId()) {
		return fmt.Errorf("local capability selection identity must be canonical")
	}
	if configurations[selection.GetConfigurationId()] == nil {
		return fmt.Errorf("selection references unknown configuration %q", selection.GetConfigurationId())
	}
	return nil
}

func cloneLocalCapabilitySelection(input *runtimev1.LocalCapabilitySelection) *runtimev1.LocalCapabilitySelection {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilitySelection)
	canonicalizeStoredLocalCapabilitySelection(cloned)
	return cloned
}

func appendUniqueLocalCapabilityReason(reasons []runtimev1.LocalCapabilityReason, reason runtimev1.LocalCapabilityReason) []runtimev1.LocalCapabilityReason {
	if reason == runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return reasons
	}
	for _, existing := range reasons {
		if existing == reason {
			return reasons
		}
	}
	return append(reasons, reason)
}

func cloneImplementationIdentity(input *runtimev1.CapabilityImplementationIdentity) *runtimev1.CapabilityImplementationIdentity {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.CapabilityImplementationIdentity)
	return cloned
}

func cloneLocalCapabilityRequirements(inputs []*runtimev1.LocalCapabilityRequirement) []*runtimev1.LocalCapabilityRequirement {
	result := make([]*runtimev1.LocalCapabilityRequirement, 0, len(inputs))
	for _, input := range inputs {
		if input == nil {
			continue
		}
		cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilityRequirement)
		result = append(result, cloned)
	}
	return result
}

func cloneLocalCapabilityRequirement(input *runtimev1.LocalCapabilityRequirement) *runtimev1.LocalCapabilityRequirement {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalCapabilityRequirement)
	return cloned
}

func cloneLocalAssetExactBindings(inputs []*runtimev1.LocalAssetExactBinding) []*runtimev1.LocalAssetExactBinding {
	result := make([]*runtimev1.LocalAssetExactBinding, 0, len(inputs))
	for _, input := range inputs {
		if input == nil {
			continue
		}
		cloned, _ := proto.Clone(input).(*runtimev1.LocalAssetExactBinding)
		result = append(result, cloned)
	}
	return result
}

func cloneLocalAssetExactBinding(input *runtimev1.LocalAssetExactBinding) *runtimev1.LocalAssetExactBinding {
	if input == nil {
		return nil
	}
	cloned, _ := proto.Clone(input).(*runtimev1.LocalAssetExactBinding)
	return cloned
}

func cloneCapabilityDriverAssetDescriptor(input capabilitydriver.AssetDescriptor) capabilitydriver.AssetDescriptor {
	input.ArtifactRoles = append([]string(nil), input.ArtifactRoles...)
	input.BundleEntries = append([]capabilitydriver.BundleEntryDescriptor(nil), input.BundleEntries...)
	input.FormatProbe = append([]byte(nil), input.FormatProbe...)
	return input
}
