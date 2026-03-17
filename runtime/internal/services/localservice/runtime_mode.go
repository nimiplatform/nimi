package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type localRuntimeBinding struct {
	mode            runtimev1.LocalEngineRuntimeMode
	endpoint        string
	autoRecommended bool
}

func normalizeRuntimeMode(mode runtimev1.LocalEngineRuntimeMode) runtimev1.LocalEngineRuntimeMode {
	if mode == runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	return mode
}

func supportsSupervisedEngine(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama", "media":
		return true
	default:
		return false
	}
}

func managedDefaultEndpointForEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return defaultLocalEndpoint
	case "media":
		return defaultNimiMediaEndpoint
	default:
		return ""
	}
}

func autoRecommendedRuntimeBinding(engine string, profile *runtimev1.LocalDeviceProfile) localRuntimeBinding {
	if !supportsSupervisedEngine(engine) {
		return localRuntimeBinding{
			mode:            runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint:        "",
			autoRecommended: true,
		}
	}
	classification, _ := classifyManagedEngineSupport(engine, profile)
	if classification == localEngineSupportSupportedSupervised {
		return localRuntimeBinding{
			mode:            runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
			endpoint:        "",
			autoRecommended: true,
		}
	}
	return localRuntimeBinding{
		mode:            runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		endpoint:        "",
		autoRecommended: true,
	}
}

func catalogBindingInstallAvailable(engine string, binding localRuntimeBinding, profile *runtimev1.LocalDeviceProfile) bool {
	switch normalizeRuntimeMode(binding.mode) {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		return strings.TrimSpace(binding.endpoint) != ""
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		classification, _ := classifyManagedEngineSupport(engine, profile)
		return classification == localEngineSupportSupportedSupervised
	default:
		return false
	}
}

func resolveCatalogRuntimeBinding(
	engine string,
	requestEndpoint string,
	explicitMode runtimev1.LocalEngineRuntimeMode,
	catalogEndpoint string,
	profile *runtimev1.LocalDeviceProfile,
) localRuntimeBinding {
	if endpoint := strings.TrimSpace(requestEndpoint); endpoint != "" {
		return localRuntimeBinding{
			mode:     runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint: endpoint,
		}
	}
	switch explicitMode {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		return localRuntimeBinding{
			mode:     runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
			endpoint: "",
		}
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		return localRuntimeBinding{
			mode:     runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint: strings.TrimSpace(catalogEndpoint),
		}
	default:
		return autoRecommendedRuntimeBinding(engine, profile)
	}
}

func resolveInstallRuntimeBinding(engine string, requestEndpoint string, profile *runtimev1.LocalDeviceProfile) localRuntimeBinding {
	if endpoint := strings.TrimSpace(requestEndpoint); endpoint != "" {
		return localRuntimeBinding{
			mode:     runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint: endpoint,
		}
	}
	return autoRecommendedRuntimeBinding(engine, profile)
}

func (s *Service) managedEndpointForEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return s.managedLocalAIEndpoint()
	case "media":
		return s.managedNimiMediaEndpoint()
	default:
		return ""
	}
}

func (s *Service) managedEndpointForEngineLocked(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return strings.TrimSpace(s.localAIManagedEndpoint)
	case "media":
		return strings.TrimSpace(s.nimiMediaManagedEndpoint)
	default:
		return ""
	}
}

func effectiveEndpointForRuntimeMode(engine string, mode runtimev1.LocalEngineRuntimeMode, endpoint string, managedEndpoint string) string {
	if normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return strings.TrimSpace(endpoint)
	}
	if managed := strings.TrimSpace(managedEndpoint); managed != "" {
		return managed
	}
	return managedDefaultEndpointForEngine(engine)
}

func storedEndpointForRuntimeMode(mode runtimev1.LocalEngineRuntimeMode, endpoint string, managedEndpoint string) string {
	if normalizeRuntimeMode(mode) != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		return strings.TrimSpace(endpoint)
	}
	if managed := strings.TrimSpace(managedEndpoint); managed != "" {
		return managed
	}
	return ""
}

func (s *Service) effectiveEndpointForRuntimeMode(engine string, mode runtimev1.LocalEngineRuntimeMode, endpoint string) string {
	return effectiveEndpointForRuntimeMode(engine, mode, endpoint, s.managedEndpointForEngine(engine))
}

func (s *Service) storedEndpointForRuntimeMode(engine string, mode runtimev1.LocalEngineRuntimeMode, endpoint string) string {
	return storedEndpointForRuntimeMode(mode, endpoint, s.managedEndpointForEngine(engine))
}

func (s *Service) modelRuntimeMode(localModelID string) runtimev1.LocalEngineRuntimeMode {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return normalizeRuntimeMode(s.modelRuntimeModes[id])
}

func (s *Service) serviceRuntimeMode(serviceID string) runtimev1.LocalEngineRuntimeMode {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if mode, ok := s.serviceRuntimeModes[id]; ok && mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED {
		return normalizeRuntimeMode(mode)
	}
	service := s.services[id]
	if service == nil {
		return runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	}
	return normalizeRuntimeMode(s.modelRuntimeModes[strings.TrimSpace(service.GetLocalModelId())])
}

func (s *Service) setModelRuntimeModeLocked(localModelID string, mode runtimev1.LocalEngineRuntimeMode) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return
	}
	s.modelRuntimeModes[id] = normalizeRuntimeMode(mode)
}

func (s *Service) setServiceRuntimeModeLocked(serviceID string, mode runtimev1.LocalEngineRuntimeMode) {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return
	}
	s.serviceRuntimeModes[id] = normalizeRuntimeMode(mode)
}
