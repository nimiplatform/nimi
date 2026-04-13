package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// ResolveManagedLlamaModelByCapabilities returns the exposed managed llama
// model name for the first supervised local asset that satisfies any of the
// requested capabilities. The preferred identifier may match local_asset_id,
// asset_id, or logical_model_id.
func (s *Service) ResolveManagedLlamaModelByCapabilities(preferred string, capabilities ...string) (string, bool) {
	if s == nil {
		return "", false
	}
	normalizedCapabilities := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		if normalized := normalizeLocalCapabilityToken(capability); normalized != "" {
			normalizedCapabilities = append(normalizedCapabilities, normalized)
		}
	}
	if len(normalizedCapabilities) == 0 {
		return "", false
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

	preferred = strings.TrimSpace(preferred)
	if preferred != "" {
		for _, candidate := range candidates {
			if matchesManagedLlamaPreferredID(candidate, preferred) {
				if resolved, ok := resolveManagedLlamaRegistrationName(s, candidate); ok {
					return resolved, true
				}
			}
		}
	}
	for _, candidate := range candidates {
		if resolved, ok := resolveManagedLlamaRegistrationName(s, candidate); ok {
			return resolved, true
		}
	}
	return "", false
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
