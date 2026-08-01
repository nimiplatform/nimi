package localservice

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// managedMediaWorkflowMaterializationBindingsKey is Runtime-private profile
// state. Descriptor-backed workflows use this ordered representation directly
// during execution; they must not be projected back through the legacy
// LocalProfileEntryDescriptor slot map.
const managedMediaWorkflowMaterializationBindingsKey = "runtime_materialization_bindings"

type managedImageMaterializationExecution struct {
	ModelPath      string
	SlotOptions    []string
	ComponentSpecs []map[string]any
}

func (s *Service) managedImageMaterializationStateForBinding(
	model *runtimev1.LocalAssetRecord,
	profileBindingID string,
) (managedImageProfileState, bool) {
	if s == nil || model == nil {
		return managedImageProfileState{}, false
	}
	profile, ok := s.cachedManagedMediaImageProfileBinding(profileBindingID)
	if !ok ||
		strings.TrimSpace(profile.BindingID) != strings.TrimSpace(profileBindingID) ||
		strings.TrimSpace(profile.MainLocalAssetID) != strings.TrimSpace(model.GetLocalAssetId()) ||
		!profile.MaterializationResolved ||
		!strings.HasPrefix(strings.TrimSpace(profile.Alias), profileRuntimeMaterializationKeyPrefix) ||
		len(profile.MaterializationBindings) == 0 {
		return managedImageProfileState{}, false
	}
	return profile, true
}

func (s *Service) managedImageMaterializationStateForAsset(
	model *runtimev1.LocalAssetRecord,
) (managedImageProfileState, bool) {
	if s == nil || model == nil {
		return managedImageProfileState{}, false
	}
	profile, ok := s.cachedManagedMediaImageProfile(model.GetLocalAssetId())
	if !ok ||
		!profile.MaterializationResolved ||
		!strings.HasPrefix(strings.TrimSpace(profile.Alias), profileRuntimeMaterializationKeyPrefix) ||
		len(profile.MaterializationBindings) == 0 {
		return managedImageProfileState{}, false
	}
	return profile, true
}

// resolveManagedImageMaterialization consumes the ordered private bindings
// retained beside the committed AIConfig. It intentionally does not create
// LocalProfileEntryDescriptor values: those descriptors are an unordered,
// engineSlot-keyed legacy input and cannot represent repeated occurrences or
// occurrence-level weight/options.
func (s *Service) resolveManagedImageMaterialization(
	model *runtimev1.LocalAssetRecord,
	cached managedImageProfileState,
) (managedImageMaterializationExecution, error) {
	if s == nil || model == nil || len(cached.MaterializationBindings) == 0 {
		return managedImageMaterializationExecution{}, durableLocalTargetUnavailableError()
	}
	mainLocalAssetID := strings.TrimSpace(model.GetLocalAssetId())
	mainAssetID := strings.TrimSpace(model.GetAssetId())
	if mainLocalAssetID == "" || mainAssetID == "" {
		return managedImageMaterializationExecution{}, durableLocalTargetUnavailableError()
	}

	mainCount := 0
	modelPath := ""
	companions := make([]managedMediaProfileMaterializationBinding, 0, len(cached.MaterializationBindings))
	seenOccurrences := make(map[string]struct{}, len(cached.MaterializationBindings))
	seenOrders := make(map[int]struct{}, len(cached.MaterializationBindings))
	for _, binding := range cached.MaterializationBindings {
		companionAssetID := strings.TrimSpace(binding.CompanionAssetID)
		if companionAssetID == "" {
			if strings.TrimSpace(binding.AssetID) != mainAssetID ||
				strings.TrimSpace(binding.LocalAssetID) != mainLocalAssetID ||
				strings.TrimSpace(binding.CompanionKind) != "" ||
				strings.TrimSpace(binding.EngineSlot) != "" ||
				strings.TrimSpace(binding.CompanionLocalAssetID) != "" ||
				strings.TrimSpace(binding.ParentAssetID) != "" ||
				binding.OccurrenceID != "" {
				return managedImageMaterializationExecution{}, materializationBindingInvalidError("main binding identity is inconsistent")
			}
			mainCount++
			if mainCount != 1 {
				return managedImageMaterializationExecution{}, materializationBindingInvalidError("materialization contains multiple main bindings")
			}
			resolved, err := s.resolveManagedAssetEntryPath(model)
			if err != nil {
				return managedImageMaterializationExecution{}, err
			}
			modelPath = resolved
			continue
		}

		occurrenceID := strings.TrimSpace(binding.OccurrenceID)
		role := strings.TrimSpace(binding.Role)
		componentKind := strings.ToLower(strings.TrimSpace(binding.CompanionKind))
		engineSlot := strings.TrimSpace(binding.EngineSlot)
		companionLocalAssetID := strings.TrimSpace(binding.CompanionLocalAssetID)
		if strings.TrimSpace(binding.AssetID) != mainAssetID ||
			strings.TrimSpace(binding.LocalAssetID) != mainLocalAssetID ||
			strings.TrimSpace(binding.ParentAssetID) != mainAssetID ||
			occurrenceID == "" || role == "" || componentKind == "" || engineSlot == "" ||
			companionLocalAssetID == "" || binding.Order < 0 {
			return managedImageMaterializationExecution{}, materializationBindingInvalidError("companion occurrence identity is incomplete")
		}
		if _, duplicate := seenOccurrences[occurrenceID]; duplicate {
			return managedImageMaterializationExecution{}, materializationBindingInvalidError("duplicate companion occurrence")
		}
		if _, duplicate := seenOrders[binding.Order]; duplicate {
			return managedImageMaterializationExecution{}, materializationBindingInvalidError("duplicate companion order")
		}
		seenOccurrences[occurrenceID] = struct{}{}
		seenOrders[binding.Order] = struct{}{}

		companion := s.localAssetByID(companionLocalAssetID)
		if !profileEntryInstalledAssetUsable(companion) ||
			strings.TrimSpace(companion.GetAssetId()) != companionAssetID {
			return managedImageMaterializationExecution{}, durableLocalTargetUnavailableError()
		}
		kind, ok := parseLocalAssetKindToken(componentKind)
		if !ok || effectiveAssetKind(companion.GetKind(), companion.GetCapabilities()) != kind {
			return managedImageMaterializationExecution{}, materializationBindingInvalidError("companion kind does not match the committed asset")
		}
		if logicalModelID := strings.TrimSpace(binding.LogicalModelID); logicalModelID != "" &&
			logicalModelID != strings.TrimSpace(companion.GetLogicalModelId()) {
			return managedImageMaterializationExecution{}, materializationBindingInvalidError("companion logical model identity changed")
		}
		binding.Role = role
		binding.CompanionKind = componentKind
		binding.EngineSlot = engineSlot
		binding.CompanionLocalAssetID = companionLocalAssetID
		binding.CompanionAssetID = companionAssetID
		companions = append(companions, binding)
	}
	if mainCount != 1 || modelPath == "" {
		return managedImageMaterializationExecution{}, materializationBindingInvalidError("materialization main binding is missing")
	}
	sort.SliceStable(companions, func(left, right int) bool { return companions[left].Order < companions[right].Order })

	result := managedImageMaterializationExecution{
		ModelPath:      modelPath,
		SlotOptions:    make([]string, 0, len(companions)),
		ComponentSpecs: make([]map[string]any, 0, len(companions)),
	}
	for _, binding := range companions {
		companion := s.localAssetByID(binding.CompanionLocalAssetID)
		path, err := s.resolveManagedAssetEntryPath(companion)
		if err != nil {
			return managedImageMaterializationExecution{}, err
		}
		result.SlotOptions = append(result.SlotOptions, strings.TrimSpace(binding.EngineSlot)+":"+path)
		result.ComponentSpecs = append(result.ComponentSpecs, map[string]any{
			"occurrence_id":  strings.TrimSpace(binding.OccurrenceID),
			"order":          binding.Order,
			"role":           strings.TrimSpace(binding.Role),
			"component_kind": strings.TrimSpace(binding.CompanionKind),
			"engine_slot":    strings.TrimSpace(binding.EngineSlot),
			"path":           path,
			"required":       binding.Required,
			"weight":         strings.TrimSpace(binding.Weight),
			"options":        cloneAnyMap(binding.Options),
		})
	}
	return result, nil
}

func materializationBindingInvalidError(message string) error {
	return grpcerr.WithReasonCodeOptions(
		codes.FailedPrecondition,
		runtimev1.ReasonCode_AI_LOCAL_ASSET_SLOT_MISSING,
		grpcerr.ReasonOptions{Message: fmt.Sprintf("exact image materialization is invalid: %s", message)},
	)
}
