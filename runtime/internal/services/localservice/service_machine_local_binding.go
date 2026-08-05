package localservice

import (
	"context"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

type localCapabilityBindingMutation uint8

const (
	localCapabilityBindingMutationBind localCapabilityBindingMutation = iota + 1
	localCapabilityBindingMutationRebind
	localCapabilityBindingMutationUnbind
)

func (s *Service) BindLocalCapabilityRequirement(
	_ context.Context,
	request *runtimev1.BindLocalCapabilityRequirementRequest,
) (*runtimev1.BindLocalCapabilityRequirementResponse, error) {
	configuration, err := s.mutateLocalCapabilityBinding(
		localCapabilityBindingMutationBind,
		request.GetConfigurationId(),
		request.GetRequirementId(),
		nil,
		request.GetTarget(),
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.BindLocalCapabilityRequirementResponse{Configuration: configuration}, nil
}

func (s *Service) RebindLocalCapabilityRequirement(
	_ context.Context,
	request *runtimev1.RebindLocalCapabilityRequirementRequest,
) (*runtimev1.RebindLocalCapabilityRequirementResponse, error) {
	configuration, err := s.mutateLocalCapabilityBinding(
		localCapabilityBindingMutationRebind,
		request.GetConfigurationId(),
		request.GetRequirementId(),
		request.GetExpectedCurrentBinding(),
		request.GetTarget(),
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.RebindLocalCapabilityRequirementResponse{Configuration: configuration}, nil
}

func (s *Service) UnbindLocalCapabilityRequirement(
	_ context.Context,
	request *runtimev1.UnbindLocalCapabilityRequirementRequest,
) (*runtimev1.UnbindLocalCapabilityRequirementResponse, error) {
	configuration, err := s.mutateLocalCapabilityBinding(
		localCapabilityBindingMutationUnbind,
		request.GetConfigurationId(),
		request.GetRequirementId(),
		request.GetExpectedCurrentBinding(),
		nil,
	)
	if err != nil {
		return nil, err
	}
	return &runtimev1.UnbindLocalCapabilityRequirementResponse{Configuration: configuration}, nil
}

func (s *Service) mutateLocalCapabilityBinding(
	mutation localCapabilityBindingMutation,
	configurationID string,
	requirementID string,
	expectedCurrent *runtimev1.LocalAssetExactBinding,
	target *runtimev1.LocalAssetExactBindingTarget,
) (*runtimev1.LocalCapabilityConfiguration, error) {
	configurationID = strings.TrimSpace(configurationID)
	requirementID = strings.TrimSpace(requirementID)
	if configurationID == "" {
		return nil, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_FOUND, "local capability configuration was not found", nil)
	}
	if requirementID == "" {
		return nil, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_REQUIREMENT_NOT_FOUND, "local capability requirement was not found", map[string]string{"configuration_id": configurationID})
	}

	s.machineLocalConfigurationMutationMu.Lock()
	defer s.machineLocalConfigurationMutationMu.Unlock()

	s.mu.RLock()
	current := cloneStoredLocalCapabilityConfiguration(s.machineLocalConfigurations[configurationID])
	inventory := s.snapshotLocalCapabilityAssetInventoryLocked()
	s.mu.RUnlock()
	if current == nil || current.Configuration == nil {
		return nil, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_FOUND, "local capability configuration was not found", map[string]string{"configuration_id": configurationID})
	}
	requirement := findProjectedLocalCapabilityRequirement(current.Configuration.GetProjectedRequirements(), requirementID)
	if requirement == nil {
		return nil, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_REQUIREMENT_NOT_FOUND, "local capability requirement was not found", map[string]string{"configuration_id": configurationID, "requirement_id": requirementID})
	}
	currentBinding := findLocalCapabilityExactBinding(current.Configuration.GetExactBindings(), requirementID)
	switch mutation {
	case localCapabilityBindingMutationBind:
		if currentBinding != nil {
			return nil, localCapabilityBindingConflict(configurationID, requirementID)
		}
	case localCapabilityBindingMutationRebind, localCapabilityBindingMutationUnbind:
		if currentBinding == nil || !equalLocalCapabilityExactBinding(currentBinding, expectedCurrent) {
			return nil, localCapabilityBindingConflict(configurationID, requirementID)
		}
	default:
		return nil, localCapabilityBindingConflict(configurationID, requirementID)
	}

	next := cloneStoredLocalCapabilityConfiguration(current)
	if mutation == localCapabilityBindingMutationUnbind {
		next.Configuration.ExactBindings = removeLocalCapabilityExactBinding(next.Configuration.GetExactBindings(), requirementID)
	} else {
		driver, reason := s.capabilityDrivers.Resolve(
			current.Configuration.GetCapabilityContract(),
			capabilitydriver.IdentityFromProto(current.Configuration.GetImplementation()),
		)
		if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
			return nil, localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, "local capability driver is unavailable", map[string]string{"configuration_id": configurationID})
		}
		binding, descriptor, err := s.verifyManualLocalCapabilityBindingTarget(inventory, requirementID, target)
		if err != nil {
			return nil, err
		}
		if reason := driver.ValidateBinding(
			cloneLocalCapabilityRequirement(requirement),
			cloneLocalAssetExactBinding(binding),
			cloneCapabilityDriverAssetDescriptor(descriptor),
		); reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
			return nil, localCapabilityDriverBindingError(reason, configurationID, requirementID, binding.GetLocalAssetId())
		}
		next.Configuration.ExactBindings = replaceLocalCapabilityExactBinding(next.Configuration.GetExactBindings(), binding)
	}
	// Resolution diagnostics describe the previous projection attempt. A
	// successful explicit mutation supersedes them; current summary state is
	// derived from the committed requirement and binding facts.
	next.ResolutionReasons = nil
	if err := validateStoredLocalCapabilityConfiguration(next); err != nil {
		return nil, localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT, "local capability binding mutation is invalid", map[string]string{"configuration_id": configurationID, "requirement_id": requirementID})
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if mutation != localCapabilityBindingMutationUnbind && !inventory.exactAssetStillMatchesLocked(s, target.GetLocalAssetId()) {
		return nil, localCapabilityBindingError(codes.Aborted, runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT, "local asset changed during exact binding", map[string]string{"configuration_id": configurationID, "requirement_id": requirementID, "local_asset_id": strings.TrimSpace(target.GetLocalAssetId())})
	}
	rows := s.machineLocalConfigurationRowsLocked(next)
	if err := s.machineLocalConfigurationStore.Save(rows, s.machineLocalSelectionsLocked()); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_PERSISTENCE_UNAVAILABLE, err, grpcerr.ReasonOptions{
			Message:  "Machine Local AI Configuration could not be persisted",
			Metadata: map[string]string{"configuration_id": configurationID},
		})
	}
	s.machineLocalConfigurations[configurationID] = cloneStoredLocalCapabilityConfiguration(next)
	return s.deriveLocalCapabilityConfiguration(next), nil
}

func (s *Service) verifyManualLocalCapabilityBindingTarget(
	inventory localCapabilityAssetInventorySnapshot,
	requirementID string,
	target *runtimev1.LocalAssetExactBindingTarget,
) (*runtimev1.LocalAssetExactBinding, capabilitydriver.AssetDescriptor, error) {
	localAssetID := strings.TrimSpace(target.GetLocalAssetId())
	expectedContentID := strings.TrimSpace(target.GetExpectedVerifiedContentId())
	if localAssetID == "" {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND, "local asset was not found", map[string]string{"requirement_id": requirementID})
	}
	if expectedContentID == "" || normalizeVerifiedContentID(expectedContentID) != expectedContentID {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH, "expected verified content identity is not canonical", map[string]string{"requirement_id": requirementID, "local_asset_id": localAssetID})
	}
	asset := inventory.exactAsset(localAssetID)
	if asset == nil || asset.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND, "local asset was not found", map[string]string{"requirement_id": requirementID, "local_asset_id": localAssetID})
	}
	declaredContentSHA256 := exactDeclaredContentSHA256(asset)
	if declaredContentSHA256 == "" {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_UNVERIFIED, "local asset content is not verified", map[string]string{"requirement_id": requirementID, "local_asset_id": localAssetID})
	}
	if declaredContentID := normalizeVerifiedContentID("sha256:" + declaredContentSHA256); declaredContentID != expectedContentID {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH, "local asset content does not match the expected identity", map[string]string{"requirement_id": requirementID, "local_asset_id": localAssetID})
	}
	descriptor, reason, candidate := s.verifyLocalCapabilityAssetContent(asset, inventory.modelsRoot, expectedContentID)
	if !candidate {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityBindingError(codes.NotFound, runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND, "local asset was not found", map[string]string{"requirement_id": requirementID, "local_asset_id": localAssetID})
	}
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, capabilitydriver.AssetDescriptor{}, localCapabilityDriverBindingError(reason, "", requirementID, localAssetID)
	}
	return &runtimev1.LocalAssetExactBinding{
		RequirementId:     requirementID,
		LocalAssetId:      descriptor.LocalAssetID,
		VerifiedContentId: descriptor.VerifiedContentID,
		EntrySha256:       descriptor.EntrySHA256,
	}, descriptor, nil
}

func findProjectedLocalCapabilityRequirement(requirements []*runtimev1.LocalCapabilityRequirement, requirementID string) *runtimev1.LocalCapabilityRequirement {
	for _, requirement := range requirements {
		if requirement != nil && requirement.GetRequirementId() == requirementID {
			return requirement
		}
	}
	return nil
}

func findLocalCapabilityExactBinding(bindings []*runtimev1.LocalAssetExactBinding, requirementID string) *runtimev1.LocalAssetExactBinding {
	for _, binding := range bindings {
		if binding != nil && binding.GetRequirementId() == requirementID {
			return binding
		}
	}
	return nil
}

func equalLocalCapabilityExactBinding(left, right *runtimev1.LocalAssetExactBinding) bool {
	if left == nil || right == nil {
		return false
	}
	return left.GetRequirementId() == right.GetRequirementId() &&
		left.GetLocalAssetId() == right.GetLocalAssetId() &&
		left.GetVerifiedContentId() == right.GetVerifiedContentId() &&
		left.GetEntrySha256() == right.GetEntrySha256()
}

func replaceLocalCapabilityExactBinding(bindings []*runtimev1.LocalAssetExactBinding, replacement *runtimev1.LocalAssetExactBinding) []*runtimev1.LocalAssetExactBinding {
	result := removeLocalCapabilityExactBinding(bindings, replacement.GetRequirementId())
	result = append(result, proto.Clone(replacement).(*runtimev1.LocalAssetExactBinding))
	sort.Slice(result, func(i, j int) bool { return result[i].GetRequirementId() < result[j].GetRequirementId() })
	return result
}

func removeLocalCapabilityExactBinding(bindings []*runtimev1.LocalAssetExactBinding, requirementID string) []*runtimev1.LocalAssetExactBinding {
	result := make([]*runtimev1.LocalAssetExactBinding, 0, len(bindings))
	for _, binding := range bindings {
		if binding != nil && binding.GetRequirementId() != requirementID {
			result = append(result, cloneLocalAssetExactBinding(binding))
		}
	}
	return result
}

func localCapabilityBindingConflict(configurationID, requirementID string) error {
	return localCapabilityBindingError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_BINDING_CONFLICT, "local capability binding precondition did not match", map[string]string{"configuration_id": configurationID, "requirement_id": requirementID})
}

func localCapabilityDriverBindingError(reason runtimev1.LocalCapabilityReason, configurationID, requirementID, localAssetID string) error {
	code := runtimev1.ReasonCode_AI_LOCAL_ASSET_INCOMPATIBLE
	statusCode := codes.FailedPrecondition
	switch reason {
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_NOT_FOUND,
		runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_DRIVER_DIALECT_UNSUPPORTED,
		runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_IMPLEMENTATION_UNSUPPORTED:
		code = runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_NOT_FOUND:
		code = runtimev1.ReasonCode_AI_LOCAL_ASSET_NOT_FOUND
		statusCode = codes.NotFound
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_UNVERIFIED:
		code = runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_UNVERIFIED
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_CONTENT_MISMATCH:
		code = runtimev1.ReasonCode_AI_LOCAL_ASSET_CONTENT_MISMATCH
	case runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_LOCAL_ASSET_INCOMPATIBLE:
		code = runtimev1.ReasonCode_AI_LOCAL_ASSET_INCOMPATIBLE
	}
	metadata := map[string]string{
		"configuration_id": configurationID,
		"requirement_id":   requirementID,
		"local_asset_id":   localAssetID,
		"local_reason":     reason.String(),
	}
	return localCapabilityBindingError(statusCode, code, "local asset does not satisfy the capability requirement", metadata)
}

func localCapabilityBindingError(code codes.Code, reason runtimev1.ReasonCode, message string, metadata map[string]string) error {
	return grpcerr.WithReasonCodeOptions(code, reason, grpcerr.ReasonOptions{Message: message, Metadata: metadata})
}
