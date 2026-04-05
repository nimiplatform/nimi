package localservice

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func modelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult, registration managedLlamaRegistration) bool {
	if isManagedSupervisedLlamaModel(model, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED) {
		return managedLlamaModelProbeSucceeded(probe, registration)
	}
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeSucceeded(probe, registration)
	case "media":
		return mediaModelProbeSucceeded(model, probe)
	}
	return probe.healthy
}

func modelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult, registration managedLlamaRegistration) string {
	if isManagedSupervisedLlamaModel(model, runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED) {
		return managedLlamaModelProbeFailureDetail(probe, registration)
	}
	switch strings.ToLower(strings.TrimSpace(model.GetEngine())) {
	case "llama":
		return managedLlamaModelProbeFailureDetail(probe, registration)
	case "media":
		return mediaModelProbeFailureDetail(model, probe)
	}
	return defaultString(probe.detail, "model probe failed")
}

func mediaModelProbeSucceeded(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) bool {
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" || len(probe.models) == 0 {
		return false
	}
	_, ok := findComparableProbeModel(probe.models, expectedModelName)
	return ok
}

func mediaModelProbeFailureDetail(model *runtimev1.LocalAssetRecord, probe endpointProbeResult) string {
	if !probe.healthy {
		return defaultString(probe.detail, "media model probe failed")
	}
	expectedModelName := strings.TrimSpace(model.GetAssetId())
	if expectedModelName == "" {
		return "media probe requires a model id"
	}
	available := compactProbeModelIDs(probe.models)
	if len(available) == 0 {
		return fmt.Sprintf("media probe missing expected model %q", expectedModelName)
	}
	return fmt.Sprintf("media probe missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
}

func managedLlamaModelProbeSucceeded(probe endpointProbeResult, registration managedLlamaRegistration) bool {
	if strings.TrimSpace(registration.Problem) != "" {
		return false
	}
	if registration.DynamicProfile {
		return probe.responded
	}
	if !probe.healthy {
		return false
	}
	expectedModelName := strings.TrimSpace(registration.ExposedModelName)
	if expectedModelName == "" || len(probe.models) == 0 {
		return true
	}
	for _, modelID := range probe.models {
		if strings.EqualFold(strings.TrimSpace(modelID), expectedModelName) {
			return true
		}
	}
	return false
}

func managedLlamaModelProbeFailureDetail(probe endpointProbeResult, registration managedLlamaRegistration) string {
	if detail := strings.TrimSpace(registration.Problem); detail != "" {
		return detail
	}
	if registration.DynamicProfile {
		if probe.responded {
			return "local media workflow ready"
		}
		return defaultString(probe.detail, "local media workflow unavailable")
	}
	if !probe.healthy {
		return defaultString(probe.detail, "model probe failed")
	}
	expectedModelName := strings.TrimSpace(registration.ExposedModelName)
	if expectedModelName == "" || len(probe.models) == 0 {
		return defaultString(probe.detail, "model probe failed")
	}
	available := make([]string, 0, len(probe.models))
	for _, modelID := range probe.models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed != "" {
			available = append(available, trimmed)
		}
	}
	sort.Strings(available)
	if len(available) == 0 {
		return fmt.Sprintf("probe response missing expected model %q", expectedModelName)
	}
	return fmt.Sprintf("probe response missing expected model %q; available_models=%s", expectedModelName, strings.Join(available, ","))
}

func compactProbeModelIDs(models []string) []string {
	available := make([]string, 0, len(models))
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed != "" {
			available = append(available, trimmed)
		}
	}
	sort.Strings(available)
	return available
}

func findComparableProbeModel(models []string, expected string) (string, bool) {
	expectedComparable := normalizeComparableModelID(expected)
	expectedBase := probeModelIDBase(expected)
	for _, modelID := range models {
		trimmed := strings.TrimSpace(modelID)
		if trimmed == "" {
			continue
		}
		if normalizeComparableModelID(trimmed) == expectedComparable {
			return trimmed, true
		}
		if probeModelIDBase(trimmed) == expectedBase {
			return trimmed, true
		}
	}
	return "", false
}

func normalizeComparableModelID(value string) string {
	comparable := strings.ToLower(strings.TrimSpace(value))
	comparable = strings.TrimPrefix(comparable, "models/")
	comparable = strings.TrimPrefix(comparable, "model/")
	comparable = strings.TrimPrefix(comparable, "local/")
	comparable = strings.TrimPrefix(comparable, "llama/")
	comparable = strings.TrimPrefix(comparable, "media/")
	comparable = strings.TrimPrefix(comparable, "speech/")
	return comparable
}

func probeModelIDBase(value string) string {
	trimmed := normalizeComparableModelID(value)
	if idx := strings.Index(trimmed, "@"); idx > 0 {
		return strings.TrimSpace(trimmed[:idx])
	}
	return trimmed
}
