package localservice

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func startupCompatibilityWarningsForAsset(
	engine string,
	capabilities []string,
	kind runtimev1.LocalAssetKind,
	profile *runtimev1.LocalDeviceProfile,
) []string {
	if profile == nil {
		return []string{}
	}
	normalizedEngine := strings.ToLower(strings.TrimSpace(
		managedRuntimeEngineForAsset(engine, capabilities, kind),
	))
	warnings := make([]string, 0, 3)
	if requiresGPU(normalizedEngine) && !profile.GetGpu().GetAvailable() {
		warnings = append(warnings, "WARN_GPU_REQUIRED")
	}
	if requiresPython(normalizedEngine) && !profile.GetPython().GetAvailable() {
		warnings = append(warnings, "WARN_PYTHON_REQUIRED")
	}
	if requiresNPU(normalizedEngine) && (!profile.GetNpu().GetAvailable() || !profile.GetNpu().GetReady()) {
		warnings = append(warnings, "WARN_NPU_REQUIRED")
	}
	return append(warnings, managedEngineSupportWarningsForAsset(engine, capabilities, kind, profile)...)
}

func (s *Service) engineManagerOrNil() EngineManager {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.engineMgr
}
