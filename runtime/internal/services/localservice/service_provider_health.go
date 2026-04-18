package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// HasSupervisedEngineBinding reports whether any non-removed supervised local
// asset or service is configured to use the managed engine.
func (s *Service) HasSupervisedEngineBinding(engineName string) bool {
	return s.hasSupervisedEngineBinding(engineName, false)
}

// HasActiveSupervisedEngineBinding reports whether any ACTIVE supervised local
// asset or service currently requires the managed engine.
func (s *Service) HasActiveSupervisedEngineBinding(engineName string) bool {
	return s.hasSupervisedEngineBinding(engineName, true)
}

func (s *Service) hasSupervisedEngineBinding(engineName string, activeOnly bool) bool {
	normalizedEngine := normalizeManagedEngineName(engineName)
	if s == nil || normalizedEngine == "" {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for localAssetID, model := range s.assets {
		if model == nil || model.GetStatus() == runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED {
			continue
		}
		if normalizeRuntimeMode(s.assetRuntimeModes[localAssetID]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if activeOnly && model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			continue
		}
		if normalizeManagedEngineName(executionRuntimeEngineForModel(model)) == normalizedEngine {
			return true
		}
	}

	for serviceID, service := range s.services {
		if service == nil || service.GetStatus() == runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_REMOVED {
			continue
		}
		if normalizeRuntimeMode(s.serviceRuntimeModes[serviceID]) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
			continue
		}
		if activeOnly && service.GetStatus() != runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE {
			continue
		}
		if normalizeManagedEngineName(strings.ToLower(strings.TrimSpace(service.GetEngine()))) == normalizedEngine {
			return true
		}
	}

	return false
}
