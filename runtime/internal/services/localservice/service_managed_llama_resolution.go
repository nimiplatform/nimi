package localservice

import (
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// ResolveManagedLlamaModelByCapabilities returns the exposed managed llama
// model name for the first supervised local asset that satisfies any of the
// requested capabilities. The preferred identifier may match local_asset_id,
// asset_id, or logical_model_id.
func (s *Service) ResolveManagedLlamaModelByCapabilities(preferred string, capabilities ...string) (string, bool) {
	candidate, resolved, ok := s.resolveManagedLlamaCandidateByCapabilities(preferred, true, capabilities...)
	if !ok || candidate == nil {
		return "", false
	}
	return resolved, true
}

// ResolveManagedLlamaDurableTargetByCapabilities returns the Runtime-owned
// logical model identity and opaque v2 target for the exact managed llama
// registration selected by preferred. Unlike the provider-facing registration
// name, these values are suitable for ScenarioRequestHead.
func (s *Service) ResolveManagedLlamaDurableTargetByCapabilities(
	preferred string,
	capabilities ...string,
) (string, *runtimev1.RuntimeDurableLocalTargetRef, bool) {
	candidate, _, ok := s.resolveManagedLlamaCandidateByCapabilities(preferred, preferred == "", capabilities...)
	if !ok || candidate == nil {
		return "", nil, false
	}
	logicalModelID := strings.TrimSpace(candidate.GetLogicalModelId())
	target, _, _ := s.projectDurableLocalTargetForAsset(candidate)
	if logicalModelID == "" || target == nil {
		return "", nil, false
	}
	return logicalModelID, target, true
}

func (s *Service) resolveManagedLlamaCandidateByCapabilities(
	preferred string,
	allowFallback bool,
	capabilities ...string,
) (*runtimev1.LocalAssetRecord, string, bool) {
	if s == nil {
		return nil, "", false
	}
	normalizedCapabilities := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		if normalized := normalizeLocalCapabilityToken(capability); normalized != "" {
			normalizedCapabilities = append(normalizedCapabilities, normalized)
		}
	}
	if len(normalizedCapabilities) == 0 {
		return nil, "", false
	}

	s.mu.RLock()
	candidates := make([]*runtimev1.LocalAssetRecord, 0, len(s.assets))
	for localModelID, model := range s.assets {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if !isManagedSupervisedLlamaModel(model, s.assetRuntimeModes[localModelID]) {
			continue
		}
		matchesCapability := false
		for _, capability := range normalizedCapabilities {
			if localAssetHasCapability(model.GetCapabilities(), capability) {
				matchesCapability = true
				break
			}
		}
		if matchesCapability {
			candidates = append(candidates, cloneLocalAsset(model))
		}
	}
	s.mu.RUnlock()
	sort.Slice(candidates, func(i, j int) bool {
		left := candidates[i]
		right := candidates[j]
		if leftRank, rightRank := managedLlamaResolutionStatusRank(left.GetStatus()), managedLlamaResolutionStatusRank(right.GetStatus()); leftRank != rightRank {
			return leftRank < rightRank
		}
		if leftCategory, rightCategory := localModelSortCategory(left), localModelSortCategory(right); leftCategory != rightCategory {
			return leftCategory < rightCategory
		}
		if left.GetAssetId() != right.GetAssetId() {
			return left.GetAssetId() < right.GetAssetId()
		}
		return left.GetLocalAssetId() < right.GetLocalAssetId()
	})

	preferred = strings.TrimSpace(preferred)
	if preferred != "" {
		for _, candidate := range candidates {
			resolved, ok := resolveManagedLlamaRegistrationName(s, candidate)
			if ok && (matchesManagedLlamaPreferredID(candidate, preferred) || strings.EqualFold(resolved, preferred)) {
				return candidate, resolved, true
			}
		}
		if !allowFallback {
			return nil, "", false
		}
	}
	for _, candidate := range candidates {
		if resolved, ok := resolveManagedLlamaRegistrationName(s, candidate); ok {
			return candidate, resolved, true
		}
	}
	return nil, "", false
}

func managedLlamaResolutionStatusRank(status runtimev1.LocalAssetStatus) int {
	switch status {
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE:
		return 0
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED:
		return 1
	case runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY:
		return 2
	default:
		return 3
	}
}

func resolveManagedLlamaRegistrationName(s *Service, model *runtimev1.LocalAssetRecord) (string, bool) {
	registration := s.managedLlamaRegistrationForModel(model)
	if strings.TrimSpace(registration.Problem) != "" {
		return "", false
	}
	name := strings.TrimSpace(registration.ExposedModelName)
	if name == "" {
		name = strings.TrimSpace(model.GetAssetId())
	}
	return name, name != ""
}

func matchesManagedLlamaPreferredID(model *runtimev1.LocalAssetRecord, preferred string) bool {
	if model == nil || preferred == "" {
		return false
	}
	for _, candidate := range []string{
		model.GetLocalAssetId(),
		model.GetAssetId(),
		model.GetLogicalModelId(),
	} {
		if strings.EqualFold(strings.TrimSpace(candidate), preferred) {
			return true
		}
	}
	return false
}
