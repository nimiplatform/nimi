package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
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
	case "llama", "media", "speech":
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
		return defaultMediaEndpoint
	case "speech":
		return defaultSpeechEndpoint
	default:
		return ""
	}
}

func autoRecommendedRuntimeBinding(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	profile *runtimev1.LocalDeviceProfile,
) localRuntimeBinding {
	if isCanonicalSupervisedImageAsset(engine, capabilities, kind, engineConfig, preferredEngine) {
		return localRuntimeBinding{
			mode:            runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
			endpoint:        "",
			autoRecommended: true,
		}
	}
	if !supportsSupervisedEngine(engine) {
		return localRuntimeBinding{
			mode:            runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint:        "",
			autoRecommended: true,
		}
	}
	classification, _ := classifyManagedEngineSupportForAsset(engine, capabilities, kind, engineConfig, preferredEngine, profile)
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

func catalogBindingInstallAvailable(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	binding localRuntimeBinding,
	profile *runtimev1.LocalDeviceProfile,
) bool {
	switch normalizeRuntimeMode(binding.mode) {
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT:
		return strings.TrimSpace(binding.endpoint) != ""
	case runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED:
		classification, _ := classifyManagedEngineSupportForAsset(engine, capabilities, kind, engineConfig, preferredEngine, profile)
		return classification == localEngineSupportSupportedSupervised
	default:
		return false
	}
}

func resolveCatalogRuntimeBinding(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
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
		return autoRecommendedRuntimeBinding(engine, capabilities, kind, engineConfig, preferredEngine, profile)
	}
}

func resolveInstallRuntimeBinding(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	requestEndpoint string,
	profile *runtimev1.LocalDeviceProfile,
) localRuntimeBinding {
	if endpoint := strings.TrimSpace(requestEndpoint); endpoint != "" {
		return localRuntimeBinding{
			mode:     runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
			endpoint: endpoint,
		}
	}
	return autoRecommendedRuntimeBinding(engine, capabilities, kind, engineConfig, preferredEngine, profile)
}

func (s *Service) managedEndpointForEngine(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return s.managedLlamaEndpoint()
	case "media":
		return s.managedMediaEndpoint()
	case "speech":
		return s.managedSpeechEndpoint()
	default:
		return ""
	}
}

func (s *Service) managedEndpointForAsset(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) string {
	return s.managedEndpointForEngine(
		executionRuntimeEngineForAsset(engine, capabilities, kind, engineConfig, preferredEngine),
	)
}

func (s *Service) managedEndpointForEngineLocked(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "llama":
		return strings.TrimSpace(s.managedLlamaEndpointValue)
	case "media":
		return strings.TrimSpace(s.managedMediaEndpointValue)
	case "speech":
		return strings.TrimSpace(s.managedSpeechEndpointValue)
	default:
		return ""
	}
}

func (s *Service) managedEndpointForAssetLocked(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
) string {
	return s.managedEndpointForEngineLocked(
		executionRuntimeEngineForAsset(engine, capabilities, kind, engineConfig, preferredEngine),
	)
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

func effectiveEndpointForAssetRuntimeMode(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	mode runtimev1.LocalEngineRuntimeMode,
	endpoint string,
	managedEndpoint string,
) string {
	return effectiveEndpointForRuntimeMode(
		executionRuntimeEngineForAsset(engine, capabilities, kind, engineConfig, preferredEngine),
		mode,
		endpoint,
		managedEndpoint,
	)
}

func storedEndpointForAssetRuntimeMode(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	engineConfig *structpb.Struct,
	preferredEngine string,
	mode runtimev1.LocalEngineRuntimeMode,
	endpoint string,
	managedEndpoint string,
) string {
	targetEngine := executionRuntimeEngineForAsset(engine, capabilities, kind, engineConfig, preferredEngine)
	if strings.TrimSpace(managedEndpoint) == "" {
		managedEndpoint = managedDefaultEndpointForEngine(targetEngine)
	}
	return storedEndpointForRuntimeMode(
		mode,
		endpoint,
		managedEndpoint,
	)
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
	return normalizeRuntimeMode(s.assetRuntimeModes[id])
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
	return normalizeRuntimeMode(s.assetRuntimeModes[strings.TrimSpace(service.GetLocalModelId())])
}

func (s *Service) setModelRuntimeModeLocked(localModelID string, mode runtimev1.LocalEngineRuntimeMode) {
	id := strings.TrimSpace(localModelID)
	if id == "" {
		return
	}
	s.assetRuntimeModes[id] = normalizeRuntimeMode(mode)
}

func (s *Service) setServiceRuntimeModeLocked(serviceID string, mode runtimev1.LocalEngineRuntimeMode) {
	id := strings.TrimSpace(serviceID)
	if id == "" {
		return
	}
	s.serviceRuntimeModes[id] = normalizeRuntimeMode(mode)
}
